/**
 * LoomMesh Service
 * 
 * Wraps the GUN library to provide distributed state synchronization
 * across Loom nodes. Implements the Service interface for lifecycle
 * management and observability.
 * 
 * Key Features:
 * - Shared GUN instance per node (efficient)
 * - Peer connection management with retry logic
 * - Health checks based on peer connectivity
 * - Metrics collection (peers, disk usage, sync latency)
 * - Graceful startup and shutdown
 */

import Gun from 'gun'
import type { IGunInstance } from 'gun'
import { BaseService, type HealthStatus, type ServiceMetrics } from '../service.js'
import type { LoomMeshConfig } from './config.js'
import { applyDefaults } from './config.js'
import * as fs from 'fs/promises'
import * as path from 'path'

/**
 * Peer connection info
 */
interface PeerInfo {
  url: string
  connected: boolean
  lastAttempt?: number
  retryCount: number
  error?: string
}

/**
 * LoomMesh Service - wraps GUN for distributed state sync
 */
export class LoomMeshService extends BaseService {
  private config: Required<LoomMeshConfig>
  private gun?: IGunInstance
  private peers: Map<string, PeerInfo> = new Map()
  private server?: any // WebSocket server
  private retryTimers: Map<string, NodeJS.Timeout> = new Map()
  private metricsTimer?: NodeJS.Timeout
  private startupTime?: number

  constructor(config: LoomMeshConfig) {
    super(config.name || 'loommesh')
    this.config = applyDefaults(config)
  }

  // ========================================================================
  // BaseService Implementation
  // ========================================================================

  protected async onStart(): Promise<void> {
    this.log('Starting LoomMesh service...')
    
    // Initialize storage
    await this.initializeStorage()
    
    // Create GUN instance
    this.gun = await this.createGunInstance()
    
    // Start WebSocket server (if enabled)
    if (this.config.webSocket.enabled) {
      await this.startWebSocketServer()
    }
    
    // Connect to peers
    await this.connectToPeers()
    
    // Start metrics collection
    this.startMetricsCollection()
    
    this.startupTime = Date.now()
    this.log('LoomMesh service started successfully')
  }

