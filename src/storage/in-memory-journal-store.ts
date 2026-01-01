import type { JournalEntry } from '../actor/journal'
import type { JournalStore, JournalSnapshot } from './journal-store'

/**
 * In-memory journal store for testing
 * Not suitable for production - data is lost on restart
 */
export class InMemoryJournalStore implements JournalStore {
  private entries: Map<string, JournalEntry[]> = new Map()
  private snapshots: Map<string, JournalSnapshot> = new Map()

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '⚠️  [InMemoryJournalStore] Using in-memory adapter in production. ' +
        'This is not recommended for distributed systems. ' +
        'Use RedisJournalStore instead.'
      )
    }
  }

  async appendEntry(actorId: string, entry: JournalEntry): Promise<void> {
    const existing = this.entries.get(actorId) || []
    // Create new array to avoid mutation
    this.entries.set(actorId, [...existing, entry])
  }

  async readEntries(actorId: string): Promise<JournalEntry[]> {
    const entries = this.entries.get(actorId)
    // Return copy to prevent external mutation
    return entries ? [...entries] : []
  }

  async saveSnapshot(actorId: string, snapshot: JournalSnapshot): Promise<void> {
    // Deep copy to prevent mutation of stored snapshot
    this.snapshots.set(actorId, {
      state: JSON.parse(JSON.stringify(snapshot.state)),
      cursor: snapshot.cursor,
      timestamp: snapshot.timestamp,
    })
  }

  async getLatestSnapshot(actorId: string): Promise<JournalSnapshot | null> {
    const snapshot = this.snapshots.get(actorId)
    if (!snapshot) return null
    
    // Return deep copy to prevent external mutation
    return {
      state: JSON.parse(JSON.stringify(snapshot.state)),
      cursor: snapshot.cursor,
      timestamp: snapshot.timestamp,
    }
  }

  async trimEntries(actorId: string, beforeCursor: number): Promise<void> {
    if (beforeCursor < 0) {
      throw new Error('beforeCursor must be non-negative')
    }
    
    const existing = this.entries.get(actorId) || []
    if (beforeCursor > existing.length) {
      return // Cursor beyond end - nothing to do
    }
    // Keep entries from beforeCursor onwards
    // If beforeCursor === length, this removes all entries (empty slice)
    const trimmed = existing.slice(beforeCursor)
    this.entries.set(actorId, trimmed)
  }

  async deleteJournal(actorId: string): Promise<void> {
    this.entries.delete(actorId)
    this.snapshots.delete(actorId)
  }

  /** Testing utility: clear all data */
  clear(): void {
    this.entries.clear()
    this.snapshots.clear()
  }

  /** Testing utility: get stats */
  getStats(): { actors: number; totalEntries: number; snapshots: number } {
    let totalEntries = 0
    for (const entries of this.entries.values()) {
      totalEntries += entries.length
    }
    return {
      actors: this.entries.size,
      totalEntries,
      snapshots: this.snapshots.size,
    }
  }
}
