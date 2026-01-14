/**
 * Redis-backed Actor Registry
 * 
 * Distributed actor registry using Redis for multi-node deployments:
 * - Actor registrations stored in Redis Hash
 * - TTL-based automatic cleanup
 * - Pub/Sub for lifecycle events
 * - Supports multiple workers/instances
 * 
 * Key Structure:
 * - actor:{actorId} -> Hash with registration data
 * - actor:type:{actorType} -> Set of actorIds
 * - actor:heartbeat:{actorId} -> TTL key for staleness detection
 */

import type Redis from 'ioredis'
import type { ActorRegistry, ActorRegistration } from './index'
import type { ActorEventBus, ActorLifecycleEvent } from './actor-lifecycle-events'

export interface RedisActorRegistryOptions {
  /** Redis client instance */
  redis: Redis
  
  /** Optional event bus for publishing lifecycle events */
  eventBus?: ActorEventBus
  
  /** Default TTL for heartbeat keys (seconds) - default: 300 (5 minutes) */
  heartbeatTTL?: number
  
  /** Prefix for all Redis keys - default: 'loom:actor' */
  keyPrefix?: string
}

/**
 * Redis-backed distributed actor registry
 */
export class RedisActorRegistry implements ActorRegistry {
  private redis: Redis
  private eventBus?: ActorEventBus
  private heartbeatTTL: number
  private keyPrefix: string

  constructor(options: RedisActorRegistryOptions) {
    this.redis = options.redis
    this.eventBus = options.eventBus
    this.heartbeatTTL = options.heartbeatTTL ?? 300
    this.keyPrefix = options.keyPrefix ?? 'loom:actor'
  }

  // ========================================================================
  // Key Generators
  // ========================================================================

  private actorKey(actorId: string): string {
    return `${this.keyPrefix}:${actorId}`
  }

  private typeKey(actorType: string): string {
    return `${this.keyPrefix}:type:${actorType}`
  }

  private heartbeatKey(actorId: string): string {
    return `${this.keyPrefix}:heartbeat:${actorId}`
  }

  private allActorsKey(): string {
    return `${this.keyPrefix}:all`
  }

  // ========================================================================
  // ActorRegistry Implementation
  // ========================================================================

  async register(registration: ActorRegistration): Promise<void> {
    const actorKey = this.actorKey(registration.actorId)
    const typeKey = this.typeKey(registration.actorType)
    const heartbeatKey = this.heartbeatKey(registration.actorId)
    const allActorsKey = this.allActorsKey()

    // Use pipeline for atomic operations
    const pipeline = this.redis.pipeline()

    // Store registration as hash
    pipeline.hset(actorKey, {
      actorId: registration.actorId,
      actorType: registration.actorType,
      workerId: registration.workerId,
      status: registration.status,
      lastHeartbeat: registration.lastHeartbeat,
      messageCount: registration.messageCount.toString(),
      metadata: registration.metadata ? JSON.stringify(registration.metadata) : '',
    })

    // Add to type index
    pipeline.sadd(typeKey, registration.actorId)

    // Add to global actors set
    pipeline.sadd(allActorsKey, registration.actorId)

    // Set heartbeat with TTL
    pipeline.setex(heartbeatKey, this.heartbeatTTL, Date.now().toString())

    await pipeline.exec()

    // Publish lifecycle event
    if (this.eventBus) {
      await this.publishEvent({
        type: 'actor:registered',
        actorId: registration.actorId,
        actorType: registration.actorType,
        workerId: registration.workerId,
        timestamp: new Date().toISOString(),
        data: registration.metadata,
      })
    }
  }

  async unregister(actorId: string): Promise<void> {
    const actorKey = this.actorKey(actorId)
    const heartbeatKey = this.heartbeatKey(actorId)
    const allActorsKey = this.allActorsKey()

    // Get actor info before deletion (for event)
    const registration = await this.get(actorId)
    if (!registration) {
      return // Already unregistered
    }

    const typeKey = this.typeKey(registration.actorType)

    // Use pipeline for atomic operations
    const pipeline = this.redis.pipeline()
    pipeline.del(actorKey)
    pipeline.del(heartbeatKey)
    pipeline.srem(typeKey, actorId)
    pipeline.srem(allActorsKey, actorId)
    await pipeline.exec()

    // Publish lifecycle event
    if (this.eventBus) {
      await this.publishEvent({
        type: 'actor:unregistered',
        actorId,
        actorType: registration.actorType,
        workerId: registration.workerId,
        timestamp: new Date().toISOString(),
      })
    }
  }

