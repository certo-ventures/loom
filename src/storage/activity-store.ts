import type { ActivityDefinition } from '../activities/wasm-executor'

/**
 * ActivityStore - Persistent storage for activity definitions
 * 
 * Stores activity metadata (name, version, blob path, limits, capabilities)
 * in a durable store (CosmosDB). The actual WASM binaries are in Blob Storage.
 */
export interface ActivityStore {
  /**
   * Save an activity definition
   */
  save(definition: ActivityDefinition): Promise<void>

  /**
   * Resolve an activity by name and optional version
   * If version not specified, returns the latest version
   */
  resolve(name: string, version?: string): Promise<ActivityDefinition>

  /**
   * List all activity definitions
   */
  list(): Promise<ActivityDefinition[]>

  /**
   * Delete an activity definition
   */
  delete(name: string, version: string): Promise<void>

  /**
   * Check if an activity exists
   */
  exists(name: string, version?: string): Promise<boolean>
}
