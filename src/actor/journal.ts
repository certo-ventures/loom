/**
 * Journal entry types for deterministic replay
 */
export type JournalEntry =
  | { type: 'state_updated'; state: Record<string, unknown> }
  | { type: 'activity_scheduled'; activityId: string; name: string; input: unknown }
  | { type: 'activity_completed'; activityId: string; result: unknown }
  | { type: 'activity_failed'; activityId: string; error: string }
  | { type: 'child_spawned'; childId: string; actorType: string; input: unknown }
  | { type: 'event_received'; eventType: string; data: unknown }
  | { type: 'suspended'; reason: string }
  | InvocationJournalEntry

export interface InvocationJournalEntry {
  type: 'invocation'
  messageId: string
  timestamp: string
  payload: unknown
  metadata?: Record<string, unknown>
}

/**
 * Journal tracks all actor actions for replay
 */
export interface Journal {
  entries: JournalEntry[]
  cursor: number
}

/**
 * Context provided to actor execution
 */
export interface ActorContext {
  actorId: string
  actorType: string
  correlationId?: string
  parentActorId?: string
  parentTraceId?: string
  trace?: import('../types').TraceContext // Trace context for observability
  sharedMemory?: SharedMemory
  
  // Telemetry methods for observability
  recordEvent(eventType: string, data?: unknown): void
  recordMetric(name: string, value: number, tags?: Record<string, string>): void
  startSpan(operation: string): () => void  // Returns endSpan function
}

/**
 * Shared memory interface for distributed coordination
 */
export interface SharedMemory {
  write(key: string, value: any, options?: { seconds?: number }): Promise<void>
  read<T = any>(key: string): Promise<T | null>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  
  append(key: string, value: any, options?: { seconds?: number }): Promise<void>
  readList<T = any>(key: string): Promise<T[]>
  
  hset(key: string, field: string, value: any, options?: { seconds?: number }): Promise<void>
  hgetall<T = Record<string, any>>(key: string): Promise<T | null>
  hget<T = any>(key: string, field: string): Promise<T | null>
  
  sadd(key: string, value: any, options?: { seconds?: number }): Promise<void>
  smembers<T = any>(key: string): Promise<T[]>
  
  incr(key: string): Promise<number>
  decr(key: string): Promise<number>
}
