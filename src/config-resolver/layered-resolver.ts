/**
 * Layered Configuration Resolver
 * 
 * Provides multi-tier config resolution with fallback:
 * 1. Fast cache layer (Redis/In-Memory)
 * 2. Persistent store (Cosmos DB)
 * 3. Default fallback
 * 
 * Write-through caching: writes go to all layers
 * Read-through caching: reads try cache first, then persist
 */

import type { ConfigResolver, ConfigContext, ConfigValue } from './index'

export interface LayeredConfigResolverOptions {
  /** Fast cache layer (optional) */
  cacheLayer?: ConfigResolver
  
  /** Persistent storage layer */
  persistLayer: ConfigResolver
  
  /** Cache TTL in milliseconds (default: 300000 = 5 min) */
  cacheTTL?: number
}

/**
 * Layered config resolver with cache + persist
 */
export class LayeredConfigResolver implements ConfigResolver {
  private cacheLayer?: ConfigResolver
  private persistLayer: ConfigResolver
  private cacheTTL: number
  private cacheTimestamps = new Map<string, number>()

  constructor(options: LayeredConfigResolverOptions) {
    this.cacheLayer = options.cacheLayer
    this.persistLayer = options.persistLayer
    this.cacheTTL = options.cacheTTL ?? 300000 // 5 minutes
  }

  // ========================================================================
  // ConfigResolver Implementation
  // ========================================================================

  async get(keyPath: string): Promise<ConfigValue> {
    // Try cache first if available
    if (this.cacheLayer && this.isCacheFresh(keyPath)) {
      try {
        const cached = await this.cacheLayer.get(keyPath)
        if (cached !== null) {
          return cached
        }
      } catch (error) {
        // Cache miss or error, continue to persist layer
        console.warn(`Cache layer error for ${keyPath}:`, error)
      }
    }

    // Fallback to persistent layer
    const value = await this.persistLayer.get(keyPath)

    // Populate cache if we have one
    if (this.cacheLayer && value !== null) {
      try {
        await this.cacheLayer.set(keyPath, value)
        this.cacheTimestamps.set(keyPath, Date.now())
      } catch (error) {
        console.warn(`Failed to populate cache for ${keyPath}:`, error)
      }
    }

    return value
  }

  async getWithContext(key: string, context: ConfigContext): Promise<ConfigValue> {
    // Build context-aware key
    const contextKey = this.buildContextKey(key, context)

    // Try cache first if available
    if (this.cacheLayer && this.isCacheFresh(contextKey)) {
      try {
        const cached = await this.cacheLayer.getWithContext(key, context)
        if (cached !== null) {
          return cached
        }
      } catch (error) {
        // Cache miss or error, continue to persist layer
        console.warn(`Cache layer error for ${contextKey}:`, error)
      }
    }

    // Fallback to persistent layer
    const value = await this.persistLayer.getWithContext(key, context)

    // Populate cache if we have one
    if (this.cacheLayer && value !== null) {
      try {
        await this.cacheLayer.set(contextKey, value)
        this.cacheTimestamps.set(contextKey, Date.now())
      } catch (error) {
        console.warn(`Failed to populate cache for ${contextKey}:`, error)
      }
    }

    return value
  }

  async getAll(prefix: string): Promise<Record<string, ConfigValue>> {
    // Always read from persistent layer for getAll
    // (cache layer may have partial data)
    return await this.persistLayer.getAll(prefix)
  }

  async set(keyPath: string, value: ConfigValue): Promise<void> {
    // Write-through: write to both layers
    await this.persistLayer.set(keyPath, value)

    if (this.cacheLayer) {
      try {
        await this.cacheLayer.set(keyPath, value)
        this.cacheTimestamps.set(keyPath, Date.now())
      } catch (error) {
        console.warn(`Failed to update cache for ${keyPath}:`, error)
      }
    }
  }

  async delete(keyPath: string): Promise<void> {
    // Delete from both layers
    await this.persistLayer.delete(keyPath)

    if (this.cacheLayer) {
      try {
        await this.cacheLayer.delete(keyPath)
        this.cacheTimestamps.delete(keyPath)
      } catch (error) {
        console.warn(`Failed to delete from cache for ${keyPath}:`, error)
      }
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    // Always read from persistent layer for listing
    return await this.persistLayer.listKeys(prefix)
  }

  // ========================================================================
  // Cache Management
  // ========================================================================

  /**
   * Check if cached value is still fresh
   */
  private isCacheFresh(keyPath: string): boolean {
    const timestamp = this.cacheTimestamps.get(keyPath)
    if (!timestamp) {
      return false
    }
    return Date.now() - timestamp < this.cacheTTL
  }

  /**
   * Build context-aware cache key
   */
  private buildContextKey(key: string, context: ConfigContext): string {
    const parts: string[] = []
    if (context.clientId) parts.push(context.clientId)
    if (context.tenantId) parts.push(context.tenantId)
    if (context.environment) parts.push(context.environment)
    parts.push(key)
    return parts.join('/')
  }

  /**
   * Invalidate cache for specific key
   */
  async invalidateCache(keyPath: string): Promise<void> {
    this.cacheTimestamps.delete(keyPath)
    if (this.cacheLayer) {
      try {
        await this.cacheLayer.delete(keyPath)
      } catch (error) {
        console.warn(`Failed to invalidate cache for ${keyPath}:`, error)
      }
    }
  }

  /**
   * Clear all cache timestamps (force refresh on next access)
   */
  clearCacheTimestamps(): void {
    this.cacheTimestamps.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalKeys: number
    cacheTTL: number
    avgAge: number
    oldestKey?: string
  } {
    const now = Date.now()
    const timestamps = Array.from(this.cacheTimestamps.entries())
    
    const totalKeys = timestamps.length
    const avgAge = totalKeys > 0
      ? timestamps.reduce((sum, [, ts]) => sum + (now - ts), 0) / totalKeys
      : 0
    
    const oldestEntry = timestamps.length > 0
      ? timestamps.reduce((oldest, [key, ts]) => 
          ts < oldest.ts ? { key, ts } : oldest,
          { key: timestamps[0][0], ts: timestamps[0][1] }
        )
      : undefined
    
    return {
      totalKeys,
      cacheTTL: this.cacheTTL,
      avgAge,
      oldestKey: oldestEntry?.key,
    }
  }
}
