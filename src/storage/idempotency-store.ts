/**
 * Idempotency Store - Prevents duplicate execution of messages
 * 
 * Provides exactly-once semantics by storing execution results keyed by idempotencyKey.
 * When a message with an idempotency key is received:
 * 1. Check if key was already processed
 * 2. If yes, return cached result (deduplication)
 * 3. If no, execute and cache result
 * 
 * Use cases:
 * - Payment processing (prevent double charges)
 * - Order fulfillment (prevent duplicate shipments)
 * - Email notifications (prevent spam)
 * - Data pipeline events (prevent duplicate writes)
 * - AI agent tool calls (prevent duplicate API calls)
 */

/**
 * Record of a processed idempotent operation
 */
export interface IdempotencyRecord {
  /** Unique idempotency key */
  key: string
  
  /** Actor that executed this operation */
  actorId: string
  
  /** Result of the execution */
  result: any
  
  /** When this was executed (ISO 8601) */
  executedAt: string
  
  /** When this record expires (ISO 8601) */
  expiresAt: string
  
  /** Original message ID for tracing */
  messageId?: string
  
  /** Optional metadata */
  metadata?: Record<string, any>
}

/**
 * Store interface for idempotency records
 */
export interface IdempotencyStore {
  /**
   * Check if an idempotency key was already processed
   * @returns The cached record if found, undefined otherwise
   */
  get(key: string): Promise<IdempotencyRecord | undefined>
  
  /**
   * Store the result of an idempotent operation
   * @param record The execution record
   * @param ttlSeconds Time-to-live in seconds (default 24 hours)
   */
  set(record: IdempotencyRecord, ttlSeconds?: number): Promise<void>
  
  /**
   * Remove an idempotency key (for testing or manual cleanup)
   */
  delete(key: string): Promise<void>
  
  /**
   * Clean up expired keys (for stores without auto-expiration)
   * @returns Number of keys cleaned up
   */
  cleanup(): Promise<number>
  
  /**
   * Get statistics about the idempotency store
   */
  stats?(): Promise<{
    totalKeys: number
    hitRate?: number
    avgTtl?: number
  }>
}
