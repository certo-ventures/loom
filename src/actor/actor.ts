import type { Journal, JournalEntry, ActorContext } from './journal'
import type { StreamChunk } from '../streaming/types'
import { SimpleStateImpl, type SimpleState } from '../state'
import type { ActorInfrastructureConfig } from './actor-config'
import { mergeActorConfig } from './actor-config'
import { Tracer } from '../tracing'
import { TraceWriter } from '../observability/tracer'
import type { IdempotencyStore, IdempotencyRecord } from '../storage/idempotency-store'

/**
 * Base Actor class - all actors extend this
 * Uses journal-based execution for deterministic replay
 */
export abstract class Actor {
  protected state: Record<string, unknown>
  protected context: ActorContext
  
  /**
   * Simple key-value state API (Motia-inspired)
   * Use this for common cases: state.get(key), state.set(key, value)
   * Use updateState() for complex updates or when you need full control
   */
  protected readonly simpleState: SimpleState
  
  /**
   * Infrastructure configuration for this actor
   * Override in subclass to customize timeout, retry policy, etc.
   */
  static config?: ActorInfrastructureConfig
  
  /**
   * Optional tracer for distributed tracing
   */
  protected tracer?: Tracer
  
  /**
   * Optional observability tracer (reference-based)
   */
  private observabilityTracer?: TraceWriter
  
  /**
   * Optional idempotency store for exactly-once semantics
   */
  private idempotencyStore?: IdempotencyStore
  
  private journal: Journal
  private isReplaying: boolean = false
  private activityCounter: number = 0

  constructor(
    context: ActorContext, 
    initialState?: Record<string, unknown>, 
    observabilityTracer?: TraceWriter,
    idempotencyStore?: IdempotencyStore
  ) {
    this.context = context
    this.state = initialState ?? this.getDefaultState()
    this.journal = { entries: [], cursor: 0 }
    this.observabilityTracer = observabilityTracer
    this.idempotencyStore = idempotencyStore
    
    // Initialize simple state facade
    this.simpleState = new SimpleStateImpl(
      () => this.state,
      (newState) => {
        this.state = newState
        if (!this.isReplaying) {
          this.journal.entries.push({
            type: 'state_updated',
            state: this.state,
          })
        }
      }
    )
    
    // Initialize tracer if correlationId provided
    if (context.correlationId) {
      this.tracer = new Tracer(
        context.correlationId,
        'actor.execute',
        context.actorId,
        this.constructor.name,
        context.parentTraceId
      )
      this.tracer.recordEvent('actor.created', { initialState })
    }
  }

  /**
   * Override to provide default state
   */
  protected getDefaultState(): Record<string, unknown> {
    return {}
  }
  
  /**
   * Get the infrastructure configuration for this actor
   * Merges actor-specific config with defaults
   */
  getInfrastructureConfig() {
    return mergeActorConfig((this.constructor as typeof Actor).config)
  }

  /**
   * Get configuration using hierarchical resolution
   * Automatically uses actor's context (clientId, tenantId, environment)
   */
  protected async getConfig<T = any>(configKey: string): Promise<T | null> {
    const resolver = (this.context as any).configResolver
    if (!resolver) {
      throw new Error('ConfigResolver not provided in actor context. Add configResolver to runtime.')
    }
    
    const value = await resolver.getWithContext(configKey, {
      clientId: (this.context as any).clientId,
      tenantId: (this.context as any).tenantId,
      environment: (this.context as any).environment,
      actorId: this.context.actorId,
    })
    
    return value as T | null
  }

  /**
   * Main execution entry point - override this
   */
  abstract execute(input: unknown): Promise<void>

  /**
   * Streaming execution - yields progressive results
   * Default implementation wraps execute() in a single chunk
   * Override for true streaming behavior
   */
  async *stream(input: unknown): AsyncGenerator<StreamChunk, void, unknown> {
    yield { type: 'start' }
    
    try {
      await this.execute(input)
      yield { type: 'complete', data: this.state }
    } catch (error) {
      yield { type: 'error', error: error as Error }
      throw error
    }
  }

  /**
   * Update actor state (plain JSON)
   */
  protected updateState(updates: Record<string, unknown>): void {
    this.state = { ...this.state, ...updates }
    
    if (!this.isReplaying) {
      const entryIndex = this.journal.entries.length
      this.journal.entries.push({
        type: 'state_updated',
        state: this.state,
      })
      
      // Trace state update (legacy tracer)
      this.tracer?.stateUpdated(updates)
      
      // Emit observability trace event with reference to journal entry
      if (this.observabilityTracer && this.context.trace) {
        this.observabilityTracer.emit({
          trace_id: this.context.trace.trace_id,
          span_id: TraceWriter.generateId(),
          parent_span_id: this.context.trace.span_id,
          event_type: 'actor:state_changed',
          timestamp: new Date().toISOString(),
          refs: {
            journal_entry: {
              actor_id: this.context.actorId,
              entry_index: entryIndex,
              entry_type: 'state_updated'
            }
          },
          metadata: {
            actor_type: this.constructor.name,
            changed_keys: Object.keys(updates)
          }
        }).catch(() => {}) // Silent failure - don't break actor execution
      }
    }
  }

