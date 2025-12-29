/**
 * Tests for Dynamic Configuration Service
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { DynamicConfigService } from '../../src/config/dynamic-config'

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT

describe.skipIf(!COSMOS_ENDPOINT)('DynamicConfigService', () => {
  let service: DynamicConfigService

  beforeEach(async () => {
    service = new DynamicConfigService({
      cosmos: {
        endpoint: COSMOS_ENDPOINT!,
        databaseId: 'loom-test',
        containerId: 'configs-test',
        // Uses DefaultAzureCredential (managed identity)
      },
      cacheTTL: 1000, // 1 second for testing,
    })

    await service.initialize()
  })

  afterEach(() => {
    service.clearCache()
  })

  test('should return default config when no custom config exists', async () => {
    const config = await service.getConfig('unknown-tenant')
    
    expect(config.tenantId).toBe('default')
    expect(config.memory?.enabled).toBe(false)
  })

  test('should save and load tenant-level config', async () => {
    await service.saveConfig({
      id: 'test-tenant-config',
      tenantId: 'test-tenant',
      memory: {
        enabled: true,
        deduplicationThreshold: 0.90,
      },
      createdAt: new Date().toISOString(),
      priority: 100,
    })

    const config = await service.getConfig('test-tenant')
    
    expect(config.memory?.enabled).toBe(true)
    expect(config.memory?.deduplicationThreshold).toBe(0.90)
  })

  test('should merge actor-specific config with tenant config', async () => {
    // Tenant-level config
    await service.saveConfig({
      id: 'test-tenant-default',
      tenantId: 'test-tenant',
      memory: {
        enabled: true,
        deduplicationThreshold: 0.95,
        semanticCacheTTL: 3600,
      },
      createdAt: new Date().toISOString(),
      priority: 100,
    })

    // Actor-specific override
    await service.saveConfig({
      id: 'test-tenant-criteria-reviewer',
      tenantId: 'test-tenant',
      actorType: 'CriteriaReviewer',
      memory: {
        enabled: true,
        semanticCacheTTL: 7200, // Override
      },
      createdAt: new Date().toISOString(),
      priority: 200,
    })

    const config = await service.getConfig('test-tenant', 'CriteriaReviewer')
    
    expect(config.memory?.enabled).toBe(true) // From tenant
    expect(config.memory?.deduplicationThreshold).toBe(0.95) // From tenant
    expect(config.memory?.semanticCacheTTL).toBe(7200) // From actor override
  })

  test('should respect priority when merging configs', async () => {
    await service.saveConfig({
      id: 'test-tenant-low-priority',
      tenantId: 'test-tenant',
      memory: { enabled: true },
      createdAt: new Date().toISOString(),
      priority: 50,
    })

    await service.saveConfig({
      id: 'test-tenant-high-priority',
      tenantId: 'test-tenant',
      memory: { enabled: false }, // Higher priority
      createdAt: new Date().toISOString(),
      priority: 100,
    })

    const config = await service.getConfig('test-tenant')
    
    expect(config.memory?.enabled).toBe(false) // Higher priority wins
  })

  test('should cache configs for performance', async () => {
    await service.saveConfig({
      id: 'test-tenant-cache-test',
      tenantId: 'test-tenant',
      memory: { enabled: true },
      createdAt: new Date().toISOString(),
      priority: 100,
    })

    // First load - from DB
    const start1 = Date.now()
    await service.getConfig('test-tenant')
    const duration1 = Date.now() - start1

    // Second load - from cache (should be faster)
    const start2 = Date.now()
    await service.getConfig('test-tenant')
    const duration2 = Date.now() - start2

    expect(duration2).toBeLessThan(duration1)
  })

  test('should invalidate cache when saving new config', async () => {
    await service.saveConfig({
      id: 'test-tenant-invalidate-1',
      tenantId: 'test-tenant',
      memory: { enabled: true },
      createdAt: new Date().toISOString(),
      priority: 100,
    })

    let config = await service.getConfig('test-tenant')
    expect(config.memory?.enabled).toBe(true)

    // Update config
    await service.saveConfig({
      id: 'test-tenant-invalidate-2',
      tenantId: 'test-tenant',
      memory: { enabled: false },
      createdAt: new Date().toISOString(),
      priority: 100,
    })

    config = await service.getConfig('test-tenant')
    expect(config.memory?.enabled).toBe(false) // Cache invalidated
  })

  test('should allow manual cache invalidation', async () => {
    await service.saveConfig({
      id: 'test-tenant-manual-invalidate',
      tenantId: 'test-tenant',
      memory: { enabled: true },
      createdAt: new Date().toISOString(),
      priority: 100,
    })

    await service.getConfig('test-tenant') // Load to cache
    service.invalidateCache('test-tenant')

    // Should reload from DB
    const config = await service.getConfig('test-tenant')
    expect(config.memory?.enabled).toBe(true)
  })
})
