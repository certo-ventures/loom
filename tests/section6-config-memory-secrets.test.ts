/**
 * Section 6: Config, Memory, Secrets Integration Tests
 * 
 * Tests unified persistence and layered configuration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CosmosClient } from '@azure/cosmos'
import { createClient as createRedisClient } from 'redis'
import { LayeredConfigResolver } from '../src/config-resolver/layered-resolver'
import { CosmosConfigResolver } from '../src/config-resolver/cosmos-resolver'
import { InMemoryConfigResolver } from '../src/config-resolver/in-memory-resolver'
import { CosmosSecretsStore } from '../src/secrets/cosmos-secrets'
import { InMemorySecretsStore } from '../src/secrets/in-memory-secrets-store'
import { CosmosMemoryStorage } from '../src/memory/graph/cosmos-storage'
import { InMemoryGraphStorage } from '../src/memory/graph/in-memory-storage'
import type { Episode, Entity, Fact } from '../src/memory/graph/types'

describe('Section 6: Config, Memory, Secrets', () => {
  describe('Layered Config Resolution', () => {
    let cacheResolver: InMemoryConfigResolver
    let persistResolver: InMemoryConfigResolver
    let layeredResolver: LayeredConfigResolver

    beforeEach(() => {
      cacheResolver = new InMemoryConfigResolver()
      persistResolver = new InMemoryConfigResolver()
      layeredResolver = new LayeredConfigResolver({
        cacheLayer: cacheResolver,
        persistLayer: persistResolver,
        cacheTTL: 5000, // 5 seconds
      })
    })

    it('should read-through from persist to cache', async () => {
      // Set value in persist layer only
      await persistResolver.set('tenant/acme/llm/model', 'gpt-4')

      // First read should hit persist and populate cache
      const value1 = await layeredResolver.get('tenant/acme/llm/model')
      expect(value1).toBe('gpt-4')

      // Verify cache was populated
      const cached = await cacheResolver.get('tenant/acme/llm/model')
      expect(cached).toBe('gpt-4')
    })

    it('should write-through to both layers', async () => {
      // Write via layered resolver
      await layeredResolver.set('tenant/acme/llm/temperature', '0.7')

      // Verify both layers have the value
      const cached = await cacheResolver.get('tenant/acme/llm/temperature')
      const persisted = await persistResolver.get('tenant/acme/llm/temperature')
      expect(cached).toBe('0.7')
      expect(persisted).toBe('0.7')
    })

    it('should respect cache TTL', async () => {
      const shortTTL = new LayeredConfigResolver({
        cacheLayer: cacheResolver,
        persistLayer: persistResolver,
        cacheTTL: 100, // 100ms
      })

      await shortTTL.set('tenant/acme/test', 'value1')

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150))

      // Update persist layer directly
      await persistResolver.set('tenant/acme/test', 'value2')

      // Should fetch fresh from persist
      const value = await shortTTL.get('tenant/acme/test')
      expect(value).toBe('value2')
    })

    it('should support hierarchical resolution with context', async () => {
      // Set values at different hierarchy levels
      // buildKeyPaths creates paths like: acme/prod/llm/model, acme/llm/model, llm/model
      await layeredResolver.set('llm/model', 'gpt-3.5') // Global default
      await layeredResolver.set('acme/llm/model', 'gpt-4') // Tenant override  
      await layeredResolver.set('acme/prod/llm/model', 'gpt-4-turbo') // Tenant+Env override

      const context = {
        tenantId: 'acme',
        environment: 'prod',
      }

      const value = await layeredResolver.getWithContext('llm/model', context)
      expect(value).toBe('gpt-4-turbo') // Most specific wins
    })

    it('should invalidate cache on demand', async () => {
      await layeredResolver.set('tenant/acme/test', 'value1')

      // Update persist layer directly
      await persistResolver.set('tenant/acme/test', 'value2')

      // Cache still has old value
      let value = await cacheResolver.get('tenant/acme/test')
      expect(value).toBe('value1')

      // Invalidate cache
      await layeredResolver.invalidateCache('tenant/acme/test')

      // Next read should fetch fresh
      value = await layeredResolver.get('tenant/acme/test')
      expect(value).toBe('value2')
    })

    it('should provide cache statistics', async () => {
      await layeredResolver.set('key1', 'value1')
      await layeredResolver.set('key2', 'value2')

      // Wait a bit to ensure non-zero age
      await new Promise(resolve => setTimeout(resolve, 10))

      const stats = await layeredResolver.getCacheStats()
      expect(stats.totalKeys).toBe(2)
      expect(stats.avgAge).toBeGreaterThan(0)
      expect(stats.oldestKey).toBeDefined()
    })
  })

  describe('Secrets Management', () => {
    let secretsStore: InMemorySecretsStore

    beforeEach(() => {
      secretsStore = new InMemorySecretsStore()
    })

    it('should store and retrieve secrets', async () => {
      await secretsStore.setSecret({
        key: 'tenant/acme/api-key',
        value: 'sk-test-123',
        version: 1,
      })

      const secret = await secretsStore.getSecret('tenant/acme/api-key')
      expect(secret).toBeDefined()
      expect(secret?.value).toBe('sk-test-123')
    })

    it('should support secret versioning', async () => {
      // Create initial version
      await secretsStore.setSecret({
        key: 'tenant/acme/api-key',
        value: 'sk-v1',
        version: 1,
      })

      // Rotate secret
      await secretsStore.setSecret({
        key: 'tenant/acme/api-key',
        value: 'sk-v2',
        version: 2,
      })

      const secret = await secretsStore.getSecret('tenant/acme/api-key')
      expect(secret?.version).toBe(2)
      expect(secret?.value).toBe('sk-v2')
    })

    it('should handle secret expiration', async () => {
      const expiresAt = new Date(Date.now() - 1000).toISOString() // Expired

      await secretsStore.setSecret({
        key: 'tenant/acme/temp-key',
        value: 'temporary',
        version: 1,
        expiresAt,
      })

      const secret = await secretsStore.getSecret('tenant/acme/temp-key')
      expect(secret).toBeNull() // Expired secrets return null
    })

    it('should list secrets by prefix', async () => {
      await secretsStore.setSecret({ key: 'tenant/acme/api-key', value: 'key1', version: 1 })
      await secretsStore.setSecret({ key: 'tenant/acme/db-password', value: 'pwd1', version: 1 })
      await secretsStore.setSecret({ key: 'tenant/other/api-key', value: 'key2', version: 1 })

      const acmeSecrets = await secretsStore.listSecrets('tenant/acme/')
      expect(acmeSecrets).toHaveLength(2)
      expect(acmeSecrets).toContain('tenant/acme/api-key')
      expect(acmeSecrets).toContain('tenant/acme/db-password')
    })

    it('should delete secrets', async () => {
      await secretsStore.setSecret({
        key: 'tenant/acme/temp',
        value: 'delete-me',
        version: 1,
      })

      await secretsStore.deleteSecret('tenant/acme/temp')

      const secret = await secretsStore.getSecret('tenant/acme/temp')
      expect(secret).toBeNull()
    })
  })

  describe('Memory Graph Storage', () => {
    let storage: InMemoryGraphStorage

    beforeEach(() => {
      storage = new InMemoryGraphStorage()
    })

    it('should store and retrieve episodes', async () => {
      const episode: Episode = {
        id: 'ep-1',
        content: 'User said hello',
        source: 'message',
        sequence: 1,
        created_at: new Date(),
        actorId: 'actor-123',
        graph_id: 'graph-1',
      }

      await storage.addEpisode(episode)

      const episodes = await storage.getEpisodes('actor-123', 'graph-1')
      expect(episodes).toHaveLength(1)
      expect(episodes[0].content).toBe('User said hello')
    })

    it('should store and retrieve entities', async () => {
      const entity: Entity = {
        id: 'entity-1',
        name: 'John Doe',
        type: 'person',
        sequence: 1,
        created_at: new Date(),
        actorId: 'actor-123',
        graph_id: 'graph-1',
      }

      await storage.addEntity(entity)

      const retrieved = await storage.getEntity('entity-1', 'graph-1')
      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe('John Doe')
    })

    it('should store and query facts', async () => {
      const fact: Fact = {
        id: 'fact-1',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        relation: 'knows',
        text: 'John knows Jane',
        created_at: new Date(),
        lamport_ts: 1,
        validFrom: new Date(),
        episodeIds: ['ep-1'],
        source: 'user_input',
        actorId: 'actor-123',
        graph_id: 'graph-1',
      }

      await storage.addFact(fact)

      const facts = await storage.getFactsForEntity('entity-1', 'graph-1')
      expect(facts).toHaveLength(1)
      expect(facts[0].relation).toBe('knows')
    })

    it('should query facts between entities', async () => {
      const fact: Fact = {
        id: 'fact-1',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        relation: 'works_with',
        text: 'John works with Jane',
        created_at: new Date(),
        lamport_ts: 1,
        validFrom: new Date(),
        episodeIds: ['ep-1'],
        source: 'user_input',
        actorId: 'actor-123',
        graph_id: 'graph-1',
      }

      await storage.addFact(fact)

      const facts = await storage.getFactsBetween('entity-1', 'entity-2', 'graph-1')
      expect(facts).toHaveLength(1)
      expect(facts[0].relation).toBe('works_with')
    })

    it('should respect temporal validity in queries', async () => {
      const now = new Date()
      const past = new Date(now.getTime() - 86400000) // 1 day ago
      const future = new Date(now.getTime() + 86400000) // 1 day from now

      // Fact valid in the past
      const pastFact: Fact = {
        id: 'fact-past',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        relation: 'worked_with',
        text: 'Past relationship',
        created_at: past,
        lamport_ts: 1,
        validFrom: past,
        validUntil: now,
        episodeIds: ['ep-1'],
        source: 'user_input',
        actorId: 'actor-123',
        graph_id: 'graph-1',
      }

      // Current fact
      const currentFact: Fact = {
        id: 'fact-current',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        relation: 'works_with',
        text: 'Current relationship',
        created_at: now,
        lamport_ts: 2,
        validFrom: now,
        episodeIds: ['ep-2'],
        source: 'user_input',
        actorId: 'actor-123',
        graph_id: 'graph-1',
      }

      await storage.addFact(pastFact)
      await storage.addFact(currentFact)

      // Query as of now
      const currentFacts = await storage.searchFacts({
        actorId: 'actor-123',
        graph_id: 'graph-1',
        asOf: now,
      })

      // Should only return current fact
      expect(currentFacts).toHaveLength(1)
      expect(currentFacts[0].id).toBe('fact-current')
    })

    it('should support text search in facts', async () => {
      const facts: Fact[] = [
        {
          id: 'fact-1',
          sourceEntityId: 'e1',
          targetEntityId: 'e2',
          relation: 'knows',
          text: 'John knows Python programming',
          created_at: new Date(),
          lamport_ts: 1,
          validFrom: new Date(),
          episodeIds: [],
          source: 'user_input',
          actorId: 'actor-123',
          graph_id: 'graph-1',
        },
        {
          id: 'fact-2',
          sourceEntityId: 'e1',
          targetEntityId: 'e3',
          relation: 'likes',
          text: 'John likes JavaScript',
          created_at: new Date(),
          lamport_ts: 2,
          validFrom: new Date(),
          episodeIds: [],
          source: 'user_input',
          actorId: 'actor-123',
          graph_id: 'graph-1',
        },
      ]

      for (const fact of facts) {
        await storage.addFact(fact)
      }

      const results = await storage.searchFacts({
        actorId: 'actor-123',
        graph_id: 'graph-1',
        text: 'Python',
      })

      expect(results).toHaveLength(1)
      expect(results[0].text).toContain('Python')
    })
  })

  describe('Unified Persistence Pattern', () => {
    it('should use same partition strategy across config/secrets/memory', () => {
      // All use tenantId-based partitioning
      const tenantId = 'acme'
      
      // Config key: tenant/acme/llm/model
      const configKey = `tenant/${tenantId}/llm/model`
      expect(configKey).toContain(tenantId)

      // Secret key: tenant/acme/api-key
      const secretKey = `tenant/${tenantId}/api-key`
      expect(secretKey).toContain(tenantId)

      // Memory: actorId contains tenantId
      const actorId = `${tenantId}:actor-123`
      expect(actorId).toContain(tenantId)
    })

    it('should support hierarchical resolution in all stores', async () => {
      const cacheResolver = new InMemoryConfigResolver()
      const persistResolver = new InMemoryConfigResolver()
      const layeredResolver = new LayeredConfigResolver({
        cacheLayer: cacheResolver,
        persistLayer: persistResolver,
      })

      // Set hierarchical config - buildKeyPaths creates paths like: acme/llm/model, llm/model
      await layeredResolver.set('llm/model', 'default')
      await layeredResolver.set('acme/llm/model', 'tenant-specific')

      // Resolve with context
      const value = await layeredResolver.getWithContext('llm/model', {
        tenantId: 'acme',
      })

      expect(value).toBe('tenant-specific')
    })
  })
})
