/**
 * Circuit Breaker Pattern Implementation
 * 
 * Protects actors from cascading failures by tracking failure rates
 * and temporarily stopping requests when threshold is exceeded.
 * 
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Circuit tripped, requests fail fast
 * - HALF_OPEN: Testing if service recovered
 * 
 * Uses Redis for shared state across distributed workers
 */

import { Redis } from 'ioredis'
import { BullMQMessageQueue } from '../storage/bullmq-message-queue'

export interface CircuitBreakerConfig {
  failureThreshold: number  // Open after N failures
  timeout: number           // Time to wait before half-open (ms)
  halfOpenRequests?: number // Requests to test in half-open (default: 3)
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

interface CircuitStats {
  state: CircuitState
  failures: number
  successes: number
  lastFailureTime: number
  halfOpenAttempts: number
}

/**
 * Circuit Breaker Manager
 * Leverages BullMQ events and Redis for shared state
 */
export class CircuitBreakerManager {
  private redis: Redis
  private messageQueue: BullMQMessageQueue

  constructor(redis: Redis, messageQueue: BullMQMessageQueue) {
    this.redis = redis
    this.messageQueue = messageQueue
    
    // Listen to BullMQ failure events across all actor queues
    this.messageQueue.onJobFailed('actor-*', async (job, error) => {
      if (job.queueName) {
        await this.recordFailure(job.queueName, error)
      }
    })
  }

  /**
   * Check if circuit allows execution
   */
  async shouldAllow(actorType: string): Promise<boolean> {
    const stats = await this.getStats(actorType)
    
    if (stats.state === 'CLOSED') {
      return true
    }
    
    if (stats.state === 'OPEN') {
      // Check if timeout has elapsed
      const now = Date.now()
      const timeSinceFailure = now - stats.lastFailureTime
      
      if (timeSinceFailure >= (await this.getConfig(actorType)).timeout) {
        // Transition to HALF_OPEN
        await this.setState(actorType, 'HALF_OPEN')
        await this.redis.set(`circuit:${actorType}:halfOpenAttempts`, 0)
        console.log(`🔄 Circuit breaker HALF_OPEN: ${actorType}`)
        return true
      }
      
      return false // Still in timeout period
    }
    
    if (stats.state === 'HALF_OPEN') {
      // Allow limited requests to test
      const config = await this.getConfig(actorType)
      const maxAttempts = config.halfOpenRequests || 3
      
      if (stats.halfOpenAttempts < maxAttempts) {
        await this.redis.incr(`circuit:${actorType}:halfOpenAttempts`)
        return true
      }
      
      return false // Max test attempts reached
    }
    
    return false
  }

  /**
   * Record successful execution
   */
  async recordSuccess(actorType: string): Promise<void> {
    const stats = await this.getStats(actorType)
    
    if (stats.state === 'HALF_OPEN') {
      // Check if enough successful test requests
      const config = await this.getConfig(actorType)
      const successCount = await this.redis.incr(`circuit:${actorType}:halfOpenSuccesses`)
      
      if (successCount >= (config.halfOpenRequests || 3)) {
        // Close circuit
        await this.setState(actorType, 'CLOSED')
        await this.redis.del(
          `circuit:${actorType}:failures`,
          `circuit:${actorType}:halfOpenAttempts`,
          `circuit:${actorType}:halfOpenSuccesses`
        )
        console.log(`✅ Circuit breaker CLOSED: ${actorType}`)
      }
    } else if (stats.state === 'CLOSED') {
      // Reset failure counter on success
      await this.redis.del(`circuit:${actorType}:failures`)
    }
  }

  /**
   * Record failure (called from BullMQ event listener)
   */
  private async recordFailure(queueName: string, error: any): Promise<void> {
    // Extract actor type from queue name (e.g., "actor-OCRWorker" -> "OCRWorker")
    const actorType = queueName.replace('actor-', '')
    
    const stats = await this.getStats(actorType)
    
    if (stats.state === 'HALF_OPEN') {
      // Any failure in HALF_OPEN immediately opens circuit
      await this.setState(actorType, 'OPEN')
      await this.redis.set(`circuit:${actorType}:lastFailure`, Date.now())
      console.error(`❌ Circuit breaker OPEN (failed during test): ${actorType}`)
      return
    }
    
    if (stats.state === 'CLOSED') {
      const failures = await this.redis.incr(`circuit:${actorType}:failures`)
      const config = await this.getConfig(actorType)
      
      if (failures >= config.failureThreshold) {
        // Open circuit
        await this.setState(actorType, 'OPEN')
        await this.redis.set(`circuit:${actorType}:lastFailure`, Date.now())
        console.error(`❌ Circuit breaker OPEN (threshold exceeded): ${actorType}`)
      }
    }
  }

  /**
   * Get current circuit stats
   */
  private async getStats(actorType: string): Promise<CircuitStats> {
    const [state, failures, lastFailure, halfOpenAttempts] = await Promise.all([
      this.redis.get(`circuit:${actorType}:state`),
      this.redis.get(`circuit:${actorType}:failures`),
      this.redis.get(`circuit:${actorType}:lastFailure`),
      this.redis.get(`circuit:${actorType}:halfOpenAttempts`)
    ])
    
    return {
      state: (state as CircuitState) || 'CLOSED',
      failures: parseInt(failures || '0'),
      successes: 0,
      lastFailureTime: parseInt(lastFailure || '0'),
      halfOpenAttempts: parseInt(halfOpenAttempts || '0')
    }
  }

  /**
   * Set circuit state
   */
  private async setState(actorType: string, state: CircuitState): Promise<void> {
    await this.redis.set(`circuit:${actorType}:state`, state)
  }

  /**
   * Get circuit breaker config for actor
   * In real implementation, this would fetch from stage definition
   */
  private async getConfig(actorType: string): Promise<CircuitBreakerConfig> {
    // Try to get config from Redis (set by orchestrator when stage starts)
    const configJson = await this.redis.get(`circuit:${actorType}:config`)
    
    if (configJson) {
      return JSON.parse(configJson)
    }
    
    // Default config
    return {
      failureThreshold: 5,
      timeout: 60000,
      halfOpenRequests: 3
    }
  }

  /**
   * Store circuit breaker config for an actor
   */
  async setConfig(actorType: string, config: CircuitBreakerConfig): Promise<void> {
    await this.redis.set(`circuit:${actorType}:config`, JSON.stringify(config))
  }

  /**
   * Manually reset circuit (for ops/debugging)
   */
  async reset(actorType: string): Promise<void> {
    await this.redis.del(
      `circuit:${actorType}:state`,
      `circuit:${actorType}:failures`,
      `circuit:${actorType}:lastFailure`,
      `circuit:${actorType}:halfOpenAttempts`,
      `circuit:${actorType}:halfOpenSuccesses`
    )
    console.log(`🔄 Circuit breaker reset: ${actorType}`)
  }

  /**
   * Get stats for monitoring
   */
  async getMonitoringStats(actorType: string): Promise<{
    state: CircuitState
    failures: number
    lastFailureTime: number | null
  }> {
    const stats = await this.getStats(actorType)
    return {
      state: stats.state,
      failures: stats.failures,
      lastFailureTime: stats.lastFailureTime > 0 ? stats.lastFailureTime : null
    }
  }
}
