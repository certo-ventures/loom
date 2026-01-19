/**
 * Actor State Sync Helper (TODO-013)
 * 
 * Provides automatic state synchronization across LoomMesh nodes:
 * - Subscribe to remote updates
 * - Broadcast local state changes
 * - Conflict detection and resolution
 * - Change debouncing (batch rapid updates)
 * - Circuit breaker for failing peers
 */

import type { IStateStore, ActorState } from './state-store'
import type { LoomMeshService } from './loommesh-service'

/**
 * Sync configuration options
 */
export interface ActorStateSyncOptions {
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
}

/**
 * Sync event types
 */
export type SyncEventType = 'remote-update' | 'conflict-detected' | 'sync-error' | 'circuit-open' | 'circuit-closed'

/**
 * Sync event
 */
export interface SyncEvent {
  type: SyncEventType
  actorId: string
  timestamp: number
  data?: any
  error?: Error
}

/**
 * Sync event listener
 */
export type SyncEventListener = (event: SyncEvent) => void

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
  failures: number
  isOpen: boolean
  lastFailureTime: number
}

/**
 * Actor State Sync Helper
 * 
 * Manages automatic state synchronization across LoomMesh nodes
 */
export class ActorStateSync {
  private stateStore: IStateStore
  private service: LoomMeshService
  private options: Required<ActorStateSyncOptions>
  private listeners: Map<SyncEventType, Set<SyncEventListener>> = new Map()
  private subscriptions: Map<string, any> = new Map() // actorId -> GUN subscription
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map()
  private pendingBroadcasts: Map<string, ActorState> = new Map()

  constructor(
    service: LoomMeshService,
    options: ActorStateSyncOptions = {}
  ) {
    this.service = service
    this.stateStore = service.getStateStore()
    
    // Set defaults
    this.options = {
      debounceMs: options.debounceMs ?? 100,
      circuitBreakerThreshold: options.circuitBreakerThreshold ?? 5,
      circuitBreakerResetMs: options.circuitBreakerResetMs ?? 30000,
      conflictResolution: options.conflictResolution ?? 'highest-version',
      autoResolveConflicts: options.autoResolveConflicts ?? true,
    }
  }

  /**
   * Subscribe to remote updates for an actor
   * 
   * Watches for changes from other nodes and applies them locally
   */
  async subscribeToRemoteUpdates(actorId: string): Promise<void> {
    // Don't subscribe twice
    if (this.subscriptions.has(actorId)) {
      return
    }

    // Check circuit breaker
    if (this.isCircuitOpen(actorId)) {
      throw new Error(`Circuit breaker open for ${actorId}`)
    }

    try {
      // Subscribe to GUN actor updates
      const gun = this.service.getGun()
      const subscription = gun.get('actors').get(actorId).on(async (data: any, key: string) => {
        if (!data || data === null) return

        try {
          // Deserialize from GUN storage
          const { _, ...stateData } = data
          if (typeof stateData.state === 'string') {
            stateData.state = JSON.parse(stateData.state)
          }
          if (typeof stateData.metadata === 'string') {
            stateData.metadata = JSON.parse(stateData.metadata)
          }

          const remoteState = stateData as ActorState

          // Get current local state (use internal GUN read to avoid triggering callbacks)
          const localState = await this.stateStore.get(actorId)

          // Detect conflicts
          if (localState && this.hasConflict(localState, remoteState)) {
            this.emit('conflict-detected', {
              type: 'conflict-detected',
              actorId,
              timestamp: Date.now(),
              data: { local: localState, remote: remoteState }
            })

            // Auto-resolve if enabled
            if (this.options.autoResolveConflicts) {
              const resolved = this.resolveConflict(localState, remoteState)
              // Write resolved state back to GUN
              await this.stateStore.set(actorId, resolved)
            }
          } else if (!localState || remoteState.version > localState.version) {
            // Emit remote update event (don't write back to avoid loop)
            this.emit('remote-update', {
              type: 'remote-update',
              actorId,
              timestamp: Date.now(),
              data: remoteState
            })
          }

          // Reset circuit breaker on success
          this.recordSuccess(actorId)
        } catch (error) {
          this.recordFailure(actorId)
          this.emit('sync-error', {
            type: 'sync-error',
            actorId,
            timestamp: Date.now(),
            error: error as Error
          })
        }
      })

      this.subscriptions.set(actorId, subscription)
    } catch (error) {
      this.recordFailure(actorId)
      throw error
    }
  }

  /**
   * Unsubscribe from remote updates
   */
  unsubscribe(actorId: string): void {
    const subscription = this.subscriptions.get(actorId)
    if (subscription) {
      subscription.off() // GUN .off() to stop listening
      this.subscriptions.delete(actorId)
    }

    // Clear debounce timer
    const timer = this.debounceTimers.get(actorId)
    if (timer) {
      clearTimeout(timer)
      this.debounceTimers.delete(actorId)
    }
  }

