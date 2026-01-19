/**
 * LoomMesh State Store
 * 
 * Distributed actor state storage built on GUN.
 * Provides CRUD operations, indexing, and conflict resolution for actor state.
 */

import type { IGunInstance } from 'gun'
import type { Patch } from 'immer'
import { applyPatches, produceWithPatches, enablePatches } from 'immer'
import 'gun/lib/open.js' // Load open extension for deep nested object retrieval

// Enable Immer patches plugin
enablePatches()

/**
 * Actor state document (reconstituted from patches)
 */
export interface ActorState {
  actorId: string
  actorType: string
  state: Record<string, any>
  version: number  // Current patch count
  baseVersion: number  // Version of last snapshot
  lastModified: number
  createdAt: number
  metadata?: Record<string, any>
}

/**
 * Stored patch entry
 */
export interface PatchEntry {
  timestamp: number
  patches: Patch[]
  version: number
  actorId: string
}

/**
 * Query options for finding actors
 */
export interface StateQueryOptions {
  actorType?: string
  limit?: number
  offset?: number
  sortBy?: 'createdAt' | 'lastModified' | 'actorId'
  sortOrder?: 'asc' | 'desc'
}

/**
 * State store interface
 */
export interface IStateStore {
  /**
   * Get actor state by ID
   */
  get(actorId: string): Promise<ActorState | null>
  
  /**
   * Set/update actor state
   */
  set(actorId: string, state: Partial<ActorState>): Promise<ActorState>
  
  /**
   * Delete actor state
   */
  delete(actorId: string): Promise<boolean>
  
  /**
   * Check if actor exists
   */
  exists(actorId: string): Promise<boolean>
  
  /**
   * Query actors by criteria
   */
  query(options: StateQueryOptions): Promise<ActorState[]>
  
  /**
   * Get all actor IDs
   */
  getAllIds(): Promise<string[]>
  
  /**
   * Get actors by type
   */
  getByType(actorType: string): Promise<ActorState[]>
  
  /**
   * Update partial state (merge)
   */
  update(actorId: string, partialState: Record<string, any>): Promise<ActorState>
  
  /**
   * List actors by ID prefix
   */
  list(prefix?: string): Promise<string[]>
  
  /**
   * Append Immer patches (event sourcing)
   */
  appendPatches(actorId: string, patches: Patch[], version?: number): Promise<void>
  
  /**
   * Get patches since version (for replay)
   */
  getPatches(actorId: string, sinceVersion?: number): Promise<PatchEntry[]>
  
  /**
   * Get state at specific version (time-travel)
   */
  getStateAt(actorId: string, version: number): Promise<ActorState | null>
  
  /**
   * Create snapshot (checkpoint for performance)
   */
  snapshot(actorId: string): Promise<void>
  
  /**
   * Clear all state (for testing)
   */
  clear(): Promise<void>
}

/**
 * GUN-based state store implementation
 */
export class LoomMeshStateStore implements IStateStore {
  private gun: IGunInstance
  
  constructor(gun: IGunInstance) {
    this.gun = gun
  }
  
  /**
   * Update indexes when actor state changes
   */
  private async updateIndexes(actorId: string, actorType: string): Promise<void> {
    // Update actors:all index
    this.gun.get('index:actors:all').get(actorId).put(true)
    
    // Update actors:by_type index
    this.gun.get(`index:actors:by_type:${actorType}`).get(actorId).put(true)
  }
  
  /**
   * Remove from indexes when actor deleted
   */
  private async removeFromIndexes(actorId: string, actorType: string): Promise<void> {
    // Remove from actors:all index
    this.gun.get('index:actors:all').get(actorId).put(null)
    
    // Remove from actors:by_type index
    this.gun.get(`index:actors:by_type:${actorType}`).get(actorId).put(null)
  }
  
