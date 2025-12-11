import type { Journal, JournalEntry, ActorContext } from './journal'
import type { StreamChunk } from '../streaming/types'

/**
 * Base Actor class - all actors extend this
 * Uses journal-based execution for deterministic replay
 */
export abstract class Actor {
  protected state: Record<string, unknown>
  protected context: ActorContext
  
  private journal: Journal
  private isReplaying: boolean = false
  private activityCounter: number = 0

  constructor(context: ActorContext, initialState?: Record<string, unknown>) {
    this.context = context
    this.state = initialState ?? this.getDefaultState()
    this.journal = { entries: [], cursor: 0 }
  }

  /**
   * Override to provide default state
   */
  protected getDefaultState(): Record<string, unknown> {
    return {}
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
      this.journal.entries.push({
        type: 'state_updated',
        state: this.state,
      })
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
    }

    return childId
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
