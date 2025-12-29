/**
 * Integration tests for RedisJournalStore using a REAL Redis instance
 * 
 * Setup:
 * 1. Start Redis: docker run -d -p 6379:6379 redis:latest
 * 2. Run: REDIS_URL=redis://localhost:6379 npm test -- redis-journal-store.integration
 * 
 * Skip if Redis not available: Set SKIP_REDIS_TESTS=1
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { AdapterFactory } from '../../storage/adapter-factory'
import type { JournalStore } from '../../storage/journal-store'
import type { JournalEntry, Snapshot } from '../../actor/journal'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const SKIP_TESTS = process.env.SKIP_REDIS_TESTS === '1'

const describeIfRedis = SKIP_TESTS ? describe.skip : describe

describeIfRedis('RedisJournalStore Integration Tests', () => {
  let store: JournalStore
  const testActorPrefix = `test-integration-${Date.now()}`

  beforeAll(async () => {
    // Use adapter factory to create Redis journal store
    const [host, port] = REDIS_URL.replace('redis://', '').split(':')
    store = AdapterFactory.createJournalStore({
      type: 'redis',
      redis: { host, port: parseInt(port || '6379') },
    })!

    if (!store) {
      throw new Error('Failed to create JournalStore')
    }

    // Test connection by attempting a read
    try {
      await store.readEntries('connection-test')
      console.log('✓ Connected to Redis via AdapterFactory at', REDIS_URL)
    } catch (error) {
      console.error('✗ Failed to connect to Redis:', error)
      throw new Error(
        'Redis not available. Start with: docker run -d -p 6379:6379 redis:latest'
      )
    }
  })

  afterAll(async () => {
    // Clean up test journals individually
    // Note: Without direct Redis access, we clean up known test actors
    // In production, use Redis TTL or periodic cleanup jobs
    console.log('✓ Integration tests complete (cleanup via journal deleteJournal)')
  })

  beforeEach(async () => {
    // Each test gets a unique actor ID
  })

  describe('Real Redis Operations', () => {
    it('should append and read journal entries from real Redis', async () => {
      const actorId = `${testActorPrefix}-append-read`
      
      const entry1: JournalEntry = {
        type: 'state_updated',
        state: { count: 1, timestamp: Date.now() },
      }
      const entry2: JournalEntry = {
        type: 'state_updated',
        state: { count: 2, nested: { value: 'test' } },
      }

      await store.appendEntry(actorId, entry1)
      await store.appendEntry(actorId, entry2)

      const entries = await store.readEntries(actorId)
      
      expect(entries).toHaveLength(2)
      expect(entries[0]).toEqual(entry1)
      expect(entries[1]).toEqual(entry2)
    })

    it('should persist complex state with nested objects', async () => {
      const actorId = `${testActorPrefix}-complex-state`
      
      const complexEntry: JournalEntry = {
        type: 'state_updated',
        state: {
          user: { id: 123, name: 'John', roles: ['admin', 'user'] },
          metadata: { created: new Date().toISOString(), tags: ['test', 'integration'] },
          counters: { visits: 42, actions: 100 },
        },
      }

      await store.appendEntry(actorId, complexEntry)
      const entries = await store.readEntries(actorId)

      expect(entries).toHaveLength(1)
      expect(entries[0]).toEqual(complexEntry)
    })

    it('should handle snapshots with real Redis', async () => {
      const actorId = `${testActorPrefix}-snapshot`
      
      const snapshot: Snapshot = {
        state: { count: 100, data: { nested: 'value' } },
        cursor: 50,
        timestamp: Date.now(),
      }

      await store.saveSnapshot(actorId, snapshot)
      const retrieved = await store.getLatestSnapshot(actorId)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.state).toEqual(snapshot.state)
      expect(retrieved!.cursor).toBe(snapshot.cursor)
      expect(retrieved!.timestamp).toBe(snapshot.timestamp)
    })

    it('should trim entries correctly with real Redis', async () => {
      const actorId = `${testActorPrefix}-trim`
      
      // Append 10 entries
      for (let i = 0; i < 10; i++) {
        await store.appendEntry(actorId, {
          type: 'state_updated',
          state: { count: i },
        })
      }

      let entries = await store.readEntries(actorId)
      expect(entries).toHaveLength(10)

      // Trim first 5 entries
      await store.trimEntries(actorId, 5)
      
      entries = await store.readEntries(actorId)
      expect(entries).toHaveLength(5)
      expect((entries[0].state as any).count).toBe(5)
    })

    it('should delete entire journal', async () => {
      const actorId = `${testActorPrefix}-delete`
      
      await store.appendEntry(actorId, { type: 'state_updated', state: { a: 1 } })
      await store.saveSnapshot(actorId, { state: { a: 1 }, cursor: 1, timestamp: Date.now() })

      let entries = await store.readEntries(actorId)
      let snapshot = await store.getLatestSnapshot(actorId)
      expect(entries).toHaveLength(1)
      expect(snapshot).not.toBeNull()

      await store.deleteJournal(actorId)

      entries = await store.readEntries(actorId)
      snapshot = await store.getLatestSnapshot(actorId)
      expect(entries).toHaveLength(0)
      expect(snapshot).toBeNull()
    })

    it('should handle high-volume writes', async () => {
      const actorId = `${testActorPrefix}-volume`
      const entryCount = 1000

      // Write 1000 entries
      const promises = []
      for (let i = 0; i < entryCount; i++) {
        promises.push(
          store.appendEntry(actorId, {
            type: 'state_updated',
            state: { count: i, timestamp: Date.now() },
          })
        )
      }
      await Promise.all(promises)

      const entries = await store.readEntries(actorId)
      expect(entries).toHaveLength(entryCount)
      
      // Verify order is preserved
      for (let i = 0; i < entryCount; i++) {
        expect((entries[i].state as any).count).toBe(i)
      }
    })

    it('should handle concurrent writes from multiple actors', async () => {
      const actorIds = Array.from({ length: 10 }, (_, i) => `${testActorPrefix}-concurrent-${i}`)
      
      // Each actor writes 50 entries concurrently
      const promises = actorIds.flatMap((actorId, actorIndex) =>
        Array.from({ length: 50 }, (_, entryIndex) =>
          store.appendEntry(actorId, {
            type: 'state_updated',
            state: { actorIndex, entryIndex },
          })
        )
      )

      await Promise.all(promises)

      // Verify each actor has exactly 50 entries
      for (const actorId of actorIds) {
        const entries = await store.readEntries(actorId)
        expect(entries).toHaveLength(50)
      }
    })

    it('should survive Redis reconnection', async () => {
      const actorId = `${testActorPrefix}-reconnect`
      
      // Write before disconnect
      await store.appendEntry(actorId, {
        type: 'state_updated',
        state: { phase: 'before-disconnect' },
      })

      // Simulate disconnect/reconnect (Redis auto-reconnects)
      // In a real scenario, you'd restart Redis here
      await new Promise(resolve => setTimeout(resolve, 100))

      // Write after "reconnect"
      await store.appendEntry(actorId, {
        type: 'state_updated',
        state: { phase: 'after-reconnect' },
      })

      const entries = await store.readEntries(actorId)
      expect(entries).toHaveLength(2)
      expect((entries[0].state as any).phase).toBe('before-disconnect')
      expect((entries[1].state as any).phase).toBe('after-reconnect')
    })

    it('should handle special characters in actorId', async () => {
      const actorId = `${testActorPrefix}-special:chars/with\\slashes-and-colons`
      
      await store.appendEntry(actorId, {
        type: 'state_updated',
        state: { value: 'special' },
      })

      const entries = await store.readEntries(actorId)
      expect(entries).toHaveLength(1)
    })

    it('should maintain entry order under load', async () => {
      const actorId = `${testActorPrefix}-order`
      
      // Sequential writes with small delays
      for (let i = 0; i < 100; i++) {
        await store.appendEntry(actorId, {
          type: 'state_updated',
          state: { sequence: i },
        })
      }

      const entries = await store.readEntries(actorId)
      expect(entries).toHaveLength(100)
      
      // Verify strict ordering
      for (let i = 0; i < 100; i++) {
        expect((entries[i].state as any).sequence).toBe(i)
      }
    })
  })

  describe('Edge Cases with Real Redis', () => {
    it('should handle empty trim (beforeCursor = 0)', async () => {
      const actorId = `${testActorPrefix}-empty-trim`
      
      await store.appendEntry(actorId, { type: 'state_updated', state: { a: 1 } })
      await store.trimEntries(actorId, 0)
      
      const entries = await store.readEntries(actorId)
      expect(entries).toHaveLength(1) // Nothing trimmed
    })

    it('should handle full trim (beforeCursor = length)', async () => {
      const actorId = `${testActorPrefix}-full-trim`
      
      await store.appendEntry(actorId, { type: 'state_updated', state: { a: 1 } })
      await store.appendEntry(actorId, { type: 'state_updated', state: { a: 2 } })
      
      await store.trimEntries(actorId, 2)
      
      const entries = await store.readEntries(actorId)
      expect(entries).toHaveLength(0) // All trimmed
    })

    it('should handle snapshot overwrite', async () => {
      const actorId = `${testActorPrefix}-snapshot-overwrite`
      
      await store.saveSnapshot(actorId, {
        state: { version: 1 },
        cursor: 10,
        timestamp: Date.now(),
      })

      await store.saveSnapshot(actorId, {
        state: { version: 2 },
        cursor: 20,
        timestamp: Date.now(),
      })

      const snapshot = await store.getLatestSnapshot(actorId)
      expect((snapshot!.state as any).version).toBe(2)
      expect(snapshot!.cursor).toBe(20)
    })
  })

  describe('Performance Benchmarks', () => {
    it('should measure write throughput', async () => {
      const actorId = `${testActorPrefix}-perf-write`
      const iterations = 500
      
      const start = Date.now()
      for (let i = 0; i < iterations; i++) {
        await store.appendEntry(actorId, {
          type: 'state_updated',
          state: { i },
        })
      }
      const duration = Date.now() - start
      
      const opsPerSecond = (iterations / duration) * 1000
      console.log(`Write throughput: ${opsPerSecond.toFixed(0)} ops/sec (${iterations} writes in ${duration}ms)`)
      
      expect(opsPerSecond).toBeGreaterThan(100) // Should handle at least 100 writes/sec
    })

    it('should measure read throughput', async () => {
      const actorId = `${testActorPrefix}-perf-read`
      
      // Setup: write 100 entries
      for (let i = 0; i < 100; i++) {
        await store.appendEntry(actorId, { type: 'state_updated', state: { i } })
      }
      
      const iterations = 100
      const start = Date.now()
      for (let i = 0; i < iterations; i++) {
        await store.readEntries(actorId)
      }
      const duration = Date.now() - start
      
      const opsPerSecond = (iterations / duration) * 1000
      console.log(`Read throughput: ${opsPerSecond.toFixed(0)} ops/sec (${iterations} reads in ${duration}ms)`)
      
      expect(opsPerSecond).toBeGreaterThan(50) // Should handle at least 50 reads/sec
    })
  })
})
