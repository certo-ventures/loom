/**
 * Config Service - Wraps ConfigResolver
 */

import { ConfigResolver, ConfigContext, ConfigValue } from '@certo-ventures/loom'
import { logger } from '../utils/logger'

export class ConfigService {
  constructor(private resolver: ConfigResolver) {}
  
  async get(keyPath: string, tenantId: string): Promise<ConfigValue> {
    logger.debug('Getting config', { keyPath, tenantId })
    return await this.resolver.get(keyPath)
  }
  
  async set(keyPath: string, value: ConfigValue, tenantId: string): Promise<void> {
    logger.info('Setting config', { keyPath, tenantId })
    await this.resolver.set(keyPath, value)
  }
  
  async delete(keyPath: string, tenantId: string): Promise<void> {
    logger.info('Deleting config', { keyPath, tenantId })
    await this.resolver.delete(keyPath)
  }
  
  async listKeys(prefix: string, tenantId: string): Promise<string[]> {
    return await this.resolver.listKeys(prefix)
  }
  
  async resolveWithContext(key: string, context: ConfigContext, tenantId: string): Promise<ConfigValue> {
    logger.debug('Resolving config with context', { key, context, tenantId })
    return await this.resolver.getWithContext(key, {
      ...context,
      tenantId
    })
  }
  
  async importConfig(config: Record<string, ConfigValue>, tenantId: string): Promise<void> {
    logger.info('Importing config', { keys: Object.keys(config).length, tenantId })
    
    for (const [key, value] of Object.entries(config)) {
      await this.resolver.set(key, value)
    }
  }
  
  async exportConfig(prefix: string, tenantId: string): Promise<Record<string, ConfigValue>> {
    logger.info('Exporting config', { prefix, tenantId })
    
    const keys = await this.resolver.listKeys(prefix)
    const result: Record<string, ConfigValue> = {}
    
    for (const key of keys) {
      result[key] = await this.resolver.get(key)
    }
    
    return result
  }
  
  async validateStructure(requiredKeys: string[], tenantId: string): Promise<{
    valid: boolean
    missing: string[]
  }> {
    const missing: string[] = []
    
    for (const key of requiredKeys) {
      const value = await this.resolver.get(key)
      if (value === null) {
        missing.push(key)
      }
    }
    
    return {
      valid: missing.length === 0,
      missing
    }
  }
}
