/**
 * Semantic Memory Service Tests
 * Basic tests for core functionality
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { SemanticMemoryService } from '../../src/memory/semantic-memory-service'
import type { MemoryServiceConfig } from '../../src/config/types'
import { DefaultAzureCredential } from '@azure/identity'

describe('SemanticMemoryService', () => {
  let service: SemanticMemoryService
  const testTenantId = 'test-tenant'
  const testThreadId = 'test-thread-1'

  beforeAll(async () => {
    // Skip if no Cosmos DB configured
    if (!process.env.COSMOS_ENDPOINT || !process.env.OPENAI_API_KEY) {
      console.log('⚠️  Skipping memory tests - COSMOS_ENDPOINT or OPENAI_API_KEY not set')
      return
    }

    const config: MemoryServiceConfig = {
      cosmos: {
        endpoint: process.env.COSMOS_ENDPOINT!,
        databaseId: 'loom-test',
        containerId: 'memories-test',
        credential: new DefaultAzureCredential(),
      },
      embedding: {
        provider: 'openai',
        openai: {
          apiKey: process.env.OPENAI_API_KEY!,
          model: 'text-embedding-3-small',
        },
        dimensions: 1536,
      },
    }

    service = new SemanticMemoryService(config)
    await service.initialize()
  })

  it('should store and retrieve a memory', async () => {
    if (!process.env.COSMOS_ENDPOINT) return

    const memoryId = await service.add({
      tenantId: testTenantId,
      threadId: testThreadId,
      turnIndex: 0,
      memory: 'Test memory about property condition',
      content: 'The property has good structural condition',
      timestamp: new Date().toISOString(),
      memoryType: 'long-term',
      category: 'test',
    })

    expect(memoryId).toBeTruthy()

    const retrieved = await service.get(memoryId, testTenantId, testThreadId)
    expect(retrieved).toBeTruthy()
    expect(retrieved?.memory).toBe('Test memory about property condition')
  })

  it('should find similar memories via vector search', async () => {
    if (!process.env.COSMOS_ENDPOINT) return

    // Add test memories
    await service.add({
      tenantId: testTenantId,
      threadId: testThreadId,
      turnIndex: 1,
      memory: 'Property has excellent foundation',
      content: 'The foundation is in excellent condition',
      memoryType: 'long-term',
      category: 'test',
    })

    await service.add({
      tenantId: testTenantId,
      threadId: testThreadId,
      turnIndex: 2,
      memory: 'House has good structural integrity',
      content: 'The structure is sound and well-maintained',
      memoryType: 'long-term',
      category: 'test',
    })

    // Search for similar
    const results = await service.search('good foundation condition', {
      tenantId: testTenantId,
      threadId: testThreadId,
      category: 'test',
      limit: 5,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toHaveProperty('distance')
  })

  it('should retrieve recent memories by turnIndex', async () => {
    if (!process.env.COSMOS_ENDPOINT) return

    const recent = await service.getRecentMemories(testTenantId, testThreadId, 2)
    
    expect(recent.length).toBeGreaterThan(0)
    expect(recent.length).toBeLessThanOrEqual(2)
    
    // Should be ordered by turnIndex DESC
    if (recent.length > 1) {
      expect(recent[0].turnIndex).toBeGreaterThanOrEqual(recent[1].turnIndex)
    }
  })

  it('should deduplicate similar memories', async () => {
    if (!process.env.COSMOS_ENDPOINT) return

    const memory1 = {
      tenantId: testTenantId,
      threadId: 'test-dedup',
      turnIndex: 0,
      memory: 'Property has excellent foundation and structure',
      content: 'The foundation is in excellent condition',
      memoryType: 'long-term' as const,
      category: 'test-dedup',
    }

    const memory2 = {
      tenantId: testTenantId,
      threadId: 'test-dedup',
      turnIndex: 1,
      memory: 'Property has great foundation and structural integrity',
      content: 'The foundation is in great condition',
      memoryType: 'long-term' as const,
      category: 'test-dedup',
    }

    const id1 = await service.add(memory1)
    const id2 = await service.add(memory2) // Should merge with id1

    expect(id1).toBe(id2) // Same ID means deduplicated

    // Verify merged content
    const merged = await service.get(id1, testTenantId, 'test-dedup')
    expect(merged?.metadata?.occurrences).toBe(2)
  })

  it('should update existing memory', async () => {
    if (!process.env.COSMOS_ENDPOINT) return

    const memoryId = await service.add({
      tenantId: testTenantId,
      threadId: testThreadId,
      turnIndex: 10,
      memory: 'Original memory',
      memoryType: 'long-term',
      category: 'test',
    })

    await service.update(memoryId, testTenantId, testThreadId, {
      memory: 'Updated memory',
      metadata: { updated: true },
    })

    const updated = await service.get(memoryId, testTenantId, testThreadId)
    expect(updated?.memory).toBe('Updated memory')
    expect(updated?.metadata?.updated).toBe(true)
  })

  it('should delete memory', async () => {
    if (!process.env.COSMOS_ENDPOINT) return

    const memoryId = await service.add({
      tenantId: testTenantId,
      threadId: testThreadId,
      turnIndex: 11,
      memory: 'Memory to delete',
      memoryType: 'short-term',
      category: 'test',
    })

    await service.delete(memoryId, testTenantId, testThreadId)

    const deleted = await service.get(memoryId, testTenantId, testThreadId)
    expect(deleted).toBeNull()
  })

  it('should cache query results and retrieve with semantic similarity', async () => {
    if (!process.env.COSMOS_ENDPOINT) return

    const query = 'What is the property foundation condition?'
    const response = {
      evaluation: 'pass',
      confidence: 0.95,
      reasoning: 'Foundation is in excellent condition',
    }

    // Add to cache
    await service.addToCache(query, response, testTenantId, {
      metadata: { criterionId: 'C001' },
    })

    // Check cache with exact query
    const cached = await service.checkSemanticCache(query, testTenantId)
    expect(cached).toBeTruthy()
    expect(cached?.response.evaluation).toBe('pass')
    expect(cached?.response.confidence).toBe(0.95)

    // Check cache with similar query (semantic match)
    const similar = await service.checkSemanticCache(
      'How is the foundation condition?',
      testTenantId
    )
    expect(similar).toBeTruthy()
    expect(similar?.response.evaluation).toBe('pass')
  })

  it('should return null for cache miss', async () => {
    if (!process.env.COSMOS_ENDPOINT) return

    const cached = await service.checkSemanticCache(
      'This query has never been cached before xyz123',
      testTenantId
    )
    expect(cached).toBeNull()
  })

  it('should respect cache age limit', async () => {
    if (!process.env.COSMOS_ENDPOINT) return

    const query = 'Old cached query'
    const response = { result: 'old data' }

    // Add to cache with 1 second TTL
    await service.addToCache(query, response, testTenantId, {
      ttl: 1,
    })

    // Should find immediately
    let cached = await service.checkSemanticCache(query, testTenantId)
    expect(cached).toBeTruthy()

    // Wait 2 seconds, should expire
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Should not find (TTL expired)
    cached = await service.checkSemanticCache(query, testTenantId)
    expect(cached).toBeNull()
  })
})
