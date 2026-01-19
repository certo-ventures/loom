/**
 * Tests for AdapterFactory GUN integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AdapterFactory } from '../../storage/adapter-factory'
import { LoomMeshService } from '../../services/loommesh/loommesh-service'
import type { LoomMeshConfig } from '../../services/loommesh/loommesh-service'

describe('AdapterFactory GUN Integration', () => {
  let gunService: LoomMeshService | null = null

  afterEach(async () => {
    if (gunService) {
      await gunService.stop()
      gunService = null
    }
  })

  it('should create GUN state store when gun type specified', async () => {
    const config: LoomMeshConfig = {
      storage: { type: 'memory' }
    }
    
    gunService = new LoomMeshService(config)
    await gunService.start()
    
    const stateStore = AdapterFactory.createStateStore({
      type: 'gun',
      gun: { service: gunService }
    })
    
    expect(stateStore).toBeDefined()
    
    // Test basic operations using legacy StateStore interface
    const timestamp = Date.now()
    const actorId = `test-actor-${timestamp}`
    
    const actorState = {
      id: actorId,
      partitionKey: 'test',
      actorType: 'test',
      status: 'active' as const,
      state: {
        count: 42,
        name: 'Test Actor'
      },
      correlationId: actorId,
      createdAt: new Date().toISOString(),
      lastActivatedAt: new Date().toISOString(),
      metadata: {}
    }
    
    await stateStore.save(actorId, actorState)
    
    await new Promise(resolve => setTimeout(resolve, 100))
    
    const retrieved = await stateStore.load(actorId)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(actorId)
    expect(retrieved?.state.count).toBe(42)
    expect(retrieved?.state.name).toBe('Test Actor')
  }, 10000)

  it('should throw error if gun service not provided', () => {
    expect(() => {
      AdapterFactory.createStateStore({
        type: 'gun',
        gun: undefined
      } as any)
    }).toThrow('LoomMeshService required for gun StateStore')
  })

  it('should default to inmemory if no config provided', () => {
    const stateStore = AdapterFactory.createStateStore()
    expect(stateStore).toBeDefined()
    // Should be InMemoryStateStore (not a GUN store)
  })

  it('should create inmemory explicitly', () => {
    const stateStore = AdapterFactory.createStateStore({ type: 'inmemory' })
    expect(stateStore).toBeDefined()
  })

  it('should support createAll with gun state store', async () => {
    const config: LoomMeshConfig = {
      storage: { type: 'memory' }
    }
    
    gunService = new LoomMeshService(config)
    await gunService.start()
    
    const adapters = AdapterFactory.createAll({
      messageQueue: { type: 'inmemory' },
      stateStore: {
        type: 'gun',
        gun: { service: gunService }
      },
      blobStore: { type: 'inmemory' },
      journalStore: { type: 'inmemory' }
    })
    
    expect(adapters.stateStore).toBeDefined()
    expect(adapters.messageQueue).toBeDefined()
    expect(adapters.blobStore).toBeDefined()
    expect(adapters.journalStore).toBeDefined()
    
    // Test state store works with legacy interface
    const timestamp = Date.now()
    const actorId = `integrated-actor-${timestamp}`
    
    const actorState = {
      id: actorId,
      partitionKey: 'test',
      actorType: 'test',
      status: 'active' as const,
      state: {
        value: 'integrated'
      },
      correlationId: actorId,
      createdAt: new Date().toISOString(),
      lastActivatedAt: new Date().toISOString(),
      metadata: {}
    }
    
    await adapters.stateStore.save(actorId, actorState)
    
    await new Promise(resolve => setTimeout(resolve, 100))
    
    const retrieved = await adapters.stateStore.load(actorId)
    expect(retrieved?.state.value).toBe('integrated')
  }, 10000)
})
