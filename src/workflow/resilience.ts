/**
 * Workflow Resilience Features
 * 
 * Provides retry, timeout, circuit breaker, and rate limiting
 * without external dependencies or code bloat.
 */

export interface RetryPolicy {
  maxAttempts?: number
  initialDelay?: number
  maxDelay?: number
  backoffMultiplier?: number
  retryableErrors?: string[]
}

export interface RateLimit {
  requests: number
  per: 'second' | 'minute' | 'hour'
}

export interface CircuitBreakerConfig {
  failureThreshold?: number
  successThreshold?: number
  timeout?: number
  halfOpenRequests?: number
}

export type CircuitBreakerState = 'closed' | 'open' | 'half-open'

/**
 * Circuit Breaker - Prevents cascading failures
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed'
  private failureCount = 0
  private successCount = 0
  private nextAttempt = 0
  private halfOpenAttempts = 0

  constructor(
    private name: string,
    private config: CircuitBreakerConfig = {}
  ) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      successThreshold: config.successThreshold ?? 2,
      timeout: config.timeout ?? 60000, // 1 minute
      halfOpenRequests: config.halfOpenRequests ?? 3,
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() < this.nextAttempt) {
        throw new Error(`Circuit breaker [${this.name}] is OPEN`)
      }
      // Try to transition to half-open
      this.state = 'half-open'
      this.halfOpenAttempts = 0
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess(): void {
    this.failureCount = 0

    if (this.state === 'half-open') {
      this.successCount++
      if (this.successCount >= this.config.successThreshold!) {
        this.state = 'closed'
        this.successCount = 0
      }
    }
  }

  private onFailure(): void {
    this.failureCount++
    this.successCount = 0

    if (this.state === 'half-open') {
      this.halfOpenAttempts++
      if (this.halfOpenAttempts >= this.config.halfOpenRequests!) {
        this.open()
      }
    } else if (this.failureCount >= this.config.failureThreshold!) {
      this.open()
    }
  }

  private open(): void {
    this.state = 'open'
    this.nextAttempt = Date.now() + this.config.timeout!
  }

  getState(): CircuitBreakerState {
    return this.state
  }

  reset(): void {
    this.state = 'closed'
    this.failureCount = 0
    this.successCount = 0
    this.nextAttempt = 0
    this.halfOpenAttempts = 0
  }
}

/**
 * Rate Limiter - Token bucket algorithm
 */
export class RateLimiter {
  private tokens: number
  private lastRefill: number
  private refillRate: number

  constructor(
    private name: string,
    private config: RateLimit
  ) {
    this.tokens = config.requests
    this.lastRefill = Date.now()
    
    // Calculate refill rate (tokens per ms)
    const periodMs = config.per === 'second' ? 1000 :
                     config.per === 'minute' ? 60000 : 3600000
    this.refillRate = config.requests / periodMs
  }

  async acquire(tokens: number = 1): Promise<void> {
    this.refill()

    if (this.tokens >= tokens) {
      this.tokens -= tokens
      return
    }

    // Calculate wait time
    const tokensNeeded = tokens - this.tokens
    const waitMs = tokensNeeded / this.refillRate

    await new Promise(resolve => setTimeout(resolve, waitMs))
    this.refill()
    this.tokens -= tokens
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const newTokens = elapsed * this.refillRate

    this.tokens = Math.min(this.config.requests, this.tokens + newTokens)
    this.lastRefill = now
  }

  getAvailableTokens(): number {
    this.refill()
    return Math.floor(this.tokens)
  }

  reset(): void {
    this.tokens = this.config.requests
    this.lastRefill = Date.now()
  }
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = {}
): Promise<T> {
  const maxAttempts = policy.maxAttempts ?? 3
  const initialDelay = policy.initialDelay ?? 1000
  const maxDelay = policy.maxDelay ?? 30000
  const backoffMultiplier = policy.backoffMultiplier ?? 2

  let lastError: Error | undefined
  let delay = initialDelay

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error

      // Check if error is retryable
      if (policy.retryableErrors && policy.retryableErrors.length > 0) {
        const isRetryable = policy.retryableErrors.some(msg => 
          error.message?.includes(msg)
        )
        if (!isRetryable) {
          throw error
        }
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay))
        delay = Math.min(delay * backoffMultiplier, maxDelay)
      }
    }
  }

  throw lastError || new Error('Retry failed')
}

/**
 * Execute with timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage?: string
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(timeoutMessage || `Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ])
}

/**
 * Resilience Manager - Centralized management
 */
export class ResilienceManager {
  private circuitBreakers = new Map<string, CircuitBreaker>()
  private rateLimiters = new Map<string, RateLimiter>()

  getCircuitBreaker(name: string, config?: CircuitBreakerConfig): CircuitBreaker {
    if (!this.circuitBreakers.has(name)) {
      this.circuitBreakers.set(name, new CircuitBreaker(name, config))
    }
    return this.circuitBreakers.get(name)!
  }

  getRateLimiter(name: string, config: RateLimit): RateLimiter {
    if (!this.rateLimiters.has(name)) {
      this.rateLimiters.set(name, new RateLimiter(name, config))
    }
    return this.rateLimiters.get(name)!
  }

  reset(): void {
    this.circuitBreakers.clear()
    this.rateLimiters.clear()
  }
}
