/**
 * RedisPipelineStateStore unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RedisPipelineStateStore } from '../../pipelines/pipeline-state-store'
import type { PipelineDefinition } from '../../pipelines/pipeline-dsl'
import { createIsolatedRedis, type RedisTestContext } from '../utils/redis-test-utils'

const pipelineDefinition: PipelineDefinition = {
  name: 'store-state-test',
  stages: [
    {
      name: 'process-document',
      mode: 'single',
      actor: 'TestActor',
      input: {
        id: 'trigger.id'
      }
    }
  ]
}

describe('RedisPipelineStateStore', () => {
  let redisContext: RedisTestContext
  let store: RedisPipelineStateStore

  beforeEach(async () => {
    redisContext = await createIsolatedRedis()
    store = new RedisPipelineStateStore(redisContext.stateRedis)
  })

  afterEach(async () => {
    await redisContext.queueRedis.quit()
    await redisContext.stateRedis.quit()
  })

  it('tracks pipeline, stage, and task lifecycle metadata', async () => {
    const pipelineId = 'pipeline:state-store-test'

    const created = await store.createPipeline({
      pipelineId,
      definition: pipelineDefinition,
      triggerData: { id: 'doc-123' }
    })

    expect(created.status).toBe('running')
    expect(created.stageOrder).toEqual(['process-document'])

    const startTime = Date.now()
    await store.upsertStage({
      pipelineId,
      stageName: 'process-document',
      status: 'running',
      attempt: 1,
      expectedTasks: 1,
      completedTasks: 0,
      startedAt: startTime,
      updatedAt: startTime
    })

    await store.updateStageProgress({
      pipelineId,
      stageName: 'process-document',
      completedTasksDelta: 0,
      outputsRef: 'outputs:1'
    })

    const queuedAt = Date.now()
    await store.recordTaskAttempt({
      pipelineId,
      stageName: 'process-document',
      taskIndex: 0,
      attempt: 1,
      status: 'queued',
      queuedAt,
      queueName: 'actor-TestActor',
      actorType: 'TestActor',
      messageId: 'msg-1',
      message: { messageId: 'msg-1' },
      input: { id: 'doc-123' }
    })

    await store.recordTaskAttempt({
      pipelineId,
      stageName: 'process-document',
      taskIndex: 0,
      attempt: 1,
      status: 'running',
      workerId: 'worker-1',
      startedAt: queuedAt + 10
    })

    await store.recordTaskAttempt({
      pipelineId,
      stageName: 'process-document',
      taskIndex: 0,
      attempt: 1,
      status: 'completed',
      completedAt: queuedAt + 20,
      output: { ok: true }
    })

    const attempts = await store.listTaskAttempts(pipelineId, 'process-document')
    expect(attempts).toHaveLength(3)
    expect(attempts.map(a => a.status)).toEqual(['queued', 'running', 'completed'])

    const pending = await store.getPendingTasks(pipelineId, 'process-document')
    expect(pending).toHaveLength(0)

    await store.setPipelineStatus(pipelineId, 'completed', {
      currentStage: undefined,
      resumeCursor: undefined
    })

    const pipelineRecord = await store.getPipeline(pipelineId)
    expect(pipelineRecord?.status).toBe('completed')

    const running = await store.listRunningPipelines()
    expect(running).not.toContain(pipelineId)
  })

  it('persists stage outputs for deterministic replay', async () => {
    const pipelineId = 'pipeline:stage-outputs-test'

    await store.createPipeline({
      pipelineId,
      definition: pipelineDefinition,
      triggerData: { id: 'doc-456' }
    })

    await store.appendStageOutput(pipelineId, 'process-document', 1, { value: 'a' })
    await store.appendStageOutput(pipelineId, 'process-document', 1, { value: 'b' })

    const outputs = await store.getStageOutputs(pipelineId, 'process-document', 1)
    expect(outputs).toEqual([{ value: 'a' }, { value: 'b' }])

    await store.clearStageOutputs(pipelineId, 'process-document', 1)
    const cleared = await store.getStageOutputs(pipelineId, 'process-document', 1)
    expect(cleared).toHaveLength(0)
  })
})
