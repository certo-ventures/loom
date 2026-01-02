/**
 * Environment Configuration with Validation
 * 
 * Centralizes environment variable loading and provides fail-fast validation.
 * Use this instead of directly accessing process.env throughout the codebase.
 */

export class ConfigurationError extends Error {
  public readonly details?: {
    key?: string
    context?: Record<string, any>
    searchedPaths?: string[]
    actorType?: string
  }

  constructor(message: string, details?: ConfigurationError['details']) {
    super(message)
    this.name = 'ConfigurationError'
    this.details = details
  }
}

/**
 * Cosmos DB Configuration
 */
export interface CosmosEnvironmentConfig {
  endpoint: string
  database: string
  // Optional: specific containers
  stateContainer?: string
  traceContainer?: string
  secretsContainer?: string
  memoryContainer?: string
}

/**
 * Azure OpenAI Configuration
 */
export interface AzureOpenAIEnvironmentConfig {
  apiKey: string
  endpoint: string
  deployment: string
  model: string
  apiVersion?: string
  // Optional: embedding-specific
  embeddingDeployment?: string
}

/**
 * Redis Configuration
 */
export interface RedisEnvironmentConfig {
  host: string
  port: number
  password?: string
  db?: number
}

/**
 * Complete Environment Configuration
 */
export interface EnvironmentConfig {
  redis?: RedisEnvironmentConfig
  cosmos?: CosmosEnvironmentConfig
  azureOpenAI?: AzureOpenAIEnvironmentConfig
}

/**
 * Load Redis configuration from environment
 */
export function loadRedisConfig(): RedisEnvironmentConfig | null {
  const host = process.env.REDIS_HOST || process.env.REDIS_URL
  if (!host) return null

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB) : undefined,
  }
}

/**
 * Load Cosmos DB configuration from environment
 * @param required - If true, throws error if not configured
 */
export function loadCosmosConfig(required = false): CosmosEnvironmentConfig | null {
  const endpoint = process.env.COSMOS_ENDPOINT
  const database = process.env.COSMOS_DATABASE || process.env.COSMOS_DATABASE_ID

  if (!endpoint || !database) {
    if (required) {
      const missing = []
      if (!endpoint) missing.push('COSMOS_ENDPOINT')
      if (!database) missing.push('COSMOS_DATABASE or COSMOS_DATABASE_ID')
      throw new ConfigurationError(
        `Cosmos DB configuration required but missing: ${missing.join(', ')}`
      )
    }
    return null
  }

  return {
    endpoint,
    database,
    stateContainer: process.env.COSMOS_STATE_CONTAINER || 'actor-state',
    traceContainer: process.env.COSMOS_TRACE_CONTAINER || 'traces',
    secretsContainer: process.env.COSMOS_SECRETS_CONTAINER || 'secrets',
    memoryContainer: process.env.COSMOS_MEMORY_CONTAINER || 'memories',
  }
}

/**
 * Load Azure OpenAI configuration from environment
 * @param required - If true, throws error if not configured
 */
export function loadAzureOpenAIConfig(required = false): AzureOpenAIEnvironmentConfig | null {
  const apiKey = process.env.AZURE_OPENAI_API_KEY
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
  const model = process.env.AZURE_OPENAI_MODEL

  if (!apiKey || !endpoint || !deployment || !model) {
    if (required) {
      const missing = []
      if (!apiKey) missing.push('AZURE_OPENAI_API_KEY')
      if (!endpoint) missing.push('AZURE_OPENAI_ENDPOINT')
      if (!deployment) missing.push('AZURE_OPENAI_DEPLOYMENT')
      if (!model) missing.push('AZURE_OPENAI_MODEL')
      throw new ConfigurationError(
        `Azure OpenAI configuration required but missing: ${missing.join(', ')}`
      )
    }
    return null
  }

  return {
    apiKey,
    endpoint,
    deployment,
    model,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-04-01-preview',
    embeddingDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
  }
}

/**
 * Load all environment configuration
 * @param options - Specify which configs are required
 */
export function loadEnvironmentConfig(options?: {
  requireRedis?: boolean
  requireCosmos?: boolean
  requireAzureOpenAI?: boolean
}): EnvironmentConfig {
  return {
    redis: options?.requireRedis ? loadRedisConfig() || (() => {
      throw new ConfigurationError('Redis configuration required')
    })() : loadRedisConfig() || undefined,
    cosmos: loadCosmosConfig(options?.requireCosmos) || undefined,
    azureOpenAI: loadAzureOpenAIConfig(options?.requireAzureOpenAI) || undefined,
  }
}

/**
 * Validate that required configuration exists
 * Useful for startup checks
 */
export function validateEnvironmentConfig(config: EnvironmentConfig, requirements: {
  redis?: boolean
  cosmos?: boolean
  azureOpenAI?: boolean
}): void {
  const errors: string[] = []

  if (requirements.redis && !config.redis) {
    errors.push('Redis configuration is required but not provided')
  }

  if (requirements.cosmos && !config.cosmos) {
    errors.push('Cosmos DB configuration is required but not provided')
  }

  if (requirements.azureOpenAI && !config.azureOpenAI) {
    errors.push('Azure OpenAI configuration is required but not provided')
  }

  if (errors.length > 0) {
    throw new ConfigurationError(
      `Configuration validation failed:\n  - ${errors.join('\n  - ')}`
    )
  }
}
