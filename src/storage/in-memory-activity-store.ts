import type { ActivityStore } from './activity-store'
import type { ActivityDefinition } from '../activities/wasm-executor'

/**
 * In-memory implementation of ActivityStore
 * For testing and development - not for production!
 */
export class InMemoryActivityStore implements ActivityStore {
  private activities = new Map<string, ActivityDefinition>()

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '⚠️  [InMemoryActivityStore] Using in-memory adapter in production. ' +
        'This is not recommended for distributed systems. ' +
        'Use CosmosActivityStore instead.'
      )
    }
  }

  async save(definition: ActivityDefinition): Promise<void> {
    const key = this.makeKey(definition.name, definition.version)
    this.activities.set(key, definition)
  }

  async resolve(name: string, version?: string): Promise<ActivityDefinition> {
    // If version specified, try exact match
    if (version) {
      const key = this.makeKey(name, version)
      const definition = this.activities.get(key)
      if (!definition) {
        throw new Error(`Activity ${name}@${version} not found`)
      }
      return definition
    }

    // No version - find latest (highest version number)
    const matching = Array.from(this.activities.values())
      .filter(def => def.name === name)
      .sort((a, b) => b.version.localeCompare(a.version))

    if (matching.length === 0) {
      throw new Error(`Activity ${name} not found`)
    }

    return matching[0]
  }

  async list(): Promise<ActivityDefinition[]> {
    return Array.from(this.activities.values())
  }

  async delete(name: string, version: string): Promise<void> {
    const key = this.makeKey(name, version)
    this.activities.delete(key)
  }

  async exists(name: string, version?: string): Promise<boolean> {
    try {
      await this.resolve(name, version)
      return true
    } catch {
      return false
    }
  }

  /**
   * Clear all activities (for testing)
   */
  clear(): void {
    this.activities.clear()
  }

  private makeKey(name: string, version: string): string {
    return `${name}@${version}`
  }
}
