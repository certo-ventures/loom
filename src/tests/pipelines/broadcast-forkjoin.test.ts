/**
 * Test Broadcast and Fork-Join Executors
 * 
 * Tests advanced parallel execution patterns:
 * - Broadcast: Send same input to multiple different actors
 * - Fork-Join: Execute parallel branches that rejoin
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../../discovery'
import { PipelineOrchestrator } from '../../pipelines/pipeline-orchestrator'
import { PipelineActorWorker } from '../../pipelines/pipeline-actor-worker'
import type { PipelineDefinition } from '../../pipelines/pipeline-dsl'
import { RedisPipelineStateStore } from '../../pipelines/pipeline-state-store'
import { createIsolatedRedis, type RedisTestContext } from '../utils/redis-test-utils'

describe('Broadcast Executor', () => {
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

  it('should broadcast to multiple actor types', async () => {
    const notifications: string[] = []

    class EmailNotifier {
      async execute(input: any) {
        notifications.push(`email:${input.message}`)
        return { sent: 'email' }
      }
    }

    class SlackNotifier {
      async execute(input: any) {
        notifications.push(`slack:${input.message}`)
        return { sent: 'slack' }
      }
    }

    class SMSNotifier {
      async execute(input: any) {
        notifications.push(`sms:${input.message}`)
        return { sent: 'sms' }
      }
    }

    worker.registerActor('EmailNotifier', EmailNotifier)
    worker.registerActor('SlackNotifier', SlackNotifier)
    worker.registerActor('SMSNotifier', SMSNotifier)
    worker.startWorker('EmailNotifier', 1)
    worker.startWorker('SlackNotifier', 1)
    worker.startWorker('SMSNotifier', 1)

    const pipeline: PipelineDefinition = {
      name: 'broadcast-test',
      stages: [
        {
          name: 'notify-all',
          mode: 'broadcast',
          actor: 'EmailNotifier', // This is ignored for broadcast
          executorConfig: {
            actors: ['EmailNotifier', 'SlackNotifier', 'SMSNotifier'],
            waitForAll: true
          },
          input: {
            message: '$.trigger.message'
          }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, {
      message: 'System alert!'
    })

    await new Promise(resolve => setTimeout(resolve, 1500))

    const state = await stateStore.getPipeline(pipelineId)
    expect(state.status).toBe('completed')

    // All three notifiers should have been called
    expect(notifications).toHaveLength(3)
    expect(notifications).toContain('email:System alert!')
    expect(notifications).toContain('slack:System alert!')
    expect(notifications).toContain('sms:System alert!')
  })

  it('should collect results from all broadcasted actors', async () => {
    class ValidatorA {
      async execute(input: any) {
        return { validator: 'A', valid: input.value > 10 }
      }
    }

    class ValidatorB {
      async execute(input: any) {
        return { validator: 'B', valid: input.value < 100 }
      }
    }

    class ValidatorC {
      async execute(input: any) {
        return { validator: 'C', valid: input.value % 2 === 0 }
      }
    }

    worker.registerActor('ValidatorA', ValidatorA)
    worker.registerActor('ValidatorB', ValidatorB)
    worker.registerActor('ValidatorC', ValidatorC)
    worker.startWorker('ValidatorA', 1)
    worker.startWorker('ValidatorB', 1)
    worker.startWorker('ValidatorC', 1)

    const pipeline: PipelineDefinition = {
      name: 'broadcast-validators',
      stages: [
        {
          name: 'validate',
          mode: 'broadcast',
          actor: 'ValidatorA',
          executorConfig: {
            actors: ['ValidatorA', 'ValidatorB', 'ValidatorC'],
            waitForAll: true
          },
          input: { value: '$.trigger.value' }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { value: 50 })
    await new Promise(resolve => setTimeout(resolve, 1500))

    const record = await stateStore.getPipeline(pipelineId)
    const results = await stateStore.getStageOutputs(pipelineId, 'validate', 1)

    expect(results).toHaveLength(3)
    
    const validatorA = results.find((r: any) => r.validator === 'A')
    const validatorB = results.find((r: any) => r.validator === 'B')
    const validatorC = results.find((r: any) => r.validator === 'C')

    expect(validatorA.valid).toBe(true)  // 50 > 10
    expect(validatorB.valid).toBe(true)  // 50 < 100
    expect(validatorC.valid).toBe(true)  // 50 % 2 === 0
  })
})

describe('Fork-Join Executor', () => {
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

  it('should execute parallel branches with different actors', async () => {
    const executionOrder: string[] = []

    class TextExtractor {
      async execute(input: any) {
        executionOrder.push('text')
        return { type: 'text', data: `Text from ${input.docId}` }
      }
    }

    class ImageExtractor {
      async execute(input: any) {
        executionOrder.push('image')
        return { type: 'image', data: `Images from ${input.docId}` }
      }
    }

    class MetadataExtractor {
      async execute(input: any) {
        executionOrder.push('metadata')
        return { type: 'metadata', data: `Metadata from ${input.docId}` }
      }
    }

    worker.registerActor('TextExtractor', TextExtractor)
    worker.registerActor('ImageExtractor', ImageExtractor)
    worker.registerActor('MetadataExtractor', MetadataExtractor)
    worker.startWorker('TextExtractor', 1)
    worker.startWorker('ImageExtractor', 1)
    worker.startWorker('MetadataExtractor', 1)

    const pipeline: PipelineDefinition = {
      name: 'fork-join-test',
      stages: [
        {
          name: 'extract-parallel',
          mode: 'fork-join',
          actor: 'TextExtractor', // Ignored for fork-join
          executorConfig: {
            branches: [
              {
                name: 'text-branch',
                actor: 'TextExtractor',
                input: { docId: '$.trigger.docId' }
              },
              {
                name: 'image-branch',
                actor: 'ImageExtractor',
                input: { docId: '$.trigger.docId' }
              },
              {
                name: 'metadata-branch',
                actor: 'MetadataExtractor',
                input: { docId: '$.trigger.docId' }
              }
            ]
          },
          input: { docId: '$.trigger.docId' }
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { docId: 'doc123' })
    await new Promise(resolve => setTimeout(resolve, 1500))

    const record = await stateStore.getPipeline(pipelineId)
    expect(record.status).toBe('completed')

    // All three branches should have executed
    expect(executionOrder).toHaveLength(3)
    expect(executionOrder).toContain('text')
    expect(executionOrder).toContain('image')
    expect(executionOrder).toContain('metadata')

    // Results should be collected
    const results = await stateStore.getStageOutputs(pipelineId, 'extract-parallel', 1)
    expect(results).toHaveLength(3)
    
    const textResult = results.find((r: any) => r.type === 'text')
    const imageResult = results.find((r: any) => r.type === 'image')
    const metaResult = results.find((r: any) => r.type === 'metadata')

    expect(textResult.data).toBe('Text from doc123')
    expect(imageResult.data).toBe('Images from doc123')
    expect(metaResult.data).toBe('Metadata from doc123')
  })

  it('should allow branches to have different inputs', async () => {
    const branchInputs: any[] = []

    class BranchProcessor {
      async execute(input: any) {
        branchInputs.push(input)
        return { processed: input.value * 2 }
      }
    }

    worker.registerActor('BranchProcessor', BranchProcessor)
    worker.startWorker('BranchProcessor', 3)

    const pipeline: PipelineDefinition = {
      name: 'fork-join-different-inputs',
      stages: [
        {
          name: 'parallel-process',
          mode: 'fork-join',
          actor: 'BranchProcessor',
          executorConfig: {
            branches: [
              {
                name: 'branch-a',
                actor: 'BranchProcessor',
                input: { 
                  value: 'trigger.valueA',
                  branch: 'A'
                }
              },
              {
                name: 'branch-b',
                actor: 'BranchProcessor',
                input: { 
                  value: 'trigger.valueB',
                  branch: 'B'
                }
              }
            ]
          },
          input: {} // Default input for stage
        }
      ]
    }

    await orchestrator.execute(pipeline, {
      valueA: 10,
      valueB: 20
    })

    await new Promise(resolve => setTimeout(resolve, 1500))

    console.log('Branch inputs:', JSON.stringify(branchInputs, null, 2))
    expect(branchInputs).toHaveLength(2)
    
    const branchA = branchInputs.find(i => i.branch === 'A')
    const branchB = branchInputs.find(i => i.branch === 'B')

    expect(branchA).toBeDefined()
    expect(branchB).toBeDefined()
    expect(branchA!.value).toBe(10)
    expect(branchB!.value).toBe(20)
  })
})
