/**
 * Metrics instrumentation tests for pipeline orchestration
 */

import { describe, it, expect } from 'vitest'
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import { RedisPipelineStateStore } from '../../pipelines/pipeline-state-store'
import { PipelineOrchestrator } from '../../pipelines/pipeline-orchestrator'
import { InMemoryActorRegistry } from '../../discovery'
import { PipelineActorWorker } from '../../pipelines/pipeline-actor-worker'
import type { PipelineDefinition } from '../../pipelines/pipeline-dsl'
import type { MetricsCollector, HealthCheckResponse, MetricsResponse } from '../../observability/types'
import { createIsolatedRedis } from '../utils/redis-test-utils'

class TestMetricsCollector implements MetricsCollector {
  actorEvents: Array<'created' | 'evicted' | 'activated' | 'idle'> = []
  messageEvents: Array<{ event: 'sent' | 'received' | 'completed' | 'failed'; durationMs?: number }> = []
  lockEvents: Array<'acquired' | 'released' | 'failed'> = []

  async getHealth(): Promise<HealthCheckResponse> {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: 0,
      components: {}
    }
  }

  async getMetrics(): Promise<MetricsResponse> {
    return {
      timestamp: new Date().toISOString(),
      actorPool: {
        total: this.actorEvents.filter(event => event === 'created').length,
        active: this.actorEvents.filter(event => event === 'activated').length,
        idle: this.actorEvents.filter(event => event === 'idle').length,
        evicted: this.actorEvents.filter(event => event === 'evicted').length,
        maxSize: 100,
        utilizationPercent: 0
      },
      messageQueue: {
        pending: 0,
        processing: 0,
        completed: this.messageEvents.filter(event => event.event === 'completed').length,
        failed: this.messageEvents.filter(event => event.event === 'failed').length,
        delayed: 0,
        totalProcessed: this.messageEvents.filter(event => event.event === 'completed' || event.event === 'failed').length,
        avgProcessingTimeMs: 0
      },
      locks: {
        activeLocksCount: 0,
        totalLocksAcquired: this.lockEvents.filter(event => event === 'acquired').length,
        totalLocksReleased: this.lockEvents.filter(event => event === 'released').length,
        totalLockFailures: this.lockEvents.filter(event => event === 'failed').length,
        avgLockDurationMs: 0
      },
      system: {
        memoryUsageMB: 0,
        uptimeSeconds: 0
      }
    }
  }

  recordActorEvent(event: 'created' | 'evicted' | 'activated' | 'idle'): void {
    this.actorEvents.push(event)
  }

  recordMessageEvent(event: 'sent' | 'received' | 'completed' | 'failed', durationMs?: number): void {
    this.messageEvents.push({ event, durationMs })
  }

  recordLockEvent(event: 'acquired' | 'released' | 'failed', _durationMs?: number): void {
    this.lockEvents.push(event)
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error('Condition not met within timeout')
}

describe('Pipeline metrics instrumentation', () => {
  it('records message lifecycle metrics for successful execution', async () => {
    const redisContext = await createIsolatedRedis()
    const metrics = new TestMetricsCollector()

    const messageQueue = new BullMQMessageQueue(redisContext.queueRedis, {
      prefix: redisContext.queuePrefix
    })
    const stateStore = new RedisPipelineStateStore(redisContext.stateRedis)
    const orchestrator = new PipelineOrchestrator(
      messageQueue,
      new InMemoryActorRegistry(),
      redisContext.stateRedis,
      stateStore,
      { metricsCollector: metrics }
    )
    const worker = new PipelineActorWorker(messageQueue, stateStore, { metricsCollector: metrics })

    class Echo {
      async execute(input: { value: number }) {
        return { doubled: input.value * 2 }
      }
    }

    worker.registerActor('Echo', Echo)
    worker.startWorker('Echo', 1)

    const pipeline: PipelineDefinition = {
      name: 'metrics-success-pipeline',
      stages: [
        {
          name: 'double',
          mode: 'single',
          actor: 'Echo',
          input: {
            value: '$.trigger.value'
          }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { value: 3 })

    await waitFor(async () => {
      const record = await stateStore.getPipeline(pipelineId)
      return record?.status === 'completed'
    })

    const sent = metrics.messageEvents.filter(event => event.event === 'sent').length
    const received = metrics.messageEvents.filter(event => event.event === 'received').length
    const completed = metrics.messageEvents.filter(event => event.event === 'completed').length

    expect(sent).toBeGreaterThanOrEqual(1)
    expect(received).toBeGreaterThanOrEqual(1)
    expect(completed).toBeGreaterThanOrEqual(1)

    await worker.close()
    await messageQueue.close()
    await redisContext.queueRedis.quit()
    await redisContext.stateRedis.quit()
  })

  it('records failure metrics when tasks route to the DLQ', async () => {
    const redisContext = await createIsolatedRedis()
    const metrics = new TestMetricsCollector()

    const messageQueue = new BullMQMessageQueue(redisContext.queueRedis, {
      prefix: redisContext.queuePrefix
    })
    const stateStore = new RedisPipelineStateStore(redisContext.stateRedis)
    const orchestrator = new PipelineOrchestrator(
      messageQueue,
      new InMemoryActorRegistry(),
      redisContext.stateRedis,
      stateStore,
      { metricsCollector: metrics }
    )
    const worker = new PipelineActorWorker(messageQueue, stateStore, { metricsCollector: metrics })

    class AlwaysFails {
      async execute() {
        throw new Error('boom')
      }
    }

    worker.registerActor('AlwaysFails', AlwaysFails)
    worker.startWorker('AlwaysFails', 1)

    const pipeline: PipelineDefinition = {
      name: 'metrics-dlq-pipeline',
      stages: [
        {
          name: 'explode',
          mode: 'single',
          actor: 'AlwaysFails',
          retry: {
            maxAttempts: 1
          },
          input: {}
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, {})

    await waitFor(async () => {
      const record = await stateStore.getPipeline(pipelineId)
      return record?.status === 'failed'
    })

    const failureEvents = metrics.messageEvents.filter(event => event.event === 'failed')
    expect(failureEvents.length).toBeGreaterThanOrEqual(1)

    await worker.close()
    await messageQueue.close()
    await redisContext.queueRedis.quit()
    await redisContext.stateRedis.quit()
  })
})
