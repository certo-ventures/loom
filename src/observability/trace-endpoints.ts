/**
 * HTTP Endpoints for Trace Queries
 * 
 * Provides RESTful API for querying distributed traces
 */

import type { TraceStore } from '../tracing/trace-store'
import type { TraceQuery } from '../tracing/types'
import type { MetricsCollector } from './types'

export interface TraceEndpointsConfig {
  traceStore: TraceStore
  metricsCollector?: MetricsCollector
}

/**
 * Trace query request body
 */
export interface TraceQueryRequest {
  correlationId?: string
  traceId?: string
  actorId?: string
  actorType?: string
  operation?: string
  status?: 'in-progress' | 'success' | 'failed'
  timeRange?: {
    start: string // ISO date
    end: string   // ISO date
  }
  limit?: number
}

/**
 * Create Express/Fastify-compatible trace endpoints
 */
export class TraceEndpoints {
  constructor(private config: TraceEndpointsConfig) {}

  /**
   * GET /traces/:traceId
   * Get a single trace by ID
   */
  async getTrace(traceId: string): Promise<{ trace: any | null }> {
    const startTime = Date.now()
    
    try {
      const trace = await this.config.traceStore.get(traceId)
      
      this.config.metricsCollector?.timing('trace.query.get', Date.now() - startTime)
      this.config.metricsCollector?.emit('trace.query.success', 1, { operation: 'get' })
      
      return { trace }
    } catch (error) {
      this.config.metricsCollector?.emit('trace.query.failed', 1, { operation: 'get' })
      throw error
    }
  }

  /**
   * POST /traces/query
   * Query traces with filters
   */
  async queryTraces(request: TraceQueryRequest): Promise<{ traces: any[]; count: number }> {
    const startTime = Date.now()
    
    try {
      // Convert request to query object
      const query: TraceQuery = {
        correlationId: request.correlationId,
        traceId: request.traceId,
        actorId: request.actorId,
        actorType: request.actorType,
        operation: request.operation,
        status: request.status,
        timeRange: request.timeRange ? {
          start: new Date(request.timeRange.start),
          end: new Date(request.timeRange.end),
        } : undefined,
        limit: request.limit || 100,
      }
      
      const traces = await this.config.traceStore.query(query)
      
      this.config.metricsCollector?.timing('trace.query.search', Date.now() - startTime)
      this.config.metricsCollector?.emit('trace.query.success', 1, { operation: 'query' })
      this.config.metricsCollector?.emit('trace.query.results', traces.length, { operation: 'query' })
      
      return {
        traces,
        count: traces.length,
      }
    } catch (error) {
      this.config.metricsCollector?.emit('trace.query.failed', 1, { operation: 'query' })
      throw error
    }
  }

  /**
   * GET /traces/stats
   * Get trace statistics (optionally by correlation ID)
   */
  async getTraceStats(correlationId?: string): Promise<any> {
    const startTime = Date.now()
    
    try {
      const stats = await this.config.traceStore.getStats(correlationId)
      
      this.config.metricsCollector?.timing('trace.query.stats', Date.now() - startTime)
      this.config.metricsCollector?.emit('trace.query.success', 1, { operation: 'stats' })
      
      return { stats }
    } catch (error) {
      this.config.metricsCollector?.emit('trace.query.failed', 1, { operation: 'stats' })
      throw error
    }
  }

  /**
   * GET /traces/correlation/:correlationId
   * Get all traces for a specific correlation ID (e.g., workflow/pipeline run)
   */
  async getTracesByCorrelation(correlationId: string): Promise<{ traces: any[]; count: number }> {
    const startTime = Date.now()
    
    try {
      const query: TraceQuery = {
        correlationId,
        limit: 1000, // Higher limit for correlation queries
      }
      
      const traces = await this.config.traceStore.query(query)
      
      // Sort traces by start time for better visualization
      traces.sort((a, b) => {
        const timeA = new Date(a.startTime).getTime()
        const timeB = new Date(b.startTime).getTime()
        return timeA - timeB
      })
      
      this.config.metricsCollector?.timing('trace.query.correlation', Date.now() - startTime)
      this.config.metricsCollector?.emit('trace.query.success', 1, { operation: 'correlation' })
      this.config.metricsCollector?.emit('trace.query.results', traces.length, { operation: 'correlation' })
      
      return {
        traces,
        count: traces.length,
      }
    } catch (error) {
      this.config.metricsCollector?.emit('trace.query.failed', 1, { operation: 'correlation' })
      throw error
    }
  }

