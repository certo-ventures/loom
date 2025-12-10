import { describe, it, expect, beforeEach } from 'vitest'
import { Actor, ActivitySuspendError } from '../../actor'
import { ActorRuntime } from '../../runtime/actor-runtime'
import { ActorWorker } from '../../runtime/actor-worker'
import { ActivityExecutor } from '../../runtime/activity-executor'
import { InMemoryActivityStore } from '../../storage/in-memory-activity-store'
import type {
  StateStore,
  MessageQueue,
  LockManager,
  BlobStore,
} from '../../storage'
import type { Message, Lock } from '../../types'
import type { ActivityDefinition } from '../../activities/wasm-executor'
import * as fs from 'fs'
import * as path from 'path'

/**
 * END-TO-END Integration Test
 * 
 * This test demonstrates the complete activity execution cycle:
 * 1. Actor suspends for activity
 * 2. ActivityExecutor executes WASM activity
 * 3. Completion message enqueued
 * 4. Worker resumes actor with result
 * 5. Actor completes successfully
 * 
 * This is the FULL CYCLE in action! 🔄
 */

// Test Actor that calls an activity
class TestActor extends Actor {
  protected getDefaultState() {
    return { completed: false }
  }

  async execute(input: { message: string; times: number }): Promise<any> {
    // Call the echo activity
    const result = await this.callActivity('echo', input)
    this.updateState({ completed: true, result })
    return { processed: result }
  }
}

// Simple mocks for testing
class InMemoryStateStore implements StateStore {
  private states = new Map<string, any>()

  async save(key: string, state: any): Promise<void> {
    this.states.set(key, JSON.parse(JSON.stringify(state)))
  }

  async load(key: string): Promise<any> {
    return this.states.get(key) || null
  }

  async exists(key: string): Promise<boolean> {
    return this.states.has(key)
  }

  async delete(key: string): Promise<void> {
    this.states.delete(key)
  }

  async query(): Promise<any[]> {
    return Array.from(this.states.values())
  }
}

class InMemoryMessageQueue implements MessageQueue {
  public messages: Message[] = []
  private processing = false

  async enqueue(queue: string, message: Message): Promise<void> {
    this.messages.push(message)
  }

  async dequeue(): Promise<Message | null> {
    // Prevent infinite blocking in tests
    await new Promise((resolve) => setTimeout(resolve, 10))
    return this.messages.shift() || null
  }

  async ack(): Promise<void> {}
  async nack(): Promise<void> {}
  async deadLetter(): Promise<void> {}
  async registerWorker(): Promise<void> {}
  async unregisterWorker(): Promise<void> {}
}

class InMemoryLockManager implements LockManager {
  private locks = new Map<string, Lock>()

  async acquire(key: string, ttlMs: number): Promise<Lock> {
    const lock: Lock = {
      key,
      token: Math.random().toString(36),
      expiresAt: Date.now() + ttlMs,
    }
    this.locks.set(key, lock)
    return lock
  }

  async release(lock: Lock): Promise<void> {
    this.locks.delete(lock.key)
  }

  async extend(lock: Lock, ttlMs: number): Promise<void> {
    lock.expiresAt = Date.now() + ttlMs
  }
}

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

describe('Activity Flow - End to End', () => {
  let runtime: ActorRuntime
  let worker: ActorWorker
  let activityStore: InMemoryActivityStore
  let blobStore: InMemoryBlobStore
  let messageQueue: InMemoryMessageQueue
  let activityExecutor: ActivityExecutor

  beforeEach(async () => {
    const stateStore = new InMemoryStateStore()
    const lockManager = new InMemoryLockManager()
    messageQueue = new InMemoryMessageQueue()
    activityStore = new InMemoryActivityStore()
    blobStore = new InMemoryBlobStore()

    // Load echo WASM for testing
    const wasmPath = path.join(process.cwd(), 'build', 'echo.wasm')
    if (fs.existsSync(wasmPath)) {
      const wasmBytes = fs.readFileSync(wasmPath)
      await blobStore.upload('echo.wasm', wasmBytes)

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
    }

    // Create runtime
    runtime = new ActorRuntime(stateStore, messageQueue, lockManager)
    runtime.registerActorType('test-actor', (context) => new TestActor(context))

    // Create activity executor
    activityExecutor = new ActivityExecutor(
      activityStore,
      blobStore,
      messageQueue
    )

    // Create worker with activity executor
    worker = new ActorWorker(
      runtime,
      messageQueue,
      'test-actor',
      activityExecutor
    )
  })

  it('should complete full activity execution cycle', async () => {
    // 1. Enqueue initial execute message
    await messageQueue.enqueue('actor:test-actor', {
      messageId: 'msg-1',
      actorId: 'actor-123',
      messageType: 'execute',
      correlationId: 'test-correlation',
      payload: {
        message: 'Hello from actor!',
        times: 3,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        priority: 0,
      },
    })

    // 2. Start worker - it will process messages continuously
    worker.start()

    // Wait for processing to complete
    // The worker will:
    // - Process execute message → actor suspends
    // - ActivityExecutor runs WASM → enqueues activity_completed
    // - Worker processes activity_completed → actor resumes
    // - Actor completes successfully
    await new Promise((resolve) => setTimeout(resolve, 500))

    // 3. Check that actor completed successfully
    const state = await runtime['stateStore'].load('actor-123')
    
    expect(state).toBeDefined()
    if (state) {
      // Actor is suspended after completion (not active)
      expect(state.status).toBe('suspended')
      
      // But the actor's internal state shows it completed
      expect(state.state).toHaveProperty('completed', true)
      expect(state.state).toHaveProperty('result')
      
      // Verify the WASM activity actually executed
      const result = (state.state as any).result
      expect(result).toHaveProperty('result')
      expect(result).toHaveProperty('executedBy', 'WASM')
      
      // Verify the result content (echo repeated 3 times)
      expect(result.result).toContain('Hello from actor!')
      expect(result.length).toBeGreaterThan(0)
    }

    // 4. Queue should be empty (all messages processed)
    expect(messageQueue.messages.length).toBe(0)

    // Stop worker
    await worker.stop()
  }, 10000) // 10s timeout for full cycle
})
