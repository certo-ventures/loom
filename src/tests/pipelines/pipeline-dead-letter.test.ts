/**
 * Pipeline DLQ integration tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../../discovery'
import { PipelineOrchestrator } from '../../pipelines/pipeline-orchestrator'
import { PipelineActorWorker } from '../../pipelines/pipeline-actor-worker'
import type { PipelineDefinition } from '../../pipelines/pipeline-dsl'
import { RedisPipelineStateStore } from '../../pipelines/pipeline-state-store'
import { createIsolatedRedis, type RedisTestContext } from '../utils/redis-test-utils'

async function waitFor(condition: () => Promise<boolean> | boolean, timeoutMs = 8000, intervalMs = 50): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error('Condition not met within timeout')
}

describe('Pipeline DLQ integration', () => {
  let redisContext: RedisTestContext
  let messageQueue: BullMQMessageQueue
  let orchestrator: PipelineOrchestrator
  let worker: PipelineActorWorker
  let stateStore: RedisPipelineStateStore

  beforeEach(async () => {
    redisContext = await createIsolatedRedis()

    messageQueue = new BullMQMessageQueue(redisContext.queueRedis, {
      prefix: redisContext.queuePrefix
    })
    stateStore = new RedisPipelineStateStore(redisContext.stateRedis)
    orchestrator = new PipelineOrchestrator(
      messageQueue,
      new InMemoryActorRegistry(),
      redisContext.stateRedis,
      stateStore
    )
    worker = new PipelineActorWorker(messageQueue, stateStore)
  })

  afterEach(async () => {
    await worker.close()
    await messageQueue.close()
    await redisContext.queueRedis.quit()
    await redisContext.stateRedis.quit()
  })

  it('archives failures into the default actor DLQ queue', async () => {
    class AlwaysFails {
      async execute() {
        throw new Error('boom')
      }
    }

    worker.registerActor('AlwaysFails', AlwaysFails)
    worker.startWorker('AlwaysFails', 1)

    const pipeline: PipelineDefinition = {
      name: 'dlq-default-queue',
      stages: [
        {
          name: 'fail-stage',
          mode: 'single',
          actor: 'AlwaysFails',
          input: {
            value: 'trigger.value'
          },
          retry: {
            maxAttempts: 1
          }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { value: 42 })
    const dlqQueue = 'actor-AlwaysFails:dlq'

    await waitFor(async () => {
      const records = await orchestrator.listDeadLetterMessages(dlqQueue)
      return records.length > `0`
    })

    const [record] = await orchestrator.listDeadLetterMessages(dlqQueue)
    expect(record.queueName).toBe(dlqQueue)
    expect(record.message.type).toBe('dead-letter')
    expect(record.message.payload.pipelineId).toBe(pipelineId)
    expect(record.message.payload.stageName).toBe('fail-stage')
    expect(record.message.payload.error?.message).toContain('boom')
  })

  it('respects custom deadLetterQueue overrides', async () => {
    class CrashesImmediately {
      async execute() {
        throw new Error('custom failure')
      }
    }

    worker.registerActor('CrashActor', CrashesImmediately)
    worker.startWorker('CrashActor', 1)

    const customDlq = 'pipelines:custom-dlq'
    const pipeline: PipelineDefinition = {
      name: 'dlq-custom-queue',
      stages: [
        {
          name: 'custom-dlq-stage',
          mode: 'single',
          actor: 'CrashActor',
          input: {
            requestId: 'trigger.id'
          },
          config: {
            deadLetterQueue: customDlq
          },
          retry: {
            maxAttempts: 1
          }
        }
      ]
    }

    await orchestrator.execute(pipeline, { id: 'req-1' })

    await waitFor(async () => {
      const records = await orchestrator.listDeadLetterMessages(customDlq)
      return records.length > `0`
    })

    const [record] = await orchestrator.listDeadLetterMessages(customDlq)
    expect(record.queueName).toBe(customDlq)
    expect(record.message.payload.stageName).toBe('custom-dlq-stage')
    expect(record.message.payload.error?.message).toContain('custom failure')
  })
})
