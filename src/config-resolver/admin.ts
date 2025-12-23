/**
 * Configuration Administration Interface
 * 
 * Tools for managing configuration at runtime
 * Supports bulk operations, import/export, validation
 */

import type { ConfigResolver, ConfigContext, ConfigValue } from './index'
import { validateKeyPath } from './path-resolver'

/**
 * Configuration administrator for managing config at scale
 */
export class ConfigAdmin {
  constructor(private resolver: ConfigResolver) {}
  
  /**
   * Set multiple configuration values in bulk
   */
  async bulkSet(configs: Array<{ keyPath: string; value: ConfigValue }>): Promise<{
    success: number
    failed: Array<{ keyPath: string; error: string }>
  }> {
    const results = {
      success: 0,
      failed: [] as Array<{ keyPath: string; error: string }>,
    }
    
    for (const { keyPath, value } of configs) {
      try {
        await this.resolver.set(keyPath, value)
        results.success++
      } catch (error) {
        results.failed.push({
          keyPath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    
    return results
  }
  
  /**
   * Import configuration from JSON object
   * Keys can be flat or nested
   */
  async importConfig(
    config: Record<string, any>,
    options: {
      prefix?: string          // Add prefix to all keys
      overwrite?: boolean      // Overwrite existing values
      validate?: boolean       // Validate before importing
    } = {}
  ): Promise<{
    imported: number
    skipped: number
    errors: string[]
  }> {
    const { prefix = '', overwrite = true, validate = true } = options
    const results = {
      imported: 0,
      skipped: 0,
      errors: [] as string[],
    }
    
    const flattenConfig = (obj: any, parentKey = ''): Record<string, ConfigValue> => {
      const flat: Record<string, ConfigValue> = {}
      
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = parentKey ? `${parentKey}/${key}` : key
        
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          // Recurse for nested objects
          Object.assign(flat, flattenConfig(value, fullKey))
        } else {
          flat[fullKey] = value as ConfigValue
        }
      }
      
      return flat
    }
    
    const flatConfig = flattenConfig(config)
    
    for (const [key, value] of Object.entries(flatConfig)) {
      const fullKey = prefix ? `${prefix}/${key}` : key
      
      // Validate key
      if (validate) {
        const validation = validateKeyPath(fullKey)
        if (!validation.valid) {
          results.errors.push(`Invalid key "${fullKey}": ${validation.error}`)
          results.skipped++
          continue
        }
      }
      
      // Check if exists
      if (!overwrite) {
        const existing = await this.resolver.get(fullKey)
        if (existing !== null) {
          results.skipped++
          continue
        }
      }
      
      // Set value
      try {
        await this.resolver.set(fullKey, value)
        results.imported++
      } catch (error) {
        results.errors.push(`Failed to set "${fullKey}": ${error}`)
        results.skipped++
      }
    }
    
    return results
  }
  
  /**
   * Export configuration matching prefix
   * Returns hierarchical structure
   */
  async exportConfig(prefix: string = ''): Promise<Record<string, any>> {
    const all = await this.resolver.getAll(prefix)
    
    // Build nested structure
    const nested: Record<string, any> = {}
    
    for (const [key, value] of Object.entries(all)) {
      const parts = key.split('/')
      let current = nested
      
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]
        if (!current[part]) {
          current[part] = {}
        }
        current = current[part]
      }
      
      current[parts[parts.length - 1]] = value
    }
    
    return nested
  }
  
  /**
   * Copy configuration from one prefix to another
   */
  async copyConfig(
    sourcePrefix: string,
    targetPrefix: string,
    options: {
      overwrite?: boolean
    } = {}
  ): Promise<{ copied: number; skipped: number }> {
    const { overwrite = false } = options
    const source = await this.resolver.getAll(sourcePrefix)
    
    let copied = 0
    let skipped = 0
    
    for (const [key, value] of Object.entries(source)) {
      // Remove source prefix and add target prefix
      const relativePath = key.substring(sourcePrefix.length).replace(/^\//, '')
      const targetKey = targetPrefix ? `${targetPrefix}/${relativePath}` : relativePath
      
      // Check if target exists
      if (!overwrite) {
        const existing = await this.resolver.get(targetKey)
        if (existing !== null) {
          skipped++
          continue
        }
      }
      
      await this.resolver.set(targetKey, value)
      copied++
    }
    
    return { copied, skipped }
  }
  
  /**
   * Delete all configuration matching prefix
   */
  async deletePrefix(prefix: string): Promise<{ deleted: number }> {
    const keys = await this.resolver.listKeys(prefix)
    
    for (const key of keys) {
      await this.resolver.delete(key)
    }
    
    return { deleted: keys.length }
  }
  
  /**
   * List all configuration paths matching pattern
   */
  async listPaths(options: {
    prefix?: string
    includeValues?: boolean
  } = {}): Promise<Array<{ path: string; value?: ConfigValue }>> {
    const { prefix = '', includeValues = false } = options
    const keys = await this.resolver.listKeys(prefix)
    
    if (includeValues) {
      const results = await Promise.all(
        keys.map(async (path) => ({
          path,
          value: await this.resolver.get(path),
        }))
      )
      return results
    }
    
    return keys.map(path => ({ path }))
  }
  
  /**
   * Validate configuration structure
   */
  async validateStructure(requiredPaths: string[]): Promise<{
    valid: boolean
    missing: string[]
    present: string[]
  }> {
    const missing: string[] = []
    const present: string[] = []
    
    for (const path of requiredPaths) {
      const value = await this.resolver.get(path)
      if (value === null) {
        missing.push(path)
      } else {
        present.push(path)
      }
    }
    
    return {
      valid: missing.length === 0,
      missing,
      present,
    }
  }
}