  /**
   * Call an activity (WASM executable)
   */
  protected async callActivity<T = unknown>(name: string, input: unknown): Promise<T> {
    const activityId = `act-${this.activityCounter++}`

    if (this.isReplaying) {
      // During replay, find the corresponding completion/failure entry
      while (this.journal.cursor < this.journal.entries.length) {
        const entry = this.journal.entries[this.journal.cursor]
        
        // Skip state updates
        if (entry.type === 'state_updated') {
          this.journal.cursor++
          continue
        }
        
        // Skip the activity_scheduled entry
        if (entry.type === 'activity_scheduled') {
          this.journal.cursor++
          continue
        }
        
        if (entry.type === 'activity_completed') {
          this.journal.cursor++
          return entry.result as T
        }
        
        if (entry.type === 'activity_failed') {
          this.journal.cursor++
          throw new Error(entry.error)
        }
        
        break
      }
      throw new Error('Journal replay mismatch - expected activity result')
    }

    // Record scheduling
    this.journal.entries.push({
      type: 'activity_scheduled',
      activityId,
      name,
      input,
    })
    
    // Trace activity scheduling
    this.tracer?.activityScheduled(name, input)

    // Execution will be handled by runtime
    // For now, throw to indicate we need to suspend
    throw new ActivitySuspendError(activityId, name, input)
  }

  /**
   * Spawn a child actor
   */
  protected async spawnChild(actorType: string, input: unknown): Promise<string> {
    const childId = `${this.context.actorId}-child-${Date.now()}`

    if (!this.isReplaying) {
      this.journal.entries.push({
        type: 'child_spawned',
        childId,
        actorType,
        input,
      })
      
      // Trace message sent to child
      this.tracer?.messageSent(childId, { actorType, input })
    }

    return childId
  }
  
  /**
   * Send a message to another actor
   * Use this to trace inter-actor communication
   */
  protected sendMessage(targetActorId: string, message: unknown): void {
    if (!this.isReplaying) {
      this.tracer?.messageSent(targetActorId, message)
    }
  }
  
  /**
   * Record that a message was received
   * Call this at the start of execute() if needed
   */
  protected recordMessageReceived(sourceActorId: string, message: unknown): void {
    if (!this.isReplaying) {
      this.tracer?.messageReceived(sourceActorId, message)
    }
  }

  /**
   * Wait for an external event
   */
  protected async waitForEvent<T = unknown>(eventType: string): Promise<T> {
    if (this.isReplaying) {
      // During replay, find the event_received entry
      while (this.journal.cursor < this.journal.entries.length) {
        const entry = this.journal.entries[this.journal.cursor]
        
        // Skip state updates
        if (entry.type === 'state_updated') {
          this.journal.cursor++
          continue
        }
        
        // Skip the suspended entry
        if (entry.type === 'suspended') {
          this.journal.cursor++
          continue
        }
        
        if (entry.type === 'event_received') {
          this.journal.cursor++
          return entry.data as T
        }
        
        break
      }
      throw new Error('Journal replay mismatch - expected event data')
    }

    // Suspend waiting for event
    this.journal.entries.push({
      type: 'suspended',
      reason: `awaiting_event:${eventType}`,
    })

    throw new EventSuspendError(eventType)
  }

  /**
   * Resume actor with event data
   */
  async resume(eventType: string, eventData: unknown): Promise<void> {
    this.journal.entries.push({
      type: 'event_received',
      eventType,
      data: eventData,
    })
    
    // Trace journal entry
    this.tracer?.journalEntry('event_received', { eventType, data: eventData })

    // Replay from beginning
    await this.replay()
  }

  /**
   * Resume actor after activity completion
   */
  async resumeWithActivity(activityId: string, result: unknown): Promise<void> {
    this.journal.entries.push({
      type: 'activity_completed',
      activityId,
      result,
    })
    
    // Trace activity completion
    this.tracer?.activityCompleted(activityId, result)

    await this.replay()
  }

  /**
   * Resume actor after activity failure
   */
  async resumeWithActivityError(activityId: string, error: string): Promise<void> {
    this.journal.entries.push({
      type: 'activity_failed',
      activityId,
      error,
    })
    
    // Trace activity failure
    this.tracer?.activityFailed(activityId, new Error(error))

    await this.replay()
  }

