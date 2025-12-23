/**
 * Config merger - combines YAML config with TypeScript defaults
 */

import type { 
  LoomConfig, 
  ActorPoolConfig, 
  MessageAdapterConfig, 
  StateAdapterConfig, 
  CoordinationAdapterConfig,
  TracingConfig,
  RedisConfig 
} from './schema'

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<LoomConfig> = {
  actorPool: {
    maxSize: 100,
    idleTimeoutMs: 300000, // 5 minutes
    evictionPolicy: 'lru',
    evictionCheckIntervalMs: 60000, // 1 minute
  },
  messageAdapter: {
    type: 'bullmq',
    queuePrefix: 'loom:queue:',
    redis: {
      host: 'localhost',
      port: 6379,
      db: 0,
      keyPrefix: 'loom:',
    },
  },
  stateAdapter: {
    type: 'redis',
    redis: {
      host: 'localhost',
      port: 6379,
      db: 0,
      keyPrefix: 'loom:',
    },
  },
  coordinationAdapter: {
    type: 'redis',
    redis: {
      host: 'localhost',
      port: 6379,
      db: 0,
      keyPrefix: 'loom:',
    },
    lockTtlMs: 30000, // 30 seconds
    renewIntervalMs: 10000, // 10 seconds
  },
  tracing: {
    enabled: true,
    storeType: 'in-memory',
    retentionMs: 86400000, // 24 hours
    cleanupIntervalMs: 3600000, // 1 hour
  },
  redis: {
    host: 'localhost',
    port: 6379,
    db: 0,
    keyPrefix: 'loom:',
  },
}

/**
 * Deep merge two objects
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target }
  
  for (const key in source) {
    const sourceValue = source[key]
    const targetValue = result[key]
    
    if (sourceValue !== undefined) {
      if (
        typeof sourceValue === 'object' && 
        sourceValue !== null && 
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(targetValue, sourceValue)
      } else {
        result[key] = sourceValue as T[Extract<keyof T, string>]
      }
    }
  }
  
  return result
}

/**
 * Merge YAML config with defaults
 * YAML values override defaults
 */
export function mergeConfig(yamlConfig: LoomConfig): Required<LoomConfig> {
  const merged = deepMerge(DEFAULT_CONFIG, yamlConfig)
  
  // Apply global Redis config to adapters if they don't have their own
  if (yamlConfig.redis) {
    if (yamlConfig.messageAdapter && !yamlConfig.messageAdapter.redis) {
      merged.messageAdapter.redis = deepMerge(DEFAULT_CONFIG.messageAdapter.redis!, yamlConfig.redis)
    }
    if (yamlConfig.stateAdapter && !yamlConfig.stateAdapter.redis) {
      merged.stateAdapter.redis = deepMerge(DEFAULT_CONFIG.stateAdapter.redis!, yamlConfig.redis)
    }
    if (yamlConfig.coordinationAdapter && !yamlConfig.coordinationAdapter.redis) {
      merged.coordinationAdapter.redis = deepMerge(DEFAULT_CONFIG.coordinationAdapter.redis!, yamlConfig.redis)
    }
  }
  
  return merged
}

/**
 * Merge multiple configs (later configs override earlier ones)
 */
export function mergeConfigs(...configs: LoomConfig[]): Required<LoomConfig> {
  let result = DEFAULT_CONFIG
  
  for (const config of configs) {
    result = mergeConfig(config)
  }
  
  return result
}

/**
 * Create config from partial values (useful for programmatic config)
 */
export function createConfig(partial: Partial<LoomConfig>): Required<LoomConfig> {
  return mergeConfig(partial as LoomConfig)
}

/**
 * Get config value by dot notation path
 */
export function getConfigValue<T = unknown>(config: Required<LoomConfig>, path: string): T | undefined {
  const keys = path.split('.')
  let current: any = config
  
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key]
    } else {
      return undefined
    }
  }
  
  return current as T
}

/**
 * Validate that required Redis config exists for selected adapters
 */
export function validateAdapterConfig(config: Required<LoomConfig>): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = []
  
  // Check message adapter
  if (config.messageAdapter.type === 'bullmq' && !config.messageAdapter.redis) {
    errors.push('BullMQ message adapter requires Redis configuration')
  }
  
  // Check state adapter
  if (config.stateAdapter.type === 'redis' && !config.stateAdapter.redis) {
    errors.push('Redis state adapter requires Redis configuration')
  }
  if (config.stateAdapter.type === 'cosmos' && !config.stateAdapter.cosmos) {
    errors.push('Cosmos state adapter requires Cosmos configuration')
  }
  
  // Check coordination adapter
  if (config.coordinationAdapter.type === 'redis' && !config.coordinationAdapter.redis) {
    errors.push('Redis coordination adapter requires Redis configuration')
  }
  if (config.coordinationAdapter.type === 'cosmos' && !config.coordinationAdapter.cosmos) {
    errors.push('Cosmos coordination adapter requires Cosmos configuration')
  }
  
  if (errors.length > 0) {
    return { valid: false, errors }
  }
  
  return { valid: true }
}
