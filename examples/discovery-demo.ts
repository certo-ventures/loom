/**
 * Service Discovery Example
 * 
 * Shows how to use discovery for:
 * - Actor registration
 * - Load balancing across instances
 * - Type-based routing
 * - Broadcasting
 */

import { DiscoveryService } from '../src/discovery'

async function main() {
  const discovery = new DiscoveryService()

  console.log('🔍 Service Discovery Demo\n')

  // 1. Register multiple instances of OrderProcessor
  console.log('📝 Registering actors...')
  await discovery.registerActor('order-1', 'OrderProcessor', 'worker-1', {
    region: 'us-west',
    capacity: 100,
  })
  
  await discovery.registerActor('order-2', 'OrderProcessor', 'worker-2', {
    region: 'us-east',
    capacity: 150,
  })
  
  await discovery.registerActor('order-3', 'OrderProcessor', 'worker-3', {
    region: 'eu-west',
    capacity: 80,
  })

  // Register a payment processor
  await discovery.registerActor('payment-1', 'PaymentProcessor', 'worker-1', {
    provider: 'stripe',
  })

  console.log('✅ Registered 4 actors\n')

  // 2. Route to specific actor by ID
  console.log('🎯 Routing to specific actor...')
  const specificQueue = await discovery.route('order-1')
  console.log(`  Route to order-1: ${specificQueue}\n`)

  // 3. Route to any OrderProcessor (load balancing)
  console.log('⚖️  Load balancing with least-messages strategy...')
  
  // Simulate some load
  await discovery.registry.incrementMessageCount('order-1')
  await discovery.registry.incrementMessageCount('order-1')
  await discovery.registry.incrementMessageCount('order-1')
  await discovery.registry.incrementMessageCount('order-2')
  await discovery.registry.incrementMessageCount('order-2')

  for (let i = 0; i < 5; i++) {
    const queue = await discovery.route({
      type: 'OrderProcessor',
      strategy: 'least-messages',
    })
    console.log(`  Request ${i + 1}: ${queue}`)
  }
  console.log()

  // 4. Check current load
  console.log('📊 Current load across OrderProcessors:')
  const orderProcessors = await discovery.registry.getByType('OrderProcessor')
  for (const actor of orderProcessors) {
    console.log(`  ${actor.actorId}: ${actor.messageCount} messages`)
  }
  console.log()

  // 5. Broadcast to all OrderProcessors
  console.log('📢 Broadcasting to all OrderProcessors...')
  const broadcastQueues = await discovery.broadcast('OrderProcessor')
  console.log(`  Sending to ${broadcastQueues.length} queues:`)
  broadcastQueues.forEach(q => console.log(`    - ${q}`))
  console.log()

  // 6. Mark an actor as busy and observe routing
  console.log('🚦 Marking order-2 as busy...')
  await discovery.registry.updateStatus('order-2', 'busy')
  
  console.log('  Routing 3 requests (should skip busy actor):')
  for (let i = 0; i < 3; i++) {
    const queue = await discovery.route({
      type: 'OrderProcessor',
      strategy: 'random',
    })
    console.log(`    Request ${i + 1}: ${queue}`)
  }
  console.log()

  // 7. Simulate cleanup of stale actors
  console.log('🧹 Simulating cleanup...')
  
  // Make order-1 stale
  const order1 = await discovery.registry.get('order-1')
  if (order1) {
    order1.lastHeartbeat = new Date(Date.now() - 400000).toISOString() // 400 seconds ago
  }
  
  const cleaned = await discovery.cleanup(300) // 5 minutes
  console.log(`  Cleaned ${cleaned} stale actor(s)`)
  
  const remaining = await discovery.registry.getByType('OrderProcessor')
  console.log(`  Remaining OrderProcessors: ${remaining.map(a => a.actorId).join(', ')}\n`)

  // 8. Check actor availability
  console.log('✅ Checking availability:')
  console.log(`  order-2 available: ${await discovery.router.isAvailable('order-2')}`) // busy
  console.log(`  order-3 available: ${await discovery.router.isAvailable('order-3')}`) // idle
  console.log(`  payment-1 available: ${await discovery.router.isAvailable('payment-1')}`) // idle
  console.log()

  // 9. Show final registry state
  console.log('📋 Final registry state:')
  const allActors = await Promise.all([
    discovery.registry.getByType('OrderProcessor'),
    discovery.registry.getByType('PaymentProcessor'),
  ])
  
  const flat = allActors.flat()
  for (const actor of flat) {
    console.log(`  ${actor.actorId} (${actor.actorType}):`)
    console.log(`    Worker: ${actor.workerId}`)
    console.log(`    Status: ${actor.status}`)
    console.log(`    Messages: ${actor.messageCount}`)
    console.log(`    Metadata: ${JSON.stringify(actor.metadata)}`)
  }
}

main().catch(console.error)
