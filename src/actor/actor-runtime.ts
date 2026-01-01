import type { Actor } from './actor'
import type { ActorContext } from './journal'
import type { Message } from '../types'
import type { BlobStore } from '../storage/blob-store'
import type { StateStore } from '../storage/state-store'
import type { ActivityStore } from '../storage/activity-store'
import type { ActorDefinition } from './actor-definition'
import type { ActorLock, CoordinationAdapter } from '../storage'
import { WASMActorAdapter } from './wasm-actor-adapter'

/**
 * ActorRuntime configuration
 */
export interface ActorRuntimeConfig {
  blobStore: BlobStore // Required - for loading WASM actors
  activityStore?: ActivityStore // Optional - for dynamic actor resolution
  stateStore?: StateStore // Optional - for actor state persistence
  coordinationAdapter?: CoordinationAdapter // Optional - for distributed locking

  maxPoolSize?: number // Max actors in memory (default: 1000)
  maxIdleTime?: number // Evict after idle in ms (default: never)
}

/**
 * LongLivedActorRuntime - Manages long-lived actor pool
 * 
 * Responsibilities:
 * - Create and pool actors (one per actorId)
 * - Route messages to correct actor
 * - Support TypeScript and WASM actors
 * - Manage actor lifecycle (eviction, cleanup)
 * - Use storage abstractions (NO hard-coded storage!)
 * 
 * Usage:
 *   const runtime = new LongLivedActorRuntime({ blobStore })
 *   runtime.registerActorType('MyActor', definition)
 *   await runtime.routeMessage(message, context)
 */
export class LongLivedActorRuntime {
  private actorPool = new Map<string, Actor>()
  private actorLastUsed = new Map<string, number>()
  private actorLocks = new Map<string, ActorLock>()
  private actorRegistry = new Map<string, ActorDefinition>()

  private blobStore: BlobStore
  private activityStore?: ActivityStore
  private stateStore?: StateStore
  private coordinationAdapter?: CoordinationAdapter
  private config: Required<Pick<ActorRuntimeConfig, 'maxPoolSize' | 'maxIdleTime'>>

  constructor(config: ActorRuntimeConfig) {
    this.blobStore = config.blobStore
    this.activityStore = config.activityStore
    this.stateStore = config.stateStore
    this.coordinationAdapter = config.coordinationAdapter
    this.config = {
      maxPoolSize: config.maxPoolSize ?? 1000,
      maxIdleTime: config.maxIdleTime ?? 0, // 0 = never evict
    }
  }

  /**
   * Register actor type (static registration)
   */
  registerActorType(name: string, definition: ActorDefinition): void {
    this.actorRegistry.set(name, definition)
  }

  /**
   * Get or create long-lived actor
   */
  async getActor(actorId: string, actorType: string, context: ActorContext): Promise<Actor> {
    // Check pool first
    let actor = this.actorPool.get(actorId)

    if (actor) {
      this.actorLastUsed.set(actorId, Date.now())
      return actor
    }

    // Acquire distributed lock if coordinator exists
    if (this.coordinationAdapter) {
      const lock = await this.coordinationAdapter.acquireLock(actorId, 60000) // 60s TTL
      if (!lock) {
        throw new Error(`Actor ${actorId} locked by another instance`)
      }
      this.actorLocks.set(actorId, lock)
    }

    // Create new actor
    const definition = await this.resolveActorDefinition(actorType)

    let newActor: Actor
    if (definition.type === 'typescript') {
      if (!definition.actorClass) {
        throw new Error(`TypeScript actor ${actorType} missing actorClass`)
      }
      newActor = new definition.actorClass(context)
    } else if (definition.type === 'wasm') {
      if (!definition.blobPath) {
        throw new Error(`WASM actor ${actorType} missing blobPath`)
      }
      newActor = new WASMActorAdapter(definition.blobPath, this.blobStore, context)
    } else {
      throw new Error(`Unknown actor type: ${definition.type}`)
    }
    
    actor = newActor

    // Restore state and journal if available
    if (this.stateStore) {
      const savedState = await this.stateStore.load(actorId)
      if (savedState) {
        // Restore state
        ;(actor as any).state = savedState.state
        
        // Restore journal for deterministic replay
        if (savedState.metadata?.journal) {
          const journal = savedState.metadata.journal as any
          actor.loadJournal(journal)
          console.log(
            `📂 [${actorId}] Restored state + journal (${journal.entries?.length || 0} entries)`
          )
        }
      }
    }

    // Add to pool
    this.actorPool.set(actorId, actor)
    this.actorLastUsed.set(actorId, Date.now())

    // Enforce pool size limits (async now due to persistence)
    await this.enforcePoolLimits()

    return actor
  }

