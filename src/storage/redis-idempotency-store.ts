/**
 * Redis Idempotency Store
 * 
 * Production-ready implementation with automatic TTL expiration.
 * Fast, distributed, and perfect for high-throughput systems.
 */

import type { Redis } from 'ioredis'
import type { IdempotencyRecord, IdempotencyStore } from './idempotency-store'

export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly keyPrefix = 'loom:idempotency:'
  
  constructor(
    private redis: Redis,
    private defaultTtlSeconds: number = 86400 // 24 hours
  ) {}
  
  async get(key: string): Promise<IdempotencyRecord | undefined> {
    const data = await this.redis.get(this.makeKey(key))
    
    if (!data) {
      return undefined
    }
    
    try {
      return JSON.parse(data) as IdempotencyRecord
    } catch (error) {
      // Corrupted data - delete and return undefined
      await this.delete(key)
      return undefined
    }
  }
  
  async set(record: IdempotencyRecord, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds || this.defaultTtlSeconds
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()
    
    const fullRecord: IdempotencyRecord = {
      ...record,
      expiresAt
    }
    
    await this.redis.setex(
      this.makeKey(record.key),
      ttl,
      JSON.stringify(fullRecord)
    )
  }
  
  async delete(key: string): Promise<void> {
    await this.redis.del(this.makeKey(key))
  }
  
  async cleanup(): Promise<number> {
    // Redis auto-expires keys with TTL, so cleanup is a no-op
    // Return 0 to indicate no manual cleanup needed
    return 0
  }
  
  async stats(): Promise<{ totalKeys: number; hitRate?: number }> {
    // Count keys matching our prefix
    const pattern = `${this.keyPrefix}*`
    let totalKeys = 0
    let cursor = '0'
    
    do {
      const [newCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      )
      cursor = newCursor
      totalKeys += keys.length
    } while (cursor !== '0')
    
    // Note: Redis doesn't track hit rate per key prefix
    // You'd need Redis INFO stats for global hit rate
    return {
      totalKeys
    }
  }
  
  /**
   * Batch get multiple keys (optimization for high-throughput scenarios)
   */
  async getBatch(keys: string[]): Promise<Map<string, IdempotencyRecord>> {
    if (keys.length === 0) {
      return new Map()
    }
    
    const redisKeys = keys.map(k => this.makeKey(k))
    const values = await this.redis.mget(...redisKeys)
    
    const results = new Map<string, IdempotencyRecord>()
    
    for (let i = 0; i < keys.length; i++) {
      const value = values[i]
      if (value) {
        try {
          results.set(keys[i], JSON.parse(value))
        } catch {
          // Skip corrupted data
        }
      }
    }
    
    return results
  }
  
  /**
   * Batch set multiple records (optimization for high-throughput scenarios)
   */
  async setBatch(records: IdempotencyRecord[], ttlSeconds?: number): Promise<void> {
    if (records.length === 0) {
      return
    }
    
    const ttl = ttlSeconds || this.defaultTtlSeconds
    const pipeline = this.redis.pipeline()
    
    for (const record of records) {
      const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()
      const fullRecord: IdempotencyRecord = { ...record, expiresAt }
      
      pipeline.setex(
        this.makeKey(record.key),
        ttl,
        JSON.stringify(fullRecord)
      )
    }
    
    await pipeline.exec()
  }
  
  private makeKey(key: string): string {
    return `${this.keyPrefix}${key}`
  }
}
