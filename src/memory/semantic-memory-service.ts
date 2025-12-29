/**
 * Semantic Memory Service
 * Core memory storage with vector search capabilities
 */

import { createHash } from 'crypto'
import { CosmosClient, Container } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import type { MemoryItem, SearchOptions, AddMemoryOptions, CachedResult } from './types.js'
import type { MemoryServiceConfig } from '../config/types.js'
import { EmbeddingService } from './embedding-service.js'

export class SemanticMemoryService {
  private container!: Container
  private embeddings: EmbeddingService

  constructor(private config: MemoryServiceConfig) {
    this.embeddings = new EmbeddingService(config.embedding)
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

    const embeddingDimensions = this.config.embedding.dimensions

    const { container } = await database.containers.createIfNotExists({
      id: this.config.cosmos.containerId,
      partitionKey: {
        paths: ['/tenantId', '/threadId'],
        kind: 'MultiHash' as any,
      },
      vectorEmbeddingPolicy: {
        vectorEmbeddings: [{
          path: '/embedding',
          dataType: 'float32' as any,
          dimensions: embeddingDimensions,
          distanceFunction: 'cosine' as any,
        }],
      },
      indexingPolicy: {
        automatic: true,
        vectorIndexes: [{
          path: '/embedding',
          type: 'quantizedFlat' as any,
        }],
      },
    })

    this.container = container
  }

