import { describe, it, expect, beforeEach } from 'vitest'
import { BaseService, ServiceLifecycle, type HealthStatus, type ServiceMetrics } from '../../services/service'

/**
 * Test service implementation
 */
class TestService extends BaseService {
  private shouldFailStart = false
  private shouldFailStop = false
  private shouldBeUnhealthy = false
  
  constructor(name: string = 'test-service') {
    super(name)
  }
  
  setFailStart(fail: boolean): void {
    this.shouldFailStart = fail
  }
  
  setFailStop(fail: boolean): void {
    this.shouldFailStop = fail
  }
  
  setUnhealthy(unhealthy: boolean): void {
    this.shouldBeUnhealthy = unhealthy
  }
  
  protected async onStart(): Promise<void> {
    if (this.shouldFailStart) {
      throw new Error('Start failed')
    }
    // Simulate async startup
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  
  protected async onStop(): Promise<void> {
    if (this.shouldFailStop) {
      throw new Error('Stop failed')
    }
    // Simulate async shutdown
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  
  protected async onHealthCheck(): Promise<HealthStatus> {
    return {
      status: this.shouldBeUnhealthy ? 'unhealthy' : 'healthy',
      message: this.shouldBeUnhealthy ? 'Service is unhealthy' : 'Service is healthy',
      timestamp: Date.now()
    }
  }
  
  protected async onGetMetrics(): Promise<ServiceMetrics> {
    return {
      customMetric: 42,
      requestCount: 100
    }
  }
}

describe('Service Interface', () => {
  let service: TestService
  
  beforeEach(() => {
    service = new TestService()
  })
  
  describe('Lifecycle', () => {
    it('should start with INITIAL state', () => {
      expect(service.state).toBe(ServiceLifecycle.INITIAL)
    })
    
    it('should transition to RUNNING when started', async () => {
      await service.start()
      expect(service.state).toBe(ServiceLifecycle.RUNNING)
    })
    
    it('should be idempotent when starting already running service', async () => {
      await service.start()
      await service.start() // Should not throw
      expect(service.state).toBe(ServiceLifecycle.RUNNING)
    })
    
    it('should transition to STOPPED when stopped', async () => {
      await service.start()
      await service.stop()
      expect(service.state).toBe(ServiceLifecycle.STOPPED)
    })
    
    it('should be idempotent when stopping already stopped service', async () => {
      await service.start()
      await service.stop()
      await service.stop() // Should not throw
      expect(service.state).toBe(ServiceLifecycle.STOPPED)
    })
    
    it('should transition to ERROR on start failure', async () => {
      service.setFailStart(true)
      await expect(service.start()).rejects.toThrow('Start failed')
      expect(service.state).toBe(ServiceLifecycle.ERROR)
    })
    
    it('should transition to ERROR on stop failure', async () => {
      await service.start()
      service.setFailStop(true)
      await expect(service.stop()).rejects.toThrow('Stop failed')
      expect(service.state).toBe(ServiceLifecycle.ERROR)
    })
  })
  
  describe('Health Checks', () => {
    it('should be unhealthy when not running', async () => {
      const healthy = await service.isHealthy()
      expect(healthy).toBe(false)
    })
    
    it('should be healthy when running', async () => {
      await service.start()
      const healthy = await service.isHealthy()
      expect(healthy).toBe(true)
    })
    
    it('should return detailed health status', async () => {
      await service.start()
      const status = await service.getHealthStatus()
      
      expect(status.status).toBe('healthy')
      expect(status.message).toBe('Service is healthy')
      expect(status.timestamp).toBeGreaterThan(0)
    })
    
    it('should report unhealthy when service reports unhealthy', async () => {
      await service.start()
      service.setUnhealthy(true)
      
      const healthy = await service.isHealthy()
      expect(healthy).toBe(false)
      
      const status = await service.getHealthStatus()
      expect(status.status).toBe('unhealthy')
    })
    
    it('should report unhealthy state in health status', async () => {
      const status = await service.getHealthStatus()
      expect(status.status).toBe('unhealthy')
      expect(status.message).toContain('not running')
    })
  })
  
  describe('Metrics', () => {
    it('should include base metrics', async () => {
      await service.start()
      const metrics = await service.getMetrics()
      
      expect(metrics.uptime).toBeGreaterThanOrEqual(0)
      expect(metrics.errorCount).toBe(0)
      expect(metrics.state).toBe(ServiceLifecycle.RUNNING)
    })
    
    it('should include custom metrics', async () => {
      await service.start()
      const metrics = await service.getMetrics()
      
      expect(metrics.customMetric).toBe(42)
      expect(metrics.requestCount).toBe(100)
    })
    
    it('should track uptime', async () => {
      await service.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      const metrics = await service.getMetrics()
      
      expect(metrics.uptime).toBeGreaterThanOrEqual(50)
    })
    
    it('should track error count', async () => {
      service.setFailStart(true)
      await expect(service.start()).rejects.toThrow()
      
      const metrics = await service.getMetrics()
      expect(metrics.errorCount).toBe(1)
    })
  })
  
  describe('Service Name', () => {
    it('should have a name', () => {
      expect(service.name).toBe('test-service')
    })
    
    it('should accept custom name', () => {
      const customService = new TestService('custom-name')
      expect(customService.name).toBe('custom-name')
    })
  })
})
