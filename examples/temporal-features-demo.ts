/**
 * Example: Using Temporal-inspired features in Loom
 * 
 * Demonstrates:
 * - Signal/Query pattern (no decorators!)
 * - Continue-as-New for long-lived actors
 * - Child actor spawning
 * - Search attributes
 * - Async task completion
 */

import { Actor, withTemporalFeatures, type ChildActorHandle } from '../src/actor'
import type { ActorContext } from '../src/actor/journal'

// ============================================================================
// 1. SIGNAL/QUERY EXAMPLE - Order Processing Actor
// ============================================================================

class OrderActor extends Actor {
  // Declare signals (async state updates)
  static signals = {
    approve: 'approveOrder',
    cancel: 'cancelOrder'
  }

  // Declare queries (sync reads)
  static queries = {
    getStatus: 'getOrderStatus',
    estimateShipping: 'estimateShipping'
  }

  constructor(context: ActorContext) {
    super(context)
    this.updateState(draft => {
      draft.status = 'pending'
      draft.items = []
      draft.total = 0
      draft.history = []
    })
  }

  async execute(input: any): Promise<any> {
    // Main workflow
    if (input.action === 'create') {
      return await this.createOrder(input)
    }
    return { status: this.state.status }
  }

  async createOrder(input: any) {
    this.updateState(draft => {
      draft.status = 'processing'
      draft.items = input.items
      draft.total = input.total
    })
    return { orderId: this.context.actorId, status: 'processing' }
  }

  // SIGNAL - Async state update (journaled)
  async approveOrder() {
    this.updateState(draft => {
      draft.status = 'approved'
      draft.approvedAt = Date.now()
    })
    
    this.recordDecision({
      type: 'order-approved',
      timestamp: Date.now()
    })
  }

  // SIGNAL - Can update state
  async cancelOrder(reason: string) {
    this.updateState(draft => {
      draft.status = 'cancelled'
      draft.cancelReason = reason
      draft.cancelledAt = Date.now()
    })
  }

  // QUERY - Read-only, not journaled
  getOrderStatus() {
    return {
      status: this.state.status,
      items: this.state.items,
      total: this.state.total
    }
  }

  // QUERY - Can compute values without changing state
  estimateShipping() {
    const baseRate = 5
    const itemCount = (this.state.items as any[]).length
    return baseRate + (itemCount * 2)
  }
}

// ============================================================================
// 2. CONTINUE-AS-NEW EXAMPLE - Long-Lived Subscription Actor
// ============================================================================

const SubscriptionActor = withTemporalFeatures(class extends Actor {
  private eventCount = 0

  async execute(input: any): Promise<any> {
    this.eventCount++

    // Process subscription event
    this.updateState(draft => {
      draft.lastEvent = input
      draft.totalEvents = this.eventCount
      draft.lastProcessedAt = Date.now()
    })

    // Continue-as-New after 1000 events (compact journal)
    if (this.eventCount >= 1000) {
      const result = await this.continueAsNew(
        { 
          totalEventsAllTime: (this.state.totalEventsAllTime as number || 0) + this.eventCount,
          lastCompactedAt: Date.now()
        },
        { archiveJournal: true, resetCounters: true }
      )
      
      console.log(`✨ Compacted journal: ${result.archivedEntries} entries archived`)
      this.eventCount = 0
    }

    return { processed: true, eventCount: this.eventCount }
  }
})

// ============================================================================
// 3. CHILD ACTORS EXAMPLE - Workflow Orchestrator
// ============================================================================

const WorkflowActor = withTemporalFeatures(class extends Actor {
  async execute(input: any): Promise<any> {
    // Spawn child actors for parallel processing
    const tasks = input.tasks || []
    const children: ChildActorHandle[] = []

    for (let i = 0; i < tasks.length; i++) {
      const child = await this.spawnChild('TaskActor', {
        actorId: `${this.context.actorId}:task:${i}`,
        input: tasks[i],
        restartPolicy: 'on-failure',
        maxRestarts: 3
      })
      children.push(child)
    }

    // Wait for all children
    const results = []
    for (const child of children) {
      try {
        const result = await this.waitForChild(child, 30000)
        results.push({ success: true, result })
      } catch (error) {
        results.push({ success: false, error: (error as Error).message })
      }
    }

    return {
      workflow: this.context.actorId,
      tasksCompleted: results.filter(r => r.success).length,
      tasksFailed: results.filter(r => !r.success).length,
      results
    }
  }
})

// ============================================================================
// 4. SEARCH ATTRIBUTES EXAMPLE - User Actor
// ============================================================================

