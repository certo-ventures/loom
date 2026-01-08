/**
 * Actor Service - Manages actor lifecycle using ActorRuntime
 */

import { ActorRuntime, Actor, type ActorMetadata } from '@certo-ventures/loom'
import { logger } from '../utils/logger'

export interface CreateActorRequest {
  name: string
  type: string
  config?: Record<string, any>
  metadata?: ActorMetadata
}

export class ActorService {
  constructor(private runtime: ActorRuntime) {}
  
  async createActor(request: CreateActorRequest, tenantId: string): Promise<Actor> {
    logger.info('Creating actor', { name: request.name, type: request.type, tenantId })
    
    // Create actor instance using runtime
    const actor = await this.runtime.createActor({
      name: request.name,
      type: request.type,
      config: request.config,
      metadata: request.metadata
    })
    
    return actor
  }
  
  async getActor(actorId: string, tenantId: string): Promise<Actor | null> {
    return await this.runtime.getActor(actorId)
  }
  
  async listActors(filters: {
    type?: string
    status?: string
    tenantId: string
    limit?: number
    offset?: number
  }): Promise<{ actors: Actor[]; total: number }> {
    const actors = await this.runtime.listActors(filters)
    return {
      actors,
      total: actors.length
    }
  }
  
  async updateActor(actorId: string, updates: Partial<CreateActorRequest>, tenantId: string): Promise<Actor> {
    const actor = await this.runtime.getActor(actorId)
    if (!actor) {
      throw new Error(`Actor ${actorId} not found`)
    }
    
    // Update actor configuration
    if (updates.config) {
      await actor.updateConfig(updates.config)
    }
    
    return actor
  }
  
  async deleteActor(actorId: string, tenantId: string): Promise<void> {
    await this.runtime.stopActor(actorId)
    await this.runtime.removeActor(actorId)
  }
  
  async startActor(actorId: string, tenantId: string): Promise<void> {
    await this.runtime.startActor(actorId)
  }
  
  async stopActor(actorId: string, tenantId: string): Promise<void> {
    await this.runtime.stopActor(actorId)
  }
  
  async restartActor(actorId: string, tenantId: string): Promise<void> {
    await this.runtime.stopActor(actorId)
    await this.runtime.startActor(actorId)
  }
  
  async getActorStatus(actorId: string, tenantId: string): Promise<{
    id: string
    status: string
    health: string
    uptime: number
    memory?: any
    cpu?: number
    messageQueue?: any
  }> {
    const actor = await this.runtime.getActor(actorId)
    if (!actor) {
      throw new Error(`Actor ${actorId} not found`)
    }
    
    // Get runtime status
    const status = await this.runtime.getActorStatus(actorId)
    
    return {
      id: actorId,
      status: status.state || 'unknown',
      health: status.healthy ? 'healthy' : 'unhealthy',
      uptime: status.uptime || 0,
      memory: status.memory,
      cpu: status.cpu,
      messageQueue: status.messageQueue
    }
  }
  
  async sendMessage(actorId: string, message: any, priority?: number, tenantId?: string): Promise<string> {
    const actor = await this.runtime.getActor(actorId)
    if (!actor) {
      throw new Error(`Actor ${actorId} not found`)
    }
    
    // Send message to actor
    const messageId = await this.runtime.sendMessage(actorId, message, { priority })
    return messageId
  }
  
  async getActorMessages(actorId: string, filters: {
    status?: string
    limit?: number
    tenantId: string
  }): Promise<any[]> {
    const actor = await this.runtime.getActor(actorId)
    if (!actor) {
      throw new Error(`Actor ${actorId} not found`)
    }
    
    // Get messages from actor's queue
    const messages = await this.runtime.getActorMessages(actorId, filters)
    return messages
  }
  
  async updateActorConfig(actorId: string, config: Record<string, any>, tenantId: string): Promise<void> {
    const actor = await this.runtime.getActor(actorId)
    if (!actor) {
      throw new Error(`Actor ${actorId} not found`)
    }
    
    await actor.updateConfig(config)
  }
  
  async checkActorHealth(actorId: string, tenantId: string): Promise<{
    id: string
    healthy: boolean
    lastCheck: string
    checks: Record<string, boolean>
  }> {
    const actor = await this.runtime.getActor(actorId)
    if (!actor) {
      throw new Error(`Actor ${actorId} not found`)
    }
    
    const health = await this.runtime.checkActorHealth(actorId)
    
    return {
      id: actorId,
      healthy: health.healthy,
      lastCheck: new Date().toISOString(),
      checks: health.checks || {}
    }
  }
}
