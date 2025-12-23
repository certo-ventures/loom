/**
 * Tracer - Captures trace events for actor execution
 */

import { randomUUID } from 'crypto'
import type { TraceEvent, TraceEventType, ActorTrace } from './types'

/**
 * Tracer captures trace events during actor execution
 */
export class Tracer {
  private trace: ActorTrace
  private startTime: Date

  constructor(
    correlationId: string,
    operation: string,
    actorId: string,
    actorType: string,
    parentTraceId?: string
  ) {
    this.startTime = new Date()
    this.trace = {
      traceId: randomUUID(),
      correlationId,
      parentTraceId,
      operation,
      actorId,
      actorType,
      startTime: this.startTime.toISOString(),
      status: 'running',
      events: [],
      childTraces: [],
    }
  }

  /**
   * Record a trace event
   */
  recordEvent(
    eventType: TraceEventType,
    data?: Record<string, unknown>,
    error?: Error
  ): void {
    const event: TraceEvent = {
      eventId: randomUUID(),
      correlationId: this.trace.correlationId,
      traceId: this.trace.traceId,
      parentTraceId: this.trace.parentTraceId,
      eventType,
      actorId: this.trace.actorId,
      actorType: this.trace.actorType,
      timestamp: new Date().toISOString(),
      data,
    }

    if (error) {
      event.error = {
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      }
    }

    this.trace.events.push(event)
  }

  /**
   * Record execution start
   */
  start(): void {
    this.recordEvent('actor.execute.start')
  }

  /**
   * Record execution end with duration
   */
  end(): void {
    const endTime = new Date()
    const duration = endTime.getTime() - this.startTime.getTime()
    
    this.recordEvent('actor.execute.end', { duration })
    
    this.trace.endTime = endTime.toISOString()
    this.trace.duration = duration
    this.trace.status = 'completed'
  }

  /**
   * Record error
   */
  error(error: Error): void {
    this.recordEvent('actor.error', undefined, error)
    this.trace.status = 'failed'
  }

  /**
   * Record message sent
   */
  messageSent(targetActorId: string, messageData?: unknown): void {
    this.recordEvent('message.sent', {
      targetActorId,
      messageData,
    })
  }

  /**
   * Record message received
   */
  messageReceived(sourceActorId: string, messageData?: unknown): void {
    this.recordEvent('message.received', {
      sourceActorId,
      messageData,
    })
  }

  /**
   * Record state update
   */
  stateUpdated(newState: Record<string, unknown>): void {
    this.recordEvent('state.updated', { newState })
  }

  /**
   * Record journal entry
   */
  journalEntry(entryType: string, entryData?: unknown): void {
    this.recordEvent('journal.entry', {
      entryType,
      entryData,
    })
  }

  /**
   * Record activity scheduled
   */
  activityScheduled(activityName: string, input?: unknown): void {
    this.recordEvent('activity.scheduled', {
      activityName,
      input,
    })
  }

  /**
   * Record activity completed
   */
  activityCompleted(activityName: string, result?: unknown, duration?: number): void {
    this.recordEvent('activity.completed', {
      activityName,
      result,
      duration,
    })
  }

  /**
   * Record activity failed
   */
  activityFailed(activityName: string, error: Error): void {
    this.recordEvent('activity.failed', { activityName }, error)
  }

  /**
   * Add a child trace ID
   */
  addChildTrace(childTraceId: string): void {
    this.trace.childTraces.push(childTraceId)
  }

  /**
   * Set metadata
   */
  setMetadata(metadata: Record<string, unknown>): void {
    this.trace.metadata = { ...this.trace.metadata, ...metadata }
  }

  /**
   * Get the current trace
   */
  getTrace(): ActorTrace {
    return { ...this.trace }
  }

  /**
   * Get trace ID
   */
  getTraceId(): string {
    return this.trace.traceId
  }

  /**
   * Get correlation ID
   */
  getCorrelationId(): string {
    return this.trace.correlationId
  }
}
