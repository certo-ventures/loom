import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryActorRegistry,
  ActorRouter,
  DiscoveryService,
  type ActorRegistration,
} from '../../discovery'

describe('Service Discovery', () => {
  describe('InMemoryActorRegistry', () => {
    let registry: InMemoryActorRegistry

    beforeEach(() => {
      registry = new InMemoryActorRegistry()
    })

    it('should register and retrieve actors', async () => {
      const registration: ActorRegistration = {
        actorId: 'actor-1',
        actorType: 'OrderProcessor',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      }

      await registry.register(registration)
      const retrieved = await registry.get('actor-1')

      expect(retrieved).toBeDefined()
      expect(retrieved!.actorId).toBe('actor-1')
      expect(retrieved!.actorType).toBe('OrderProcessor')
      expect(retrieved!.workerId).toBe('worker-1')
    })

    it('should unregister actors', async () => {
      await registry.register({
        actorId: 'actor-1',
        actorType: 'Test',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      await registry.unregister('actor-1')
      const retrieved = await registry.get('actor-1')

      expect(retrieved).toBeUndefined()
    })

    it('should get actors by type', async () => {
      await registry.register({
        actorId: 'order-1',
        actorType: 'OrderProcessor',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      await registry.register({
        actorId: 'order-2',
        actorType: 'OrderProcessor',
        workerId: 'worker-2',
        status: 'active',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 5,
      })

      await registry.register({
        actorId: 'payment-1',
        actorType: 'PaymentProcessor',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      const orderProcessors = await registry.getByType('OrderProcessor')
      expect(orderProcessors).toHaveLength(2)
      expect(orderProcessors.map(r => r.actorId)).toContain('order-1')
      expect(orderProcessors.map(r => r.actorId)).toContain('order-2')
    })

    it('should update heartbeat', async () => {
      const originalTime = new Date('2025-01-01T00:00:00Z').toISOString()
      
      await registry.register({
        actorId: 'actor-1',
        actorType: 'Test',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: originalTime,
        messageCount: 0,
      })

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10))
      
      await registry.heartbeat('actor-1')
      const updated = await registry.get('actor-1')

      expect(updated!.lastHeartbeat).not.toBe(originalTime)
      expect(new Date(updated!.lastHeartbeat).getTime()).toBeGreaterThan(
        new Date(originalTime).getTime()
      )
    })

    it('should update status', async () => {
      await registry.register({
        actorId: 'actor-1',
        actorType: 'Test',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      await registry.updateStatus('actor-1', 'busy')
      const updated = await registry.get('actor-1')

      expect(updated!.status).toBe('busy')
    })

    it('should increment message count', async () => {
      await registry.register({
        actorId: 'actor-1',
        actorType: 'Test',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      await registry.incrementMessageCount('actor-1')
      await registry.incrementMessageCount('actor-1')
      await registry.incrementMessageCount('actor-1')

      const updated = await registry.get('actor-1')
      expect(updated!.messageCount).toBe(3)
    })

    it('should cleanup stale registrations', async () => {
      const oldTime = new Date(Date.now() - 400000).toISOString() // 400 seconds ago
      const recentTime = new Date().toISOString()

      await registry.register({
        actorId: 'stale-1',
        actorType: 'Test',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: oldTime,
        messageCount: 0,
      })

      await registry.register({
        actorId: 'active-1',
        actorType: 'Test',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: recentTime,
        messageCount: 0,
      })

      // Cleanup actors older than 300 seconds (5 minutes)
      const cleaned = await registry.cleanup(300000)

      expect(cleaned).toBe(1)
      expect(await registry.get('stale-1')).toBeUndefined()
      expect(await registry.get('active-1')).toBeDefined()
    })
  })

  describe('ActorRouter', () => {
    let registry: InMemoryActorRegistry
    let router: ActorRouter

    beforeEach(() => {
      registry = new InMemoryActorRegistry()
      router = new ActorRouter(registry)
    })

    it('should route to specific actor', async () => {
      await registry.register({
        actorId: 'actor-1',
        actorType: 'Test',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      const queue = await router.routeToActor('actor-1')
      expect(queue).toBe('actor:actor-1')

      // Should increment message count
      const updated = await registry.get('actor-1')
      expect(updated!.messageCount).toBe(1)
    })

    it('should return undefined for unknown actor', async () => {
      const queue = await router.routeToActor('unknown')
      expect(queue).toBeUndefined()
    })

    it('should route to type with least-messages strategy', async () => {
      await registry.register({
        actorId: 'order-1',
        actorType: 'OrderProcessor',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 10,
      })

      await registry.register({
        actorId: 'order-2',
        actorType: 'OrderProcessor',
        workerId: 'worker-2',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 3,
      })

      await registry.register({
        actorId: 'order-3',
        actorType: 'OrderProcessor',
        workerId: 'worker-3',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 7,
      })

      const queue = await router.routeToType('OrderProcessor', 'least-messages')
      
      // Should pick order-2 (3 messages)
      expect(queue).toBe('actor:order-2')
    })

    it('should route to type with random strategy', async () => {
      await registry.register({
        actorId: 'order-1',
        actorType: 'OrderProcessor',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      await registry.register({
        actorId: 'order-2',
        actorType: 'OrderProcessor',
        workerId: 'worker-2',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      const queue = await router.routeToType('OrderProcessor', 'random')
      
      // Should pick one of them
      expect(queue).toMatch(/^actor:order-[12]$/)
    })

    it('should skip busy actors if others available', async () => {
      await registry.register({
        actorId: 'order-1',
        actorType: 'OrderProcessor',
        workerId: 'worker-1',
        status: 'busy',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      await registry.register({
        actorId: 'order-2',
        actorType: 'OrderProcessor',
        workerId: 'worker-2',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      const queue = await router.routeToType('OrderProcessor', 'least-messages')
      
      // Should pick order-2 (not busy)
      expect(queue).toBe('actor:order-2')
    })

    it('should return undefined if no actors of type', async () => {
      const queue = await router.routeToType('NonExistent')
      expect(queue).toBeUndefined()
    })

    it('should get all actors of type for broadcast', async () => {
      await registry.register({
        actorId: 'notifier-1',
        actorType: 'Notifier',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      await registry.register({
        actorId: 'notifier-2',
        actorType: 'Notifier',
        workerId: 'worker-2',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      await registry.register({
        actorId: 'processor-1',
        actorType: 'Processor',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      const queues = await router.getAllOfType('Notifier')
      
      expect(queues).toHaveLength(2)
      expect(queues).toContain('actor:notifier-1')
      expect(queues).toContain('actor:notifier-2')
    })

    it('should check actor availability', async () => {
      await registry.register({
        actorId: 'actor-1',
        actorType: 'Test',
        workerId: 'worker-1',
        status: 'idle',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      await registry.register({
        actorId: 'actor-2',
        actorType: 'Test',
        workerId: 'worker-1',
        status: 'busy',
        lastHeartbeat: new Date().toISOString(),
        messageCount: 0,
      })

      expect(await router.isAvailable('actor-1')).toBe(true)
      expect(await router.isAvailable('actor-2')).toBe(false)
      expect(await router.isAvailable('unknown')).toBe(false)
    })
  })

  describe('DiscoveryService', () => {
    let service: DiscoveryService

    beforeEach(() => {
      service = new DiscoveryService()
    })

    it('should register actors with simple API', async () => {
      await service.registerActor('actor-1', 'OrderProcessor', 'worker-1', {
        region: 'us-west',
      })

      const registration = await service.registry.get('actor-1')
      expect(registration).toBeDefined()
      expect(registration!.actorType).toBe('OrderProcessor')
      expect(registration!.metadata?.region).toBe('us-west')
    })

    it('should route by actor ID', async () => {
      await service.registerActor('actor-1', 'Test', 'worker-1')

      const queue = await service.route('actor-1')
      expect(queue).toBe('actor:actor-1')
    })

    it('should route by type with strategy', async () => {
      await service.registerActor('order-1', 'OrderProcessor', 'worker-1')
      await service.registerActor('order-2', 'OrderProcessor', 'worker-2')

      const queue = await service.route({
        type: 'OrderProcessor',
        strategy: 'round-robin',
      })

      expect(queue).toMatch(/^actor:order-[12]$/)
    })

    it('should broadcast to all of type', async () => {
      await service.registerActor('notifier-1', 'Notifier', 'worker-1')
      await service.registerActor('notifier-2', 'Notifier', 'worker-2')
      await service.registerActor('processor-1', 'Processor', 'worker-1')

      const queues = await service.broadcast('Notifier')
      
      expect(queues).toHaveLength(2)
      expect(queues).toContain('actor:notifier-1')
      expect(queues).toContain('actor:notifier-2')
    })

    it('should cleanup stale actors', async () => {
      await service.registerActor('actor-1', 'Test', 'worker-1')
      
      // Manually set old heartbeat
      const registration = await service.registry.get('actor-1')
      if (registration) {
        registration.lastHeartbeat = new Date(Date.now() - 400000).toISOString()
      }

      const cleaned = await service.cleanup(300) // 300 seconds = 5 minutes
      
      expect(cleaned).toBe(1)
      expect(await service.registry.get('actor-1')).toBeUndefined()
    })
  })
})
