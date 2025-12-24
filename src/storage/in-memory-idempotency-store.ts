/**
 * In-Memory Idempotency Store
 * 
 * Fast, lightweight implementation for development and testing.
 * Data is lost on restart - use Redis or CosmosDB for production.
 */

import type { IdempotencyRecord, IdempotencyStore } from './idempotency-store'

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private records = new Map<string, IdempotencyRecord>()
  private hits = 0
  private misses = 0
  
  constructor(
    private defaultTtlSeconds: number = 86400 // 24 hours
  ) {}
  
  async get(key: string): Promise<IdempotencyRecord | undefined> {
    const record = this.records.get(key)
    
    // Check if expired
    if (record && new Date(record.expiresAt) < new Date()) {
      this.records.delete(key)
      this.misses++
      return undefined
    }
    
    if (record) {
      this.hits++
    } else {
      this.misses++
    }
    
    return record
  }
  
  async set(record: IdempotencyRecord, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds || this.defaultTtlSeconds
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()
    
    this.records.set(record.key, {
      ...record,
      expiresAt
    })
  }
  
  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }
  
  async cleanup(): Promise<number> {
    const now = new Date()
    let cleaned = 0
    
    for (const [key, record] of this.records.entries()) {
      if (new Date(record.expiresAt) < now) {
        this.records.delete(key)
        cleaned++
      }
    }
    
    return cleaned
  }
  
  async stats(): Promise<{ totalKeys: number; hitRate?: number; avgTtl?: number }> {
    const totalRequests = this.hits + this.misses
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0
    
    // Calculate average TTL
    let totalTtl = 0
    const now = Date.now()
    
    for (const record of this.records.values()) {
      const expiresAt = new Date(record.expiresAt).getTime()
      totalTtl += Math.max(0, expiresAt - now)
    }
    
    const avgTtl = this.records.size > 0 ? totalTtl / this.records.size / 1000 : 0
    
    return {
      totalKeys: this.records.size,
      hitRate,
      avgTtl
    }
  }
  
  /**
   * Clear all records (for testing)
   */
  clear(): void {
    this.records.clear()
    this.hits = 0
    this.misses = 0
  }
}
