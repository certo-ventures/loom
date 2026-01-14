/**
 * Queue Metadata Store - Durable storage for BullMQ queue metadata
 * 
 * Provides parity with retry handler by persisting:
 * - Job retry configuration (attempts, backoff strategy, delays)
 * - Job lifecycle events (queued, active, completed, failed)
 * - Retry attempt history with timestamps and errors
 * - Dead letter queue metadata
 * 
 * Complements BullMQ's built-in Redis persistence with explicit tracking
 * for observability, debugging, and replay scenarios.
 */

import type { Redis } from 'ioredis'

export interface JobMetadata {
  jobId: string
  queueName: string
  data: any
  options: JobOptions
  createdAt: string
  updatedAt: string
  status: 'queued' | 'active' | 'completed' | 'failed' | 'delayed'
  attempts: number
  maxAttempts: number
}

export interface JobOptions {
  priority?: number
  delay?: number
  attempts?: number
  backoff?: {
    type: 'exponential' | 'fixed'
    delay: number
  }
  removeOnComplete?: boolean
  removeOnFail?: boolean
}

export interface JobAttempt {
  attemptNumber: number
  timestamp: string
  status: 'started' | 'completed' | 'failed'
  duration?: number
  error?: {
    message: string
    stack?: string
    type?: string
  }
  workerId?: string
}

export interface QueueStats {
  queueName: string
  totalJobs: number
  activeJobs: number
  waitingJobs: number
  completedJobs: number
  failedJobs: number
  delayedJobs: number
  lastUpdated: string
}

/**
 * Store for queue job metadata alongside BullMQ's native Redis structures
 */
export class QueueMetadataStore {
  constructor(private redis: Redis) {}

  /**
   * Record job metadata when enqueued
   */
  async recordJob(metadata: JobMetadata, updateStats = true): Promise<void> {
    const key = this.getJobMetadataKey(metadata.jobId)
    await this.redis.set(
      key,
      JSON.stringify(metadata),
      'EX',
      86400 * 7 // 7 days TTL
    )

    // Update queue stats only on initial enqueue
    if (updateStats) {
      await this.incrementQueueStat(metadata.queueName, 'totalJobs')
      await this.incrementQueueStat(metadata.queueName, 'waitingJobs')
    }
  }

  /**
   * Record job attempt (start, complete, or fail)
   */
  async recordAttempt(jobId: string, attempt: JobAttempt): Promise<void> {
    const key = this.getJobAttemptsKey(jobId)
    await this.redis.lpush(key, JSON.stringify(attempt))
    await this.redis.expire(key, 86400 * 7) // 7 days TTL

    // Update job metadata
    const metadata = await this.getJobMetadata(jobId)
    if (metadata) {
      metadata.attempts = attempt.attemptNumber
      metadata.updatedAt = attempt.timestamp
      if (attempt.status === 'started') {
        metadata.status = 'active'
        await this.decrementQueueStat(metadata.queueName, 'waitingJobs')
        await this.incrementQueueStat(metadata.queueName, 'activeJobs')
      } else if (attempt.status === 'completed') {
        metadata.status = 'completed'
        await this.decrementQueueStat(metadata.queueName, 'activeJobs')
        await this.incrementQueueStat(metadata.queueName, 'completedJobs')
      } else if (attempt.status === 'failed') {
        if (attempt.attemptNumber >= metadata.maxAttempts) {
          metadata.status = 'failed'
          await this.decrementQueueStat(metadata.queueName, 'activeJobs')
          await this.incrementQueueStat(metadata.queueName, 'failedJobs')
        } else {
          metadata.status = 'delayed'
          await this.decrementQueueStat(metadata.queueName, 'activeJobs')
          await this.incrementQueueStat(metadata.queueName, 'delayedJobs')
        }
      }
      // Update metadata without modifying stats
      await this.recordJob(metadata, false)
    }
  }

  /**
   * Get job metadata
   */
  async getJobMetadata(jobId: string): Promise<JobMetadata | null> {
    const key = this.getJobMetadataKey(jobId)
    const data = await this.redis.get(key)
    return data ? JSON.parse(data) : null
  }

  /**
   * Get job attempt history
   */
  async getJobAttempts(jobId: string): Promise<JobAttempt[]> {
    const key = this.getJobAttemptsKey(jobId)
    const attempts = await this.redis.lrange(key, 0, -1)
    return attempts.map(a => JSON.parse(a)).reverse()
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string): Promise<QueueStats | null> {
    const key = this.getQueueStatsKey(queueName)
    const data = await this.redis.hgetall(key)
    
    if (Object.keys(data).length === 0) {
      return null
    }

    return {
      queueName,
      totalJobs: parseInt(data.totalJobs || '0'),
      activeJobs: parseInt(data.activeJobs || '0'),
      waitingJobs: parseInt(data.waitingJobs || '0'),
      completedJobs: parseInt(data.completedJobs || '0'),
      failedJobs: parseInt(data.failedJobs || '0'),
      delayedJobs: parseInt(data.delayedJobs || '0'),
      lastUpdated: data.lastUpdated || new Date().toISOString()
    }
  }

  /**
   * List all queues with metadata
   */
  async listQueues(): Promise<string[]> {
    const pattern = 'queue:stats:*'
    const keys = await this.redis.keys(pattern)
    return keys.map(k => k.replace('queue:stats:', ''))
  }

  /**
   * Clean up expired job metadata (manual cleanup if needed)
   */
  async cleanupExpiredJobs(olderThanDays: number = 7): Promise<number> {
    const cutoff = Date.now() - (olderThanDays * 86400 * 1000)
    const pattern = 'queue:job:*'
    const keys = await this.redis.keys(pattern)
    
    let deleted = 0
    for (const key of keys) {
      const data = await this.redis.get(key)
      if (data) {
        const metadata: JobMetadata = JSON.parse(data)
        if (new Date(metadata.updatedAt).getTime() < cutoff) {
          await this.redis.del(key)
          await this.redis.del(this.getJobAttemptsKey(metadata.jobId))
          deleted++
        }
      }
    }
    
    return deleted
  }

  private getJobMetadataKey(jobId: string): string {
    return `queue:job:${jobId}`
  }

  private getJobAttemptsKey(jobId: string): string {
    return `queue:job:${jobId}:attempts`
  }

  private getQueueStatsKey(queueName: string): string {
    return `queue:stats:${queueName}`
  }

  private async incrementQueueStat(queueName: string, field: string): Promise<void> {
    const key = this.getQueueStatsKey(queueName)
    await this.redis.hincrby(key, field, 1)
    await this.redis.hset(key, 'lastUpdated', new Date().toISOString())
  }

  private async decrementQueueStat(queueName: string, field: string): Promise<void> {
    const key = this.getQueueStatsKey(queueName)
    const current = await this.redis.hget(key, field)
    if (current && parseInt(current) > 0) {
      await this.redis.hincrby(key, field, -1)
    }
    await this.redis.hset(key, 'lastUpdated', new Date().toISOString())
  }
}
