/**
 * Trace context for distributed tracing
 */
export interface TraceContext {
  trace_id: string
  span_id: string
}

/**
 * Message represents any communication between actors or from external sources
 */
export interface Message {
  messageId: string
  actorId: string
  messageType: 'execute' | 'event' | 'activate' | 'resume' | 'activity_completed' | 'activity_failed' | 'retry' | 'timer'
  correlationId: string
  payload: Record<string, unknown>
  trace: TraceContext // Trace context flows through all messages
  metadata: {
    timestamp: string
    sender?: string
    priority: number
    ttl?: number
    retryCount?: number // Track retry attempts
    maxRetries?: number // Maximum retries allowed
    originalMessageId?: string // For tracking retry chain
  }
}

/**
 * Actor state stored in persistence layer
 */
export interface ActorState {
  id: string
  partitionKey: string
  actorType: string
  status: 'active' | 'suspended' | 'completed' | 'failed'
  state: Record<string, unknown>
  correlationId: string
  createdAt: string
  lastActivatedAt: string
  metadata?: Record<string, unknown>
}

/**
 * RetryPolicy - Configuration for retry behavior
 */
export interface RetryPolicy {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  retryableErrors?: string[] // If specified, only retry these error types
}

/**
 * Default retry policies for different scenarios
 */
export const DEFAULT_RETRY_POLICIES = {
  // Activity execution failures
  activity: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  } as RetryPolicy,

  // Message processing failures
  message: {
    maxRetries: 5,
    initialDelayMs: 500,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
  } as RetryPolicy,

  // No retries
  none: {
    maxRetries: 0,
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
  } as RetryPolicy,
}
