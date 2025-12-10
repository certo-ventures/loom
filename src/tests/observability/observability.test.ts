import { describe, it, expect, beforeEach } from 'vitest'
import { Observability } from '../../observability'

describe('Observability', () => {
  let obs: Observability

  beforeEach(() => {
    obs = Observability.getInstance({ level: 'silent' }) // Silent for tests
    obs.getMetrics().reset()
  })

  describe('Metrics', () => {
    it('should increment counters', () => {
      obs.metrics.increment('test.counter', 1)
      obs.metrics.increment('test.counter', 2)

      expect(obs.getMetrics().getCounter('test.counter')).toBe(3)
    })

    it('should set gauges', () => {
      obs.metrics.gauge('test.gauge', 42)
      expect(obs.getMetrics().getGauge('test.gauge')).toBe(42)

      obs.metrics.gauge('test.gauge', 100)
      expect(obs.getMetrics().getGauge('test.gauge')).toBe(100)
    })

    it('should track timings', () => {
      obs.metrics.timing('test.duration', 123)
      obs.metrics.timing('test.duration', 456)

      expect(obs.getMetrics().getCounter('test.duration')).toBe(579)
    })

    it('should support labels', () => {
      obs.metrics.increment('requests', 1, { status: '200' })
      obs.metrics.increment('requests', 1, { status: '500' })
      obs.metrics.increment('requests', 1, { status: '200' })

      expect(obs.getMetrics().getCounter('requests', { status: '200' })).toBe(2)
      expect(obs.getMetrics().getCounter('requests', { status: '500' })).toBe(1)
    })
  })

  describe('Logger', () => {
    it('should create child logger with context', () => {
      const childLogger = obs.createChildLogger({
        actorId: 'actor-123',
        correlationId: 'corr-456',
      })

      expect(childLogger).toBeDefined()
      // Logger has bindings property with the context
      expect((childLogger as any).bindings()).toHaveProperty('actorId', 'actor-123')
    })
  })

  describe('measureAsync', () => {
    it('should measure operation duration', async () => {
      const result = await obs.measureAsync(
        'test.operation',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return 'success'
        }
      )

      expect(result).toBe('success')
      
      const duration = obs.getMetrics().getCounter('test.operation')
      expect(duration).toBeGreaterThanOrEqual(40) // Allow some variance
      expect(duration).toBeLessThan(200)
    })

    it('should measure duration even on error', async () => {
      try {
        await obs.measureAsync('test.error', async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          throw new Error('Test error')
        })
      } catch (error) {
        // Expected
      }

      const duration = obs.getMetrics().getCounter('test.error', { status: 'error' })
      expect(duration).toBeGreaterThanOrEqual(40)
    })

    it('should support labels', async () => {
      await obs.measureAsync(
        'api.request',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return 'ok'
        },
        { endpoint: '/users', method: 'GET' }
      )

      const duration = obs.getMetrics().getCounter('api.request', {
        endpoint: '/users',
        method: 'GET',
      })
      expect(duration).toBeGreaterThanOrEqual(40)
    })
  })
})
