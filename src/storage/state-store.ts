import type { ActorState, TraceContext } from '../types'

/**
 * StateStore - Persist and retrieve actor state
 */
export interface StateStore {
  /**
   * Save actor state
   * @param trace - Optional trace context for observability
   */
  save(actorId: string, state: ActorState, trace?: TraceContext): Promise<void>

  /**
   * Load actor state by ID
   */
  load(actorId: string): Promise<ActorState | null>

  /**
   * Delete actor state
   */
  delete(actorId: string): Promise<void>

  /**
   * Query actors by type
   */
  query(actorType: string, limit?: number): Promise<ActorState[]>
}
