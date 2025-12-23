/**
 * HTTP Webhook Trigger Adapter
 * 
 * Generic webhook receiver with signature verification
 * Supports: GitHub, Slack, Stripe, generic HMAC
 * 
 * ~120 lines
 */

import type { TriggerAdapter, TriggerEvent, TriggerContext, TriggerResult, VerificationResult } from './index'
import crypto from 'crypto'

export interface WebhookConfig {
  port: number
  path: string
  secret?: string
  verifySignature?: (payload: string, signature: string, secret: string) => boolean
  parseEvent?: (body: any, headers: Record<string, string>) => TriggerEvent
}

/**
 * HTTP webhook adapter
 */
export class WebhookAdapter implements TriggerAdapter {
  readonly name = 'http-webhook'
  
  private config: WebhookConfig
  private handler?: (event: TriggerEvent, context: TriggerContext) => Promise<TriggerResult>
  private server?: any
  
  constructor(config: WebhookConfig) {
    this.config = config
  }
  
  async start(): Promise<void> {
    const express = await import('express')
    const app = express.default()
    
    // Parse raw body for signature verification
    app.use(express.json({
      verify: (req: any, res, buf) => {
        req.rawBody = buf.toString('utf8')
      }
    }))
    
    // Webhook endpoint
    app.post(this.config.path, async (req, res) => {
      const startTime = Date.now()
      
      try {
        // Parse event
        const event = this.config.parseEvent
          ? this.config.parseEvent(req.body, req.headers as Record<string, string>)
          : this.defaultParseEvent(req.body, req.headers as Record<string, string>)
        
        const context: TriggerContext = {
          eventId: event.id,
          eventType: event.type,
          source: event.source,
          receivedAt: event.timestamp,
          verified: false,
        }
        
        // Verify signature if secret provided
        if (this.config.secret) {
          const verification = await this.verify(event, {
            rawBody: (req as any).rawBody,
            headers: req.headers,
          })
          
          if (!verification.valid) {
            res.status(401).json({ error: 'Invalid signature' })
            return
          }
          
          context.verified = true
          context.verificationMethod = 'hmac-sha256'
        }
        
        // Invoke handler
        if (this.handler) {
          const result = await this.handler(event, context)
          result.duration = Date.now() - startTime
          res.json(result)
        } else {
          res.status(500).json({ error: 'No handler registered' })
        }
      } catch (error) {
        console.error('[Webhook] Error processing event:', error)
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })
    
    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', adapter: 'http-webhook' })
    })
    
    // Start server
    this.server = app.listen(this.config.port, () => {
      console.log(`[Webhook] Listening on port ${this.config.port} at ${this.config.path}`)
    })
  }
  
  async stop(): Promise<void> {
    if (this.server) {
      this.server.close()
      this.server = undefined
    }
  }
  
  async verify(event: TriggerEvent, context: Record<string, any>): Promise<VerificationResult> {
    if (!this.config.secret) {
      return { valid: true, reason: 'No secret configured' }
    }
    
    const { rawBody, headers } = context
    const signature = headers['x-hub-signature-256'] || headers['x-signature']
    
    if (!signature) {
      return { valid: false, reason: 'No signature header' }
    }
    
    // Use custom verifier or default HMAC
    const valid = this.config.verifySignature
      ? this.config.verifySignature(rawBody, signature, this.config.secret)
      : this.verifyHMAC(rawBody, signature, this.config.secret)
    
    return {
      valid,
      reason: valid ? 'Signature verified' : 'Invalid signature',
    }
  }
  
  onTrigger(handler: (event: TriggerEvent, context: TriggerContext) => Promise<TriggerResult>): void {
    this.handler = handler
  }
  
  /**
   * Default HMAC-SHA256 verification (GitHub style)
   */
  private verifyHMAC(payload: string, signature: string, secret: string): boolean {
    const hmac = crypto.createHmac('sha256', secret)
    const digest = 'sha256=' + hmac.update(payload).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))
  }
  
  /**
   * Default event parser
   */
  private defaultParseEvent(body: any, headers: Record<string, string>): TriggerEvent {
    return {
      id: body.id || crypto.randomUUID(),
      type: body.type || headers['x-event-type'] || 'webhook',
      source: 'http-webhook',
      timestamp: body.timestamp || new Date().toISOString(),
      data: body,
      metadata: {
        userAgent: headers['user-agent'],
        contentType: headers['content-type'],
      },
    }
  }
}

/**
 * GitHub webhook verification
 */
export function createGitHubWebhook(config: { port: number; path: string; secret: string }): WebhookAdapter {
  return new WebhookAdapter({
    ...config,
    parseEvent: (body, headers) => ({
      id: headers['x-github-delivery'] || crypto.randomUUID(),
      type: headers['x-github-event'] || 'unknown',
      source: 'github',
      timestamp: new Date().toISOString(),
      data: body,
      metadata: {
        hookId: headers['x-github-hook-id'],
        installation: headers['x-github-hook-installation-target-id'],
      },
    }),
  })
}

/**
 * Slack webhook verification
 */
export function createSlackWebhook(config: { port: number; path: string; secret: string }): WebhookAdapter {
  return new WebhookAdapter({
    ...config,
    verifySignature: (payload, signature, secret) => {
      // Slack uses a different signing format
      const [version, hash] = signature.split('=')
      const timestamp = payload.match(/"timestamp":"(\d+)"/)?.[1] || '0'
      const baseString = `${version}:${timestamp}:${payload}`
      const hmac = crypto.createHmac('sha256', secret)
      const digest = hmac.update(baseString).digest('hex')
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(digest))
    },
    parseEvent: (body) => ({
      id: body.event_id || crypto.randomUUID(),
      type: body.type || body.event?.type || 'slack_event',
      source: 'slack',
      timestamp: body.event_time || new Date().toISOString(),
      data: body.event || body,
      metadata: {
        teamId: body.team_id,
        apiAppId: body.api_app_id,
      },
    }),
  })
}