  /**
   * Route message to actor
   */
  async routeMessage(message: Message, context: ActorContext): Promise<void> {
    const actorType = (message.metadata as any).actorType || 'unknown'

    const actor = await this.getActor(message.actorId, actorType, context)

    actor.recordInvocation(message)

    await this.persistInvocationSnapshot(message, actorType, actor)

    await actor.execute(message.payload)

    // Persist state AND journal after execution
    if (this.stateStore) {
      const journal = actor.getJournal()
      await this.stateStore.save(message.actorId, {
        id: message.actorId,
        partitionKey: message.actorId,
        actorType,
        status: 'active',
        state: actor.getState(),
        correlationId: message.correlationId,
        createdAt: new Date().toISOString(),
        lastActivatedAt: new Date().toISOString(),
        metadata: {
          journal, // Save journal for deterministic replay
          lastInvocation: actor.getLastInvocation(),
        },
      })
      console.log(
        `💾 [${message.actorId}] Persisted state + journal (${journal.entries.length} entries)`
      )
    }
  }

  /**
   * Resolve actor definition (static or dynamic)
   */
  private async resolveActorDefinition(actorType: string): Promise<ActorDefinition> {
    // Try static registry first
    let definition = this.actorRegistry.get(actorType)

    if (definition) {
      return definition
    }

    // Try dynamic resolution from ActivityStore
    if (this.activityStore) {
      try {
        const activity = await this.activityStore.resolve(actorType)
        return {
          name: activity.name,
          version: activity.version,
          type: 'wasm',
          blobPath: activity.wasmBlobPath,
        }
      } catch (error) {
        // ActivityStore doesn't have it, continue
      }
    }

    throw new Error(`Actor type ${actorType} not registered and not found in ActivityStore`)
  }

  /**
   * Enforce pool size limits (evict least recently used)
   */
  private async enforcePoolLimits(): Promise<void> {
    if (this.config.maxPoolSize <= 0) return

    while (this.actorPool.size > this.config.maxPoolSize) {
      // Find least recently used
      const entries = Array.from(this.actorLastUsed.entries())
      if (entries.length === 0) break

      entries.sort((a, b) => a[1] - b[1])
      const [oldestActorId] = entries[0]

      // Persist before evicting
      await this.persistActor(oldestActorId)

      this.actorPool.delete(oldestActorId)
      this.actorLastUsed.delete(oldestActorId)
    }
  }

  /**
   * Evict idle actors (call periodically)
   */
  async evictIdleActors(): Promise<void> {
    if (this.config.maxIdleTime <= 0) return

    const now = Date.now()
    const toEvict: string[] = []

    for (const [actorId, lastUsed] of Array.from(this.actorLastUsed.entries())) {
      if (now - lastUsed > this.config.maxIdleTime) {
        toEvict.push(actorId)
      }
    }

    // Persist and release locks before evicting
    for (const actorId of toEvict) {
      await this.persistActor(actorId)
      
      // Release distributed lock
      const lock = this.actorLocks.get(actorId)
      if (lock && this.coordinationAdapter) {
        await this.coordinationAdapter.releaseLock(lock)
        this.actorLocks.delete(actorId)
      }

      this.actorPool.delete(actorId)
      this.actorLastUsed.delete(actorId)
    }

    if (toEvict.length > 0) {
      console.log(`[ActorRuntime] Evicted ${toEvict.length} idle actors`)
    }
  }

  /**
   * Persist actor state and journal before eviction
   */
  private async persistActor(actorId: string): Promise<void> {
    if (!this.stateStore) return

    const actor = this.actorPool.get(actorId)
    if (!actor) return

    const context = (actor as any).context

    await this.stateStore.save(actorId, {
      id: actorId,
      partitionKey: actorId,
      actorType: context?.actorType || 'unknown',
      status: 'suspended',
      state: actor.getState(),
      correlationId: context?.correlationId || actorId,
      createdAt: new Date().toISOString(),
      lastActivatedAt: new Date().toISOString(),
      metadata: {
        journal: actor.getJournal(), // Persist journal for durable execution
        parentActorId: context?.parentActorId,
        lastInvocation: actor.getLastInvocation(),
      },
    })
  }

  private async persistInvocationSnapshot(message: Message, actorType: string, actor: Actor): Promise<void> {
    if (!this.stateStore) {
      return
    }

    const journal = actor.getJournal()

    try {
      await this.stateStore.save(message.actorId, {
        id: message.actorId,
        partitionKey: message.actorId,
        actorType,
        status: 'executing',
        state: actor.getState(),
        correlationId: message.correlationId,
        createdAt: new Date().toISOString(),
        lastActivatedAt: new Date().toISOString(),
        metadata: {
          journal,
          pendingInvocation: actor.getLastInvocation(),
        },
      })
    } catch (error) {
      console.error(`[ActorRuntime] Failed to persist invocation snapshot for ${message.actorId}:`, error)
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      poolSize: this.actorPool.size,
      registeredTypes: this.actorRegistry.size,
      maxPoolSize: this.config.maxPoolSize,
      maxIdleTime: this.config.maxIdleTime,
    }
  }

  /**
   * Clear all actors (for testing/shutdown)
   */
  clear(): void {
    this.actorPool.clear()
    this.actorLastUsed.clear()
  }
}
