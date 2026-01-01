/**
 * Redis-backed Memory Graph Storage
 * 
 * Provides durable persistence for memory graph entities, facts, and episodes
 * using Redis as the backing store. Includes activation lease management
 * for concurrent access control.
 */

import type { Redis } from 'ioredis'
import type { Episode, Entity, Fact, MemoryQuery, MemoryStorage } from './types'
import { cosineSimilarity } from './in-memory-storage'

export interface ActivationLease {
  leaseId: string
  graphId: string
  actorId: string
  acquiredAt: string
  expiresAt: string
  renewalCount: number
}

/**
 * Redis-backed memory storage with activation leases
 */
export class RedisMemoryStorage implements MemoryStorage {
  private readonly keyPrefix = 'memory:graph'
  private readonly leaseTtlMs = 30000 // 30 seconds

  constructor(private redis: Redis) {}

  /**
   * Acquire an activation lease for exclusive access to a memory graph
   */
  async acquireLease(actorId: string, graphId: string): Promise<ActivationLease | null> {
    const leaseKey = `${this.keyPrefix}:lease:${graphId}`
    const leaseId = `${actorId}:${Date.now()}`
    
    const lease: ActivationLease = {
      leaseId,
      graphId,
      actorId,
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.leaseTtlMs).toISOString(),
      renewalCount: 0
    }

    // Try to acquire lease with NX (only set if not exists)
    const result = await this.redis.set(
      leaseKey,
      JSON.stringify(lease),
      'PX',
      this.leaseTtlMs,
      'NX'
    )

