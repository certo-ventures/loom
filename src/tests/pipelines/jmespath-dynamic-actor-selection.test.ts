/**
 * Test: JMESPath Dynamic Actor Selection
 * 
 * This test verifies that actor names can be JMESPath expressions that are evaluated
 * at runtime to determine which actor should handle the stage.
 * 
 * Bug that was fixed:
 * - Previously, only expressions starting with "$." were evaluated
 * - Now ALL string actor values are evaluated as JMESPath expressions
 * - This supports complex conditionals like: "stages.stage1[0].type == 'text' && 'ActorA' || 'ActorB'"
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

describe('JMESPath Dynamic Actor Selection', () => {
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

  it('should evaluate simple JMESPath conditional expression in actor field', { timeout: 10000 }, async () => {
    let executedBy = ''

    class FastProcessor {
      async execute(input: any): Promise<any> {
        executedBy = 'FastProcessor'
        return { processed: true, method: 'fast' }
      }
    }

    class SlowProcessor {
      async execute(input: any): Promise<any> {
        executedBy = 'SlowProcessor'
        return { processed: true, method: 'slow' }
      }
    }

    worker.registerActor('FastProcessor', new FastProcessor())
    worker.registerActor('SlowProcessor', new SlowProcessor())
    worker.startWorker('FastProcessor', 1)
    worker.startWorker('SlowProcessor', 1)

    const pipeline: PipelineDefinition = {
      name: 'dynamic-actor-routing',
      stages: [
        {
          name: 'route-by-type',
          mode: 'single',
          // JMESPath conditional expression using backticks for string literals
          // Data is in trigger object, so we access trigger.routingType
          actor: 'trigger.routingType == `fast` && `FastProcessor` || `SlowProcessor`',
          input: 'trigger'
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { routingType: 'fast' })
    await waitForPipeline(stateStore, pipelineId, 5000)

    const state = await stateStore.getPipeline(pipelineId)
    expect(state?.status).toBe('completed')
    expect(executedBy).toBe('FastProcessor')

    // Test the other branch
    executedBy = ''
    const pipelineId2 = await orchestrator.execute(pipeline, { routingType: 'slow' })
    await waitForPipeline(stateStore, pipelineId2, 5000)

    const state2 = await stateStore.getPipeline(pipelineId2)
    expect(state2?.status).toBe('completed')
    expect(executedBy).toBe('SlowProcessor')
  })

  it('should evaluate complex JMESPath with stages reference', async () => {
    let route2ExecutedBy = ''

    class TypeDetector {
      async execute(input: any): Promise<any> {
        return { docType: input.type }
      }
    }

    class TextProcessor {
      async execute(input: any): Promise<any> {
        route2ExecutedBy = 'TextProcessor'
        return { processed: true, type: 'text' }
      }
    }

    class ImageProcessor {
      async execute(input: any): Promise<any> {
        route2ExecutedBy = 'ImageProcessor'
        return { processed: true, type: 'image' }
      }
    }

    worker.registerActor('TypeDetector', new TypeDetector())
    worker.registerActor('TextProcessor', new TextProcessor())
    worker.registerActor('ImageProcessor', new ImageProcessor())
    worker.startWorker('TypeDetector', 1)
    worker.startWorker('TextProcessor', 1)
    worker.startWorker('ImageProcessor', 1)

    const pipeline: PipelineDefinition = {
      name: 'document-classification',
      stages: [
        {
          name: 'detectType',
          mode: 'single',
          actor: 'TypeDetector',
          input: 'trigger'
        },
        {
          name: 'processDocument',
          mode: 'single',
          dependsOn: ['detectType'], // Ensure first stage completes before this runs
          // Complex JMESPath expression referencing previous stage output
          // This is exactly the pattern from the bug report:
          // "stages.detectPdfType[0].pdfType == `text` && `TextBasedClassification` || `ImageBasedClassification`"
          actor: 'stages.detectType[0].docType == `text` && `TextProcessor` || `ImageProcessor`',
          input: 'trigger'
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { type: 'text' })
    
    // Wait a moment for stage outputs to be persisted to context
    await new Promise(resolve => setTimeout(resolve, 200))
    
    await waitForPipeline(stateStore, pipelineId, 5000)

    const state = await stateStore.getPipeline(pipelineId)
    expect(state?.status).toBe('completed')
    expect(route2ExecutedBy).toBe('TextProcessor')

    // Test with image type
    route2ExecutedBy = ''
    const pipelineId2 = await orchestrator.execute(pipeline, { type: 'image' })
    await waitForPipeline(stateStore, pipelineId2, 5000)

    const state2 = await stateStore.getPipeline(pipelineId2)
    expect(state2?.status).toBe('completed')
    expect(route2ExecutedBy).toBe('ImageProcessor')
  })

  it('should use literal actor name when not a valid JMESPath expression', async () => {
    let executedBy = ''

    class SimpleActor {
      async execute(input: any): Promise<any> {
        executedBy = 'SimpleActor'
        return { result: 42 }
      }
    }

    worker.registerActor('SimpleActor', new SimpleActor())
    worker.startWorker('SimpleActor', 1)

    const pipeline: PipelineDefinition = {
      name: 'literal-actor-name',
      stages: [
        {
          name: 'simple-stage',
          mode: 'single',
          actor: 'SimpleActor', // Literal actor name (not a JMESPath expression)
          input: 'trigger'
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, { value: 123 })
    await waitForPipeline(stateStore, pipelineId, 5000)

    const state = await stateStore.getPipeline(pipelineId)
    expect(state?.status).toBe('completed')
    expect(executedBy).toBe('SimpleActor')
  })

  it('should handle nested property access in actor expression', { timeout: 10000 }, async () => {
    let executedBy = ''

    class HighPriorityActor {
      async execute(input: any): Promise<any> {
        executedBy = 'HighPriorityActor'
        return { handled: true }
      }
    }

    class LowPriorityActor {
      async execute(input: any): Promise<any> {
        executedBy = 'LowPriorityActor'
        return { handled: true }
      }
    }

    worker.registerActor('HighPriorityActor', new HighPriorityActor())
    worker.registerActor('LowPriorityActor', new LowPriorityActor())
    worker.startWorker('HighPriorityActor', 1)
    worker.startWorker('LowPriorityActor', 1)

    const pipeline: PipelineDefinition = {
      name: 'priority-routing',
      stages: [
        {
          name: 'route-by-priority',
          mode: 'single',
          // Nested property access from trigger
          actor: 'trigger.request.metadata.priority == `high` && `HighPriorityActor` || `LowPriorityActor`',
          input: 'trigger'
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, {
      request: {
        metadata: {
          priority: 'high'
        }
      }
    })
    await waitForPipeline(stateStore, pipelineId, 5000)

    const state = await stateStore.getPipeline(pipelineId)
    expect(state?.status).toBe('completed')
    expect(executedBy).toBe('HighPriorityActor')
  })
})
