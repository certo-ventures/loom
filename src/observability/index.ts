import pino from 'pino'
import type { Logger } from 'pino'

/**
 * Observability - Simple structured logging and metrics
 * 
 * MINIMAL approach:
 * - Structured JSON logging via Pino
 * - Correlation ID propagation
 * - Basic metrics (counters, gauges)
 * - No heavy tracing infrastructure
 * 
 * Just enough to debug and monitor in production!
 */

/**
 * Metrics interface - simple counters and gauges
 */
export interface Metrics {
  increment(name: string, value?: number, labels?: Record<string, string>): void
  gauge(name: string, value: number, labels?: Record<string, string>): void
  timing(name: string, durationMs: number, labels?: Record<string, string>): void
}

/**
 * Simple in-memory metrics (can swap for Prometheus/Datadog later)
 */
class InMemoryMetrics implements Metrics {
  private counters = new Map<string, number>()
  private gauges = new Map<string, number>()

  increment(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.makeKey(name, labels)
    this.counters.set(key, (this.counters.get(key) || 0) + value)
  }

  gauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.makeKey(name, labels)
    this.gauges.set(key, value)
  }

  timing(name: string, durationMs: number, labels?: Record<string, string>): void {
    const key = this.makeKey(name, labels)
    this.counters.set(key, (this.counters.get(key) || 0) + durationMs)
  }

  private makeKey(name: string, labels?: Record<string, string>): string {
    if (!labels) return name
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',')
    return `${name}{${labelStr}}`
  }

  getCounter(name: string, labels?: Record<string, string>): number {
    return this.counters.get(this.makeKey(name, labels)) || 0
  }

  getGauge(name: string, labels?: Record<string, string>): number {
    return this.gauges.get(this.makeKey(name, labels)) || 0
  }

  reset(): void {
    this.counters.clear()
    this.gauges.clear()
  }
}

/**
 * Observability singleton - global logger and metrics
 */
export class Observability {
  private static instance: Observability
  
  public logger: Logger
  public metrics: Metrics

  private constructor(options?: { pretty?: boolean; level?: string }) {
    // Create logger with optional pretty printing for dev
    this.logger = pino({
      level: options?.level || 'info',
      ...(options?.pretty && {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
    })

    this.metrics = new InMemoryMetrics()
  }

  static getInstance(options?: { pretty?: boolean; level?: string }): Observability {
    if (!Observability.instance) {
      Observability.instance = new Observability(options)
    }
    return Observability.instance
  }

  /**
   * Create a child logger with correlation ID and context
   */
  createChildLogger(context: Record<string, unknown>): Logger {
    return this.logger.child(context)
  }

  /**
   * Measure duration of an async operation
   */
  async measureAsync<T>(
    name: string,
    operation: () => Promise<T>,
    labels?: Record<string, string>
  ): Promise<T> {
    const start = Date.now()
    try {
      const result = await operation()
      const duration = Date.now() - start
      this.metrics.timing(name, duration, labels)
      return result
    } catch (error) {
      const duration = Date.now() - start
      this.metrics.timing(name, duration, { ...labels, status: 'error' })
      throw error
    }
  }

  /**
   * Get metrics instance (for testing/inspection)
   */
  getMetrics(): InMemoryMetrics {
    return this.metrics as InMemoryMetrics
  }
}

/**
 * Global logger instance
 */
export const obs = Observability.getInstance()
export const logger = obs.logger
export const metrics = obs.metrics

// Health check and monitoring
export * from './types'
export * from './collector'
export * from './endpoints'
