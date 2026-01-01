/**
 * Test Conditional Scatter - Filter items before fan-out
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../../discovery'
import { PipelineOrchestrator } from '../../pipelines/pipeline-orchestrator'
import { PipelineActorWorker } from '../../pipelines/pipeline-actor-worker'
import type { PipelineDefinition } from '../../pipelines/pipeline-dsl'
import { RedisPipelineStateStore } from '../../pipelines/pipeline-state-store'
import { createIsolatedRedis, type RedisTestContext } from '../utils/redis-test-utils'

describe('Conditional Scatter', () => {
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

  it('should filter items based on condition', async () => {
    const processedDocuments: string[] = []

    // Actor that tracks what it processes
    class DocumentProcessor {
      async execute(input: { docId: string; status: string }) {
        processedDocuments.push(input.docId)
        return { docId: input.docId, processed: true }
      }
    }

    worker.registerActor('DocumentProcessor', DocumentProcessor)
    worker.startWorker('DocumentProcessor', 2)

    const pipeline: PipelineDefinition = {
      name: 'conditional-scatter-test',
      stages: [
        {
          name: 'process-unprocessed',
          mode: 'scatter',
          actor: 'DocumentProcessor',
          scatter: {
            input: '$.trigger.documents',
            as: 'doc',
            condition: '$.doc.status == "pending"'  // Only process pending docs
          },
          input: {
            docId: '$.doc.id',
            status: '$.doc.status'
          }
        }
      ]
    }

    const triggerData = {
      documents: [
        { id: 'doc1', status: 'pending' },      // Should process
        { id: 'doc2', status: 'processed' },    // Skip
        { id: 'doc3', status: 'pending' },      // Should process
        { id: 'doc4', status: 'processed' },    // Skip
        { id: 'doc5', status: 'pending' }       // Should process
      ]
    }

    await orchestrator.execute(pipeline, triggerData)

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Should only process 3 documents (pending ones)
    expect(processedDocuments).toHaveLength(3)
    expect(processedDocuments).toContain('doc1')
    expect(processedDocuments).toContain('doc3')
    expect(processedDocuments).toContain('doc5')
    expect(processedDocuments).not.toContain('doc2')
    expect(processedDocuments).not.toContain('doc4')
  })

  it('should filter based on numeric condition', async () => {
    const processedAmounts: number[] = []

    class TransactionProcessor {
      async execute(input: { amount: number }) {
        processedAmounts.push(input.amount)
        return { processed: true }
      }
    }

    worker.registerActor('TransactionProcessor', TransactionProcessor)
    worker.startWorker('TransactionProcessor', 2)

    const pipeline: PipelineDefinition = {
      name: 'large-transactions-only',
      stages: [
        {
          name: 'process-large',
          mode: 'scatter',
          actor: 'TransactionProcessor',
          scatter: {
            input: '$.trigger.transactions',
            as: 'tx',
            condition: '$.tx.amount > 1000'  // Only large transactions
          },
          input: {
            amount: '$.tx.amount'
          }
        }
      ]
    }

    const triggerData = {
      transactions: [
        { amount: 500 },    // Skip
        { amount: 1500 },   // Process
        { amount: 750 },    // Skip
        { amount: 2000 },   // Process
        { amount: 100 }     // Skip
      ]
    }

    await orchestrator.execute(pipeline, triggerData)
    await new Promise(resolve => setTimeout(resolve, 1000))

    expect(processedAmounts).toHaveLength(2)
    expect(processedAmounts).toContain(1500)
    expect(processedAmounts).toContain(2000)
  })

  it('should process all items when no condition specified', async () => {
    const processedIds: string[] = []

    class ItemProcessor {
      async execute(input: { id: string }) {
        processedIds.push(input.id)
        return { processed: true }
      }
    }

    worker.registerActor('ItemProcessor', ItemProcessor)
    worker.startWorker('ItemProcessor', 2)

    const pipeline: PipelineDefinition = {
      name: 'no-condition-scatter',
      stages: [
        {
          name: 'process-all',
          mode: 'scatter',
          actor: 'ItemProcessor',
          scatter: {
            input: '$.trigger.items',
            as: 'item'
            // No condition - process all
          },
          input: {
            id: '$.item.id'
          }
        }
      ]
    }

    const triggerData = {
      items: [
        { id: 'item1' },
        { id: 'item2' },
        { id: 'item3' }
      ]
    }

    await orchestrator.execute(pipeline, triggerData)
    await new Promise(resolve => setTimeout(resolve, 1000))

    expect(processedIds).toHaveLength(3)
    expect(processedIds).toContain('item1')
    expect(processedIds).toContain('item2')
    expect(processedIds).toContain('item3')
  })
})