  /**
   * GET /traces/actor/:actorId
   * Get all traces for a specific actor
   */
  async getTracesByActor(actorId: string, limit?: number): Promise<{ traces: any[]; count: number }> {
    const startTime = Date.now()
    
    try {
      const query: TraceQuery = {
        actorId,
        limit: limit || 100,
      }
      
      const traces = await this.config.traceStore.query(query)
      
      this.config.metricsCollector?.timing('trace.query.actor', Date.now() - startTime)
      this.config.metricsCollector?.emit('trace.query.success', 1, { operation: 'actor' })
      this.config.metricsCollector?.emit('trace.query.results', traces.length, { operation: 'actor' })
      
      return {
        traces,
        count: traces.length,
      }
    } catch (error) {
      this.config.metricsCollector?.emit('trace.query.failed', 1, { operation: 'actor' })
      throw error
    }
  }

  /**
   * DELETE /traces/cleanup
   * Clean up old traces
   */
  async cleanupTraces(olderThanDays: number = 30): Promise<{ deleted: number }> {
    const startTime = Date.now()
    
    try {
      const olderThan = new Date()
      olderThan.setDate(olderThan.getDate() - olderThanDays)
      
      const deleted = await this.config.traceStore.cleanup(olderThan)
      
      this.config.metricsCollector?.timing('trace.cleanup', Date.now() - startTime)
      this.config.metricsCollector?.emit('trace.cleanup.success', 1)
      this.config.metricsCollector?.emit('trace.cleanup.deleted', deleted)
      
      return { deleted }
    } catch (error) {
      this.config.metricsCollector?.emit('trace.cleanup.failed', 1)
      throw error
    }
  }

  /**
   * Helper to convert to Express routes
   */
  toExpressRoutes() {
    return {
      'GET /traces/:traceId': async (req: any, res: any) => {
        try {
          const result = await this.getTrace(req.params.traceId)
          res.json(result)
        } catch (error) {
          res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
        }
      },
      
      'POST /traces/query': async (req: any, res: any) => {
        try {
          const result = await this.queryTraces(req.body)
          res.json(result)
        } catch (error) {
          res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
        }
      },
      
      'GET /traces/stats': async (req: any, res: any) => {
        try {
          const result = await this.getTraceStats(req.query.correlationId)
          res.json(result)
        } catch (error) {
          res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
        }
      },
      
      'GET /traces/correlation/:correlationId': async (req: any, res: any) => {
        try {
          const result = await this.getTracesByCorrelation(req.params.correlationId)
          res.json(result)
        } catch (error) {
          res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
        }
      },
      
      'GET /traces/actor/:actorId': async (req: any, res: any) => {
        try {
          const limit = req.query.limit ? parseInt(req.query.limit) : undefined
          const result = await this.getTracesByActor(req.params.actorId, limit)
          res.json(result)
        } catch (error) {
          res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
        }
      },
      
      'DELETE /traces/cleanup': async (req: any, res: any) => {
        try {
          const olderThanDays = req.query.olderThanDays ? parseInt(req.query.olderThanDays) : 30
          const result = await this.cleanupTraces(olderThanDays)
          res.json(result)
        } catch (error) {
          res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
        }
      },
    }
  }
}

/**
 * Factory function to create trace endpoints
 */
export function createTraceEndpoints(config: TraceEndpointsConfig): TraceEndpoints {
  return new TraceEndpoints(config)
}
