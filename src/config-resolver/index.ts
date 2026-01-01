/**
 * Configuration Resolution System
 * 
 * Hierarchical, context-aware config for all actors
 * Supports: clientId/tenantId/environment/component/key pattern
 * 
 * Philosophy: Generic, not actor-type specific
 * Works with any backend: Memory, Redis, CosmosDB, Azure App Config
 */

// Re-export everything
export { InMemoryConfigResolver } from './in-memory-resolver'
export { CosmosConfigResolver } from './cosmos-resolver'
export { LayeredConfigResolver } from './layered-resolver'
export { ConfigAdmin } from './admin'
export { buildKeyPaths, parseKeyPath, validateKeyPath } from './path-resolver'

/**
 * Configuration context for hierarchical resolution
 */
export interface ConfigContext {
  clientId?: string
  tenantId?: string
  userId?: string
  environment?: string
  region?: string
  actorId?: string
  [key: string]: string | undefined  // Extensible for custom dimensions
}

/**
 * Configuration value - can be primitive or structured
 */
export type ConfigValue = string | number | boolean | Record<string, any> | null

/**
 * Core configuration resolver interface
 * All implementations must support this
 */
export interface ConfigResolver {
  get(keyPath: string): Promise<ConfigValue>
  getWithContext(key: string, context: ConfigContext): Promise<ConfigValue>
  getAll(prefix: string): Promise<Record<string, ConfigValue>>
  set(keyPath: string, value: ConfigValue): Promise<void>
  delete(keyPath: string): Promise<void>
  listKeys(prefix: string): Promise<string[]>
}

/**
 * Configuration change event
 */
export interface ConfigChangeEvent {
  keyPath: string
  oldValue?: ConfigValue
  newValue?: ConfigValue
  timestamp: string
  changedBy?: string
}
