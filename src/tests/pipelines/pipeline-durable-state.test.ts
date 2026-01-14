/**
 * Durable pipeline orchestration tests
 */

import { describe, it, expect } from 'vitest'
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import { RedisPipelineStateStore, type TaskStatus } from '../../pipelines/pipeline-state-store'
import { PipelineOrchestrator } from '../../pipelines/pipeline-orchestrator'
import { InMemoryActorRegistry } from '../../discovery'
import { PipelineActorWorker } from '../../pipelines/pipeline-actor-worker'
import type { PipelineDefinition, StageDefinition } from '../../pipelines/pipeline-dsl'
import { Redis } from 'ioredis'
import { createIsolatedRedis } from '../utils/redis-test-utils'

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

describe('Pipeline durable state', () => {
  it('records task lifecycle events in the state store', async () => {
    const redisContext = await createIsolatedRedis()

    const messageQueue = new BullMQMessageQueue(redisContext.queueRedis, {
      prefix: redisContext.queuePrefix
    })
    const stateStore = new RedisPipelineStateStore(redisContext.stateRedis)
    const orchestrator = new PipelineOrchestrator(
      messageQueue,
      new InMemoryActorRegistry(),
      redisContext.stateRedis,
      stateStore
    )
    const worker = new PipelineActorWorker(messageQueue, stateStore)

    class OrderActor {
      async execute(input: { orderId: string }) {
        return { orderId: input.orderId, status: 'processed' }
      }
    }

    worker.registerActor('OrderActor', OrderActor)
    worker.startWorker('OrderActor', 1)

    const pipeline: PipelineDefinition = {
      name: 'durable-order-pipeline',
      stages: [
        {
          name: 'process-order',
          mode: 'single',
          actor: 'OrderActor',
          input: {
            orderId: 'trigger.orderId'
          }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { orderId: 'order-42' })

    await waitFor(async () => {
      const record = await stateStore.getPipeline(pipelineId)
      return record?.status === 'completed'
    })

    const stage = await stateStore.getStage(pipelineId, 'process-order')
    expect(stage?.status).toBe('completed')
    expect(stage?.completedTasks).toBe(1)

    const attempts = await stateStore.listTaskAttempts(pipelineId, 'process-order')
    expect(attempts.map(a => a.status)).toEqual(['queued', 'running', 'completed'])

    await worker.close()
    await messageQueue.close()
    await redisContext.queueRedis.quit()
    await redisContext.stateRedis.quit()
  })

  it('replays failed tasks from the ledger when resuming', async () => {
    const redisContext = await createIsolatedRedis()

    const messageQueue = new BullMQMessageQueue(redisContext.queueRedis, {
      prefix: redisContext.queuePrefix
    })
    const stateStore = new RedisPipelineStateStore(redisContext.stateRedis)

    const resumeStage: StageDefinition = {
      name: 'resume-stage',
      mode: 'single',
      actor: 'ResumeActor',
      input: {
        value: 'trigger.value'
      }
    }

    const pipelineDefinition: PipelineDefinition = {
      name: 'resume-pipeline',
      stages: [resumeStage]
    }

    const pipelineId = 'pipeline:resume-test'
    await stateStore.createPipeline({
      pipelineId,
      definition: pipelineDefinition,
      triggerData: { value: 7 }
    })

    const startedAt = Date.now()
    await stateStore.upsertStage({
      pipelineId,
      stageName: 'resume-stage',
      status: 'running',
      attempt: 1,
      expectedTasks: 1,
      completedTasks: 0,
      startedAt,
      updatedAt: startedAt
    })

    await stateStore.setPipelineStatus(pipelineId, 'running', {
      currentStage: 'resume-stage',
      resumeCursor: { stageName: 'resume-stage' }
    })

    await stateStore.snapshotContext(pipelineId, {
      trigger: { value: 7 },
      stages: {}
    })

    const failedMessage = {
      messageId: 'resume-msg-1',
      from: pipelineId,
      to: 'ResumeActor',
      type: 'execute',
      payload: {
        pipelineId,
        stageName: 'resume-stage',
        taskIndex: 0,
        input: { value: 7 },
        attempt: 1
      },
      timestamp: new Date().toISOString()
    }

    await stateStore.recordTaskAttempt({
      pipelineId,
      stageName: 'resume-stage',
      taskIndex: 0,
      attempt: 1,
      status: 'failed',
      queueName: 'actor-ResumeActor',
      actorType: 'ResumeActor',
      messageId: failedMessage.messageId,
      message: failedMessage,
      input: { value: 7 },
      error: {
        message: 'worker crashed',
        occurredAt: Date.now(),
        retryable: true
      }
    })

    const worker = new PipelineActorWorker(messageQueue, stateStore)
    const executions: number[] = []

    class ResumeActor {
      async execute(input: { value: number }) {
        executions.push(input.value)
        return { value: input.value * 2 }
      }
    }

    worker.registerActor('ResumeActor', ResumeActor)
    worker.startWorker('ResumeActor', 1)

    const orchestrator = new PipelineOrchestrator(
      messageQueue,
      new InMemoryActorRegistry(),
      redisContext.stateRedis,
      stateStore
    )
    await orchestrator.waitForResume()

    await waitFor(async () => {
      const record = await stateStore.getPipeline(pipelineId)
      return record?.status === 'completed'
    })

    expect(executions).toEqual([7])

    const attempts = await stateStore.listTaskAttempts(pipelineId, 'resume-stage')
    expect(attempts.map(a => a.status)).toEqual(['failed', 'queued', 'running', 'completed'])

    const stageRecord = await stateStore.getStage(pipelineId, 'resume-stage')
    expect(stageRecord?.status).toBe('completed')
    expect(stageRecord?.completedTasks).toBe(1)

    await worker.close()
    await messageQueue.close()
    await redisContext.queueRedis.quit()
    await redisContext.stateRedis.quit()
  })

  it('persists stage outputs for deterministic replay', async () => {
    const redisContext = await createIsolatedRedis()

    const messageQueue = new BullMQMessageQueue(redisContext.queueRedis, {
      prefix: redisContext.queuePrefix
    })
    const stateStore = new RedisPipelineStateStore(redisContext.stateRedis)
    const orchestrator = new PipelineOrchestrator(
      messageQueue,
      new InMemoryActorRegistry(),
      redisContext.stateRedis,
      stateStore
    )
    const worker = new PipelineActorWorker(messageQueue, stateStore)

    class EchoActor {
      async execute(input: { value: number }) {
        return { doubled: input.value * 2 }
      }
    }

    worker.registerActor('EchoActor', EchoActor)
    worker.startWorker('EchoActor', 1)

    const pipeline: PipelineDefinition = {
      name: 'stage-output-pipeline',
      stages: [
        {
          name: 'double-value',
          mode: 'single',
          actor: 'EchoActor',
          input: {
            value: 'trigger.value'
          }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { value: 5 })

    await waitFor(async () => {
      const record = await stateStore.getPipeline(pipelineId)
      return record?.status === 'completed'
    })

    const outputs = await stateStore.getStageOutputs(pipelineId, 'double-value', 1)
    expect(outputs).toEqual([{ doubled: 10 }])

    await worker.close()
    await messageQueue.close()
    await redisContext.queueRedis.quit()
    await redisContext.stateRedis.quit()
  })

  it('retries failed tasks using stage retry policy', async () => {
    const redisContext = await createIsolatedRedis()

    const messageQueue = new BullMQMessageQueue(redisContext.queueRedis, {
      prefix: redisContext.queuePrefix
    })
    const stateStore = new RedisPipelineStateStore(redisContext.stateRedis)
    const orchestrator = new PipelineOrchestrator(
      messageQueue,
      new InMemoryActorRegistry(),
      redisContext.stateRedis,
      stateStore
    )
    const worker = new PipelineActorWorker(messageQueue, stateStore)

    let attempts = 0
    class FlakyActor {
      async execute(input: { value: number }) {
        attempts++
        if (attempts === 1) {
          throw new Error('transient failure')
        }
        return { value: input.value }
      }
    }

    worker.registerActor('FlakyActor', FlakyActor)
    worker.startWorker('FlakyActor', 1)

    const pipeline: PipelineDefinition = {
      name: 'retry-pipeline',
      stages: [
        {
          name: 'flaky-stage',
          mode: 'single',
          actor: 'FlakyActor',
          retry: {
            maxAttempts: 3,
            backoff: 'fixed',
            backoffDelay: 10
          },
          input: {
            value: 'trigger.value'
          }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { value: 5 })

    await waitFor(async () => {
      const record = await stateStore.getPipeline(pipelineId)
      return record?.status === 'completed'
    })

    expect(attempts).toBe(2)

    const taskAttempts = await stateStore.listTaskAttempts(pipelineId, 'flaky-stage')
    expect(taskAttempts.map(a => a.status)).toEqual([
      'queued',
      'running',
      'failed',
      'failed',
      'queued',
      'running',
      'completed'
    ])

    const retryRecords = taskAttempts.filter(a => a.retryAttempt === 2 && a.status === 'queued')
    expect(retryRecords).toHaveLength(1)

    await worker.close()
    await messageQueue.close()
    await redisContext.queueRedis.quit()
    await redisContext.stateRedis.quit()
  })

  it('resumes running scatter stages deterministically after orchestrator restart', async () => {
    const redisContext = await createIsolatedRedis()

    const orchestratorRedis = new Redis('redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    })
    const workerRedis = redisContext.queueRedis

    const orchestratorQueue = new BullMQMessageQueue(orchestratorRedis, {
      prefix: redisContext.queuePrefix
    })
    const workerQueue = new BullMQMessageQueue(workerRedis, {
      prefix: redisContext.queuePrefix
    })
    const stateStore = new RedisPipelineStateStore(redisContext.stateRedis)
    const worker = new PipelineActorWorker(workerQueue, stateStore)

    const executions: number[] = []
    let releaseSecondCall!: () => void
    let signalSecondCall!: () => void
    const secondCallStarted = new Promise<void>(resolve => {
      signalSecondCall = resolve
    })
    const secondCallGate = new Promise<void>(resolve => {
      releaseSecondCall = resolve
    })

    class SlowDoubler {
      async execute(input: { value: number }) {
        executions.push(input.value)
        if (executions.length === 2) {
          signalSecondCall()
          await secondCallGate
        }
        return { doubled: input.value * 2 }
      }
    }

    worker.registerActor('SlowDoubler', SlowDoubler)
    worker.startWorker('SlowDoubler', 1)

    const pipeline: PipelineDefinition = {
      name: 'deterministic-replay',
      stages: [
        {
          name: 'fan-out',
          mode: 'scatter',
          actor: 'SlowDoubler',
          scatter: {
            input: 'trigger.values',
            as: 'value'
          },
          input: {
            value: 'value'
          }
        }
      ]
    }

    const orchestrator = new PipelineOrchestrator(
      orchestratorQueue,
      new InMemoryActorRegistry(),
      redisContext.stateRedis,
      stateStore
    )

    const pipelineId = await orchestrator.execute(pipeline, { values: [2, 4] })

    await waitFor(async () => {
      const stage = await stateStore.getStage(pipelineId, 'fan-out')
      return stage?.completedTasks === 1
    })

    await secondCallStarted

    await orchestrator.close()
    await orchestratorRedis.quit()

    const restartedRedis = new Redis('redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    })
    const restartedQueue = new BullMQMessageQueue(restartedRedis, {
      prefix: redisContext.queuePrefix
    })
    const restartedOrchestrator = new PipelineOrchestrator(
      restartedQueue,
      new InMemoryActorRegistry(),
      redisContext.stateRedis,
      stateStore
    )
    await restartedOrchestrator.waitForResume()

    releaseSecondCall()

    await waitFor(async () => {
      const record = await stateStore.getPipeline(pipelineId)
      return record?.status === 'completed'
    })

    const stageRecord = await stateStore.getStage(pipelineId, 'fan-out')
    expect(stageRecord?.status).toBe('completed')
    expect(stageRecord?.completedTasks).toBe(2)

    const outputs = await stateStore.getStageOutputs(pipelineId, 'fan-out', 1)
    expect(outputs).toEqual([{ doubled: 4 }, { doubled: 8 }])

    const attempts = await stateStore.listTaskAttempts(pipelineId, 'fan-out')
    const statusesByTask = attempts.reduce<Record<number, TaskStatus[]>>((acc, attempt) => {
      acc[attempt.taskIndex] = acc[attempt.taskIndex] ?? []
      acc[attempt.taskIndex].push(attempt.status)
      return acc
    }, {})

    expect(statusesByTask[0]).toEqual(['queued', 'running', 'completed'])
    expect(statusesByTask[1]).toEqual(['queued', 'running', 'completed'])
    expect(executions).toEqual([2, 4])

    await restartedOrchestrator.close()
    await worker.close()
    await restartedRedis.quit()
    await redisContext.queueRedis.quit()
    await redisContext.stateRedis.quit()
  })
})
