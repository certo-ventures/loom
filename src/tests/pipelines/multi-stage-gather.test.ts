/**
 * Test Multi-Stage Gather - Collect from multiple pipeline stages
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Redis } from 'ioredis'
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../../discovery'
import { PipelineOrchestrator } from '../../pipelines/pipeline-orchestrator'
import { PipelineActorWorker } from '../../pipelines/pipeline-actor-worker'
import type { PipelineDefinition } from '../../pipelines/pipeline-dsl'

describe('Multi-Stage Gather', () => {
  let redis: Redis
  let messageQueue: BullMQMessageQueue
  let orchestrator: PipelineOrchestrator
  let worker: PipelineActorWorker

  beforeEach(async () => {
    redis = new Redis('redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    })
    
    const keys = await redis.keys('pipeline:*')
    if (keys.length > 0) await redis.del(...keys)
    const bullKeys = await redis.keys('bull:*')
    if (bullKeys.length > 0) await redis.del(...bullKeys)
    
    messageQueue = new BullMQMessageQueue(redis)
    orchestrator = new PipelineOrchestrator(messageQueue, new InMemoryActorRegistry(), redis)
    worker = new PipelineActorWorker(messageQueue)
  })

  afterEach(async () => {
    await worker.close()
    await messageQueue.close()
    await redis.quit()
  })

  it('should gather from multiple stages with concat mode', async () => {
    let consolidatedData: any[] = []

    class ProcessorA {
      async execute(input: { value: number }) {
        return { source: 'A', value: input.value * 2 }
      }
    }

    class ProcessorB {
      async execute(input: { value: number }) {
        return { source: 'B', value: input.value * 3 }
      }
    }

    class Consolidator {
      async execute(input: { data: any[] }) {
        consolidatedData = input.data
        return { totalItems: input.data.length }
      }
    }

    worker.registerActor('ProcessorA', ProcessorA)
    worker.registerActor('ProcessorB', ProcessorB)
    worker.registerActor('Consolidator', Consolidator)
    worker.startWorker('ProcessorA', 2)
    worker.startWorker('ProcessorB', 2)
    worker.startWorker('Consolidator', 1)

    const pipeline: PipelineDefinition = {
      name: 'multi-stage-gather-concat',
      stages: [
        {
          name: 'process-with-a',
          mode: 'scatter',
          actor: 'ProcessorA',
          scatter: { input: '$.trigger.items', as: 'item' },
          input: { value: '$.item.value' }
        },
        {
          name: 'process-with-b',
          mode: 'scatter',
          actor: 'ProcessorB',
          scatter: { input: '$.trigger.items', as: 'item' },
          input: { value: '$.item.value' }
        },
        {
          name: 'consolidate-all',
          mode: 'gather',
          actor: 'Consolidator',
          gather: {
            stage: ['process-with-a', 'process-with-b'],  // Gather from both!
            combine: 'concat'  // Concatenate results
          },
          input: {
            data: '$.gathered'  // Access combined data
          }
        }
      ]
    }

    await orchestrator.execute(pipeline, {
      items: [{ value: 10 }, { value: 20 }]
    })

    await new Promise(resolve => setTimeout(resolve, 1500))

    // Should have 4 items total: 2 from A, 2 from B
    expect(consolidatedData).toHaveLength(4)
    
    const fromA = consolidatedData.filter(d => d.source === 'A')
    const fromB = consolidatedData.filter(d => d.source === 'B')
    
    expect(fromA).toHaveLength(2)
    expect(fromB).toHaveLength(2)
    expect(fromA.map(d => d.value)).toEqual([20, 40])  // 10*2, 20*2
    expect(fromB.map(d => d.value)).toEqual([30, 60])  // 10*3, 20*3
  })

  it('should gather from multiple stages with object mode', async () => {
    let consolidatedData: any = {}

    class ExtractText {
      async execute(input: { page: string }) {
        return { page: input.page, text: `Text from ${input.page}` }
      }
    }

    class ExtractImages {
      async execute(input: { page: string }) {
        return { page: input.page, images: [`Image from ${input.page}`] }
      }
    }

    class MergeData {
      async execute(input: { stages: any }) {
        consolidatedData = input.stages
        return { merged: true }
      }
    }

    worker.registerActor('ExtractText', ExtractText)
    worker.registerActor('ExtractImages', ExtractImages)
    worker.registerActor('MergeData', MergeData)
    worker.startWorker('ExtractText', 2)
    worker.startWorker('ExtractImages', 2)
    worker.startWorker('MergeData', 1)

    const pipeline: PipelineDefinition = {
      name: 'multi-stage-gather-object',
      stages: [
        {
          name: 'extract-text',
          mode: 'scatter',
          actor: 'ExtractText',
          scatter: { input: '$.trigger.pages', as: 'page' },
          input: { page: '$.page' }
        },
        {
          name: 'extract-images',
          mode: 'scatter',
          actor: 'ExtractImages',
          scatter: { input: '$.trigger.pages', as: 'page' },
          input: { page: '$.page' }
        },
        {
          name: 'merge-extractions',
          mode: 'gather',
          actor: 'MergeData',
          gather: {
            stage: ['extract-text', 'extract-images'],
            combine: 'object'  // Create object with stage names as keys
          },
          input: {
            stages: '$.gathered'  // Object: { 'extract-text': [...], 'extract-images': [...] }
          }
        }
      ]
    }

    await orchestrator.execute(pipeline, {
      pages: ['page1', 'page2']
    })

    await new Promise(resolve => setTimeout(resolve, 1500))

    // Should have object with two keys
    expect(consolidatedData).toHaveProperty('extract-text')
    expect(consolidatedData).toHaveProperty('extract-images')
    expect(consolidatedData['extract-text']).toHaveLength(2)
    expect(consolidatedData['extract-images']).toHaveLength(2)
  })

  it('should gather from diamond pattern (fork-join)', async () => {
    let finalResult: any = {}

    class Classifier {
      async execute(input: { doc: string }) {
        return { doc: input.doc, type: 'classified' }
      }
    }

    class Extractor {
      async execute(input: { doc: string }) {
        return { doc: input.doc, data: 'extracted' }
      }
    }

    class Validator {
      async execute(input: { doc: string }) {
        return { doc: input.doc, valid: true }
      }
    }

    class FinalProcessor {
      async execute(input: { all: any }) {
        finalResult = input.all
        return { processed: true }
      }
    }

    worker.registerActor('Classifier', Classifier)
    worker.registerActor('Extractor', Extractor)
    worker.registerActor('Validator', Validator)
    worker.registerActor('FinalProcessor', FinalProcessor)
    worker.startWorker('Classifier', 1)
    worker.startWorker('Extractor', 1)
    worker.startWorker('Validator', 1)
    worker.startWorker('FinalProcessor', 1)

    const pipeline: PipelineDefinition = {
      name: 'diamond-pattern',
      stages: [
        // Fan-out to 3 parallel stages
        {
          name: 'classify',
          mode: 'single',
          actor: 'Classifier',
          input: { doc: '$.trigger.document' }
        },
        {
          name: 'extract',
          mode: 'single',
          actor: 'Extractor',
          input: { doc: '$.trigger.document' }
        },
        {
          name: 'validate',
          mode: 'single',
          actor: 'Validator',
          input: { doc: '$.trigger.document' }
        },
        // Gather all 3 branches
        {
          name: 'final-process',
          mode: 'gather',
          actor: 'FinalProcessor',
          gather: {
            stage: ['classify', 'extract', 'validate'],
            combine: 'object'
          },
          input: {
            all: '$.gathered'
          }
        }
      ]
    }

    await orchestrator.execute(pipeline, {
      document: 'test-doc.pdf'
    })

    await new Promise(resolve => setTimeout(resolve, 2000))

    expect(finalResult).toHaveProperty('classify')
    expect(finalResult).toHaveProperty('extract')
    expect(finalResult).toHaveProperty('validate')
    expect(finalResult.classify).toHaveLength(1)
    expect(finalResult.extract).toHaveLength(1)
    expect(finalResult.validate).toHaveLength(1)
  })
})
