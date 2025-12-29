/**
 * Configuration Types for Library Services
 * Implementing platforms provide these configurations
 */

import type { TokenCredential } from '@azure/identity'

/**
 * Cosmos DB configuration
 * Platform provides connection details and credentials
 */
export interface CosmosConfig {
  endpoint: string
  databaseId: string
  credential?: TokenCredential // Optional, defaults to DefaultAzureCredential
}

/**
 * Azure OpenAI configuration
 * Platform provides API access details
 */
export interface AzureOpenAIConfig {
  endpoint: string
  deploymentName: string
  credential?: TokenCredential // For managed identity
  apiKey?: string // Alternative to credential
  apiVersion?: string // Default: '2023-05-15'
}

/**
 * OpenAI configuration (non-Azure)
 */
export interface OpenAIConfig {
  apiKey: string
  model: string
}

/**
 * Embedding service configuration
 * Union of Azure and standard OpenAI
 */
export type EmbeddingConfig = 
  | { provider: 'azure-openai'; azure: AzureOpenAIConfig; dimensions: number }
  | { provider: 'openai'; openai: OpenAIConfig; dimensions: number }

/**
 * Memory service configuration
 */
export interface MemoryServiceConfig {
  cosmos: CosmosConfig & { containerId: string }
  embedding: EmbeddingConfig
  deduplicationEnabled?: boolean
  deduplicationThreshold?: number
  semanticCacheEnabled?: boolean
  semanticCacheThreshold?: number
  semanticCacheTTL?: number
}

/**
 * Dynamic configuration service configuration
 */
export interface DynamicConfigServiceConfig {
  cosmos: CosmosConfig & { containerId: string }
  cacheTTL?: number // Default 5 minutes
}
