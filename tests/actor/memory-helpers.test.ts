/**
 * Tests for Memory Helpers
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { createMemoryHelpers } from '../../src/actor/memory-helpers'
import type { MemoryAdapter } from '../../src/memory'

describe('Memory Helpers', () => {
  const mockContext = {
    tenantId: 'test-tenant',
    actorType: 'TestActor',
    actorId: 'actor-123',
    threadId: 'thread-456',
  }

  test('should return no-op helpers when adapter is undefined', async () => {
    const helpers = createMemoryHelpers(undefined, mockContext)

    const memoryId = await helpers.remember({ memory: 'test' })
    const memories = await helpers.recall('test query')
    const cached = await helpers.checkCache('test query')

    expect(memoryId).toBeNull()
    expect(memories).toEqual([])
    expect(cached).toBeNull()
  })

  test('should return no-op helpers when storage disabled', async () => {
    const mockAdapter: MemoryAdapter = {
      addMemory: vi.fn(),
      searchMemories: vi.fn(),
      checkSemanticCache: vi.fn(),
    } as any

    const helpers = createMemoryHelpers(mockAdapter, mockContext, {
      storageEnabled: false,
      recallEnabled: false,
      cacheEnabled: false,
    })

    await helpers.remember({ memory: 'test' })
    await helpers.recall('test')
    await helpers.checkCache('test')

    expect(mockAdapter.addMemory).not.toHaveBeenCalled()
    expect(mockAdapter.searchMemories).not.toHaveBeenCalled()
    expect(mockAdapter.checkSemanticCache).not.toHaveBeenCalled()
  })

  test('should call adapter methods when enabled', async () => {
    const mockAdapter: MemoryAdapter = {
      addMemory: vi.fn().mockResolvedValue('mem-123'),
      searchMemories: vi.fn().mockResolvedValue([{ id: 'mem-456' }]),
      checkSemanticCache: vi.fn().mockResolvedValue({ response: 'cached' }),
      addToCache: vi.fn().mockResolvedValue('cache-789'),
      getRecentMemories: vi.fn().mockResolvedValue([{ id: 'mem-999' }]),
    } as any

    const helpers = createMemoryHelpers(mockAdapter, mockContext)

    // Test remember
    const memoryId = await helpers.remember({
      memory: 'test memory',
      content: 'test content',
    })
    expect(memoryId).toBe('mem-123')
    expect(mockAdapter.addMemory).toHaveBeenCalled()

    // Test recall
    const memories = await helpers.recall('test query')
    expect(memories).toEqual([{ id: 'mem-456' }])
    expect(mockAdapter.searchMemories).toHaveBeenCalled()

    // Test checkCache
    const cached = await helpers.checkCache('test query')
    expect(cached).toBe('cached')
    expect(mockAdapter.checkSemanticCache).toHaveBeenCalled()

    // Test cache
    const cacheId = await helpers.cache('query', 'response')
    expect(cacheId).toBe('cache-789')
    expect(mockAdapter.addToCache).toHaveBeenCalled()

    // Test getRecentMemories
    const recent = await helpers.getRecentMemories(5)
    expect(recent).toEqual([{ id: 'mem-999' }])
    expect(mockAdapter.getRecentMemories).toHaveBeenCalledWith(
      mockContext.tenantId,
      mockContext.threadId,
      5
    )
  })

  test('should handle errors gracefully', async () => {
    const mockAdapter: MemoryAdapter = {
      addMemory: vi.fn().mockRejectedValue(new Error('DB error')),
      searchMemories: vi.fn().mockRejectedValue(new Error('Search error')),
      checkSemanticCache: vi.fn().mockRejectedValue(new Error('Cache error')),
    } as any

    const helpers = createMemoryHelpers(mockAdapter, mockContext)

    // Should not throw, should return fallback values
    const memoryId = await helpers.remember({ memory: 'test' })
    const memories = await helpers.recall('test')
    const cached = await helpers.checkCache('test')

    expect(memoryId).toBeNull()
    expect(memories).toEqual([])
    expect(cached).toBeNull()
  })

  test('should include context metadata in memory', async () => {
    const mockAdapter: MemoryAdapter = {
      addMemory: vi.fn().mockResolvedValue('mem-123'),
    } as any

    const helpers = createMemoryHelpers(mockAdapter, {
      ...mockContext,
      metadata: { customField: 'custom value' },
    })

    await helpers.remember({ memory: 'test' })

    const call = (mockAdapter.addMemory as any).mock.calls[0][0]
    expect(call.tenantId).toBe('test-tenant')
    expect(call.agentId).toBe('TestActor')
    expect(call.threadId).toBe('thread-456')
    expect(call.metadata.actorType).toBe('TestActor')
    expect(call.metadata.customField).toBe('custom value')
  })
})
