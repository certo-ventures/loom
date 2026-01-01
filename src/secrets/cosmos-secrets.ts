/**
 * Cosmos DB Secrets Store
 * 
 * Unified persistence layer for secrets using the same
 * Cosmos DB infrastructure as config and memory
 */

import type { Container } from '@azure/cosmos'
import type { SecretsStore, Secret } from './types'

export interface CosmosSecretsStoreOptions {
  /** Cosmos DB container for secrets */
  container: Container
  
  /** Encryption key for secret values (optional) */
  encryptionKey?: string
}

interface SecretDocument {
  id: string // Secret key
  partitionKey: string // Tenant ID or 'global'
  key: string // Secret key
  value: string // Encrypted or plain secret value
  metadata?: Record<string, string>
  createdAt: string
  updatedAt: string
  expiresAt?: string // Optional TTL
  version: number // For rotation tracking
}

/**
 * Cosmos DB-backed secrets store
 */
export class CosmosSecretsStore implements SecretsStore {
  private container: Container
  private encryptionKey?: string

  constructor(options: CosmosSecretsStoreOptions) {
    this.container = options.container
    this.encryptionKey = options.encryptionKey
  }

  // ========================================================================
  // SecretsStore Implementation
  // ========================================================================

  async getSecret(key: string): Promise<Secret | null> {
    const partitionKey = this.getPartitionKey(key)
    
    try {
      const { resource } = await this.container.item(key, partitionKey).read<SecretDocument>()
      
      if (!resource) {
        return null
      }

      // Check expiration
      if (resource.expiresAt && new Date(resource.expiresAt) < new Date()) {
        await this.deleteSecret(key) // Cleanup expired secret
        return null
      }

      return {
        key: resource.key,
        value: this.decrypt(resource.value),
        metadata: resource.metadata,
        version: resource.version,
        expiresAt: resource.expiresAt,
      }
    } catch (error: any) {
      if (error.code === 404) {
        return null
      }
      throw error
    }
  }

  async setSecret(secret: Secret): Promise<void> {
    const doc: SecretDocument = {
      id: secret.key,
      partitionKey: this.getPartitionKey(secret.key),
      key: secret.key,
      value: this.encrypt(secret.value),
      metadata: secret.metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: secret.expiresAt,
      version: secret.version || 1,
    }

    await this.container.items.upsert(doc)
  }

  async deleteSecret(key: string): Promise<void> {
    const partitionKey = this.getPartitionKey(key)
    
    try {
      await this.container.item(key, partitionKey).delete()
    } catch (error: any) {
      if (error.code !== 404) {
        throw error
      }
      // Ignore 404 - already deleted
    }
  }

  async listSecrets(prefix?: string): Promise<string[]> {
    const query = prefix
      ? {
          query: 'SELECT c.key FROM c WHERE STARTSWITH(c.key, @prefix)',
          parameters: [{ name: '@prefix', value: prefix }],
        }
      : {
          query: 'SELECT c.key FROM c',
        }

    const { resources } = await this.container.items.query<{ key: string }>(query).fetchAll()

    return resources.map(r => r.key)
  }

  // ========================================================================
  // Encryption/Decryption
  // ========================================================================

  /**
   * Encrypt secret value
   * TODO: Implement proper encryption (AES-256, etc.)
   */
  private encrypt(value: string): string {
    if (!this.encryptionKey) {
      return value // No encryption configured
    }

    // Simple XOR for demonstration
    // In production, use proper encryption like @azure/keyvault-keys
    return Buffer.from(value)
      .toString('base64')
  }

  /**
   * Decrypt secret value
   */
  private decrypt(encrypted: string): string {
    if (!this.encryptionKey) {
      return encrypted // No encryption configured
    }

    // Simple XOR for demonstration
    return Buffer.from(encrypted, 'base64').toString('utf8')
  }

  // ========================================================================
  // Helper Methods
  // ========================================================================

  /**
   * Extract partition key from secret key
   */
  private getPartitionKey(key: string): string {
    const parts = key.split('/')
    if (parts.length >= 2) {
      return parts[1] // tenantId
    }
    return 'global'
  }

  /**
   * Rotate secret (increment version)
   */
  async rotateSecret(key: string, newValue: string): Promise<void> {
    const existing = await this.getSecret(key)
    const version = existing ? existing.version + 1 : 1

    await this.setSecret({
      key,
      value: newValue,
      metadata: existing?.metadata,
      version,
      expiresAt: existing?.expiresAt,
    })
  }

  /**
   * Bulk set secrets (more efficient)
   */
  async bulkSetSecrets(secrets: Secret[]): Promise<void> {
    const operations = secrets.map(secret => ({
      operationType: 'Upsert' as const,
      resourceBody: {
        id: secret.key,
        partitionKey: this.getPartitionKey(secret.key),
        key: secret.key,
        value: this.encrypt(secret.value),
        metadata: secret.metadata,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: secret.expiresAt,
        version: secret.version || 1,
      },
    }))

    // Cosmos bulk operations support up to 100 items
    for (let i = 0; i < operations.length; i += 100) {
      const batch = operations.slice(i, i + 100)
      await this.container.items.bulk(batch as any)
    }
  }

  /**
   * Cleanup expired secrets
   */
  async cleanupExpired(): Promise<number> {
    const query = {
      query: 'SELECT c.id, c.partitionKey FROM c WHERE c.expiresAt < @now',
      parameters: [{ name: '@now', value: new Date().toISOString() }],
    }

    const { resources } = await this.container.items.query<{ id: string; partitionKey: string }>(query).fetchAll()

    for (const doc of resources) {
      await this.container.item(doc.id, doc.partitionKey).delete()
    }

    return resources.length
  }
}
