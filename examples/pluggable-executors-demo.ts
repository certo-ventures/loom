/**
 * Pluggable Executor Demo
 * 
 * Shows how executors are now pluggable like actors, with custom configs
 */

import { Redis } from 'ioredis'
import { BullMQMessageQueue } from '../src/storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../src/discovery'
import { PipelineOrchestrator } from '../src/pipelines/pipeline-orchestrator'
import { PipelineActorWorker } from '../src/pipelines/pipeline-actor-worker'
import { PipelineDefinition } from '../src/pipelines/pipeline-dsl'

// Simple actors
class ProcessorActor {
  async execute(input: any) {
    await new Promise(r => setTimeout(r, 50))
    return { ...input, processed: true }
  }
}

class AggregatorActor {
  async execute(input: { items: any[] }) {
    await new Promise(r => setTimeout(r, 100))
    return { count: input.items.length, items: input.items }
  }
}

class NotifierActor {
  async execute(input: any) {
    await new Promise(r => setTimeout(r, 50))
    return { notified: true, data: input }
  }
}

// ============================================================================
// Pipeline with Executor Configs
// ============================================================================

const pipeline: PipelineDefinition = {
  name: 'pluggable-executors-demo',
  description: 'Shows scatter with maxParallel, broadcast, fork-join',
  stages: [
    // Scatter with parallelism limit
    {
      name: 'process-items',
      mode: 'scatter',
      actor: 'Processor',
      scatter: {
        input: '$.trigger.items',
        as: 'item'
      },
      input: {
        itemId: '$.item.id',
        value: '$.item.value'
      },
      // Executor-specific config!
      executorConfig: {
        maxParallel: 3,  // Limit to 3 concurrent tasks
        batchSize: 5
      }
    },
    
    // Gather with timeout
    {
      name: 'aggregate-results',
      mode: 'gather',
      actor: 'Aggregator',
      gather: {
        stage: 'process-items'
      },
      input: {
        items: '$.stages["process-items"]'
      },
      executorConfig: {
        timeout: 5000,  // 5 second timeout
        minResults: 1
      }
    },
    
    // Broadcast to multiple actors
    {
      name: 'notify-all',
      mode: 'broadcast',
      actor: 'Notifier',  // Not used, actors specified in config
      input: {
        result: '$.stages["aggregate-results"][0]'
      },
      executorConfig: {
        actors: ['Notifier', 'Processor'],  // Send to both
        waitForAll: true
      }
    },
    
    // Fork-Join pattern
    {
      name: 'parallel-branches',
      mode: 'fork-join',
      actor: 'Processor',  // Not used, actors per branch
      input: {
        data: '$.stages["aggregate-results"][0]'
      },
      executorConfig: {
        branches: [
          {
            name: 'branch-a',
            actor: 'Processor',
            input: { branchId: 'a', data: '$.data' }
          },
          {
            name: 'branch-b',
            actor: 'Aggregator',
            input: { branchId: 'b', items: '$.data.items' }
          }
        ]
      }
    }
  ]
}

async function main() {
  console.log('\n' + '='.repeat(80))
  console.log('PLUGGABLE EXECUTOR DEMONSTRATION')
  console.log('Executors are now dynamically registered like actors!')
  console.log('='.repeat(80))

  // Setup
  const redis = new Redis('redis://localhost:6379', {
    maxParallel: null,
    enableReadyCheck: false
  })

  const keys = await redis.keys('pipeline:*')
  if (keys.length > 0) await redis.del(...keys)

  const messageQueue = new BullMQMessageQueue(redis)
  const orchestrator = new PipelineOrchestrator(
    messageQueue,
    new InMemoryActorRegistry(),
    redis
  )
  const worker = new PipelineActorWorker(messageQueue)

  // The orchestrator automatically registered built-in executors!
  console.log('\n✅ Built-in executors registered automatically')
  console.log('   Available: single, scatter, gather, broadcast, fork-join')
  
  // You can also register custom executors:
  // orchestrator.registerExecutor(new MyCustomExecutor())

  // Register actors
  console.log('\n📦 Registering Actors:')
  worker.registerActor('Processor', ProcessorActor)
  worker.registerActor('Aggregator', AggregatorActor)
  worker.registerActor('Notifier', NotifierActor)

  // Start workers
  console.log('\n🏭 Starting Workers:')
  worker.startWorker('Processor', 3)
  worker.startWorker('Aggregator', 1)
  worker.startWorker('Notifier', 2)

  await new Promise(r => setTimeout(r, 1000))

  // Execute
  console.log('\n' + '='.repeat(80))
  console.log('🚀 EXECUTING PIPELINE')
  console.log('='.repeat(80))

  const pipelineId = await orchestrator.execute(pipeline, {
    items: [
      { id: 1, value: 'A' },
      { id: 2, value: 'B' },
      { id: 3, value: 'C' },
      { id: 4, value: 'D' },
      { id: 5, value: 'E' }
    ]
  })

  console.log(`\n✅ Pipeline started: ${pipelineId}`)
  console.log('\n⏳ Watching execution...\n')

  await new Promise(r => setTimeout(r, 5000))

  // Cleanup
  console.log('\n🧹 Cleaning up...')
  await worker.close()
  await orchestrator.close()
  await redis.quit()

  console.log('\n✅ DEMO COMPLETE!\n')
  console.log('Key Features Demonstrated:')
  console.log('  ✓ Scatter with maxParallel config')
  console.log('  ✓ Gather with timeout config')
  console.log('  ✓ Broadcast executor (multiple actors)')
  console.log('  ✓ Fork-Join executor (parallel branches)')
  console.log('  ✓ All executors pluggable like actors!')
  console.log('\nTo add a new pattern:')
  console.log('  1. Implement StageExecutor interface')
  console.log('  2. Call orchestrator.registerExecutor(new MyExecutor())')
  console.log('  3. Use in pipeline: mode: "my-custom-pattern"')
  console.log('='.repeat(80) + '\n')

  process.exit(0)
}

main().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
