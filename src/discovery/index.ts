/**
 * Service Discovery - Find and route to actors! 🔍
 * 
 * Actor registry, type-based routing, load balancing
 * Event-driven with Redis Pub/Sub - NO POLLING!
 */

import type { ActorEventBus, ActorLifecycleEvent } from './actor-lifecycle-events'
import type { ActorMetadata } from './actor-metadata'

// Export event types and metadata
export * from './actor-lifecycle-events'
export * from './actor-metadata'

// Export distributed registries
export * from './redis-actor-registry'
export * from './cosmos-actor-registry'

/**
 * Actor instance info in registry
 */
export interface ActorRegistration {
  actorId: string
  actorType: string
  workerId: string // Which worker is hosting this actor
  status: 'active' | 'idle' | 'busy'
  lastHeartbeat: string
  messageCount: number // For load balancing
  
  /** Structured actor metadata (replaces unstructured metadata) */
  metadata?: ActorMetadata
}

/**
 * Load balancing strategy
 */
export type LoadBalancingStrategy = 'round-robin' | 'least-messages' | 'random'

/**
 * Actor Registry - The phone book! 📞
 */
export interface ActorRegistry {
  /**
   * Register an actor instance
   */
  register(registration: ActorRegistration): Promise<void>
  
  /**
   * Unregister an actor
   */
  unregister(actorId: string): Promise<void>
  
  /**
   * Get registration for specific actor
   */
  get(actorId: string): Promise<ActorRegistration | undefined>
  
  /**
   * Get all actors of a specific type
   */
  getByType(actorType: string): Promise<ActorRegistration[]>
  
  /**
   * Get all actors (for monitoring/observability)
   */
  getAll(): Promise<ActorRegistration[]>
  
  /**
   * Update heartbeat
   */
  heartbeat(actorId: string): Promise<void>
  
  /**
   * Update status
   */
  updateStatus(actorId: string, status: ActorRegistration['status']): Promise<void>
  
  /**
   * Increment message count
   */
  incrementMessageCount(actorId: string): Promise<void>
  
  /**
   * Clean up stale registrations
   */
  cleanup(maxAge: number): Promise<number>
}

/**
 * In-memory actor registry
 */
export class InMemoryActorRegistry implements ActorRegistry {
  private registrations = new Map<string, ActorRegistration>()

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '⚠️  [InMemoryActorRegistry] Using in-memory adapter in production. ' +
        'This is not recommended for distributed systems. ' +
        'Use RedisActorRegistry or CosmosActorRegistry instead.'
      )
    }
  }

  async register(registration: ActorRegistration): Promise<void> {
    this.registrations.set(registration.actorId, registration)
  }

  async unregister(actorId: string): Promise<void> {
    this.registrations.delete(actorId)
  }

  async get(actorId: string): Promise<ActorRegistration | undefined> {
    return this.registrations.get(actorId)
  }

  async getByType(actorType: string): Promise<ActorRegistration[]> {
    return Array.from(this.registrations.values())
      .filter(r => r.actorType === actorType)
  }

  async getAll(): Promise<ActorRegistration[]> {
    return Array.from(this.registrations.values())
  }

  async heartbeat(actorId: string): Promise<void> {
    const registration = this.registrations.get(actorId)
    if (registration) {
      registration.lastHeartbeat = new Date().toISOString()
    }
  }

  async updateStatus(
    actorId: string,
    status: ActorRegistration['status']
  ): Promise<void> {
    const registration = this.registrations.get(actorId)
    if (registration) {
      registration.status = status
    }
  }

  async incrementMessageCount(actorId: string): Promise<void> {
    const registration = this.registrations.get(actorId)
    if (registration) {
      registration.messageCount++
    }
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs
    let cleaned = 0
    
    for (const [actorId, registration] of this.registrations.entries()) {
      const heartbeat = new Date(registration.lastHeartbeat).getTime()
      if (heartbeat < cutoff) {
        this.registrations.delete(actorId)
        cleaned++
      }
    }
    
    return cleaned
  }
}

/**
 * Actor Router - Smart message routing! 🎯
 */
export class ActorRouter {
  constructor(private registry: ActorRegistry) {}

  /**
   * Route to specific actor by ID
   */
  async routeToActor(actorId: string): Promise<string | undefined> {
    const registration = await this.registry.get(actorId)
    if (!registration) {
      return undefined
    }
    
    // Update stats
    await this.registry.incrementMessageCount(actorId)
    await this.registry.heartbeat(actorId)
    
    return `actor:${actorId}`
  }

