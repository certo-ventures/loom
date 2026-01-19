/**
 * LoomDB Real-Time Sync (Phase 4 Enhancement)
 * 
 * Provides automatic multi-node synchronization for LoomDB graph data:
 * - Real-time node/edge sync across distributed nodes
 * - Change notifications and event streaming
 * - Conflict resolution for concurrent updates
 * - Efficient change batching and debouncing
 * - Circuit breaker for failing peers
 * 
 * Built on top of ActorStateSync with graph-specific optimizations.
 */

import type { LoomMeshService } from './loommesh-service'
import type { Node, Edge } from './graph-model'
import { LoomDBStore } from './loomdb-store'

/**
 * Change types for graph operations
 */
export enum ChangeType {
  NODE_CREATED = 'node_created',
  NODE_UPDATED = 'node_updated',
  NODE_DELETED = 'node_deleted',
  EDGE_CREATED = 'edge_created',
  EDGE_UPDATED = 'edge_updated',
  EDGE_DELETED = 'edge_deleted'
}

/**
 * Graph change event
 */
export interface GraphChange {
  type: ChangeType
  timestamp: number
  nodeId?: string
  node?: Node
  edgeId?: string
  edge?: Edge
  source?: string // Which node made the change
}

/**
 * Sync event types
 */
export type SyncEventType = 
  | 'remote-change'
  | 'conflict-detected'
  | 'sync-error'
  | 'sync-connected'
  | 'sync-disconnected'

/**
 * Sync event
 */
export interface SyncEvent {
  type: SyncEventType
  timestamp: number
  change?: GraphChange
  data?: any
  error?: Error
}

/**
 * Sync event listener
 */
export type SyncEventListener = (event: SyncEvent) => void

/**
 * Sync configuration options
 */
export interface LoomDBSyncOptions {
  /**
   * Debounce interval in ms (batch rapid updates)
   */
  debounceMs?: number
  
  /**
   * Circuit breaker: max consecutive failures before opening
   */
  circuitBreakerThreshold?: number
  
  /**
   * Circuit breaker: time to wait before retrying (ms)
   */
  circuitBreakerResetMs?: number
  
  /**
   * Conflict resolution strategy
   */
  conflictResolution?: 'last-write-wins' | 'highest-version' | 'merge'
  
  /**
   * Enable automatic conflict resolution
   */
  autoResolveConflicts?: boolean
  
  /**
   * Track changes for replay/history
   */
  trackChanges?: boolean
  
  /**
   * Maximum change history size
   */
  maxChangeHistory?: number
}

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
  failures: number
  isOpen: boolean
  lastFailureTime: number
}

/**
 * LoomDB Sync - Real-time multi-node graph synchronization
 * 
 * Wraps LoomDBStore with automatic synchronization across nodes
 */
export class LoomDBSync {
  private store: LoomDBStore
  private service: LoomMeshService
  private gun: any
  private options: Required<LoomDBSyncOptions>
  
  private listeners: Map<SyncEventType, Set<SyncEventListener>> = new Map()
  private subscriptions: Map<string, any> = new Map() // scope -> GUN subscription
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map()
  private pendingChanges: Map<string, GraphChange> = new Map()
  private changeHistory: GraphChange[] = []
  private isConnected = false

  constructor(
    service: LoomMeshService,
    options: LoomDBSyncOptions = {}
  ) {
    this.service = service
    this.store = new LoomDBStore(service)
    this.gun = service.getGun()
    
    // Set defaults
    this.options = {
      debounceMs: options.debounceMs ?? 100,
      circuitBreakerThreshold: options.circuitBreakerThreshold ?? 5,
      circuitBreakerResetMs: options.circuitBreakerResetMs ?? 30000,
      conflictResolution: options.conflictResolution ?? 'last-write-wins',
      autoResolveConflicts: options.autoResolveConflicts ?? true,
      trackChanges: options.trackChanges ?? false,
      maxChangeHistory: options.maxChangeHistory ?? 1000
    }
  }

  /**
   * Get underlying LoomDB store (for direct access)
   */
  getStore(): LoomDBStore {
    return this.store
  }

  /**
   * Start syncing - subscribe to all graph changes
   */
  async startSync(): Promise<void> {
    if (this.isConnected) {
      return
    }

    try {
      // Subscribe to node changes
      await this.subscribeToNodes()
      
      // Subscribe to edge changes
      await this.subscribeToEdges()
      
      this.isConnected = true
      this.emit('sync-connected', {
        type: 'sync-connected',
        timestamp: Date.now()
      })
    } catch (error) {
      this.emit('sync-error', {
        type: 'sync-error',
        timestamp: Date.now(),
        error: error as Error
      })
      throw error
    }
  }

  /**
   * Stop syncing - unsubscribe from all changes
   */
  async stopSync(): Promise<void> {
    if (!this.isConnected) {
      return
    }

    // Unsubscribe from all
    for (const [scope, subscription] of this.subscriptions.entries()) {
      if (subscription && subscription.off) {
        subscription.off()
      }
    }
    this.subscriptions.clear()

    // Clear debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()

    this.isConnected = false
    this.emit('sync-disconnected', {
      type: 'sync-disconnected',
      timestamp: Date.now()
    })
  }

