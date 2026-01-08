/**
 * API Routes Setup
 */

import { Express } from 'express'
import type { Config } from './config'
import type { LoomService } from './services/loom-service'

// Import API routers
import { createActorRouter } from './api/v1/actors'
import { createMemoryRouter } from './api/v1/memory'
import { createDecisionRouter } from './api/v1/decisions'
import { createConfigRouter } from './api/v1/config'
import { createStateRouter } from './api/v1/state'
import { createQueueRouter } from './api/v1/queue'
import { createWorkflowRouter } from './api/v1/workflows'
import { createObservabilityRouter } from './api/v1/observability'
import { createAdminRouter } from './api/v1/admin'

export function setupRoutes(app: Express, loomService: LoomService, config: Config) {
  // Health check
  app.get('/api/v1/health', (req, res) => {
    res.json({
      status: 'ok',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      env: config.env
    })
  })
  
  // API Documentation
  app.get('/docs', (req, res) => {
    res.json({
      message: 'Loom API Documentation',
      version: 'v1',
      endpoints: {
        actors: '/api/v1/actors',
        memory: '/api/v1/memory',
        decisions: '/api/v1/decisions',
        config: '/api/v1/config',
        workflows: '/api/v1/workflows',
        state: '/api/v1/state',
        queue: '/api/v1/queue',
        observability: '/api/v1/observability',
        admin: '/api/v1/admin'
      }
    })
  })
  
  // Mount API routers
  app.use('/api/v1/actors', createActorRouter(loomService))
  app.use('/api/v1/memory', createMemoryRouter(loomService))
  app.use('/api/v1/decisions', createDecisionRouter(loomService))
  app.use('/api/v1/config', createConfigRouter(loomService))
  app.use('/api/v1/state', createStateRouter(loomService))
  app.use('/api/v1/queue', createQueueRouter(loomService))
  app.use('/api/v1/workflows', createWorkflowRouter(loomService))
  app.use('/api/v1/observability', createObservabilityRouter(loomService))
  app.use('/api/v1/admin', createAdminRouter(loomService))
  
  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not found',
      path: req.path
    })
  })
}