  /**
   * Route to ANY actor of a type (with load balancing)
   */
  async routeToType(
    actorType: string,
    strategy: LoadBalancingStrategy = 'least-messages'
  ): Promise<string | undefined> {
    const actors = await this.registry.getByType(actorType)
    
    if (actors.length === 0) {
      return undefined
    }

    // Filter to only active/idle actors
    const available = actors.filter(a => a.status !== 'busy')
    if (available.length === 0) {
      // All busy, use any
      return this.selectActor(actors, strategy)
    }

    return this.selectActor(available, strategy)
  }

  /**
   * Select actor based on strategy
   */
  private selectActor(
    actors: ActorRegistration[],
    strategy: LoadBalancingStrategy
  ): string {
    let selected: ActorRegistration

    switch (strategy) {
      case 'least-messages':
        selected = actors.reduce((min, actor) =>
          actor.messageCount < min.messageCount ? actor : min
        )
        break

      case 'random':
        selected = actors[Math.floor(Math.random() * actors.length)]
        break

      case 'round-robin':
        // Simple: pick first (caller should track position)
        selected = actors[0]
        break

      default:
        selected = actors[0]
    }

    // Update selection
    this.registry.incrementMessageCount(selected.actorId)
    this.registry.heartbeat(selected.actorId)

    return `actor:${selected.actorId}`
  }

  /**
   * Get all actors of a type (for broadcast)
   */
  async getAllOfType(actorType: string): Promise<string[]> {
    const actors = await this.registry.getByType(actorType)
    return actors.map(a => `actor:${a.actorId}`)
  }

  /**
   * Check if actor is available
   */
  async isAvailable(actorId: string): Promise<boolean> {
    const registration = await this.registry.get(actorId)
    return registration !== undefined && registration.status !== 'busy'
  }
}

/**
 * Discovery Service - Combine registry + routing + events
 */
export class DiscoveryService {
  public readonly registry: ActorRegistry
  public readonly router: ActorRouter
  private eventBus?: ActorEventBus

  constructor(registry?: ActorRegistry, eventBus?: ActorEventBus) {
    this.registry = registry || new InMemoryActorRegistry()
    this.router = new ActorRouter(this.registry)
    this.eventBus = eventBus
  }

  /**
   * Register actor and publish event
   */
  async registerActor(
    actorId: string,
    actorType: string,
    workerId: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.registry.register({
      actorId,
      actorType,
      workerId,
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      messageCount: 0,
      metadata: metadata as ActorMetadata | undefined,
    })

    // Publish lifecycle event
    await this.publishEvent({
      type: 'actor:registered',
      actorId,
      actorType,
      workerId,
      timestamp: new Date().toISOString(),
      data: metadata,
    })
  }

  /**
   * Unregister actor and publish event
   */
  async unregisterActor(actorId: string): Promise<void> {
    const registration = await this.registry.get(actorId)
    await this.registry.unregister(actorId)

    // Publish lifecycle event
    if (registration) {
      await this.publishEvent({
        type: 'actor:unregistered',
        actorId,
        actorType: registration.actorType,
        workerId: registration.workerId,
        timestamp: new Date().toISOString(),
      })
    }
  }

  /**
   * Route message to actor (by ID or type)
   */
  async route(
    target: string | { type: string; strategy?: LoadBalancingStrategy }
  ): Promise<string | undefined> {
    if (typeof target === 'string') {
      // Route to specific actor ID
      return this.router.routeToActor(target)
    } else {
      // Route to any of type
      return this.router.routeToType(target.type, target.strategy)
    }
  }

  /**
   * Broadcast to all actors of a type
   */
  async broadcast(actorType: string): Promise<string[]> {
    return this.router.getAllOfType(actorType)
  }

  /**
   * Clean up stale actors (run periodically)
   */
  async cleanup(maxAgeSeconds: number = 300): Promise<number> {
    return this.registry.cleanup(maxAgeSeconds * 1000)
  }

  /**
   * Subscribe to actor lifecycle events
   */
  async subscribe(
    handler: (event: ActorLifecycleEvent) => void | Promise<void>
  ): Promise<() => Promise<void>> {
    if (!this.eventBus) {
      throw new Error('EventBus not configured')
    }
    return this.eventBus.subscribe(handler)
  }

  /**
   * Publish an actor lifecycle event
   */
  private async publishEvent(event: ActorLifecycleEvent): Promise<void> {
    if (this.eventBus) {
      await this.eventBus.publish(event)
    }
  }
}

// Export config loader
export * from './actor-config-loader'