  /**
   * Get actor state by ID
   * Returns base snapshot (already includes all patches applied via .set())
   */
  async get(actorId: string): Promise<ActorState | null> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout getting actor state for ${actorId}`))
      }, 3000)
      
      // Load base snapshot - it's already the current state
      this.gun.get('actors').get(actorId).once((data: any) => {
        clearTimeout(timeout)
        
        if (!data || data === null) {
          resolve(null)
          return
        }
        
        // Remove GUN metadata and deserialize
        const { _, ...baseState } = data
        const actorState = baseState as any
        
        // Deserialize JSON fields
        if (typeof actorState.state === 'string') {
          actorState.state = JSON.parse(actorState.state)
        }
        if (typeof actorState.metadata === 'string') {
          actorState.metadata = JSON.parse(actorState.metadata)
        }
        
        resolve(actorState as ActorState)
      })
    })
  }
  
  /**
   * Set/update actor state (internally uses patches)
   * This generates patches and appends them to the event log
   */
  async set(actorId: string, state: Partial<ActorState>): Promise<ActorState> {
    const now = Date.now()
    
    // Load existing state WITHOUT using .get() to avoid recursion
    const existing = await new Promise<ActorState | null>((resolve) => {
      let resolved = false
      
      this.gun.get('actors').get(actorId).once((data: any) => {
        if (resolved) return
        resolved = true
        
        if (!data || data === null) {
          resolve(null)
          return
        }
        
        // Deserialize from GUN storage
        const { _, ...baseState } = data
        if (typeof baseState.state === 'string') {
          baseState.state = JSON.parse(baseState.state)
        }
        if (typeof baseState.metadata === 'string') {
          baseState.metadata = JSON.parse(baseState.metadata)
        }
        
        resolve(baseState as ActorState)
      })
      
      // Timeout after 2s - resolve with null (new actor)
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          resolve(null)
        }
      }, 2000)
    })
    
    // Prepare new state
    const newState = state.state || existing?.state || {}
    const oldState = existing?.state || {}
    
    // Generate patches using Immer
    const [nextState, patches] = produceWithPatches(oldState, (draft) => {
      Object.assign(draft, newState)
    })
    
    // Create actor state document
    // NOTE: GUN doesn't handle nested objects well in callbacks, so we JSON-ify the state
    const actorState: ActorState = {
      actorId,
      actorType: state.actorType || existing?.actorType || 'unknown',
      state: nextState,
      version: (existing?.version || 0) + 1,
      baseVersion: existing?.baseVersion || 0,
      lastModified: now,
      createdAt: existing?.createdAt || now,
      metadata: state.metadata || existing?.metadata || {}
    }
    
    // Serialize for GUN storage (flatten nested objects)
    const serialized = {
      ...actorState,
      state: JSON.stringify(actorState.state),
      metadata: JSON.stringify(actorState.metadata)
    }
    
    // Store base snapshot
    await new Promise<void>((resolve, reject) => {
      let resolved = false
      
      this.gun.get('actors').get(actorId).put(serialized, (ack: any) => {
        if (resolved) return
        resolved = true
        
        if (ack.err) {
          reject(new Error(`Failed to store actor state: ${ack.err}`))
          return
        }
        
        // Update type index
        this.gun.get('actorTypes').get(actorState.actorType).get(actorId).put(true)
        resolve()
      })
      
      // Timeout after 5s
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          reject(new Error(`Timeout storing actor state for ${actorId}`))
        }
      }, 5000)
    })
    
    // Append patches if there are any changes
    if (patches.length > 0) {
      await this.appendPatches(actorId, patches, actorState.version)
    }
    
    // Update indexes
    await this.updateIndexes(actorId, actorState.actorType)
    
    return actorState
  }
  
  /**
   * Delete actor state
   */
  async delete(actorId: string): Promise<boolean> {
    const existing = await this.get(actorId).catch(() => null)
    if (!existing) return false
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Delete operation timed out'))
      }, 3000)
      
      // GUN doesn't have true delete, so we set to null
      this.gun.get('actors').get(actorId).put(null, (ack: any) => {
        clearTimeout(timeout)
        
        if (ack.err) {
          resolve(false)
          return
        }
        
        // Remove from type index
        if (existing.actorType) {
          this.gun.get('actorTypes').get(existing.actorType).get(actorId).put(null)
        }
        
        // Remove from indexes
        this.removeFromIndexes(actorId, existing.actorType)
        
        resolve(true)
      })
    })
  }
  
  /**
   * Check if actor exists
   */
  async exists(actorId: string): Promise<boolean> {
    const state = await this.get(actorId)
    return state !== null
  }
  
  /**
   * Query actors by criteria
   */
  async query(options: StateQueryOptions): Promise<ActorState[]> {
    let actors: ActorState[]
    
    if (options.actorType) {
      actors = await this.getByType(options.actorType)
    } else {
      const ids = await this.getAllIds()
      actors = await Promise.all(
        ids.map(id => this.get(id).then(s => s!))
      )
      actors = actors.filter(a => a !== null)
    }
    
    // Sort
    if (options.sortBy) {
      const sortKey = options.sortBy
      const sortOrder = options.sortOrder || 'asc'
      actors.sort((a, b) => {
        const aVal = a[sortKey]
        const bVal = b[sortKey]
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
        return sortOrder === 'asc' ? cmp : -cmp
      })
    }
    
    // Pagination
    const offset = options.offset || 0
    const limit = options.limit || actors.length
    return actors.slice(offset, offset + limit)
  }
  
  /**
   * Get all actor IDs (optimized with index)
   */
  async getAllIds(): Promise<string[]> {
    return new Promise((resolve) => {
      const ids: string[] = []
      
      // Use index for fast lookup
      this.gun.get('index:actors:all').map().once((exists: any, id: string) => {
        if (exists && id !== '_') {
          ids.push(id)
        }
      })
      
      // Fallback to scanning actors if index empty
      setTimeout(() => {
        if (ids.length === 0) {
          this.gun.get('actors').map().once((data: any, id: string) => {
            if (data && id !== '_') {
              ids.push(id)
            }
          })
        }
      }, 100)
      
      // Wait for GUN to emit all data
      setTimeout(() => resolve(ids), 300)
    })
  }
  
  /**
   * Get actors by type (optimized with index)
   */
  async getByType(actorType: string): Promise<ActorState[]> {
    return new Promise((resolve) => {
      const ids: string[] = []
      
      // Use index for fast lookup
      this.gun.get(`index:actors:by_type:${actorType}`).map().once((exists: any, id: string) => {
        if (exists && id !== '_') {
          ids.push(id)
        }
      })
      
      // Fallback to old type index
      setTimeout(() => {
        if (ids.length === 0) {
          this.gun.get('actorTypes').get(actorType).map().once((exists: any, id: string) => {
            if (exists && id !== '_') {
              ids.push(id)
            }
          })
        }
      }, 100)
      
      setTimeout(async () => {
        const states = await Promise.all(
          ids.map(id => this.get(id))
        )
        resolve(states.filter(s => s !== null) as ActorState[])
      }, 300)
    })
  }
  
  /**
   * Update partial state (merge)
   */
  async update(actorId: string, partialState: Record<string, any>): Promise<ActorState> {
    const existing = await this.get(actorId)
    if (!existing) {
      throw new Error(`Actor ${actorId} not found`)
    }
    
    const mergedState = {
      ...existing.state,
      ...partialState
    }
    
    return this.set(actorId, {
      ...existing,
      state: mergedState
    })
  }
  
  /**
   * List actors by ID prefix
   */
  async list(prefix?: string): Promise<string[]> {
    const allIds = await this.getAllIds()
    
    if (!prefix) {
      return allIds
    }
    
    return allIds.filter(id => id.startsWith(prefix))
  }
  
  /**
   * Clear all state (for testing)
   */
  async clear(): Promise<void> {
    const ids = await this.getAllIds()
    await Promise.all(ids.map(id => this.delete(id)))
  }
  
  /**
   * Append Immer patches (event sourcing)
   * Note: Version should already be set by caller (typically .set())
   */
  async appendPatches(actorId: string, patches: Patch[], version?: number): Promise<void> {
    const now = Date.now()
    
    // If version not provided, get current and increment
    if (version === undefined) {
      const existing = await this.get(actorId)
      version = (existing?.version || 0) + 1
    }
    
    const patchEntry: PatchEntry = {
      timestamp: now,
      patches,
      version,
      actorId
    }
    
    // Serialize patches as JSON string (GUN doesn't support arrays directly)
    const serialized = {
      ...patchEntry,
      patches: JSON.stringify(patches)
    }
    
    return new Promise((resolve, reject) => {
      // Store patches in ordered set (GUN's .set() for list)
      this.gun.get('patches').get(actorId).set(serialized, (ack: any) => {
        if (ack.err) {
          reject(new Error(`Failed to append patches: ${ack.err}`))
          return
        }
        resolve()
      })
    })
  }
  
  /**
   * Get patches since version (for replay)
   */
  async getPatches(actorId: string, sinceVersion: number = 0): Promise<PatchEntry[]> {
    return new Promise((resolve) => {
      const patches: PatchEntry[] = []
      
      // Get all patches for this actor
      this.gun.get('patches').get(actorId).map().once((patch: any, key: string) => {
        if (patch && patch.version !== undefined && patch.version > sinceVersion) {
          const { _, ...entry } = patch
          // Deserialize patches from JSON string
          const patchesData = typeof entry.patches === 'string' 
            ? JSON.parse(entry.patches) 
            : entry.patches
          patches.push({ ...entry, patches: patchesData } as PatchEntry)
        }
      })
      
      // Wait longer for async collection
      setTimeout(() => {
        // Sort by version
        patches.sort((a, b) => a.version - b.version)
        resolve(patches)
      }, 300)
    })
  }
  
  /**
   * Get state at specific version (time-travel)
   */
  async getStateAt(actorId: string, targetVersion: number): Promise<ActorState | null> {
    const current = await this.get(actorId)
    if (!current) return null
    
    // If requesting current or future, return current
    if (targetVersion >= current.version) {
      return current
    }
    
    // We need to reconstruct from base snapshot + patches
    // Get the BASE snapshot state (without any applied patches)
    const baseSnapshot = await new Promise<any>((resolve) => {
      let resolved = false
      
      this.gun.get('actors').get(actorId).once((data: any) => {
        if (resolved) return
        resolved = true
        
        if (!data) {
          resolve(null)
          return
        }
        const { _, ...base } = data
        // Deserialize state
        if (typeof base.state === 'string') {
          base.state = JSON.parse(base.state)
        }
        resolve(base)
      })
      
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          resolve(null)
        }
      }, 2000)
    })
    
    if (!baseSnapshot) return null
    
    const baseVersion = baseSnapshot.baseVersion || 0
    
    // Get all patches and filter to target version
    const patches = await this.getPatches(actorId, baseVersion)
    const relevantPatches = patches
      .filter(p => p.version > baseVersion && p.version <= targetVersion)
      .flatMap(p => p.patches)
    
    // Apply patches from base to reconstruct state at target version
    let state = baseSnapshot.state
    if (relevantPatches.length > 0) {
      state = applyPatches(state, relevantPatches)
    }
    
    return {
      ...current,
      state,
      version: targetVersion
    }
  }
  
  /**
   * Create snapshot (checkpoint for performance)
   */
  async snapshot(actorId: string): Promise<void> {
    const current = await this.get(actorId)
    if (!current) return
    
    // Update base snapshot to current state
    current.baseVersion = current.version
    
    // Serialize for GUN storage (flatten nested objects)
    const serialized = {
      ...current,
      state: JSON.stringify(current.state),
      metadata: JSON.stringify(current.metadata)
    }
    
    return new Promise((resolve, reject) => {
      let resolved = false
      
      this.gun.get('actors').get(actorId).put(serialized, (ack: any) => {
        if (resolved) return
        resolved = true
        
        if (ack.err) {
          reject(new Error(`Failed to create snapshot: ${ack.err}`))
          return
        }
        resolve()
      })
      
      // Timeout after 5s
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          reject(new Error(`Timeout creating snapshot for ${actorId}`))
        }
      }, 5000)
    })
  }
}
