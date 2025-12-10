import { Queue, Worker, Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Message } from '../types'
import type { MessageQueue } from './message-queue'

/**
 * BullMQMessageQueue - Production message queue using BullMQ/Redis
 */
export class BullMQMessageQueue implements MessageQueue {
  private queues = new Map<string, Queue>()
  private workers = new Map<string, Worker>()
  private connection: Redis

  constructor(connection: Redis) {
    this.connection = connection
  }

  async enqueue(queueName: string, message: Message, priority = 0): Promise<void> {
    const queue = this.getOrCreateQueue(queueName)
    
    await queue.add('message', message, {
      priority,
      jobId: message.messageId,
      removeOnComplete: true,
      removeOnFail: false,
    })
  }

  async dequeue(queueName: string, timeoutMs: number): Promise<Message | null> {
    // BullMQ uses workers for dequeue - this is handled differently
    // For now, return null - actual processing happens via registerWorker
    return null
  }

  async ack(message: Message): Promise<void> {
    // Acknowledgment is handled automatically by BullMQ when job completes
    // This is a no-op in the BullMQ implementation
  }

  async nack(message: Message, delayMs = 0): Promise<void> {
    // BullMQ handles retries automatically
    // For manual nack, we can use job.moveToFailed()
  }

  async deadLetter(message: Message): Promise<void> {
    // BullMQ moves failed jobs to failed set automatically
    // This is a no-op unless we want to move to a separate DLQ
  }

  /**
   * Register a worker to process messages from a queue
   */
  registerWorker(
    queueName: string,
    processor: (message: Message) => Promise<void>,
    concurrency = 1
  ): void {
    if (this.workers.has(queueName)) {
      return
    }

    const worker = new Worker(
      queueName,
      async (job: Job) => {
        const message = job.data as Message
        await processor(message)
      },
      {
        connection: this.connection,
        concurrency,
      }
    )

    this.workers.set(queueName, worker)
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
      queue = new Queue(queueName, { connection: this.connection })
      this.queues.set(queueName, queue)
    }

    return queue
  }
}
