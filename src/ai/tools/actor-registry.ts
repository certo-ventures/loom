/**
 * Actor Tool Registry - Fetch actors from registry and expose as tools
 * 
 * Enables LLMs to discover and call actors dynamically
 */

import type { Tool } from './types'
import type { ActorMetadata, ActorFilter } from '../../../packages/loom-server/src/types'
import type { DataStore } from '../../../packages/loom-server/src/registry/data-store'
import { actorsToTools, type ActorExecutor } from './actor-adapter'

export interface ActorToolRegistryOptions {
  dataStore: DataStore
  executor: ActorExecutor
  filter?: ActorFilter
  autoRefresh?: boolean
  refreshIntervalMs?: number
}

/**
 * Registry that fetches actors and exposes them as tools
 */
export class ActorToolRegistry {
  private tools: Map<string, Tool> = new Map()
  private actors: Map<string, ActorMetadata> = new Map()
  private refreshTimer?: NodeJS.Timeout

  constructor(private options: ActorToolRegistryOptions) {
    if (options.autoRefresh) {
      this.startAutoRefresh()
    }
  }

  /**
   * Load actors from registry and convert to tools
   */
  async load(): Promise<void> {
    const actors = await this.options.dataStore.listActors(this.options.filter || {})
    
    // Convert to tools
    const tools = actorsToTools(actors, this.options.executor)
    
    // Update internal maps
    this.actors.clear()
    this.tools.clear()
    
    for (const actor of actors) {
      this.actors.set(`${actor.actorId}:${actor.version}`, actor)
    }
    
    for (const tool of tools) {
      this.tools.set(tool.name, tool)
    }
  }

  /**
   * Get all actor tools
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values())
  }

  /**
   * Get actor metadata
   */
  getActorMetadata(actorId: string, version?: string): ActorMetadata | undefined {
    if (version) {
      return this.actors.get(`${actorId}:${version}`)
    }
    
    // Get latest version
    const matching = Array.from(this.actors.values())
      .filter(a => a.actorId === actorId)
      .sort((a, b) => b.version.localeCompare(a.version))
    
    return matching[0]
  }

  /**
   * Search actors by tags
   */
  getByTags(tags: string[]): Tool[] {
    return Array.from(this.tools.values()).filter(tool => {
      const actor = tool.metadata as any
      return actor.tags && tags.some(tag => actor.tags.includes(tag))
    })
  }

  /**
   * Start auto-refresh
   */
  private startAutoRefresh(): void {
    const interval = this.options.refreshIntervalMs || 60000 // 1 minute default
    
    this.refreshTimer = setInterval(async () => {
      try {
        await this.load()
      } catch (error) {
        console.error('[ActorToolRegistry] Auto-refresh failed:', error)
      }
    }, interval)
  }

  /**
   * Stop auto-refresh
   */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = undefined
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalActors: this.actors.size,
      totalTools: this.tools.size,
      actors: Array.from(this.actors.values()).map(a => ({
        actorId: a.actorId,
        version: a.version,
        displayName: a.displayName,
        tags: a.tags,
      })),
    }
  }
}