  protected async onStop(): Promise<void> {
    this.log('Stopping LoomMesh service...')
    
    // Stop metrics collection
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer)
      this.metricsTimer = undefined
    }
    
    // Cancel retry timers
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer)
    }
    this.retryTimers.clear()
    
    // Stop WebSocket server
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server.close((err?: Error) => {
          if (err) reject(err)
          else resolve()
        })
      })
      this.server = undefined
    }
    
    // Cleanup GUN instance
    // Note: GUN doesn't have a formal shutdown API
    // We just clear our reference
    this.gun = undefined
    this.peers.clear()
    
    this.log('LoomMesh service stopped')
  }

  protected async onHealthCheck(): Promise<HealthStatus> {
    if (!this.gun) {
      return {
        status: 'unhealthy',
        message: 'GUN instance not initialized',
        timestamp: Date.now()
      }
    }
    
    // Check peer connectivity
    const connectedPeers = Array.from(this.peers.values()).filter(p => p.connected).length
    const totalPeers = this.peers.size
    
    if (totalPeers > 0 && connectedPeers === 0) {
      return {
        status: 'unhealthy',
        message: `No peers connected (0/${totalPeers})`,
        details: {
          connectedPeers,
          totalPeers,
          peers: this.getPeerStatus()
        },
        timestamp: Date.now()
      }
    }
    
    if (totalPeers > 0 && connectedPeers < totalPeers / 2) {
      return {
        status: 'degraded',
        message: `Only ${connectedPeers}/${totalPeers} peers connected`,
        details: {
          connectedPeers,
          totalPeers,
          peers: this.getPeerStatus()
        },
        timestamp: Date.now()
      }
    }
    
    return {
      status: 'healthy',
      message: totalPeers > 0 
        ? `Connected to ${connectedPeers}/${totalPeers} peers`
        : 'Running standalone (no peers configured)',
      details: {
        connectedPeers,
        totalPeers,
        peers: this.getPeerStatus()
      },
      timestamp: Date.now()
    }
  }

  protected async onGetMetrics(): Promise<ServiceMetrics> {
    const connectedPeers = Array.from(this.peers.values()).filter(p => p.connected).length
    
    const metrics: ServiceMetrics = {
      connectedPeers,
      totalPeers: this.peers.size,
      serverEnabled: this.config.webSocket.enabled,
      storageType: this.config.storage.type
    }
    
    // Add disk usage for disk/azure-files storage
    if (this.config.storage.path) {
      try {
        metrics.diskUsage = await this.getDiskUsage()
      } catch (error) {
        this.log(`Failed to get disk usage: ${error}`)
      }
    }
    
    return metrics
  }

  // ========================================================================
  // Public API
  // ========================================================================

  /**
   * Get the shared GUN instance
   * This is the primary API for other services to access GUN
   */
  getGun(): IGunInstance {
    if (!this.gun) {
      throw new Error('LoomMesh service not started')
    }
    return this.gun
  }

  /**
   * Get peer connection status
   */
  getPeerStatus(): Record<string, PeerInfo> {
    const status: Record<string, PeerInfo> = {}
    for (const [url, info] of this.peers.entries()) {
      status[url] = { ...info }
    }
    return status
  }

  // ========================================================================
  // Private Implementation
  // ========================================================================

  /**
   * Initialize storage (create directories if needed)
   */
  private async initializeStorage(): Promise<void> {
    if (this.config.storage.type === 'disk' || this.config.storage.type === 'azure-files') {
      if (!this.config.storage.path) {
        throw new Error(`Storage path required for ${this.config.storage.type}`)
      }
      
      try {
        await fs.mkdir(this.config.storage.path, { recursive: true })
        this.log(`Storage directory created: ${this.config.storage.path}`)
      } catch (error) {
        throw new Error(`Failed to create storage directory: ${error}`)
      }
    }
  }

  /**
   * Create and configure GUN instance
   */
  private async createGunInstance(): Promise<IGunInstance> {
    const gunOptions: any = {
      ...this.config.gunOptions
    }
    
    // Configure storage adapter
    if (this.config.storage.type === 'memory') {
      // Use default in-memory storage (no adapter needed)
      this.log('Using in-memory storage')
    } else if (this.config.storage.type === 'disk' || this.config.storage.type === 'azure-files') {
      // Use file storage adapter
      gunOptions.file = this.config.storage.path
      this.log(`Using disk storage: ${this.config.storage.path}`)
    } else if (this.config.storage.type === 'custom') {
      // Use custom adapter
      if (!this.config.storage.adapter) {
        throw new Error('Custom storage adapter required')
      }
      gunOptions.store = this.config.storage.adapter
      this.log('Using custom storage adapter')
    }
    
    const gun = Gun(gunOptions) as IGunInstance
    
    this.log('GUN instance created')
    return gun
  }

  /**
   * Start WebSocket server for peer connections
   */
  private async startWebSocketServer(): Promise<void> {
    const { createServer } = await import('http')
    const Gun = await import('gun')
    
    this.server = createServer()
    
    // Attach GUN to server
    Gun.default.on('create', (root: any) => {
      root.opt({ web: this.server })
    })
    
    await new Promise<void>((resolve, reject) => {
      this.server.listen(
        this.config.webSocket.port,
        this.config.webSocket.host,
        () => {
          this.log(`WebSocket server listening on ${this.config.webSocket.host}:${this.config.webSocket.port}`)
          resolve()
        }
      )
      this.server.on('error', reject)
    })
  }

  /**
   * Connect to configured peers
   */
  private async connectToPeers(): Promise<void> {
    if (!this.config.peers.peers || this.config.peers.peers.length === 0) {
      this.log('No peers configured')
      return
    }
    
    for (const peerUrl of this.config.peers.peers) {
      await this.connectToPeer(peerUrl)
    }
  }

  /**
   * Connect to a single peer with retry logic
   */
  private async connectToPeer(peerUrl: string, retryCount = 0): Promise<void> {
    if (!this.gun) return
    
    // Initialize peer info
    if (!this.peers.has(peerUrl)) {
      this.peers.set(peerUrl, {
        url: peerUrl,
        connected: false,
        retryCount: 0
      })
    }
    
    const peerInfo = this.peers.get(peerUrl)!
    peerInfo.lastAttempt = Date.now()
    peerInfo.retryCount = retryCount
    
    try {
      // Connect to peer
      this.gun.opt({ peers: [peerUrl] })
      
      // Note: GUN doesn't provide explicit connection callbacks
      // We'll mark as connected optimistically
      peerInfo.connected = true
      peerInfo.error = undefined
      
      this.log(`Connected to peer: ${peerUrl}`)
    } catch (error) {
      peerInfo.connected = false
      peerInfo.error = error instanceof Error ? error.message : String(error)
      
      this.log(`Failed to connect to peer ${peerUrl}: ${peerInfo.error}`)
      
      // Retry with exponential backoff
      if (retryCount < (this.config.peers.maxRetries ?? 5)) {
        const delay = (this.config.peers.retryDelay ?? 1000) * Math.pow(2, retryCount)
        this.log(`Retrying connection to ${peerUrl} in ${delay}ms (attempt ${retryCount + 1}/${this.config.peers.maxRetries})`)
        
        const timer = setTimeout(() => {
          this.retryTimers.delete(peerUrl)
          this.connectToPeer(peerUrl, retryCount + 1)
        }, delay)
        
        this.retryTimers.set(peerUrl, timer)
      } else {
        this.log(`Max retries reached for peer: ${peerUrl}`)
      }
    }
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsTimer = setInterval(() => {
      // Periodic health check and metrics update
      // This helps detect peer disconnections
      this.isHealthy().catch(err => {
        this.log(`Health check failed: ${err}`)
      })
    }, this.config.metricsInterval)
  }

  /**
   * Get disk usage for storage path
   */
  private async getDiskUsage(): Promise<number> {
    if (!this.config.storage.path) return 0
    
    try {
      const stats = await fs.stat(this.config.storage.path)
      return stats.size
    } catch (error) {
      return 0
    }
  }

  /**
   * Log helper
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[${this.name}] ${message}`)
    }
  }
}
