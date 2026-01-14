/**
 * Configuration Management
 */

import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const ConfigSchema = z.object({
  env: z.enum(['development', 'staging', 'production']).default('development'),
  port: z.coerce.number().default(8000),
  host: z.string().default('0.0.0.0'),
  
  jwt: z.object({
    secret: z.string(),
    expiresIn: z.coerce.number().default(3600)
  }),
  
  redis: z.object({
    url: z.string(),
    password: z.string().optional()
  }),
  
  postgres: z.object({
    url: z.string().optional()
  }),
  
  rateLimit: z.object({
    windowMs: z.coerce.number().default(60000),
    maxRequests: z.coerce.number().default(1000)
  }),
  
  storage: z.object({
    type: z.enum(['in-memory', 'redis', 'postgresql']).default('in-memory'),
    basePath: z.string().default('./data/executions'),
    parquetThreshold: z.coerce.number().default(102400)
  }),
  
  metrics: z.object({
    enabled: z.coerce.boolean().default(true),
    port: z.coerce.number().default(9090)
  }),
  
  logging: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    format: z.enum(['json', 'text']).default('json')
  }),
  
  multitenancy: z.object({
    enabled: z.coerce.boolean().default(true),
    defaultTenant: z.string().default('default')
  }),
  
  cors: z.object({
    origin: z.string().default('*'),
    credentials: z.coerce.boolean().default(true)
  })
})

export type Config = z.infer<typeof ConfigSchema>

export const config: Config = ConfigSchema.parse({
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT,
  host: process.env.HOST,
  
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD
  },
  
  postgres: {
    url: process.env.POSTGRES_URL
  },
  
  rateLimit: {
    windowMs: process.env.RATE_LIMIT_WINDOW_MS,
    maxRequests: process.env.RATE_LIMIT_MAX_REQUESTS
  },
  
  storage: {
    type: process.env.STORAGE_TYPE,
    basePath: process.env.STORAGE_BASE_PATH,
    parquetThreshold: process.env.PARQUET_THRESHOLD
  },
  
  metrics: {
    enabled: process.env.METRICS_ENABLED,
    port: process.env.METRICS_PORT
  },
  
  logging: {
    level: process.env.LOG_LEVEL,
    format: process.env.LOG_FORMAT
  },
  
  multitenancy: {
    enabled: process.env.MULTITENANCY_ENABLED,
    defaultTenant: process.env.DEFAULT_TENANT
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN,
    credentials: process.env.CORS_CREDENTIALS
  }
})

/**
 * Load and validate configuration
 */
export function loadConfig(): Config {
  return config
}
