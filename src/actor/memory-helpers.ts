/**
 * Memory Helper Methods for Actors
 * Opt-in composable memory functionality
 */

import type { MemoryAdapter, MemoryItem } from '../memory'

export interface MemoryContext {
  tenantId: string
  userId?: string
  actorType: string
  actorId: string
  threadId: string
  runId?: string
  metadata?: Record<string, any>
}

export interface MemoryHelpers {
  /**
   * Store actor output as memory
   */
  remember(
    memory: Partial<MemoryItem>,
    options?: {
      importance?: 'low' | 'medium' | 'high' | 'critical'
      ttl?: number
      category?: string
    }
  ): Promise<string | null>

  /**
   * Search for relevant memories
   */
  recall(
    query: string,
    options?: {
      limit?: number
      category?: string
      threadId?: string
    }
  ): Promise<MemoryItem[]>

  /**
   * Check semantic cache before LLM call
   */
  checkCache(
    query: string,
    options?: {
      threshold?: number
      maxAge?: number
    }
  ): Promise<any | null>

  /**
   * Store result in semantic cache
   */
  cache(
    query: string,
    response: any,
    options?: {
      ttl?: number
      metadata?: Record<string, any>
    }
  ): Promise<string | null>

  /**
   * Get recent memories for current thread
   */
  getRecentMemories(limit?: number): Promise<MemoryItem[]>
}

/**
 * Creates memory helper methods for an actor
 * Returns null methods if memory is not configured
 */
export function createMemoryHelpers(
  adapter: MemoryAdapter | undefined,
  context: MemoryContext,
  config?: {
    storageEnabled?: boolean
    recallEnabled?: boolean
    cacheEnabled?: boolean
  }
): MemoryHelpers {
  const storageEnabled = config?.storageEnabled ?? true
  const recallEnabled = config?.recallEnabled ?? true
  const cacheEnabled = config?.cacheEnabled ?? true

  return {
    async remember(memory, options = {}) {
      if (!adapter || !storageEnabled) return null

      try {
        const turnIndex = Date.now() // Simple monotonic counter
        const importance = options.importance || 'medium'
        
        return await adapter.addMemory({
          tenantId: context.tenantId,
          threadId: context.threadId,
          turnIndex,
          memory: memory.memory!,
          content: memory.content || memory.memory!,
          memoryType: importance === 'critical' ? 'long-term' : 'short-term',
          category: options.category,
          ttl: options.ttl,
          metadata: {
            actorType: context.actorType,
            actorId: context.actorId,
            sourceActor: context.actorId,
            runId: context.runId,
            ...context.metadata,
            ...memory.metadata,
          },
        })
      } catch (error) {
        console.error('Memory storage failed:', error)
        return null
      }
    },

    async recall(query, options = {}) {
      if (!adapter || !recallEnabled) return []

      try {
        return await adapter.searchMemories(query, {
          tenantId: context.tenantId,
          threadId: options.threadId || context.threadId,
          category: options.category,
          limit: options.limit || 5,
        })
      } catch (error) {
        console.error('Memory recall failed:', error)
        return []
      }
    },

    async checkCache(query, options = {}) {
      if (!adapter || !cacheEnabled) return null

      try {
        const cached = await adapter.checkSemanticCache(
          query,
          context.tenantId,
          options
        )
        return cached?.response || null
      } catch (error) {
        console.error('Cache check failed:', error)
        return null
      }
    },

    async cache(query, response, options = {}) {
      if (!adapter || !cacheEnabled) return null

      try {
        return await adapter.addToCache(query, response, context.tenantId, {
          ttl: options.ttl,
          metadata: {
            actorType: context.actorType,
            actorId: context.actorId,
            ...options.metadata,
          },
        })
      } catch (error) {
        console.error('Cache storage failed:', error)
        return null
      }
    },

    async getRecentMemories(limit = 10) {
      if (!adapter || !recallEnabled) return []

      try {
        return await adapter.getRecentMemories(
          context.tenantId,
          context.threadId,
          limit
        )
      } catch (error) {
        console.error('Recent memories failed:', error)
        return []
      }
    },
  }
}
