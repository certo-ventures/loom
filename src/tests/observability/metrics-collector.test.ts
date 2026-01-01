/**
 * Tests for enhanced MetricsCollector with custom emit()
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryMetricsCollector } from '../../observability/collector'

describe('MetricsCollector', () => {
  let collector: InMemoryMetricsCollector

  beforeEach(() => {
    collector = new InMemoryMetricsCollector()
  })

  it('should emit custom metrics', () => {
    // Should not throw
    collector.emit('custom.metric', 123, { service: 'test' })
    collector.emit('another.metric', 456)
  })

  it('should emit timing metrics', () => {
    // Should not throw
    collector.timing('operation.duration', 250, { operation: 'test' })
    collector.timing('query.time', 100)
  })

  it('should record actor events', async () => {
    collector.recordActorEvent('created')
    collector.recordActorEvent('activated')
    collector.recordActorEvent('idle')
    collector.recordActorEvent('evicted')

    // Verify through getMetrics
    const metrics = await collector.getMetrics()
    expect(metrics.actorPool.total).toBe(0) // created then evicted = 0
    expect(metrics.actorPool.evicted).toBe(1)
  })

  it('should record message events', async () => {
    collector.recordMessageEvent('sent')
    collector.recordMessageEvent('received')
    collector.recordMessageEvent('completed', 150)
    collector.recordMessageEvent('failed')

    const metrics = await collector.getMetrics()
    expect(metrics.messageQueue).toBeDefined()
    expect(metrics.messageQueue!.completed).toBe(1)
    expect(metrics.messageQueue!.failed).toBe(1)
    expect(metrics.messageQueue!.avgProcessingTimeMs).toBe(150)
  })

  it('should record lock events', async () => {
    collector.recordLockEvent('acquired')
    collector.recordLockEvent('released', 100)
    collector.recordLockEvent('failed')

    const metrics = await collector.getMetrics()
    expect(metrics.locks).toBeDefined()
    expect(metrics.locks!.totalLocksAcquired).toBe(1)
    expect(metrics.locks!.totalLocksReleased).toBe(1)
    expect(metrics.locks!.totalLockFailures).toBe(1)
    expect(metrics.locks!.avgLockDurationMs).toBe(100)
  })

  it('should track multiple actor activations', async () => {
    collector.recordActorEvent('created')
    collector.recordActorEvent('created')
    collector.recordActorEvent('created')
    collector.recordActorEvent('evicted')

    const metrics = await collector.getMetrics()
    expect(metrics.actorPool.total).toBe(2) // 3 created - 1 evicted
    expect(metrics.actorPool.evicted).toBe(1)
  })

  it('should calculate average processing time correctly', async () => {
    collector.recordMessageEvent('completed', 100)
    collector.recordMessageEvent('completed', 200)
    collector.recordMessageEvent('completed', 300)

    const metrics = await collector.getMetrics()
    expect(metrics.messageQueue).toBeDefined()
    expect(metrics.messageQueue!.avgProcessingTimeMs).toBe(200) // (100 + 200 + 300) / 3
  })

  it('should track active locks correctly', async () => {
    collector.recordLockEvent('acquired')
    collector.recordLockEvent('acquired')
    collector.recordLockEvent('released', 50)

    const metrics = await collector.getMetrics()
    expect(metrics.locks).toBeDefined()
    expect(metrics.locks!.activeLocksCount).toBe(1) // 2 acquired - 1 released
  })

  it('should reset all metrics', async () => {
    collector.recordActorEvent('created')
    collector.recordMessageEvent('sent')
    collector.recordLockEvent('acquired')
    collector.emit('custom', 123)

    collector.reset()

    const metrics = await collector.getMetrics()
    expect(metrics.actorPool.total).toBe(0)
    expect(metrics.actorPool.evicted).toBe(0)
    expect(metrics.messageQueue).toBeDefined()
    expect(metrics.messageQueue!.totalProcessed).toBe(0)
    expect(metrics.locks).toBeDefined()
    expect(metrics.locks!.totalLocksAcquired).toBe(0)
  })

  it('should include system metrics', async () => {
    const metrics = await collector.getMetrics()
    
    expect(metrics.system).toMatchObject({
      memoryUsageMB: expect.any(Number),
      uptimeSeconds: expect.any(Number),
    })
    
    expect(metrics.system.memoryUsageMB).toBeGreaterThan(0)
    expect(metrics.system.uptimeSeconds).toBeGreaterThanOrEqual(0)
  })

  it('should return health status', async () => {
    const health = await collector.getHealth()
    
    expect(health).toMatchObject({
      status: 'healthy',
      timestamp: expect.any(String),
      uptime: expect.any(Number),
      components: expect.any(Object),
    })
  })

  it('should track actor pool utilization', async () => {
    const collectorWithLimit = new InMemoryMetricsCollector(100)
    
    for (let i = 0; i < 50; i++) {
      collectorWithLimit.recordActorEvent('created')
    }

    const metrics = await collectorWithLimit.getMetrics()
    expect(metrics.actorPool.utilizationPercent).toBe(50) // 50 / 100 = 50%
  })
})
