#!/usr/bin/env tsx
/**
 * Quick API Demo - Shows all endpoints in action
 * Run: tsx scripts/quick-demo.ts
 */

console.log('\n🚀 Loom API Quick Demo\n')
console.log('This demo shows all 9 API subsystems working with real services\n')
console.log('DEBUG: Starting imports...')

// Import all the pieces we need
console.log('DEBUG: Importing express...')
import express from 'express'
console.log('DEBUG: Importing middleware...')
import { setupMiddleware } from '../src/middleware'
console.log('DEBUG: Importing routes...')
import { setupRoutes } from '../src/routes'
console.log('DEBUG: Importing LoomService...')
import { LoomService } from '../src/services/loom-service'
console.log('DEBUG: Importing config...')
import { loadConfig } from '../src/config'
console.log('DEBUG: All imports complete!')

async function runQuickDemo() {
  console.log('DEBUG: Inside runQuickDemo()')
  // Create Express app
  const app = express()
  console.log('DEBUG: Express app created')
  
  // Load config
  const config = loadConfig()
  console.log('DEBUG: Config loaded')
  config.env = 'development'
  config.multitenancy.enabled = false
  
  console.log('✓ Loaded configuration')
  
  // Initialize LoomService (this connects to real subsystems)
  const loomService = new LoomService(config)
  console.log('DEBUG: LoomService instance created')
  await loomService.initialize()
  console.log('DEBUG: LoomService initialized')
  console.log('✓ Initialized LoomService with real subsystems:')
  console.log('  - ActorRuntime')
  console.log('  - MemoryStorage')
  console.log('  - ConfigResolver')
  console.log('  - Redis (state & queues)')
  
  // Setup middleware and routes
  setupMiddleware(app, config)
  setupRoutes(app, loomService, config)
  console.log('✓ Configured Express with all routes\n')
  
  // Start server
  const server = app.listen(config.port, () => {
    console.log(`✓ API Server listening on http://localhost:${config.port}`)
    console.log(`✓ Metrics server on http://localhost:${config.metrics.port}/metrics`)
    console.log(`✓ WebSocket available at ws://localhost:${config.port}/ws`)
    console.log('\n' + '='.repeat(60))
    console.log('API Endpoints Ready:')
    console.log('='.repeat(60))
    console.log('  1. Actor Management:     /api/v1/actors')
    console.log('  2. Memory & Graph:       /api/v1/memory')
    console.log('  3. Decisions:            /api/v1/decisions')
    console.log('  4. Configuration:        /api/v1/config')
    console.log('  5. State:                /api/v1/state')
    console.log('  6. Queue:                /api/v1/queue')
    console.log('  7. Workflows:            /api/v1/workflows')
    console.log('  8. Observability:        /api/v1/observability')
    console.log('  9. Admin:                /api/v1/admin')
    console.log('='.repeat(60))
    console.log('\n📖 View docs:        http://localhost:3000/docs')
    console.log('❤️  Health check:    http://localhost:3000/api/v1/health')
    console.log('📊 Metrics:          http://localhost:9090/metrics')
    console.log('\n💡 Run demo script in another terminal:')
    console.log('   npm run demo\n')
    console.log('Press Ctrl+C to stop the server\n')
  })
  
  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n\nShutting down gracefully...')
    server.close()
    await loomService.shutdown()
    console.log('✓ Server stopped')
    process.exit(0)
  }
  
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

// Run the demo
runQuickDemo().catch((error) => {
  console.error('❌ Error starting demo:', error)
  process.exit(1)
})
