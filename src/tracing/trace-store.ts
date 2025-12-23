/**
 * TraceStore - Persist and query actor traces
 */

import type { ActorTrace, TraceQuery, TraceStats } from './types'

/**
 * TraceStore interface for persisting traces
 */
export interface TraceStore {
  /**
   * Save a trace
   */
  save(trace: ActorTrace): Promise<void>
  
  /**
   * Get a trace by ID
   */
  get(traceId: string): Promise<ActorTrace | null>
  
  /**
   * Query traces
   */
  query(query: TraceQuery): Promise<ActorTrace[]>
  
  /**
   * Get trace statistics
   */
  getStats(correlationId?: string): Promise<TraceStats>
  
  /**
   * Delete old traces
   */
  cleanup(olderThan: Date): Promise<number>
}

/**
 * In-memory trace store (for development/testing)
 */
export class InMemoryTraceStore implements TraceStore {
  private traces = new Map<string, ActorTrace>()

  async save(trace: ActorTrace): Promise<void> {
    this.traces.set(trace.traceId, trace)
  }

  async get(traceId: string): Promise<ActorTrace | null> {
    return this.traces.get(traceId) || null
  }

  async query(query: TraceQuery): Promise<ActorTrace[]> {
    let results: ActorTrace[] = []
    this.traces.forEach(trace => results.push(trace))

    // Filter by correlation ID
    if (query.correlationId) {
      results = results.filter(t => t.correlationId === query.correlationId)
    }

    // Filter by trace ID
    if (query.traceId) {
      results = results.filter(t => t.traceId === query.traceId)
    }

    // Filter by actor ID
    if (query.actorId) {
      results = results.filter(t => t.actorId === query.actorId)
    }

    // Filter by actor type
    if (query.actorType) {
      results = results.filter(t => t.actorType === query.actorType)
    }

    // Filter by operation
    if (query.operation) {
      results = results.filter(t => t.operation === query.operation)
    }

    // Filter by status
    if (query.status) {
      results = results.filter(t => t.status === query.status)
    }

    // Filter by time range
    if (query.timeRange) {
      const { start, end } = query.timeRange
      results = results.filter(t => {
        const traceTime = new Date(t.startTime)
        return traceTime >= start && traceTime <= end
      })
    }

    // Sort by start time (newest first)
    results.sort((a, b) => {
      return new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    })

    // Apply limit
    if (query.limit) {
      results = results.slice(0, query.limit)
    }

    return results
  }

  async getStats(correlationId?: string): Promise<TraceStats> {
    let traces: ActorTrace[] = []
    this.traces.forEach(trace => traces.push(trace))

    if (correlationId) {
      traces = traces.filter(t => t.correlationId === correlationId)
    }

    const completed = traces.filter(t => t.status === 'completed').length
    const failed = traces.filter(t => t.status === 'failed').length
    const running = traces.filter(t => t.status === 'running').length

    const durations = traces
      .filter(t => t.duration !== undefined)
      .map(t => t.duration!)

    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0

    const minDuration = durations.length > 0
      ? Math.min(...durations)
      : 0

    const maxDuration = durations.length > 0
      ? Math.max(...durations)
      : 0

    const totalEvents = traces.reduce((sum, t) => sum + t.events.length, 0)

    return {
      totalTraces: traces.length,
      completed,
      failed,
      running,
      avgDuration,
      minDuration,
      maxDuration,
      totalEvents,
    }
  }

  async cleanup(olderThan: Date): Promise<number> {
    let deletedCount = 0
    const threshold = olderThan.getTime()
    const toDelete: string[] = []

    this.traces.forEach((trace, traceId) => {
      const traceTime = new Date(trace.startTime).getTime()
      if (traceTime < threshold) {
        toDelete.push(traceId)
      }
    })
    
    toDelete.forEach(traceId => {
      this.traces.delete(traceId)
      deletedCount++
    })

    return deletedCount
  }

  /**
   * Get all traces (for testing)
   */
  getAll(): ActorTrace[] {
    const result: ActorTrace[] = []
    this.traces.forEach(trace => result.push(trace))
    return result
  }

  /**
   * Clear all traces (for testing)
   */
  clear(): void {
    this.traces.clear()
  }
}
