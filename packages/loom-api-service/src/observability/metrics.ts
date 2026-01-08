/**
 * Prometheus Metrics Setup
 */

import { createServer } from 'http'
import { register, collectDefaultMetrics, Counter, Histogram } from 'prom-client'
import { logger } from '../utils/logger'

// Collect default metrics (CPU, memory, etc.)
collectDefaultMetrics({
  prefix: 'loom_api_'
})

// Custom metrics
export const httpRequestDuration = new Histogram({
  name: 'loom_api_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status']
})

export const httpRequestTotal = new Counter({
  name: 'loom_api_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
})

export const actorOperationsTotal = new Counter({
  name: 'loom_api_actor_operations_total',
  help: 'Total number of actor operations',
  labelNames: ['operation', 'status']
})

export const memoryOperationsTotal = new Counter({
  name: 'loom_api_memory_operations_total',
  help: 'Total number of memory operations',
  labelNames: ['operation', 'type']
})

/**
 * Start Prometheus metrics server
 */
export function startMetricsServer(port: number): void {
  const server = createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', register.contentType)
      res.end(await register.metrics())
    } else {
      res.statusCode = 404
      res.end('Not Found')
    }
  })
  
  server.listen(port, () => {
    logger.info(`Metrics server listening on http://localhost:${port}/metrics`)
  })
}
