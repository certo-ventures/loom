import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { CosmosClient, Container } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import { CosmosConfigResolver, LayeredConfigResolver, InMemoryConfigResolver } from '../../src/config-resolver'

// These tests require COSMOS_ENDPOINT environment variable
const SKIP_INTEGRATION = !process.env.COSMOS_ENDPOINT

describe.skipIf(SKIP_INTEGRATION)('ConfigResolver Cosmos Integration', () => {
  let cosmosContainer: Container
  let cosmosResolver: CosmosConfigResolver
  let layeredResolver: LayeredConfigResolver

  beforeAll(async () => {
    const endpoint = process.env.COSMOS_ENDPOINT!
    const credential = new DefaultAzureCredential()
    const client = new CosmosClient({ endpoint, aadCredentials: credential })

    const { database } = await client.databases.createIfNotExists({
      id: 'config-integration-test'
    })
    const { container } = await database.containers.createIfNotExists({
      id: 'test-config',
      partitionKey: { paths: ['/partitionKey'] }
    })

    cosmosContainer = container
    cosmosResolver = new CosmosConfigResolver({ 
      container,
      containerName: 'test-config',
      databaseName: 'config-integration-test'
    })

    // Create layered resolver (cache + persist)
    const cacheResolver = new InMemoryConfigResolver()
    layeredResolver = new LayeredConfigResolver({
      cacheLayer: cacheResolver,
      persistLayer: cosmosResolver,
      cacheTTL: 5000  // 5 seconds for testing
    })
  }, 30000)  // 30 second timeout for setup

  afterAll(async () => {
    // Cleanup
    if (cosmosContainer) {
      try {
        await cosmosContainer.delete()
      } catch (error) {
        console.warn('Failed to cleanup test container:', error)
      }
    }
  })

  describe('Basic Cosmos Operations', () => {
    test('write and read config from Cosmos', async () => {
      await cosmosResolver.set('global/test-config', {
        value: 'test',
        timestamp: Date.now()
      })

      const config = await cosmosResolver.get('global/test-config') as any
      expect(config).toMatchObject({ value: 'test' })
    })

    test('hierarchical resolution with real Cosmos', async () => {
      await cosmosResolver.set('global/llm', { model: 'gpt-4o-mini' })
      await cosmosResolver.set('acme/llm', { model: 'gpt-4o' })
      await cosmosResolver.set('acme/finance/llm', { temperature: 0.7 })

      const config = await cosmosResolver.getWithContext('llm', {
        clientId: 'acme',
        tenantId: 'finance'
      }) as any

      // Should merge all levels
      expect(config.model).toBe('gpt-4o')
      expect(config.temperature).toBe(0.7)
    })

    test('delete removes config', async () => {
      await cosmosResolver.set('test/delete-me', { value: 'temporary' })
      
      let config = await cosmosResolver.get('test/delete-me')
      expect(config).toBeTruthy()

      await cosmosResolver.delete('test/delete-me')

      config = await cosmosResolver.get('test/delete-me')
      expect(config).toBeNull()
    })

    test('list keys with prefix', async () => {
      await cosmosResolver.set('test-prefix/key1', { value: 1 })
      await cosmosResolver.set('test-prefix/key2', { value: 2 })
      await cosmosResolver.set('test-prefix/key3', { value: 3 })

      const keys = await cosmosResolver.listKeys('test-prefix/')
      expect(keys.length).toBeGreaterThanOrEqual(3)
      expect(keys).toContain('test-prefix/key1')
      expect(keys).toContain('test-prefix/key2')
      expect(keys).toContain('test-prefix/key3')
    })
  })

  describe('Concurrent Operations', () => {
    test('concurrent reads work correctly', async () => {
      await cosmosResolver.set('global/concurrent-test', { value: 123 })

      const reads = Array.from({ length: 10 }, () =>
        cosmosResolver.get('global/concurrent-test')
      )

      const results = await Promise.all(reads)
      results.forEach(result => {
        expect(result).toEqual({ value: 123 })
      })
    })

    test('concurrent writes - last write wins', async () => {
      const writes = Array.from({ length: 10 }, (_, i) =>
        cosmosResolver.set('global/concurrent-write-test', { value: i })
      )

      await Promise.all(writes)

      const result = await cosmosResolver.get('global/concurrent-write-test') as any
      expect(result.value).toBeGreaterThanOrEqual(0)
      expect(result.value).toBeLessThan(10)
    })
  })

  describe('Layered Resolver (Cache + Persist)', () => {
    test('write-through: writes to both layers', async () => {
      await layeredResolver.set('test/write-through', { value: 456 })

      // Read from cache (fast)
      const cacheResult = await layeredResolver.get('test/write-through')
      expect(cacheResult).toEqual({ value: 456 })

      // Read from Cosmos directly (verify persistence)
      const cosmosResult = await cosmosResolver.get('test/write-through')
      expect(cosmosResult).toEqual({ value: 456 })
    })

    test('read-through: populates cache from persist', async () => {
      // Write directly to Cosmos (bypass cache)
      await cosmosResolver.set('test/read-through', { value: 789 })

      // Read through layered resolver (should populate cache)
      const result = await layeredResolver.get('test/read-through')
      expect(result).toEqual({ value: 789 })

      // Subsequent reads should hit cache (faster)
      const start = Date.now()
      await layeredResolver.get('test/read-through')
      const duration = Date.now() - start
      expect(duration).toBeLessThan(50)  // Should be very fast (cache hit)
    })

    test('cache invalidation after TTL', async () => {
      await layeredResolver.set('test/ttl', { value: 'initial' })

      // Read to populate cache
      const initial = await layeredResolver.get('test/ttl')
      expect(initial).toEqual({ value: 'initial' })

      // Update Cosmos directly (bypass cache)
      await cosmosResolver.set('test/ttl', { value: 'updated' })

      // Should still get cached value
      const cached = await layeredResolver.get('test/ttl')
      expect(cached).toEqual({ value: 'initial' })

      // Wait for TTL expiration (5 seconds)
      await new Promise(resolve => setTimeout(resolve, 6000))

      // Should now get updated value from Cosmos
      const updated = await layeredResolver.get('test/ttl')
      expect(updated).toEqual({ value: 'updated' })
    }, 15000)  // 15s timeout for this test
  })

  describe('Multi-Tenant Isolation', () => {
    test('tenants get different config', async () => {
      await cosmosResolver.set('tenant-1/llm', { endpoint: 'https://tenant1.com' })
      await cosmosResolver.set('tenant-2/llm', { endpoint: 'https://tenant2.com' })

      const config1 = await cosmosResolver.getWithContext('llm', {
        tenantId: 'tenant-1'
      }) as any
      const config2 = await cosmosResolver.getWithContext('llm', {
        tenantId: 'tenant-2'
      }) as any

      expect(config1.endpoint).toBe('https://tenant1.com')
      expect(config2.endpoint).toBe('https://tenant2.com')
    })

    test('tenant fallback to global', async () => {
      await cosmosResolver.set('global/fallback-test', { value: 'global' })

      const config = await cosmosResolver.getWithContext('fallback-test', {
        tenantId: 'non-existent-tenant'
      })

      expect(config).toEqual({ value: 'global' })
    })
  })

  describe('Performance', () => {
    test('handles high read throughput', async () => {
      await layeredResolver.set('load-test/config', { value: 'test' })

      const reads = Array.from({ length: 100 }, () =>
        layeredResolver.get('load-test/config')
      )

      const start = Date.now()
      await Promise.all(reads)
      const duration = Date.now() - start

      // Should complete quickly (mostly cache hits)
      expect(duration).toBeLessThan(1000)  // 100 reads in < 1 second
    })

    test('cache hit rate is high', async () => {
      await layeredResolver.set('cache-test/config', { value: 'test' })

      // First read - cache miss
      await layeredResolver.get('cache-test/config')

      // Subsequent reads - cache hits (should be fast)
      const reads = Array.from({ length: 50 }, async () => {
        const start = Date.now()
        await layeredResolver.get('cache-test/config')
        return Date.now() - start
      })

      const durations = await Promise.all(reads)
      const avgDuration = durations.reduce((a, b) => a + b) / durations.length

      expect(avgDuration).toBeLessThan(10)  // Average < 10ms (cache hits)
    })
  })

  describe('Error Handling', () => {
    test('handles missing config gracefully', async () => {
      const config = await cosmosResolver.get('non-existent-key')
      expect(config).toBeNull()
    })

    test('getWithContext handles missing config', async () => {
      const config = await cosmosResolver.getWithContext('non-existent', {
        tenantId: 'test'
      })
      expect(config).toBeNull()
    })
  })
})
