/**
 * Cosmos DB Configuration Resolver
 * 
 * Persistent configuration storage using Azure Cosmos DB
 * Supports hierarchical resolution with tenantId/clientId/environment
 */

import type { Container } from '@azure/cosmos'
import type { ConfigResolver, ConfigContext, ConfigValue } from './index'
import { buildKeyPaths } from './path-resolver'

export interface CosmosConfigResolverOptions {
  /** Cosmos DB container for config storage */
  container: Container
  
  /** Key prefix for namespacing (optional) */
  keyPrefix?: string
}

interface ConfigDocument {
  id: string // Full key path
  partitionKey: string // Tenant ID or 'global'
  keyPath: string // Original key path
  value: ConfigValue
  context?: ConfigContext
  createdAt: string
  updatedAt: string
}

/**
 * Cosmos DB-backed configuration resolver
 */
export class CosmosConfigResolver implements ConfigResolver {
  private container: Container
  private keyPrefix: string

  constructor(options: CosmosConfigResolverOptions) {
    this.container = options.container
    this.keyPrefix = options.keyPrefix ?? ''
  }

  // ========================================================================
  // ConfigResolver Implementation
  // ========================================================================

  async get(keyPath: string): Promise<ConfigValue> {
    const fullPath = this.getFullPath(keyPath)
    
    try {
      const { resource } = await this.container.item(fullPath, this.getPartitionKey(keyPath)).read<ConfigDocument>()
      return resource?.value ?? null
    } catch (error: any) {
      if (error.code === 404) {
        return null // Not found
      }
      throw error
    }
  }

  async getWithContext(key: string, context: ConfigContext): Promise<ConfigValue> {
    // Build hierarchical paths with fallback
    const paths = buildKeyPaths(key, context)
    
    // Try each path in order of specificity
    for (const path of paths) {
      const value = await this.get(path)
      if (value !== null) {
        return value
      }
    }
    
    // Not found at any level
    return null
  }

  async getAll(prefix: string): Promise<Record<string, ConfigValue>> {
    const fullPrefix = this.getFullPath(prefix)
    
    const query = {
      query: 'SELECT * FROM c WHERE STARTSWITH(c.keyPath, @prefix)',
      parameters: [{ name: '@prefix', value: fullPrefix }],
    }

    const { resources } = await this.container.items.query<ConfigDocument>(query).fetchAll()

    const result: Record<string, ConfigValue> = {}
    for (const doc of resources) {
      result[doc.keyPath] = doc.value
    }

    return result
  }

  async set(keyPath: string, value: ConfigValue): Promise<void> {
    const fullPath = this.getFullPath(keyPath)
    const partitionKey = this.getPartitionKey(keyPath)
    
    const doc: ConfigDocument = {
      id: fullPath,
      partitionKey,
      keyPath: fullPath,
      value,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await this.container.items.upsert(doc)
  }

  async delete(keyPath: string): Promise<void> {
    const fullPath = this.getFullPath(keyPath)
    const partitionKey = this.getPartitionKey(keyPath)
    
    try {
      await this.container.item(fullPath, partitionKey).delete()
    } catch (error: any) {
      if (error.code !== 404) {
        throw error
      }
      // Ignore 404 - already deleted
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    const fullPrefix = this.getFullPath(prefix)
    
    const query = {
      query: 'SELECT c.keyPath FROM c WHERE STARTSWITH(c.keyPath, @prefix)',
      parameters: [{ name: '@prefix', value: fullPrefix }],
    }

    const { resources } = await this.container.items.query<{ keyPath: string }>(query).fetchAll()

    return resources.map(r => r.keyPath)
  }

  // ========================================================================
  // Helper Methods
  // ========================================================================

  /**
   * Get full path with prefix
   */
  private getFullPath(keyPath: string): string {
    if (!this.keyPrefix) {
      return keyPath
    }
    return `${this.keyPrefix}/${keyPath}`
  }

  /**
   * Extract partition key from path
   * Uses tenantId if present, otherwise 'global'
   */
  private getPartitionKey(keyPath: string): string {
    const parts = keyPath.split('/')
    // If path starts with clientId/tenantId pattern, use tenantId
    if (parts.length >= 2) {
      return parts[1] // tenantId
    }
    return 'global'
  }

  /**
   * Bulk set multiple configs (more efficient)
   */
  async bulkSet(configs: Record<string, ConfigValue>): Promise<void> {
    const operations = Object.entries(configs).map(([keyPath, value]) => ({
      operationType: 'Upsert' as const,
      resourceBody: {
        id: this.getFullPath(keyPath),
        partitionKey: this.getPartitionKey(keyPath),
        keyPath: this.getFullPath(keyPath),
        value,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }))

    // Cosmos bulk operations support up to 100 items
    for (let i = 0; i < operations.length; i += 100) {
      const batch = operations.slice(i, i + 100)
      await this.container.items.bulk(batch)
    }
  }

  /**
   * Query configs with custom filter
   */
  async query(filter: string, parameters?: Array<{ name: string; value: any }>): Promise<ConfigDocument[]> {
    const query = {
      query: `SELECT * FROM c WHERE ${filter}`,
      parameters: parameters || [],
    }

    const { resources } = await this.container.items.query<ConfigDocument>(query).fetchAll()
    return resources
  }
}
