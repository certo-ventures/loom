/**
 * Test Strategy Pattern - Runtime Actor Selection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../../discovery'
import { PipelineOrchestrator } from '../../pipelines/pipeline-orchestrator'
import { PipelineActorWorker } from '../../pipelines/pipeline-actor-worker'
import type { PipelineDefinition } from '../../pipelines/pipeline-dsl'
import { RedisPipelineStateStore } from '../../pipelines/pipeline-state-store'
import { createIsolatedRedis, type RedisTestContext } from '../utils/redis-test-utils'

describe('Strategy Pattern', () => {
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

  it('should select actor based on ternary strategy', async () => {
    const processedBy: string[] = []

    class BlobStorage {
      async execute(input: { size: number; data: string }) {
        processedBy.push('blob')
        return { stored: true, location: 'blob' }
      }
    }

    class CosmosStorage {
      async execute(input: { size: number; data: string }) {
        processedBy.push('cosmos')
        return { stored: true, location: 'cosmos' }
      }
    }

    worker.registerActor('BlobStorage', BlobStorage)
    worker.registerActor('CosmosStorage', CosmosStorage)
    worker.startWorker('BlobStorage', 1)
    worker.startWorker('CosmosStorage', 1)

    const pipeline: PipelineDefinition = {
      name: 'storage-strategy-test',
      stages: [
        {
          name: 'store-file',
          mode: 'single',
          actor: {
            strategy: 'trigger.fileSize > `1000000` ? "BlobStorage" : "CosmosStorage"'
          },
          input: {
            size: 'trigger.fileSize',
            data: 'trigger.data'
          }
        }
      ]
    }

    // Test 1: Large file → BlobStorage
    await orchestrator.execute(pipeline, {
      fileSize: 5000000,
      data: 'large file content'
    })
    
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(processedBy[0]).toBe('blob')

    // Test 2: Small file → CosmosStorage
    processedBy.length = 0
    await orchestrator.execute(pipeline, {
      fileSize: 50000,
      data: 'small file content'
    })
    
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(processedBy[0]).toBe('cosmos')
  })

  it('should select actor using when conditions', async () => {
    const processedBy: string[] = []

    class FastProcessor {
      async execute(input: any) {
        processedBy.push('fast')
        return { result: 'fast' }
      }
    }

    class NormalProcessor {
      async execute(input: any) {
        processedBy.push('normal')
        return { result: 'normal' }
      }
    }

    class SlowProcessor {
      async execute(input: any) {
        processedBy.push('slow')
        return { result: 'slow' }
      }
    }

    worker.registerActor('FastProcessor', FastProcessor)
    worker.registerActor('NormalProcessor', NormalProcessor)
    worker.registerActor('SlowProcessor', SlowProcessor)
    worker.startWorker('FastProcessor', 1)
    worker.startWorker('NormalProcessor', 1)
    worker.startWorker('SlowProcessor', 1)

    const pipeline: PipelineDefinition = {
      name: 'priority-strategy-test',
      stages: [
        {
          name: 'process-item',
          mode: 'single',
          actor: {
            when: [
              { condition: 'trigger.priority >= `9`', actor: 'FastProcessor' },
              { condition: 'trigger.priority >= `5`', actor: 'NormalProcessor' }
            ],
            default: 'SlowProcessor'
          },
          input: {
            priority: 'trigger.priority'
          }
        }
      ]
    }

    // Test high priority
    await orchestrator.execute(pipeline, { priority: 10 })
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(processedBy[processedBy.length - 1]).toBe('fast')

    // Test medium priority
    await orchestrator.execute(pipeline, { priority: 7 })
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(processedBy[processedBy.length - 1]).toBe('normal')

    // Test low priority (default)
    await orchestrator.execute(pipeline, { priority: 2 })
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(processedBy[processedBy.length - 1]).toBe('slow')
  })

  it('should use strategy in scatter mode', async () => {
    const processedBy: { id: string; processor: string }[] = []

    class QuickProcessor {
      async execute(input: { id: string }) {
        processedBy.push({ id: input.id, processor: 'quick' })
        return { id: input.id, processed: true }
      }
    }

    class DetailedProcessor {
      async execute(input: { id: string }) {
        processedBy.push({ id: input.id, processor: 'detailed' })
        return { id: input.id, processed: true }
      }
    }

    worker.registerActor('QuickProcessor', QuickProcessor)
    worker.registerActor('DetailedProcessor', DetailedProcessor)
    worker.startWorker('QuickProcessor', 2)
    worker.startWorker('DetailedProcessor', 2)

    const pipeline: PipelineDefinition = {
      name: 'scatter-strategy-test',
      stages: [
        {
          name: 'process-items',
          mode: 'scatter',
          actor: {
            strategy: 'item.complexity < `5` ? "QuickProcessor" : "DetailedProcessor"'
          },
          scatter: {
            input: 'trigger.items',
            as: 'item'
          },
          input: {
            id: 'item.id'
          }
        }
      ]
    }

    await orchestrator.execute(pipeline, {
      items: [
        { id: 'item1', complexity: 2 },  // Quick
        { id: 'item2', complexity: 8 },  // Detailed
        { id: 'item3', complexity: 3 },  // Quick
        { id: 'item4', complexity: 10 }  // Detailed
      ]
    })

    await new Promise(resolve => setTimeout(resolve, 1000))

    expect(processedBy).toHaveLength(4)
    
    const item1 = processedBy.find(p => p.id === 'item1')
    const item2 = processedBy.find(p => p.id === 'item2')
    const item3 = processedBy.find(p => p.id === 'item3')
    const item4 = processedBy.find(p => p.id === 'item4')
    
    expect(item1?.processor).toBe('quick')
    expect(item2?.processor).toBe('detailed')
    expect(item3?.processor).toBe('quick')
    expect(item4?.processor).toBe('detailed')
  })
})
