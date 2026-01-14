/**
 * Tests for different actor registration patterns:
 * 1. Class constructors (existing pattern)
 * 2. Pre-instantiated instances (for dependency injection)
 * 3. Factory functions (for dynamic instantiation with DI)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PipelineActorWorker } from '../../pipelines/pipeline-actor-worker'
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../../discovery'
import { RedisPipelineStateStore } from '../../pipelines/pipeline-state-store'
import { createIsolatedRedis as createRedisTestContext, type RedisTestContext } from '../utils/redis-test-utils'
import type { ActorImplementation } from '../../pipelines/pipeline-actor-worker'
import type { PipelineDefinition } from '../../pipelines/pipeline-executor'
import { PipelineExecutor } from '../../pipelines/pipeline-executor'

describe('PipelineActorWorker - Registration Patterns', () => {
  let redisContext: RedisTestContext
  let messageQueue: BullMQMessageQueue
  let stateStore: RedisPipelineStateStore
  let worker: PipelineActorWorker
  let executor: PipelineExecutor

  beforeEach(async () => {
    redisContext = await createRedisTestContext()
    stateStore = new RedisPipelineStateStore(redisContext.stateRedis)
    messageQueue = new BullMQMessageQueue(
      new InMemoryActorRegistry(),
      redisContext.stateRedis,
      stateStore
    )
    worker = new PipelineActorWorker(messageQueue, stateStore)
    executor = new PipelineExecutor(messageQueue, stateStore)
  })

  afterEach(async () => {
    await worker.close()
    await messageQueue.close()
    await redisContext.queueRedis.quit()
    await redisContext.stateRedis.quit()
  })

  describe('Pattern 1: Class Registration', () => {
    it('should work with class constructors (existing behavior)', async () => {
      const results: string[] = []

      class SimpleActor implements ActorImplementation {
        async execute(input: string): Promise<string> {
          const output = `processed-${input}`
          results.push(output)
          return output
        }
      }

      worker.registerActor('SimpleActor', SimpleActor)
      worker.startWorker('SimpleActor', 1)

      const pipeline: PipelineDefinition = {
        name: 'class-registration-test',
        stages: [
          {
            name: 'process',
            actor: 'SimpleActor',
            input: '$.trigger.value'
          }
        ]
      }

      const pipelineId = await executor.startPipeline(pipeline, { value: 'test-data' })
      await executor.waitForCompletion(pipelineId, 5000)

      const state = await stateStore.getPipelineState(pipelineId)
      expect(state?.status).toBe('completed')
      expect(results).toEqual(['processed-test-data'])
    })
  })

  describe('Pattern 2: Instance Registration (Dependency Injection)', () => {
    it('should work with pre-instantiated instances', async () => {
      const results: string[] = []

      // Simulate dependencies
      class MockCosmosClient {
        constructor(public endpoint: string) {}
        async query(sql: string): Promise<any[]> {
          return [{ id: '123', data: 'from-cosmos' }]
        }
      }

      class MockLLMConfig {
        constructor(public apiKey: string, public model: string) {}
      }

      // Actor with dependencies
      class DependentActor implements ActorImplementation {
        constructor(
          private cosmosClient: MockCosmosClient,
          private llmConfig: MockLLMConfig
        ) {}

        async execute(input: string): Promise<string> {
          // Use the injected dependencies
          const cosmosData = await this.cosmosClient.query('SELECT * FROM items')
          const output = `${input}-cosmos:${cosmosData.length}-model:${this.llmConfig.model}`
          results.push(output)
          return output
        }
      }

      // Create dependencies
      const cosmosClient = new MockCosmosClient('https://test.cosmos.azure.com')
      const llmConfig = new MockLLMConfig('test-key', 'gpt-4')

      // Register a pre-instantiated instance (singleton pattern)
      const actorInstance = new DependentActor(cosmosClient, llmConfig)
      worker.registerActor('DependentActor', actorInstance)
      worker.startWorker('DependentActor', 1)

      const pipeline: PipelineDefinition = {
        name: 'instance-registration-test',
        stages: [
          {
            name: 'process',
            actor: 'DependentActor',
            input: '$.trigger.value'
          }
        ]
      }

      const pipelineId = await executor.startPipeline(pipeline, { value: 'test' })
      await executor.waitForCompletion(pipelineId, 5000)

      const state = await stateStore.getPipelineState(pipelineId)
      expect(state?.status).toBe('completed')
      expect(results).toEqual(['test-cosmos:1-model:gpt-4'])
    })

    it('should reuse the same instance across multiple tasks', async () => {
      const instanceIds = new Set<number>()
      let instanceCounter = 0

      class CountingActor implements ActorImplementation {
        private id: number

        constructor() {
          this.id = ++instanceCounter
        }

        async execute(input: string): Promise<{ id: number; input: string }> {
          instanceIds.add(this.id)
          return { id: this.id, input }
        }
      }

      // Register singleton instance
      const actorInstance = new CountingActor()
      worker.registerActor('CountingActor', actorInstance)
      worker.startWorker('CountingActor', 1)

      const pipeline: PipelineDefinition = {
        name: 'instance-reuse-test',
        stages: [
          {
            name: 'process',
            mode: 'scatter',
            actor: 'CountingActor',
            scatter: {
              input: '$.trigger.items',
              as: 'item'
            },
            input: '$.item'
          }
        ]
      }

      const pipelineId = await executor.startPipeline(pipeline, {
        items: ['task1', 'task2', 'task3']
      })
      await executor.waitForCompletion(pipelineId, 5000)

      const state = await stateStore.getPipelineState(pipelineId)
      expect(state?.status).toBe('completed')
      
      // All tasks should use the SAME instance
      expect(instanceIds.size).toBe(1)
      expect(instanceCounter).toBe(1)
    })
  })

  describe('Pattern 3: Factory Function Registration', () => {
    it('should work with factory functions (no context)', async () => {
      const results: string[] = []

      class MockDatabase {
        constructor(public connectionString: string) {}
        async fetch(id: string): Promise<string> {
          return `data-${id}`
        }
      }

      class FactoryActor implements ActorImplementation {
        constructor(private db: MockDatabase) {}

        async execute(input: string): Promise<string> {
          const data = await this.db.fetch(input)
          results.push(data)
          return data
        }
      }

      // Factory function with closure over dependencies
      const database = new MockDatabase('connection-string')
      const actorFactory = () => new FactoryActor(database)

      worker.registerActor('FactoryActor', actorFactory)
      worker.startWorker('FactoryActor', 1)

      const pipeline: PipelineDefinition = {
        name: 'factory-registration-test',
        stages: [
          {
            name: 'process',
            actor: 'FactoryActor',
            input: '$.trigger.id'
          }
        ]
      }

      const pipelineId = await executor.startPipeline(pipeline, { id: 'test-123' })
      await executor.waitForCompletion(pipelineId, 5000)

      const state = await stateStore.getPipelineState(pipelineId)
      expect(state?.status).toBe('completed')
      expect(results).toEqual(['data-test-123'])
    })

    it('should work with factory functions that accept context', async () => {
      const results: any[] = []

      class ContextAwareActor implements ActorImplementation {
        constructor(
          private context: any,
          private dependency: string
        ) {}

        async execute(input: string): Promise<any> {
          const output = {
            input,
            dependency: this.dependency,
            actorId: this.context.actorId,
            actorType: this.context.actorType
          }
          results.push(output)
          return output
        }
      }

      // Factory function that accepts context
      const dependency = 'injected-dependency'
      const actorFactory = (ctx: any) => new ContextAwareActor(ctx, dependency)

      worker.registerActor('ContextAwareActor', actorFactory)
      worker.startWorker('ContextAwareActor', 1)

      const pipeline: PipelineDefinition = {
        name: 'factory-with-context-test',
        stages: [
          {
            name: 'process',
            actor: 'ContextAwareActor',
            input: '$.trigger.value'
          }
        ]
      }

      const pipelineId = await executor.startPipeline(pipeline, { value: 'test-data' })
      await executor.waitForCompletion(pipelineId, 5000)

      const state = await stateStore.getPipelineState(pipelineId)
      expect(state?.status).toBe('completed')
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        input: 'test-data',
        dependency: 'injected-dependency',
        actorType: 'ContextAwareActor'
      })
      expect(results[0].actorId).toContain('ContextAwareActor')
    })

    it('should create a new instance per task with factory functions', async () => {
      const instanceIds = new Set<number>()
      let instanceCounter = 0

      class FactoryCountingActor implements ActorImplementation {
        private id: number

        constructor() {
          this.id = ++instanceCounter
        }

        async execute(input: string): Promise<{ id: number; input: string }> {
          instanceIds.add(this.id)
          return { id: this.id, input }
        }
      }

      // Factory function creates fresh instances
      const actorFactory = () => new FactoryCountingActor()

      worker.registerActor('FactoryCountingActor', actorFactory)
      worker.startWorker('FactoryCountingActor', 1)

      const pipeline: PipelineDefinition = {
        name: 'factory-fresh-instance-test',
        stages: [
          {
            name: 'process',
            mode: 'scatter',
            actor: 'FactoryCountingActor',
            scatter: {
              input: '$.trigger.items',
              as: 'item'
            },
            input: '$.item'
          }
        ]
      }

      const pipelineId = await executor.startPipeline(pipeline, {
        items: ['task1', 'task2', 'task3']
      })
      await executor.waitForCompletion(pipelineId, 5000)

      const state = await stateStore.getPipelineState(pipelineId)
      expect(state?.status).toBe('completed')
      
      // Each task gets a NEW instance
      expect(instanceIds.size).toBe(3)
      expect(instanceCounter).toBe(3)
    })
  })

  describe('Mixed Registration Patterns', () => {
    it('should support all three patterns simultaneously', async () => {
      const results: any[] = []

      // Pattern 1: Class
      class ClassActor implements ActorImplementation {
        async execute(input: string): Promise<string> {
          const result = `class-${input}`
          results.push(result)
          return result
        }
      }

      // Pattern 2: Instance with dependency
      class InstanceActor implements ActorImplementation {
        constructor(private prefix: string) {}
        async execute(input: string): Promise<string> {
          const result = `${this.prefix}-${input}`
          results.push(result)
          return result
        }
      }

      // Pattern 3: Factory
      class FactoryActor implements ActorImplementation {
        constructor(private multiplier: number) {}
        async execute(input: number): Promise<number> {
          const result = input * this.multiplier
          results.push(result)
          return result
        }
      }

      worker.registerActor('ClassActor', ClassActor)
      worker.registerActor('InstanceActor', new InstanceActor('instance'))
      worker.registerActor('FactoryActor', () => new FactoryActor(2))

      worker.startWorker('ClassActor', 1)
      worker.startWorker('InstanceActor', 1)
      worker.startWorker('FactoryActor', 1)

      const pipeline: PipelineDefinition = {
        name: 'mixed-patterns-test',
        stages: [
          {
            name: 'step1',
            actor: 'ClassActor',
            input: '"test"'
          },
          {
            name: 'step2',
            actor: 'InstanceActor',
            input: '"data"'
          },
          {
            name: 'step3',
            actor: 'FactoryActor',
            input: '5'
          }
        ]
      }

      const pipelineId = await executor.startPipeline(pipeline, {})
      await executor.waitForCompletion(pipelineId, 5000)

      const state = await stateStore.getPipelineState(pipelineId)
      expect(state?.status).toBe('completed')
      expect(results).toEqual(['class-test', 'instance-data', 10])
    })
  })
})
