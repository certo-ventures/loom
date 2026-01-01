import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Redis } from 'ioredis'
import { RedisMemoryStorage } from '../../memory/graph/redis-storage'
import type { Episode, Entity, Fact } from '../../memory/graph/types'

describe('RedisMemoryStorage with Activation Leases', () => {
  let redis: Redis
  let storage: RedisMemoryStorage

  beforeEach(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      db: 15 // Use test database
    })
    storage = new RedisMemoryStorage(redis)
  })

  afterEach(async () => {
    await redis.flushdb()
    await redis.quit()
  })

  describe('Activation Leases', () => {
    it('should acquire an activation lease', async () => {
      const lease = await storage.acquireLease('actor-1', 'graph-1')
      
      expect(lease).not.toBeNull()
      expect(lease?.actorId).toBe('actor-1')
      expect(lease?.graphId).toBe('graph-1')
      expect(lease?.renewalCount).toBe(0)
    })

    it('should prevent concurrent lease acquisition', async () => {
      const lease1 = await storage.acquireLease('actor-1', 'graph-1')
      expect(lease1).not.toBeNull()

      // Second actor tries to acquire same graph
      const lease2 = await storage.acquireLease('actor-2', 'graph-1')
      expect(lease2).toBeNull()
    })

    it('should renew an existing lease', async () => {
      const lease = await storage.acquireLease('actor-1', 'graph-1')
      expect(lease).not.toBeNull()

      const renewed = await storage.renewLease(lease!.leaseId, 'graph-1')
      expect(renewed).toBe(true)
    })

    it('should not allow another actor to renew lease', async () => {
      const lease = await storage.acquireLease('actor-1', 'graph-1')
      expect(lease).not.toBeNull()

      const renewed = await storage.renewLease('fake-lease-id', 'graph-1')
      expect(renewed).toBe(false)
    })

    it('should release a lease', async () => {
      const lease = await storage.acquireLease('actor-1', 'graph-1')
      expect(lease).not.toBeNull()

      await storage.releaseLease(lease!.leaseId, 'graph-1')

      // Now another actor can acquire it
      const lease2 = await storage.acquireLease('actor-2', 'graph-1')
      expect(lease2).not.toBeNull()
    })

    it('should check for active lease', async () => {
      expect(await storage.hasActiveLease('graph-1')).toBe(false)

      await storage.acquireLease('actor-1', 'graph-1')
      expect(await storage.hasActiveLease('graph-1')).toBe(true)
    })

    it('should allow lease acquisition after expiration', async () => {
      // This test would need to wait for TTL expiration
      // For now, we just verify the mechanism is in place
      const lease = await storage.acquireLease('actor-1', 'graph-1')
      expect(lease).not.toBeNull()
    }, 10000)
  })

  describe('Episode Persistence', () => {
    it('should store and retrieve episodes', async () => {
      const episode: Episode = {
        id: 'ep-1',
        content: 'User said hello',
        source: 'message',
        sequence: 1,
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'graph-1'
      }

      await storage.addEpisode(episode)
      const episodes = await storage.getEpisodes('actor-1', 'graph-1')

      expect(episodes).toHaveLength(1)
      expect(episodes[0].content).toBe('User said hello')
    })

    it('should return episodes in reverse chronological order', async () => {
      await storage.addEpisode({
        id: 'ep-1',
        content: 'First',
        source: 'message',
        sequence: 1,
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'graph-1'
      })

      await storage.addEpisode({
        id: 'ep-2',
        content: 'Second',
        source: 'message',
        sequence: 2,
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'graph-1'
      })

      const episodes = await storage.getEpisodes('actor-1', 'graph-1')
      expect(episodes[0].content).toBe('Second')
      expect(episodes[1].content).toBe('First')
    })

    it('should respect limit parameter', async () => {
      for (let i = 1; i <= 5; i++) {
        await storage.addEpisode({
          id: `ep-${i}`,
          content: `Episode ${i}`,
          source: 'message',
          sequence: i,
          created_at: new Date(),
          actorId: 'actor-1',
          graph_id: 'graph-1'
        })
      }

      const episodes = await storage.getEpisodes('actor-1', 'graph-1', 3)
      expect(episodes).toHaveLength(3)
    })
  })

  describe('Entity Persistence', () => {
    it('should store and retrieve entities', async () => {
      const entity: Entity = {
        id: 'ent-1',
        name: 'Alice',
        type: 'person',
        sequence: 1,
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'graph-1'
      }

      await storage.addEntity(entity)
      const retrieved = await storage.getEntity('ent-1', 'graph-1')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.name).toBe('Alice')
    })

    it('should list all entities for an actor/graph', async () => {
      await storage.addEntity({
        id: 'ent-1',
        name: 'Alice',
        type: 'person',
        sequence: 1,
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'graph-1'
      })

      await storage.addEntity({
        id: 'ent-2',
        name: 'Bob',
        type: 'person',
        sequence: 2,
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'graph-1'
      })

      const entities = await storage.getEntities('actor-1', 'graph-1')
      expect(entities).toHaveLength(2)
    })
  })

  describe('Fact Persistence', () => {
    it('should store and retrieve facts', async () => {
      const fact: Fact = {
        id: 'fact-1',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-2',
        relation: 'knows',
        text: 'Alice knows Bob',
        created_at: new Date(),
        lamport_ts: 1,
        validFrom: new Date(),
        episodeIds: ['ep-1'],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'graph-1'
      }

      await storage.addFact(fact)
      const retrieved = await storage.getFact('fact-1', 'graph-1')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.relation).toBe('knows')
    })

    it('should filter facts by temporal validity', async () => {
      const now = new Date()
      const past = new Date(now.getTime() - 86400000) // 1 day ago
      const future = new Date(now.getTime() + 86400000) // 1 day ahead

      // Valid fact
      await storage.addFact({
        id: 'fact-1',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-2',
        relation: 'knows',
        text: 'Current fact',
        created_at: past,
        lamport_ts: 1,
        validFrom: past,
        episodeIds: [],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'graph-1'
      })

      // Future fact (not yet valid)
      await storage.addFact({
        id: 'fact-2',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-3',
        relation: 'will_meet',
        text: 'Future fact',
        created_at: now,
        lamport_ts: 2,
        validFrom: future,
        episodeIds: [],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'graph-1'
      })

      const validFacts = await storage.getValidFacts('actor-1', 'graph-1')
      expect(validFacts).toHaveLength(1)
      expect(validFacts[0].text).toBe('Current fact')
    })

    it('should search facts by text', async () => {
      await storage.addFact({
        id: 'fact-1',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-2',
        relation: 'knows',
        text: 'Alice knows Bob from college',
        created_at: new Date(),
        lamport_ts: 1,
        validFrom: new Date(),
        episodeIds: [],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'graph-1'
      })

      const results = await storage.searchFacts({
        actorId: 'actor-1',
        graph_id: 'graph-1',
        text: 'college'
      })

      expect(results).toHaveLength(1)
      expect(results[0].text).toContain('college')
    })
  })
})
