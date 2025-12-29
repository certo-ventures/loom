import Redis from 'ioredis'
import type { JournalEntry } from '../actor/journal'
import type { JournalStore, JournalSnapshot } from './journal-store'

/**
 * Redis-backed journal store using Redis Streams
 * Provides durable, append-only journal storage with compaction support
 */
export class RedisJournalStore implements JournalStore {
  private readonly keyPrefix: string

  constructor(
    private readonly redis: Redis,
    options?: { keyPrefix?: string }
  ) {
    this.keyPrefix = options?.keyPrefix || 'loom:journal'
  }

  async appendEntry(actorId: string, entry: JournalEntry): Promise<void> {
    if (!actorId || actorId.trim() === '') {
      throw new Error('actorId is required')
    }
    
    try {
      const streamKey = this.makeStreamKey(actorId)
      // Use Redis Stream XADD for efficient append-only log
      // * = auto-generate ID based on timestamp
      await this.redis.xadd(
        streamKey,
        '*',
        'data',
        JSON.stringify(entry)
      )
    } catch (error) {
      console.error(`Failed to append journal entry for ${actorId}:`, error)
      throw error
    }
  }

  async readEntries(actorId: string): Promise<JournalEntry[]> {
    if (!actorId || actorId.trim() === '') {
      throw new Error('actorId is required')
    }
    
    try {
      const streamKey = this.makeStreamKey(actorId)
      
      // XRANGE reads all entries from stream (- = start, + = end)
      const entries = await this.redis.xrange(streamKey, '-', '+')
      
      return entries.map(([_id, fields]) => {
        // fields is ['data', '{"type":"..."}'']
        const data = fields[1]
        try {
          return JSON.parse(data) as JournalEntry
        } catch (parseError) {
          console.error(`Failed to parse journal entry for ${actorId}:`, parseError)
          throw new Error(`Invalid journal entry data for actor ${actorId}`)
        }
      })
    } catch (error) {
      console.error(`Failed to read journal entries for ${actorId}:`, error)
      throw error
    }
  }

  async saveSnapshot(actorId: string, snapshot: JournalSnapshot): Promise<void> {
    if (!actorId || actorId.trim() === '') {
      throw new Error('actorId is required')
    }
    
    try {
      const snapshotKey = this.makeSnapshotKey(actorId)
      await this.redis.set(snapshotKey, JSON.stringify(snapshot))
    } catch (error) {
      console.error(`Failed to save snapshot for ${actorId}:`, error)
      throw error
    }
  }

  async getLatestSnapshot(actorId: string): Promise<JournalSnapshot | null> {
    if (!actorId || actorId.trim() === '') {
      throw new Error('actorId is required')
    }
    
    try {
      const snapshotKey = this.makeSnapshotKey(actorId)
      const data = await this.redis.get(snapshotKey)
      if (!data) return null
      
      try {
        return JSON.parse(data) as JournalSnapshot
      } catch (parseError) {
        console.error(`Failed to parse snapshot for ${actorId}:`, parseError)
        // Corrupted snapshot - return null to force full replay
        return null
      }
    } catch (error) {
      console.error(`Failed to get snapshot for ${actorId}:`, error)
      throw error
    }
  }

  async trimEntries(actorId: string, beforeCursor: number): Promise<void> {
    if (!actorId || actorId.trim() === '') {
      throw new Error('actorId is required')
    }
    
    if (beforeCursor < 0) {
      throw new Error('beforeCursor must be non-negative')
    }
    
    try {
      const streamKey = this.makeStreamKey(actorId)
      
      // Check stream length without loading all entries
      const streamLength = await this.redis.xlen(streamKey)
      
      if (streamLength === 0) {
        return // No entries to trim
      }
      
      // If beforeCursor >= length, trim everything
      if (beforeCursor >= streamLength) {
        // Delete all entries by trimming to maxlen 0
        await this.redis.xtrim(streamKey, 'MAXLEN', 0)
        return
      }
      
      // Otherwise, need to find the ID at beforeCursor position
      // Use XRANGE with COUNT to get only the entry we need
      const entries = await this.redis.xrange(streamKey, '-', '+', 'COUNT', beforeCursor + 1)
      
      if (entries.length > beforeCursor) {
        const keepFromId = entries[beforeCursor][0]
        await this.redis.xtrim(streamKey, 'MINID', keepFromId)
      }
    } catch (error) {
      console.error(`Failed to trim journal entries for ${actorId}:`, error)
      throw error
    }
  }

  async deleteJournal(actorId: string): Promise<void> {
    if (!actorId || actorId.trim() === '') {
      throw new Error('actorId is required')
    }
    
    try {
      const streamKey = this.makeStreamKey(actorId)
      const snapshotKey = this.makeSnapshotKey(actorId)
      
      await Promise.all([
        this.redis.del(streamKey),
        this.redis.del(snapshotKey),
      ])
    } catch (error) {
      console.error(`Failed to delete journal for ${actorId}:`, error)
      throw error
    }
  }

  private makeStreamKey(actorId: string): string {
    return `${this.keyPrefix}:${actorId}:stream`
  }

  private makeSnapshotKey(actorId: string): string {
    return `${this.keyPrefix}:${actorId}:snapshot`
  }

  /** Get statistics about journal storage (for monitoring) */
  async getStats(): Promise<{
    totalStreams: number
    totalSnapshots: number
    sampleActorEntryCount?: number
  }> {
    const streamPattern = `${this.keyPrefix}:*:stream`
    const snapshotPattern = `${this.keyPrefix}:*:snapshot`
    
    // Count keys matching patterns
    const streamKeys = await this.scanKeys(streamPattern)
    const snapshotKeys = await this.scanKeys(snapshotPattern)
    
    // Get entry count for first stream as sample
    let sampleActorEntryCount: number | undefined
    if (streamKeys.length > 0) {
      const entries = await this.redis.xlen(streamKeys[0])
      sampleActorEntryCount = entries
    }
    
    return {
      totalStreams: streamKeys.length,
      totalSnapshots: snapshotKeys.length,
      sampleActorEntryCount,
    }
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = []
    let cursor = '0'
    
    do {
      const [nextCursor, batch] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      )
      cursor = nextCursor
      keys.push(...batch)
    } while (cursor !== '0')
    
    return keys
  }
}
