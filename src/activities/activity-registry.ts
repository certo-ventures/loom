import type { ActivityDefinition } from './types'

/**
 * Activity Registry - Maps activity names to their definitions
 * 
 * Enables actors to call activities by name:
 *   await this.callActivity('email-sender', {...})
 * 
 * Registry resolves the name to the actual WASM module location, limits, etc.
 */
export class ActivityRegistry {
  private activities = new Map<string, ActivityDefinition>()

  /**
   * Register an activity definition
   */
  register(definition: ActivityDefinition): void {
    const key = this.makeKey(definition.name, definition.version)
    this.activities.set(key, definition)
  }

  /**
   * Resolve an activity by name and optional version
   * If no version specified, uses 'latest' or first available
   */
  resolve(name: string, version?: string): ActivityDefinition {
    // Try exact version first
    if (version) {
      const key = this.makeKey(name, version)
      const definition = this.activities.get(key)
      if (definition) return definition
      throw new Error(`Activity ${name}@${version} not found`)
    }

    // Try 'latest' tag
    const latestKey = this.makeKey(name, 'latest')
    const latest = this.activities.get(latestKey)
    if (latest) return latest

    // Find any version
    for (const [key, def] of this.activities) {
      if (def.name === name) return def
    }

    throw new Error(`Activity ${name} not found`)
  }

  /**
   * List all registered activities
   */
  list(): ActivityDefinition[] {
    return Array.from(this.activities.values())
  }

  /**
   * Check if an activity exists
   */
  has(name: string, version?: string): boolean {
    if (version) {
      return this.activities.has(this.makeKey(name, version))
    }
    
    // Check if any version exists
    for (const def of this.activities.values()) {
      if (def.name === name) return true
    }
    return false
  }

  /**
   * Unregister an activity
   */
  unregister(name: string, version: string): boolean {
    return this.activities.delete(this.makeKey(name, version))
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.activities.clear()
  }

  private makeKey(name: string, version: string): string {
    return `${name}@${version}`
  }
}
