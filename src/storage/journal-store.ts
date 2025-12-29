import type { JournalEntry } from '../actor/journal'

/**
 * Snapshot of actor state at a specific point in journal
 */
export interface JournalSnapshot {
  /** Actor state at snapshot time */
  state: Record<string, unknown>
  /** Journal cursor position of this snapshot */
  cursor: number
  /** Timestamp when snapshot was created */
  timestamp: number
}

/**
 * Storage interface for actor journals
 * Supports append-only logging with optional compaction via snapshots
 */
export interface JournalStore {
  /**
   * Append a journal entry for an actor
   * @param actorId - Unique actor identifier
   * @param entry - Journal entry to append
   * @returns Promise that resolves when entry is persisted
   */
  appendEntry(actorId: string, entry: JournalEntry): Promise<void>

  /**
   * Read all journal entries for an actor
   * @param actorId - Unique actor identifier
   * @returns Promise with array of entries (empty if none exist)
   */
  readEntries(actorId: string): Promise<JournalEntry[]>

  /**
   * Save a snapshot for an actor (for journal compaction)
   * @param actorId - Unique actor identifier
   * @param snapshot - State snapshot with cursor position
   * @returns Promise that resolves when snapshot is saved
   */
  saveSnapshot(actorId: string, snapshot: JournalSnapshot): Promise<void>

  /**
   * Get the latest snapshot for an actor
   * @param actorId - Unique actor identifier
   * @returns Promise with snapshot or null if none exists
   */
  getLatestSnapshot(actorId: string): Promise<JournalSnapshot | null>

  /**
   * Delete entries before a cursor position (compaction)
   * @param actorId - Unique actor identifier
   * @param beforeCursor - Delete entries before this cursor position
   * @returns Promise that resolves when entries are deleted
   */
  trimEntries(actorId: string, beforeCursor: number): Promise<void>

  /**
   * Delete all journal data for an actor
   * @param actorId - Unique actor identifier
   * @returns Promise that resolves when data is deleted
   */
  deleteJournal(actorId: string): Promise<void>
}