  /**
   * Broadcast state change to other nodes
   * 
   * Uses debouncing to batch rapid updates
   */
  async broadcastStateChange(actorId: string, state: ActorState): Promise<void> {
    // Check circuit breaker
    if (this.isCircuitOpen(actorId)) {
      throw new Error(`Circuit breaker open for ${actorId}`)
    }

    // Store pending broadcast
    this.pendingBroadcasts.set(actorId, state)

    // Clear existing debounce timer
    const existingTimer = this.debounceTimers.get(actorId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Set new debounce timer
    const timer = setTimeout(async () => {
      const pendingState = this.pendingBroadcasts.get(actorId)
      if (!pendingState) return

      try {
        // Broadcast via state store (which writes to GUN)
        await this.stateStore.set(actorId, pendingState)
        this.pendingBroadcasts.delete(actorId)
        this.debounceTimers.delete(actorId)
        this.recordSuccess(actorId)
      } catch (error) {
        this.recordFailure(actorId)
        this.emit('sync-error', {
          type: 'sync-error',
          actorId,
          timestamp: Date.now(),
          error: error as Error
        })
      }
    }, this.options.debounceMs)

    this.debounceTimers.set(actorId, timer)
  }

  /**
   * Force immediate broadcast (bypass debouncing)
   */
  async broadcastImmediate(actorId: string, state: ActorState): Promise<void> {
    // Clear debounce timer if exists
    const timer = this.debounceTimers.get(actorId)
    if (timer) {
      clearTimeout(timer)
      this.debounceTimers.delete(actorId)
    }

    // Check circuit breaker
    if (this.isCircuitOpen(actorId)) {
      throw new Error(`Circuit breaker open for ${actorId}`)
    }

    try {
      await this.stateStore.set(actorId, state)
      this.pendingBroadcasts.delete(actorId)
      this.recordSuccess(actorId)
    } catch (error) {
      this.recordFailure(actorId)
      throw error
    }
  }

  /**
   * Detect conflicts between local and remote state
   */
  private hasConflict(local: ActorState, remote: ActorState): boolean {
    // No conflict if versions are sequential
    if (remote.version === local.version + 1) {
      return false
    }

    // No conflict if remote is older
    if (remote.version <= local.version) {
      return false
    }

    // Conflict if versions diverged (both updated independently)
    if (remote.lastModified > local.lastModified && remote.version !== local.version + 1) {
      return true
    }

    return false
  }

  /**
   * Resolve conflict between local and remote state
   */
  private resolveConflict(local: ActorState, remote: ActorState): ActorState {
    switch (this.options.conflictResolution) {
      case 'last-write-wins':
        // Most recent modification wins
        return remote.lastModified > local.lastModified ? remote : local

      case 'highest-version':
        // Highest version wins
        return remote.version > local.version ? remote : local

      case 'merge':
        // Merge states (shallow merge of state properties)
        return {
          ...local,
          state: { ...local.state, ...remote.state },
          version: Math.max(local.version, remote.version) + 1,
          lastModified: Date.now(),
          metadata: { ...local.metadata, ...remote.metadata }
        }

      default:
        return remote
    }
  }

  /**
   * Check if circuit breaker is open
   */
  private isCircuitOpen(actorId: string): boolean {
    const breaker = this.circuitBreakers.get(actorId)
    if (!breaker || !breaker.isOpen) {
      return false
    }

    // Check if it's time to retry
    const now = Date.now()
    if (now - breaker.lastFailureTime >= this.options.circuitBreakerResetMs) {
      // Half-open: allow one retry
      breaker.isOpen = false
      breaker.failures = 0
      this.emit('circuit-closed', {
        type: 'circuit-closed',
        actorId,
        timestamp: now
      })
      return false
    }

    return true
  }

  /**
   * Record successful operation
   */
  private recordSuccess(actorId: string): void {
    const breaker = this.circuitBreakers.get(actorId)
    if (breaker) {
      breaker.failures = 0
      breaker.isOpen = false
    }
  }

  /**
   * Record failed operation
   */
  private recordFailure(actorId: string): void {
    let breaker = this.circuitBreakers.get(actorId)
    if (!breaker) {
      breaker = { failures: 0, isOpen: false, lastFailureTime: 0 }
      this.circuitBreakers.set(actorId, breaker)
    }

    breaker.failures++
    breaker.lastFailureTime = Date.now()

    // Open circuit if threshold exceeded
    if (breaker.failures >= this.options.circuitBreakerThreshold) {
      breaker.isOpen = true
      this.emit('circuit-open', {
        type: 'circuit-open',
        actorId,
        timestamp: Date.now(),
        data: { failures: breaker.failures }
      })
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
   * Get active subscriptions
   */
  getActiveSubscriptions(): string[] {
    return Array.from(this.subscriptions.keys())
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(actorId: string): CircuitBreakerState | null {
    return this.circuitBreakers.get(actorId) || null
  }

  /**
   * Clean up all subscriptions and timers
   */
  async cleanup(): Promise<void> {
    // Unsubscribe from all actors
    for (const actorId of this.subscriptions.keys()) {
      this.unsubscribe(actorId)
    }

    // Clear all pending broadcasts
    this.pendingBroadcasts.clear()

    // Clear circuit breakers
    this.circuitBreakers.clear()

    // Clear listeners
    this.listeners.clear()
  }
}
