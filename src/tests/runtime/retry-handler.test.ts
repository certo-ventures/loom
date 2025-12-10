import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RetryHandler } from '../../runtime/retry-handler'
import type { Message, RetryPolicy, MessageQueue } from '../../types'

/**
 * Simple in-memory message queue for testing
 */
class InMemoryMessageQueue implements MessageQueue {
  public messages: Message[] = []
  public deadLetterMessages: Message[] = []

  async enqueue(queue: string, message: Message): Promise<void> {
    this.messages.push(message)
  }

  async dequeue(): Promise<Message | null> {
    return this.messages.shift() || null
  }

  async ack(): Promise<void> {}
  async nack(): Promise<void> {}
  
  async deadLetter(message: Message): Promise<void> {
    this.deadLetterMessages.push(message)
  }

  async registerWorker(): Promise<void> {}
  async unregisterWorker(): Promise<void> {}
}

describe('RetryHandler', () => {
  let messageQueue: InMemoryMessageQueue
  let retryHandler: RetryHandler
  let testPolicy: RetryPolicy

  beforeEach(() => {
    messageQueue = new InMemoryMessageQueue()
    testPolicy = {
      maxRetries: 3,
      initialDelayMs: 100,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
    }
    retryHandler = new RetryHandler(messageQueue, testPolicy)
  })

  describe('handleFailure', () => {
    it('should schedule retry for first failure', async () => {
      const message: Message = {
        messageId: 'msg-1',
        actorId: 'actor-1',
        messageType: 'execute',
        correlationId: 'test',
        payload: { test: 'data' },
        metadata: {
          timestamp: new Date().toISOString(),
          priority: 0,
        },
      }

      const error = new Error('Temporary failure')
      await retryHandler.handleFailure(message, error, 'test-queue')

      expect(messageQueue.messages).toHaveLength(1)
      const retryMessage = messageQueue.messages[0]
      
      expect(retryMessage.messageType).toBe('retry')
      expect(retryMessage.metadata.retryCount).toBe(1)
      expect(retryMessage.metadata.originalMessageId).toBe('msg-1')
    })

    it('should send to DLQ after max retries', async () => {
      const message: Message = {
        messageId: 'msg-1',
        actorId: 'actor-1',
        messageType: 'execute',
        correlationId: 'test',
        payload: { test: 'data' },
        metadata: {
          timestamp: new Date().toISOString(),
          priority: 0,
          retryCount: 3, // Already at max
          maxRetries: 3,
        },
      }

      const error = new Error('Permanent failure')
      await retryHandler.handleFailure(message, error, 'test-queue')

      expect(messageQueue.messages).toHaveLength(0)
      expect(messageQueue.deadLetterMessages).toHaveLength(1)
      
      const dlqMessage = messageQueue.deadLetterMessages[0]
      expect(dlqMessage.messageId).toContain('dlq-')
    })

    it('should respect custom maxRetries in message metadata', async () => {
      const message: Message = {
        messageId: 'msg-1',
        actorId: 'actor-1',
        messageType: 'execute',
        correlationId: 'test',
        payload: { test: 'data' },
        metadata: {
          timestamp: new Date().toISOString(),
          priority: 0,
          retryCount: 1,
          maxRetries: 1, // Custom limit lower than policy
        },
      }

      const error = new Error('Failure')
      await retryHandler.handleFailure(message, error, 'test-queue')

      // Should go to DLQ because retryCount (1) >= maxRetries (1)
      expect(messageQueue.deadLetterMessages).toHaveLength(1)
    })
  })

  describe('withRetry', () => {
    it('should succeed on first try', async () => {
      const operation = vi.fn().mockResolvedValue('success')
      
      const result = await retryHandler.withRetry(operation)
      
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure and eventually succeed', async () => {
      let attempts = 0
      const operation = vi.fn().mockImplementation(() => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary error')
        }
        return Promise.resolve('success')
      })

      const result = await retryHandler.withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      })

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it('should throw after max retries', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Permanent error'))

      await expect(
        retryHandler.withRetry(operation, {
          maxRetries: 2,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
        })
      ).rejects.toThrow('Permanent error')

      expect(operation).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })

    it('should apply exponential backoff', async () => {
      const timestamps: number[] = []
      const operation = vi.fn().mockImplementation(() => {
        timestamps.push(Date.now())
        throw new Error('Always fails')
      })

      try {
        await retryHandler.withRetry(operation, {
          maxRetries: 2,
          initialDelayMs: 50,
          maxDelayMs: 500,
          backoffMultiplier: 2,
        })
      } catch {
        // Expected to fail
      }

      // Check that delays increase
      // First delay should be ~50ms, second ~100ms (with jitter)
      const delay1 = timestamps[1] - timestamps[0]
      const delay2 = timestamps[2] - timestamps[1]
      
      expect(delay1).toBeGreaterThanOrEqual(30) // 50ms - 25% jitter
      expect(delay2).toBeGreaterThanOrEqual(delay1 * 0.8) // Should increase
    })
  })

  describe('retryable errors', () => {
    it('should only retry whitelisted errors', async () => {
      const policy: RetryPolicy = {
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        retryableErrors: ['timeout', 'network'],
      }

      const handler = new RetryHandler(messageQueue, policy)
      const message: Message = {
        messageId: 'msg-1',
        actorId: 'actor-1',
        messageType: 'execute',
        correlationId: 'test',
        payload: {},
        metadata: {
          timestamp: new Date().toISOString(),
          priority: 0,
        },
      }

      // Retryable error
      await handler.handleFailure(
        message,
        new Error('Connection timeout'),
        'test-queue',
        policy
      )
      expect(messageQueue.messages).toHaveLength(1)
      messageQueue.messages = []

      // Non-retryable error
      await handler.handleFailure(
        message,
        new Error('Invalid input'),
        'test-queue',
        policy
      )
      expect(messageQueue.deadLetterMessages).toHaveLength(1)
    })
  })
})
