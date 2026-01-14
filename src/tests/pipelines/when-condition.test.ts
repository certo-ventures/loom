/**
 * Test Stage-Level When Conditions
 * 
 * Tests the when condition feature that was just fixed to ensure
 * stages can be conditionally executed based on pipeline context.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../../discovery'
import { PipelineOrchestrator } from '../../pipelines/pipeline-orchestrator'
import { PipelineActorWorker } from '../../pipelines/pipeline-actor-worker'
import type { PipelineDefinition } from '../../pipelines/pipeline-dsl'
import { RedisPipelineStateStore } from '../../pipelines/pipeline-state-store'
import { createIsolatedRedis, type RedisTestContext } from '../utils/redis-test-utils'

describe('When Condition - Stage-Level Conditional Execution', () => {
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

  it('should skip stage when condition evaluates to false', async () => {
    const executedStages: string[] = []

    class StageActor {
      async execute(input: any) {
        executedStages.push(input.stageName)
        return { result: `${input.stageName} completed` }
      }
    }

    worker.registerActor('StageActor', StageActor)
    worker.startWorker('StageActor', 2)

    const pipeline: PipelineDefinition = {
      name: 'when-condition-test',
      stages: [
        {
          name: 'always-run',
          mode: 'single',
          actor: 'StageActor',
          input: { stageName: 'always-run' }
        },
        {
          name: 'skip-me',
          mode: 'single',
          actor: 'StageActor',
          when: 'trigger.runOptional == `true`', // Will be false
          input: { stageName: 'skip-me' }
        },
        {
          name: 'also-run',
          mode: 'single',
          actor: 'StageActor',
          when: 'trigger.runRequired == `true`', // Will be true
          input: { stageName: 'also-run' }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, {
      runOptional: false,
      runRequired: true
    })

    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 1500))

    const record = await stateStore.getPipeline(pipelineId)
    expect(record.status).toBe('completed')

    // Should only execute 2 stages (skip-me should be skipped)
    expect(executedStages).toHaveLength(2)
    expect(executedStages).toContain('always-run')
    expect(executedStages).toContain('also-run')
    expect(executedStages).not.toContain('skip-me')

    // Verify skip-me stage was marked completed but skipped
    const skipStage = await stateStore.getStage(pipelineId, 'skip-me')
    expect(skipStage.status).toBe('completed')
    expect(skipStage.completedTasks).toBe(0)
    expect(skipStage.expectedTasks).toBe(0)
  })

  it('should evaluate conditions based on previous stage outputs', async () => {
    const executedStages: string[] = []

    class CheckActor {
      async execute(input: any) {
        executedStages.push('check')
        return { needsProcessing: input.value > `100` }
      }
    }

    class ProcessActor {
      async execute(input: any) {
        executedStages.push('process')
        return { processed: true }
      }
    }

    worker.registerActor('CheckActor', CheckActor)
    worker.registerActor('ProcessActor', ProcessActor)
    worker.startWorker('CheckActor', 1)
    worker.startWorker('ProcessActor', 1)

    const pipeline: PipelineDefinition = {
      name: 'conditional-based-on-output',
      stages: [
        {
          name: 'check-value',
          mode: 'single',
          actor: 'CheckActor',
          input: { value: 'trigger.value' },
          output: { needsProcessing: 'needsProcessing' }
        },
        {
          name: 'process',
          mode: 'single',
          actor: 'ProcessActor',
          when: 'stages."check-value"[0].needsProcessing == `true`',
          input: { value: 'trigger.value' }
        }
      ]
    }

    // Test with value that needs processing
    const pipelineId1 = await orchestrator.execute(pipeline, { value: 150 })
    await new Promise(resolve => setTimeout(resolve, 1500))

    expect(executedStages).toContain('check')
    expect(executedStages).toContain('process')

    // Reset and test with value that doesn't need processing
    executedStages.length = 0
    const pipelineId2 = await orchestrator.execute(pipeline, { value: 50 })
    await new Promise(resolve => setTimeout(resolve, 1500))

    expect(executedStages).toContain('check')
    expect(executedStages).not.toContain('process')
  })

  it('should handle complex boolean expressions in when conditions', async () => {
    const executedStages: string[] = []

    class TestActor {
      async execute(input: any) {
        executedStages.push(input.stageName)
        return { result: 'ok' }
      }
    }

    worker.registerActor('TestActor', TestActor)
    worker.startWorker('TestActor', 2)

    const pipeline: PipelineDefinition = {
      name: 'complex-conditions',
      stages: [
        {
          name: 'and-condition',
          mode: 'single',
          actor: 'TestActor',
          when: 'trigger.flag1 == `true` && trigger.flag2 == `true`',
          input: { stageName: 'and-condition' }
        },
        {
          name: 'or-condition',
          mode: 'single',
          actor: 'TestActor',
          when: 'trigger.flag1 == `true` || trigger.flag2 == `true`',
          input: { stageName: 'or-condition' }
        },
        {
          name: 'not-condition',
          mode: 'single',
          actor: 'TestActor',
          when: 'trigger.flag3 != `true`',
          input: { stageName: 'not-condition' }
        }
      ]
    }

    await orchestrator.execute(pipeline, {
      flag1: true,
      flag2: false,
      flag3: false
    })

    await new Promise(resolve => setTimeout(resolve, 1500))

    // and-condition: false (true && false)
    expect(executedStages).not.toContain('and-condition')
    
    // or-condition: true (true || false)
    expect(executedStages).toContain('or-condition')
    
    // not-condition: true (false != true)
    expect(executedStages).toContain('not-condition')
  })

  it('should allow pipeline to complete when all conditional stages are skipped', async () => {
    class TestActor {
      async execute(input: any) {
        return { result: 'ok' }
      }
    }

    worker.registerActor('TestActor', TestActor)
    worker.startWorker('TestActor', 1)

    const pipeline: PipelineDefinition = {
      name: 'all-skipped',
      stages: [
        {
          name: 'stage1',
          mode: 'single',
          actor: 'TestActor',
          when: 'trigger.enable1 == `true`',
          input: { value: 1 }
        },
        {
          name: 'stage2',
          mode: 'single',
          actor: 'TestActor',
          when: 'trigger.enable2 == `true`',
          input: { value: 2 }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, {
      enable1: false,
      enable2: false
    })

    await new Promise(resolve => setTimeout(resolve, 1000))

    const record = await stateStore.getPipeline(pipelineId)
    expect(record.status).toBe('completed')
    
    // Both stages should be marked completed (but skipped)
    const stage1 = await stateStore.getStage(pipelineId, 'stage1')
    const stage2 = await stateStore.getStage(pipelineId, 'stage2')
    
    expect(stage1.status).toBe('completed')
    expect(stage1.completedTasks).toBe(0)
    expect(stage2.status).toBe('completed')
    expect(stage2.completedTasks).toBe(0)
  })
})