  async get(actorId: string): Promise<ActorRegistration | undefined> {
    const actorKey = this.actorKey(actorId)
    const data = await this.redis.hgetall(actorKey)

    if (!data || Object.keys(data).length === 0) {
      return undefined
    }

    return {
      actorId: data.actorId,
      actorType: data.actorType,
      workerId: data.workerId,
      status: data.status as ActorRegistration['status'],
      lastHeartbeat: data.lastHeartbeat,
      messageCount: parseInt(data.messageCount, 10),
      metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
    }
  }

  async getByType(actorType: string): Promise<ActorRegistration[]> {
    const typeKey = this.typeKey(actorType)
    const actorIds = await this.redis.smembers(typeKey)

    if (actorIds.length === 0) {
      return []
    }

    // Fetch all actors in parallel
    const registrations = await Promise.all(
      actorIds.map(actorId => this.get(actorId))
    )

    // Filter out undefined (stale entries)
    return registrations.filter((r): r is ActorRegistration => r !== undefined)
  }

  async getAll(): Promise<ActorRegistration[]> {
    const allActorsKey = this.allActorsKey()
    const actorIds = await this.redis.smembers(allActorsKey)

    if (actorIds.length === 0) {
      return []
    }

    // Fetch all actors in parallel
    const registrations = await Promise.all(
      actorIds.map(actorId => this.get(actorId))
    )

    // Filter out undefined (stale entries)
    return registrations.filter((r): r is ActorRegistration => r !== undefined)
  }

  async heartbeat(actorId: string): Promise<void> {
    const actorKey = this.actorKey(actorId)
    const heartbeatKey = this.heartbeatKey(actorId)
    const now = new Date().toISOString()

    const pipeline = this.redis.pipeline()
    pipeline.hset(actorKey, 'lastHeartbeat', now)
    pipeline.setex(heartbeatKey, this.heartbeatTTL, Date.now().toString())
    await pipeline.exec()
  }

  async updateStatus(
    actorId: string,
    status: ActorRegistration['status']
  ): Promise<void> {
    const actorKey = this.actorKey(actorId)
    await this.redis.hset(actorKey, 'status', status)

    // Publish status change event
    if (this.eventBus) {
      const registration = await this.get(actorId)
      if (registration) {
        await this.publishEvent({
          type: 'actor:status-changed',
          actorId,
          actorType: registration.actorType,
          workerId: registration.workerId,
          timestamp: new Date().toISOString(),
          data: { status },
        })
      }
    }
  }

  async incrementMessageCount(actorId: string): Promise<void> {
    const actorKey = this.actorKey(actorId)
    await this.redis.hincrby(actorKey, 'messageCount', 1)
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    const allActorsKey = this.allActorsKey()
    const actorIds = await this.redis.smembers(allActorsKey)

    let cleanedCount = 0

    for (const actorId of actorIds) {
      const heartbeatKey = this.heartbeatKey(actorId)
      const exists = await this.redis.exists(heartbeatKey)

      // If heartbeat key doesn't exist (expired), actor is stale
      if (!exists) {
        await this.unregister(actorId)
        cleanedCount++
      }
    }

    return cleanedCount
  }

  // ========================================================================
  // Helper Methods
  // ========================================================================

  /**
   * Publish lifecycle event to event bus
   */
  private async publishEvent(event: ActorLifecycleEvent): Promise<void> {
    if (this.eventBus) {
      await this.eventBus.publish(event)
    }
  }

  /**
   * Start background cleanup task
   * Runs every interval and removes stale actors
   */
  startCleanupTask(intervalMs: number = 60000): NodeJS.Timeout {
    return setInterval(async () => {
      try {
        const cleaned = await this.cleanup(this.heartbeatTTL * 1000)
        if (cleaned > 0) {
          console.log(`✨ Cleaned up ${cleaned} stale actors`)
        }
      } catch (error) {
        console.error('❌ Error during actor registry cleanup:', error)
      }
    }, intervalMs)
  }

  /**
   * Get registry statistics
   */
  async getStats(): Promise<{
    totalActors: number
    actorsByType: Record<string, number>
    actorsByStatus: Record<string, number>
  }> {
    const allActors = await this.getAll()

    const actorsByType: Record<string, number> = {}
    const actorsByStatus: Record<string, number> = {}

    for (const actor of allActors) {
      actorsByType[actor.actorType] = (actorsByType[actor.actorType] || 0) + 1
      actorsByStatus[actor.status] = (actorsByStatus[actor.status] || 0) + 1
    }

    return {
      totalActors: allActors.length,
      actorsByType,
      actorsByStatus,
    }
  }
}
