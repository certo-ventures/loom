/**
 * Telemetry Storage - Plug-and-play abstraction for telemetry persistence
 * 
 * Implementations: Console, InMemory, Redis, CosmosDB, Blob, etc.
 */

export interface TelemetryEvent {
  timestamp: string
  actorId: string
  actorType: string
  correlationId?: string
  eventType: string
  data?: unknown
}

export interface TelemetryMetric {
  timestamp: string
  actorId: string
  actorType: string
  name: string
  value: number
  tags?: Record<string, string>
}

export interface TelemetrySpan {
  spanId: string
  timestamp: string
  actorId: string
  actorType: string
  operation: string
  duration?: number
  status: 'started' | 'completed' | 'failed'
  error?: string
}

/**
 * TelemetryStore - Plug-and-play storage for telemetry data
 */
export interface TelemetryStore {
  /**
   * Write an event
   */
  writeEvent(event: TelemetryEvent): Promise<void> | void

  /**
   * Write a metric
   */
  writeMetric(metric: TelemetryMetric): Promise<void> | void

  /**
   * Write a span
   */
  writeSpan(span: TelemetrySpan): Promise<void> | void

  /**
   * Optional: Query events (for debugging/analysis)
   */
  queryEvents?(filter: { 
    actorId?: string
    eventType?: string
    limit?: number 
  }): Promise<TelemetryEvent[]>

  /**
   * Optional: Query metrics
   */
  queryMetrics?(filter: { 
    actorId?: string
    name?: string
    limit?: number 
  }): Promise<TelemetryMetric[]>

  /**
   * Optional: Query spans
   */
  querySpans?(filter: { 
    actorId?: string
    operation?: string
    limit?: number 
  }): Promise<TelemetrySpan[]>
}

/**
 * Console Telemetry Store - Logs to console (default, zero config)
 */
export class ConsoleTelemetryStore implements TelemetryStore {
  writeEvent(event: TelemetryEvent): void {
    console.log('📊 TELEMETRY EVENT:', JSON.stringify(event))
  }

  writeMetric(metric: TelemetryMetric): void {
    console.log('📈 TELEMETRY METRIC:', JSON.stringify(metric))
  }

  writeSpan(span: TelemetrySpan): void {
    console.log('⏱️  TELEMETRY SPAN:', JSON.stringify(span))
  }
}

/**
 * In-Memory Telemetry Store - For testing and dev
 */
export class InMemoryTelemetryStore implements TelemetryStore {
  private events: TelemetryEvent[] = []
  private metrics: TelemetryMetric[] = []
  private spans: TelemetrySpan[] = []
  private maxSize = 10000 // Prevent unbounded growth

  writeEvent(event: TelemetryEvent): void {
    this.events.push(event)
    if (this.events.length > this.maxSize) {
      this.events.shift() // FIFO eviction
    }
  }

  writeMetric(metric: TelemetryMetric): void {
    this.metrics.push(metric)
    if (this.metrics.length > this.maxSize) {
      this.metrics.shift()
    }
  }

  writeSpan(span: TelemetrySpan): void {
    this.spans.push(span)
    if (this.spans.length > this.maxSize) {
      this.spans.shift()
    }
  }

  queryEvents(filter: { actorId?: string; eventType?: string; limit?: number }): Promise<TelemetryEvent[]> {
    let results = this.events
    
    if (filter.actorId) {
      results = results.filter(e => e.actorId === filter.actorId)
    }
    if (filter.eventType) {
      results = results.filter(e => e.eventType === filter.eventType)
    }
    if (filter.limit) {
      results = results.slice(-filter.limit) // Last N
    }
    
    return Promise.resolve(results)
  }

  queryMetrics(filter: { actorId?: string; name?: string; limit?: number }): Promise<TelemetryMetric[]> {
    let results = this.metrics
    
    if (filter.actorId) {
      results = results.filter(m => m.actorId === filter.actorId)
    }
    if (filter.name) {
      results = results.filter(m => m.name === filter.name)
    }
    if (filter.limit) {
      results = results.slice(-filter.limit)
    }
    
    return Promise.resolve(results)
  }

  querySpans(filter: { actorId?: string; operation?: string; limit?: number }): Promise<TelemetrySpan[]> {
    let results = this.spans
    
    if (filter.actorId) {
      results = results.filter(s => s.actorId === filter.actorId)
    }
    if (filter.operation) {
      results = results.filter(s => s.operation === filter.operation)
    }
    if (filter.limit) {
      results = results.slice(-filter.limit)
    }
    
    return Promise.resolve(results)
  }

  // Utility for tests
  clear(): void {
    this.events = []
    this.metrics = []
    this.spans = []
  }

  getAll() {
    return {
      events: [...this.events],
      metrics: [...this.metrics],
      spans: [...this.spans]
    }
  }
}
