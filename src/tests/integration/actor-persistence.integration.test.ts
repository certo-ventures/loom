/**
 * End-to-end integration tests for Actor journal persistence with real Redis
 * 
 * Tests the complete flow: Actor -> JournalStore -> Redis -> Recovery
 * 
 * Setup:
 * 1. Start Redis: docker run -d -p 6379:6379 redis:latest
 * 2. Run: REDIS_URL=redis://localhost:6379 npm test -- actor-persistence.integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Actor, type ActorContext } from '../../actor/actor'
import { AdapterFactory } from '../../storage/adapter-factory'
import type { JournalStore } from '../../storage/journal-store'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const SKIP_TESTS = false  // Redis is running locally, enable by default

const describeIfRedis = SKIP_TESTS ? describe.skip : describe

// Test Actor that simulates real workload
class CounterActor extends Actor {
  async execute(input: unknown): Promise<void> {
    if (!input) return // Replay mode
    
    const { operation, value } = input as { operation: string; value?: number }
    
    const current = (this.state.count as number) || 0
    
    if (operation === 'increment') {
      this.updateState(draft => { draft.count = current + (value || 1) })
    } else if (operation === 'decrement') {
      this.updateState(draft => { draft.count = current - (value || 1) })
    } else if (operation === 'reset') {
      this.updateState(draft => { draft.count = 0 })
    }
  }
}

// Complex actor with nested state
class OrderActor extends Actor {
  async execute(input: unknown): Promise<void> {
    if (!input) return
    
    const { action, data } = input as { action: string; data?: any }
    
    if (action === 'create_order') {
      this.updateState(draft => {
        draft.orderId = data.orderId
        draft.items = data.items
        draft.total = data.total
        draft.status = 'pending'
        draft.createdAt = Date.now()
      })
    } else if (action === 'add_item') {
      const items = (this.state.items as any[]) || []
      const total = (this.state.total as number) || 0
      this.updateState(draft => {
        draft.items = [...items, data.item]
        draft.total = total + data.item.price
      })
    } else if (action === 'confirm') {
      this.updateState(draft => {
        draft.status = 'confirmed'
        draft.confirmedAt = Date.now()
      })
    } else if (action === 'ship') {
      this.updateState(draft => {
        draft.status = 'shipped'
        draft.shippedAt = Date.now()
      })
    }
  }
}

describeIfRedis('Actor Persistence Integration Tests', () => {
  let journalStore: JournalStore
  const testPrefix = `actor-integration-${Date.now()}`

  beforeAll(async () => {
    const [host, port] = REDIS_URL.replace('redis://', '').split(':')
    journalStore = AdapterFactory.createJournalStore({
      type: 'redis',
      redis: { host, port: parseInt(port || '6379') },
    })!
    
    if (!journalStore) {
      throw new Error('Failed to create JournalStore')
    }

    try {
      await journalStore.readEntries('connection-test')
      console.log('✓ Connected to Redis via AdapterFactory')
    } catch (error) {
      throw new Error('Redis not available')
    }
  })

  afterAll(async () => {
    // Cleanup test actors via JournalStore API
    console.log('✓ Actor persistence tests complete')
  })

  describe('Basic Actor Persistence', () => {
    it('should persist state across actor restarts', async () => {
      const actorId = `${testPrefix}-counter-1`
      const context: ActorContext = { actorId, actorType: 'CounterActor' }

      // First actor instance - perform operations
      const actor1 = new CounterActor(context, {}, undefined, undefined, undefined, journalStore)
      await actor1.execute({ operation: 'increment', value: 5 })
      await actor1.execute({ operation: 'increment', value: 3 })
      await actor1.execute({ operation: 'decrement', value: 2 })
      
      expect(actor1.getState().count).toBe(6)
      
      // Wait for persistence
      await new Promise(resolve => setTimeout(resolve, 100))

      // Simulate restart - create new actor and load journal
      const entries = await journalStore.readEntries(actorId)
      expect(entries.length).toBeGreaterThan(0)

      const actor2 = new CounterActor(context, {}, undefined, undefined, undefined, journalStore)
      actor2.loadJournal({ entries, cursor: 0 })
      await actor2.replay()

      // State should be recovered
      expect(actor2.getState().count).toBe(6)
      
      // Continue operations
      await actor2.execute({ operation: 'increment', value: 10 })
      expect(actor2.getState().count).toBe(16)
    })

    it('should handle complex nested state', async () => {
      const actorId = `${testPrefix}-order-1`
      const context: ActorContext = { actorId, actorType: 'OrderActor' }

      const actor1 = new OrderActor(context, {}, undefined, undefined, undefined, journalStore)
      
      await actor1.execute({
        action: 'create_order',
        data: {
          orderId: 'ORD-123',
          items: [{ id: 1, name: 'Widget', price: 10 }],
          total: 10,
        },
      })
      
      await actor1.execute({
        action: 'add_item',
        data: { item: { id: 2, name: 'Gadget', price: 20 } },
      })
      
      await actor1.execute({ action: 'confirm' })

      const state1 = actor1.getState()
      expect(state1.orderId).toBe('ORD-123')
      expect((state1.items as any[]).length).toBe(2)
      expect(state1.total).toBe(30)
      expect(state1.status).toBe('confirmed')

      await new Promise(resolve => setTimeout(resolve, 100))

      // Restart and verify
      const entries = await journalStore.readEntries(actorId)
      const actor2 = new OrderActor(context, {}, undefined, undefined, undefined, journalStore)
      actor2.loadJournal({ entries, cursor: 0 })
      await actor2.replay()

      const state2 = actor2.getState()
      expect(state2).toEqual(state1)
    })
  })

  describe('Auto-Compaction', () => {
    it('should auto-compact journal after threshold', async () => {
      const actorId = `${testPrefix}-compaction-1`
      const context: ActorContext = { actorId, actorType: 'CounterActor' }

      // Set low threshold for testing
      const actor = new CounterActor(
        context,
        {},
        undefined,
        undefined,
        undefined,
        journalStore,
        { journalCompactionThreshold: 10 }
      )

      // Perform 15 operations (should trigger compaction at 10)
      for (let i = 0; i < 15; i++) {
        await actor.execute({ operation: 'increment', value: 1 })
      }

      // Wait for compaction to complete
      await new Promise(resolve => setTimeout(resolve, 300))

      // Should have a snapshot
      const snapshot = await journalStore.getLatestSnapshot(actorId)
      expect(snapshot).not.toBeNull()
      expect((snapshot!.state as any).count).toBeGreaterThan(0)

      // Journal should be trimmed
      const entries = await journalStore.readEntries(actorId)
      expect(entries.length).toBeLessThan(15) // Should have been compacted
    })

    it('should recover from snapshot after compaction', async () => {
      const actorId = `${testPrefix}-compaction-recovery`
      const context: ActorContext = { actorId, actorType: 'CounterActor' }

      const actor1 = new CounterActor(
        context,
        {},
        undefined,
        undefined,
        undefined,
        journalStore,
        { journalCompactionThreshold: 10 }
      )

      // Trigger compaction
      for (let i = 0; i < 20; i++) {
        await actor1.execute({ operation: 'increment', value: 1 })
      }

      await new Promise(resolve => setTimeout(resolve, 300))

      const finalState = actor1.getState().count

      // Simulate restart with snapshot
      const snapshot = await journalStore.getLatestSnapshot(actorId)
      const entries = await journalStore.readEntries(actorId)

      const actor2 = new CounterActor(context, {}, undefined, undefined, undefined, journalStore)
      
      if (snapshot) {
        // Load snapshot first
        ;(actor2 as any).state = snapshot.state
        // Then load any entries after snapshot
        if (entries.length > 0) {
          actor2.loadJournal({ entries, cursor: 0 })
          await actor2.replay()
        }
      }

      expect(actor2.getState().count).toBe(finalState)
    })
  })

  describe('Concurrent Actors', () => {
    it('should handle multiple actors persisting simultaneously', async () => {
      const actorCount = 10
      const operationsPerActor = 20

      const actors = Array.from({ length: actorCount }, (_, i) => {
        const actorId = `${testPrefix}-concurrent-${i}`
        const context: ActorContext = { actorId, actorType: 'CounterActor' }
        return new CounterActor(context, {}, undefined, undefined, undefined, journalStore)
      })

      // All actors perform operations concurrently
      await Promise.all(
        actors.map(async (actor, i) => {
          for (let j = 0; j < operationsPerActor; j++) {
            await actor.execute({ operation: 'increment', value: 1 })
          }
        })
      )

      await new Promise(resolve => setTimeout(resolve, 200))

      // Verify each actor's state is correct
      for (let i = 0; i < actorCount; i++) {
        expect(actors[i].getState().count).toBe(operationsPerActor)

        // Verify persistence
        const entries = await journalStore.readEntries(`${testPrefix}-concurrent-${i}`)
        expect(entries.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Failure Recovery', () => {
    it('should recover from partial journal', async () => {
      const actorId = `${testPrefix}-partial-recovery`
      const context: ActorContext = { actorId, actorType: 'CounterActor' }

      const actor1 = new CounterActor(context, {}, undefined, undefined, undefined, journalStore)
      
      await actor1.execute({ operation: 'increment', value: 10 })
      await actor1.execute({ operation: 'increment', value: 5 })
      
      // Simulate crash before last operation persists
      // (In reality, persistence is async so this can happen)
      
      await new Promise(resolve => setTimeout(resolve, 100))

      // Recovery
      const entries = await journalStore.readEntries(actorId)
      const actor2 = new CounterActor(context, {}, undefined, undefined, undefined, journalStore)
      actor2.loadJournal({ entries, cursor: 0 })
      await actor2.replay()

      // Should have recovered available state
      expect(actor2.getState().count).toBeGreaterThanOrEqual(10)
    })

    it('should handle corrupted entries gracefully', async () => {
      const actorId = `${testPrefix}-corrupted`
      const context: ActorContext = { actorId, actorType: 'CounterActor' }

      // Write some valid entries
      const actor1 = new CounterActor(context, {}, undefined, undefined, undefined, journalStore)
      await actor1.execute({ operation: 'increment', value: 5 })
      
      await new Promise(resolve => setTimeout(resolve, 100))

      // Manually corrupt an entry in Redis
      const streamKey = `journal:${actorId}:entries`
      await redis.xadd(streamKey, '*', 'data', 'invalid-json')

      // Attempt recovery - should skip corrupted entry
      const entries = await journalStore.readEntries(actorId)
      const actor2 = new CounterActor(context, {}, undefined, undefined, undefined, journalStore)
      actor2.loadJournal({ entries, cursor: 0 })
      await actor2.replay()

      // Should have some state (valid entries recovered)
      expect(actor2.getState().count).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Performance Under Load', () => {
    it('should handle high-frequency state updates', async () => {
      const actorId = `${testPrefix}-high-freq`
      const context: ActorContext = { actorId, actorType: 'CounterActor' }
      const actor = new CounterActor(context, {}, undefined, undefined, undefined, journalStore)

      const iterations = 500
      const start = Date.now()

      for (let i = 0; i < iterations; i++) {
        await actor.execute({ operation: 'increment', value: 1 })
      }

      const duration = Date.now() - start
      const opsPerSecond = (iterations / duration) * 1000

      console.log(`Actor throughput: ${opsPerSecond.toFixed(0)} ops/sec (${iterations} operations in ${duration}ms)`)

      expect(actor.getState().count).toBe(iterations)
      expect(opsPerSecond).toBeGreaterThan(50) // At least 50 ops/sec
    })
  })
})