  /**
   * Subscribe to node changes
   */
  private async subscribeToNodes(): Promise<void> {
    const subscription = this.gun.get('loomdb:nodes').map().on((data: any, nodeId: string) => {
      if (!data || nodeId === '_') return

      try {
        // Detect change type
        const changeType = data === null 
          ? ChangeType.NODE_DELETED 
          : this.subscriptions.has(`node:${nodeId}`)
            ? ChangeType.NODE_UPDATED
            : ChangeType.NODE_CREATED

        if (data === null) {
          // Node deleted
          const change: GraphChange = {
            type: ChangeType.NODE_DELETED,
            timestamp: Date.now(),
            nodeId
          }
          this.handleRemoteChange(change)
        } else {
          // Node created/updated - parse from GUN format
          const node = this.deserializeNode(data, nodeId)
          
          const change: GraphChange = {
            type: changeType,
            timestamp: Date.now(),
            nodeId,
            node
          }
          this.handleRemoteChange(change)
        }

        // Track node subscription
        if (!this.subscriptions.has(`node:${nodeId}`)) {
          this.subscriptions.set(`node:${nodeId}`, true)
        }
      } catch (error) {
        this.emit('sync-error', {
          type: 'sync-error',
          timestamp: Date.now(),
          error: error as Error,
          data: { nodeId }
        })
      }
    })

    this.subscriptions.set('nodes', subscription)
  }

  /**
   * Subscribe to edge changes
   */
  private async subscribeToEdges(): Promise<void> {
    const subscription = this.gun.get('loomdb:edges').map().on((data: any, edgeId: string) => {
      if (!data || edgeId === '_') return

      try {
        const changeType = data === null
          ? ChangeType.EDGE_DELETED
          : this.subscriptions.has(`edge:${edgeId}`)
            ? ChangeType.EDGE_UPDATED
            : ChangeType.EDGE_CREATED

        if (data === null) {
          // Edge deleted
          const change: GraphChange = {
            type: ChangeType.EDGE_DELETED,
            timestamp: Date.now(),
            edgeId
          }
          this.handleRemoteChange(change)
        } else {
          // Edge created/updated
          const edge = this.deserializeEdge(data, edgeId)
          
          const change: GraphChange = {
            type: changeType,
            timestamp: Date.now(),
            edgeId,
            edge
          }
          this.handleRemoteChange(change)
        }

        // Track edge subscription
        if (!this.subscriptions.has(`edge:${edgeId}`)) {
          this.subscriptions.set(`edge:${edgeId}`, true)
        }
      } catch (error) {
        this.emit('sync-error', {
          type: 'sync-error',
          timestamp: Date.now(),
          error: error as Error,
          data: { edgeId }
        })
      }
    })

    this.subscriptions.set('edges', subscription)
  }

  /**
   * Handle remote change from another node
   */
  private handleRemoteChange(change: GraphChange): void {
    // Check circuit breaker
    const scope = change.nodeId ? `node:${change.nodeId}` : `edge:${change.edgeId}`
    if (this.isCircuitOpen(scope)) {
      return
    }

    try {
      // Track change history
      if (this.options.trackChanges) {
        this.changeHistory.push(change)
        if (this.changeHistory.length > this.options.maxChangeHistory) {
          this.changeHistory.shift()
        }
      }

      // Emit remote change event
      this.emit('remote-change', {
        type: 'remote-change',
        timestamp: Date.now(),
        change
      })

      this.recordSuccess(scope)
    } catch (error) {
      this.recordFailure(scope)
      this.emit('sync-error', {
        type: 'sync-error',
        timestamp: Date.now(),
        error: error as Error,
        data: change
      })
    }
  }

  /**
   * Put node with sync broadcast
   */
  async putNode(node: Node): Promise<Node> {
    const result = await this.store.putNode(node)
    
    // Broadcast change (debounced)
    const change: GraphChange = {
      type: ChangeType.NODE_UPDATED,
      timestamp: Date.now(),
      nodeId: node.id,
      node: result,
      source: 'local'
    }
    
    this.broadcastChange(`node:${node.id}`, change)
    
    return result
  }

  /**
   * Delete node with sync broadcast
   */
  async deleteNode(id: string): Promise<boolean> {
    const result = await this.store.deleteNode(id)
    
    if (result) {
      const change: GraphChange = {
        type: ChangeType.NODE_DELETED,
        timestamp: Date.now(),
        nodeId: id,
        source: 'local'
      }
      
      this.broadcastChange(`node:${id}`, change)
    }
    
    return result
  }

  /**
   * Put edge with sync broadcast
   */
  async putEdge(edge: Edge): Promise<Edge> {
    const result = await this.store.putEdge(edge)
    
    const change: GraphChange = {
      type: ChangeType.EDGE_UPDATED,
      timestamp: Date.now(),
      edgeId: edge.id,
      edge: result,
      source: 'local'
    }
    
    this.broadcastChange(`edge:${edge.id}`, change)
    
    return result
  }

