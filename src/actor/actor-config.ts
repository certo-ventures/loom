/**
 * Per-Actor Infrastructure Configuration
 * 
 * Allows actors to specify their own timeout, retry policies, 
 * backoff strategies, message ordering, eviction priorities, 
 * and dead letter queue settings.
 */

/**
 * Retry policy for actor message processing
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number
  
  /** Backoff strategy (default: 'exponential') */
  backoff?: 'exponential' | 'linear' | 'fixed'
  
  /** Initial delay in ms (default: 1000) */
  initialDelayMs?: number
  
  /** Maximum delay in ms (default: 60000) */
  maxDelayMs?: number
  
  /** Backoff multiplier for exponential (default: 2) */
  multiplier?: number
}

/**
 * Per-actor infrastructure configuration
 */
export interface ActorInfrastructureConfig {
  /** 
   * Execution timeout in milliseconds
   * Actor execution will be terminated if it exceeds this duration
   * Default: 30000 (30s)
   */
  timeout?: number
  
  /**
   * Retry policy for failed message processing
   * Default: { maxAttempts: 3, backoff: 'exponential' }
   */
  retryPolicy?: RetryPolicy
  
  /**
   * Idempotency TTL in seconds
   * How long to remember processed idempotency keys
   * Default: 86400 (24 hours)
   */
  idempotencyTtl?: number
  
  /**
   * Message ordering guarantee
   * - 'fifo': Strict first-in-first-out ordering (slower)
   * - 'standard': Best-effort ordering (faster)
   * Default: 'standard'
   */
  messageOrdering?: 'fifo' | 'standard'
  
  /**
   * Eviction priority for actor pool management
   * - 'high': Keep in pool longer (critical actors)
   * - 'medium': Standard eviction policy
   * - 'low': Evict quickly (short-lived actors)
   * Default: 'medium'
   */
  evictionPriority?: 'high' | 'medium' | 'low'
  
  /**
   * Enable dead letter queue for failed messages
   * If true, messages that exhaust retries are sent to DLQ
   * Default: true
   */
  deadLetterQueue?: boolean
  
  /**
   * Maximum concurrent messages being processed
   * Limits parallelism for this actor type
   * Default: 1 (sequential processing)
   */
  concurrency?: number
  
  /**
   * Journal compaction threshold
   * Number of journal entries before auto-compaction triggers
   * Set to 0 to disable auto-compaction
   * Default: 100
   */
  journalCompactionThreshold?: number
}

/**
 * Default infrastructure configuration
 */
export const DEFAULT_ACTOR_CONFIG: Required<ActorInfrastructureConfig> = {
  timeout: 30000,
  retryPolicy: {
    maxAttempts: 3,
    backoff: 'exponential',
    initialDelayMs: 1000,
    maxDelayMs: 60000,
    multiplier: 2,
  },
  idempotencyTtl: 86400,
  messageOrdering: 'standard',
  evictionPriority: 'medium',
  deadLetterQueue: true,
  concurrency: 1,
  journalCompactionThreshold: 100,
}

/**
 * Merge actor config with defaults
 */
export function mergeActorConfig(
  config?: ActorInfrastructureConfig
): Required<ActorInfrastructureConfig> {
  if (!config) {
    return DEFAULT_ACTOR_CONFIG
  }
  
  return {
    timeout: config.timeout ?? DEFAULT_ACTOR_CONFIG.timeout,
    retryPolicy: {
      maxAttempts: config.retryPolicy?.maxAttempts ?? DEFAULT_ACTOR_CONFIG.retryPolicy.maxAttempts,
      backoff: config.retryPolicy?.backoff ?? DEFAULT_ACTOR_CONFIG.retryPolicy.backoff,
      initialDelayMs: config.retryPolicy?.initialDelayMs ?? DEFAULT_ACTOR_CONFIG.retryPolicy.initialDelayMs,
      maxDelayMs: config.retryPolicy?.maxDelayMs ?? DEFAULT_ACTOR_CONFIG.retryPolicy.maxDelayMs,
      multiplier: config.retryPolicy?.multiplier ?? DEFAULT_ACTOR_CONFIG.retryPolicy.multiplier,
    },
    idempotencyTtl: config.idempotencyTtl ?? DEFAULT_ACTOR_CONFIG.idempotencyTtl,
    messageOrdering: config.messageOrdering ?? DEFAULT_ACTOR_CONFIG.messageOrdering,
    evictionPriority: config.evictionPriority ?? DEFAULT_ACTOR_CONFIG.evictionPriority,
    deadLetterQueue: config.deadLetterQueue ?? DEFAULT_ACTOR_CONFIG.deadLetterQueue,
    concurrency: config.concurrency ?? DEFAULT_ACTOR_CONFIG.concurrency,
    journalCompactionThreshold: config.journalCompactionThreshold ?? DEFAULT_ACTOR_CONFIG.journalCompactionThreshold,
  }
}

/**
 * Calculate retry delay based on backoff strategy
 */
export function calculateRetryDelay(
  retryPolicy: RetryPolicy,
  attemptNumber: number
): number {
  const { backoff = 'exponential', initialDelayMs = 1000, maxDelayMs = 60000, multiplier = 2 } = retryPolicy
  
  let delay: number
  
  switch (backoff) {
    case 'exponential':
      delay = initialDelayMs * Math.pow(multiplier, attemptNumber - 1)
      break
    case 'linear':
      delay = initialDelayMs * attemptNumber
      break
    case 'fixed':
      delay = initialDelayMs
      break
  }
  
  return Math.min(delay, maxDelayMs)
}
