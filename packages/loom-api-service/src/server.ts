/**
 * Loom API Service - Main Server
 * 
 * Production-ready Express server exposing all Loom capabilities
 */

import express from 'express'
import http from 'http'
import { WebSocketServer } from 'ws'
import 'express-async-errors'
import { config } from './config'
import { setupMiddleware } from './middleware'
import { setupRoutes } from './routes'
import { setupWebSocket } from './websocket'
import { LoomService } from './services/loom-service'
import { logger } from './utils/logger'
import { startMetricsServer } from './observability/metrics'

async function startServer() {
  const app = express()
  const server = http.createServer(app)
  
  try {
    // Initialize Loom service
    logger.info('Initializing Loom service...')
    const loomService = new LoomService(config)
    await loomService.initialize()
    
    // Setup middleware (auth, rate limiting, logging, etc.)
    setupMiddleware(app, config)
    
    // Setup REST API routes
    setupRoutes(app, loomService, config)
    
    // Setup WebSocket server
    const wss = new WebSocketServer({ server, path: '/ws' })
    setupWebSocket(wss, loomService, config)
    
    // Start metrics server (Prometheus)
    if (config.metrics.enabled) {
      startMetricsServer(config.metrics.port)
    }
    
    // Start HTTP server
    server.listen(config.port, config.host, () => {
      logger.info(`🚀 Loom API Service started`, {
        port: config.port,
        host: config.host,
        env: config.env,
        metrics: config.metrics.enabled ? `http://localhost:${config.metrics.port}/metrics` : 'disabled',
        docs: `http://localhost:${config.port}/docs`,
        health: `http://localhost:${config.port}/api/v1/health`
      })
    })
    
    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`)
      
      server.close(async () => {
        logger.info('HTTP server closed')
        
        await loomService.shutdown()
        logger.info('Loom service shutdown complete')
        
        process.exit(0)
      })
      
      // Force shutdown after timeout
      setTimeout(() => {
        logger.error('Forced shutdown after timeout')
        process.exit(1)
      }, 10000)
    }
    
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
    
  } catch (error) {
    logger.error('Failed to start server', { error })
    process.exit(1)
  }
}

// Start server
startServer()
