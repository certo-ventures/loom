import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LoomMeshService } from '../../../services/loommesh/loommesh-service'
import type { LoomMeshConfig } from '../../../services/loommesh/config'
import { ServiceLifecycle } from '../../../services/service'

// Mock Gun
vi.mock('gun', () => {
  const mockGun = vi.fn(() => ({
    opt: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    on: vi.fn()
  }))
  
  mockGun.on = vi.fn()
  
  return { default: mockGun }
})

// Mock http server
vi.mock('http', () => ({
  createServer: vi.fn(() => ({
    listen: vi.fn((port: number, host: string, callback: () => void) => {
      setTimeout(callback, 0)
    }),
    close: vi.fn((callback: (err?: Error) => void) => {
      setTimeout(() => callback(), 0)
    }),
    on: vi.fn()
  }))
}))

// Mock fs for storage initialization
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 1024 })
}))

describe('LoomMeshService', () => {
  let service: LoomMeshService
  
  beforeEach(() => {
    vi.clearAllMocks()
  })
  
  afterEach(async () => {
    if (service && service.state === ServiceLifecycle.RUNNING) {
      await service.stop()
    }
  })
  
  describe('Lifecycle', () => {
    it('should start with memory storage', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      
      expect(service.state).toBe(ServiceLifecycle.INITIAL)
      
      await service.start()
      
      expect(service.state).toBe(ServiceLifecycle.RUNNING)
    })
    
    it('should start with disk storage', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'disk', path: '/tmp/test-loommesh' },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      expect(service.state).toBe(ServiceLifecycle.RUNNING)
    })
    
    it('should start with WebSocket server enabled', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: {
          enabled: true,
          port: 9999,
          host: 'localhost'
        }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      expect(service.state).toBe(ServiceLifecycle.RUNNING)
    })
    
    it('should stop cleanly', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      await service.stop()
      
      expect(service.state).toBe(ServiceLifecycle.STOPPED)
    })
    
    it('should be idempotent on multiple starts', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      
      await service.start()
      await service.start() // Should not throw
      
      expect(service.state).toBe(ServiceLifecycle.RUNNING)
    })
    
    it('should be idempotent on multiple stops', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      
      await service.start()
      await service.stop()
      await service.stop() // Should not throw
      
      expect(service.state).toBe(ServiceLifecycle.STOPPED)
    })
  })
  
  describe('Health Checks', () => {
    it('should be unhealthy when not started', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      
      service = new LoomMeshService(config)
      
      const healthy = await service.isHealthy()
      expect(healthy).toBe(false)
      
      const status = await service.getHealthStatus()
      expect(status.status).toBe('unhealthy')
      expect(status.message).toContain('not running')
    })
    
    it('should be healthy when running with no peers', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const healthy = await service.isHealthy()
      expect(healthy).toBe(true)
      
      const status = await service.getHealthStatus()
      expect(status.status).toBe('healthy')
      expect(status.message).toContain('standalone')
    })
    
    it('should include peer info in health status', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: false },
        peers: {
          peers: ['ws://peer1:8765', 'ws://peer2:8765']
        }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const status = await service.getHealthStatus()
      expect(status.details?.peers).toBeDefined()
    })
  })
  
  describe('Metrics', () => {
    it('should include base metrics', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const metrics = await service.getMetrics()
      
      expect(metrics.uptime).toBeGreaterThanOrEqual(0)
      expect(metrics.state).toBe(ServiceLifecycle.RUNNING)
      expect(metrics.errorCount).toBe(0)
    })
    
    it('should include LoomMesh-specific metrics', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: true }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const metrics = await service.getMetrics()
      
      expect(metrics.connectedPeers).toBeDefined()
      expect(metrics.totalPeers).toBeDefined()
      expect(metrics.serverEnabled).toBe(true)
      expect(metrics.storageType).toBe('memory')
    })
    
    it('should include disk usage for disk storage', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'disk', path: '/tmp/test' },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const metrics = await service.getMetrics()
      
      expect(metrics.diskUsage).toBeDefined()
    })
  })
  
  describe('GUN Instance', () => {
    it('should provide access to GUN instance', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const gun = service.getGun()
      expect(gun).toBeDefined()
      expect(typeof gun.get).toBe('function')
      expect(typeof gun.put).toBe('function')
    })
    
    it('should throw if accessing GUN before start', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      
      service = new LoomMeshService(config)
      
      expect(() => service.getGun()).toThrow('LoomMesh service not started')
    })
  })
  
  describe('Peer Management', () => {
    it('should track peer connections', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: false },
        peers: {
          peers: ['ws://peer1:8765', 'ws://peer2:8765']
        }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const peerStatus = service.getPeerStatus()
      expect(Object.keys(peerStatus)).toHaveLength(2)
      expect(peerStatus['ws://peer1:8765']).toBeDefined()
      expect(peerStatus['ws://peer2:8765']).toBeDefined()
    })
    
    it('should handle peer connection failures gracefully', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: false },
        peers: {
          peers: ['ws://invalid-peer:8765'],
          maxRetries: 1,
          retryDelay: 10
        }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      // Service should still start even if peer connection fails
      expect(service.state).toBe(ServiceLifecycle.RUNNING)
    })
  })
  
  describe('Configuration', () => {
    it('should apply default configuration', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      
      service = new LoomMeshService(config)
      await service.start()
      
      const metrics = await service.getMetrics()
      expect(metrics.serverEnabled).toBe(true) // Default WebSocket enabled
    })
    
    it('should use custom service name', async () => {
      const config: LoomMeshConfig = {
        name: 'custom-mesh',
        storage: { type: 'memory' },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      expect(service.name).toBe('custom-mesh')
    })
  })
  
  describe('Error Handling', () => {
    it('should handle storage initialization failure', async () => {
      const fs = await import('fs/promises')
      vi.mocked(fs.mkdir).mockRejectedValueOnce(new Error('Permission denied'))
      
      const config: LoomMeshConfig = {
        storage: { type: 'disk', path: '/invalid/path' },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      
      await expect(service.start()).rejects.toThrow('Failed to create storage directory')
      expect(service.state).toBe(ServiceLifecycle.ERROR)
    })
    
    it('should track errors in metrics', async () => {
      const fs = await import('fs/promises')
      vi.mocked(fs.mkdir).mockRejectedValueOnce(new Error('Storage error'))
      
      const config: LoomMeshConfig = {
        storage: { type: 'disk', path: '/invalid' },
        webSocket: { enabled: false }
      }
      
      service = new LoomMeshService(config)
      
      try {
        await service.start()
      } catch {
        // Expected
      }
      
      const metrics = await service.getMetrics()
      expect(metrics.errorCount).toBeGreaterThan(0)
    })
  })
})
