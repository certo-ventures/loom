import type { Actor, ActorContext } from '../actor'
import type { StateStore, MessageQueue, LockManager } from '../storage'
import type { ActorState, TraceContext } from '../types'
import { TraceWriter } from '../observability/tracer'

/**
 * Factory function to create actor instances
 */
export type ActorFactory = (context: ActorContext, state?: Record<string, unknown>) => Actor

/**
 * ActorRuntime - Manages actor lifecycle, activation, and deactivation
 */
export class ActorRuntime {
  private actorTypes = new Map<string, ActorFactory>()
  private activeActors = new Map<string, Actor>()
  private actorLocks = new Map<string, any>() // Track locks by actorId
  private tracer?: TraceWriter
  
  constructor(
    private stateStore: StateStore,
    private messageQueue: MessageQueue,
    private lockManager: LockManager,
    tracer?: TraceWriter
  ) {
    this.tracer = tracer
  }

  /**
   * Register an actor type with its factory
   */
  registerActorType(type: string, factory: ActorFactory): void {
    this.actorTypes.set(type, factory)
  }

  /**
   * Activate an actor - load state, acquire lock, instantiate
   */
  async activateActor(actorId: string, actorType: string, contextOverrides?: Partial<ActorContext>): Promise<Actor> {
    // Check if already active
    const existing = this.activeActors.get(actorId)
    if (existing) {
      return existing
    }

    // Acquire distributed lock
    const lock = await this.lockManager.acquire(`actor:${actorId}`, 30000)
    if (!lock) {
      throw new Error(`Actor ${actorId} is already active elsewhere`)
    }

    try {
      // Load state from storage
      const stored = await this.stateStore.load(actorId)
      
      // Get factory
      const factory = this.actorTypes.get(actorType)
      if (!factory) {
        throw new Error(`Actor type ${actorType} not registered`)
      }

      // Create context
      const context: ActorContext = {
        actorId,
        actorType,
        correlationId: stored?.correlationId || actorId,
        parentActorId: stored?.metadata?.parentActorId as string | undefined,
        ...contextOverrides, // Allow trace and other overrides
      }

      // Instantiate actor with loaded state and tracer
      const actor = factory(context, stored?.state || undefined)
      
      // Inject tracer if available
      if (this.tracer) {
        (actor as any).observabilityTracer = this.tracer
      }

      // Load journal if exists
      if (stored?.metadata?.journal) {
        actor.loadJournal(stored.metadata.journal as any)
      }

      // Track active actor
      this.activeActors.set(actorId, actor)
      this.actorLocks.set(actorId, lock)

      // Start heartbeat to keep lock alive
      this.startHeartbeat(actorId, lock)

      return actor
    } catch (error) {
      // Release lock on error
      await this.lockManager.release(lock)
      throw error
    }
  }

  /**
   * Deactivate an actor - save state, release lock, remove from memory
   */
  async deactivateActor(actorId: string): Promise<void> {
    const actor = this.activeActors.get(actorId)
    if (!actor) {
      return
    }

    // Save state
    const state: ActorState = {
      id: actorId,
      partitionKey: actor['context'].actorType,
      actorType: actor['context'].actorType,
      status: 'suspended',
      state: actor.getState(),
      correlationId: actor['context'].correlationId || actorId,
      createdAt: new Date().toISOString(),
      lastActivatedAt: new Date().toISOString(),
      metadata: {
        journal: actor.getJournal(),
        parentActorId: actor['context'].parentActorId,
      },
    }

    await this.stateStore.save(actorId, state, actor['context'].trace)

    // Release lock
    const lock = this.actorLocks.get(actorId)
    if (lock) {
      await this.lockManager.release(lock)
      this.actorLocks.delete(actorId)
    }

    // Stop heartbeat
    this.stopHeartbeat(actorId)

    // Remove from active actors
    this.activeActors.delete(actorId)
  }

  /**
   * Send a message to an actor (activates if needed)
   */
  async sendMessage(actorId: string, actorType: string, message: any): Promise<void> {
    await this.messageQueue.enqueue(`actor:${actorType}`, {
      messageId: `msg-${Date.now()}-${Math.random()}`,
      actorId,
      messageType: 'event',
      correlationId: message.correlationId || actorId,
      payload: message,
      trace: message.trace || TraceWriter.createRootTrace(), // Use existing trace or create root
      metadata: {
        timestamp: new Date().toISOString(),
        priority: message.priority || 0,
      },
    })
  }

  /**
   * Get an active actor (or null if not active)
   */
  getActiveActor(actorId: string): Actor | null {
    return this.activeActors.get(actorId) || null
  }

  /**
   * Deactivate all actors (for shutdown)
   */
  async shutdown(): Promise<void> {
    const actorIds = Array.from(this.activeActors.keys())
    await Promise.all(actorIds.map(id => this.deactivateActor(id)))
  }

  // Heartbeat management
  private heartbeats = new Map<string, NodeJS.Timeout>()

  private startHeartbeat(actorId: string, lock: any): void {
    const interval = setInterval(async () => {
      try {
        await this.lockManager.extend(lock, 30000)
      } catch (error) {
        // Lock lost - deactivate actor
        await this.deactivateActor(actorId)
      }
    }, 10000) // Extend every 10 seconds

    this.heartbeats.set(actorId, interval)
  }

  private stopHeartbeat(actorId: string): void {
    const interval = this.heartbeats.get(actorId)
    if (interval) {
      clearInterval(interval)
      this.heartbeats.delete(actorId)
    }
  }
}
