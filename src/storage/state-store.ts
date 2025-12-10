import type { ActorState } from '../types'

/**
 * StateStore - Persist and retrieve actor state
 */
export interface StateStore {
  /**
   * Save actor state
   */
  save(actorId: string, state: ActorState): Promise<void>

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
