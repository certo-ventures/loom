/**
 * Configuration module
 * Provides YAML-based config with Zod validation and TypeScript defaults
 */

// Core types
export type ConfigValue = string | number | boolean | null | Record<string, any> | Array<any>

export interface ConfigContext {
  actorId?: string
  environment?: string
  region?: string
  [key: string]: string | undefined
}

export interface ConfigChangeEvent {
  keyPath: string
  oldValue?: ConfigValue
  newValue?: ConfigValue
  timestamp: string
}

export interface ConfigResolver {
  get(keyPath: string): Promise<ConfigValue>
  getWithContext(key: string, context: ConfigContext): Promise<ConfigValue>
  getAll(prefix: string): Promise<Record<string, ConfigValue>>
  set(keyPath: string, value: ConfigValue): Promise<void>
  delete(keyPath: string): Promise<void>
  listKeys(prefix: string): Promise<string[]>
  onChange(callback: (event: ConfigChangeEvent) => void): () => void
}

export * from './schema.js'
export * from './loader.js'
export * from './merger.js'
export * from './types.js'
export { DynamicConfigService } from './dynamic-config.js'
export type { DynamicConfig } from './dynamic-config.js'
