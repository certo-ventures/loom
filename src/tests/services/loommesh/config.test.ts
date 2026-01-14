import { describe, it, expect, beforeEach } from 'vitest'
import {
  type LoomMeshConfig,
  AzureConfig,
  validateConfig,
  applyDefaults,
  loadLoomMeshConfig,
  saveLoomMeshConfig
} from '../../../services/loommesh/config'
import { InMemoryConfigResolver } from '../../../config-resolver/in-memory-resolver'
import type { ConfigResolver } from '../../../config-resolver/index'

describe('LoomMesh Config', () => {
  let configResolver: ConfigResolver
  
  beforeEach(() => {
    configResolver = new InMemoryConfigResolver()
  })
  describe('validateConfig', () => {
    it('should validate valid memory storage config', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      expect(() => validateConfig(config)).not.toThrow()
    })
    
    it('should validate valid disk storage config', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'disk', path: '/tmp/data' }
      }
      expect(() => validateConfig(config)).not.toThrow()
    })
    
    it('should validate valid Azure Files storage config', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'azure-files', path: '/mnt/loom-data' }
      }
      expect(() => validateConfig(config)).not.toThrow()
    })
    
    it('should require storage configuration', () => {
      const config = {} as LoomMeshConfig
      expect(() => validateConfig(config)).toThrow('Storage configuration is required')
    })
    
    it('should reject invalid storage type', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'invalid' as any }
      }
      expect(() => validateConfig(config)).toThrow('Invalid storage type')
    })
    
    it('should require path for disk storage', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'disk' }
      }
      expect(() => validateConfig(config)).toThrow('Storage path is required')
    })
    
    it('should require path for Azure Files storage', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'azure-files' }
      }
      expect(() => validateConfig(config)).toThrow('Storage path is required')
    })
    
    it('should require adapter for custom storage', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'custom' }
      }
      expect(() => validateConfig(config)).toThrow('Custom storage adapter is required')
    })
    
    it('should validate WebSocket port range', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        webSocket: { enabled: true, port: 70000 }
      }
      expect(() => validateConfig(config)).toThrow('Invalid WebSocket port')
    })
    
    it('should validate peer URLs', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        peers: { peers: ['http://invalid'] }
      }
      expect(() => validateConfig(config)).toThrow('Invalid peer URL')
    })
    
    it('should accept valid peer URLs', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        peers: {
          peers: [
            'ws://localhost:8765',
            'wss://relay.example.com:8765'
          ]
        }
      }
      expect(() => validateConfig(config)).not.toThrow()
    })
    
    it('should validate metrics interval', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        metricsInterval: 500
      }
      expect(() => validateConfig(config)).toThrow('Metrics interval must be at least 1000ms')
    })
  })
  
  describe('ConfigResolver Integration', () => {
    it('should load config from ConfigResolver', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' },
        peers: { peers: ['ws://localhost:8765'] }
      }
      
      await configResolver.set('services/loommesh', config)
      
      const loaded = await loadLoomMeshConfig({
        configResolver,
        configKey: 'services/loommesh'
      })
      
      expect(loaded.storage.type).toBe('memory')
      expect(loaded.peers?.peers).toEqual(['ws://localhost:8765'])
    })
    
    it('should load context-aware config', async () => {
      // Set global config
      await configResolver.set('services/loommesh', {
        storage: { type: 'memory' },
        webSocket: { port: 8765 }
      })
      
      // Set production-specific override
      await configResolver.set('production/services/loommesh', {
        storage: { type: 'azure-files', path: '/mnt/loom-data' },
        webSocket: { port: 8765 }
      })
      
      const prodConfig = await loadLoomMeshConfig({
        configResolver,
        configKey: 'services/loommesh',
        context: { environment: 'production' }
      })
      
      // Should get production config
      expect(prodConfig.storage.type).toBe('azure-files')
    })
    
    it('should save config to ConfigResolver', async () => {
      const config: LoomMeshConfig = {
        storage: { type: 'disk', path: '/tmp/data' },
        peers: { peers: ['ws://peer1:8765', 'ws://peer2:8765'] }
      }
      
      await saveLoomMeshConfig({ configResolver }, config)
      
      const saved = await configResolver.get('services/loommesh')
      expect(saved).toEqual(config)
    })
    
    it('should throw if config not found', async () => {
      await expect(
        loadLoomMeshConfig({ configResolver })
      ).rejects.toThrow('LoomMesh configuration not found')
    })
    
    it('should validate config on save', async () => {
      const invalidConfig = {
        storage: { type: 'invalid' }
      } as any
      
      await expect(
        saveLoomMeshConfig({ configResolver }, invalidConfig)
      ).rejects.toThrow('Invalid storage type')
    })
  })
  
  describe('applyDefaults', () => {
    it('should apply default name', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      const result = applyDefaults(config)
      expect(result.name).toBe('loommesh')
    })
    
    it('should preserve custom name', () => {
      const config: LoomMeshConfig = {
        name: 'custom-mesh',
        storage: { type: 'memory' }
      }
      const result = applyDefaults(config)
      expect(result.name).toBe('custom-mesh')
    })
    
    it('should apply default peer config', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      const result = applyDefaults(config)
      expect(result.peers).toEqual({
        peers: [],
        maxRetries: 5,
        retryDelay: 1000,
        timeout: 10000,
        enableDnsDiscovery: false,
        dnsServiceName: undefined
      })
    })
    
    it('should apply default WebSocket config', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      const result = applyDefaults(config)
      expect(result.webSocket).toEqual({
        port: 8765,
        host: '0.0.0.0',
        enabled: true,
        tls: undefined
      })
    })
    
    it('should apply default metrics interval', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      const result = applyDefaults(config)
      expect(result.metricsInterval).toBe(5000)
    })
    
    it('should apply default debug flag', () => {
      const config: LoomMeshConfig = {
        storage: { type: 'memory' }
      }
      const result = applyDefaults(config)
      expect(result.debug).toBe(false)
    })
    
    it('should preserve custom values', () => {
      const config: LoomMeshConfig = {
        name: 'custom',
        storage: { type: 'memory' },
        peers: {
          peers: ['ws://peer:8765'],
          maxRetries: 10
        },
        webSocket: {
          port: 9000,
          host: 'localhost'
        },
        metricsInterval: 10000,
        debug: true
      }
      const result = applyDefaults(config)
      
      expect(result.name).toBe('custom')
      expect(result.peers.peers).toEqual(['ws://peer:8765'])
      expect(result.peers.maxRetries).toBe(10)
      expect(result.webSocket.port).toBe(9000)
      expect(result.webSocket.host).toBe('localhost')
      expect(result.metricsInterval).toBe(10000)
      expect(result.debug).toBe(true)
    })
  })
  
  describe('AzureConfig', () => {
    describe('createRelayConfig', () => {
      it('should create relay config with defaults', () => {
        const config = AzureConfig.createRelayConfig()
        
        expect(config.name).toBe('loommesh-relay')
        expect(config.storage.type).toBe('azure-files')
        expect(config.storage.path).toBe('/mnt/loom-data')
        expect(config.webSocket?.enabled).toBe(true)
        expect(config.webSocket?.port).toBe(8765)
        expect(config.webSocket?.host).toBe('0.0.0.0')
        expect(config.peers?.peers).toEqual([])
        expect(config.peers?.maxRetries).toBe(0)
      })
      
      it('should accept custom options', () => {
        const config = AzureConfig.createRelayConfig({
          storagePath: '/custom/path',
          port: 9000
        })
        
        expect(config.storage.path).toBe('/custom/path')
        expect(config.webSocket?.port).toBe(9000)
      })
    })
    
    describe('createNodeConfig', () => {
      it('should create node config with required relay URL', () => {
        const config = AzureConfig.createNodeConfig({
          relayUrl: 'wss://relay.example.com:8765'
        })
        
        expect(config.name).toBe('loommesh')
        expect(config.storage.type).toBe('azure-files')
        expect(config.storage.path).toBe('/mnt/loom-data')
        expect(config.webSocket?.enabled).toBe(true)
        expect(config.webSocket?.port).toBe(8765)
        expect(config.peers?.peers).toEqual(['wss://relay.example.com:8765'])
        expect(config.peers?.maxRetries).toBe(5)
        expect(config.peers?.retryDelay).toBe(1000)
        expect(config.peers?.timeout).toBe(10000)
      })
      
      it('should accept custom options', () => {
        const config = AzureConfig.createNodeConfig({
          relayUrl: 'wss://relay.example.com:8765',
          storagePath: '/custom/path',
          port: 9000,
          enableDnsDiscovery: true,
          dnsServiceName: 'loom-node.internal.example.com'
        })
        
        expect(config.storage.path).toBe('/custom/path')
        expect(config.webSocket?.port).toBe(9000)
        expect(config.peers?.enableDnsDiscovery).toBe(true)
        expect(config.peers?.dnsServiceName).toBe('loom-node.internal.example.com')
      })
    })
    
    describe('createLocalConfig', () => {
      it('should create local config with defaults', () => {
        const config = AzureConfig.createLocalConfig()
        
        expect(config.name).toBe('loommesh-local')
        expect(config.storage.type).toBe('disk')
        expect(config.storage.path).toBe('./data/loommesh')
        expect(config.webSocket?.enabled).toBe(true)
        expect(config.webSocket?.port).toBe(8765)
        expect(config.webSocket?.host).toBe('localhost')
        expect(config.peers?.peers).toEqual([])
        expect(config.peers?.maxRetries).toBe(3)
        expect(config.debug).toBe(true)
      })
      
      it('should accept custom options', () => {
        const config = AzureConfig.createLocalConfig({
          port: 9000,
          storagePath: './custom/data'
        })
        
        expect(config.webSocket?.port).toBe(9000)
        expect(config.storage.path).toBe('./custom/data')
      })
    })
  })
})
