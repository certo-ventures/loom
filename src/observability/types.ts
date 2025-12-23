/**
 * Health check and monitoring types
 */

/**
 * Overall health status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

/**
 * Component health check result
 */
export interface ComponentHealth {
  status: HealthStatus
  message?: string
  lastCheck: string
  responseTimeMs?: number
}

/**
 * Complete health check response
 */
export interface HealthCheckResponse {
  status: HealthStatus
  timestamp: string
  uptime: number
  version?: string
  components: {
    messageAdapter?: ComponentHealth
    stateAdapter?: ComponentHealth
    coordinationAdapter?: ComponentHealth
    tracing?: ComponentHealth
  }
}

/**
 * Actor pool statistics
 */
export interface ActorPoolStats {
  total: number
  active: number
  idle: number
  evicted: number
  maxSize: number
  utilizationPercent: number
}

/**
 * Message queue statistics
 */
export interface MessageQueueStats {
  pending: number
  processing: number
  completed: number
  failed: number
  delayed: number
  totalProcessed: number
  avgProcessingTimeMs: number
}

/**
 * Lock statistics
 */
export interface LockStats {
  activeLocksCount: number
  totalLocksAcquired: number
  totalLocksReleased: number
  totalLockFailures: number
  avgLockDurationMs: number
}

/**
 * Trace statistics
 */
export interface TraceStats {
  totalTraces: number
  completedTraces: number
  failedTraces: number
  runningTraces: number
  avgDurationMs: number
  totalEvents: number
}

/**
 * Complete metrics response
 */
export interface MetricsResponse {
  timestamp: string
  actorPool: ActorPoolStats
  messageQueue?: MessageQueueStats
  locks?: LockStats
  tracing?: TraceStats
  system: {
    memoryUsageMB: number
    cpuUsagePercent?: number
    uptimeSeconds: number
  }
}

/**
 * Metrics collector interface
 */
export interface MetricsCollector {
  /**
   * Get current health status
   */
  getHealth(): Promise<HealthCheckResponse>
  
  /**
   * Get current metrics
   */
  getMetrics(): Promise<MetricsResponse>
  
  /**
   * Record an actor event
   */
  recordActorEvent(event: 'created' | 'evicted' | 'activated' | 'idle'): void
  
  /**
   * Record a message event
   */
  recordMessageEvent(event: 'sent' | 'received' | 'completed' | 'failed', durationMs?: number): void
  
  /**
   * Record a lock event
   */
  recordLockEvent(event: 'acquired' | 'released' | 'failed', durationMs?: number): void
}
