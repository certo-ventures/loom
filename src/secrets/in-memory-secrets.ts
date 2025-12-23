/**
 * In-Memory Secrets Store
 * 
 * Simple in-memory implementation for testing and development
 */

import type { SecretsClient, SecretValue, SecretProperties, SetSecretOptions } from './types'

export class InMemorySecretsClient implements SecretsClient {
  private secrets = new Map<string, Map<string, SecretValue>>()
  private available = true

  constructor(initialSecrets?: Record<string, string>) {
    if (initialSecrets) {
      for (const [name, value] of Object.entries(initialSecrets)) {
        this.setSecretSync(name, value)
      }
    }
  }

  async getSecret(name: string, version?: string): Promise<SecretValue> {
    const versions = this.secrets.get(name)
    
    if (!versions || versions.size === 0) {
      throw new Error(`Secret not found: ${name}`)
    }

    if (version) {
      const secret = versions.get(version)
      if (!secret) {
        throw new Error(`Secret version not found: ${name}@${version}`)
      }
      
      // Check if expired
      if (secret.expiresOn && secret.expiresOn < new Date()) {
        throw new Error(`Secret expired: ${name}`)
      }
      
      // Check if enabled
      if (secret.enabled === false) {
        throw new Error(`Secret disabled: ${name}`)
      }
      
      return secret
    }

    // Get latest version
    const allVersions = Array.from(versions.values())
      .filter(s => s.enabled !== false)
      .filter(s => !s.expiresOn || s.expiresOn >= new Date())
      .sort((a, b) => (b.createdOn?.getTime() || 0) - (a.createdOn?.getTime() || 0))

    if (allVersions.length === 0) {
      throw new Error(`No valid versions for secret: ${name}`)
    }

    return allVersions[0]
  }

  async setSecret(name: string, value: string, options?: SetSecretOptions): Promise<SecretValue> {
    return this.setSecretSync(name, value, options)
  }

  private setSecretSync(name: string, value: string, options?: SetSecretOptions): SecretValue {
    const now = new Date()
    const version = this.generateVersion()

    const secret: SecretValue = {
      name,
      value,
      version,
      enabled: options?.enabled ?? true,
      contentType: options?.contentType,
      expiresOn: options?.expiresOn,
      createdOn: now,
      updatedOn: now,
      tags: options?.tags || {}
    }

    if (!this.secrets.has(name)) {
      this.secrets.set(name, new Map())
    }

    this.secrets.get(name)!.set(version, secret)
    return secret
  }

  async deleteSecret(name: string): Promise<void> {
    if (!this.secrets.has(name)) {
      throw new Error(`Secret not found: ${name}`)
    }
    
    // Soft delete - mark all versions as disabled
    const versions = this.secrets.get(name)!
    for (const secret of versions.values()) {
      secret.enabled = false
    }
  }

  async listSecrets(): Promise<SecretProperties[]> {
    const properties: SecretProperties[] = []

    for (const [name, versions] of this.secrets.entries()) {
      // Get latest version (including disabled for listing)
      const latest = Array.from(versions.values())
        .sort((a, b) => (b.createdOn?.getTime() || 0) - (a.createdOn?.getTime() || 0))[0]

      if (latest) {
        properties.push({
          name,
          version: latest.version,
          enabled: latest.enabled,
          expiresOn: latest.expiresOn,
          tags: latest.tags
        })
      }
    }

    return properties
  }

  isAvailable(): boolean {
    return this.available
  }

  private generateVersion(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9)
  }

  // Helper for testing
  clear(): void {
    this.secrets.clear()
  }
}
