/**
 * Temporal Features Test Suite
 * 
 * Tests Signal/Query, Continue-as-New, Child Actors, Search Attributes, Async Tasks
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Actor, withTemporalFeatures } from '../src/actor'
import { LongLivedActorRuntime } from '../src/runtime'
import type { ActorContext } from '../src/actor/journal'
import { InMemoryBlobStore } from '../src/storage/in-memory-blob-store'

// ============================================================================
// TEST ACTORS
// ============================================================================

class OrderActor extends Actor {
  // Signal registry - no decorators!
  static signals = {
    approve: 'approveOrder',
    cancel: 'cancelOrder'
  }

  // Query registry - no decorators!
  static queries = {
    getStatus: 'getOrderStatus',
    canApprove: 'canApprove'
  }

  async execute(input: any): Promise<any> {
    this.updateState(draft => {
      draft.orderId = this.context.actorId
      draft.status = 'created'
      draft.total = input.total || 0
    })
    return { orderId: this.context.actorId }
  }

  // Signal method - updates state
  async approveOrder() {
    this.updateState(draft => {
      draft.status = 'approved'
      draft.approvedAt = Date.now()
    })
    this.recordDecision({ type: 'order-approved' })
  }

  // Signal method - updates state
  async cancelOrder(reason: string) {
    this.updateState(draft => {
      draft.status = 'cancelled'
      draft.cancelReason = reason
    })
  }

  // Query method - read only
  getOrderStatus() {
    return { status: this.state.status, total: this.state.total }
  }

  // Query method - read only
  canApprove(): boolean {
    return this.state.status === 'created'
  }
}

const CounterActor = withTemporalFeatures(class extends Actor {
  private count = 0

  async execute(input: any): Promise<any> {
    this.count++
    this.updateState(draft => {
      draft.count = this.count
      draft.lastUpdated = Date.now()
    })

    // Continue-as-New after 10 increments
    if (this.count >= 10 && input.enableContinue) {
      const result = await this.continueAsNew(
        { totalResets: (this.state.totalResets as number || 0) + 1 },
        { archiveJournal: true, resetCounters: true }
      )
      this.count = 0
      return { continued: true, ...result }
    }

    return { count: this.count }
  }
})

const ParentActor = withTemporalFeatures(class extends Actor {
  async execute(input: any): Promise<any> {
    const childCount = input.childCount || 2
    const children = []

    // Spawn children
    for (let i = 0; i < childCount; i++) {
      const child = await this.spawnChild('ChildActor', {
        actorId: `${this.context.actorId}:child:${i}`,
        input: { taskId: i }
      })
      children.push(child)
    }

    return {
      parentId: this.context.actorId,
      childrenSpawned: children.length,
      childIds: children.map(c => c.actorId)
    }
  }
})

const SearchableActor = withTemporalFeatures(class extends Actor {
  static searchAttributes = {
    category: 'keyword' as const,
    price: 'number' as const,
    active: 'boolean' as const
  }

  async execute(input: any): Promise<any> {
    this.updateState(draft => {
      draft.name = input.name
      draft.category = input.category
      draft.price = input.price
      draft.active = true
    })

    await this.updateSearchAttributes({
      category: input.category,
      price: input.price,
      active: true
    })

    return { success: true, actorId: this.context.actorId }
  }
})

const AsyncTaskActor = withTemporalFeatures(class extends Actor {
  async execute(input: any): Promise<any> {
    const taskToken = await this.createAsyncTask({
      type: 'approval',
      data: { amount: input.amount },
      timeout: 60000
    })

    this.updateState(draft => {
      draft.taskToken = taskToken
      draft.status = 'pending'
      draft.amount = input.amount
    })

    return { taskToken, status: 'pending' }
  }
})

// ============================================================================
// TESTS
// ============================================================================

describe('Temporal Features', () => {
  let runtime: LongLivedActorRuntime
  let context: ActorContext

  beforeEach(() => {
    runtime = new LongLivedActorRuntime({
      blobStore: new InMemoryBlobStore()
    })

    runtime.registerActorType('OrderActor', {
      type: 'typescript',
      actorClass: OrderActor
    })

    runtime.registerActorType('CounterActor', {
      type: 'typescript',
      actorClass: CounterActor
    })

    runtime.registerActorType('ParentActor', {
      type: 'typescript',
      actorClass: ParentActor
    })

    runtime.registerActorType('SearchableActor', {
      type: 'typescript',
      actorClass: SearchableActor
    })

    runtime.registerActorType('AsyncTaskActor', {
      type: 'typescript',
      actorClass: AsyncTaskActor
    })

    context = {
      actorId: 'test-actor',
      actorType: 'OrderActor',
      correlationId: 'test-correlation'
    }
  })

  describe('Signal/Query Pattern', () => {
    it('should execute signal to update state', async () => {
      // Create order
      const actor = await runtime.getActor('order-1', 'OrderActor', { 
        ...context, 
        actorId: 'order-1' 
      })
      await actor.execute({ total: 100 })

      // Send signal to approve
      await runtime.signal('order-1', 'OrderActor', 'approve', [], context)

      // Verify state updated
      const state = actor.getState()
      expect(state.status).toBe('approved')
      expect(state.approvedAt).toBeDefined()
    })

    it('should execute query without modifying state', async () => {
      const actor = await runtime.getActor('order-2', 'OrderActor', {
        ...context,
        actorId: 'order-2'
      })
      await actor.execute({ total: 200 })

      // Query status
      const result = await runtime.query('order-2', 'OrderActor', 'getStatus', [], context)

      expect(result).toEqual({
        status: 'created',
        total: 200
      })
    })

    it('should execute signal with arguments', async () => {
      const actor = await runtime.getActor('order-3', 'OrderActor', {
        ...context,
        actorId: 'order-3'
      })
      await actor.execute({ total: 300 })

      // Cancel with reason
      await runtime.signal('order-3', 'OrderActor', 'cancel', ['Out of stock'], context)

      const state = actor.getState()
      expect(state.status).toBe('cancelled')
      expect(state.cancelReason).toBe('Out of stock')
    })

    it('should throw error for unknown signal', async () => {
      await runtime.getActor('order-4', 'OrderActor', {
        ...context,
        actorId: 'order-4'
      })

      await expect(
        runtime.signal('order-4', 'OrderActor', 'unknown', [], context)
      ).rejects.toThrow("Signal 'unknown' not found")
    })

    it('should throw error for unknown query', async () => {
      await runtime.getActor('order-5', 'OrderActor', {
        ...context,
        actorId: 'order-5'
      })

      await expect(
        runtime.query('order-5', 'OrderActor', 'unknown', [], context)
      ).rejects.toThrow("Query 'unknown' not found")
    })
  })

  describe('Continue-as-New', () => {
    it('should compact journal after threshold', async () => {
      const actor = await runtime.getActor('counter-1', 'CounterActor', {
        ...context,
        actorId: 'counter-1',
        actorType: 'CounterActor'
      })

      // Execute 10 times to trigger continue-as-new
      for (let i = 0; i < 10; i++) {
        await actor.execute({ enableContinue: true })
      }

      const state = actor.getState()
      expect(state.totalResets).toBe(1)

      // Journal should be compacted
      const journal = actor.getJournal()
      expect(journal.entries.length).toBeLessThan(20) // Much less than 10 executions worth
    })

    it('should preserve state after continue-as-new', async () => {
      const actor = await runtime.getActor('counter-2', 'CounterActor', {
        ...context,
        actorId: 'counter-2',
        actorType: 'CounterActor'
      })

      // Execute until continue-as-new
      for (let i = 0; i < 10; i++) {
        await actor.execute({ enableContinue: true })
      }

      const state = actor.getState()
      expect(state.totalResets).toBe(1)
      // Note: count is stored in instance variable, state only tracks aggregated total
      expect(state.lastUpdated).toBeDefined() // State preserved
    })
  })

  describe('Child Actors', () => {
    it('should spawn child actors', async () => {
      const actor = await runtime.getActor('parent-1', 'ParentActor', {
        ...context,
        actorId: 'parent-1',
        actorType: 'ParentActor'
      })

      const result = await actor.execute({ childCount: 3 })

      expect(result.childrenSpawned).toBe(3)
      expect(result.childIds).toHaveLength(3)
      expect(result.childIds[0]).toBe('parent-1:child:0')
      expect(result.childIds[2]).toBe('parent-1:child:2')
    })

    it('should track children in state', async () => {
      const actor = await runtime.getActor('parent-2', 'ParentActor', {
        ...context,
        actorId: 'parent-2',
        actorType: 'ParentActor'
      })

      await actor.execute({ childCount: 2 })

      const state = actor.getState()
      expect(state.__children).toEqual([
        'parent-2:child:0',
        'parent-2:child:1'
      ])
    })

    it('should get children handles', async () => {
      const actor = await runtime.getActor('parent-3', 'ParentActor', {
        ...context,
        actorId: 'parent-3',
        actorType: 'ParentActor'
      }) as any

      await actor.execute({ childCount: 2 })

      const children = actor.getChildren()
      expect(children).toHaveLength(2)
      expect(children[0].status).toBe('running')
      expect(children[0].parentActorId).toBe('parent-3')
    })
  })

  describe('Search Attributes', () => {
    it('should index and search actors', async () => {
      // Create searchable actors
      const actor1 = await runtime.getActor('product-1', 'SearchableActor', {
        ...context,
        actorId: 'product-1',
        actorType: 'SearchableActor'
      })
      await actor1.execute({ name: 'Laptop', category: 'electronics', price: 1000 })

      const actor2 = await runtime.getActor('product-2', 'SearchableActor', {
        ...context,
        actorId: 'product-2',
        actorType: 'SearchableActor'
      })
      await actor2.execute({ name: 'Phone', category: 'electronics', price: 800 })

      const actor3 = await runtime.getActor('product-3', 'SearchableActor', {
        ...context,
        actorId: 'product-3',
        actorType: 'SearchableActor'
      })
      await actor3.execute({ name: 'Desk', category: 'furniture', price: 500 })

      // Update search index
      await runtime.updateSearchAttributes('product-1', 'SearchableActor', {
        category: 'electronics',
        price: 1000,
        active: true
      })
      await runtime.updateSearchAttributes('product-2', 'SearchableActor', {
        category: 'electronics',
        price: 800,
        active: true
      })
      await runtime.updateSearchAttributes('product-3', 'SearchableActor', {
        category: 'furniture',
        price: 500,
        active: true
      })

      // Search by category
      const electronics = await runtime.searchActors({
        type: 'SearchableActor',
        attributes: { category: 'electronics' }
      })

      expect(electronics).toHaveLength(2)
      expect(electronics.map(r => r.actorId)).toContain('product-1')
      expect(electronics.map(r => r.actorId)).toContain('product-2')
    })

    it('should support pagination', async () => {
      // Create multiple actors
      for (let i = 0; i < 5; i++) {
        const actor = await runtime.getActor(`item-${i}`, 'SearchableActor', {
          ...context,
          actorId: `item-${i}`,
          actorType: 'SearchableActor'
        })
        await actor.execute({ name: `Item ${i}`, category: 'test', price: i * 100 })
        
        await runtime.updateSearchAttributes(`item-${i}`, 'SearchableActor', {
          category: 'test',
          price: i * 100,
          active: true
        })
      }

      // Paginate results
      const page1 = await runtime.searchActors({
        type: 'SearchableActor',
        attributes: { category: 'test' },
        limit: 2,
        offset: 0
      })

      const page2 = await runtime.searchActors({
        type: 'SearchableActor',
        attributes: { category: 'test' },
        limit: 2,
        offset: 2
      })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
      expect(page1[0].actorId).not.toBe(page2[0].actorId)
    })
  })

  describe('Async Tasks', () => {
    it('should create async task', async () => {
      const actor = await runtime.getActor('approval-1', 'AsyncTaskActor', {
        ...context,
        actorId: 'approval-1',
        actorType: 'AsyncTaskActor'
      })

      const result = await actor.execute({ amount: 5000 })

      expect(result.taskToken).toBeDefined()
      expect(result.status).toBe('pending')
      expect(result.taskToken).toContain('approval-1:task:')
    })

    it('should complete async task', async () => {
      const actor = await runtime.getActor('approval-2', 'AsyncTaskActor', {
        ...context,
        actorId: 'approval-2',
        actorType: 'AsyncTaskActor'
      }) as any

      const result = await actor.execute({ amount: 3000 })
      const taskToken = result.taskToken

      // Complete task
      await runtime.completeAsyncTask('approval-2', 'AsyncTaskActor', taskToken, 
        { approved: true, comments: 'Looks good' }, context)

      // Verify task completed
      const pendingTasks = actor.getPendingTasks()
      expect(pendingTasks.length).toBe(0)
    })

    it('should track pending tasks', async () => {
      const actor = await runtime.getActor('approval-3', 'AsyncTaskActor', {
        ...context,
        actorId: 'approval-3',
        actorType: 'AsyncTaskActor'
      }) as any

      await actor.execute({ amount: 1000 })
      await actor.execute({ amount: 2000 })

      const pendingTasks = actor.getPendingTasks()
      expect(pendingTasks.length).toBe(2)
      expect(pendingTasks[0].status).toBe('pending')
      expect(pendingTasks[0].type).toBe('approval')
    })

    it('should handle task cancellation', async () => {
      const actor = await runtime.getActor('approval-4', 'AsyncTaskActor', {
        ...context,
        actorId: 'approval-4',
        actorType: 'AsyncTaskActor'
      }) as any

      const result = await actor.execute({ amount: 1500 })
      const taskToken = result.taskToken

      // Cancel task
      await actor.cancelAsyncTask(taskToken)

      const pendingTasks = actor.getPendingTasks()
      expect(pendingTasks.length).toBe(0)
    })
  })

  describe('Integration', () => {
    it('should combine all features in one actor', async () => {
      // Create a complex actor using all features
      class ComplexActorBase extends Actor {
        static searchAttributes = {
          status: 'keyword' as const,
          priority: 'number' as const
        }

        static signals = {
          pause: 'pauseExecution'
        }

        static queries = {
          isPaused: 'isPaused'
        }

        async execute(input: any): Promise<any> {
          this.updateState(draft => {
            draft.status = 'running'
            draft.priority = input.priority || 1
          })
          
          await (this as any).updateSearchAttributes({
            status: 'running',
            priority: input.priority || 1
          })

          return { actorId: this.context.actorId, status: 'running' }
        }

        async pauseExecution() {
          this.updateState(draft => { draft.status = 'paused' })
          await (this as any).updateSearchAttributes({ status: 'paused' })
        }

        isPaused(): boolean {
          return this.state.status === 'paused'
        }
      }
      
      const ComplexActor = withTemporalFeatures(ComplexActorBase)

      runtime.registerActorType('ComplexActor', {
        type: 'typescript',
        actorClass: ComplexActor
      })

      // Execute all features
      const actor = await runtime.getActor('complex-1', 'ComplexActor', {
        ...context,
        actorId: 'complex-1',
        actorType: 'ComplexActor'
      })

      await actor.execute({ priority: 10 })
      await runtime.signal('complex-1', 'ComplexActor', 'pause', [], context)
      const isPaused = await runtime.query('complex-1', 'ComplexActor', 'isPaused', [], context)

      await runtime.updateSearchAttributes('complex-1', 'ComplexActor', {
        status: 'paused',
        priority: 10
      })

      const results = await runtime.searchActors({
        type: 'ComplexActor',
        attributes: { status: 'paused' }
      })

      expect(isPaused).toBe(true)
      expect(results).toHaveLength(1)
      expect(results[0].actorId).toBe('complex-1')
    })
  })
})
