/**
 * CosmosDB Idempotency Store
 * 
 * Globally distributed implementation with automatic TTL expiration.
 * Perfect for multi-region deployments requiring strong consistency.
 */

import type { Container } from '@azure/cosmos'
import type { IdempotencyRecord, IdempotencyStore } from './idempotency-store'

/**
 * CosmosDB document for idempotency records
 */
interface CosmosIdempotencyDocument extends IdempotencyRecord {
  id: string // CosmosDB requires 'id' field
  ttl?: number // CosmosDB TTL in seconds
}

export class CosmosIdempotencyStore implements IdempotencyStore {
  constructor(
    private container: Container,
    private defaultTtlSeconds: number = 86400 // 24 hours
  ) {}
  
  async get(key: string): Promise<IdempotencyRecord | undefined> {
    try {
      const { resource } = await this.container
        .item(key, key) // id, partitionKey
        .read<CosmosIdempotencyDocument>()
      
      if (!resource) {
        return undefined
      }
      
      // Remove CosmosDB-specific fields
      const { id, ttl, ...record } = resource
      return record as IdempotencyRecord
    } catch (error: any) {
      if (error.code === 404) {
        return undefined
      }
      throw error
    }
  }
  
  async set(record: IdempotencyRecord, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds || this.defaultTtlSeconds
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()
    
    const document: CosmosIdempotencyDocument = {
      ...record,
      id: record.key, // CosmosDB requires 'id'
      expiresAt,
      ttl // CosmosDB auto-deletes after TTL seconds
    }
    
    await this.container.items.upsert(document)
  }
  
  async delete(key: string): Promise<void> {
    try {
      await this.container.item(key, key).delete()
    } catch (error: any) {
      // Ignore 404 - already deleted
      if (error.code !== 404) {
        throw error
      }
    }
  }
  
  async cleanup(): Promise<number> {
    // CosmosDB auto-expires documents with TTL, so cleanup is a no-op
    // Return 0 to indicate no manual cleanup needed
    return 0
  }
  
  async stats(): Promise<{ totalKeys: number }> {
    // Query to count all idempotency records
    const querySpec = {
      query: 'SELECT VALUE COUNT(1) FROM c'
    }
    
    const { resources } = await this.container.items
      .query<number>(querySpec)
      .fetchAll()
    
    return {
      totalKeys: resources[0] || 0
    }
  }
  
  /**
   * Query records by actor ID (useful for debugging/monitoring)
   */
  async getByActorId(actorId: string, limit: number = 100): Promise<IdempotencyRecord[]> {
    const querySpec = {
      query: 'SELECT * FROM c WHERE c.actorId = @actorId ORDER BY c.executedAt DESC OFFSET 0 LIMIT @limit',
      parameters: [
        { name: '@actorId', value: actorId },
        { name: '@limit', value: limit }
      ]
    }
    
    const { resources } = await this.container.items
      .query<CosmosIdempotencyDocument>(querySpec)
      .fetchAll()
    
    return resources.map(({ id, ttl, ...record }) => record as IdempotencyRecord)
  }
  
  /**
   * Query recent records (useful for monitoring)
   */
  async getRecent(limit: number = 100): Promise<IdempotencyRecord[]> {
    const querySpec = {
      query: 'SELECT * FROM c ORDER BY c.executedAt DESC OFFSET 0 LIMIT @limit',
      parameters: [
        { name: '@limit', value: limit }
      ]
    }
    
    const { resources } = await this.container.items
      .query<CosmosIdempotencyDocument>(querySpec)
      .fetchAll()
    
    return resources.map(({ id, ttl, ...record }) => record as IdempotencyRecord)
  }
  
  /**
   * Batch get multiple keys (optimization)
   */
  async getBatch(keys: string[]): Promise<Map<string, IdempotencyRecord>> {
    if (keys.length === 0) {
      return new Map()
    }
    
    // Use IN query for batch retrieval
    const querySpec = {
      query: `SELECT * FROM c WHERE c.id IN (${keys.map((_, i) => `@key${i}`).join(',')})`,
      parameters: keys.map((key, i) => ({ name: `@key${i}`, value: key }))
    }
    
    const { resources } = await this.container.items
      .query<CosmosIdempotencyDocument>(querySpec)
      .fetchAll()
    
    const results = new Map<string, IdempotencyRecord>()
    
    for (const doc of resources) {
      const { id, ttl, ...record } = doc
      results.set(record.key, record as IdempotencyRecord)
    }
    
    return results
  }
}
