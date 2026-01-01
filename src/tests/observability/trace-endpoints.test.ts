/**
 * Tests for Trace HTTP Endpoints
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TraceEndpoints } from '../../observability/trace-endpoints'
import type { TraceStore } from '../../tracing/trace-store'
import type { ActorTrace } from '../../tracing/types'
import type { MetricsCollector } from '../../observability/types'

describe('TraceEndpoints', () => {
  let endpoints: TraceEndpoints
  let mockTraceStore: TraceStore
  let mockMetricsCollector: MetricsCollector

  beforeEach(() => {
    mockTraceStore = {
      get: vi.fn(),
      query: vi.fn(),
      save: vi.fn(),
      getStats: vi.fn(),
      cleanup: vi.fn(),
    } as any

    mockMetricsCollector = {
      emit: vi.fn(),
      timing: vi.fn(),
      getHealth: vi.fn(),
      getMetrics: vi.fn(),
      recordActorEvent: vi.fn(),
      recordMessageEvent: vi.fn(),
      recordLockEvent: vi.fn(),
    } as any

    endpoints = new TraceEndpoints({
      traceStore: mockTraceStore,
      metricsCollector: mockMetricsCollector,
    })
  })

  describe('getTrace', () => {
    it('should get a trace by ID', async () => {
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

      vi.mocked(mockTraceStore.get).mockResolvedValue(mockTrace)

      const result = await endpoints.getTrace('trace-1')

      expect(result.trace).toEqual(mockTrace)
      expect(mockTraceStore.get).toHaveBeenCalledWith('trace-1')
      expect(mockMetricsCollector.timing).toHaveBeenCalledWith('trace.query.get', expect.any(Number))
      expect(mockMetricsCollector.emit).toHaveBeenCalledWith('trace.query.success', 1, { operation: 'get' })
    })

    it('should return null for non-existent trace', async () => {
      vi.mocked(mockTraceStore.get).mockResolvedValue(null)

      const result = await endpoints.getTrace('non-existent')

      expect(result.trace).toBeNull()
    })

    it('should record metrics on error', async () => {
      vi.mocked(mockTraceStore.get).mockRejectedValue(new Error('Database error'))

      await expect(endpoints.getTrace('trace-1')).rejects.toThrow('Database error')
      expect(mockMetricsCollector.emit).toHaveBeenCalledWith('trace.query.failed', 1, { operation: 'get' })
    })
  })

  describe('queryTraces', () => {
    it('should query traces with filters', async () => {
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

      vi.mocked(mockTraceStore.query).mockResolvedValue(mockTraces)

      const result = await endpoints.queryTraces({
        correlationId: 'corr-1',
        actorType: 'TestActor',
        status: 'success',
        limit: 50,
      })

      expect(result.traces).toEqual(mockTraces)
      expect(result.count).toBe(1)
      expect(mockTraceStore.query).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'corr-1',
          actorType: 'TestActor',
          status: 'success',
          limit: 50,
        })
      )
      expect(mockMetricsCollector.emit).toHaveBeenCalledWith('trace.query.results', 1, { operation: 'query' })
    })

    it('should handle time range queries', async () => {
      vi.mocked(mockTraceStore.query).mockResolvedValue([])

      await endpoints.queryTraces({
        timeRange: {
          start: '2025-01-01T00:00:00Z',
          end: '2025-01-31T23:59:59Z',
        }
      })

      expect(mockTraceStore.query).toHaveBeenCalledWith(
        expect.objectContaining({
          timeRange: {
            start: new Date('2025-01-01T00:00:00Z'),
            end: new Date('2025-01-31T23:59:59Z'),
          }
        })
      )
    })

    it('should default limit to 100', async () => {
      vi.mocked(mockTraceStore.query).mockResolvedValue([])

      await endpoints.queryTraces({})

      expect(mockTraceStore.query).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 100,
        })
      )
    })
  })

  describe('getTraceStats', () => {
    it('should get overall statistics', async () => {
      const mockStats = {
        totalTraces: 100,
        completedTraces: 80,
        failedTraces: 15,
        runningTraces: 5,
        avgDurationMs: 250.5,
        totalEvents: 500,
      }

      vi.mocked(mockTraceStore.getStats).mockResolvedValue(mockStats)

      const result = await endpoints.getTraceStats()

      expect(result.stats).toEqual(mockStats)
      expect(mockTraceStore.getStats).toHaveBeenCalledWith(undefined)
    })

    it('should get statistics for correlation ID', async () => {
      const mockStats = {
        totalTraces: 10,
        completedTraces: 8,
        failedTraces: 2,
        runningTraces: 0,
        avgDurationMs: 150.0,
        totalEvents: 50,
      }

      vi.mocked(mockTraceStore.getStats).mockResolvedValue(mockStats)

      const result = await endpoints.getTraceStats('corr-1')

      expect(result.stats).toEqual(mockStats)
      expect(mockTraceStore.getStats).toHaveBeenCalledWith('corr-1')
    })
  })

  describe('getTracesByCorrelation', () => {
    it('should get all traces for a correlation ID', async () => {
      const mockTraces: ActorTrace[] = [
        {
          traceId: 'trace-1',
          correlationId: 'corr-1',
          operation: 'step1',
          actorId: 'actor-1',
          actorType: 'TestActor',
          startTime: '2025-01-01T00:00:00Z',
          status: 'success',
          events: [],
        },
        {
          traceId: 'trace-2',
          correlationId: 'corr-1',
          operation: 'step2',
          actorId: 'actor-2',
          actorType: 'TestActor',
          startTime: '2025-01-01T00:01:00Z',
          status: 'success',
          events: [],
        }
      ]

      vi.mocked(mockTraceStore.query).mockResolvedValue(mockTraces)

      const result = await endpoints.getTracesByCorrelation('corr-1')

      expect(result.traces).toHaveLength(2)
      expect(result.count).toBe(2)
      expect(mockTraceStore.query).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'corr-1',
          limit: 1000,
        })
      )
    })

    it('should sort traces by start time', async () => {
      const mockTraces: ActorTrace[] = [
        {
          traceId: 'trace-2',
          correlationId: 'corr-1',
          operation: 'step2',
          actorId: 'actor-2',
          actorType: 'TestActor',
          startTime: '2025-01-01T00:02:00Z', // Later
          status: 'success',
          events: [],
        },
        {
          traceId: 'trace-1',
          correlationId: 'corr-1',
          operation: 'step1',
          actorId: 'actor-1',
          actorType: 'TestActor',
          startTime: '2025-01-01T00:01:00Z', // Earlier
          status: 'success',
          events: [],
        }
      ]

      vi.mocked(mockTraceStore.query).mockResolvedValue(mockTraces)

      const result = await endpoints.getTracesByCorrelation('corr-1')

      expect(result.traces[0].traceId).toBe('trace-1')
      expect(result.traces[1].traceId).toBe('trace-2')
    })
  })

  describe('getTracesByActor', () => {
    it('should get traces for an actor', async () => {
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

      vi.mocked(mockTraceStore.query).mockResolvedValue(mockTraces)

      const result = await endpoints.getTracesByActor('actor-1', 50)

      expect(result.traces).toEqual(mockTraces)
      expect(result.count).toBe(1)
      expect(mockTraceStore.query).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-1',
          limit: 50,
        })
      )
    })

    it('should default limit to 100', async () => {
      vi.mocked(mockTraceStore.query).mockResolvedValue([])

      await endpoints.getTracesByActor('actor-1')

      expect(mockTraceStore.query).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 100,
        })
      )
    })
  })

  describe('cleanupTraces', () => {
    it('should cleanup old traces', async () => {
      vi.mocked(mockTraceStore.cleanup).mockResolvedValue(42)

      const result = await endpoints.cleanupTraces(30)

      expect(result.deleted).toBe(42)
      expect(mockTraceStore.cleanup).toHaveBeenCalledWith(
        expect.any(Date)
      )
      expect(mockMetricsCollector.emit).toHaveBeenCalledWith('trace.cleanup.deleted', 42)
    })

    it('should default to 30 days', async () => {
      vi.mocked(mockTraceStore.cleanup).mockResolvedValue(10)

      const now = Date.now()
      await endpoints.cleanupTraces()

      const call = vi.mocked(mockTraceStore.cleanup).mock.calls[0][0]
      const expectedDate = new Date(now - 30 * 24 * 60 * 60 * 1000)
      
      // Allow 1 second difference for test execution time
      expect(Math.abs(call.getTime() - expectedDate.getTime())).toBeLessThan(1000)
    })
  })
})
