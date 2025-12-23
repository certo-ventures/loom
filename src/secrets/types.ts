/**
 * Secrets Management Types
 * 
 * Azure Key Vault compatible secrets management for workflows
 */

export interface SecretValue {
  name: string
  value: string
  version?: string
  contentType?: string
  enabled?: boolean
  expiresOn?: Date
  createdOn?: Date
  updatedOn?: Date
  tags?: Record<string, string>
}

export interface SecretProperties {
  name: string
  version?: string
  enabled?: boolean
  expiresOn?: Date
  tags?: Record<string, string>
}

export interface SetSecretOptions {
  enabled?: boolean
  expiresOn?: Date
  contentType?: string
  tags?: Record<string, string>
}

export interface SecretsClient {
  /**
   * Get a secret by name (returns latest version if version not specified)
   */
  getSecret(name: string, version?: string): Promise<SecretValue>

  /**
   * Set or update a secret
   */
  setSecret(name: string, value: string, options?: SetSecretOptions): Promise<SecretValue>

  /**
   * Delete a secret (soft delete - recoverable)
   */
  deleteSecret(name: string): Promise<void>

  /**
   * List all secrets (returns properties only, not values)
   */
  listSecrets(): Promise<SecretProperties[]>

  /**
   * Check if client is configured and available
   */
  isAvailable(): boolean
}
