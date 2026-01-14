/**
 * Service Interface - Base contract for all Loom services
 * 
 * All infrastructure services (LoomMesh, Redis, etc.) implement this interface
 * for consistent lifecycle management.
 */

/**
 * Service lifecycle states
 */
export enum ServiceLifecycle {
  INITIAL = 'initial',
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error'
}

/**
 * Health status for a service
 */
export interface HealthStatus {
  /**
   * Overall health state
   */
  status: 'healthy' | 'degraded' | 'unhealthy'
  
  /**
   * Human-readable message
   */
  message?: string
  
  /**
   * Detailed health information
   */
  details?: Record<string, unknown>
  
  /**
   * Timestamp of health check
   */
  timestamp: number
}

/**
 * Service metrics
 */
export interface ServiceMetrics {
  /**
   * Service-specific metrics
   */
  [key: string]: number | string | boolean | undefined
  
  /**
   * Uptime in milliseconds
   */
  uptime?: number
  
  /**
   * Memory usage in bytes
   */
  memoryUsage?: number
  
  /**
   * Request/operation count
   */
  requestCount?: number
  
  /**
   * Error count
   */
  errorCount?: number
}

/**
 * Base interface for all Loom services
 */
export interface Service {
  /**
   * Service name for identification
   */
  readonly name: string
  
  /**
   * Current lifecycle state
   */
  readonly state: ServiceLifecycle
  
  /**
   * Start the service
   * Must be idempotent - calling multiple times should be safe
   */
  start(): Promise<void>
  
  /**
   * Stop the service gracefully
   * Must be idempotent - calling multiple times should be safe
   */
  stop(): Promise<void>
  
  /**
   * Check if service is healthy
   * Should be fast (<100ms) for monitoring
   */
  isHealthy(): Promise<boolean>
  
  /**
   * Get detailed health status
   * Can be slower, used for diagnostics
   */
  getHealthStatus(): Promise<HealthStatus>
  
  /**
   * Get service metrics for monitoring
   */
  getMetrics(): Promise<ServiceMetrics>
}

/**
 * Health check interface for monitoring systems
 */
export interface HealthCheck {
  /**
   * Name of the health check
   */
  readonly name: string
  
  /**
   * Check health and return status
   */
  check(): Promise<HealthStatus>
  
  /**
   * Optional: Interval in ms for automated checks
   */
  interval?: number
}

/**
 * Base implementation with common functionality
 */
export abstract class BaseService implements Service {
  private _state: ServiceLifecycle = ServiceLifecycle.INITIAL
  private _startTime?: number
  private _errorCount: number = 0
  
  constructor(public readonly name: string) {}
  
  get state(): ServiceLifecycle {
    return this._state
  }
  
  protected setState(state: ServiceLifecycle): void {
    this._state = state
  }
  
  protected incrementErrorCount(): void {
    this._errorCount++
  }
  
  async start(): Promise<void> {
    if (this._state === ServiceLifecycle.RUNNING) {
      return // Already running
    }
    
    if (this._state === ServiceLifecycle.STARTING) {
      throw new Error(`Service ${this.name} is already starting`)
    }
    
    try {
      this.setState(ServiceLifecycle.STARTING)
      await this.onStart()
      this._startTime = Date.now()
      this.setState(ServiceLifecycle.RUNNING)
    } catch (error) {
      this.setState(ServiceLifecycle.ERROR)
      this.incrementErrorCount()
      throw error
    }
  }
  
  async stop(): Promise<void> {
    if (this._state === ServiceLifecycle.STOPPED) {
      return // Already stopped
    }
    
    if (this._state === ServiceLifecycle.STOPPING) {
      throw new Error(`Service ${this.name} is already stopping`)
    }
    
    try {
      this.setState(ServiceLifecycle.STOPPING)
      await this.onStop()
      this.setState(ServiceLifecycle.STOPPED)
    } catch (error) {
      this.setState(ServiceLifecycle.ERROR)
      this.incrementErrorCount()
      throw error
    }
  }
  
  async isHealthy(): Promise<boolean> {
    const status = await this.getHealthStatus()
    return status.status === 'healthy'
  }
  
  async getHealthStatus(): Promise<HealthStatus> {
    if (this._state !== ServiceLifecycle.RUNNING) {
      return {
        status: 'unhealthy',
        message: `Service is not running (state: ${this._state})`,
        timestamp: Date.now()
      }
    }
    
    return this.onHealthCheck()
  }
  
  async getMetrics(): Promise<ServiceMetrics> {
    const baseMetrics: ServiceMetrics = {
      uptime: this._startTime ? Date.now() - this._startTime : 0,
      errorCount: this._errorCount,
      state: this._state
    }
    
    const customMetrics = await this.onGetMetrics()
    return { ...baseMetrics, ...customMetrics }
  }
  
  /**
   * Override to implement service-specific startup
   */
  protected abstract onStart(): Promise<void>
  
  /**
   * Override to implement service-specific shutdown
   */
  protected abstract onStop(): Promise<void>
  
  /**
   * Override to implement service-specific health check
   */
  protected abstract onHealthCheck(): Promise<HealthStatus>
  
  /**
   * Override to provide service-specific metrics
   */
  protected abstract onGetMetrics(): Promise<ServiceMetrics>
}
