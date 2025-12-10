import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RetryHandler } from '../../runtime/retry-handler'
import { ActivityExecutor } from '../../runtime/activity-executor'
import { InMemoryActivityStore } from '../../storage/in-memory-activity-store'
import { ActivitySuspendError } from '../../actor'
import type { BlobStore, MessageQueue } from '../../storage'
import type { Message, RetryPolicy } from '../../types'
import type { ActivityDefinition } from '../../activities/wasm-executor'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Flaky blob store that fails occasionally for testing retries
 */
class FlakyBlobStore implements BlobStore {
  private blobs = new Map<string, Buffer>()
  private attemptCount = 0
  
  constructor(private failuresBeforeSuccess: number = 2) {}

  async upload(path: string, data: Buffer): Promise<string> {
    this.blobs.set(path, data)
    return path
  }

  async download(path: string): Promise<Buffer> {
    this.attemptCount++
    
    // Fail a few times, then succeed
    if (this.attemptCount <= this.failuresBeforeSuccess) {
      throw new Error('Temporary network failure')
    }
    
    const data = this.blobs.get(path)
    if (!data) throw new Error(`Blob not found: ${path}`)
    return data
  }

  async exists(path: string): Promise<boolean> {
    return this.blobs.has(path)
  }

  async delete(path: string): Promise<void> {
    this.blobs.delete(path)
  }

  reset() {
    this.attemptCount = 0
  }
}

class InMemoryMessageQueue implements MessageQueue {
  public messages: Message[] = []

  async enqueue(queue: string, message: Message): Promise<void> {
    this.messages.push(message)
  }

  async dequeue(): Promise<Message | null> {
    return this.messages.shift() || null
  }

  async ack(): Promise<void> {}
  async nack(): Promise<void> {}
  async deadLetter(): Promise<void> {}
  async registerWorker(): Promise<void> {}
  async unregisterWorker(): Promise<void> {}
}

describe('Retry Integration', () => {
  let activityStore: InMemoryActivityStore
  let flakyBlobStore: FlakyBlobStore
  let messageQueue: InMemoryMessageQueue

  beforeEach(async () => {
    activityStore = new InMemoryActivityStore()
    flakyBlobStore = new FlakyBlobStore(2) // Fail 2 times, then succeed
    messageQueue = new InMemoryMessageQueue()

    // Load echo WASM
    const wasmPath = path.join(process.cwd(), 'build', 'echo.wasm')
    if (fs.existsSync(wasmPath)) {
      const wasmBytes = fs.readFileSync(wasmPath)
      await flakyBlobStore.upload('echo.wasm', wasmBytes)

      const definition: ActivityDefinition = {
        name: 'echo',
        version: '1.0.0',
        wasmBlobPath: 'echo.wasm',
        limits: {
          maxMemoryMB: 128,
          maxExecutionMs: 5000,
        },
      }
      await activityStore.save(definition)
    }
  })

  it('should retry activity execution on transient failures', async () => {
    // Configure retry policy
    const retryPolicy: RetryPolicy = {
      maxRetries: 3,
      initialDelayMs: 10, // Short delay for test
      maxDelayMs: 100,
      backoffMultiplier: 2,
    }

    const executor = new ActivityExecutor(
      activityStore,
      flakyBlobStore,
      messageQueue,
      retryPolicy
    )

    const suspendError = new ActivitySuspendError(
      'act-123',
      'echo',
      { message: 'Test retry', times: 2 }
    )

    // Execute - should fail 2 times then succeed
    flakyBlobStore.reset()
    await executor.execute('actor-123', 'test-actor', suspendError)

    // Should have succeeded after retries
    expect(messageQueue.messages).toHaveLength(1)
    const message = messageQueue.messages[0]
    
    expect(message.messageType).toBe('activity_completed')
    expect(message.payload).toHaveProperty('result')
  }, 10000)

  it('should send to DLQ after max retries exhausted', async () => {
    // Configure retry policy with low max retries
    const retryPolicy: RetryPolicy = {
      maxRetries: 1, // Only 1 retry
      initialDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
    }

    // Blob store that fails 5 times (more than retries allow)
    const veryFlakyStore = new FlakyBlobStore(5)
    
    const executor = new ActivityExecutor(
      activityStore,
      veryFlakyStore,
      messageQueue,
      retryPolicy
    )

    const suspendError = new ActivitySuspendError(
      'act-456',
      'echo',
      { message: 'Will fail', times: 1 }
    )

    // Execute - should exhaust retries and fail
    await executor.execute('actor-456', 'test-actor', suspendError)

    // Should have enqueued failure message
    expect(messageQueue.messages).toHaveLength(1)
    const message = messageQueue.messages[0]
    
    expect(message.messageType).toBe('activity_failed')
    expect(message.payload).toHaveProperty('error')
  }, 10000)

  it('should use exponential backoff between retries', async () => {
    const timestamps: number[] = []
    const mockOperation = vi.fn().mockImplementation(() => {
      timestamps.push(Date.now())
      throw new Error('Simulated failure')
    })

    const retryPolicy: RetryPolicy = {
      maxRetries: 3,
      initialDelayMs: 50,
      maxDelayMs: 500,
      backoffMultiplier: 2,
    }

    const retryHandler = new RetryHandler(messageQueue, retryPolicy)

    try {
      await retryHandler.withRetry(mockOperation, retryPolicy)
    } catch {
      // Expected to fail after all retries
    }

    // Should have attempted 4 times (initial + 3 retries)
    expect(mockOperation).toHaveBeenCalledTimes(4)
    
    // Check delays increased exponentially
    const delay1 = timestamps[1] - timestamps[0]
    const delay2 = timestamps[2] - timestamps[1]
    const delay3 = timestamps[3] - timestamps[2]
    
    // Each delay should be roughly 2x the previous (with jitter)
    expect(delay1).toBeGreaterThan(30) // ~50ms with jitter
    expect(delay2).toBeGreaterThan(delay1 * 0.8) // ~100ms, accounting for jitter
    expect(delay3).toBeGreaterThan(delay2 * 0.8) // ~200ms, accounting for jitter
  }, 15000)
})
