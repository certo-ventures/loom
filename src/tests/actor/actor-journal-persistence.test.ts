import { describe, it, expect, beforeEach } from 'vitest'
import { Actor, type ActorContext } from '../../actor/actor'
import { InMemoryJournalStore } from '../../storage/in-memory-journal-store'

class TestActor extends Actor {
  async execute(input: unknown): Promise<void> {
    // During replay, input is null - just replay state changes
    if (!input) return
    
    const { operation, value } = input as { operation: string; value: number }
    
    if (operation === 'increment') {
      const current = (this.state.count as number) || 0
      this.updateState(draft => { draft.count = current + value })
    }
  }
}

describe('Actor with JournalStore', () => {
  let journalStore: InMemoryJournalStore

  beforeEach(() => {
    journalStore = new InMemoryJournalStore()
  })

  it('should persist journal entries during execution', async () => {
    const context: ActorContext = {
      actorId: 'test-1',
      actorType: 'TestActor',
    }

    const actor = new TestActor(context, {}, undefined, undefined, undefined, journalStore)
    
    await actor.execute({ operation: 'increment', value: 5 })
    await actor.execute({ operation: 'increment', value: 3 })

    // Check persisted entries
    const entries = await journalStore.readEntries('test-1')
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some(e => e.type === 'state_updated')).toBe(true)
  })

  it('should load journal on actor restart', async () => {
    const context: ActorContext = {
      actorId: 'test-2',
      actorType: 'TestActor',
    }

    // First actor instance
    const actor1 = new TestActor(context, {}, undefined, undefined, undefined, journalStore)
    await actor1.execute({ operation: 'increment', value: 10 })
    
    const state1 = actor1.getState()
    expect(state1.count).toBe(10)

    // Simulate restart - load journal
    const entries = await journalStore.readEntries('test-2')
    const actor2 = new TestActor(context, {}, undefined, undefined, undefined, journalStore)
    actor2.loadJournal({ entries, cursor: 0 })
    await actor2.replay()
    
    const state2 = actor2.getState()
    expect(state2.count).toBe(10)
  })

  it('should support compaction', async () => {
    const context: ActorContext = {
      actorId: 'test-3',
      actorType: 'TestActor',
    }

    const actor = new TestActor(context, {}, undefined, undefined, undefined, journalStore)
    
    // Create exactly 100 entries to trigger auto-compaction
    for (let i = 0; i < 100; i++) {
      await actor.execute({ operation: 'increment', value: 1 })
    }

    // Wait for any in-flight operations to complete
    await new Promise(resolve => setTimeout(resolve, 200))

    // Manually compact to ensure it happens
    await actor.compactJournal()

    // Wait for compaction to complete
    await new Promise(resolve => setTimeout(resolve, 50))

    // Verify snapshot was saved with correct state
    const snapshot = await journalStore.getLatestSnapshot('test-3')
    expect(snapshot).not.toBeNull()
    expect(snapshot?.state.count).toBe(100)

    // Entries should be trimmed (empty after compaction)
    const entries = await journalStore.readEntries('test-3')
    expect(entries.length).toBe(0)
  })

  it('should restore from snapshot on restart', async () => {
    const context: ActorContext = {
      actorId: 'test-4',
      actorType: 'TestActor',
    }

    // Build up state and compact
    const actor1 = new TestActor(context, {}, undefined, undefined, undefined, journalStore)
    for (let i = 0; i < 50; i++) {
      await actor1.execute({ operation: 'increment', value: 1 })
    }
    await actor1.compactJournal()

    // Continue adding entries
    await actor1.execute({ operation: 'increment', value: 10 })
    
    expect(actor1.getState().count).toBe(60)

    // Simulate restart with snapshot
    const snapshot = await journalStore.getLatestSnapshot('test-4')
    const entries = await journalStore.readEntries('test-4')
    
    const actor2 = new TestActor(context, snapshot?.state, undefined, undefined, undefined, journalStore)
    actor2.loadJournal({ entries, cursor: 0 })
    await actor2.replay()

    expect(actor2.getState().count).toBe(60)
  })
})
