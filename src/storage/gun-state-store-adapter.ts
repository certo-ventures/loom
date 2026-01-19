/**
 * GUN StateStore Adapter
 * 
 * Bridges between legacy StateStore interface and new IStateStore interface
 */

import type { StateStore } from './state-store'
import type { ActorState, TraceContext } from '../types'
import type { IStateStore, ActorState as NewActorState } from '../services/loommesh/state-store'

/**
 * Adapter that wraps IStateStore to implement legacy StateStore interface
 */
export class GunStateStoreAdapter implements StateStore {
  constructor(private store: IStateStore) {}

  async save(actorId: string, state: ActorState, trace?: TraceContext): Promise<void> {
    // Convert legacy ActorState to new ActorState format
    const newState: NewActorState = {
      actorId: state.id,
      actorType: state.actorType,
      state: state.state,
      version: 0, // Will be managed by patch-based store
      baseVersion: 0,
      createdAt: typeof state.createdAt === 'string' 
        ? Date.parse(state.createdAt) 
        : Date.now(),
      lastModified: typeof state.lastActivatedAt === 'string'
        ? Date.parse(state.lastActivatedAt)
        : Date.now(),
      metadata: state.metadata || {}
    }
    
    await this.store.set(state.id, newState)
  }

  async load(actorId: string): Promise<ActorState | null> {
    const newState = await this.store.get(actorId)
    if (!newState) return null

    // Convert new ActorState to legacy format
    return {
      id: newState.actorId,
      partitionKey: newState.actorType,
      actorType: newState.actorType,
      status: 'active',
      state: newState.state,
      correlationId: newState.actorId,
      createdAt: new Date(newState.createdAt).toISOString(),
      lastActivatedAt: new Date(newState.lastModified).toISOString(),
      metadata: newState.metadata
    }
  }

  async delete(actorId: string): Promise<void> {
    await this.store.delete(actorId)
  }

  async query(actorType: string, limit?: number): Promise<ActorState[]> {
    const states = await this.store.query({
      actorType,
      limit,
      sortBy: 'lastModified',
      sortOrder: 'desc'
    })

    // Convert to legacy format
    return states.map(s => ({
      id: s.actorId,
      partitionKey: s.actorType,
      actorType: s.actorType,
      status: 'active' as const,
      state: s.state,
      correlationId: s.actorId,
      createdAt: new Date(s.createdAt).toISOString(),
      lastActivatedAt: new Date(s.lastModified).toISOString(),
      metadata: s.metadata
    }))
  }
}

