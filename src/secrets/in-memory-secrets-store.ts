/**
 * In-Memory Secrets Store
 * 
 * Simple in-memory implementation for testing and development
 * Uses the unified SecretsStore interface
 */

import type { SecretsStore, Secret } from './types'

export class InMemorySecretsStore implements SecretsStore {
  private secrets = new Map<string, Secret>()

  async getSecret(key: string): Promise<Secret | null> {
    const secret = this.secrets.get(key)
    
    if (!secret) {
      return null
    }

    // Check expiration
    if (secret.expiresAt && new Date(secret.expiresAt) < new Date()) {
      this.secrets.delete(key) // Cleanup expired
      return null
    }

    return secret
  }

  async setSecret(secret: Secret): Promise<void> {
    this.secrets.set(secret.key, { ...secret })
  }

  async deleteSecret(key: string): Promise<void> {
    this.secrets.delete(key)
  }

  async listSecrets(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.secrets.keys())
    
    if (!prefix) {
      return keys
    }

    return keys.filter(key => key.startsWith(prefix))
  }

  /**
   * Clear all secrets (useful for testing)
   */
  clear(): void {
    this.secrets.clear()
  }
}
