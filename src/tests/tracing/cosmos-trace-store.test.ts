/**
 * Tests for CosmosDB TraceStore with batching
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CosmosTraceStore } from '../../tracing/cosmos-trace-store'
import type { ActorTrace } from '../../tracing/types'

describe('CosmosTraceStore', () => {
  let traceStore: CosmosTraceStore
  let mockContainer: any
  let mockBulk: any
  let mockQuery: any

  beforeEach(() => {
    // Mock Cosmos SDK
    mockBulk = vi.fn().mockResolvedValue(undefined)
    mockQuery = vi.fn().mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({ resources: [] })
    })

    mockContainer = {
      items: {
        bulk: mockBulk,
        query: mockQuery,
      }
    }

    const mockClient = {
      databases: {
        createIfNotExists: vi.fn().mockResolvedValue({
          database: {
            containers: {
              createIfNotExists: vi.fn().mockResolvedValue({
                container: mockContainer
              })
            }
          }
        })
      }
    }

    // Mock CosmosClient constructor
    vi.mock('@azure/cosmos', () => ({
      CosmosClient: vi.fn(() => mockClient)
    }))

    traceStore = new CosmosTraceStore({
      endpoint: 'https://test.documents.azure.com',
      key: 'test-key',
      databaseId: 'traces-db',
      containerId: 'traces',
      batchSize: 3, // Small batch for testing
      flushIntervalMs: 100, // Fast flush for testing
    })
  })

  afterEach(async () => {
    await traceStore.close()
    vi.clearAllMocks()
  })

  it('should initialize container with proper indexing policy', async () => {
    await traceStore.initialize()
    
    const mockClient = (traceStore as any).client
    const createContainer = mockClient.databases.createIfNotExists().database.containers.createIfNotExists
    
    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'traces',
        partitionKey: '/correlationId',
        indexingPolicy: expect.objectContaining({
          compositeIndexes: expect.arrayContaining([
            expect.arrayContaining([
              { path: '/correlationId', order: 'ascending' },
              { path: '/startTime', order: 'descending' }
            ])
          ])
        })
      })
    )
  })

  it('should batch trace writes', async () => {
    await traceStore.initialize()

    const trace1: ActorTrace = {
      traceId: 'trace-1',
      correlationId: 'corr-1',
      operation: 'test',
      actorId: 'actor-1',
      actorType: 'TestActor',
      startTime: new Date().toISOString(),
      status: 'in-progress',
      events: [],
    }

    const trace2: ActorTrace = {
      ...trace1,
      traceId: 'trace-2',
    }

    // Add two traces - should not flush yet (batch size is 3)
    await traceStore.save(trace1)
    await traceStore.save(trace2)
    
    expect(mockBulk).not.toHaveBeenCalled()

    const trace3: ActorTrace = {
      ...trace1,
      traceId: 'trace-3',
    }

    // Add third trace - should trigger batch flush
    await traceStore.save(trace3)
    
    expect(mockBulk).toHaveBeenCalledTimes(1)
    expect(mockBulk).toHaveBeenCalledWith([
      expect.objectContaining({ operationType: 'Create', resourceBody: expect.objectContaining({ id: 'trace-1' }) }),
      expect.objectContaining({ operationType: 'Create', resourceBody: expect.objectContaining({ id: 'trace-2' }) }),
      expect.objectContaining({ operationType: 'Create', resourceBody: expect.objectContaining({ id: 'trace-3' }) }),
    ])
  })

  it('should flush traces periodically', async () => {
    await traceStore.initialize()

    const trace: ActorTrace = {
      traceId: 'trace-1',
      correlationId: 'corr-1',
      operation: 'test',
      actorId: 'actor-1',
      actorType: 'TestActor',
      startTime: new Date().toISOString(),
      status: 'in-progress',
      events: [],
    }

    await traceStore.save(trace)
    
    // Wait for flush interval
    await new Promise(resolve => setTimeout(resolve, 150))
    
    expect(mockBulk).toHaveBeenCalledTimes(1)
  })

  it('should query traces with filters', async () => {
    await traceStore.initialize()

    const mockTraces: ActorTrace[] = [
      {
        traceId: 'trace-1',
        correlationId: 'corr-1',
        operation: 'test',
        actorId: 'actor-1',
        actorType: 'TestActor',
        startTime: '2025-01-01T00:00:00Z',
        status: 'success',
        events: [],
      }
    ]

    mockQuery.mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({ resources: mockTraces })
    })

    const results = await traceStore.query({
      correlationId: 'corr-1',
      actorType: 'TestActor',
      status: 'success',
    })

    expect(results).toEqual(mockTraces)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('WHERE'),
        parameters: expect.arrayContaining([
          { name: '@correlationId', value: 'corr-1' },
          { name: '@actorType', value: 'TestActor' },
          { name: '@status', value: 'success' },
        ])
      }),
      expect.any(Object)
    )
  })

  it('should get trace by ID', async () => {
    await traceStore.initialize()

    const mockTrace: ActorTrace = {
      traceId: 'trace-1',
      correlationId: 'corr-1',
      operation: 'test',
      actorId: 'actor-1',
      actorType: 'TestActor',
      startTime: '2025-01-01T00:00:00Z',
      status: 'success',
      events: [],
    }

    mockQuery.mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({ resources: [mockTrace] })
    })

    const result = await traceStore.get('trace-1')

    expect(result).toEqual(mockTrace)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'SELECT * FROM c WHERE c.traceId = @traceId',
        parameters: [{ name: '@traceId', value: 'trace-1' }]
      })
    )
  })

  it('should return null for non-existent trace', async () => {
    await traceStore.initialize()

    mockQuery.mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({ resources: [] })
    })

    const result = await traceStore.get('non-existent')

    expect(result).toBeNull()
  })

  it('should get trace statistics', async () => {
    await traceStore.initialize()

    const mockStats = {
      totalTraces: 100,
      completedTraces: 80,
      failedTraces: 15,
      runningTraces: 5,
      avgDurationMs: 250.5,
      totalEvents: 500,
    }

    mockQuery.mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({ resources: [mockStats] })
    })

    const stats = await traceStore.getStats()

    expect(stats).toEqual(mockStats)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('COUNT(1) as totalTraces')
      })
    )
  })

  it('should get statistics for specific correlation ID', async () => {
    await traceStore.initialize()

    const mockStats = {
      totalTraces: 10,
      completedTraces: 8,
      failedTraces: 2,
      runningTraces: 0,
      avgDurationMs: 150.0,
      totalEvents: 50,
    }

    mockQuery.mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({ resources: [mockStats] })
    })

    const stats = await traceStore.getStats('corr-1')

    expect(stats).toEqual(mockStats)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('WHERE c.correlationId = @correlationId'),
        parameters: [{ name: '@correlationId', value: 'corr-1' }]
      })
    )
  })

  it('should cleanup old traces', async () => {
    await traceStore.initialize()

    const oldTraces = [
      { id: 'trace-1', correlationId: 'corr-1' },
      { id: 'trace-2', correlationId: 'corr-1' },
    ]

    mockQuery.mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({ resources: oldTraces })
    })

    const deleted = await traceStore.cleanup(new Date('2025-01-01'))

    expect(deleted).toBe(2)
    expect(mockBulk).toHaveBeenCalledWith([
      { operationType: 'Delete', id: 'trace-1', partitionKey: 'corr-1' },
      { operationType: 'Delete', id: 'trace-2', partitionKey: 'corr-1' },
    ])
  })

  it('should restore traces to buffer on flush error', async () => {
    await traceStore.initialize()

    const trace1: ActorTrace = {
      traceId: 'trace-1',
      correlationId: 'corr-1',
      operation: 'test',
      actorId: 'actor-1',
      actorType: 'TestActor',
      startTime: new Date().toISOString(),
      status: 'in-progress',
      events: [],
    }

    // Make bulk operation fail
    mockBulk.mockRejectedValueOnce(new Error('Cosmos error'))

    await traceStore.save(trace1)
    await traceStore.save({ ...trace1, traceId: 'trace-2' })
    await traceStore.save({ ...trace1, traceId: 'trace-3' })

    // First flush should fail and restore traces
    await expect(traceStore.flush()).rejects.toThrow('Cosmos error')

    // Buffer should have traces restored
    expect((traceStore as any).batchBuffer.length).toBe(3)
  })

  it('should handle time range queries', async () => {
    await traceStore.initialize()

    mockQuery.mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({ resources: [] })
    })

    const start = new Date('2025-01-01T00:00:00Z')
    const end = new Date('2025-01-31T23:59:59Z')

    await traceStore.query({
      timeRange: { start, end },
      limit: 50,
    })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('c.startTime >= @startTime AND c.startTime <= @endTime'),
        parameters: expect.arrayContaining([
          { name: '@startTime', value: start.toISOString() },
          { name: '@endTime', value: end.toISOString() },
        ])
      }),
      expect.objectContaining({ maxItemCount: 50 })
    )
  })
})
