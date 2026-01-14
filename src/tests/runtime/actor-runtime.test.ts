import { describe, it, expect, beforeEach } from 'vitest'
import { ActorRuntime } from '../../runtime'
import { Actor, ActorContext } from '../../actor'
import type { StateStore, MessageQueue, LockManager, Lock } from '../../storage'
import type { ActorState, Message } from '../../types'

// Simple in-memory implementations for testing
class InMemoryStateStore implements StateStore {
  private store = new Map<string, ActorState>()
  async save(actorId: string, state: ActorState): Promise<void> {
    this.store.set(actorId, state)
  }
  async load(actorId: string): Promise<ActorState | null> {
    return this.store.get(actorId) || null
  }
  async delete(actorId: string): Promise<void> {
    this.store.delete(actorId)
  }
  async query(): Promise<ActorState[]> {
    return Array.from(this.store.values())
  }
}

class InMemoryMessageQueue implements MessageQueue {
  async enqueue(): Promise<void> {}
  async dequeue(): Promise<Message | null> { return null }
  async ack(): Promise<void> {}
  async nack(): Promise<void> {}
  async deadLetter(): Promise<void> {}
}

class InMemoryLockManager implements LockManager {
  private locks = new Map<string, Lock>()
  async acquire(key: string, ttl: number): Promise<Lock | null> {
    if (this.locks.has(key)) return null
    const lock: Lock = { key, token: 'token', expiresAt: Date.now() + ttl }
    this.locks.set(key, lock)
    return lock
  }
  async release(lock: Lock): Promise<void> {
    this.locks.delete(lock.key)
  }
  async extend(): Promise<void> {}
}

// Test actor
class TestActor extends Actor {
  protected getDefaultState() {
    return { count: 0 }
  }
  async execute() {
    this.updateState(draft => { draft.count = 1 })
  }
}

describe('ActorRuntime', () => {
  let runtime: ActorRuntime
  let stateStore: InMemoryStateStore
  let messageQueue: InMemoryMessageQueue
  let lockManager: InMemoryLockManager

  beforeEach(() => {
    stateStore = new InMemoryStateStore()
    messageQueue = new InMemoryMessageQueue()
    lockManager = new InMemoryLockManager()
    runtime = new ActorRuntime(stateStore, messageQueue, lockManager)
  })

  it('should register actor types', () => {
    runtime.registerActorType('test', (ctx) => new TestActor(ctx))
    expect(true).toBe(true) // Registration doesn't throw
  })

  it('should activate an actor', async () => {
    runtime.registerActorType('test', (ctx) => new TestActor(ctx))
    
    const actor = await runtime.activateActor('actor-1', 'test')
    
    expect(actor).toBeDefined()
    expect(actor.getState()).toEqual({ count: 0 })
  })

  it('should return existing actor if already active', async () => {
    runtime.registerActorType('test', (ctx) => new TestActor(ctx))
    
    const actor1 = await runtime.activateActor('actor-1', 'test')
    const actor2 = await runtime.activateActor('actor-1', 'test')
    
    expect(actor1).toBe(actor2) // Same instance
  })

  it('should fail to activate if lock cannot be acquired', async () => {
    runtime.registerActorType('test', (ctx) => new TestActor(ctx))
    
    // Manually acquire lock
    await lockManager.acquire('actor:actor-1', 5000)
    
    await expect(
      runtime.activateActor('actor-1', 'test')
    ).rejects.toThrow('already active elsewhere')
  })

  it('should deactivate an actor and save state', async () => {
    runtime.registerActorType('test', (ctx) => new TestActor(ctx))
    
    const actor = await runtime.activateActor('actor-1', 'test')
    await actor.execute(null)
    
    await runtime.deactivateActor('actor-1')
    
    // Should be removed from active actors
    expect(runtime.getActiveActor('actor-1')).toBeNull()
    
    // State should be saved
    const saved = await stateStore.load('actor-1')
    expect(saved).not.toBeNull()
    expect(saved!.state.count).toBe(1)
  })

  it('should rehydrate actor state on reactivation', async () => {
    runtime.registerActorType('test', (ctx, state) => {
      return new TestActor(ctx, state)
    })
    
    // First activation
    const actor1 = await runtime.activateActor('actor-1', 'test')
    await actor1.execute(null)
    
    // Verify state before deactivation
    expect(actor1.getState().count).toBe(1)
    
    await runtime.deactivateActor('actor-1')
    
    // Verify state was saved
    const saved = await stateStore.load('actor-1')
    expect(saved?.state.count).toBe(1)
    
    // Reactivate
    const actor2 = await runtime.activateActor('actor-1', 'test')
    
    // State should be preserved
    expect(actor2.getState().count).toBe(1)
  })

  it('should shutdown all actors', async () => {
    runtime.registerActorType('test', (ctx) => new TestActor(ctx))
    
    await runtime.activateActor('actor-1', 'test')
    await runtime.activateActor('actor-2', 'test')
    
    await runtime.shutdown()
    
    expect(runtime.getActiveActor('actor-1')).toBeNull()
    expect(runtime.getActiveActor('actor-2')).toBeNull()
  })
})
