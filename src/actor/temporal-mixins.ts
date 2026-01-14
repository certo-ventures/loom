// @ts-nocheck
/**
 * Temporal Features Mixin
 * 
 * Adds Temporal-inspired capabilities to Actor base class
 */

import type { Actor } from './actor'
import type { 
  ContinueAsNewOptions, 
  ContinueAsNewResult,
  ChildActorOptions,
  ChildActorHandle,
  AsyncTaskOptions,
  AsyncTask,
  MigrationContext,
  MigrationFn,
  SearchAttributeDefinition
} from './temporal-features'

// ============================================================================
// CONTINUE-AS-NEW MIXIN
// ============================================================================

export interface ContinueAsNewCapable {
  continueAsNew(newState?: Record<string, unknown>, options?: ContinueAsNewOptions): Promise<ContinueAsNewResult>
}

export function withContinueAsNew<T extends new (...args: any[]) => Actor>(Base: T) {
  // @ts-expect-error - TypeScript doesn't allow private/protected properties in exported anonymous classes
  return class extends Base implements ContinueAsNewCapable {
    async continueAsNew(
      newState?: Record<string, unknown>,
      options: ContinueAsNewOptions = {}
    ): Promise<ContinueAsNewResult> {
      const {
        archiveJournal = true,
        resetCounters = true,
        preserveState = true
      } = options

      const journal = this.getJournal()
      const archivedEntries = journal.entries.length

      // Archive journal if requested (to cold storage, S3, etc.)
      if (archiveJournal && archivedEntries > 0) {
        const archiveKey = `${this.context.actorId}:archive:${Date.now()}`
        // Store in metadata for now, could be external storage
        this.updateState({
          __archived_journals: [
            ...((this.state.__archived_journals as string[]) || []),
            archiveKey
          ]
        })
      }

      // Reset journal, keep cursor at 0
      const freshJournal = { entries: [], cursor: 0 }
      this.loadJournal(freshJournal)

      // Update state
      if (newState && !preserveState) {
        this.state = newState
      } else if (newState) {
        this.state = { ...this.state, ...newState }
      }

      // Reset internal counters if requested
      if (resetCounters) {
        ;(this as any).activityCounter = 0
        ;(this as any).enrichmentBudgetUsed = 0
      }

      // Record continue-as-new in journal
      this.recordDecision({
        type: 'continue-as-new',
        archivedEntries,
        timestamp: Date.now()
      })

      return {
        archivedEntries,
        compactedAt: Date.now()
      }
    }
  }
}

// ============================================================================
// VERSIONING MIXIN
// ============================================================================

export interface VersionedActor {
  getActorVersion(): number
  migrate(fromVersion: number, toVersion: number): Promise<void>
}

export function withVersioning<T extends new (...args: any[]) => Actor>(Base: T) {
  // @ts-expect-error - TypeScript doesn't allow private/protected properties in exported anonymous classes
  return class extends Base implements VersionedActor {
    private _version: number = (Base as any).version || 1

    getActorVersion(): number {
      return this._version
    }

    async migrate(fromVersion: number, toVersion: number): Promise<void> {
      // Override in subclass for custom migration logic
      console.log(`[Actor ${this.context.actorId}] Migrating from v${fromVersion} to v${toVersion}`)
      
      // Update version in state
      this.updateState({ __version: toVersion })
      this._version = toVersion
    }

    // Helper for version-aware code
    protected ifVersion(minVersion: number, fn: () => any): any {
      if (this._version >= minVersion) {
        return fn()
      }
    }
  }
}

// ============================================================================
// CHILD ACTORS MIXIN
// ============================================================================

export interface ChildActorCapable {
  spawnChild(actorType: string, options: ChildActorOptions): Promise<ChildActorHandle>
  waitForChild(handle: ChildActorHandle, timeout?: number): Promise<any>
  getChildren(): ChildActorHandle[]
  terminateChild(actorId: string): Promise<void>
}

