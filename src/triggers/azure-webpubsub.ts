/**
 * Azure Web PubSub Trigger Adapter
 * 
 * Real-time event delivery via Azure Web PubSub
 * No polling, instant actor invocation
 * 
 * ~150 lines
 * 
 * NOTE: Requires @azure/web-pubsub-express package to be installed
 */

import type { TriggerAdapter, TriggerEvent, TriggerContext, TriggerResult, VerificationResult } from './index'

// Optional import - package must be installed separately
type WebPubSubEventHandler = any
import crypto from 'crypto'

export interface WebPubSubConfig {
  endpoint: string
  accessKey: string
  hub: string
  port?: number
  path?: string
}

/**
 * Azure Web PubSub adapter for event-driven triggers
 */
export class AzureWebPubSubAdapter implements TriggerAdapter {
  readonly name = 'azure-web-pubsub'
  
  private config: WebPubSubConfig
  private handler?: (event: TriggerEvent, context: TriggerContext) => Promise<TriggerResult>
  private server?: any
  
  constructor(config: WebPubSubConfig) {
    this.config = config
  }
  
  async start(): Promise<void> {
    // Dynamic import to avoid loading Express unless needed
    const express = await import('express')
    // Optional: Load @azure/web-pubsub-express if available
    let WebPubSubEventHandler: any
    try {
      // @ts-ignore - optional dependency, may not be installed
      const webPubSubModule = await import('@azure/web-pubsub-express')
      WebPubSubEventHandler = webPubSubModule.WebPubSubEventHandler
    } catch {
      throw new Error('@azure/web-pubsub-express package not installed')
    }
    
    const app = express.default()
    const port = this.config.port || 8080
    const path = this.config.path || '/api/webpubsub'
    
    // Create Web PubSub handler
    const pubsubHandler = new WebPubSubEventHandler(this.config.hub, {
      path,
      onConnected: async (req: any) => {
        console.log(`[WebPubSub] Client connected: ${req.context.userId}`)
      },
      handleUserEvent: async (req: any, res: any) => {
        // Convert to TriggerEvent
        const event: TriggerEvent = {
          id: crypto.randomUUID(),
          type: req.context.eventName,
          source: 'azure-web-pubsub',
          timestamp: new Date().toISOString(),
          data: req.data,
          metadata: {
            userId: req.context.userId,
            connectionId: req.context.connectionId,
            hub: req.context.hub,
          },
        }
        
        const context: TriggerContext = {
          eventId: event.id,
          eventType: event.type,
          source: event.source,
          receivedAt: event.timestamp,
          verified: true, // Web PubSub handles verification
        }
        
        // Invoke handler
        if (this.handler) {
          const result = await this.handler(event, context)
          res.success(result)
        } else {
          res.success({ success: false, error: 'No handler' })
        }
      },
    })
    
    // Mount handler
    app.use(pubsubHandler.getMiddleware())
    
    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', adapter: 'azure-web-pubsub' })
    })
    
    // Start server
    this.server = app.listen(port, () => {
      console.log(`[WebPubSub] Listening on port ${port} at ${path}`)
    })
  }
  
  async stop(): Promise<void> {
    if (this.server) {
      this.server.close()
      this.server = undefined
    }
  }
  
  async verify(event: TriggerEvent, context: Record<string, any>): Promise<VerificationResult> {
    // Azure Web PubSub handles signature verification
    // Additional custom verification can be added here
    return {
      valid: true,
      reason: 'Verified by Azure Web PubSub',
    }
  }
  
  onTrigger(handler: (event: TriggerEvent, context: TriggerContext) => Promise<TriggerResult>): void {
    this.handler = handler
  }
}