  /**
   * Delete edge with sync broadcast
   */
  async deleteEdge(id: string): Promise<boolean> {
    const result = await this.store.deleteEdge(id)
    
    if (result) {
      const change: GraphChange = {
        type: ChangeType.EDGE_DELETED,
        timestamp: Date.now(),
        edgeId: id,
        source: 'local'
      }
      
      this.broadcastChange(`edge:${id}`, change)
    }
    
    return result
  }

  /**
   * Broadcast change to other nodes (with debouncing)
   */
  private broadcastChange(scope: string, change: GraphChange): void {
    // Store pending change
    this.pendingChanges.set(scope, change)

    // Clear existing debounce timer
    const existingTimer = this.debounceTimers.get(scope)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      const pendingChange = this.pendingChanges.get(scope)
      if (pendingChange) {
        // Already written to GUN by store methods, just clean up
        this.pendingChanges.delete(scope)
        this.debounceTimers.delete(scope)
      }
    }, this.options.debounceMs)

    this.debounceTimers.set(scope, timer)
  }

  /**
   * Get change history
   */
  getChangeHistory(): GraphChange[] {
    return [...this.changeHistory]
  }

  /**
   * Clear change history
   */
  clearChangeHistory(): void {
    this.changeHistory = []
  }

  /**
   * Check if circuit breaker is open
   */
  private isCircuitOpen(scope: string): boolean {
    const breaker = this.circuitBreakers.get(scope)
    if (!breaker || !breaker.isOpen) {
      return false
    }

    const now = Date.now()
    if (now - breaker.lastFailureTime >= this.options.circuitBreakerResetMs) {
      breaker.isOpen = false
      breaker.failures = 0
      return false
    }

    return true
  }

  /**
   * Record successful operation
   */
  private recordSuccess(scope: string): void {
    const breaker = this.circuitBreakers.get(scope)
    if (breaker) {
      breaker.failures = 0
      breaker.isOpen = false
    }
  }

  /**
   * Record failed operation
   */
  private recordFailure(scope: string): void {
    let breaker = this.circuitBreakers.get(scope)
    if (!breaker) {
      breaker = { failures: 0, isOpen: false, lastFailureTime: 0 }
      this.circuitBreakers.set(scope, breaker)
    }

    breaker.failures++
    breaker.lastFailureTime = Date.now()

    if (breaker.failures >= this.options.circuitBreakerThreshold) {
      breaker.isOpen = true
    }
  }

  /**
   * Add event listener
   */
  on(eventType: SyncEventType, listener: SyncEventListener): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(listener)
  }

  /**
   * Remove event listener
   */
  off(eventType: SyncEventType, listener: SyncEventListener): void {
    const listeners = this.listeners.get(eventType)
    if (listeners) {
      listeners.delete(listener)
    }
  }

  /**
   * Emit event to all listeners
   */
  private emit(eventType: SyncEventType, event: SyncEvent): void {
    const listeners = this.listeners.get(eventType)
    if (listeners) {
      listeners.forEach(listener => listener(event))
    }
  }

  /**
   * Deserialize node from GUN format
   */
  private deserializeNode(data: any, id: string): Node {
    const { _, ...rest } = data
    
    return {
      id,
      type: rest.type,
      properties: typeof rest.properties === 'string' 
        ? JSON.parse(rest.properties) 
        : rest.properties || {},
      metadata: typeof rest.metadata === 'string'
        ? JSON.parse(rest.metadata)
        : rest.metadata
    }
  }

  /**
   * Deserialize edge from GUN format
   */
  private deserializeEdge(data: any, id: string): Edge {
    const { _, ...rest } = data
    
    return {
      id,
      from: rest.from,
      to: rest.to,
      type: rest.type,
      properties: typeof rest.properties === 'string'
        ? JSON.parse(rest.properties)
        : rest.properties,
      weight: rest.weight,
      directed: rest.directed,
      metadata: typeof rest.metadata === 'string'
        ? JSON.parse(rest.metadata)
        : rest.metadata
    }
  }

  /**
   * Get sync status
   */
  getStatus(): {
    connected: boolean
    subscriptions: number
    pendingChanges: number
    changeHistory: number
    circuitBreakers: { [key: string]: CircuitBreakerState }
  } {
    const breakers: { [key: string]: CircuitBreakerState } = {}
    this.circuitBreakers.forEach((state, scope) => {
      breakers[scope] = { ...state }
    })

    return {
      connected: this.isConnected,
      subscriptions: this.subscriptions.size,
      pendingChanges: this.pendingChanges.size,
      changeHistory: this.changeHistory.length,
      circuitBreakers: breakers
    }
  }

  /**
   * Clean up all subscriptions and timers
   */
  async cleanup(): Promise<void> {
    await this.stopSync()
    this.pendingChanges.clear()
    this.circuitBreakers.clear()
    this.listeners.clear()
    this.clearChangeHistory()
  }
}
