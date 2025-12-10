/**
 * Observability Demo - See structured logs and metrics in action!
 * 
 * Run with: npm run demo:observability
 */

import { Observability } from '../src/observability'
import { logger, metrics } from '../src/observability'

// Initialize with pretty printing for dev
const obs = Observability.getInstance({ pretty: true, level: 'info' })

async function simulateActorWorkflow() {
  logger.info('🚀 Starting actor workflow simulation')

  // Simulate actor activation
  const actorLogger = obs.createChildLogger({
    correlationId: 'workflow-123',
    actorId: 'order-processor-456',
    actorType: 'OrderProcessor',
  })

  actorLogger.info('Actor activated')
  metrics.increment('actor.activated', 1, { actorType: 'OrderProcessor' })
  metrics.gauge('actor.active', 1, { actorType: 'OrderProcessor' })

  // Simulate message processing
  await obs.measureAsync(
    'message.processing',
    async () => {
      actorLogger.info({ messageType: 'execute' }, 'Processing message')
      await new Promise((resolve) => setTimeout(resolve, 100))
      
      metrics.increment('message.processed', 1, {
        actorType: 'OrderProcessor',
        messageType: 'execute',
      })
    },
    { actorType: 'OrderProcessor', messageType: 'execute' }
  )

  // Simulate activity execution
  const activityLogger = actorLogger.child({
    activityId: 'act-789',
    activityName: 'validatePayment',
  })

  await obs.measureAsync(
    'activity.execution',
    async () => {
      activityLogger.info('Executing WASM activity')
      await new Promise((resolve) => setTimeout(resolve, 200))
      activityLogger.info({ result: 'approved' }, 'Activity completed')
      
      metrics.increment('activity.completed', 1, {
        activityName: 'validatePayment',
      })
    },
    { activityName: 'validatePayment', status: 'success' }
  )

  // Simulate actor completion
  actorLogger.info({ status: 'completed', totalMs: 300 }, 'Actor workflow completed')
  metrics.gauge('actor.active', 0, { actorType: 'OrderProcessor' })

  // Display metrics
  console.log('\n📊 Metrics Summary:')
  console.log('-------------------')
  console.log(
    'Actors activated:',
    obs.getMetrics().getCounter('actor.activated', { actorType: 'OrderProcessor' })
  )
  console.log(
    'Messages processed:',
    obs.getMetrics().getCounter('message.processed', {
      actorType: 'OrderProcessor',
      messageType: 'execute',
    })
  )
  console.log(
    'Activities completed:',
    obs.getMetrics().getCounter('activity.completed', {
      activityName: 'validatePayment',
    })
  )
  console.log(
    'Message processing time:',
    obs.getMetrics().getCounter('message.processing', {
      actorType: 'OrderProcessor',
      messageType: 'execute',
    }) + 'ms'
  )
  console.log(
    'Activity execution time:',
    obs.getMetrics().getCounter('activity.execution', {
      activityName: 'validatePayment',
      status: 'success',
    }) + 'ms'
  )
}

// Run the demo
simulateActorWorkflow()
  .then(() => {
    logger.info('✅ Demo completed successfully!')
  })
  .catch((error) => {
    logger.error({ err: error }, '❌ Demo failed')
    process.exit(1)
  })
