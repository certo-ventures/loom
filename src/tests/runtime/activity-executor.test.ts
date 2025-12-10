import { describe, it, expect, beforeEach } from 'vitest'
import { ActivityExecutor } from '../../runtime/activity-executor'
import { InMemoryActivityStore } from '../../storage/in-memory-activity-store'
import { ActivitySuspendError } from '../../actor'
import type { BlobStore, MessageQueue } from '../../storage'
import type { Message } from '../../types'
import type { ActivityDefinition } from '../../activities/wasm-executor'
import { DEFAULT_RETRY_POLICIES } from '../../types'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Simple in-memory blob store for testing
 */
class InMemoryBlobStore implements BlobStore {
  private blobs = new Map<string, Buffer>()

  async upload(path: string, data: Buffer): Promise<string> {
    this.blobs.set(path, data)
    return path
  }

  async download(path: string): Promise<Buffer> {
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
}

/**
 * Simple in-memory message queue for testing
 */
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

describe('ActivityExecutor', () => {
  let activityStore: InMemoryActivityStore
  let blobStore: InMemoryBlobStore
  let messageQueue: InMemoryMessageQueue
  let executor: ActivityExecutor

  beforeEach(async () => {
    activityStore = new InMemoryActivityStore()
    blobStore = new InMemoryBlobStore()
    messageQueue = new InMemoryMessageQueue()
    
    // Use no-retry policy for faster tests
    executor = new ActivityExecutor(
      activityStore,
      blobStore,
      messageQueue,
      DEFAULT_RETRY_POLICIES.none
    )

    // Load the echo WASM module for testing
    const wasmPath = path.join(process.cwd(), 'build', 'echo.wasm')
    if (fs.existsSync(wasmPath)) {
      const wasmBytes = fs.readFileSync(wasmPath)
      await blobStore.upload('echo.wasm', wasmBytes)
    }
  })

  it('should execute activity and enqueue completion message', async () => {
    // Register activity
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

    // Create suspension error (as if actor suspended)
    const suspendError = new ActivitySuspendError(
      'act-123',
      'echo',
      { message: 'Hello Activity!', times: 2 }
    )

    // Execute the activity
    await executor.execute('actor-123', 'test-actor', suspendError)

    // Should have enqueued activity_completed message
    expect(messageQueue.messages).toHaveLength(1)
    const message = messageQueue.messages[0]

    expect(message.messageType).toBe('activity_completed')
    expect(message.actorId).toBe('actor-123')
    expect(message.payload).toHaveProperty('activityId', 'act-123')
    expect(message.payload).toHaveProperty('result')

    // Check the result
    const result = (message.payload as any).result
    expect(result).toHaveProperty('result', 'Hello Activity! Hello Activity!')
    expect(result).toHaveProperty('executedBy', 'WASM')
  })

  it('should handle activity execution failure', async () => {
    // Register activity pointing to non-existent WASM
    const definition: ActivityDefinition = {
      name: 'broken',
      version: '1.0.0',
      wasmBlobPath: 'does-not-exist.wasm',
      limits: {
        maxMemoryMB: 128,
        maxExecutionMs: 5000,
      },
    }
    await activityStore.save(definition)

    const suspendError = new ActivitySuspendError(
      'act-456',
      'broken',
      { test: 'input' }
    )

    // Execute should fail but not throw
    await executor.execute('actor-456', 'test-actor', suspendError)

    // Should have enqueued activity_failed message
    expect(messageQueue.messages).toHaveLength(1)
    const message = messageQueue.messages[0]

    expect(message.messageType).toBe('activity_failed')
    expect(message.actorId).toBe('actor-456')
    expect(message.payload).toHaveProperty('activityId', 'act-456')
    expect(message.payload).toHaveProperty('error')
  })

  it('should handle missing activity definition', async () => {
    // Don't register the activity

    const suspendError = new ActivitySuspendError(
      'act-789',
      'unknown',
      { test: 'input' }
    )

    // Execute should fail gracefully
    await executor.execute('actor-789', 'test-actor', suspendError)

    // Should have enqueued activity_failed message
    expect(messageQueue.messages).toHaveLength(1)
    const message = messageQueue.messages[0]

    expect(message.messageType).toBe('activity_failed')
    expect(message.payload).toHaveProperty('error')
    expect((message.payload as any).error).toContain('not found')
  })
})
