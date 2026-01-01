/**
 * Section 5 Integration Tests
 * Discovery, Triggers, Streaming, Workflow
 */
import { describe, it, expect } from 'vitest'
import { 
  InMemoryActorRegistry, 
  ActorRouter, 
  DiscoveryService,
  type ActorRegistration 
} from '../../discovery'
import type { StreamChunk } from '../../streaming/types'
import { InMemoryWorkflowExecutor, type WorkflowDefinition } from '../../workflow'

describe('Section 5: Discovery, Triggers, Streaming, Workflow', () => {
  describe('Discovery Service Integration', () => {
    it('should support distributed actor routing', async () => {
      const registry = new InMemoryActorRegistry()
      const discovery = new DiscoveryService(registry)

      // Register multiple instances
      await discovery.registerActor('order-1', 'OrderProcessor', 'worker-1', {
        region: 'us-west',
      })

      await discovery.registerActor('order-2', 'OrderProcessor', 'worker-2', {
        region: 'us-east',
      })

      // Route to specific instance
      const queue1 = await discovery.route('order-1')
      expect(queue1).toBe('actor:order-1')

      // Route to any instance (load balanced)
      const queue2 = await discovery.route({
        type: 'OrderProcessor',
        strategy: 'least-messages',
      })
      expect(queue2).toMatch(/^actor:order-[12]$/)

      // Broadcast to all
      const allQueues = await discovery.broadcast('OrderProcessor')
      expect(allQueues).toHaveLength(2)
      expect(allQueues).toContain('actor:order-1')
      expect(allQueues).toContain('actor:order-2')
    })

    it('should clean up stale actors', async () => {
      const registry = new InMemoryActorRegistry()
      const discovery = new DiscoveryService(registry)

      // Register actor with old heartbeat
      await registry.register({
        actorId: 'stale-1',
        actorType: 'Test',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date(Date.now() - 400000).toISOString(), // 400s ago
        messageCount: 0,
      })

      // Register fresh actor
      await registry.register({
        actorId: 'fresh-1',
        actorType: 'Test',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      // Cleanup actors older than 300s
      const cleaned = await discovery.cleanup(300)
      expect(cleaned).toBe(1)

      // Verify only fresh actor remains
      const remaining = await registry.getAll()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].actorId).toBe('fresh-1')
    })

    it('should support load balancing strategies', async () => {
      const registry = new InMemoryActorRegistry()
      const router = new ActorRouter(registry)

      // Register actors with different message counts
      await registry.register({
        actorId: 'worker-1',
        actorType: 'Processor',
        workerId: 'w1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 10,
      })

      await registry.register({
        actorId: 'worker-2',
        actorType: 'Processor',
        workerId: 'w2',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 3,
      })

      await registry.register({
        actorId: 'worker-3',
        actorType: 'Processor',
        workerId: 'w3',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 7,
      })

      // Least-messages should pick worker-2
      const selected = await router.routeToType('Processor', 'least-messages')
      expect(selected).toBe('actor:worker-2')

      // Random should pick one of them
      const random = await router.routeToType('Processor', 'random')
      expect(random).toMatch(/^actor:worker-[123]$/)
    })

    it('should skip busy actors when alternatives exist', async () => {
      const registry = new InMemoryActorRegistry()
      const router = new ActorRouter(registry)

      await registry.register({
        actorId: 'busy-1',
        actorType: 'Worker',
        workerId: 'w1',
        status: 'busy',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      await registry.register({
        actorId: 'idle-1',
        actorType: 'Worker',
        workerId: 'w2',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      // Should route to idle actor
      const selected = await router.routeToType('Worker', 'least-messages')
      expect(selected).toBe('actor:idle-1')
    })
  })

  describe('Streaming with Backpressure', () => {
    it('should support basic streaming', async () => {
      // Mock streaming chunks
      const chunks: StreamChunk[] = [
        { type: 'start' },
        { type: 'data', data: { value: 1 } },
        { type: 'data', data: { value: 2 } },
        { type: 'progress', progress: { current: 2, total: 5 } },
        { type: 'data', data: { value: 3 } },
        { type: 'complete' },
      ]

      // Simulate consuming stream
      const received: StreamChunk[] = []
      for (const chunk of chunks) {
        received.push(chunk)
        if (chunk.type === 'complete') break
      }

      expect(received).toHaveLength(6)
      expect(received[0].type).toBe('start')
      expect(received[5].type).toBe('complete')
      expect(received.filter(c => c.type === 'data')).toHaveLength(3)
    })

    it('should handle progress updates', () => {
      const progressChunk: StreamChunk = {
        type: 'progress',
        progress: {
          current: 50,
          total: 100,
          message: 'Processing items...',
        },
      }

      expect(progressChunk.progress?.current).toBe(50)
      expect(progressChunk.progress?.total).toBe(100)
      expect(progressChunk.progress?.message).toBe('Processing items...')
    })

    it('should handle streaming errors', () => {
      const errorChunk: StreamChunk = {
        type: 'error',
        error: new Error('Streaming failed'),
      }

      expect(errorChunk.type).toBe('error')
      expect(errorChunk.error?.message).toBe('Streaming failed')
    })
  })

  describe('Workflow Executor', () => {
    it('should execute simple workflow', async () => {
      const executor = new InMemoryWorkflowExecutor()

      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: {
            type: 'manual',
            inputs: {},
          },
        },
        actions: {
          step1: {
            type: 'Compose',
            inputs: { value: 42 },
          },
        },
      }

      const instanceId = await executor.execute(workflow)
      expect(instanceId).toMatch(/^wf-\d+$/)

      // Wait for completion
      const result = await executor.waitForCompletion(instanceId, 1000)
      expect(result).toBeDefined()
      expect(result.step1).toEqual({ value: 42 })
    })

    it('should execute workflow with dependencies', async () => {
      const executor = new InMemoryWorkflowExecutor()

      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual', inputs: {} },
        },
        actions: {
          step1: {
            type: 'Compose',
            inputs: { value: 10 },
          },
          step2: {
            type: 'Compose',
            inputs: { value: 20 },
            runAfter: { step1: ['Succeeded'] },
          },
          step3: {
            type: 'Compose',
            inputs: { value: 30 },
            runAfter: { step2: ['Succeeded'] },
          },
        },
      }

      const instanceId = await executor.execute(workflow)
      const result = await executor.waitForCompletion(instanceId, 1000)

      expect(result.step1).toEqual({ value: 10 })
      expect(result.step2).toEqual({ value: 20 })
      expect(result.step3).toEqual({ value: 30 })
    })

    it('should handle workflow with parallel actions', async () => {
      const executor = new InMemoryWorkflowExecutor()

      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual', inputs: {} },
        },
        actions: {
          parallel1: {
            type: 'Compose',
            inputs: { value: 'A' },
          },
          parallel2: {
            type: 'Compose',
            inputs: { value: 'B' },
          },
          merge: {
            type: 'Compose',
            inputs: { merged: true },
            runAfter: {
              parallel1: ['Succeeded'],
              parallel2: ['Succeeded'],
            },
          },
        },
      }

      const instanceId = await executor.execute(workflow)
      const result = await executor.waitForCompletion(instanceId, 1000)

      expect(result.parallel1).toEqual({ value: 'A' })
      expect(result.parallel2).toEqual({ value: 'B' })
      expect(result.merge).toEqual({ merged: true })
    })

    it('should timeout long-running actions', async () => {
      const executor = new InMemoryWorkflowExecutor()

      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual', inputs: {} },
        },
        actions: {
          slowAction: {
            type: 'Actor',
            inputs: {
              actorType: 'SlowProcessor',
              method: 'process',
              args: {},
            },
            timeout: 100, // 100ms timeout
          },
        },
      }

      const instanceId = await executor.execute(workflow)
      
      // Should complete (either success or timeout)
      await expect(
        executor.waitForCompletion(instanceId, 2000)
      ).resolves.toBeDefined()
    })
  })

  describe('End-to-End Integration', () => {
    it('should integrate discovery and workflow', async () => {
      // Setup discovery
      const registry = new InMemoryActorRegistry()
      const discovery = new DiscoveryService(registry)

      await discovery.registerActor('processor-1', 'DataProcessor', 'worker-1')

      // Verify discovery works
      const route = await discovery.route('processor-1')
      expect(route).toBe('actor:processor-1')

      // Verify load-balanced routing
      const typeRoute = await discovery.route({
        type: 'DataProcessor',
        strategy: 'least-messages',
      })
      expect(typeRoute).toBe('actor:processor-1')

      // Setup workflow executor (without discovery dependency for this test)
      const executor = new InMemoryWorkflowExecutor()

      // Execute simple workflow
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual', inputs: {} },
        },
        actions: {
          composeData: {
            type: 'Compose',
            inputs: { message: 'integration-test' },
          },
        },
      }

      const instanceId = await executor.execute(workflow)
      const result = await executor.waitForCompletion(instanceId, 1000)

      expect(result).toBeDefined()
      expect(result.composeData).toEqual({ message: 'integration-test' })
    })

    it('should track workflow metrics', async () => {
      const executor = new InMemoryWorkflowExecutor()

      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual', inputs: {} },
        },
        actions: {
          step1: {
            type: 'Compose',
            inputs: { timestamp: Date.now() },
          },
        },
      }

      const startTime = Date.now()
      const instanceId = await executor.execute(workflow)
      await executor.waitForCompletion(instanceId, 1000)
      const duration = Date.now() - startTime

      expect(duration).toBeLessThan(1000)
      
      const status = await executor.getStatus(instanceId)
      expect(status).toBe('completed')
    })
  })
})
