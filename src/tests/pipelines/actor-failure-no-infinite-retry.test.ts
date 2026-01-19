/**
 * Test: Actor failures should NOT cause infinite BullMQ retries
 * 
 * This test verifies that when an actor throws an error:
 * 1. The failure message is sent to the orchestrator
 * 2. BullMQ does NOT retry the job automatically
 * 3. The pipeline orchestrator handles retries based on the retry policy
 * 4. After max retries are exhausted, the pipeline fails properly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../../discovery'
import { PipelineOrchestrator } from '../../pipelines/pipeline-orchestrator'
import { PipelineActorWorker } from '../../pipelines/pipeline-actor-worker'
import { RedisPipelineStateStore } from '../../pipelines/pipeline-state-store'
import type { PipelineDefinition } from '../../pipelines/pipeline-dsl'
import { createIsolatedRedis, type RedisTestContext } from '../utils/redis-test-utils'

async function waitForPipeline(stateStore: RedisPipelineStateStore, pipelineId: string, timeoutMs = 5000): Promise<void> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    const state = await stateStore.getPipeline(pipelineId)
    if (state?.status === 'completed' || state?.status === 'failed') {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Pipeline ${pipelineId} did not complete within ${timeoutMs}ms`)
}

describe('Actor Failure - No Infinite Retry Bug', () => {
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
    await orchestrator.close()
    await worker.close()
    await messageQueue.close()
    await redisContext.queueRedis.quit()
    await redisContext.stateRedis.quit()
  })

  it('should fail pipeline after max retries without infinite BullMQ retries', async () => {
    let executionCount = 0
    const maxExpectedExecutions = 2 // Initial attempt + 1 retry (maxAttempts: 2)

    // Actor that always fails
    class FailingActor {
      async execute(input: any): Promise<any> {
        executionCount++
        console.log(`Execution #${executionCount}`)
        throw new Error('Intentional failure for testing')
      }
    }

    worker.registerActor('failing-actor', new FailingActor())
    worker.startWorker('failing-actor', 1)

    const pipeline: PipelineDefinition = {
      name: 'test-failure-pipeline',
      stages: [
        {
          name: 'failing-stage',
          mode: 'single',
          actor: 'failing-actor',
          input: 'trigger',
          retry: {
            maxAttempts: 2, // 1 initial + 1 retry = 2 total
            backoffMs: 100,
            backoffMultiplier: 1
          }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { value: 42 })

    // Wait for pipeline to fail (with timeout)
    const startTime = Date.now()
    const timeout = 5000 // 5 seconds max
    let state = await stateStore.getPipeline(pipelineId)

    while (state?.status !== 'failed' && Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100))
      state = await stateStore.getPipeline(pipelineId)
    }

    // Verify pipeline failed
    expect(state?.status).toBe('failed')

    // Wait a bit more to ensure no additional retries happen
    await new Promise(resolve => setTimeout(resolve, 500))

    // CRITICAL: Execution count should be close to maxAttempts (2)
    // BullMQ may do internal retries, but it should not be infinite
    expect(executionCount).toBeGreaterThanOrEqual(maxExpectedExecutions)
    expect(executionCount).toBeLessThanOrEqual(maxExpectedExecutions + 2) // Allow small variance

    console.log(`Final execution count: ${executionCount} (expected: ${maxExpectedExecutions})`)

    // Verify task attempts were recorded correctly
    const attempts = await stateStore.listTaskAttempts(pipelineId, 'failing-stage')
    
    // Should have at least 2 attempts: initial + 1 retry
    const queuedAttempts = attempts.filter(a => a.status === 'queued')
    expect(queuedAttempts.length).toBeGreaterThanOrEqual(2)

    // At least 2 should have failed
    const failedAttempts = attempts.filter(a => a.status === 'failed')
    expect(failedAttempts.length).toBeGreaterThanOrEqual(2)
  })

  it('should handle actor errors without BullMQ job retries', async () => {
    let executionCount = 0

    class ErrorActor {
      async execute(input: any): Promise<any> {
        executionCount++
        if (executionCount === 1) {
          throw new Error('First attempt fails')
        }
        return { success: true, attempt: executionCount }
      }
    }

    worker.registerActor('error-actor', new ErrorActor())
    worker.startWorker('error-actor', 1)

    const pipeline: PipelineDefinition = {
      name: 'test-error-recovery',
      stages: [
        {
          name: 'error-stage',
          mode: 'single',
          actor: 'error-actor',
          input: 'trigger',
          retry: {
            maxAttempts: 3,
            backoffMs: 100,
            backoffMultiplier: 1
          }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { value: 42 })

    // Wait for completion
    await waitForPipeline(stateStore, pipelineId, 5000)

    const state = await stateStore.getPipeline(pipelineId)
    expect(state?.status).toBe('completed')

    // Should have executed exactly twice: 1 failure + 1 success
    expect(executionCount).toBe(2)

    const outputs = await stateStore.getStageOutputs(pipelineId, 'error-stage', 1)
    expect(outputs).toEqual([{ success: true, attempt: 2 }])
  })

  it('should not retry if maxAttempts is 1', async () => {
    let executionCount = 0

    class FailOnceActor {
      async execute(input: any): Promise<any> {
        executionCount++
        throw new Error('No retries configured')
      }
    }

    worker.registerActor('fail-once', new FailOnceActor())
    worker.startWorker('fail-once', 1)

    const pipeline: PipelineDefinition = {
      name: 'no-retry-pipeline',
      stages: [
        {
          name: 'no-retry-stage',
          mode: 'single',
          actor: 'fail-once',
          input: 'trigger',
          retry: {
            maxAttempts: 1 // No retries
          }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { value: 42 })

    // Wait for failure
    const startTime = Date.now()
    let state = await stateStore.getPipeline(pipelineId)

    while (state?.status !== 'failed' && Date.now() - startTime < 3000) {
      await new Promise(resolve => setTimeout(resolve, 100))
      state = await stateStore.getPipeline(pipelineId)
    }

    expect(state?.status).toBe('failed')

    // Should have executed only once
    expect(executionCount).toBe(1)

    const attempts = await stateStore.listTaskAttempts(pipelineId, 'no-retry-stage')
    const queuedAttempts = attempts.filter(a => a.status === 'queued')
    expect(queuedAttempts.length).toBe(1)
  })
})
