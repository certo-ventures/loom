import type { ActorState, TraceContext } from '../types'
import type { StateStore } from './state-store'

/**
 * InMemoryStateStore - Simple in-memory implementation for testing
 */
export class InMemoryStateStore implements StateStore {
  private store = new Map<string, ActorState>()

  async save(actorId: string, state: ActorState, trace?: TraceContext): Promise<void> {
    this.store.set(actorId, state)
  }

  async load(actorId: string): Promise<ActorState | null> {
    return this.store.get(actorId) ?? null
  }

  async delete(actorId: string): Promise<void> {
    this.store.delete(actorId)
  }

  async query(actorType: string, limit?: number): Promise<ActorState[]> {
    const results = Array.from(this.store.values())
      .filter(state => state.actorType === actorType)
    
    return limit ? results.slice(0, limit) : results
  }

  // Helper for testing
  clear(): void {
    this.store.clear()
  }
}
