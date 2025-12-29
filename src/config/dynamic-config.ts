/**
 * Dynamic Configuration Service
 * Loads tenant/actor-specific configuration from Cosmos DB
 */

import { CosmosClient, Container } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import type { DynamicConfigServiceConfig } from './types.js'

export interface DynamicConfig {
  // Core identifiers
  id: string
  tenantId: string
  actorType?: string // If set, applies only to this actor type
  
  // Memory configuration
  memory?: {
    enabled: boolean
    deduplicationEnabled?: boolean
    deduplicationThreshold?: number
    semanticCacheEnabled?: boolean
    semanticCacheThreshold?: number
    semanticCacheTTL?: number
  }
  
  // LLM configuration
  llm?: {
    provider: string
    model: string
    temperature?: number
    maxTokens?: number
  }
  
  // Custom actor settings
  settings?: Record<string, any>
  
  // Metadata
  createdAt: string
  updatedAt?: string
  priority: number // Higher priority overrides lower
}

export class DynamicConfigService {
  private container!: Container
  private cache = new Map<string, { config: DynamicConfig; expiresAt: number }>()
  private cacheTTL: number

  constructor(private config: DynamicConfigServiceConfig) {
    this.cacheTTL = config.cacheTTL || 300000 // 5 minutes
  }

  async initialize(): Promise<void> {
    const credential = this.config.cosmos.credential || new DefaultAzureCredential()
    
    const client = new CosmosClient({
      endpoint: this.config.cosmos.endpoint,
      aadCredentials: credential,
    })

    const { database } = await client.databases.createIfNotExists({
      id: this.config.cosmos.databaseId,
    })

    const { container } = await database.containers.createIfNotExists({
      id: this.config.cosmos.containerId,
      partitionKey: { paths: ['/tenantId'] },
    })

    this.container = container
  }

  /**
   * Get configuration for specific tenant and actor type
   * Applies priority-based merging
   */
  async getConfig(tenantId: string, actorType?: string): Promise<DynamicConfig> {
    const cacheKey = `${tenantId}:${actorType || 'default'}`
    const cached = this.cache.get(cacheKey)
    
    if (cached && cached.expiresAt > Date.now()) {
      return cached.config
    }

    // Load configurations (tenant-level and actor-specific)
    const configs = await this.loadConfigs(tenantId, actorType)
    
    // Merge by priority (higher priority wins)
    const merged = this.mergeConfigs(configs)
    
    // Cache result
    this.cache.set(cacheKey, {
      config: merged,
      expiresAt: Date.now() + this.cacheTTL,
    })
    
    return merged
  }

  private async loadConfigs(tenantId: string, actorType?: string): Promise<DynamicConfig[]> {
    const query = actorType
      ? `SELECT * FROM c WHERE c.tenantId = @tenantId AND (c.actorType = @actorType OR c.actorType = null) ORDER BY c.priority DESC`
      : `SELECT * FROM c WHERE c.tenantId = @tenantId AND c.actorType = null ORDER BY c.priority DESC`

    const parameters = [{ name: '@tenantId', value: tenantId }]
    if (actorType) {
      parameters.push({ name: '@actorType', value: actorType })
    }

    const { resources } = await this.container.items
      .query({ query, parameters })
      .fetchAll()

    return resources as DynamicConfig[]
  }

  private mergeConfigs(configs: DynamicConfig[]): DynamicConfig {
    if (configs.length === 0) {
      return this.getDefaultConfig()
    }

    // Start with default
    const merged: DynamicConfig = this.getDefaultConfig()
    
    // Apply configs in order (already sorted by priority DESC)
    for (const config of configs.reverse()) {
      if (config.memory) {
        merged.memory = { ...merged.memory, ...config.memory }
      }
      if (config.llm) {
        merged.llm = { ...merged.llm, ...config.llm }
      }
      if (config.settings) {
        merged.settings = { ...merged.settings, ...config.settings }
      }
    }
    
    return merged
  }

  private getDefaultConfig(): DynamicConfig {
    return {
      id: 'default',
      tenantId: 'default',
      memory: {
        enabled: false,
        deduplicationEnabled: true,
        deduplicationThreshold: 0.95,
        semanticCacheEnabled: true,
        semanticCacheThreshold: 0.98,
        semanticCacheTTL: 3600,
      },
      settings: {},
      createdAt: new Date().toISOString(),
      priority: 0,
    }
  }

  async saveConfig(config: Partial<DynamicConfig> & { tenantId: string }): Promise<void> {
    const id = config.id || `config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    const item: DynamicConfig = {
      id,
      tenantId: config.tenantId,
      actorType: config.actorType,
      memory: config.memory,
      llm: config.llm,
      settings: config.settings,
      createdAt: config.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      priority: config.priority || 100,
    }

    await this.container.items.upsert(item)
    
    // Invalidate cache
    const cacheKey = `${config.tenantId}:${config.actorType || 'default'}`
    this.cache.delete(cacheKey)
  }

  /**
   * Clear cache for tenant/actor
   */
  invalidateCache(tenantId: string, actorType?: string): void {
    const cacheKey = `${tenantId}:${actorType || 'default'}`
    this.cache.delete(cacheKey)
  }

  /**
   * Clear all cached configs
   */
  clearCache(): void {
    this.cache.clear()
  }
}
