/**
 * Health check and metrics HTTP endpoints
 * Provides /health and /metrics routes for monitoring
 */

import type { Express, Request, Response } from 'express'
import type { MetricsCollector } from './types'

/**
 * Register health and metrics endpoints
 */
export function registerObservabilityEndpoints(
  app: Express,
  collector: MetricsCollector,
  options: {
    healthPath?: string
    metricsPath?: string
    enableCors?: boolean
  } = {}
): void {
  const {
    healthPath = '/health',
    metricsPath = '/metrics',
    enableCors = true,
  } = options
  
  // CORS middleware if enabled
  if (enableCors) {
    app.use([healthPath, metricsPath], (req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type')
      
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204)
      }
      
      next()
    })
  }
  
  // Health endpoint
  app.get(healthPath, async (req: Request, res: Response) => {
    try {
      const health = await collector.getHealth()
      
      // Set HTTP status based on health status
      const statusCode = health.status === 'healthy' ? 200 
        : health.status === 'degraded' ? 200 
        : 503
      
      res.status(statusCode).json(health)
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })
  
  // Metrics endpoint
  app.get(metricsPath, async (req: Request, res: Response) => {
    try {
      const metrics = await collector.getMetrics()
      res.status(200).json(metrics)
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      })
    }
  })
}

/**
 * Create a standalone Express app with observability endpoints
 */
export function createObservabilityServer(
  collector: MetricsCollector,
  port: number = 3001
): Express {
  const express = require('express')
  const app: Express = express()
  
  // JSON middleware
  app.use(express.json())
  
  // Register endpoints
  registerObservabilityEndpoints(app, collector)
  
  // Start server
  app.listen(port, () => {
    console.log(`Observability server listening on port ${port}`)
    console.log(`  Health: http://localhost:${port}/health`)
    console.log(`  Metrics: http://localhost:${port}/metrics`)
  })
  
  return app
}
