/**
 * Memory Service Factory
 * Platform helper to create memory services from configuration
 * 
 * NOTE: This is a PLATFORM helper, not part of the core library.
 * Platforms can use this if they want, or create services directly.
 */

import { DefaultAzureCredential } from '@azure/identity'
import { SemanticMemoryService } from './semantic-memory-service.js'
import { CosmosMemoryAdapter } from './memory-adapter.js'
import type { MemoryServiceConfig } from '../config/types.js'
import type { MemoryAdapter } from './memory-adapter.js'

export interface MemoryFactoryOptions {
  config: MemoryServiceConfig
  autoInitialize?: boolean
}

export class MemoryFactory {
  /**
   * Create memory service from configuration object
   */
  static async createService(options: MemoryFactoryOptions): Promise<SemanticMemoryService> {
    const service = new SemanticMemoryService(options.config)
    
    if (options.autoInitialize !== false) {
      await service.initialize()
    }
    
    return service
  }

  /**
   * Create memory adapter from configuration object
   */
  static async createAdapter(options: MemoryFactoryOptions): Promise<MemoryAdapter> {
    const service = await this.createService(options)
    return new CosmosMemoryAdapter(service)
  }

  /**
   * Platform helper: Create service from environment variables
   * 
   * This is provided as a convenience for platforms that use environment variables.
   * Platforms are free to load configuration from any source and use the constructors directly.
   */
  static createServiceFromEnv(): SemanticMemoryService {
    const isAzureOpenAI = process.env.EMBEDDING_PROVIDER === 'azure-openai'
    
    const config: MemoryServiceConfig = {
      cosmos: {
        endpoint: process.env.COSMOS_ENDPOINT || '',
        databaseId: process.env.COSMOS_DATABASE_ID || 'loom',
        containerId: process.env.COSMOS_MEMORY_CONTAINER || 'memories',
        credential: new DefaultAzureCredential(),
      },
      embedding: isAzureOpenAI
        ? {
            provider: 'azure-openai',
            azure: {
              endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
              deploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || '',
              credential: new DefaultAzureCredential(),
              apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2023-05-15',
            },
            dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536'),
          }
        : {
            provider: 'openai',
            openai: {
              apiKey: process.env.OPENAI_API_KEY || '',
              model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
            },
            dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536'),
          },
      deduplicationEnabled: process.env.DEDUPLICATION_ENABLED !== 'false',
      deduplicationThreshold: parseFloat(process.env.DEDUPLICATION_THRESHOLD || '0.95'),
      semanticCacheEnabled: process.env.SEMANTIC_CACHE_ENABLED !== 'false',
      semanticCacheThreshold: parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD || '0.98'),
      semanticCacheTTL: parseInt(process.env.SEMANTIC_CACHE_TTL || '3600'),
    }

    return new SemanticMemoryService(config)
  }

  /**
   * Platform helper: Create adapter from environment variables
   */
  static async createAdapterFromEnv(): Promise<MemoryAdapter> {
    const service = this.createServiceFromEnv()
    await service.initialize()
    return new CosmosMemoryAdapter(service)
  }
}
