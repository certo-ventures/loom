/**
 * Event-Driven Triggers for Actors
 * 
 * Philosophy: 
 * - No polling, pure event-driven
 * - Generic trigger interface (HTTP webhooks, PubSub, queues)
 * - Automatic actor invocation
 * - Built-in verification (signatures, tokens)
 * 
 * ~100 lines core abstractions
 */

/**
 * Generic trigger event
 */
export interface TriggerEvent {
  id: string
  type: string
  source: string
  timestamp: string
  data: Record<string, any>
  metadata?: Record<string, any>
}

/**
 * Trigger context for actor invocation
 */
export interface TriggerContext {
  eventId: string
  eventType: string
  source: string
  receivedAt: string
  verified: boolean
  verificationMethod?: string
}

/**
 * Trigger handler result
 */
export interface TriggerResult {
  success: boolean
  actorId?: string
  executionId?: string
  error?: string
  duration?: number
}

/**
 * Trigger verification result
 */
export interface VerificationResult {
  valid: boolean
  reason?: string
  metadata?: Record<string, any>
}

/**
 * Base trigger adapter interface
 * All trigger sources implement this
 */
export interface TriggerAdapter {
  /**
   * Adapter name/type
   */
  readonly name: string
  
  /**
   * Start listening for triggers
   */
  start(): Promise<void>
  
  /**
   * Stop listening
   */
  stop(): Promise<void>
  
  /**
   * Verify incoming trigger is authentic
   */
  verify(event: TriggerEvent, context: Record<string, any>): Promise<VerificationResult>
  
  /**
   * Register handler for trigger events
   */
  onTrigger(handler: (event: TriggerEvent, context: TriggerContext) => Promise<TriggerResult>): void
}

/**
 * Trigger configuration
 */
export interface TriggerConfig {
  adapter: TriggerAdapter
  actorType: string
  filter?: (event: TriggerEvent) => boolean
  transform?: (event: TriggerEvent) => Record<string, any>
  requireVerification?: boolean
}

/**
 * Trigger manager - orchestrates multiple trigger sources
 */
export class TriggerManager {
  private triggers: Map<string, TriggerConfig>
  private handlers: Map<string, (event: TriggerEvent, context: TriggerContext) => Promise<TriggerResult>>
  
  constructor() {
    this.triggers = new Map()
    this.handlers = new Map()
  }
  
  /**
   * Register a trigger
   */
  register(id: string, config: TriggerConfig): void {
    this.triggers.set(id, config)
    
    // Setup handler
    config.adapter.onTrigger(async (event, context) => {
      // Apply filter if present
      if (config.filter && !config.filter(event)) {
        return {
          success: true,
          actorId: 'filtered',
        }
      }
      
      // Verify if required
      if (config.requireVerification !== false) {
        const verification = await config.adapter.verify(event, context as any)
        if (!verification.valid) {
          return {
            success: false,
            error: `Verification failed: ${verification.reason}`,
          }
        }
      }
      
      // Transform data if needed
      const actorInput = config.transform ? config.transform(event) : event.data
      
      // Invoke handler
      const handler = this.handlers.get(id)
      if (handler) {
        return handler(event, context)
      }
      
      return {
        success: false,
        error: 'No handler registered',
      }
    })
  }
  
  /**
   * Set handler for trigger
   */
  onTrigger(id: string, handler: (event: TriggerEvent, context: TriggerContext) => Promise<TriggerResult>): void {
    this.handlers.set(id, handler)
  }
  
  /**
   * Start all triggers
   */
  async startAll(): Promise<void> {
    const promises = Array.from(this.triggers.values()).map(t => t.adapter.start())
    await Promise.all(promises)
  }
  
  /**
   * Stop all triggers
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.triggers.values()).map(t => t.adapter.stop())
    await Promise.all(promises)
  }
}
