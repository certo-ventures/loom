/**
 * WebSocket Setup for Real-time Features
 */

import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import jwt from 'jsonwebtoken'
import { logger } from './utils/logger'
import type { Config } from './config'

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string
  tenantId?: string
  subscriptions?: Set<string>
}

export function setupWebSocket(server: Server, config: Config): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' })
  
  wss.on('connection', (ws: AuthenticatedWebSocket, request) => {
    logger.info('WebSocket connection established')
    ws.subscriptions = new Set()
    
    // Authenticate via query param or first message
    const url = new URL(request.url!, `http://${request.headers.host}`)
    const token = url.searchParams.get('token')
    
    if (token) {
      try {
        const decoded = jwt.verify(token, config.jwt.secret) as any
        ws.userId = decoded.userId
        ws.tenantId = decoded.tenantId
        logger.info(`WebSocket authenticated for user ${ws.userId}`)
      } catch (error) {
        logger.error('WebSocket authentication failed', error)
        ws.close(1008, 'Authentication failed')
        return
      }
    }
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())
        handleWebSocketMessage(ws, message)
      } catch (error) {
        logger.error('WebSocket message error', error)
        ws.send(JSON.stringify({ error: 'Invalid message format' }))
      }
    })
    
    ws.on('close', () => {
      logger.info('WebSocket connection closed')
    })
    
    ws.on('error', (error) => {
      logger.error('WebSocket error', error)
    })
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      message: 'Connected to Loom API WebSocket'
    }))
  })
  
  return wss
}

function handleWebSocketMessage(ws: AuthenticatedWebSocket, message: any) {
  const { type, payload } = message
  
  switch (type) {
    case 'subscribe':
      // Subscribe to specific channels (deliberation rooms, actor updates, etc.)
      if (payload?.channel) {
        ws.subscriptions?.add(payload.channel)
        ws.send(JSON.stringify({
          type: 'subscribed',
          channel: payload.channel
        }))
      }
      break
      
    case 'unsubscribe':
      if (payload?.channel) {
        ws.subscriptions?.delete(payload.channel)
        ws.send(JSON.stringify({
          type: 'unsubscribed',
          channel: payload.channel
        }))
      }
      break
      
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }))
      break
      
    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${type}`
      }))
  }
}

/**
 * Broadcast message to all connected clients
 */
export function broadcast(wss: WebSocketServer, message: any, filter?: (ws: AuthenticatedWebSocket) => boolean) {
  wss.clients.forEach((client) => {
    const ws = client as AuthenticatedWebSocket
    if (ws.readyState === WebSocket.OPEN) {
      if (!filter || filter(ws)) {
        ws.send(JSON.stringify(message))
      }
    }
  })
}

/**
 * Send message to specific tenant
 */
export function broadcastToTenant(wss: WebSocketServer, tenantId: string, message: any) {
  broadcast(wss, message, (ws) => ws.tenantId === tenantId)
}

/**
 * Send message to specific channel subscribers
 */
export function broadcastToChannel(wss: WebSocketServer, channel: string, message: any) {
  broadcast(wss, message, (ws) => ws.subscriptions?.has(channel))
}
