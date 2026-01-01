import { Queue, Worker, Job, JobsOptions } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Message } from '../types'
import type { MessageQueue } from './message-queue'
import { QueueMetadataStore, type JobMetadata } from './queue-metadata-store'
import type { MetricsCollector } from '../observability/types'

/**
 * BullMQ Job Options for retry, idempotency, etc.
 */
export interface BullMQJobOptions {
  jobId?: string              // For idempotency
  priority?: number
  delay?: number              // For delayed execution
  attempts?: number           // Max retries
  backoff?: {
    type: 'exponential' | 'fixed'
    delay: number
  }
  removeOnComplete?: boolean
  removeOnFail?: boolean
}

/**
 * BullMQMessageQueue - Production message queue using BullMQ/Redis
 * Generic to support different message formats
 * 
 * NOTE: Interface compatibility issue with MessageQueue - needs refactoring
 */
export interface BullMQMessageQueueOptions {
  prefix?: string
  metricsCollector?: MetricsCollector
}

export class BullMQMessageQueue implements MessageQueue {
  private queues = new Map<string, Queue>()
  private workers = new Map<string, Worker>()
  private connection: Redis
  private queuePrefix?: string
  private metadataStore: QueueMetadataStore
  private metricsCollector?: MetricsCollector

  constructor(connection: Redis, options?: BullMQMessageQueueOptions) {
    this.connection = connection
    this.queuePrefix = options?.prefix
    this.metadataStore = new QueueMetadataStore(connection)
    this.metricsCollector = options?.metricsCollector
  }

