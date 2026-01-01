import type { Journal, JournalEntry, ActorContext, InvocationJournalEntry } from './journal'
import type { StreamChunk } from '../streaming/types'
import { SimpleStateImpl, type SimpleState } from '../state'
import type { ActorInfrastructureConfig } from './actor-config'
import { mergeActorConfig } from './actor-config'
import { Tracer } from '../tracing'
import { TraceWriter } from '../observability/tracer'
import type { IdempotencyStore, IdempotencyRecord } from '../storage/idempotency-store'
import type { JournalStore } from '../storage/journal-store'
import { createMemoryHelpers, type MemoryHelpers, type MemoryContext } from './memory-helpers'
import type { MemoryAdapter } from '../memory'
import { LamportClock } from '../timing/lamport-clock'
import type { ActorMemory } from '../memory/graph/actor-memory'
import type { GraphStorage } from '../memory/graph/types'
import type { Message } from '../types'

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
  
  /**
   * Optional journal store for durable journal persistence
   */
  private journalStore?: JournalStore
  
  /**
   * Optional memory adapter (opt-in)
   */
  private memoryAdapter?: MemoryAdapter
  
  /**
   * Memory helper methods (no-op if memory not configured)
   */
  protected readonly memory: MemoryHelpers
  
  /**
   * Lamport clock for distributed logical time (shared across actor and memory)
   */
  protected readonly lamportClock: LamportClock
  
  /**
   * Optional graph memory (opt-in, provides structured memory with temporal reasoning)
   */
  protected graphMemory?: ActorMemory
  
  private journal: Journal
  private isReplaying: boolean = false
  private activityCounter: number = 0
  private isCompacting: boolean = false
  private lastCompactionTime: number = 0
  private cachedCompactionThreshold: number | undefined
  private lastInvocation?: InvocationJournalEntry

  constructor(
    context: ActorContext, 
    initialState?: Record<string, unknown>, 
    observabilityTracer?: TraceWriter,
    idempotencyStore?: IdempotencyStore,
    memoryAdapter?: MemoryAdapter,
    journalStore?: JournalStore,
    lamportClock?: LamportClock,
    graphMemory?: ActorMemory
  ) {
    this.context = context
    this.state = initialState ?? this.getDefaultState()
    this.journal = { entries: [], cursor: 0 }
    this.observabilityTracer = observabilityTracer
    this.idempotencyStore = idempotencyStore
    this.memoryAdapter = memoryAdapter
    this.journalStore = journalStore
    this.lamportClock = lamportClock ?? new LamportClock()
    this.graphMemory = graphMemory
    
    // Initialize memory helpers (no-op if adapter not provided)
    const memoryContext: MemoryContext = {
      tenantId: (context as any).tenantId || 'default',
      userId: (context as any).userId,
      actorType: this.constructor.name,
      actorId: context.actorId,
      threadId: (context as any).threadId || context.correlationId || context.actorId,
      runId: (context as any).runId,
      metadata: (context as any).metadata,
    }
    this.memory = createMemoryHelpers(memoryAdapter, memoryContext)
    
    // Initialize simple state facade
    this.simpleState = new SimpleStateImpl(
      () => this.state,
      (newState) => {
        this.state = newState
        if (!this.isReplaying) {
          // Deep copy state to prevent mutations
          let stateCopy: Record<string, unknown>
          try {
            stateCopy = JSON.parse(JSON.stringify(this.state))
          } catch (error) {
            console.warn('Failed to deep copy state in simpleState, using shallow copy:', error)
            stateCopy = { ...this.state }
          }
          
          const entry: JournalEntry = {
            type: 'state_updated',
            state: stateCopy,
          }
          this.journal.entries.push(entry)
          this.persistJournalEntry(entry).catch(() => {}) // Don't block on persistence
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
   * Get current Lamport timestamp (read-only, no side effects)
   * Use this when you need to read the clock value without incrementing it.
   * 
   * @returns Current logical timestamp
   */
  protected getCurrentLogicalTime(): number {
    return this.lamportClock.get()
  }
  
  /**
   * Tick the Lamport clock for a local event or sync with received time
   * Call this when:
   * - Processing a local event (no parameter)
   * - Receiving a message with a timestamp (pass receivedTime)
   * 
   * @param receivedTime - Optional timestamp from received message
   * @returns New logical timestamp after ticking
   */
  protected tickLogicalTime(receivedTime?: number): number {
    return this.lamportClock.tick(receivedTime)
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
  abstract execute(input: unknown): Promise<unknown>

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
      
      // Deep copy state to prevent mutations
      let stateCopy: Record<string, unknown>
      try {
        stateCopy = JSON.parse(JSON.stringify(this.state))
      } catch (error) {
        console.warn('Failed to deep copy state in updateState, using shallow copy:', error)
        stateCopy = { ...this.state }
      }
      
      const entry: JournalEntry = {
        type: 'state_updated',
        state: stateCopy,
      }
      this.journal.entries.push(entry)
      
      // Persist entry asynchronously
      this.persistJournalEntry(entry).catch(() => {})
      
      // Auto-compact if journal gets too large and not recently compacted
      // Cache the threshold to avoid repeated config calls in hot path
      if (this.cachedCompactionThreshold === undefined) {
        this.cachedCompactionThreshold = this.getInfrastructureConfig().journalCompactionThreshold || 100
      }
      const compactionThreshold = this.cachedCompactionThreshold
      
      if (compactionThreshold > 0 && this.journal.entries.length >= compactionThreshold && !this.isCompacting) {
        // Check if enough time passed since last compaction (avoid rapid re-compaction)
        const minTimeBetweenCompactions = 5000 // 5 seconds
        if (Date.now() - this.lastCompactionTime > minTimeBetweenCompactions) {
          this.compactJournal().catch(() => {}) // Don't block on compaction
        }
      }
      
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
        // Skip invocation records
        if (entry.type === 'invocation') {
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
    const entry: JournalEntry = {
      type: 'activity_scheduled',
      activityId,
      name,
      input,
    }
    this.journal.entries.push(entry)
    
    // Persist entry asynchronously
    this.persistJournalEntry(entry).catch(() => {})
    
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
      // Deep copy input to prevent mutations from corrupting journal
      let inputCopy: unknown
      try {
        inputCopy = JSON.parse(JSON.stringify(input))
      } catch (error) {
        console.warn('Failed to deep copy child spawn input, using reference:', error)
        inputCopy = input
      }
      
      const entry: JournalEntry = {
        type: 'child_spawned',
        childId,
        actorType,
        input: inputCopy,
      }
      this.journal.entries.push(entry)
      
      // Persist entry asynchronously
      this.persistJournalEntry(entry).catch(() => {})
      
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
        // Skip invocation records
        if (entry.type === 'invocation') {
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
    const entry: JournalEntry = {
      type: 'suspended',
      reason: `awaiting_event:${eventType}`,
    }
    this.journal.entries.push(entry)

    // Persist entry asynchronously
    this.persistJournalEntry(entry).catch(() => {})

    throw new EventSuspendError(eventType)
  }

  /**
   * Resume actor with event data
   */
  async resume(eventType: string, eventData: unknown): Promise<void> {
    const entry: JournalEntry = {
      type: 'event_received',
      eventType,
      data: eventData,
    }
    this.journal.entries.push(entry)
    
    // Persist entry asynchronously
    this.persistJournalEntry(entry).catch(() => {})
    
    // Trace journal entry
    this.tracer?.journalEntry('event_received', { eventType, data: eventData })

    // Replay from beginning
    await this.replay()
  }

  /**
   * Resume actor after activity completion
   */
  async resumeWithActivity(activityId: string, result: unknown): Promise<void> {
    const entry: JournalEntry = {
      type: 'activity_completed',
      activityId,
      result,
    }
    this.journal.entries.push(entry)
    
    // Persist entry asynchronously
    this.persistJournalEntry(entry).catch(() => {})
    
    // Trace activity completion
    this.tracer?.activityCompleted(activityId, result)

    await this.replay()
  }

  /**
   * Resume actor after activity failure
   */
  async resumeWithActivityError(activityId: string, error: string): Promise<void> {
    const entry: JournalEntry = {
      type: 'activity_failed',
      activityId,
      error,
    }
    this.journal.entries.push(entry)
    
    // Persist entry asynchronously
    this.persistJournalEntry(entry).catch(() => {})
    
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

    // Apply all state_updated entries first to restore state
    for (const entry of this.journal.entries) {
      if (entry.type === 'state_updated') {
        // Deep copy to prevent mutations from affecting journal
        try {
          this.state = JSON.parse(JSON.stringify(entry.state))
        } catch (error) {
          // Fallback to shallow copy if JSON fails
          console.warn('Failed to deep copy state during replay:', error)
          this.state = { ...entry.state }
        }
      }
    }

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
    this.updateLastInvocationFromJournal()
  }

  /**
   * Record the inbound invocation payload for deterministic replay
   */
  recordInvocation(message: Message): void {
    if (this.isReplaying) {
      return
    }

    let payloadCopy: unknown
    try {
      payloadCopy = JSON.parse(JSON.stringify(message.payload))
    } catch (error) {
      console.warn('Failed to deep copy invocation payload, storing original reference:', error)
      payloadCopy = message.payload
    }

    let metadataCopy: Record<string, unknown> | undefined
    try {
      metadataCopy = JSON.parse(JSON.stringify(message.metadata))
    } catch (error) {
      console.warn('Failed to deep copy invocation metadata, storing original reference:', error)
      metadataCopy = { ...message.metadata }
    }

    const entry: InvocationJournalEntry = {
      type: 'invocation',
      messageId: message.messageId,
      timestamp: new Date().toISOString(),
      payload: payloadCopy,
      metadata: {
        ...metadataCopy,
        messageType: message.messageType,
        correlationId: message.correlationId,
      },
    }

    this.journal.entries.push(entry)
    this.lastInvocation = entry
    this.persistJournalEntry(entry).catch(() => {})
  }

  getLastInvocation(): InvocationJournalEntry | undefined {
    return this.lastInvocation
  }

  /**
   * Create a snapshot and compact journal (if journalStore configured)
   * Call this periodically or after N entries to prevent unbounded growth
   */
  async compactJournal(): Promise<void> {
    if (!this.journalStore) {
      return // No-op if journal persistence not configured
    }

    // Prevent concurrent compaction
    if (this.isCompacting) {
      return // Already compacting
    }

    // Only compact if we have enough entries to make it worthwhile
    const COMPACTION_THRESHOLD = this.getInfrastructureConfig().journalCompactionThreshold || 100
    if (this.journal.entries.length < COMPACTION_THRESHOLD) {
      return
    }

    this.isCompacting = true
    try {
      // Wait a brief moment for any in-flight persistJournalEntry calls to complete
      // This is a simple approach - production would use proper async coordination
      await new Promise(resolve => setTimeout(resolve, 100))

      // Deep copy state to prevent mutations (handle circular refs)
      let stateCopy: Record<string, unknown>
      try {
        stateCopy = JSON.parse(JSON.stringify(this.state))
      } catch (circularError) {
        console.warn(`Cannot compact journal for ${this.context.actorId}: circular reference in state`)
        return
      }

      const snapshot = {
        state: stateCopy,
        cursor: this.journal.entries.length,
        timestamp: Date.now(),
      }

      await this.journalStore.saveSnapshot(this.context.actorId, snapshot)

      // Trim old entries from persistent store
      // This removes all entries - snapshot contains full state
      await this.journalStore.trimEntries(this.context.actorId, snapshot.cursor)

      // Clear in-memory journal since snapshot captures everything
      // New entries will be appended both to memory and store
      this.journal.entries = []
      this.journal.cursor = 0
      this.lastCompactionTime = Date.now()
    } catch (error) {
      // Log but don't throw - compaction failure shouldn't crash actor
      console.error(`Failed to compact journal for ${this.context.actorId}:`, error)
    } finally {
      this.isCompacting = false
    }
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

  /**
   * Persist journal entry to store (if configured)
   */
  private async persistJournalEntry(entry: JournalEntry): Promise<void> {
    if (this.journalStore) {
      try {
        await this.journalStore.appendEntry(this.context.actorId, entry)
      } catch (error) {
        // Log error but don't throw - persistence failure shouldn't block actor
        console.error(`Failed to persist journal entry for ${this.context.actorId}:`, {
          error,
          entryType: entry.type,
          actorId: this.context.actorId,
          journalLength: this.journal.entries.length,
        })
      }
    }
  }

  private updateLastInvocationFromJournal(): void {
    for (let i = this.journal.entries.length - 1; i >= 0; i--) {
      const entry = this.journal.entries[i]
      if (entry.type === 'invocation') {
        this.lastInvocation = entry
        return
      }
    }
    this.lastInvocation = undefined
  }
  
  /**
   * Graph Memory Helper Methods
   * These are convenience methods for working with ActorMemory (graph-based memory)
   * Only available if graphMemory is configured during actor construction
   */
  
  /**
   * Remember a fact in the graph memory
   * @param sourceEntityId - The entity that is the subject of the fact
   * @param relation - The relationship (e.g., "likes", "lives_in", "ordered")
   * @param targetEntityId - The entity that is the object of the fact
   * @param text - Human-readable description of the fact
   * @param options - Additional options (confidence, validity period, etc.)
   */
  protected async rememberFact(
    sourceEntityId: string,
    relation: string,
    targetEntityId: string,
    text: string,
    options?: {
      episodeIds?: string[];
      source?: 'user_input' | 'auto_extracted' | 'imported';
      confidence?: number;
      validFrom?: Date;
      lamport_ts?: number;
    }
  ): Promise<string | undefined> {
    if (!this.graphMemory) {
      console.warn('rememberFact called but graphMemory not configured');
      return undefined;
    }
    return this.graphMemory.addFact(sourceEntityId, relation, targetEntityId, text, options);
  }
  
  /**
   * Remember an episode (conversation turn, event) in memory
   * If auto-extraction is enabled, will automatically extract entities and facts
   * @param content - The content to remember (string or JSON)
   * @param source - The source type ('message', 'json', or 'text')
   */
  protected async rememberEpisode(
    content: string,
    source: 'message' | 'json' | 'text' = 'message'
  ): Promise<string | undefined> {
    if (!this.graphMemory) {
      console.warn('rememberEpisode called but graphMemory not configured');
      return undefined;
    }
    return this.graphMemory.addEpisode(content, source);
  }
  
  /**
   * Recall facts from memory
   * @param query - Search query (text, entity IDs, temporal constraints)
   */
  protected async recallFacts(query: {
    text?: string;
    source_entity_ids?: string[];
    target_entity_ids?: string[];
    relations?: string[];
    asOf?: Date;
    limit?: number;
  }) {
    if (!this.graphMemory) {
      console.warn('recallFacts called but graphMemory not configured');
      return [];
    }
    return this.graphMemory.searchByQuery(query);
  }
  
  /**
   * Recall recent episodes
   * @param limit - Maximum number of episodes to return
   */
  protected async recallEpisodes(limit: number = 10) {
    if (!this.graphMemory) {
      console.warn('recallEpisodes called but graphMemory not configured');
      return [];
    }
    return this.graphMemory.getRecentEpisodes(limit);
  }
  
  /**
   * Add or get an entity in the graph
   * @param name - Entity name (e.g., user ID, product name)
   * @param type - Entity type (e.g., 'user', 'product', 'order')
   * @param summary - Optional summary description
   */
  protected async rememberEntity(name: string, type: string, summary?: string): Promise<string | undefined> {
    if (!this.graphMemory) {
      console.warn('rememberEntity called but graphMemory not configured');
      return undefined;
    }
    return this.graphMemory.addEntity(name, type, summary);
  }
  
  /**
   * Get all entities from memory
   */
  protected async getEntities() {
    if (!this.graphMemory) {
      console.warn('getEntities called but graphMemory not configured');
      return [];
    }
    return this.graphMemory.getEntities();
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
