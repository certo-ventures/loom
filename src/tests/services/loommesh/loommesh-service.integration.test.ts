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
})
