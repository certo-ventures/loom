import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryJournalStore } from '../../storage/in-memory-journal-store'
import type { JournalEntry } from '../../actor/journal'

describe('InMemoryJournalStore', () => {
  let store: InMemoryJournalStore

  beforeEach(() => {
    store = new InMemoryJournalStore()
  })

  it('should append and read journal entries', async () => {
    const actorId = 'test-actor-1'
    const entry1: JournalEntry = { type: 'state_updated', state: { count: 1 } }
    const entry2: JournalEntry = { type: 'state_updated', state: { count: 2 } }

    await store.appendEntry(actorId, entry1)
    await store.appendEntry(actorId, entry2)

    const entries = await store.readEntries(actorId)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual(entry1)
    expect(entries[1]).toEqual(entry2)
  })

  it('should return empty array for non-existent actor', async () => {
    const entries = await store.readEntries('non-existent')
    expect(entries).toHaveLength(0)
  })

  it('should save and retrieve snapshots', async () => {
    const actorId = 'test-actor-2'
    const snapshot = {
      state: { count: 100 },
      cursor: 50,
      timestamp: Date.now(),
    }

    await store.saveSnapshot(actorId, snapshot)
    const retrieved = await store.getLatestSnapshot(actorId)

    expect(retrieved).toEqual(snapshot)
  })

  it('should return null for non-existent snapshot', async () => {
    const snapshot = await store.getLatestSnapshot('non-existent')
    expect(snapshot).toBeNull()
  })

  it('should trim entries before cursor', async () => {
    const actorId = 'test-actor-3'
    const entries: JournalEntry[] = [
      { type: 'state_updated', state: { v: 1 } },
      { type: 'state_updated', state: { v: 2 } },
      { type: 'state_updated', state: { v: 3 } },
      { type: 'state_updated', state: { v: 4 } },
      { type: 'state_updated', state: { v: 5 } },
    ]

    for (const entry of entries) {
      await store.appendEntry(actorId, entry)
    }

    // Trim first 3 entries (keep from index 3 onwards)
    await store.trimEntries(actorId, 3)

    const remaining = await store.readEntries(actorId)
    expect(remaining).toHaveLength(2)
    expect(remaining[0]).toEqual({ type: 'state_updated', state: { v: 4 } })
    expect(remaining[1]).toEqual({ type: 'state_updated', state: { v: 5 } })
  })

  it('should delete entire journal', async () => {
    const actorId = 'test-actor-4'
    
    await store.appendEntry(actorId, { type: 'state_updated', state: { count: 1 } })
    await store.saveSnapshot(actorId, { state: {}, cursor: 0, timestamp: Date.now() })

    await store.deleteJournal(actorId)

    const entries = await store.readEntries(actorId)
    const snapshot = await store.getLatestSnapshot(actorId)

    expect(entries).toHaveLength(0)
    expect(snapshot).toBeNull()
  })

  it('should track stats correctly', async () => {
    await store.appendEntry('actor-1', { type: 'state_updated', state: { a: 1 } })
    await store.appendEntry('actor-1', { type: 'state_updated', state: { a: 2 } })
    await store.appendEntry('actor-2', { type: 'state_updated', state: { b: 1 } })
    await store.saveSnapshot('actor-1', { state: {}, cursor: 2, timestamp: Date.now() })

    const stats = store.getStats()
    expect(stats.actors).toBe(2)
    expect(stats.totalEntries).toBe(3)
    expect(stats.snapshots).toBe(1)
  })
})
