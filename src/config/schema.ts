/**
 * Zod schemas for Loom runtime configuration
 * Validates YAML config files
 */

import { z } from 'zod'

/**
 * Redis connection configuration
 */
export const RedisConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().int().positive().default(6379),
  password: z.string().optional(),
  db: z.number().int().min(0).default(0),
  keyPrefix: z.string().default('loom:'),
})

export type RedisConfig = z.infer<typeof RedisConfigSchema>

/**
 * Actor pool configuration
 */
export const ActorPoolConfigSchema = z.object({
  maxSize: z.number().int().positive().default(100),
  idleTimeoutMs: z.number().int().positive().default(300000), // 5 minutes
  evictionPolicy: z.enum(['lru', 'lfu', 'fifo']).default('lru'),
  evictionCheckIntervalMs: z.number().int().positive().default(60000), // 1 minute
})

export type ActorPoolConfig = z.infer<typeof ActorPoolConfigSchema>

/**
 * Message adapter configuration
 */
export const MessageAdapterConfigSchema = z.object({
  type: z.enum(['bullmq', 'redis-pubsub', 'in-memory']).default('bullmq'),
  redis: RedisConfigSchema.optional(),
  queuePrefix: z.string().default('loom:queue:'),
})

export type MessageAdapterConfig = z.infer<typeof MessageAdapterConfigSchema>

/**
 * State adapter configuration
 */
export const StateAdapterConfigSchema = z.object({
  type: z.enum(['redis', 'cosmos', 'in-memory']).default('redis'),
  redis: RedisConfigSchema.optional(),
  cosmos: z.object({
    endpoint: z.string(),
    database: z.string(),
    container: z.string(),
  }).optional(),
})

export type StateAdapterConfig = z.infer<typeof StateAdapterConfigSchema>

/**
 * Coordination adapter configuration
 */
export const CoordinationAdapterConfigSchema = z.object({
  type: z.enum(['redis', 'cosmos', 'in-memory']).default('redis'),
  redis: RedisConfigSchema.optional(),
  cosmos: z.object({
    endpoint: z.string(),
    database: z.string(),
    container: z.string(),
  }).optional(),
  lockTtlMs: z.number().int().positive().default(30000), // 30 seconds
  renewIntervalMs: z.number().int().positive().default(10000), // 10 seconds
})

export type CoordinationAdapterConfig = z.infer<typeof CoordinationAdapterConfigSchema>

/**
 * Tracing configuration
 */
export const TracingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  storeType: z.enum(['in-memory', 'redis', 'cosmos']).default('in-memory'),
  retentionMs: z.number().int().positive().default(86400000), // 24 hours
  cleanupIntervalMs: z.number().int().positive().default(3600000), // 1 hour
})

export type TracingConfig = z.infer<typeof TracingConfigSchema>

/**
 * Complete Loom runtime configuration
 */
export const LoomConfigSchema = z.object({
  actorPool: ActorPoolConfigSchema.optional(),
  messageAdapter: MessageAdapterConfigSchema.optional(),
  stateAdapter: StateAdapterConfigSchema.optional(),
  coordinationAdapter: CoordinationAdapterConfigSchema.optional(),
  tracing: TracingConfigSchema.optional(),
  redis: RedisConfigSchema.optional(), // Global Redis config
})

export type LoomConfig = z.infer<typeof LoomConfigSchema>

/**
 * Validate and parse config with defaults
 */
export function validateConfig(config: unknown): LoomConfig {
  return LoomConfigSchema.parse(config)
}

/**
 * Validate config with detailed error messages
 */
export function validateConfigSafe(config: unknown): { success: true; data: LoomConfig } | { success: false; errors: string[] } {
  const result = LoomConfigSchema.safeParse(config)
  
  if (result.success) {
    return { success: true, data: result.data }
  }
  
  const errors = result.error.issues.map(err => {
    const path = err.path.join('.')
    return `${path}: ${err.message}`
  })
  
  return { success: false, errors }
}
