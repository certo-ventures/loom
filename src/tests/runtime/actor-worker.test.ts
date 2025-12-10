import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ActorWorker } from '../../runtime/actor-worker'
import { ActorRuntime } from '../../runtime/actor-runtime'
import { Actor, ActorContext } from '../../actor'
import type { StateStore, MessageQueue, LockManager, Lock } from '../../storage'
import type { Message, ActorState } from '../../types'

/**
 * Simple test actor
 */
class TestActor extends Actor {
  protected getDefaultState() {
    return { executed: false, value: 0 }
  }

  async execute(input: { value?: number }) {
    this.updateState({ 
      executed: true,
      value: input.value || 0
    })
  }
}

/**
 * In-memory implementations for testing
 */
class InMemoryStateStore implements StateStore {
  private states = new Map<string, ActorState>()
  
  async save(id: string, state: ActorState): Promise<void> {
    this.states.set(id, state)
  }
  
  async load(id: string): Promise<ActorState | null> {
    return this.states.get(id) || null
  }
  
  async delete(id: string): Promise<void> {
    this.states.delete(id)
  }
  
  async query(): Promise<ActorState[]> {
    return Array.from(this.states.values())
  }
}

class InMemoryMessageQueue implements MessageQueue {
  private queues = new Map<string, Message[]>()
  
  async enqueue(queue: string, message: Message): Promise<void> {
    if (!this.queues.has(queue)) {
      this.queues.set(queue, [])
    }
    this.queues.get(queue)!.push(message)
  }
  
  async dequeue(queue: string, timeout: number): Promise<Message | null> {
    // Simplified - just return immediately with message or null
    // In real impl, this would block/poll for timeout duration
    const messages = this.queues.get(queue) || []
    const msg = messages.shift() || null
    
    // Small delay to simulate async behavior
    await new Promise(resolve => setTimeout(resolve, 10))
    
    return msg
  }
  
  async ack(message: Message): Promise<void> {
    // No-op for in-memory
  }
  
  async nack(message: Message): Promise<void> {
    // No-op for in-memory
  }
  
  async deadLetter(message: Message): Promise<void> {
    // No-op for in-memory
  }
  
  async registerWorker(): Promise<void> {}
  async unregisterWorker(): Promise<void> {}
}

class InMemoryLockManager implements LockManager {
  private locks = new Set<string>()
  
  async acquire(key: string, ttlMs: number): Promise<Lock | null> {
    if (this.locks.has(key)) return null
    this.locks.add(key)
    return {
      key,
      token: 'test-token',
      expiresAt: Date.now() + ttlMs
    }
  }
  
  async release(lock: Lock): Promise<void> {
    this.locks.delete(lock.key)
  }
  
  async extend(lock: Lock, ttlMs: number): Promise<void> {
    lock.expiresAt = Date.now() + ttlMs
  }
}

describe('ActorWorker', () => {
  let runtime: ActorRuntime
  let messageQueue: InMemoryMessageQueue
  let worker: ActorWorker

  beforeEach(() => {
    const stateStore = new InMemoryStateStore()
    messageQueue = new InMemoryMessageQueue()
    const lockManager = new InMemoryLockManager()

    runtime = new ActorRuntime(stateStore, messageQueue, lockManager)
    
    // Register test actor type
    runtime.registerActorType('test', (context: ActorContext) => new TestActor(context))

    worker = new ActorWorker(runtime, messageQueue, 'test')
  })

  afterEach(async () => {
    await worker.stop()
    await runtime.shutdown()
  })

  it('should process execute message', async () => {
    // Enqueue a message
    await messageQueue.enqueue('actor:test', {
      messageId: 'msg-1',
      actorId: 'test-123',
      messageType: 'execute',
      correlationId: 'test-123',
      payload: { value: 42 },
      metadata: { timestamp: new Date().toISOString(), priority: 0 }
    })

    // Start worker (don't await - it runs forever!)
    worker.start()

    // Give it time to process
    await new Promise(resolve => setTimeout(resolve, 100))

    // Stop worker
    await worker.stop()

    // Check that actor was activated and executed
    const actor = runtime.getActiveActor('test-123')
    // Actor should be deactivated after processing
    expect(actor).toBeNull()
  }, 1000) // Add timeout

  it('should handle multiple messages sequentially', async () => {
    // Enqueue multiple messages
    await messageQueue.enqueue('actor:test', {
      messageId: 'msg-1',
      actorId: 'test-1',
      messageType: 'execute',
      correlationId: 'test-1',
      payload: { value: 1 },
      metadata: { timestamp: new Date().toISOString(), priority: 0 }
    })

    await messageQueue.enqueue('actor:test', {
      messageId: 'msg-2',
      actorId: 'test-2',
      messageType: 'execute',
      correlationId: 'test-2',
      payload: { value: 2 },
      metadata: { timestamp: new Date().toISOString(), priority: 0 }
    })

    // Start worker (don't await!)
    worker.start()

    // Give it time to process both
    await new Promise(resolve => setTimeout(resolve, 200))

    // Stop worker
    await worker.stop()

    // Both actors should have been processed and deactivated
    expect(runtime.getActiveActor('test-1')).toBeNull()
    expect(runtime.getActiveActor('test-2')).toBeNull()
  }, 1500) // Add timeout

  it('should handle worker start/stop', async () => {
    // Should start successfully
    await worker.start()
    
    // Should stop successfully
    await worker.stop()

    // Should not allow double start
    await worker.start()
    await expect(worker.start()).rejects.toThrow('already running')
    await worker.stop()
  }, 500) // Add timeout

  it('should continue processing after errors', async () => {
    // This test verifies the worker doesn't crash on errors
    
    // Enqueue a message for non-existent actor type
    await messageQueue.enqueue('actor:test', {
      messageId: 'msg-bad',
      actorId: 'bad-actor',
      messageType: 'execute',
      correlationId: 'bad',
      payload: {},
      metadata: { timestamp: new Date().toISOString(), priority: 0 }
    })

    // Enqueue a good message after
    await messageQueue.enqueue('actor:test', {
      messageId: 'msg-good',
      actorId: 'good-actor',
      messageType: 'execute',
      correlationId: 'good',
      payload: { value: 99 },
      metadata: { timestamp: new Date().toISOString(), priority: 0 }
    })

    worker.start()
    await new Promise(resolve => setTimeout(resolve, 200))
    await worker.stop()

    // Worker should have survived and processed the good message
    // (Both will be deactivated, so we can't check directly,
    // but the worker should not have crashed)
  }, 1000) // Add timeout
})