  /**
   * Replay execution from journal
   */
  private async replay(): Promise<void> {
    this.isReplaying = true
    this.journal.cursor = 0
    this.activityCounter = 0
    
    // Reset state to default
    this.state = this.getDefaultState()

    try {
      // Continue execution - this will replay through journal
      await this.execute(null)
    } catch (error) {
      // It's OK to suspend again during replay
      if (error instanceof ActivitySuspendError || error instanceof EventSuspendError) {
        // Expected - we've replayed up to the suspend point
      } else {
        throw error
      }
    } finally {
      this.isReplaying = false
    }
  }

  /**
   * Get current journal (for persistence)
   */
  getJournal(): Journal {
    return this.journal
  }

  /**
   * Load journal (for rehydration)
   */
  loadJournal(journal: Journal): void {
    this.journal = journal
  }

  /**
   * Get current state (for persistence)
   */
  getState(): Record<string, unknown> {
    return this.state
  }
  
  /**
   * Get current tracer (for accessing trace data)
   */
  getTracer(): Tracer | undefined {
    return this.tracer
  }
  
  /**
   * Check if a message with idempotency key was already processed
   * @returns Cached result if found, undefined if new
   */
  protected async checkIdempotency(idempotencyKey: string): Promise<IdempotencyRecord | undefined> {
    if (!this.idempotencyStore) {
      return undefined
    }
    
    try {
      const record = await this.idempotencyStore.get(idempotencyKey)
      
      if (record && this.observabilityTracer && this.context.trace) {
        // Emit deduplication event
        this.observabilityTracer.emit({
          trace_id: this.context.trace.trace_id,
          span_id: TraceWriter.generateId(),
          parent_span_id: this.context.trace.span_id,
          event_type: 'actor:message_deduplicated',
          timestamp: new Date().toISOString(),
          refs: {
            idempotency: {
              key: idempotencyKey,
              original_execution: record.executedAt
            }
          },
          metadata: {
            actor_id: this.context.actorId,
            actor_type: this.constructor.name
          }
        }).catch(() => {}) // Silent failure
      }
      
      return record
    } catch (error) {
      // Log error but don't fail actor execution
      console.error(`Idempotency check failed for key ${idempotencyKey}:`, error)
      return undefined
    }
  }
  
  /**
   * Store execution result for idempotency
   * @param idempotencyKey The unique key for this operation
   * @param result The execution result to cache
   */
  protected async storeIdempotency(idempotencyKey: string, result: any, messageId?: string): Promise<void> {
    if (!this.idempotencyStore) {
      return
    }
    
    const config = this.getInfrastructureConfig()
    const ttl = config.idempotencyTtl || 86400 // 24 hours default
    
    const record: IdempotencyRecord = {
      key: idempotencyKey,
      actorId: this.context.actorId,
      result,
      executedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      messageId,
      metadata: {
        actorType: this.constructor.name,
        correlationId: this.context.correlationId
      }
    }
    
    try {
      await this.idempotencyStore.set(record, ttl)
      
      if (this.observabilityTracer && this.context.trace) {
        // Emit idempotency stored event
        this.observabilityTracer.emit({
          trace_id: this.context.trace.trace_id,
          span_id: TraceWriter.generateId(),
          parent_span_id: this.context.trace.span_id,
          event_type: 'actor:idempotency_stored',
          timestamp: new Date().toISOString(),
          refs: {
            idempotency: {
              key: idempotencyKey,
              ttl_seconds: ttl
            }
          },
          metadata: {
            actor_id: this.context.actorId,
            actor_type: this.constructor.name
          }
        }).catch(() => {}) // Silent failure
      }
    } catch (error) {
      // Log error but don't fail actor execution
      console.error(`Failed to store idempotency for key ${idempotencyKey}:`, error)
    }
  }
  
  /**
   * Execute with automatic trace capture
   * Called by runtime to wrap execute() with tracing
   */
  async executeWithTracing(input: unknown): Promise<void> {
    try {
      this.tracer?.start()
      await this.execute(input)
      this.tracer?.end()
    } catch (error) {
      // Record error in trace
      if (error instanceof Error && !(error instanceof ActivitySuspendError) && !(error instanceof EventSuspendError)) {
        this.tracer?.error(error)
      }
      throw error
    }
  }
}

/**
 * Error thrown when actor needs to suspend for activity execution
 */
export class ActivitySuspendError extends Error {
  constructor(
    public activityId: string,
    public activityName: string,
    public input: unknown
  ) {
    super('Actor suspended for activity execution')
    this.name = 'ActivitySuspendError'
  }
}

/**
 * Error thrown when actor needs to suspend for event
 */
export class EventSuspendError extends Error {
  constructor(public eventType: string) {
    super(`Actor suspended waiting for event: ${eventType}`)
    this.name = 'EventSuspendError'
  }
}