export function withChildActors<T extends new (...args: any[]) => Actor>(Base: T) {
  // @ts-expect-error - TypeScript doesn't allow private/protected properties in exported anonymous classes
  return class extends Base implements ChildActorCapable {
    private _children: Map<string, ChildActorHandle> = new Map()

    async spawnChild(actorType: string, options: ChildActorOptions): Promise<ChildActorHandle> {
      const handle: ChildActorHandle = {
        actorId: options.actorId,
        parentActorId: this.context.actorId,
        status: 'running',
        startedAt: Date.now()
      }

      this._children.set(options.actorId, handle)

      // Record in journal
      this.recordDecision({
        type: 'spawn-child',
        actorType,
        actorId: options.actorId,
        options
      })

      // Track in state
      this.updateState({
        __children: Array.from(this._children.keys())
      })

      // Send message to spawn child (actual implementation would use runtime)
      this.sendMessage(options.actorId, {
        type: 'init',
        parentActorId: this.context.actorId,
        input: options.input
      })

      return handle
    }

    async waitForChild(handle: ChildActorHandle, timeout: number = 30000): Promise<any> {
      const startTime = Date.now()
      
      // Poll for completion (in real impl, would use message passing)
      while (handle.status === 'running') {
        if (Date.now() - startTime > timeout) {
          throw new Error(`Child actor ${handle.actorId} timed out after ${timeout}ms`)
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      if (handle.status === 'failed') {
        throw new Error(`Child actor ${handle.actorId} failed: ${handle.error}`)
      }

      return handle.result
    }

    getChildren(): ChildActorHandle[] {
      return Array.from(this._children.values())
    }

    async terminateChild(actorId: string): Promise<void> {
      const handle = this._children.get(actorId)
      if (!handle) return

      this.recordDecision({
        type: 'terminate-child',
        actorId
      })

      this._children.delete(actorId)
      this.updateState({
        __children: Array.from(this._children.keys())
      })

      // Send termination message
      this.sendMessage(actorId, { type: 'terminate' })
    }

    // Override to handle child lifecycle
    protected async onChildCompleted(actorId: string, result: any): Promise<void> {
      const handle = this._children.get(actorId)
      if (handle) {
        handle.status = 'completed'
        handle.result = result
        handle.completedAt = Date.now()
      }
    }

    protected async onChildFailed(actorId: string, error: any): Promise<void> {
      const handle = this._children.get(actorId)
      if (handle) {
        handle.status = 'failed'
        handle.error = error
        handle.completedAt = Date.now()
      }
    }
  }
}

// ============================================================================
// SEARCH ATTRIBUTES MIXIN
// ============================================================================

export interface SearchAttributeCapable {
  updateSearchAttributes(attributes: Record<string, any>): Promise<void>
  getSearchAttributes(): Record<string, any>
}

export function withSearchAttributes<T extends new (...args: any[]) => Actor>(Base: T) {
  // @ts-expect-error - TypeScript doesn't allow private/protected properties in exported anonymous classes
  return class extends Base implements SearchAttributeCapable {
    private _searchAttributes: Record<string, any> = {}

    async updateSearchAttributes(attributes: Record<string, any>): Promise<void> {
      // Validate against schema if defined
      const schema = (this.constructor as any).searchAttributes as SearchAttributeDefinition
      if (schema) {
        for (const [key, value] of Object.entries(attributes)) {
          if (!schema[key]) {
            console.warn(`Search attribute '${key}' not in schema, ignoring`)
            continue
          }
          this._searchAttributes[key] = value
        }
      } else {
        this._searchAttributes = { ...this._searchAttributes, ...attributes }
      }

      // Store in state for persistence
      this.updateState({
        __searchAttributes: this._searchAttributes,
        __searchAttributesUpdatedAt: Date.now()
      })

      // Record in journal
      this.recordDecision({
        type: 'update-search-attributes',
        attributes
      })
    }

    getSearchAttributes(): Record<string, any> {
      return { ...this._searchAttributes }
    }
  }
}

// ============================================================================
// ASYNC TASKS MIXIN
// ============================================================================

export interface AsyncTaskCapable {
  createAsyncTask(options: AsyncTaskOptions): Promise<string>
  completeAsyncTask(taskToken: string, result: any): Promise<void>
  cancelAsyncTask(taskToken: string): Promise<void>
  getPendingTasks(): AsyncTask[]
}

export function withAsyncTasks<T extends new (...args: any[]) => Actor>(Base: T) {
  // @ts-expect-error - TypeScript doesn't allow private/protected properties in exported anonymous classes
  return class extends Base implements AsyncTaskCapable {
    private _asyncTasks: Map<string, AsyncTask> = new Map()

    async createAsyncTask(options: AsyncTaskOptions): Promise<string> {
      const taskToken = `${this.context.actorId}:task:${Date.now()}:${Math.random().toString(36)}`
      const timeout = options.timeout || 86400000 // 24 hours

      const task: AsyncTask = {
        taskToken,
        actorId: this.context.actorId,
        type: options.type,
        data: options.data,
        createdAt: Date.now(),
        expiresAt: Date.now() + timeout,
        status: 'pending'
      }

      this._asyncTasks.set(taskToken, task)

      // Store in state
      this.updateState({
        __asyncTasks: Array.from(this._asyncTasks.entries()).map(([token, task]) => ({
          token,
          ...task
        }))
      })

      // Record in journal
      this.recordDecision({
        type: 'create-async-task',
        taskToken,
        options
      })

      return taskToken
    }

    async completeAsyncTask(taskToken: string, result: any): Promise<void> {
      const task = this._asyncTasks.get(taskToken)
      if (!task) {
        throw new Error(`Async task ${taskToken} not found`)
      }

      if (task.status !== 'pending') {
        throw new Error(`Async task ${taskToken} already ${task.status}`)
      }

      task.status = 'completed'
      task.result = result

      // Record completion
      this.recordDecision({
        type: 'complete-async-task',
        taskToken,
        result,
        completedAt: Date.now()
      })

      this._asyncTasks.delete(taskToken)
      this.updateState({
        __asyncTasks: Array.from(this._asyncTasks.entries()).map(([token, task]) => ({
          token,
          ...task
        }))
      })
    }

    async cancelAsyncTask(taskToken: string): Promise<void> {
      const task = this._asyncTasks.get(taskToken)
      if (!task) return

      task.status = 'cancelled'
      this._asyncTasks.delete(taskToken)

      this.recordDecision({
        type: 'cancel-async-task',
        taskToken
      })
    }

    getPendingTasks(): AsyncTask[] {
      return Array.from(this._asyncTasks.values()).filter(t => t.status === 'pending')
    }

    // Check for expired tasks
    protected async cleanupExpiredTasks(): Promise<void> {
      const now = Date.now()
      const expired = Array.from(this._asyncTasks.values()).filter(
        task => task.status === 'pending' && task.expiresAt < now
      )

      for (const task of expired) {
        task.status = 'expired'
        this._asyncTasks.delete(task.taskToken)
        
        this.recordDecision({
          type: 'expire-async-task',
          taskToken: task.taskToken
        })
      }
    }
  }
}

// ============================================================================
// COMBINED MIXIN - ALL FEATURES
// ============================================================================

export function withTemporalFeatures<T extends new (...args: any[]) => Actor>(Base: T) {
  // @ts-ignore - TypeScript doesn't allow private/protected properties in exported composed classes
  return withAsyncTasks(
    withSearchAttributes(
      withChildActors(
        withVersioning(
          withContinueAsNew(Base)
        )
      )
    )
  )
}
