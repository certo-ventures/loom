/**
 * Queue Service - Wraps BullMQ/Redis queue operations
 */

import Redis from 'ioredis'
import { Queue, Worker, Job } from 'bullmq'
import { logger } from '../utils/logger'

export class QueueService {
  private queues: Map<string, Queue> = new Map()
  private workers: Map<string, Worker> = new Map()
  
  constructor(private redis: Redis) {}
  
  async publishMessage(queueName: string, data: any, options?: {
    priority?: number
    delay?: number
    tenantId?: string
  }): Promise<string> {
    logger.info('Publishing message', { queueName, tenantId: options?.tenantId })
    
    let queue = this.queues.get(queueName)
    if (!queue) {
      queue = new Queue(queueName, {
        connection: this.redis
      })
      this.queues.set(queueName, queue)
    }
    
    const job = await queue.add('message', data, {
      priority: options?.priority,
      delay: options?.delay
    })
    
    return job.id!
  }
  
  async getQueueMessages(queueName: string, options: {
    status?: 'waiting' | 'active' | 'completed' | 'failed'
    limit?: number
    tenantId: string
  }): Promise<Job[]> {
    const queue = this.queues.get(queueName)
    if (!queue) {
      return []
    }
    
    const status = options.status || 'waiting'
    const limit = options.limit || 50
    
    switch (status) {
      case 'waiting':
        return await queue.getWaiting(0, limit - 1)
      case 'active':
        return await queue.getActive(0, limit - 1)
      case 'completed':
        return await queue.getCompleted(0, limit - 1)
      case 'failed':
        return await queue.getFailed(0, limit - 1)
      default:
        return []
    }
  }
  
  async consumeMessage(queueName: string, tenantId: string): Promise<Job | null> {
    // Get next waiting job
    const messages = await this.getQueueMessages(queueName, {
      status: 'waiting',
      limit: 1,
      tenantId
    })
    
    return messages[0] || null
  }
  
  async getQueueStats(queueName: string, tenantId: string): Promise<{
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
  }> {
    const queue = this.queues.get(queueName)
    if (!queue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }
    }
    
    const counts = await queue.getJobCounts()
    
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0
    }
  }
  
  async purgeQueue(queueName: string, tenantId: string): Promise<void> {
    logger.warn('Purging queue', { queueName, tenantId })
    
    const queue = this.queues.get(queueName)
    if (queue) {
      await queue.drain()
      await queue.clean(0, 1000, 'completed')
      await queue.clean(0, 1000, 'failed')
    }
  }
  
  async shutdown(): Promise<void> {
    logger.info('Shutting down queue service')
    
    // Close all queues
    for (const queue of this.queues.values()) {
      await queue.close()
    }
    
    // Close all workers
    for (const worker of this.workers.values()) {
      await worker.close()
    }
    
    this.queues.clear()
    this.workers.clear()
  }
}
