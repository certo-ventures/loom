/**
 * Pipeline Cancellation Demo
 *
 * Runs a real pipeline via BullMQ workers, then cancels it mid-flight to
 * validate task lease handling and pipeline cancellation logic.
 */
import { Redis } from 'ioredis'
import { BullMQMessageQueue } from '../src/storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../src/discovery'
import { PipelineOrchestrator } from '../src/pipelines/pipeline-orchestrator'
import { PipelineActorWorker } from '../src/pipelines/pipeline-actor-worker'
import { RedisPipelineStateStore } from '../src/pipelines/pipeline-state-store'
import type { PipelineDefinition } from '../src/pipelines/pipeline-dsl'

class SlowActor {
  async execute(input: { value: number }): Promise<{ value: number; processedAt: number }> {
    // Simulate long-running work so leases need to stay active
    await new Promise(resolve => setTimeout(resolve, 2000))
    return { value: input.value, processedAt: Date.now() }
  }
}

const pipelineDef: PipelineDefinition = {
  name: 'lease-cancellation-demo',
  stages: [
    {
      name: 'slow-stage',
      mode: 'scatter',
      actor: 'SlowActor',
      scatter: {
        input: '$.trigger.items',
        as: 'item'
      },
      input: {
        value: '$.item'
      },
      config: {
        concurrency: 2,
        leaseTtlMs: 5_000
      }
    }
  ]
}

async function main(): Promise<void> {
  console.log('\n' + '='.repeat(80))
  console.log('PIPELINE LEASE + CANCELLATION DEMO')
  console.log('='.repeat(80))

  const redisState = new Redis('redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  })

  const redisQueue = new Redis('redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  })

  const stateStore = new RedisPipelineStateStore(redisState)
  const messageQueue = new BullMQMessageQueue(redisQueue)
  const actorRegistry = new InMemoryActorRegistry()
  const orchestrator = new PipelineOrchestrator(messageQueue, actorRegistry, redisState, stateStore)
  const worker = new PipelineActorWorker(messageQueue, stateStore)

  worker.registerActor('SlowActor', SlowActor)
  worker.startWorker('SlowActor', 4)

  // Small delay to let workers attach
  await new Promise(resolve => setTimeout(resolve, 500))

  console.log('\n🚀 Starting pipeline run...')
  const pipelineId = await orchestrator.execute(pipelineDef, {
    items: Array.from({ length: 6 }, (_, i) => i + 1)
  })

  console.log(`Pipeline ID: ${pipelineId}`)

  // Cancel mid-flight to validate behavior
  setTimeout(async () => {
    console.log('\n⏹️  Marking pipeline as cancelled...')
    await stateStore.markPipelineCancelled(pipelineId, 'demo-cancel')
  }, 1500)

  // Observe for a few lease cycles
  await new Promise(resolve => setTimeout(resolve, 7000))

  const pipelineRecord = await stateStore.getPipeline(pipelineId)
  const isCancelled = await stateStore.isPipelineCancelled(pipelineId)

  console.log('\n📋 Pipeline record summary:')
  console.log(`   Status: ${pipelineRecord?.status}`)
  console.log(`   Cancelled flag: ${isCancelled}`)
  console.log(`   Current stage: ${pipelineRecord?.currentStage ?? 'none'}`)

  const remainingLeases: number[] = []
  for (let i = 0; i < 6; i++) {
    const lease = await stateStore.getTaskLease(pipelineId, 'slow-stage', i)
    if (lease) {
      remainingLeases.push(i)
    }
  }

  console.log(`   Active leases after cancellation: ${remainingLeases.length}`)
  if (remainingLeases.length) {
    console.log(`   Tasks still leased: ${remainingLeases.join(', ')}`)
  }

  console.log('\n🧹 Cleaning up...')
  await worker.close()
  await orchestrator.close()
  await redisQueue.quit()
  await redisState.quit()

  console.log('\n✅ Demo complete')
  console.log('='.repeat(80) + '\n')
}

main().catch(error => {
  console.error('❌ Demo failed', error)
  process.exit(1)
})