  // @ts-ignore - Interface mismatch with MessageQueue, needs refactor
  async enqueue(
    queueName: string, 
    message: Message | any, 
    options?: BullMQJobOptions
  ): Promise<void> {
    const queue = this.getOrCreateQueue(queueName)
    
    // Default jobId from message if not provided
    const jobId = options?.jobId || (message as any).messageId || message.messageId
    
    const jobOptions: JobsOptions = {
      priority: options?.priority || 0,
      jobId,
      delay: options?.delay,
      attempts: options?.attempts || 3,
      backoff: options?.backoff || {
        type: 'exponential',
        delay: 1000
      },
      removeOnComplete: options?.removeOnComplete ?? true,
      removeOnFail: options?.removeOnFail ?? false,
    }
    
    try {
      await queue.add('message', message, jobOptions)
      
      // Record job metadata for durability
      const metadata: JobMetadata = {
        jobId,
        queueName,
        data: message,
        options: {
          priority: jobOptions.priority,
          delay: jobOptions.delay,
          attempts: jobOptions.attempts,
          backoff: jobOptions.backoff,
          removeOnComplete: jobOptions.removeOnComplete,
          removeOnFail: jobOptions.removeOnFail
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: jobOptions.delay ? 'delayed' : 'queued',
        attempts: 0,
        maxAttempts: jobOptions.attempts || 3
      }
      await this.metadataStore.recordJob(metadata)
      
      // Record metrics
      this.metricsCollector?.recordMessageEvent?.('enqueued')
    } catch (error) {
      this.metricsCollector?.recordMessageEvent?.('enqueue_failed')
      if (error instanceof Error && error.message.includes('already exists')) {
        return
      }
      throw error
    }
  }

  async dequeue(queueName: string, timeoutMs: number): Promise<Message | null> {
    // BullMQ uses workers for dequeue - this is handled differently
    // For now, return null - actual processing happens via registerWorker
    return null
  }

  async ack(message: Message | any): Promise<void> {
    // Acknowledgment is handled automatically by BullMQ when job completes
    // This is a no-op in the BullMQ implementation
  }

  async nack(message: Message | any, delayMs = 0): Promise<void> {
    // BullMQ handles retries automatically
    // For manual nack, we can use job.moveToFailed()
  }

  async deadLetter(message: Message | any): Promise<void> {
    // BullMQ moves failed jobs to failed set automatically
    // This is a no-op unless we want to move to a separate DLQ
  }

  /**
   * Register a worker to process messages from a queue
   * Generic to support different message formats
   */
  registerWorker<T = Message>(
    queueName: string,
    processor: (message: T) => Promise<void>,
    concurrency = 1
  ): void {
    if (this.workers.has(queueName)) {
      return
    }

    const worker = new Worker(
      queueName,
      async (job: Job) => {
        const startTime = Date.now()
        const message = job.data as T
        
        // Record attempt start
        await this.metadataStore.recordAttempt(job.id!, {
          attemptNumber: job.attemptsMade + 1,
          timestamp: new Date().toISOString(),
          status: 'started',
          workerId: worker.id
        })
        this.metricsCollector?.recordMessageEvent?.('processing_started')
        
        try {
          await processor(message)
          
          // Record attempt completion
          const duration = Date.now() - startTime
          await this.metadataStore.recordAttempt(job.id!, {
            attemptNumber: job.attemptsMade + 1,
            timestamp: new Date().toISOString(),
            status: 'completed',
            duration,
            workerId: worker.id
          })
          this.metricsCollector?.recordMessageEvent?.('completed', duration)
        } catch (error) {
          // Record attempt failure
          const duration = Date.now() - startTime
          await this.metadataStore.recordAttempt(job.id!, {
            attemptNumber: job.attemptsMade + 1,
            timestamp: new Date().toISOString(),
            status: 'failed',
            duration,
            error: {
              message: (error as Error).message,
              stack: (error as Error).stack,
              type: (error as Error).constructor.name
            },
            workerId: worker.id
          })
          this.metricsCollector?.recordMessageEvent?.('failed')
          throw error
        }
      },
      {
        connection: this.connection,
        concurrency,
        prefix: this.queuePrefix
      }
    )

    this.workers.set(queueName, worker)
  }

  /**
   * Listen for job completion events
   */
  onJobCompleted(jobId: string, callback: (job: Job) => void): void {
    // Find queue containing this job (search all queues)
    for (const queue of this.queues.values()) {
      // @ts-ignore - BullMQ event listener type mismatch
      queue.on('completed', (job: Job) => {
        if (job.id === jobId) {
          callback(job)
        }
      })
    }
  }

  /**
   * Listen for job failure events
   */
  onJobFailed(queuePattern: string, callback: (job: Job, error: any) => void): void {
    for (const [queueName, worker] of this.workers.entries()) {
      if (queuePattern === '*' || queueName.includes(queuePattern.replace('*', ''))) {
        // @ts-ignore - BullMQ event listener type mismatch
        worker.on('failed', callback)
      }
    }
  }

  /**
   * Remove a job by ID (for cancellation)
   */
  async removeJob(jobId: string): Promise<void> {
    // Try to remove from all queues
    for (const queue of this.queues.values()) {
      const job = await queue.getJob(jobId)
      if (job) {
        await job.remove()
        return
      }
    }
  }

  /**
   * Get queue instance (for advanced operations)
   */
  getQueue(queueName: string): Queue | undefined {
    return this.queues.get(queueName)
  }

  /**
   * Get job metadata (for observability/debugging)
   */
  async getJobMetadata(jobId: string) {
    return this.metadataStore.getJobMetadata(jobId)
  }

  /**
   * Get job attempt history (for retry debugging)
   */
  async getJobAttempts(jobId: string) {
    return this.metadataStore.getJobAttempts(jobId)
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string) {
    return this.metadataStore.getQueueStats(queueName)
  }

  /**
   * List all queues
   */
  async listQueues() {
    return this.metadataStore.listQueues()
  }

  /**
   * Close all queues and workers
   */
  async close(): Promise<void> {
    await Promise.all([
      ...Array.from(this.queues.values()).map(q => q.close()),
      ...Array.from(this.workers.values()).map(w => w.close()),
    ])
    this.queues.clear()
    this.workers.clear()
  }

  private getOrCreateQueue(queueName: string): Queue {
    let queue = this.queues.get(queueName)
    
    if (!queue) {
      queue = new Queue(queueName, {
        connection: this.connection,
        prefix: this.queuePrefix
      })
      this.queues.set(queueName, queue)
    }

    return queue
  }
}
