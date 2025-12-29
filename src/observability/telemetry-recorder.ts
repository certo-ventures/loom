/**
 * Actor Telemetry Recorder - Minimal Implementation
 * 
 * Enables actors to record events, metrics, and spans for observability.
 * Uses plug-and-play storage (console, in-memory, Redis, CosmosDB, etc.)
 */

import type { 
  TelemetryStore, 
  TelemetryEvent, 
  TelemetryMetric, 
  TelemetrySpan 
} from '../storage/telemetry-store'
import { ConsoleTelemetryStore } from '../storage/telemetry-store'

/**
 * Minimal telemetry recorder - dependency injection for storage
 */
export class TelemetryRecorder {
  private static store: TelemetryStore = new ConsoleTelemetryStore() // Default

  /**
   * Configure telemetry storage (console, in-memory, Redis, etc.)
   */
  static setStore(store: TelemetryStore): void {
    TelemetryRecorder.store = store
  }

  /**
   * Get current store (for testing)
   */
  static getStore(): TelemetryStore {
    return TelemetryRecorder.store
  }

  /**
   * Record an event (application logic events)
   */
  static recordEvent(event: TelemetryEvent): void {
    TelemetryRecorder.store.writeEvent(event)
  }

  /**
   * Record a metric (numerical measurements)
   */
  static recordMetric(metric: TelemetryMetric): void {
    TelemetryRecorder.store.writeMetric(metric)
  }

  /**
   * Record a span (timed operations)
   */
  static recordSpan(span: TelemetrySpan): void {
    TelemetryRecorder.store.writeSpan(span)
  }

  /**
   * Generate unique span ID
   */
  static generateSpanId(): string {
    return `span-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}

/**
 * Helper to create span tracker
 */
export function createSpanTracker(
  actorId: string,
  actorType: string,
  operation: string
): () => void {
  const spanId = TelemetryRecorder.generateSpanId()
  const startTime = Date.now()

  TelemetryRecorder.recordSpan({
    spanId,
    timestamp: new Date().toISOString(),
    actorId,
    actorType,
    operation,
    status: 'started'
  })

  // Return end function
  return (error?: string) => {
    const duration = Date.now() - startTime

    TelemetryRecorder.recordSpan({
      spanId,
      timestamp: new Date().toISOString(),
      actorId,
      actorType,
      operation,
      duration,
      status: error ? 'failed' : 'completed',
      error
    })
  }
}
