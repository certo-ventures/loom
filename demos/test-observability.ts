// @ts-nocheck - Outdated demo
/**
 * Test for health check and metrics endpoints
 * Demonstrates observability features
 */

import type { Express } from 'express'
import { InMemoryMetricsCollector, registerObservabilityEndpoints } from '../src/observability'

const express = require('express')

console.log('='.repeat(60))
console.log('HEALTH CHECK & METRICS TEST')
console.log('='.repeat(60))

// Create metrics collector
const collector = new InMemoryMetricsCollector(100)

// Simulate some activity
console.log('\n--- Simulating Actor Activity ---')
collector.recordActorEvent('created')
collector.recordActorEvent('created')
collector.recordActorEvent('created')
collector.recordActorEvent('idle')
console.log('✅ Created 3 actors, 1 went idle')

collector.recordMessageEvent('sent')
collector.recordMessageEvent('received')
collector.recordMessageEvent('completed', 150)
collector.recordMessageEvent('sent')
collector.recordMessageEvent('received')
collector.recordMessageEvent('completed', 200)
console.log('✅ Processed 2 messages (150ms, 200ms avg)')

collector.recordLockEvent('acquired')
collector.recordLockEvent('released', 5000)
collector.recordLockEvent('acquired')
collector.recordLockEvent('failed')
console.log('✅ Acquired 2 locks, 1 failed')

// Test health check
console.log('\n--- Test 1: Health Check ---')
collector.getHealth().then(health => {
  console.log('Health Status:', health.status)
  console.log('Uptime:', health.uptime, 'ms')
  console.log('Timestamp:', health.timestamp)
  console.log('Components:', Object.keys(health.components))
})

// Test metrics
console.log('\n--- Test 2: Metrics ---')
collector.getMetrics().then(metrics => {
  console.log('Metrics collected at:', metrics.timestamp)
  console.log('\nActor Pool:')
  console.log('  Total:', metrics.actorPool.total)
  console.log('  Active:', metrics.actorPool.active)
  console.log('  Idle:', metrics.actorPool.idle)
  console.log('  Evicted:', metrics.actorPool.evicted)
  console.log('  Utilization:', metrics.actorPool.utilizationPercent.toFixed(1) + '%')
  
  console.log('\nMessage Queue:')
  console.log('  Completed:', metrics.messageQueue?.completed)
  console.log('  Failed:', metrics.messageQueue?.failed)
  console.log('  Avg Processing Time:', metrics.messageQueue?.avgProcessingTimeMs.toFixed(2) + 'ms')
  
  console.log('\nLocks:')
  console.log('  Active:', metrics.locks?.activeLocksCount)
  console.log('  Total Acquired:', metrics.locks?.totalLocksAcquired)
  console.log('  Total Released:', metrics.locks?.totalLocksReleased)
  console.log('  Total Failures:', metrics.locks?.totalLockFailures)
  console.log('  Avg Duration:', metrics.locks?.avgLockDurationMs.toFixed(2) + 'ms')
  
  console.log('\nSystem:')
  console.log('  Memory Usage:', metrics.system.memoryUsageMB.toFixed(2) + ' MB')
  console.log('  Uptime:', metrics.system.uptimeSeconds.toFixed(2) + 's')
})

// Test HTTP endpoints
console.log('\n--- Test 3: HTTP Endpoints ---')

const app: Express = express()
app.use(express.json())

registerObservabilityEndpoints(app, collector, {
  healthPath: '/health',
  metricsPath: '/metrics',
  enableCors: true,
})

const port = 3001
const server = app.listen(port, () => {
  console.log(`✅ Server started on port ${port}`)
  console.log(`  Health: http://localhost:${port}/health`)
  console.log(`  Metrics: http://localhost:${port}/metrics`)
  
  // Make test requests
  setTimeout(async () => {
    console.log('\n--- Test 4: HTTP Requests ---')
    
    try {
      // Test health endpoint
      const healthResponse = await fetch(`http://localhost:${port}/health`)
      const healthData = await healthResponse.json() as any
      console.log('✅ GET /health ->', healthResponse.status)
      console.log('  Status:', healthData.status)
      console.log('  Uptime:', healthData.uptime, 'ms')
      
      // Test metrics endpoint
      const metricsResponse = await fetch(`http://localhost:${port}/metrics`)
      const metricsData = await metricsResponse.json() as any
      console.log('✅ GET /metrics ->', metricsResponse.status)
      console.log('  Actor Pool Total:', metricsData.actorPool.total)
      console.log('  Messages Completed:', metricsData.messageQueue.completed)
      console.log('  Active Locks:', metricsData.locks.activeLocksCount)
      
      console.log('\n' + '='.repeat(60))
      console.log('TEST COMPLETE')
      console.log('='.repeat(60))
      console.log('\n✅ Demonstrated:')
      console.log('  - Metrics collection (actors, messages, locks)')
      console.log('  - Health check aggregation')
      console.log('  - HTTP endpoints (/health, /metrics)')
      console.log('  - CORS support')
      console.log('  - JSON response format')
      console.log('\n💡 Usage:')
      console.log('  import { InMemoryMetricsCollector, registerObservabilityEndpoints } from "./src/observability"')
      console.log('  const collector = new InMemoryMetricsCollector()')
      console.log('  registerObservabilityEndpoints(app, collector)')
      console.log('\n🔍 Try these endpoints while server is running:')
      console.log(`  curl http://localhost:${port}/health`)
      console.log(`  curl http://localhost:${port}/metrics`)
      console.log('\nPress Ctrl+C to stop the server')
      
    } catch (error) {
      console.error('❌ Request failed:', error)
      server.close()
    }
  }, 1000)
})

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down server...')
  server.close(() => {
    console.log('Server stopped')
    process.exit(0)
  })
})
