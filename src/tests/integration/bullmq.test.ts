import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Redis from 'ioredis'
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import type { Message } from '../../types'

describe('BullMQMessageQueue - Integration', { timeout: 10000 }, () => {
  let redis: Redis
  let queue: BullMQMessageQueue

  beforeAll(async () => {
    redis = new Redis({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    })
    queue = new BullMQMessageQueue(redis)
  })

  afterAll(async () => {
    await queue.close()
    await redis.quit()
  })

  it('should enqueue and process messages', async () => {
    const message: Message = {
      messageId: 'msg-test-1',
      actorId: 'actor-1',
      messageType: 'event',
      correlationId: 'corr-1',
      payload: { test: 'data' },
      metadata: {
        timestamp: new Date().toISOString(),
        priority: 0,
      },
    }

    let processed: Message | null = null

    queue.registerWorker('test-queue', async (msg) => {
      processed = msg
    })

    await queue.enqueue('test-queue', message)
    await new Promise(resolve => setTimeout(resolve, 500))

    expect(processed).not.toBeNull()
    expect(processed!.messageId).toBe('msg-test-1')
  })
})