    return result === 'OK' ? lease : null
  }

  /**
   * Renew an existing activation lease
   */
  async renewLease(leaseId: string, graphId: string): Promise<boolean> {
    const leaseKey = `${this.keyPrefix}:lease:${graphId}`
    const existingData = await this.redis.get(leaseKey)
    
    if (!existingData) {
      return false
    }

    const existing: ActivationLease = JSON.parse(existingData)
    
    // Only the lease holder can renew
    if (existing.leaseId !== leaseId) {
      return false
    }

    const renewed: ActivationLease = {
      ...existing,
      expiresAt: new Date(Date.now() + this.leaseTtlMs).toISOString(),
      renewalCount: existing.renewalCount + 1
    }

    await this.redis.set(
      leaseKey,
      JSON.stringify(renewed),
      'PX',
      this.leaseTtlMs
    )

    return true
  }

  /**
   * Release an activation lease
   */
  async releaseLease(leaseId: string, graphId: string): Promise<void> {
    const leaseKey = `${this.keyPrefix}:lease:${graphId}`
    const existingData = await this.redis.get(leaseKey)
    
    if (!existingData) {
      return
    }

    const existing: ActivationLease = JSON.parse(existingData)
    
    // Only the lease holder can release
    if (existing.leaseId === leaseId) {
      await this.redis.del(leaseKey)
    }
  }

  /**
   * Check if a graph has an active lease
   */
  async hasActiveLease(graphId: string): Promise<boolean> {
    const leaseKey = `${this.keyPrefix}:lease:${graphId}`
    const exists = await this.redis.exists(leaseKey)
    return exists === 1
  }

  async addEpisode(episode: Episode): Promise<void> {
    const key = `${this.keyPrefix}:episode:${episode.id}`
    await this.redis.setex(
      key,
      86400 * 30, // 30 days TTL
      JSON.stringify(episode)
    )

    // Add to actor's episode list (sorted by sequence)
    const listKey = `${this.keyPrefix}:episodes:${episode.actorId}:${episode.graph_id}`
    await this.redis.zadd(listKey, episode.sequence, episode.id)
  }

  async getEpisodes(actorId: string, graph_id: string, limit?: number): Promise<Episode[]> {
    const listKey = `${this.keyPrefix}:episodes:${actorId}:${graph_id}`
    
    // Get episode IDs in reverse order (newest first)
    const count = limit || -1
    const episodeIds = await this.redis.zrevrange(listKey, 0, count === -1 ? -1 : count - 1)
    
    if (episodeIds.length === 0) {
      return []
    }

    // Fetch episode data
    const episodes: Episode[] = []
    for (const id of episodeIds) {
      const key = `${this.keyPrefix}:episode:${id}`
      const data = await this.redis.get(key)
      if (data) {
        episodes.push(JSON.parse(data))
      }
    }

    return episodes
  }

  async addEntity(entity: Entity): Promise<void> {
    const key = `${this.keyPrefix}:entity:${entity.id}`
    await this.redis.setex(
      key,
      86400 * 90, // 90 days TTL
      JSON.stringify(entity)
    )

    // Add to graph's entity set
    const setKey = `${this.keyPrefix}:entities:${entity.actorId}:${entity.graph_id}`
    await this.redis.sadd(setKey, entity.id)
  }

  async getEntity(id: string, graph_id: string): Promise<Entity | null> {
    const key = `${this.keyPrefix}:entity:${id}`
    const data = await this.redis.get(key)
    
    if (!data) {
      return null
    }

    const entity: Entity = JSON.parse(data)
    return entity.graph_id === graph_id ? entity : null
  }

  async getEntities(actorId: string, graph_id: string): Promise<Entity[]> {
    const setKey = `${this.keyPrefix}:entities:${actorId}:${graph_id}`
    const entityIds = await this.redis.smembers(setKey)
    
    if (entityIds.length === 0) {
      return []
    }

    const entities: Entity[] = []
    for (const id of entityIds) {
      const key = `${this.keyPrefix}:entity:${id}`
      const data = await this.redis.get(key)
      if (data) {
        entities.push(JSON.parse(data))
      }
    }

    return entities
  }

  async addFact(fact: Fact): Promise<void> {
    const key = `${this.keyPrefix}:fact:${fact.id}`
    await this.redis.setex(
      key,
      86400 * 90, // 90 days TTL
      JSON.stringify(fact)
    )

    // Add to graph's fact set
    const setKey = `${this.keyPrefix}:facts:${fact.actorId}:${fact.graph_id}`
    await this.redis.sadd(setKey, fact.id)
  }

  async getFact(id: string, graph_id: string): Promise<Fact | null> {
    const key = `${this.keyPrefix}:fact:${id}`
    const data = await this.redis.get(key)
    
    if (!data) {
      return null
    }

    const fact: Fact = JSON.parse(data)
    return fact.graph_id === graph_id ? fact : null
  }

  async getValidFacts(actorId: string, graph_id: string, asOf?: Date): Promise<Fact[]> {
    const setKey = `${this.keyPrefix}:facts:${actorId}:${graph_id}`
    const factIds = await this.redis.smembers(setKey)
    
    if (factIds.length === 0) {
      return []
    }

    const checkDate = asOf || new Date()
    const validFacts: Fact[] = []

    for (const id of factIds) {
      const key = `${this.keyPrefix}:fact:${id}`
      const data = await this.redis.get(key)
      if (data) {
        const fact: Fact = JSON.parse(data)
        
        // Check temporal validity
        if (new Date(fact.validFrom) > checkDate) {
          continue
        }
        
        if (fact.validUntil && new Date(fact.validUntil) <= checkDate) {
          continue
        }

        // For private graphs, filter by actorId
        if (graph_id === actorId && fact.actorId !== actorId) {
          continue
        }

        validFacts.push(fact)
      }
    }

    return validFacts
  }

  async searchFacts(query: MemoryQuery): Promise<Fact[]> {
    // Start with all facts for the actor/graph
    const graph_id = query.graph_id || query.actorId
    let results = await this.getValidFacts(query.actorId, graph_id, query.asOf)

    // Apply filters
    if (query.source_entity_ids && query.source_entity_ids.length > 0) {
      results = results.filter(f => query.source_entity_ids!.includes(f.sourceEntityId))
    }

    if (query.target_entity_ids && query.target_entity_ids.length > 0) {
      results = results.filter(f => query.target_entity_ids!.includes(f.targetEntityId))
    }

    if (query.relations && query.relations.length > 0) {
      results = results.filter(f => query.relations!.includes(f.relation))
    }

    // Text search
    if (query.text && typeof query.text === 'string' && query.text.trim()) {
      const searchLower = query.text.toLowerCase()
      results = results.filter(f =>
        f.text.toLowerCase().includes(searchLower) ||
        f.relation.toLowerCase().includes(searchLower)
      )
    }

    // Vector similarity search
    if (query.embedding) {
      const factsWithEmbeddings = results.filter(f => f.embedding && f.embedding.length > 0)
      
      const scored = factsWithEmbeddings.map(fact => ({
        fact,
        similarity: cosineSimilarity(query.embedding!, fact.embedding!)
      }))

      scored.sort((a, b) => b.similarity - a.similarity)
      results = scored.map(s => s.fact)
    }

    // Apply limit
    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit)
    }

    return results
  }

  async close(): Promise<void> {
    // Redis connection managed externally, no-op here
  }
}
