/**
 * Cosmos DB Actor Registry
 * 
 * Distributed actor registry using Azure Cosmos DB:
 * - Actor registrations stored in Cosmos container
 * - TTL-based automatic cleanup (native Cosmos feature)
 * - Query by type, status, worker
 * - Global distribution support
 * 
 * Container Structure:
 * - id: actorId
 * - actorType: string (indexed)
 * - workerId: string (indexed)
 * - status: string (indexed)
 * - lastHeartbeat: timestamp
 * - messageCount: number
 * - metadata: object
 * - ttl: number (seconds until expiration)
 */

import type { Container } from '@azure/cosmos'
import type { ActorRegistry, ActorRegistration } from './index'
import type { ActorEventBus, ActorLifecycleEvent } from './actor-lifecycle-events'

export interface CosmosActorRegistryOptions {
  /** Cosmos DB container for actor registrations */
  container: Container
  
  /** Optional event bus for publishing lifecycle events */
  eventBus?: ActorEventBus
  
  /** Default TTL for registrations (seconds) - default: 300 (5 minutes) */
  defaultTTL?: number
}

/**
 * Cosmos document structure
 */
interface ActorDocument extends ActorRegistration {
  id: string // Cosmos ID (same as actorId)
  ttl?: number // Time-to-live in seconds
  _ts?: number // Cosmos timestamp
}

/**
 * Cosmos DB-backed distributed actor registry
 */
export class CosmosActorRegistry implements ActorRegistry {
  private container: Container
  private eventBus?: ActorEventBus
  private defaultTTL: number

  constructor(options: CosmosActorRegistryOptions) {
    this.container = options.container
    this.eventBus = options.eventBus
    this.defaultTTL = options.defaultTTL ?? 300
  }

  // ========================================================================
  // ActorRegistry Implementation
  // ========================================================================

  async register(registration: ActorRegistration): Promise<void> {
    const doc: ActorDocument = {
      ...registration,
      id: registration.actorId,
      ttl: this.defaultTTL,
    }

    await this.container.items.upsert(doc)

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
    // Get actor info before deletion (for event)
    const registration = await this.get(actorId)
    if (!registration) {
      return // Already unregistered
    }

    try {
      // Delete using actorId as both id and partition key
      await this.container.item(actorId, actorId).delete()
    } catch (error: any) {
      if (error.code !== 404) {
        throw error
      }
      // Already deleted, ignore 404
    }

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
    try {
      const { resource } = await this.container.item(actorId, actorId).read<ActorDocument>()
      
      if (!resource) {
        return undefined
      }

      return this.documentToRegistration(resource)
    } catch (error: any) {
      if (error.code === 404) {
        return undefined
      }
      throw error
    }
  }

  async getByType(actorType: string): Promise<ActorRegistration[]> {
    const query = {
      query: 'SELECT * FROM c WHERE c.actorType = @actorType',
      parameters: [{ name: '@actorType', value: actorType }],
    }

    const { resources } = await this.container.items.query<ActorDocument>(query).fetchAll()

    return resources.map(doc => this.documentToRegistration(doc))
  }

  async getAll(): Promise<ActorRegistration[]> {
    const query = {
      query: 'SELECT * FROM c',
    }

    const { resources } = await this.container.items.query<ActorDocument>(query).fetchAll()

    return resources.map(doc => this.documentToRegistration(doc))
  }

  async heartbeat(actorId: string): Promise<void> {
    const registration = await this.get(actorId)
    if (!registration) {
      return // Actor not found
    }

    // Update heartbeat and reset TTL
    const doc: ActorDocument = {
      ...registration,
      id: actorId,
      lastHeartbeat: new Date().toISOString(),
      ttl: this.defaultTTL, // Reset TTL
    }

    await this.container.items.upsert(doc)
  }

  async updateStatus(
    actorId: string,
    status: ActorRegistration['status']
  ): Promise<void> {
    const registration = await this.get(actorId)
    if (!registration) {
      return // Actor not found
    }

    // Update status
    const doc: ActorDocument = {
      ...registration,
      id: actorId,
      status,
      ttl: this.defaultTTL, // Reset TTL on update
    }

    await this.container.items.upsert(doc)

    // Publish status change event
    if (this.eventBus) {
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

  async incrementMessageCount(actorId: string): Promise<void> {
    const registration = await this.get(actorId)
    if (!registration) {
      return // Actor not found
    }

    // Increment message count
    const doc: ActorDocument = {
      ...registration,
      id: actorId,
      messageCount: registration.messageCount + 1,
      ttl: this.defaultTTL, // Reset TTL on update
    }

    await this.container.items.upsert(doc)
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    // With Cosmos TTL enabled, cleanup is automatic
    // This method can be used to manually clean stale entries
    const now = Date.now()
    const cutoff = new Date(now - maxAgeMs).toISOString()

    const query = {
      query: 'SELECT c.id, c.actorId FROM c WHERE c.lastHeartbeat < @cutoff',
      parameters: [{ name: '@cutoff', value: cutoff }],
    }

    const { resources } = await this.container.items.query(query).fetchAll()

    let cleanedCount = 0
    for (const doc of resources) {
      await this.unregister(doc.actorId)
      cleanedCount++
    }

    return cleanedCount
  }

  // ========================================================================
  // Helper Methods
  // ========================================================================

  /**
   * Convert Cosmos document to ActorRegistration
   */
  private documentToRegistration(doc: ActorDocument): ActorRegistration {
    return {
      actorId: doc.actorId,
      actorType: doc.actorType,
      workerId: doc.workerId,
      status: doc.status,
      lastHeartbeat: doc.lastHeartbeat,
      messageCount: doc.messageCount,
      metadata: doc.metadata,
    }
  }

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
   * Note: With Cosmos TTL enabled, this is optional
   */
  startCleanupTask(intervalMs: number = 60000): NodeJS.Timeout {
    return setInterval(async () => {
      try {
        const cleaned = await this.cleanup(this.defaultTTL * 1000)
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
    actorsByWorker: Record<string, number>
  }> {
    const allActors = await this.getAll()

    const actorsByType: Record<string, number> = {}
    const actorsByStatus: Record<string, number> = {}
    const actorsByWorker: Record<string, number> = {}

    for (const actor of allActors) {
      actorsByType[actor.actorType] = (actorsByType[actor.actorType] || 0) + 1
      actorsByStatus[actor.status] = (actorsByStatus[actor.status] || 0) + 1
      actorsByWorker[actor.workerId] = (actorsByWorker[actor.workerId] || 0) + 1
    }

    return {
      totalActors: allActors.length,
      actorsByType,
      actorsByStatus,
      actorsByWorker,
    }
  }

  /**
   * Query actors by status
   */
  async getByStatus(status: ActorRegistration['status']): Promise<ActorRegistration[]> {
    const query = {
      query: 'SELECT * FROM c WHERE c.status = @status',
      parameters: [{ name: '@status', value: status }],
    }

    const { resources } = await this.container.items.query<ActorDocument>(query).fetchAll()

    return resources.map(doc => this.documentToRegistration(doc))
  }

  /**
   * Query actors by worker
   */
  async getByWorker(workerId: string): Promise<ActorRegistration[]> {
    const query = {
      query: 'SELECT * FROM c WHERE c.workerId = @workerId',
      parameters: [{ name: '@workerId', value: workerId }],
    }

    const { resources } = await this.container.items.query<ActorDocument>(query).fetchAll()

    return resources.map(doc => this.documentToRegistration(doc))
  }
}
