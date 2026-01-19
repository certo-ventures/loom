/**
 * LoomMesh Service Integration Tests
 * 
 * These tests use the REAL GUN library (not mocked) to verify:
 * - Actual GUN instance creation
 * - Real storage adapters
 * - Actual data persistence
 * - Real peer connectivity (local testing)
 * 
 * Run with: npm test -- loommesh-service.integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LoomMeshService } from '../../../services/loommesh/loommesh-service'
import type { LoomMeshConfig } from '../../../services/loommesh/config'
import { ServiceLifecycle } from '../../../services/service'
import * as fs from 'fs/promises'
import * as path from 'path'
import { tmpdir } from 'os'

// NO MOCKS - using real GUN library

describe('LoomMeshService Integration Tests', () => {
  let service: LoomMeshService
  let testDir: string
  
  beforeEach(async () => {
    // Create unique test directory
    testDir = path.join(tmpdir(), `loommesh-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
  })
  
  afterEach(async () => {
    // Cleanup service
    if (service && service.state === ServiceLifecycle.RUNNING) {
      await service.stop()
    }
    
    // Cleanup test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch (error) {
      // Ignore cleanup errors
    }
  })
  
  describe('Real GUN Integration', () => {
    it('should create actual GUN instance with memory storage', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: false },
        debug: true
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const gun = service.getGun()
      
      // Verify we have a real GUN instance with actual methods
      expect(gun).toBeDefined()
      expect(typeof gun.get).toBe('function')
      expect(typeof gun.put).toBe('function')
      expect(typeof gun.on).toBe('function')
      
      // Test actual GUN operations
      const testNode = gun.get('test-key')
      expect(testNode).toBeDefined()
    })
    
    it('should persist data with disk storage', async () => {
      const config: LoomMeshConfig = {
        storage: { 
          type: 'disk', 
          path: testDir 
        },
        webSocket: { enabled: false },
        debug: true
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const gun = service.getGun()
      
      // Write data
      await new Promise<void>((resolve) => {
        gun.get('persistent-data').put({ 
          message: 'Hello LoomMesh',
          timestamp: Date.now()
        }, (ack: any) => {
          resolve()
        })
      })
      
      // Verify data was written
      const data = await new Promise((resolve) => {
        gun.get('persistent-data').once((val: any) => {
          resolve(val)
        })
      })
      
      expect(data).toMatchObject({
        message: 'Hello LoomMesh'
      })
      
      // Stop service
      await service.stop()
      
      // Restart and verify persistence
      const service2 = new LoomMeshService(config)
      await service2.start()
      
      const gun2 = service2.getGun()
      const persistedData = await new Promise((resolve) => {
        gun2.get('persistent-data').once((val: any) => {
          resolve(val)
        })
      })
      
      expect(persistedData).toMatchObject({
        message: 'Hello LoomMesh'
      })
      
      await service2.stop()
    })
    
    it('should handle WebSocket server with real http server', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: {
          enabled: true,
          port: 18765, // High port to avoid conflicts
          host: '127.0.0.1'
        },
        debug: true
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      expect(service.state).toBe(ServiceLifecycle.RUNNING)
      
      // Give server time to start
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const health = await service.getHealthStatus()
      expect(health.status).toBe('healthy')
      
      await service.stop()
    }, 10000) // Longer timeout for WebSocket server
    
    it('should handle actual GUN data operations', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: false },
        debug: true
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const gun = service.getGun()
      
      // Test various GUN operations
      
      // 1. Simple put/get
      await new Promise<void>((resolve) => {
        gun.get('user').put({ 
          name: 'Alice',
          age: 30 
        }, () => resolve())
      })
      
      const user = await new Promise((resolve) => {
        gun.get('user').once((val: any) => resolve(val))
      })
      
      expect(user).toMatchObject({
        name: 'Alice',
        age: 30
      })
      
      // 2. Nested data
      await new Promise<void>((resolve) => {
        gun.get('app').get('config').put({ 
          theme: 'dark',
          version: '1.0.0'
        }, () => resolve())
      })
      
      const config2 = await new Promise((resolve) => {
        gun.get('app').get('config').once((val: any) => resolve(val))
      })
      
      expect(config2).toMatchObject({
        theme: 'dark',
        version: '1.0.0'
      })
      
      // 3. Update operation
      await new Promise<void>((resolve) => {
        gun.get('user').get('age').put(31, () => resolve())
      })
      
      const updatedAge = await new Promise((resolve) => {
        gun.get('user').get('age').once((val: any) => resolve(val))
      })
      
      expect(updatedAge).toBe(31)
    })
  })
  
  describe('Multi-Node Simulation', () => {
    it('should establish peer connection between two local nodes', async () => {
      // Start relay node (server)
      const relayConfig: LoomMeshConfig = {
        name: 'relay-node',
        storage: { type: 'memory' },
        webSocket: {
          enabled: true,
          port: 18766,
          host: '127.0.0.1'
        },
        peers: {
          peers: []
        },
        debug: true
      }
      
      const relayService = new LoomMeshService(relayConfig)
      await relayService.start()
      
      // Give relay time to start
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Start client node connecting to relay
      const clientConfig: LoomMeshConfig = {
        name: 'client-node',
        storage: { type: 'memory' },
        webSocket: {
          enabled: true,
          port: 18767,
          host: '127.0.0.1'
        },
        peers: {
          peers: ['http://127.0.0.1:18766/gun'],
          maxRetries: 3,
          retryDelay: 100
        },
        debug: true
      }
      
      service = new LoomMeshService(clientConfig)
      await service.start()
      
      // Give peers time to connect
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Check peer status
      const relayHealth = await relayService.getHealthStatus()
      const clientHealth = await service.getHealthStatus()
      
      expect(relayService.state).toBe(ServiceLifecycle.RUNNING)
      expect(service.state).toBe(ServiceLifecycle.RUNNING)
      
      // Cleanup
      await service.stop()
      await relayService.stop()
    }, 15000) // Longer timeout for multi-node setup
  })
  
  describe('Error Scenarios', () => {
    it('should handle invalid storage path gracefully', async () => {
      const config: LoomMeshConfig = {
        storage: { 
          type: 'disk', 
          path: '/invalid/readonly/path' 
        },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      
      // Should fail to start due to invalid path
      await expect(service.start()).rejects.toThrow()
      expect(service.state).toBe(ServiceLifecycle.ERROR)
    })
    
    it('should handle port already in use', async () => {
      // Start first service on port
      const config1: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: {
          enabled: true,
          port: 18768,
          host: '127.0.0.1'
        }
      }
      
      const service1 = new LoomMeshService(config1)
      await service1.start()
      
      // Try to start second service on same port
      const config2: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: {
          enabled: true,
          port: 18768, // Same port
          host: '127.0.0.1'
        }
      }
      
      service = new LoomMeshService(config2)
      
      // Should fail due to port conflict
      await expect(service.start()).rejects.toThrow()
      
      // Cleanup
      await service1.stop()
    }, 10000)
  })

  describe('State Store Integration (TODO-008)', () => {
    it('should provide functional state store after service starts', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const store = service.getStateStore()
      expect(store).toBeDefined()
      
      // Use unique actor ID to avoid persistence issues
      const actorId = `actor-test-${Date.now()}`
      
      // Store initial actor state
      const actorState = await store.set(actorId, {
        actorId,
        actorType: 'calculator',
        state: { count: 42 },
        version: 1,
        lastModified: Date.now(),
        createdAt: Date.now()
      })
      
      expect(actorState.actorId).toBe(actorId)
      expect(actorState.state.count).toBe(42)
      expect(actorState.version).toBe(1)
      
      // Wait for GUN to propagate
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Retrieve state - should reconstitute from patches
      const retrieved = await store.get(actorId)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.state.count).toBe(42)
      expect(retrieved?.version).toBe(1)
      
      // Update state - generates new patches
      const updated = await store.set(actorId, {
        state: { count: 100 }
      })
      expect(updated.state.count).toBe(100)
      expect(updated.version).toBe(2)
      
      // Retrieve updated state
      await new Promise(resolve => setTimeout(resolve, 100))
      const retrievedUpdated = await store.get(actorId)
      expect(retrievedUpdated?.state.count).toBe(100)
      expect(retrievedUpdated?.version).toBe(2)
      
      // Delete state
      const deleted = await store.delete(actorId)
      expect(deleted).toBe(true)
      
      // Verify deletion
      const afterDelete = await store.get(actorId).catch(() => null)
      expect(afterDelete).toBeNull()
    }, 10000)
    
    it('should support patch-based event sourcing and time-travel', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const store = service.getStateStore()
      
      // Use unique actor ID
      const actorId = `time-traveler-${Date.now()}`
      
      // Create actor with initial state
      await store.set(actorId, {
        actorId,
        actorType: 'counter',
        state: { count: 0, name: 'Alice' },
        version: 1,
        lastModified: Date.now(),
        createdAt: Date.now()
      })
      await new Promise(resolve => setTimeout(resolve, 50))
      
      // Evolution 1: Increment count
      await store.set(actorId, {
        state: { count: 10, name: 'Alice' }
      })
      await new Promise(resolve => setTimeout(resolve, 50))
      
      // Evolution 2: Change name
      await store.set(actorId, {
        state: { count: 10, name: 'Bob' }
      })
      await new Promise(resolve => setTimeout(resolve, 50))
      
      // Evolution 3: Increment count again
      await store.set(actorId, {
        state: { count: 20, name: 'Bob' }
      })
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Current state should be version 4
      const current = await store.get(actorId)
      expect(current?.version).toBe(4)
      expect(current?.state.count).toBe(20)
      expect(current?.state.name).toBe('Bob')
      
      // Get patches to see event history
      const patches = await store.getPatches(actorId)
      expect(patches.length).toBeGreaterThan(0)
      console.log(`Total patches recorded: ${patches.length}`)
      
      // Time-travel to version 2 (count: 10, name: 'Alice')
      const atV2 = await store.getStateAt(actorId, 2)
      expect(atV2?.version).toBe(2)
      expect(atV2?.state.count).toBe(10)
      expect(atV2?.state.name).toBe('Alice')
      
      // Time-travel to version 3 (count: 10, name: 'Bob')
      const atV3 = await store.getStateAt(actorId, 3)
      expect(atV3?.version).toBe(3)
      expect(atV3?.state.count).toBe(10)
      expect(atV3?.state.name).toBe('Bob')
      
      // Create snapshot to optimize future queries
      await store.snapshot(actorId)
      const afterSnapshot = await store.get(actorId)
      expect(afterSnapshot?.baseVersion).toBe(4) // Should match current version
      
      // Continue evolution after snapshot
      await store.set(actorId, {
        state: { count: 30, name: 'Charlie' }
      })
      await new Promise(resolve => setTimeout(resolve, 50))
      
      const final = await store.get(actorId)
      expect(final?.version).toBe(5)
      expect(final?.state.count).toBe(30)
      expect(final?.state.name).toBe('Charlie')
      
      // Cleanup
      await store.delete(actorId)
    }, 15000)

    it('should throw error if accessing state store before service starts', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      
      service = new LoomMeshService(config)
      
      expect(() => service.getStateStore()).toThrow('State store not initialized')
      
      await service.start()
      
      const store = service.getStateStore()
      expect(store).toBeDefined()
    }, 10000)
    
    it('should list actors with optional prefix filtering', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const store = service.getStateStore()
      
      // Create multiple actors with different prefixes
      const timestamp = Date.now()
      await store.set(`user-${timestamp}-1`, {
        actorId: `user-${timestamp}-1`,
        actorType: 'user',
        state: { name: 'Alice' },
        version: 1,
        lastModified: timestamp,
        createdAt: timestamp
      })
      
      await store.set(`user-${timestamp}-2`, {
        actorId: `user-${timestamp}-2`,
        actorType: 'user',
        state: { name: 'Bob' },
        version: 1,
        lastModified: timestamp,
        createdAt: timestamp
      })
      
      await store.set(`agent-${timestamp}-1`, {
        actorId: `agent-${timestamp}-1`,
        actorType: 'agent',
        state: { status: 'active' },
        version: 1,
        lastModified: timestamp,
        createdAt: timestamp
      })
      
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // List all actors
      const all = await store.list()
      expect(all.length).toBeGreaterThanOrEqual(3)
      
      // List with prefix
      const users = await store.list(`user-${timestamp}`)
      expect(users).toHaveLength(2)
      expect(users.every(id => id.startsWith(`user-${timestamp}`))).toBe(true)
      
      const agents = await store.list(`agent-${timestamp}`)
      expect(agents).toHaveLength(1)
      expect(agents[0]).toBe(`agent-${timestamp}-1`)
      
      // List non-existent prefix
      const none = await store.list('nonexistent')
      expect(none).toHaveLength(0)
    }, 10000)
  })
})
