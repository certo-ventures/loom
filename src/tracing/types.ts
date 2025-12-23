/**
 * Trace Aggregation and Correlation System
 * 
 * Enables distributed tracing across actor hierarchies.
 * Groups related actor interactions using correlationId.
 */

/**
 * Types of trace events
 */
export type TraceEventType =
  | 'actor.created'
  | 'actor.execute.start'
  | 'actor.execute.end'
  | 'actor.error'
  | 'message.sent'
  | 'message.received'
  | 'state.updated'
  | 'journal.entry'
  | 'activity.scheduled'
  | 'activity.completed'
  | 'activity.failed'

/**
 * A single trace event
 */
export interface TraceEvent {
  /** Unique event ID */
  eventId: string
  
  /** Correlation ID for grouping related events */
  correlationId: string
  
  /** Trace ID for this specific trace span */
  traceId: string
  
  /** Parent trace ID (for nested calls) */
  parentTraceId?: string
  
  /** Type of event */
  eventType: TraceEventType
  
  /** Actor ID that generated this event */
  actorId: string
  
  /** Actor type */
  actorType: string
  
  /** Timestamp (ISO 8601) */
  timestamp: string
  
  /** Duration in milliseconds (for start/end events) */
  duration?: number
  
  /** Event-specific data */
  data?: Record<string, unknown>
  
  /** Error details (for error events) */
  error?: {
    message: string
    stack?: string
    code?: string
  }
}

/**
 * An actor trace - collection of related events
 */
export interface ActorTrace {
  /** Trace ID */
  traceId: string
  
  /** Correlation ID for grouping related traces */
  correlationId: string
  
  /** Parent trace ID (for nested workflows) */
  parentTraceId?: string
  
  /** Operation name */
  operation: string
  
  /** Actor ID */
  actorId: string
  
  /** Actor type */
  actorType: string
  
  /** Start timestamp */
  startTime: string
  
  /** End timestamp */
  endTime?: string
  
  /** Duration in milliseconds */
  duration?: number
  
  /** Status */
  status: 'running' | 'completed' | 'failed'
  
  /** All events in this trace */
  events: TraceEvent[]
  
  /** Child trace IDs */
  childTraces: string[]
  
  /** Metadata */
  metadata?: Record<string, unknown>
}

/**
 * Trace query options
 */
export interface TraceQuery {
  /** Filter by correlation ID */
  correlationId?: string
  
  /** Filter by trace ID */
  traceId?: string
  
  /** Filter by actor ID */
  actorId?: string
  
  /** Filter by actor type */
  actorType?: string
  
  /** Filter by operation */
  operation?: string
  
  /** Time range */
  timeRange?: {
    start: Date
    end: Date
  }
  
  /** Filter by status */
  status?: 'running' | 'completed' | 'failed'
  
  /** Limit results */
  limit?: number
}

/**
 * Trace statistics
 */
export interface TraceStats {
  /** Total traces */
  totalTraces: number
  
  /** Completed traces */
  completed: number
  
  /** Failed traces */
  failed: number
  
  /** Running traces */
  running: number
  
  /** Average duration (ms) */
  avgDuration: number
  
  /** Min duration (ms) */
  minDuration: number
  
  /** Max duration (ms) */
  maxDuration: number
  
  /** Total events */
  totalEvents: number
}
