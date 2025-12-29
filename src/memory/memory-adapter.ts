/**
 * Memory Adapter Implementation
 * Wraps SemanticMemoryService for standardized interface
 */

import { SemanticMemoryService } from './semantic-memory-service'
import type { MemoryItem, SearchOptions, AddMemoryOptions, CachedResult } from './types'

export interface MemoryAdapter {
  // Core operations
  addMemory(memory: Partial<MemoryItem>, options?: AddMemoryOptions): Promise<string>
  searchMemories(query: string, options: SearchOptions): Promise<MemoryItem[]>
  getMemory(memoryId: string, tenantId: string, threadId: string): Promise<MemoryItem | null>
  updateMemory(memoryId: string, tenantId: string, threadId: string, updates: Partial<MemoryItem>): Promise<void>
  deleteMemory(memoryId: string, tenantId: string, threadId: string): Promise<void>
  
  // Semantic operations
  findSimilarMemories(embedding: number[], threshold: number, filters: { tenantId: string; threadId?: string; category?: string }): Promise<MemoryItem[]>
  checkSemanticCache(query: string, tenantId: string, options?: { threshold?: number; maxAge?: number }): Promise<CachedResult | null>
  addToCache(query: string, response: any, tenantId: string, options?: { ttl?: number; metadata?: Record<string, any> }): Promise<string>
  
  // Batch operations
  addMemoriesBatch(memories: Partial<MemoryItem>[]): Promise<string[]>
  
  // Recent memories
  getRecentMemories(tenantId: string, threadId: string, limit?: number): Promise<MemoryItem[]>
}

export class CosmosMemoryAdapter implements MemoryAdapter {
  constructor(private service: SemanticMemoryService) {}

  async addMemory(memory: Partial<MemoryItem>, options?: AddMemoryOptions): Promise<string> {
    return this.service.add(memory, options)
  }

  async searchMemories(query: string, options: SearchOptions): Promise<MemoryItem[]> {
    return this.service.search(query, options)
  }

  async getMemory(memoryId: string, tenantId: string, threadId: string): Promise<MemoryItem | null> {
    return this.service.get(memoryId, tenantId, threadId)
  }

  async updateMemory(
    memoryId: string,
    tenantId: string,
    threadId: string,
    updates: Partial<MemoryItem>
  ): Promise<void> {
    return this.service.update(memoryId, tenantId, threadId, updates)
  }

  async deleteMemory(memoryId: string, tenantId: string, threadId: string): Promise<void> {
    return this.service.delete(memoryId, tenantId, threadId)
  }

  async findSimilarMemories(
    embedding: number[],
    threshold: number,
    filters: { tenantId: string; threadId?: string; category?: string }
  ): Promise<MemoryItem[]> {
    return this.service.findSimilar(embedding, threshold, filters)
  }

  async checkSemanticCache(
    query: string,
    tenantId: string,
    options?: { threshold?: number; maxAge?: number }
  ): Promise<CachedResult | null> {
    return this.service.checkSemanticCache(query, tenantId, options)
  }

  async addToCache(
    query: string,
    response: any,
    tenantId: string,
    options?: { ttl?: number; metadata?: Record<string, any> }
  ): Promise<string> {
    return this.service.addToCache(query, response, tenantId, options)
  }

  async addMemoriesBatch(memories: Partial<MemoryItem>[]): Promise<string[]> {
    const ids: string[] = []
    for (const memory of memories) {
      const id = await this.service.add(memory)
      ids.push(id)
    }
    return ids
  }

  async getRecentMemories(tenantId: string, threadId: string, limit: number = 10): Promise<MemoryItem[]> {
    return this.service.getRecentMemories(tenantId, threadId, limit)
  }
}
