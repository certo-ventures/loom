import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PipelineOrchestrator } from '../../pipelines/pipeline-orchestrator'
import { RedisPipelineStateStore } from '../../pipelines/pipeline-state-store'
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../../discovery'
import { PipelineActorWorker } from '../../pipelines/pipeline-actor-worker'
import type { PipelineDefinition } from '../../pipelines/pipeline-dsl'
import { createIsolatedRedis } from '../utils/redis-test-utils'

async function waitForPipeline(stateStore: RedisPipelineStateStore, pipelineId: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const record = await stateStore.getPipeline(pipelineId)
    if (record && (record.status === 'completed' || record.status === 'failed')) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Pipeline did not complete within timeout')
}

describe('Pipeline DAG execution', () => {
  let redisContext: any
  let orchestrator: PipelineOrchestrator
  let stateStore: RedisPipelineStateStore
  let messageQueue: BullMQMessageQueue
  let worker: PipelineActorWorker

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
    try {
      if (worker) {
        await worker.close()
      }
    } catch (e) {
      // Ignore close errors
    }
    
    try {
      if (messageQueue) {
        await messageQueue.close()
      }
    } catch (e) {
      // Ignore close errors
    }
    
    if (redisContext) {
      // Wait a bit for connections to fully close
      await new Promise(resolve => setTimeout(resolve, 500))
      
      try {
        await redisContext.queueRedis.quit()
      } catch (e) {
        // Ignore quit errors - connection may already be closed
      }
      
      try {
        await redisContext.stateRedis.quit()
      } catch (e) {
        // Ignore quit errors - connection may already be closed
      }
    }
  })

  it('should execute stages in parallel when dependencies are met', async () => {
    const executionLog: string[] = []

    class StageA {
      async execute(_input: any) {
        executionLog.push('A-start')
        await new Promise(resolve => setTimeout(resolve, 50))
        executionLog.push('A-end')
        return { stage: 'A', value: 1 }
      }
    }

    class StageB {
      async execute(_input: any) {
        executionLog.push('B-start')
        await new Promise(resolve => setTimeout(resolve, 50))
        executionLog.push('B-end')
        return { stage: 'B', value: 2 }
      }
    }

    class StageC {
      async execute(_input: any) {
        executionLog.push('C-start')
        executionLog.push('C-end')
        return { stage: 'C', value: 3 }
      }
    }

    worker.registerActor('StageA', StageA)
    worker.registerActor('StageB', StageB)
    worker.registerActor('StageC', StageC)
    
    worker.startWorker('StageA', 1)
    worker.startWorker('StageB', 1)
    worker.startWorker('StageC', 1)

    const pipeline: PipelineDefinition = {
      name: 'parallel-dag-test',
      stages: [
        {
          name: 'stage-a',
          mode: 'single',
          actor: 'StageA',
          input: { data: 'a' }
        },
        {
          name: 'stage-b',
          mode: 'single',
          actor: 'StageB',
          input: { data: 'b' }
        },
        {
          name: 'stage-c',
          mode: 'single',
          actor: 'StageC',
          input: { data: 'c' },
          dependsOn: ['stage-a', 'stage-b']
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, {})
    await waitForPipeline(stateStore, pipelineId, 5000)

    const record = await stateStore.getPipeline(pipelineId)
    expect(record?.status).toBe('completed')

    // A and B should start immediately (no dependencies)
    expect(executionLog.indexOf('A-start')).toBeGreaterThanOrEqual(0)
    expect(executionLog.indexOf('B-start')).toBeGreaterThanOrEqual(0)

    // C should only start after both A and B complete
    const cStartIndex = executionLog.indexOf('C-start')
    const aEndIndex = executionLog.indexOf('A-end')
    const bEndIndex = executionLog.indexOf('B-end')
    
    expect(cStartIndex).toBeGreaterThan(aEndIndex)
    expect(cStartIndex).toBeGreaterThan(bEndIndex)
  })

  it('should reject pipelines with cycles', async () => {
    const pipeline: PipelineDefinition = {
      name: 'cyclic-dag',
      stages: [
        {
          name: 'stage-a',
          mode: 'single',
          actor: 'ActorA',
          input: {},
          dependsOn: 'stage-b'
        },
        {
          name: 'stage-b',
          mode: 'single',
          actor: 'ActorB',
          input: {},
          dependsOn: 'stage-a'
        }
      ]
    }

    await expect(orchestrator.execute(pipeline, {})).rejects.toThrow(/cycle/)
  })

  it('should track multiple concurrent active stages', async () => {
    class SlowActor {
      async execute(_input: any) {
        await new Promise(resolve => setTimeout(resolve, 100))
        return { done: true }
      }
    }

    worker.registerActor('SlowActor', SlowActor)
    worker.startWorker('SlowActor', 1)

    const pipeline: PipelineDefinition = {
      name: 'concurrent-stages',
      stages: [
        {
          name: 'stage-1',
          mode: 'single',
          actor: 'SlowActor',
          input: {}
        },
        {
          name: 'stage-2',
          mode: 'single',
          actor: 'SlowActor',
          input: {}
        },
        {
          name: 'stage-3',
          mode: 'single',
          actor: 'SlowActor',
          input: {},
          dependsOn: ['stage-1', 'stage-2']
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, {})
    
    // Wait a bit for stages to start
    await new Promise(resolve => setTimeout(resolve, 50))

    const record = await stateStore.getPipeline(pipelineId)
    expect(record?.activeStages).toBeDefined()
    expect(record?.activeStages?.length).toBeGreaterThan(0)

    await waitForPipeline(stateStore, pipelineId, 5000)

    const finalRecord = await stateStore.getPipeline(pipelineId)
    expect(finalRecord?.status).toBe('completed')
    expect(finalRecord?.activeStages).toEqual([])
  })

  it('should resume DAG with multiple active stages', async () => {
    class ResumeDAGActor {
      async execute(input: any) {
        return { value: input.value * 2 }
      }
    }

    worker.registerActor('ResumeDAGActor', ResumeDAGActor)
    worker.startWorker('ResumeDAGActor', 1)

    const pipeline: PipelineDefinition = {
      name: 'resume-dag',
      stages: [
        {
          name: 'init',
          mode: 'single',
          actor: 'ResumeDAGActor',
          input: {
            value: 'trigger.val1'
          }
        },
        {
          name: 'parallel-1',
          mode: 'single',
          actor: 'ResumeDAGActor',
          input: {
            value: 'trigger.val2'
          },
          dependsOn: 'init'
        },
        {
          name: 'parallel-2',
          mode: 'single',
          actor: 'ResumeDAGActor',
          input: {
            value: 'trigger.val3'
          },
          dependsOn: 'init'
        }
      ]
    }

    // Start pipeline and let init complete
    const pipelineId = await orchestrator.execute(pipeline, { val1: 1, val2: 2, val3: 3 })
    await new Promise(resolve => setTimeout(resolve, 100))

    // Dispose and recreate worker (simulating restart)
    await worker.close()
    
    const newWorker = new PipelineActorWorker(messageQueue, stateStore)
    
    class ResumeDAGActor2 {
      async execute(input: any) {
        return { value: input.value * 2 }
      }
    }

    newWorker.registerActor('ResumeDAGActor', ResumeDAGActor2)
    newWorker.startWorker('ResumeDAGActor', 1)

    await orchestrator.waitForResume()
    await waitForPipeline(stateStore, pipelineId, 5000)

    const record = await stateStore.getPipeline(pipelineId)
    expect(record?.status).toBe('completed')

    await newWorker.close()
  })

  it('should execute diamond-shaped DAG correctly', async () => {
    const results: string[] = []

    class DiamondActor {
      async execute(input: any) {
        results.push(input.stage)
        return { stage: input.stage, timestamp: Date.now() }
      }
    }

    worker.registerActor('DiamondActor', DiamondActor)
    worker.startWorker('DiamondActor', 1)

    // Diamond: A -> B,C -> D
    const pipeline: PipelineDefinition = {
      name: 'diamond-dag',
      stages: [
        {
          name: 'A',
          mode: 'single',
          actor: 'DiamondActor',
          input: { stage: 'A' }
        },
        {
          name: 'B',
          mode: 'single',
          actor: 'DiamondActor',
          input: { stage: 'B' },
          dependsOn: 'A'
        },
        {
          name: 'C',
          mode: 'single',
          actor: 'DiamondActor',
          input: { stage: 'C' },
          dependsOn: 'A'
        },
        {
          name: 'D',
          mode: 'single',
          actor: 'DiamondActor',
          input: { stage: 'D' },
          dependsOn: ['B', 'C']
        }
      ]
    }

    const pipelineId = await orchestrator.execute(pipeline, {})
    await waitForPipeline(stateStore, pipelineId, 5000)

    const record = await stateStore.getPipeline(pipelineId)
    expect(record?.status).toBe('completed')

    // Verify execution order: A first, then B and C, then D last
    expect(results[0]).toBe('A')
    expect(results[results.length - 1]).toBe('D')
    expect(results).toContain('B')
    expect(results).toContain('C')
    expect(results.indexOf('D')).toBeGreaterThan(results.indexOf('B'))
    expect(results.indexOf('D')).toBeGreaterThan(results.indexOf('C'))
  })
})
