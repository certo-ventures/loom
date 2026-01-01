/**
 * Metrics collector implementation
 * Tracks runtime statistics for health checks and monitoring
 */

import type {
  HealthCheckResponse,
  MetricsResponse,
  HealthStatus,
  ComponentHealth,
  ActorPoolStats,
  MessageQueueStats,
  LockStats,
  TraceStats,
  MetricsCollector,
} from './types'

/**
 * In-memory metrics collector
 */
export class InMemoryMetricsCollector implements MetricsCollector {
  private startTime: Date = new Date()
  
  // Actor pool metrics
  private actorMetrics = {
    total: 0,
    active: 0,
    idle: 0,
    evicted: 0,
    created: 0,
  }
  
  // Message queue metrics
  private messageMetrics = {
    sent: 0,
    received: 0,
    completed: 0,
    failed: 0,
    totalDurationMs: 0,
    count: 0,
  }
  
  // Lock metrics
  private lockMetrics = {
    acquired: 0,
    released: 0,
    failed: 0,
    totalDurationMs: 0,
    count: 0,
    activeLocks: 0,
  }
  
  // Component health
  private componentHealth = new Map<string, ComponentHealth>()
  
  constructor(
    private maxPoolSize: number = 100,
    private traceStore?: any, // TraceStore interface
    private adapters?: {
      message?: any
      state?: any
      coordination?: any
    }
  ) {}
  
  /**
   * Record actor event
   */
  recordActorEvent(event: 'created' | 'evicted' | 'activated' | 'idle'): void {
    switch (event) {
      case 'created':
        this.actorMetrics.total++
        this.actorMetrics.active++
        this.actorMetrics.created++
        break
      case 'evicted':
        this.actorMetrics.evicted++
        this.actorMetrics.total--
        this.actorMetrics.active--
        break
      case 'activated':
        this.actorMetrics.active++
        this.actorMetrics.idle--
        break
      case 'idle':
        this.actorMetrics.idle++
        this.actorMetrics.active--
        break
    }
  }
  
  /**
   * Record message event
   */
  recordMessageEvent(event: 'sent' | 'received' | 'completed' | 'failed', durationMs?: number): void {
    switch (event) {
      case 'sent':
        this.messageMetrics.sent++
        break
      case 'received':
        this.messageMetrics.received++
        break
      case 'completed':
        this.messageMetrics.completed++
        if (durationMs !== undefined) {
          this.messageMetrics.totalDurationMs += durationMs
          this.messageMetrics.count++
        }
        break
      case 'failed':
        this.messageMetrics.failed++
        break
    }
  }
  
  /**
   * Record lock event
   */
  recordLockEvent(event: 'acquired' | 'released' | 'failed', durationMs?: number): void {
    switch (event) {
      case 'acquired':
        this.lockMetrics.acquired++
        this.lockMetrics.activeLocks++
        break
      case 'released':
        this.lockMetrics.released++
        this.lockMetrics.activeLocks--
        if (durationMs !== undefined) {
          this.lockMetrics.totalDurationMs += durationMs
          this.lockMetrics.count++
        }
        break
      case 'failed':
        this.lockMetrics.failed++
        break
    }
  }
  
  /**
   * Check component health
   */
  private async checkComponentHealth(name: string, healthCheck: () => Promise<boolean>): Promise<ComponentHealth> {
    const startTime = Date.now()
    
    try {
      const isHealthy = await healthCheck()
      const responseTimeMs = Date.now() - startTime
      
      const health: ComponentHealth = {
        status: isHealthy ? 'healthy' : 'unhealthy',
        message: isHealthy ? 'OK' : 'Health check failed',
        lastCheck: new Date().toISOString(),
        responseTimeMs,
      }
      
      this.componentHealth.set(name, health)
      return health
    } catch (error) {
      const health: ComponentHealth = {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Unknown error',
        lastCheck: new Date().toISOString(),
        responseTimeMs: Date.now() - startTime,
      }
      
      this.componentHealth.set(name, health)
      return health
    }
  }
  