const UserActor = withTemporalFeatures(class extends Actor {
  // Declare search attributes schema
  static searchAttributes = {
    email: 'string' as const,
    status: 'keyword' as const,
    createdAt: 'datetime' as const,
    premium: 'boolean' as const
  }

  async execute(input: any): Promise<any> {
    if (input.action === 'register') {
      this.updateState(draft => {
        draft.email = input.email
        draft.name = input.name
        draft.status = 'active'
        draft.premium = false
        draft.createdAt = Date.now()
      })

      // Update search attributes for querying
      await this.updateSearchAttributes({
        email: input.email,
        status: 'active',
        createdAt: Date.now(),
        premium: false
      })

      return { success: true, userId: this.context.actorId }
    }

    if (input.action === 'upgrade') {
      this.updateState(draft => { draft.premium = true })
      await this.updateSearchAttributes({ premium: true })
      return { success: true, premium: true }
    }

    return this.state
  }
})

// ============================================================================
// 5. ASYNC TASK EXAMPLE - Manual Approval Workflow
// ============================================================================

const ApprovalActor = withTemporalFeatures(class extends Actor {
  async execute(input: any): Promise<any> {
    // Record approval request
    this.updateState(draft => {
      draft.requestId = input.requestId
      draft.amount = input.amount
      draft.status = 'pending-approval'
    })

    // Create async task for external approval (e.g., email, webhook)
    const taskToken = await this.createAsyncTask({
      type: 'manual-approval',
      data: {
        requestId: input.requestId,
        amount: input.amount,
        approverEmail: input.approverEmail
      },
      timeout: 3600000 // 1 hour
    })

    console.log(`📧 Approval task created: ${taskToken}`)
    console.log(`   Send to: ${input.approverEmail}`)
    console.log(`   Complete via: POST /api/tasks/${taskToken}/complete`)

    // In real system, would suspend here and resume when task completes
    // For now, just record the task token
    this.updateState(draft => {
      draft.approvalTaskToken = taskToken
      draft.status = 'waiting-for-approval'
    })

    return {
      taskToken,
      status: 'waiting-for-approval',
      message: 'Approval request sent'
    }
  }

  // External system calls this to complete the task
  async handleApprovalComplete(approved: boolean, comments: string) {
    const taskToken = this.state.approvalTaskToken as string
    
    await this.completeAsyncTask(taskToken, { approved, comments })
    
    this.updateState(draft => {
      draft.status = approved ? 'approved' : 'rejected'
      draft.approvalComments = comments
      draft.completedAt = Date.now()
    })

    this.recordDecision({
      type: 'approval-completed',
      approved,
      comments
    })
  }
})

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

export async function demonstrateTemporalFeatures() {
  console.log('=== Temporal Features Demo ===\n')

  // 1. Signal/Query
  console.log('1. SIGNAL/QUERY PATTERN (No Decorators!)')
  console.log('   - Declare static signals = { name: \"methodName\" }')
  console.log('   - Declare static queries = { name: \"methodName\" }')
  console.log('   - Signals: async state updates (approve, cancel)')
  console.log('   - Queries: sync reads (getStatus, estimateShipping)')
  console.log('   - Use runtime.signal() and runtime.query() to invoke\n')

  // 2. Continue-as-New
  console.log('2. CONTINUE-AS-NEW')
  console.log('   - Compacts journal after 1000 events')
  console.log('   - Archives old entries, resets counters')
  console.log('   - Enables infinite event streams\n')

  // 3. Child Actors
  console.log('3. CHILD ACTORS')
  console.log('   - spawnChild() creates supervised children')
  console.log('   - waitForChild() blocks until completion')
  console.log('   - Restart policies: never, on-failure, always\n')

  // 4. Search Attributes
  console.log('4. SEARCH ATTRIBUTES')
  console.log('   - Declare schema with types (string, keyword, datetime, etc.)')
  console.log('   - updateSearchAttributes() indexes values')
  console.log('   - runtime.searchActors() queries across all actors\n')

  // 5. Async Tasks
  console.log('5. ASYNC TASKS')
  console.log('   - createAsyncTask() for external completion')
  console.log('   - Human-in-the-loop workflows')
  console.log('   - Webhooks, emails, manual approvals\n')
}

// Example runtime usage
export const exampleRuntimeUsage = `
// Signal (async update)
await runtime.signal('order-123', 'OrderActor', 'approve', [])

// Query (sync read)
const status = await runtime.query('order-123', 'OrderActor', 'getStatus', [])

// Search actors
const premiumUsers = await runtime.searchActors({
  type: 'UserActor',
  attributes: { premium: true }
})

// Complete async task
await runtime.completeAsyncTask('user-456', 'ApprovalActor', taskToken, { approved: true })
`
