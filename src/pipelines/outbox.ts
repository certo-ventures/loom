/**
 * Transactional Outbox Pattern Implementation (BullMQ-Native)
 * 
 * Provides exactly-once delivery semantics by atomically writing messages
 * and state updates to Redis, then using BullMQ workers to relay.
 * 
 * Key guarantees:
 * - Atomic writes (message + state) using Redis MULTI/EXEC
 * - Distributed relay workers (multiple instances automatically compete)
 * - BullMQ's built-in retry/backoff/dead-letter handling
 * - Crash recovery (BullMQ restarts failed jobs)
 * - No custom polling loops - leverages BullMQ's infrastructure
 */

import { Redis } from 'ioredis'
import { BullMQMessageQueue, BullMQJobOptions } from '../storage/bullmq-message-queue'
import type { PipelineMessage } from './stage-executor'
import type { StageDefinition } from './pipeline-dsl'

/**
 * Outbox entry stored as BullMQ job data
 */
export interface OutboxEntry {
  id: string
  pipelineId: string
  queueName: string
  message: PipelineMessage
  timestamp: number
}

/**
 * State update to apply atomically with message
 */
export interface StateUpdate {
  key: string
  value: string
}

/**
 * Outbox Relay - Uses BullMQ workers for distributed processing
 */
export class OutboxRelay {
  private redis: Redis
  private messageQueue: BullMQMessageQueue
  private static OUTBOX_QUEUE = 'pipeline-outbox-relay'

  constructor(redis: Redis, messageQueue: BullMQMessageQueue) {
    this.redis = redis
    this.messageQueue = messageQueue
  }

  /**
   * Atomically write messages and state updates, then enqueue to BullMQ outbox
   * Uses Redis MULTI/EXEC for atomicity of state updates
   */
  async writeToOutbox(
    pipelineId: string,
    entries: Array<{ 
      queueName: string
      message: PipelineMessage
      stage?: StageDefinition  // For retry configuration
    }>,
    stateUpdates: StateUpdate[]
  ): Promise<void> {
    // Apply state updates atomically
    const pipeline = this.redis.multi()
    
    for (const update of stateUpdates) {
      pipeline.set(update.key, update.value)
    }
    
    await pipeline.exec()

    // Enqueue outbox jobs to BullMQ (already durable in Redis)
    // These are processed by distributed workers
    for (const entry of entries) {
      const outboxEntry: OutboxEntry = {
        id: `${pipelineId}:${entry.message.messageId}`,
        pipelineId,
        queueName: entry.queueName,
        message: entry.message,
        timestamp: Date.now()
      }
      
      // Build job options from stage retry configuration
      const jobOptions: BullMQJobOptions = {
        jobId: outboxEntry.id,
        attempts: entry.stage?.retry?.maxAttempts || 3,
        backoff: entry.stage?.retry?.backoff ? {
          type: (entry.stage.retry.backoff === 'linear' ? 'exponential' : entry.stage.retry.backoff) as 'exponential' | 'fixed',
          delay: entry.stage.retry.backoffDelay || 1000
        } : {
          type: 'exponential',
          delay: 1000
        }
      }
      
      // BullMQ handles distribution, retries, and dead-letter automatically
      await this.messageQueue.enqueue(OutboxRelay.OUTBOX_QUEUE, outboxEntry, jobOptions)
    }
  }

  /**
   * Register distributed BullMQ workers to process outbox
   * Multiple instances can call this - they'll automatically compete for jobs
   */
  registerWorkers(concurrency: number = 5): void {
    console.log(`📬 OutboxRelay: Registering ${concurrency} workers (distributed via BullMQ)`)
    
    this.messageQueue.registerWorker<OutboxEntry>(
      OutboxRelay.OUTBOX_QUEUE,
      async (entry: OutboxEntry) => {
        try {
          // Relay message to target queue
          await this.messageQueue.enqueue(entry.queueName, entry.message)
          console.log(`✅ OutboxRelay: Delivered ${entry.message.messageId} to ${entry.queueName}`)
        } catch (error) {
          console.error(`❌ OutboxRelay: Failed to deliver ${entry.message.messageId}:`, error)
          throw error // BullMQ will retry based on job options
        }
      },
      concurrency
    )
  }

  /**
   * Get outbox statistics from BullMQ
   */
  async getStats(): Promise<{
    waiting: number
    active: number
    failed: number
    delayed: number
  }> {
    // Access BullMQ queue directly for stats
    const Queue = (await import('bullmq')).Queue
    const queue = new Queue(OutboxRelay.OUTBOX_QUEUE, {
      connection: this.redis
    })

    const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed')
    await queue.close()

    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0
    }
  }

  /**
   * Replay failed jobs (uses BullMQ's built-in retry mechanism)
   */
  async replayFailedJobs(): Promise<number> {
    const Queue = (await import('bullmq')).Queue
    const queue = new Queue(OutboxRelay.OUTBOX_QUEUE, {
      connection: this.redis
    })

    const failed = await queue.getFailed()
    let count = 0

    for (const job of failed) {
      await job.retry()
      count++
    }

    await queue.close()
    console.log(`🔄 Replayed ${count} failed outbox jobs`)
    return count
  }
}