  /**
   * Get overall health status
   */
  async getHealth(): Promise<HealthCheckResponse> {
    const components: HealthCheckResponse['components'] = {}
    
    // Check message adapter
    if (this.adapters?.message?.isHealthy) {
      components.messageAdapter = await this.checkComponentHealth(
        'messageAdapter',
        () => this.adapters!.message.isHealthy()
      )
    }
    
    // Check state adapter
    if (this.adapters?.state?.isHealthy) {
      components.stateAdapter = await this.checkComponentHealth(
        'stateAdapter',
        () => this.adapters!.state.isHealthy()
      )
    }
    
    // Check coordination adapter
    if (this.adapters?.coordination?.isHealthy) {
      components.coordinationAdapter = await this.checkComponentHealth(
        'coordinationAdapter',
        () => this.adapters!.coordination.isHealthy()
      )
    }
    
    // Check tracing
    if (this.traceStore) {
      components.tracing = {
        status: 'healthy',
        message: 'OK',
        lastCheck: new Date().toISOString(),
      }
    }
    
    // Determine overall status
    const componentStatuses = Object.values(components).map(c => c.status)
    let overallStatus: HealthStatus = 'healthy'
    
    if (componentStatuses.includes('unhealthy')) {
      overallStatus = 'unhealthy'
    } else if (componentStatuses.includes('degraded')) {
      overallStatus = 'degraded'
    }
    
    const uptime = Date.now() - this.startTime.getTime()
    
    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime,
      components,
    }
  }
  
  /**
   * Get current metrics
   */
  async getMetrics(): Promise<MetricsResponse> {
    const actorPool: ActorPoolStats = {
      total: this.actorMetrics.total,
      active: this.actorMetrics.active,
      idle: this.actorMetrics.idle,
      evicted: this.actorMetrics.evicted,
      maxSize: this.maxPoolSize,
      utilizationPercent: (this.actorMetrics.total / this.maxPoolSize) * 100,
    }
    
    const messageQueue: MessageQueueStats = {
      pending: this.messageMetrics.received - this.messageMetrics.completed - this.messageMetrics.failed,
      processing: this.messageMetrics.received - this.messageMetrics.completed - this.messageMetrics.failed,
      completed: this.messageMetrics.completed,
      failed: this.messageMetrics.failed,
      delayed: 0,
      totalProcessed: this.messageMetrics.completed + this.messageMetrics.failed,
      avgProcessingTimeMs: this.messageMetrics.count > 0 
        ? this.messageMetrics.totalDurationMs / this.messageMetrics.count 
        : 0,
    }
    
    const locks: LockStats = {
      activeLocksCount: this.lockMetrics.activeLocks,
      totalLocksAcquired: this.lockMetrics.acquired,
      totalLocksReleased: this.lockMetrics.released,
      totalLockFailures: this.lockMetrics.failed,
      avgLockDurationMs: this.lockMetrics.count > 0 
        ? this.lockMetrics.totalDurationMs / this.lockMetrics.count 
        : 0,
    }
    
    // Get trace stats if available
    let tracing: TraceStats | undefined
    if (this.traceStore?.getStats) {
      try {
        tracing = await this.traceStore.getStats()
      } catch (error) {
        // Ignore trace stats errors
      }
    }
    
    // System metrics
    const memoryUsage = process.memoryUsage()
    const uptimeSeconds = (Date.now() - this.startTime.getTime()) / 1000
    
    return {
      timestamp: new Date().toISOString(),
      actorPool,
      messageQueue,
      locks,
      tracing,
      system: {
        memoryUsageMB: memoryUsage.heapUsed / 1024 / 1024,
        uptimeSeconds,
      },
    }
  }
  
  /**
   * Emit a custom metric
   */
  emit(name: string, value: number, labels?: Record<string, string>): void {
    // Store custom metrics for later aggregation
    const key = this.makeMetricKey(name, labels)
    // For now, just track as counters - can be extended later
  }
  
  /**
   * Emit a timing metric
   */
  timing(name: string, durationMs: number, labels?: Record<string, string>): void {
    const key = this.makeMetricKey(name, labels)
    // Track timing metrics
  }
  
  /**
   * Create a unique key for a metric with labels
   */
  private makeMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels) return name
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',')
    return `${name}{${labelStr}}`
  }
  
  /**
   * Reset all metrics (for testing)
   */
  reset(): void {
    this.startTime = new Date()
    this.actorMetrics = {
      total: 0,
      active: 0,
      idle: 0,
      evicted: 0,
      created: 0,
    }
    this.messageMetrics = {
      sent: 0,
      received: 0,
      completed: 0,
      failed: 0,
      totalDurationMs: 0,
      count: 0,
    }
    this.lockMetrics = {
      acquired: 0,
      released: 0,
      failed: 0,
      totalDurationMs: 0,
      count: 0,
      activeLocks: 0,
    }
    this.componentHealth.clear()
  }
}