  async add(memory: Partial<MemoryItem>, options: AddMemoryOptions = {}): Promise<string> {
    const id = memory.id || `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Generate embedding if not provided
    let embedding = memory.embedding
    if (!embedding && !options.skipEmbedding) {
      const textToEmbed = memory.content || memory.memory || ''
      embedding = await this.embeddings.embed(textToEmbed)
    }

    // Generate content hash for exact deduplication
    const content = memory.content || memory.memory || ''
    const hash = createHash('sha256').update(content).digest('hex')

    // Check for duplicates if deduplication is enabled
    const deduplicationEnabled = this.config.deduplicationEnabled ?? true
    if (deduplicationEnabled && !options.skipDeduplication && embedding) {
      const threshold = options.deduplicationThreshold || this.config.deduplicationThreshold || 0.95
      const similar = await this.findSimilar(embedding, threshold, {
        tenantId: memory.tenantId!,
        threadId: memory.threadId,
        category: memory.category,
      })

      if (similar.length > 0) {
        // Found similar memory - merge instead of creating new
        const existing = similar[0]
        await this.update(existing.id, memory.tenantId!, memory.threadId!, {
          memory: `${existing.memory}\n\nAdditional case: ${memory.memory}`,
          metadata: {
            ...existing.metadata,
            occurrences: (existing.metadata?.occurrences || 1) + 1,
            lastUpdated: new Date().toISOString(),
          },
        })
        return existing.id
      }
    }

    const item: MemoryItem = {
      id,
      tenantId: memory.tenantId!,
      threadId: memory.threadId!,
      turnIndex: memory.turnIndex ?? 0,
      memory: memory.memory!,
      content,
      embedding: embedding || [],
      timestamp: memory.timestamp || new Date().toISOString(),
      memoryType: memory.memoryType || 'long-term',
      category: memory.category,
      ttl: memory.ttl,
      metadata: {
        ...memory.metadata,
        hash,
        occurrences: 1,
      },
    }

    await this.container.items.create(item)
    return id
  }

  async get(memoryId: string, tenantId: string, threadId: string): Promise<MemoryItem | null> {
    try {
      const { resource } = await this.container.item(memoryId, [tenantId, threadId]).read<MemoryItem>()
      return resource || null
    } catch (error: any) {
      if (error.code === 404) return null
      throw error
    }
  }

  async search(query: string, options: SearchOptions): Promise<MemoryItem[]> {
    // Generate embedding for query
    const queryEmbedding = await this.embeddings.embed(query)
    
    // Build vector search query
    const limit = options.limit || 10
    let sqlQuery = `
      SELECT TOP @limit 
        c.id, c.tenantId, c.threadId, c.turnIndex,
        c.memory, c.content, c.timestamp, c.memoryType,
        c.category, c.metadata,
        VectorDistance(c.embedding, @queryVector) AS distance
      FROM c
      WHERE c.tenantId = @tenantId
    `
    
    const parameters = [
      { name: '@limit', value: limit },
      { name: '@queryVector', value: queryEmbedding },
      { name: '@tenantId', value: options.tenantId },
    ]

    if (options.threadId) {
      sqlQuery += ' AND c.threadId = @threadId'
      parameters.push({ name: '@threadId', value: options.threadId })
    }

    if (options.category) {
      sqlQuery += ' AND c.category = @category'
      parameters.push({ name: '@category', value: options.category })
    }

    sqlQuery += ' ORDER BY VectorDistance(c.embedding, @queryVector)'

    const { resources } = await this.container.items
      .query({ query: sqlQuery, parameters })
      .fetchAll()

    return resources as any[]
  }

  async getRecentMemories(
    tenantId: string,
    threadId: string,
    limit: number = 10
  ): Promise<MemoryItem[]> {
    const { resources } = await this.container.items
      .query({
        query: `
          SELECT TOP @limit *
          FROM c
          WHERE c.tenantId = @tenantId AND c.threadId = @threadId
          ORDER BY c.turnIndex DESC
        `,
        parameters: [
          { name: '@limit', value: limit },
          { name: '@tenantId', value: tenantId },
          { name: '@threadId', value: threadId },
        ],
      })
      .fetchAll()

    return resources as MemoryItem[]
  }

  async findSimilar(
    embedding: number[],
    threshold: number,
    filters?: {
      tenantId?: string
      threadId?: string
      category?: string
    }
  ): Promise<MemoryItem[]> {
    // Vector distance < threshold means similarity > (1 - threshold)
    const maxDistance = 1 - threshold

    let sqlQuery = `
      SELECT TOP 5
        c.id, c.tenantId, c.threadId, c.turnIndex,
        c.memory, c.content, c.timestamp, c.memoryType,
        c.category, c.metadata,
        VectorDistance(c.embedding, @queryVector) AS distance
      FROM c
      WHERE VectorDistance(c.embedding, @queryVector) < @maxDistance
    `

    const parameters = [
      { name: '@queryVector', value: embedding },
      { name: '@maxDistance', value: maxDistance },
    ]

    if (filters?.tenantId) {
      sqlQuery += ' AND c.tenantId = @tenantId'
      parameters.push({ name: '@tenantId', value: filters.tenantId as any })
    }

    if (filters?.threadId) {
      sqlQuery += ' AND c.threadId = @threadId'
      parameters.push({ name: '@threadId', value: filters.threadId as any })
    }

    if (filters?.category) {
      sqlQuery += ' AND c.category = @category'
      parameters.push({ name: '@category', value: filters.category as any })
    }

    sqlQuery += ' ORDER BY VectorDistance(c.embedding, @queryVector)'

    const { resources } = await this.container.items
      .query({ query: sqlQuery, parameters })
      .fetchAll()

    return resources as any[]
  }

  async update(
    memoryId: string,
    tenantId: string,
    threadId: string,
    updates: Partial<MemoryItem>
  ): Promise<void> {
    const { resource: existing } = await this.container
      .item(memoryId, [tenantId, threadId])
      .read<MemoryItem>()

    if (!existing) {
      throw new Error(`Memory ${memoryId} not found`)
    }

    const updated = {
      ...existing,
      ...updates,
      id: existing.id, // Ensure ID doesn't change
      tenantId: existing.tenantId,
      threadId: existing.threadId,
    }

    await this.container.item(memoryId, [tenantId, threadId]).replace(updated)
  }

  async delete(
    memoryId: string,
    tenantId: string,
    threadId: string
  ): Promise<void> {
    await this.container.item(memoryId, [tenantId, threadId]).delete()
  }

  async checkSemanticCache(
    query: string,
    tenantId: string,
    options?: {
      threshold?: number
      maxAge?: number
    }
  ): Promise<CachedResult | null> {
    const cacheEnabled = this.config.semanticCacheEnabled ?? true
    if (!cacheEnabled) return null

    // Generate embedding for query
    const queryEmbedding = await this.embeddings.embed(query)
    
    // Use configured threshold or provided threshold
    const threshold = options?.threshold || this.config.semanticCacheThreshold || 0.98
    const maxDistance = 1 - threshold

    // Search for cached results with high similarity
    const { resources } = await this.container.items
      .query({
        query: `
          SELECT TOP 1
            c.id, c.memory, c.timestamp, c.metadata,
            VectorDistance(c.embedding, @queryVector) AS distance
          FROM c
          WHERE c.tenantId = @tenantId
            AND c.memoryType = 'semantic-cache'
            AND VectorDistance(c.embedding, @queryVector) < @maxDistance
          ORDER BY VectorDistance(c.embedding, @queryVector)
        `,
        parameters: [
          { name: '@tenantId', value: tenantId },
          { name: '@queryVector', value: queryEmbedding },
          { name: '@maxDistance', value: maxDistance },
        ],
      })
      .fetchAll()

    if (resources.length === 0) return null

    const cached = resources[0]
    const age = Date.now() - new Date(cached.timestamp).getTime()
    
    // Check if cache is too old (if maxAge specified)
    if (options?.maxAge && age > options.maxAge * 1000) {
      return null
    }

    try {
      const response = JSON.parse(cached.memory)
      return {
        id: cached.id,
        query: cached.metadata?.query || query,
        response,
        timestamp: cached.timestamp,
        age: Math.floor(age / 1000), // seconds
        metadata: cached.metadata,
      }
    } catch {
      return null
    }
  }

  async addToCache(
    query: string,
    response: any,
    tenantId: string,
    options?: {
      ttl?: number
      metadata?: Record<string, any>
    }
  ): Promise<string> {
    const cacheEnabled = this.config.semanticCacheEnabled ?? true
    if (!cacheEnabled) {
      throw new Error('Semantic cache is disabled')
    }

    const ttl = options?.ttl || this.config.semanticCacheTTL || 3600

    return this.add(
      {
        tenantId,
        threadId: `cache-${createHash('sha256').update(query).digest('hex').substring(0, 16)}`,
        turnIndex: 0,
        memory: JSON.stringify(response),
        content: query,
        memoryType: 'semantic-cache',
        ttl,
        metadata: {
          query,
          cachedAt: new Date().toISOString(),
          ...options?.metadata,
        },
      },
      {
        skipDeduplication: true, // Don't deduplicate cache entries
      }
    )
  }
}
