import type { Journal, JournalEntry, ActorContext, InvocationJournalEntry, DecisionJournalEntry, ContextGatheredEntry, PrecedentReferencedEntry, DecisionOutcomeEntry } from './journal'
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
import { DecisionMemory } from '../memory/graph/decision-memory'
import { PolicyMemory } from '../memory/graph/policy-memory'
import { ObservabilityMetrics } from '../memory/graph/observability-metrics'
import type { GraphStorage } from '../memory/graph/types'
import type { Message } from '../types'
import { ConfigurationError } from '../config/environment'
import { produce, produceWithPatches, applyPatches, enablePatches } from 'immer'
import { 
  type DecisionTrace, 
  type DecisionInput, 
  type DecisionTraceConfig, 
  type LLMDecisionAnalysis,
  type DecisionOutcome,
  type DecisionReplayResult,
  type DecisionExplanation,
  DEFAULT_DECISION_TRACE_CONFIG 
} from './decision-trace'

// Enable Immer patches globally
enablePatches()

/**
 * Base Actor class - all actors extend this
 * Uses journal-based execution with Immer patches for deterministic replay
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
  
  /**
   * Optional decision memory (opt-in, provides decision precedent search and analysis)
   */
  protected decisionMemory?: DecisionMemory
  
  /**
   * Optional policy memory (opt-in, tracks policy evolution and effectiveness)
   */
  protected policyMemory?: PolicyMemory
  
  /**
   * Optional observability metrics (opt-in, provides decision quality scoring and analytics)
   */
  protected observabilityMetrics?: ObservabilityMetrics
  
  private journal: Journal
  private isReplaying: boolean = false
  private activityCounter: number = 0
  private isCompacting: boolean = false
  private lastCompactionTime: number = 0
  private cachedCompactionThreshold: number | undefined
  private lastInvocation?: InvocationJournalEntry
  
  // Decision trace state
  private decisionTraceConfig?: DecisionTraceConfig
  private enrichmentBudgetUsed: number = 0
  private enrichmentBudgetResetTime: number = Date.now()

  constructor(
    context: ActorContext, 
    initialState?: Record<string, unknown>, 
    observabilityTracer?: TraceWriter,
    idempotencyStore?: IdempotencyStore,
    memoryAdapter?: MemoryAdapter,
    journalStore?: JournalStore,
    lamportClock?: LamportClock,
    graphMemory?: ActorMemory,
    decisionMemory?: DecisionMemory,
    policyMemory?: PolicyMemory,
    observabilityMetrics?: ObservabilityMetrics
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
    this.decisionMemory = decisionMemory
    this.policyMemory = policyMemory
    this.observabilityMetrics = observabilityMetrics
    
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
          
          // Store full state as a single patch for simpleState compatibility
          const entry: JournalEntry = {
            type: 'state_patches',
            patches: [{ op: 'replace', path: [], value: stateCopy }] as any,
            inversePatches: [{ op: 'replace', path: [], value: this.state }] as any,
            timestamp: Date.now()
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
   * Get REQUIRED configuration using hierarchical resolution
   * FAILS FAST: Throws ConfigurationError if config not found
   * NEVER returns null - use tryGetConfig() for optional config
   * 
   * Automatically uses actor's context (clientId, tenantId, environment, actorId)
   * 
   * @throws ConfigurationError with detailed context if config not found
   */
  protected async getConfig<T = any>(configKey: string): Promise<T> {
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
    
    if (value === null || value === undefined) {
      // Build searched paths for error message
      const searchedPaths = this.buildConfigPaths(configKey)
      
      const contextInfo = {
        actorId: this.context.actorId,
        actorType: this.constructor.name,
        clientId: (this.context as any).clientId,
        tenantId: (this.context as any).tenantId,
        environment: (this.context as any).environment,
      }
      
      const contextStr = Object.entries(contextInfo)
        .filter(([_, v]) => v)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n')
      
      throw new ConfigurationError(
        `❌ CONFIGURATION ERROR: Cannot access required configuration\n\n` +
        `Missing Required Configuration: ${configKey}\n\n` +
        `Context:\n${contextStr}\n\n` +
        `Searched paths:\n` +
        searchedPaths.map(p => `  • ${p}`).join('\n') +
        `\n\nFix:\n` +
        `  Set required configuration at any level:\n` +
        `  await configResolver.set('global/${configKey}', { /* config */ })\n\n` +
        `  Or for this tenant:\n` +
        `  await configResolver.set('${(this.context as any).tenantId || 'tenant'}/${configKey}', { /* config */ })`,
        {
          key: configKey,
          context: contextInfo,
          searchedPaths,
          actorType: this.constructor.name
        }
      )
    }
    
    return value as T
  }

  /**
   * Get OPTIONAL configuration using hierarchical resolution
   * Returns null if config not found (does not throw)
   * 
   * Use this for truly optional features where the actor can continue without the config.
   * Caller MUST explicitly handle null case.
   * 
   * @returns Configuration value or null if not found
   */
  protected async tryGetConfig<T = any>(configKey: string): Promise<T | null> {
    const resolver = (this.context as any).configResolver
    if (!resolver) {
      // Gracefully return null if no config resolver (e.g., in tests)
      return null
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
   * Build hierarchical config paths for error messages
   * Shows all paths that were searched in order
   */
  private buildConfigPaths(configKey: string): string[] {
    const paths: string[] = []
    const ctx = this.context as any
    
    // Most specific to least specific
    if (ctx.clientId && ctx.tenantId && ctx.environment && ctx.actorId) {
      paths.push(`${ctx.clientId}/${ctx.tenantId}/${ctx.environment}/${ctx.actorId}/${configKey}`)
    }
    if (ctx.clientId && ctx.tenantId && ctx.environment) {
      paths.push(`${ctx.clientId}/${ctx.tenantId}/${ctx.environment}/${configKey}`)
    }
    if (ctx.clientId && ctx.tenantId) {
      paths.push(`${ctx.clientId}/${ctx.tenantId}/${configKey}`)
    }
    if (ctx.clientId) {
      paths.push(`${ctx.clientId}/${configKey}`)
    }
    
    // Always include global fallback
    paths.push(`global/${configKey}`)
    
    return paths
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
   * Update actor state using Immer for immutable updates with patch tracking
   * 
   * @example
   * ```typescript
   * // Deep updates work naturally
   * this.updateState(draft => {
   *   draft.user.profile.name = 'Alice'
   *   draft.orders.push({ id: '123', total: 99.99 })
   *   draft.metadata.lastModified = Date.now()
   * })
   * ```
   */
  protected updateState(updater: (draft: Record<string, unknown>) => void): void {
    const [nextState, patches, inversePatches] = produceWithPatches(
      this.state,
      updater
    )
    
    this.state = nextState
    
    if (!this.isReplaying && patches.length > 0) {
      const entry: JournalEntry = {
        type: 'state_patches',
        patches,
        inversePatches,
        timestamp: Date.now()
      }
      
      this.journal.entries.push(entry)
      
      // Persist entry asynchronously
      this.persistJournalEntry(entry).catch(() => {})
      
      // Auto-compact if journal gets too large and not recently compacted
      if (this.cachedCompactionThreshold === undefined) {
        this.cachedCompactionThreshold = this.getInfrastructureConfig().journalCompactionThreshold || 100
      }
      const compactionThreshold = this.cachedCompactionThreshold
      
      if (compactionThreshold > 0 && this.journal.entries.length >= compactionThreshold && !this.isCompacting) {
        const minTimeBetweenCompactions = 5000 // 5 seconds
        if (Date.now() - this.lastCompactionTime > minTimeBetweenCompactions) {
          this.compactJournal().catch(() => {})
        }
      }
      
      // Trace state update with patch information
      this.tracer?.stateUpdated({ patchCount: patches.length, operations: patches.map(p => p.op) })
      
      // Emit observability trace event with patch metadata
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
              entry_index: this.journal.entries.length - 1,
              entry_type: 'state_patches'
            }
          },
          metadata: {
            actor_type: this.constructor.name,
            patch_count: patches.length
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
        if (entry.type === 'state_patches') {
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
        if (entry.type === 'state_patches') {
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
   * Replay execution from journal using Immer patches
   */
  private async replay(): Promise<void> {
    this.isReplaying = true
    this.journal.cursor = 0
    this.activityCounter = 0
    
    // Reset state to default
    this.state = this.getDefaultState()

    // Apply all state patches to reconstruct state
    for (const entry of this.journal.entries) {
      if (entry.type === 'state_patches') {
        this.state = applyPatches(this.state, entry.patches)
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
   * Compensate (undo) the last state change using inverse patches
   * Useful for Saga pattern and error recovery
   * 
   * @example
   * ```typescript
   * try {
   *   this.updateState(draft => { draft.balance -= 100 })
   *   await externalAPI.charge()
   * } catch (error) {
   *   await this.compensateLastStateChange() // Undo balance change
   * }
   * ```
   */
  protected async compensateLastStateChange(): Promise<void> {
    // Find the most recent state_patches entry
    for (let i = this.journal.entries.length - 1; i >= 0; i--) {
      const entry = this.journal.entries[i]
      
      if (entry.type === 'state_patches') {
        // Apply inverse patches to undo the change
        this.state = applyPatches(this.state, entry.inversePatches)
        
        // Remove the compensated entry from journal
        this.journal.entries.splice(i, 1)
        
        // Persist the compensation if journal store configured
        if (this.journalStore) {
          // In a production system, you'd persist a compensation event
          // For now, just persist the updated journal
          await this.journalStore.trimEntries(
            this.context.actorId,
            i
          ).catch(() => {})
        }
        
        return
      }
    }
    
    // No state changes to compensate
    console.warn(`No state changes to compensate for actor ${this.context.actorId}`)
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

  // ============================================================================
  // Decision Trace Methods - Hybrid LLM Approach
  // ============================================================================

  /**
   * Record a decision with full context (WHY + WHAT)
   * 
   * This is the core primitive for capturing decision lineage.
   * Always captures basic trace (fast). Optionally enriches with LLM (async).
   * 
   * @param params Decision parameters
   * @param params.decisionType Type of decision
   * @param params.rationale Why this decision was made (developer-provided)
   * @param params.reasoning Step-by-step logic (optional)
   * @param params.inputs Context gathered from systems
   * @param params.outcome What was decided
   * @param params.policy Policy applied (if any)
   * @param params.precedents Prior decisions referenced
   * @param params.isException Whether this is an exception to policy
   * @param params.exceptionReason Why exception was granted
   * @param params.approvers Who approved this decision
   * @param params.context Additional context (tenantId, customerId, etc.)
   * @param params.enrichWithLLM Override LLM enrichment ('always' | 'never' | undefined = use config)
   * 
   * @example
   * await this.recordDecision({
   *   decisionType: 'exception',
   *   rationale: 'Healthcare customer with service issues deserves discount',
   *   reasoning: [
   *     'Customer ARR: $500k',
   *     'Industry: healthcare (precedent exists)',
   *     '3 open SEV-1 tickets',
   *     'VP approval obtained'
   *   ],
   *   inputs: gatheredContext,
   *   outcome: { approved: true, discount: 0.15 },
   *   isException: true,
   *   exceptionReason: 'Above standard 10% policy limit'
   * })
   */
  protected async recordDecision(params: {
    decisionType: DecisionTrace['decisionType']
    rationale: string
    reasoning?: string[]
    inputs: DecisionInput[]
    outcome: any
    policy?: { id: string; version: string; rule: string }
    precedents?: string[]
    isException: boolean
    exceptionReason?: string
    approvers?: DecisionTrace['approvers']
    context?: Record<string, any>
    enrichWithLLM?: 'always' | 'never'
  }): Promise<string> {
    const decisionId = `decision_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const timestamp = this.lamportClock.tick()

    // Always capture basic trace (fast, deterministic)
    const basicTrace: DecisionTrace = {
      decisionId,
      timestamp,
      actorId: this.context.actorId,
      actorType: this.constructor.name,
      decisionType: params.decisionType,
      rationale: params.rationale,
      reasoning: params.reasoning,
      inputs: params.inputs,
      outcome: params.outcome,
      policy: params.policy,
      precedents: params.precedents,
      isException: params.isException,
      exceptionReason: params.exceptionReason,
      approvers: params.approvers,
      context: {
        tenantId: (this.context as any).tenantId,
        environment: (this.context as any).environment,
        ...params.context
      }
    }

    // Store in journal (deterministic replay)
    const journalEntry: DecisionJournalEntry = {
      type: 'decision_made',
      decisionId: basicTrace.decisionId,
      timestamp: basicTrace.timestamp,
      decisionType: basicTrace.decisionType,
      rationale: basicTrace.rationale,
      reasoning: basicTrace.reasoning,
      inputs: basicTrace.inputs,
      outcome: basicTrace.outcome,
      policy: basicTrace.policy,
      precedents: basicTrace.precedents,
      isException: basicTrace.isException,
      exceptionReason: basicTrace.exceptionReason,
      approvers: basicTrace.approvers,
      context: basicTrace.context
    }

    this.journal.entries.push(journalEntry)

    // Emit trace event
    this.context.recordEvent?.('decision_made', { decisionId, decisionType: params.decisionType })

    // Store in DecisionMemory if configured
    if (this.decisionMemory) {
      this.decisionMemory.addDecisionTrace(basicTrace).catch(err => {
        console.warn(`Failed to store decision ${decisionId} in DecisionMemory:`, err)
        this.context.recordEvent?.('decision_storage_failed', { decisionId, error: err instanceof Error ? err.message : String(err) })
      })
    }

    // Optionally enrich with LLM (async, don't block)
    if (await this.shouldEnrichWithLLM(params)) {
      this.enrichTraceWithLLM(basicTrace).catch(err => {
        console.warn(`Failed to enrich decision ${decisionId} with LLM:`, err)
        this.context.recordEvent?.('decision_enrichment_failed', { decisionId, error: err.message })
      })
    }

    return decisionId
  }

  /**
   * Gather context from an external system and track it
   * 
   * This method:
   * 1. Performs the actual lookup/query
   * 2. Records it in journal for replay
   * 3. Returns the result
   * 
   * @param params System lookup parameters
   * @returns The result from the system
   * 
   * @example
   * const accountData = await this.gatherContext({
   *   system: 'salesforce',
   *   entity: 'account',
   *   query: `SELECT ARR, Industry FROM Account WHERE Id = '${accountId}'`,
   *   relevance: 'Customer ARR determines approval threshold',
   *   fetcher: async () => await salesforceClient.query(...)
   * })
   */
  protected async gatherContext<T = any>(params: {
    system: string
    entity: string
    query: string
    relevance: string
    fetcher: () => Promise<T>
    decisionId?: string
  }): Promise<T> {
    const startTime = Date.now()
    const result = await params.fetcher()
    const retrievedAt = this.lamportClock.tick()

    // Record in journal
    const entry: ContextGatheredEntry = {
      type: 'context_gathered',
      decisionId: params.decisionId || 'pending',
      system: params.system,
      entity: params.entity,
      query: params.query,
      result,
      relevance: params.relevance,
      retrievedAt
    }

    this.journal.entries.push(entry)

    // Emit metrics
    this.context.recordMetric?.('context_gather_duration_ms', Date.now() - startTime, {
      system: params.system,
      entity: params.entity
    })

    return result
  }

  /**
   * Find similar past decisions (precedent search)
   * 
   * Uses DecisionMemory (if configured) to search for similar decisions
   * using semantic similarity, filters, or both.
   * 
   * In Phase 2, this queries DecisionMemory (extends GraphMemory)
   * to find similar past decisions using vector search or filters.
   * 
   * @param params Search parameters
   * @returns Array of precedent decision traces
   */
  protected async findPrecedents(params: {
    decisionType?: DecisionTrace['decisionType']
    contextSimilarity?: Record<string, any>
    timeRange?: { start: number; end: number }
    limit?: number
    queryText?: string
    minSimilarity?: number
  }): Promise<DecisionTrace[]> {
    // If DecisionMemory not configured, return empty array
    if (!this.decisionMemory) {
      this.context.recordEvent?.('precedent_search', { 
        decisionType: params.decisionType,
        resultCount: 0,
        reason: 'decision_memory_not_configured'
      })
      return []
    }

    try {
      // Build search query
      const searchQuery: any = {
        decisionType: params.decisionType,
        contextFilters: params.contextSimilarity,
        startTime: params.timeRange?.start,
        endTime: params.timeRange?.end,
        limit: params.limit || 10,
        minSimilarity: params.minSimilarity || 0.7
      }

      // Add text query if provided
      if (params.queryText) {
        searchQuery.queryText = params.queryText
      }

      // Search for precedents
      const precedents = await this.decisionMemory.searchDecisions(searchQuery)

      // Record event
      this.context.recordEvent?.('precedent_search', { 
        decisionType: params.decisionType,
        resultCount: precedents.length,
        hasTextQuery: !!params.queryText
      })

      return precedents
    } catch (error) {
      console.warn('Precedent search failed:', error)
      this.context.recordEvent?.('precedent_search_failed', { 
        error: error instanceof Error ? error.message : String(error)
      })
      return []
    }
  }

  /**
   * Request approval and capture approval chain
   * 
   * @param params Approval parameters
   * @returns Approval response with approver details
   */
  protected async requestApproval(params: {
    approvalType: string
    reason: string
    data: any
    requiredRole?: string
  }): Promise<{
    approved: boolean
    approver?: { userId: string; role: string; comment?: string }
    approvedAt?: number
  }> {
    // TODO: Implement approval workflow integration
    // For now, this is a placeholder that records the approval request
    
    this.context.recordEvent?.('approval_requested', {
      approvalType: params.approvalType,
      reason: params.reason,
      requiredRole: params.requiredRole
    })

    // Placeholder: auto-approve for now
    return {
      approved: true,
      approver: {
        userId: 'system',
        role: 'auto',
        comment: 'Auto-approved (approval workflow not yet implemented)'
      },
      approvedAt: Date.now()
    }
  }

  /**
   * Get active policy for decision-making
   * 
   * Checks if an A/B test is running and returns appropriate policy version.
   * Falls back to active policy if no test or PolicyMemory not configured.
   * 
   * @param policyId Policy ID to retrieve
   * @returns Policy version to use, or null if not found
   */
  protected async getActivePolicy(policyId: string): Promise<{
    id: string;
    version: string;
    rule: string;
    isTestVariant?: boolean;
    testId?: string;
  } | null> {
    if (!this.policyMemory) {
      return null;
    }

    try {
      // Check for active A/B tests
      // For simplicity, we'll just get the active policy
      // In production, you'd check A/B test assignments here
      const policy = await this.policyMemory.getPolicy(policyId);
      
      if (!policy) {
        return null;
      }

      return {
        id: policy.id,
        version: policy.version,
        rule: policy.rule
      };
    } catch (error) {
      console.warn('Failed to get active policy:', error);
      return null;
    }
  }

  /**
   * Track policy effectiveness after decision outcome is known
   * 
   * Called automatically when trackDecisionOutcome() is used.
   * Updates policy metrics in PolicyMemory.
   * 
   * @param decisionId The decision ID
   * @param wasCorrect Whether the decision outcome was correct
   */
  private async updatePolicyEffectiveness(
    decisionId: string,
    wasCorrect: boolean
  ): Promise<void> {
    if (!this.policyMemory || !this.decisionMemory) {
      return;
    }

    try {
      // Get the decision to find its policy
      const decision = await this.decisionMemory.getDecision(decisionId);
      if (!decision || !decision.policy) {
        return;
      }

      // Policy effectiveness is calculated on-demand via calculatePolicyEffectiveness()
      // This method just records that the outcome was tracked
      this.context.recordEvent?.('policy_effectiveness_updated', {
        policyId: decision.policy.id,
        version: decision.policy.version,
        wasCorrect
      });
    } catch (error) {
      console.warn('Failed to update policy effectiveness:', error);
    }
  }

  /**
   * Request policy suggestions based on exception patterns
   * 
   * Analyzes recent exceptions and suggests policy changes.
   * Useful for continuous policy improvement.
   * 
   * @param policyId Policy to analyze
   * @param minFrequency Minimum exception frequency to trigger suggestion
   * @returns Array of policy suggestions
   */
  protected async requestPolicySuggestions(
    policyId: string,
    minFrequency: number = 5
  ): Promise<Array<{
    suggestedRule: string;
    changeReason: string;
    expectedImpact: {
      exceptionReduction: number;
      affectedDecisions: number;
      confidence: number;
    };
  }>> {
    if (!this.policyMemory) {
      this.context.recordEvent?.('policy_suggestions_failed', {
        reason: 'policy_memory_not_configured'
      });
      return [];
    }

    try {
      const suggestions = await this.policyMemory.generatePolicySuggestions(
        policyId,
        minFrequency
      );

      this.context.recordEvent?.('policy_suggestions_generated', {
        policyId,
        count: suggestions.length
      });

      return suggestions.map(s => ({
        suggestedRule: s.suggestedRule,
        changeReason: s.changeReason,
        expectedImpact: s.expectedImpact
      }));
    } catch (error) {
      console.warn('Failed to generate policy suggestions:', error);
      this.context.recordEvent?.('policy_suggestions_failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Determine if decision should be enriched with LLM analysis
   * 
   * Decision logic:
   * 1. Check explicit override (enrichWithLLM param)
   * 2. Check config mode ('never' | 'hybrid' | 'always')
   * 3. Check budget limits
   * 4. Check auto-enrich triggers
   */
  private async shouldEnrichWithLLM(params: {
    decisionType: DecisionTrace['decisionType']
    isException: boolean
    approvers?: any[]
    enrichWithLLM?: 'always' | 'never'
  }): Promise<boolean> {
    // Explicit override
    if (params.enrichWithLLM === 'never') return false
    if (params.enrichWithLLM === 'always') return true

    // Get config (use default if not configured)
    const config = await this.getDecisionTraceConfig()

    // Check mode
    if (config.llmEnrichment.mode === 'never') return false
    if (config.llmEnrichment.mode === 'always') return true

    // Check budget limits (hybrid mode)
    if (!this.checkEnrichmentBudget(config)) return false

    // Check auto-enrich triggers
    const shouldEnrich = config.llmEnrichment.autoEnrichOn.includes(params.decisionType)
    
    return shouldEnrich
  }

  /**
   * Enrich decision trace with LLM analysis (async)
   */
  private async enrichTraceWithLLM(trace: DecisionTrace): Promise<void> {
    const config = await this.getDecisionTraceConfig()
    const startTime = Date.now()

    try {
      // Get LLM config
      const llmConfig = await this.tryGetConfig('critic-llm')
      if (!llmConfig) {
        console.warn('LLM enrichment requested but critic-llm not configured')
        return
      }

      // Build prompt for LLM critic
      const prompt = this.buildCriticPrompt(trace)

      // TODO: Call LLM API (requires LLM client integration)
      // For now, this is a placeholder that shows the structure
      
      const llmResponse: LLMDecisionAnalysis = {
        deeperRationale: `[LLM Analysis Placeholder] ${trace.rationale}`,
        criticalFactors: trace.inputs.map(input => ({
          factor: input.relevance,
          impact: 'medium' as const,
          reasoning: `System ${input.system} provided ${input.entity} data`
        })),
        riskAssessment: {
          level: trace.isException ? 'medium' : 'low',
          factors: trace.isException ? ['Exception to policy'] : [],
          mitigation: 'Standard approval process followed'
        },
        alternativeAnalysis: [],
        generatedAt: Date.now(),
        model: config.llmEnrichment.critic.model,
        confidence: 0.85
      }

      // Update trace with LLM analysis
      trace.llmAnalysis = llmResponse

      // Increment budget counter
      this.enrichmentBudgetUsed++

      // Emit metrics
      const duration = Date.now() - startTime
      this.context.recordMetric?.('decision_enrichment_duration_ms', duration, {
        model: config.llmEnrichment.critic.model
      })
      this.context.recordEvent?.('decision_enriched', {
        decisionId: trace.decisionId,
        duration,
        confidence: llmResponse.confidence
      })

    } catch (error: any) {
      const duration = Date.now() - startTime
      this.context.recordMetric?.('decision_enrichment_duration_ms', duration, {
        error: 'true'
      })
      throw error
    }
  }

  /**
   * Build LLM critic prompt from decision trace
   */
  private buildCriticPrompt(trace: DecisionTrace): string {
    return `You are analyzing a decision made by an AI agent. Explain WHY this decision was made.

DECISION: ${trace.decisionType} - ${trace.rationale}

INPUTS:
${trace.inputs.map(input => 
  `- ${input.system}.${input.entity}: ${input.relevance}\n  Query: ${input.query}\n  Result: ${JSON.stringify(input.result)}`
).join('\n')}

OUTCOME: ${JSON.stringify(trace.outcome)}

${trace.policy ? `POLICY: ${trace.policy.rule}` : ''}
${trace.isException ? `EXCEPTION REASON: ${trace.exceptionReason}` : ''}
${trace.precedents?.length ? `PRECEDENTS: ${trace.precedents.length} similar decisions found` : ''}

TASK: Generate a clear, structured explanation:
1. What factors led to this decision?
2. How did inputs influence the outcome?
3. ${trace.isException ? 'Why was the exception justified?' : 'How does this align with policy?'}
4. What alternatives were considered?
5. What risks should be monitored?

Provide your analysis in JSON format:
{
  "deeperRationale": "...",
  "criticalFactors": [{ "factor": "...", "impact": "high|medium|low", "reasoning": "..." }],
  "riskAssessment": { "level": "low|medium|high", "factors": [], "mitigation": "..." },
  "alternativeAnalysis": [{ "alternative": "...", "pros": [], "cons": [], "whyRejected": "..." }]
}
`
  }

  /**
   * Get decision trace configuration (with defaults)
   */
  private async getDecisionTraceConfig(): Promise<DecisionTraceConfig> {
    if (this.decisionTraceConfig) return this.decisionTraceConfig

    // Try to load from config
    const configuredValue = await this.tryGetConfig<DecisionTraceConfig>('decisionTraces')
    
    // Merge with defaults
    this.decisionTraceConfig = configuredValue 
      ? { ...DEFAULT_DECISION_TRACE_CONFIG, ...configuredValue }
      : DEFAULT_DECISION_TRACE_CONFIG

    return this.decisionTraceConfig
  }

  /**
   * Check if enrichment budget is available
   */
  private checkEnrichmentBudget(config: DecisionTraceConfig): boolean {
    // Reset daily budget if needed
    const now = Date.now()
    const dayInMs = 24 * 60 * 60 * 1000
    if (now - this.enrichmentBudgetResetTime > dayInMs) {
      this.enrichmentBudgetUsed = 0
      this.enrichmentBudgetResetTime = now
    }

    // Check if under budget
    return this.enrichmentBudgetUsed < config.budgets.maxEnrichmentsPerDay
  }

  // ============================================================================
  // Decision Replay & Audit Methods
  // ============================================================================

  /**
   * Get complete decision explanation (audit trail)
   * Shows WHY a decision was made with full context
   * 
   * @param decisionId The decision to explain
   * @returns Complete audit trail with all context
   */
  protected async getDecisionExplanation(decisionId: string): Promise<DecisionExplanation> {
    // Find decision in journal
    const decisionEntry = this.journal.entries.find(
      (e): e is DecisionJournalEntry => 
        e.type === 'decision_made' && e.decisionId === decisionId
    )

    if (!decisionEntry) {
      throw new Error(`Decision ${decisionId} not found in journal`)
    }

    // Reconstruct decision trace
    const decision: DecisionTrace = {
      decisionId: decisionEntry.decisionId,
      timestamp: decisionEntry.timestamp,
      actorId: this.context.actorId,
      actorType: this.constructor.name,
      decisionType: decisionEntry.decisionType,
      rationale: decisionEntry.rationale,
      reasoning: decisionEntry.reasoning,
      inputs: decisionEntry.inputs,
      outcome: decisionEntry.outcome,
      policy: decisionEntry.policy,
      precedents: decisionEntry.precedents,
      isException: decisionEntry.isException,
      exceptionReason: decisionEntry.exceptionReason,
      approvers: decisionEntry.approvers,
      context: decisionEntry.context
    }

    // Get context gathering entries
    const contextEntries = this.journal.entries.filter(
      (e): e is ContextGatheredEntry =>
        e.type === 'context_gathered' && e.decisionId === decisionId
    )

    // Get precedent entries (stub for Phase 2 - will query DecisionMemory)
    const precedentEntries = this.journal.entries.filter(
      (e): e is PrecedentReferencedEntry =>
        e.type === 'precedent_referenced' && e.decisionId === decisionId
    )

    const precedents = precedentEntries.map(p => ({
      decisionId: p.precedentId,
      rationale: 'Precedent details would come from DecisionMemory in Phase 2',
      relevance: p.relevance,
      similarity: 0.85
    }))

    // Build timeline
    const timeline = [
      ...contextEntries.map(e => ({
        timestamp: e.retrievedAt,
        event: 'context_gathered',
        description: `Retrieved ${e.entity} from ${e.system}`,
        metadata: { system: e.system, relevance: e.relevance }
      })),
      ...precedentEntries.map(e => ({
        timestamp: e.retrievedAt,
        event: 'precedent_referenced',
        description: `Referenced precedent ${e.precedentId}`,
        metadata: { precedentId: e.precedentId }
      })),
      {
        timestamp: decisionEntry.timestamp,
        event: 'decision_made',
        description: `Decision recorded: ${decisionEntry.decisionType}`,
        metadata: { isException: decisionEntry.isException }
      }
    ].sort((a, b) => a.timestamp - b.timestamp)

    // Check for outcome tracking
    const outcomeEntry = this.journal.entries.find(
      (e): e is DecisionOutcomeEntry =>
        e.type === 'decision_outcome_tracked' && e.decisionId === decisionId
    )

    const outcome = outcomeEntry ? {
      wasCorrect: outcomeEntry.wasCorrect,
      actualResult: outcomeEntry.actualResult,
      feedback: outcomeEntry.feedback,
      trackedAt: outcomeEntry.trackedAt,
      trackedBy: outcomeEntry.trackedBy
    } : undefined

    return {
      decision,
      inputDetails: decisionEntry.inputs,
      precedents,
      policyDetails: decisionEntry.policy
        ? {
            id: decisionEntry.policy.id,
            version: decisionEntry.policy.version,
            rule: decisionEntry.policy.rule,
            source: 'ConfigResolver'
          }
        : {
            id: 'none',
            version: 'N/A',
            rule: 'No policy applied',
            source: 'N/A'
          },
      approvalChain: (decisionEntry.approvers || []).map((a, i) => ({
        step: i + 1,
        userId: a.userId,
        role: a.role,
        approvedAt: a.approvedAt,
        comment: a.comment,
        decision: 'approved' as const
      })),
      timeline,
      outcome
    }
  }

  /**
   * Replay a decision with current policy (what-if analysis)
   * Shows how the decision would differ if made today
   * 
   * @param decisionId The decision to replay
   * @returns Comparison of original vs current
   */
  protected async replayDecision(decisionId: string): Promise<DecisionReplayResult> {
    // Get original decision
    const decisionEntry = this.journal.entries.find(
      (e): e is DecisionJournalEntry => 
        e.type === 'decision_made' && e.decisionId === decisionId
    )

    if (!decisionEntry) {
      throw new Error(`Decision ${decisionId} not found in journal`)
    }

    const originalDecision: DecisionTrace = {
      decisionId: decisionEntry.decisionId,
      timestamp: decisionEntry.timestamp,
      actorId: this.context.actorId,
      actorType: this.constructor.name,
      decisionType: decisionEntry.decisionType,
      rationale: decisionEntry.rationale,
      reasoning: decisionEntry.reasoning,
      inputs: decisionEntry.inputs,
      outcome: decisionEntry.outcome,
      policy: decisionEntry.policy,
      precedents: decisionEntry.precedents,
      isException: decisionEntry.isException,
      exceptionReason: decisionEntry.exceptionReason,
      approvers: decisionEntry.approvers,
      context: decisionEntry.context
    }

    // Get current policy (might have changed)
    let currentPolicy: { id: string; version: string; rule: string } | undefined
    let policyChanged = false

    if (decisionEntry.policy) {
      try {
        const currentPolicyValue = await this.tryGetConfig(decisionEntry.policy.id)
        if (currentPolicyValue) {
          currentPolicy = {
            id: decisionEntry.policy.id,
            version: 'current',
            rule: JSON.stringify(currentPolicyValue)
          }
          policyChanged = decisionEntry.policy.rule !== currentPolicy.rule
        }
      } catch {
        // Policy no longer exists or can't be retrieved
        policyChanged = true
      }
    }

    // Simulate decision with current policy
    // This is a simplified simulation - full implementation would re-run decision logic
    const simulatedOutcome = policyChanged
      ? { simulated: true, note: 'Policy changed - outcome may differ' }
      : decisionEntry.outcome

    const wouldDecideDifferently = policyChanged

    // Build differences
    const differences: Array<{ aspect: string; original: any; current: any; reason: string }> = []

    if (policyChanged) {
      differences.push({
        aspect: 'policy',
        original: decisionEntry.policy?.rule,
        current: currentPolicy?.rule,
        reason: 'Policy has been updated since this decision was made'
      })
    }

    // Check for new precedents (Phase 2 will implement this)
    // For now, just note that precedent search would be different
    if (decisionEntry.precedents && decisionEntry.precedents.length > 0) {
      differences.push({
        aspect: 'precedents',
        original: `${decisionEntry.precedents.length} precedents`,
        current: 'Precedent count may differ (requires DecisionMemory)',
        reason: 'More decisions may have been recorded since then'
      })
    }

    this.context.recordEvent?.('decision_replayed', {
      decisionId,
      policyChanged,
      wouldDecideDifferently
    })

    return {
      originalDecision,
      replayedAt: Date.now(),
      policyChanged,
      currentPolicy,
      policyDiff: policyChanged
        ? `Original: ${decisionEntry.policy?.version || 'N/A'} → Current: ${currentPolicy?.version || 'N/A'}`
        : undefined,
      simulatedOutcome,
      wouldDecideDifferently,
      differences
    }
  }

  /**
   * Track outcome of a decision (for measuring accuracy)
   * Call this after you know if the decision was correct
   * 
   * @param decisionId The decision to track
   * @param outcome The actual outcome
   */
  protected async trackDecisionOutcome(
    decisionId: string,
    outcome: {
      wasCorrect: boolean
      actualResult?: any
      feedback?: string
    }
  ): Promise<void> {
    const entry: DecisionOutcomeEntry = {
      type: 'decision_outcome_tracked',
      decisionId,
      wasCorrect: outcome.wasCorrect,
      actualResult: outcome.actualResult,
      feedback: outcome.feedback,
      trackedAt: Date.now(),
      trackedBy: (this.context as any).userId || 'system'
    }

    this.journal.entries.push(entry)

    this.context.recordEvent?.('decision_outcome_tracked', {
      decisionId,
      wasCorrect: outcome.wasCorrect
    })

    this.context.recordMetric?.('decision_accuracy', outcome.wasCorrect ? 1 : 0, {
      decisionId,
      actorType: this.constructor.name
    })

    // Update policy effectiveness (Phase 3)
    await this.updatePolicyEffectiveness(decisionId, outcome.wasCorrect)
  }

  /**
   * Get all decisions from journal (for audit)
   * 
   * @param filter Optional filter criteria
   * @returns Array of decision traces
   */
  protected getDecisionsFromJournal(filter?: {
    decisionType?: DecisionTrace['decisionType']
    isException?: boolean
    startTime?: number
    endTime?: number
  }): DecisionTrace[] {
    let decisions = this.journal.entries
      .filter((e): e is DecisionJournalEntry => e.type === 'decision_made')
      .map(e => ({
        decisionId: e.decisionId,
        timestamp: e.timestamp,
        actorId: this.context.actorId,
        actorType: this.constructor.name,
        decisionType: e.decisionType,
        rationale: e.rationale,
        reasoning: e.reasoning,
        inputs: e.inputs,
        outcome: e.outcome,
        policy: e.policy,
        precedents: e.precedents,
        isException: e.isException,
        exceptionReason: e.exceptionReason,
        approvers: e.approvers,
        context: e.context
      }))

    if (!filter) return decisions

    if (filter.decisionType) {
      decisions = decisions.filter(d => d.decisionType === filter.decisionType)
    }

    if (filter.isException !== undefined) {
      decisions = decisions.filter(d => d.isException === filter.isException)
    }

    if (filter.startTime) {
      decisions = decisions.filter(d => d.timestamp >= filter.startTime!)
    }

    if (filter.endTime) {
      decisions = decisions.filter(d => d.timestamp <= filter.endTime!)
    }

    return decisions
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
