/**
 * Actor Runtime with Trigger Support
 * 
 * Extends actor runtime to support event-driven triggers
 * Automatically invokes actors when events arrive
 * 
 * ~80 lines
 */

import type { TriggerEvent, TriggerContext, TriggerResult, TriggerConfig } from './index'
import { TriggerManager } from './index'
import type { Actor } from '../actor/actor'
import type { ActorContext } from '../actor/journal'

export interface ActorRuntimeConfig {
  actorRegistry: Map<string, new (context: ActorContext, state?: any) => Actor>
  configResolver?: any
  clientId?: string
  tenantId?: string
  environment?: string
}

/**
 * Actor runtime with trigger support
 */
export class TriggeredActorRuntime {
  private triggerManager: TriggerManager
  private actorRegistry: Map<string, new (context: ActorContext, state?: any) => Actor>
  private config: ActorRuntimeConfig
  private activeActors: Map<string, Actor>
  
  constructor(config: ActorRuntimeConfig) {
    this.triggerManager = new TriggerManager()
    this.actorRegistry = config.actorRegistry
    this.config = config
    this.activeActors = new Map()
  }
  
  /**
   * Register trigger for actor type
   */
  registerTrigger(id: string, triggerConfig: TriggerConfig): void {
    this.triggerManager.register(id, triggerConfig)
    
    // Setup handler to invoke actor
    this.triggerManager.onTrigger(id, async (event, context) => {
      return this.invokeActor(triggerConfig.actorType, event, context)
    })
  }
  
  /**
   * Invoke actor with trigger event
   */
  private async invokeActor(
    actorType: string,
    event: TriggerEvent,
    triggerContext: TriggerContext
  ): Promise<TriggerResult> {
    const ActorClass = this.actorRegistry.get(actorType)
    if (!ActorClass) {
      return {
        success: false,
        error: `Actor type not found: ${actorType}`,
      }
    }
    
    const startTime = Date.now()
    const actorId = `${actorType}-${event.id}`
    
    try {
      // Create actor context
      const actorContext: ActorContext = {
        actorId,
        correlationId: event.id,
        journal: { entries: [], cursor: 0 },
        configResolver: this.config.configResolver,
        clientId: this.config.clientId,
        tenantId: this.config.tenantId,
        environment: this.config.environment,
        triggerContext,
      } as any
      
      // Create actor
      const actor = new ActorClass(actorContext)
      this.activeActors.set(actorId, actor)
      
      // Execute actor with event data
      await actor.execute(event.data)
      
      // Cleanup
      this.activeActors.delete(actorId)
      
      return {
        success: true,
        actorId,
        executionId: event.id,
        duration: Date.now() - startTime,
      }
    } catch (error) {
      this.activeActors.delete(actorId)
      
      return {
        success: false,
        actorId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      }
    }
  }
  
  /**
   * Start listening for triggers
   */
  async start(): Promise<void> {
    await this.triggerManager.startAll()
    console.log('[TriggeredRuntime] Started')
  }
  
  /**
   * Stop listening
   */
  async stop(): Promise<void> {
    await this.triggerManager.stopAll()
    console.log('[TriggeredRuntime] Stopped')
  }
  
  /**
   * Get active actor count
   */
  getActiveActorCount(): number {
    return this.activeActors.size
  }
}
