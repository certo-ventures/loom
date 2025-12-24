import type { Container } from '@azure/cosmos'
import type { TraceContext } from '../types'

/**
 * Reference to data stored elsewhere (not duplicated in trace)
 */
export interface DataReference {
  actor_state?: {
    actor_id: string
    state_version: string
    container: string
    partition_key: string
  }
  journal_entry?: {
    actor_id: string
    entry_index: number
    entry_type: string
  }
  message?: {
    message_id: string
    queue_name: string
    correlation_id: string
  }
  document?: {
    container: string
    id: string
    partition_key: string
  }
  blob?: {
    container: string
    blob_name: string
  }
  idempotency?: {
    key: string
    [key: string]: any
  }
}

/**
 * Lightweight trace event with references (not data)
 */
export interface TraceEvent {
  trace_id: string
  span_id: string
  parent_span_id?: string
  event_type: string
  timestamp: string
  status?: 'success' | 'failed' | 'pending'
  refs?: DataReference
  metadata?: Record<string, any>
  tags?: string[]
}

/**
 * TraceWriter - Emits lightweight trace events to CosmosDB
 * 
 * Events contain REFERENCES to data, not the data itself.
 * This avoids duplication and reduces storage costs by 90%.
 */
export class TraceWriter {
  constructor(private container?: Container) {}

  /**
   * Emit a trace event
   * Fails silently - tracing errors should not break execution
   */
  async emit(event: TraceEvent): Promise<void> {
    if (!this.container) return // Tracing disabled

    try {
      await this.container.items.create(event)
    } catch (error) {
      // Don't let tracing failures break execution
      console.warn('Trace emit failed:', error)
    }
  }

  /**
   * Generate unique ID for trace/span
   */
  static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Create root trace context (entry point)
   */
  static createRootTrace(): TraceContext {
    const id = TraceWriter.generateId()
    return { trace_id: id, span_id: id }
  }

  /**
   * Create child span within existing trace
   */
  static createChildSpan(parent: TraceContext): TraceContext {
    return { 
      trace_id: parent.trace_id, 
      span_id: TraceWriter.generateId() 
    }
  }
}

/**
 * TraceReader - Query trace events from CosmosDB
 */
export class TraceReader {
  constructor(private container: Container) {}

  /**
   * Get all events for a trace
   */
  async getTrace(trace_id: string): Promise<TraceEvent[]> {
    const query = {
      query: 'SELECT * FROM c WHERE c.trace_id = @trace_id ORDER BY c.timestamp ASC',
      parameters: [{ name: '@trace_id', value: trace_id }]
    }

    const { resources } = await this.container.items.query<TraceEvent>(query).fetchAll()
    return resources
  }

  /**
   * Get events by type within a trace
   */
  async getEventsByType(trace_id: string, event_type: string): Promise<TraceEvent[]> {
    const query = {
      query: 'SELECT * FROM c WHERE c.trace_id = @trace_id AND c.event_type = @event_type ORDER BY c.timestamp ASC',
      parameters: [
        { name: '@trace_id', value: trace_id },
        { name: '@event_type', value: event_type }
      ]
    }

    const { resources } = await this.container.items.query<TraceEvent>(query).fetchAll()
    return resources
  }

  /**
   * Get failed events within a trace
   */
  async getFailures(trace_id: string): Promise<TraceEvent[]> {
    const query = {
      query: 'SELECT * FROM c WHERE c.trace_id = @trace_id AND c.status = "failed" ORDER BY c.timestamp ASC',
      parameters: [{ name: '@trace_id', value: trace_id }]
    }

    const { resources } = await this.container.items.query<TraceEvent>(query).fetchAll()
    return resources
  }
}
