/**
 * In-Memory Configuration Resolver
 * 
 * Simple, fast implementation for development and testing
 * Can be used as cache layer in production
 */

import type { ConfigResolver, ConfigContext, ConfigValue, ConfigChangeEvent } from './index'
import { buildKeyPaths, validateKeyPath } from './path-resolver'

export class InMemoryConfigResolver implements ConfigResolver {
  private store: Map<string, ConfigValue>
  private changeListeners: Array<(event: ConfigChangeEvent) => void>
  
  constructor(initialConfig?: Record<string, ConfigValue>) {
    this.store = new Map()
    this.changeListeners = []
    
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '⚠️  [InMemoryConfigResolver] Using in-memory adapter in production. ' +
        'This is OK as a cache layer, but ensure persistence with CosmosConfigResolver.'
      )
    }
    
    if (initialConfig) {
      for (const [key, value] of Object.entries(initialConfig)) {
        this.store.set(key, value)
      }
    }
  }
  
  async get(keyPath: string): Promise<ConfigValue> {
    const validation = validateKeyPath(keyPath)
    if (!validation.valid) {
      throw new Error(`Invalid key path: ${validation.error}`)
    }
    
    const value = this.store.get(keyPath)
    return value ?? null
  }
  
  async getWithContext(key: string, context: ConfigContext): Promise<ConfigValue> {
    // Build hierarchical paths with fallback
    const paths = buildKeyPaths(key, context)
    
    // Try each path in order of specificity
    for (const path of paths) {
      const value = this.store.get(path)
      if (value !== undefined) {
        return value
      }
    }
    
    // Not found at any level
    return null
  }
  
  async getAll(prefix: string): Promise<Record<string, ConfigValue>> {
    const result: Record<string, ConfigValue> = {}
    
    for (const [key, value] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        result[key] = value
      }
    }
    
    return result
  }
  
  async set(keyPath: string, value: ConfigValue): Promise<void> {
    const validation = validateKeyPath(keyPath)
    if (!validation.valid) {
      throw new Error(`Invalid key path: ${validation.error}`)
    }
    
    const oldValue = this.store.get(keyPath)
    this.store.set(keyPath, value)
    
    // Emit change event
    this.emitChange({
      keyPath,
      oldValue: oldValue ?? undefined,
      newValue: value ?? undefined,
      timestamp: new Date().toISOString(),
    })
  }
  
  async delete(keyPath: string): Promise<void> {
    const oldValue = this.store.get(keyPath)
    this.store.delete(keyPath)
    
    // Emit change event
    if (oldValue !== undefined) {
      this.emitChange({
        keyPath,
        oldValue: oldValue ?? undefined,
        newValue: undefined,
        timestamp: new Date().toISOString(),
      })
    }
  }
  
  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = []
    
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key)
      }
    }
    
    return keys.sort()
  }
  
  /**
   * Subscribe to configuration changes
   */
  onChange(callback: (event: ConfigChangeEvent) => void): () => void {
    this.changeListeners.push(callback)
    
    // Return unsubscribe function
    return () => {
      const index = this.changeListeners.indexOf(callback)
      if (index > -1) {
        this.changeListeners.splice(index, 1)
      }
    }
  }
  
  private emitChange(event: ConfigChangeEvent): void {
    for (const listener of this.changeListeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('Error in config change listener:', error)
      }
    }
  }
  
  /**
   * Bulk load configuration
   */
  async bulkLoad(config: Record<string, ConfigValue>): Promise<void> {
    for (const [key, value] of Object.entries(config)) {
      await this.set(key, value)
    }
  }
  
  /**
   * Export all configuration (admin/backup)
   */
  exportAll(): Record<string, ConfigValue> {
    const result: Record<string, ConfigValue> = {}
    for (const [key, value] of this.store.entries()) {
      result[key] = value
    }
    return result
  }
  
  /**
   * Clear all configuration (admin/testing)
   */
  clear(): void {
    this.store.clear()
  }
  
  /**
   * Get configuration statistics
   */
  getStats(): {
    totalKeys: number
    totalSize: number
    keysByPrefix: Record<string, number>
  } {
    const keysByPrefix: Record<string, number> = {}
    let totalSize = 0
    
    for (const [key, value] of this.store.entries()) {
      // Count by first segment
      const prefix = key.split('/')[0]
      keysByPrefix[prefix] = (keysByPrefix[prefix] || 0) + 1
      
      // Estimate size
      totalSize += key.length + JSON.stringify(value).length
    }
    
    return {
      totalKeys: this.store.size,
      totalSize,
      keysByPrefix,
    }
  }
}
