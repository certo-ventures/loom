# Trace Propagation: The Missing Mechanism

## The Critical Question: HOW Does Tracing Actually Work?

I described WHAT to collect (trace_id, span_id, etc.) but not:
- **WHEN** events are emitted
- **HOW** trace context flows through the system
- **WHERE** instrumentation hooks into existing primitives

Let me fix that.

---

## Part 1: Understanding Our Execution Model

### What We Actually Have

```
BullMQ Queue
    ↓
Actor receives message
    ↓
Actor processes (may call other actors)
    ↓
Actor sends messages (to other actors)
    ↓
Those actors process...
```

**Key insight**: Messages flow through BullMQ. Actors process messages. Executors orchestrate workflows.

### The Tracing Challenge

When Actor A sends a message to Actor B:
```
Actor A (span_1) → BullMQ → Actor B (span_2)
```

**Questions**:
1. How does Actor B know it's part of the same trace as Actor A?
2. How does Actor B know span_1 is its parent?
3. How do we emit events at the right moments?

**Answer**: Context propagation through message metadata.

---

## Part 2: Trace Context Propagation

### The Core Mechanism: Context in Message Metadata

Every message through BullMQ carries trace context:

```typescript
// Message structure in BullMQ
interface ActorMessage {
  // Business payload
  method: string
  params: any
  
  // Trace context (added by framework)
  __trace: {
    trace_id: string
    parent_span_id: string
    correlation_id?: string
    tags?: string[]
  }
}
```

### Propagation Flow

```
┌─────────────────────────────────────────────────────────┐
│ Actor A (span_1)                                        │
│                                                         │
│  1. Has context: { trace_id: 'T1', span_id: 'S1' }    │
│                                                         │
│  2. Calls another actor:                               │
│     await actorB.doSomething(params)                   │
│                                                         │
│  3. Framework intercepts and adds context:             │
│     message = {                                        │
│       method: 'doSomething',                           │
│       params: params,                                  │
│       __trace: {                                       │
│         trace_id: 'T1',     ← Same trace              │
│         parent_span_id: 'S1' ← Actor A is parent      │
│       }                                                │
│     }                                                  │
│                                                         │
│  4. Sends to BullMQ queue                             │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
                   BullMQ Queue
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ Actor B (span_2)                                        │
│                                                         │
│  5. Receives message from queue                        │
│                                                         │
│  6. Framework extracts context:                        │
│     trace_id = message.__trace.trace_id                │
│     parent_span_id = message.__trace.parent_span_id    │
│                                                         │
│  7. Generates new span:                                │
│     span_id = 'S2'                                     │
│                                                         │
│  8. Emits event:                                       │
│     {                                                  │
│       trace_id: 'T1',        ← Same trace             │
│       span_id: 'S2',         ← New span               │
│       parent_span_id: 'S1',  ← Links to Actor A       │
│       event_type: 'actor:started',                    │
│       timestamp: now()                                 │
│     }                                                  │
│                                                         │
│  9. Executes business logic                           │
│                                                         │
│  10. Emits completion event                           │
└─────────────────────────────────────────────────────────┘
```

---

## Part 3: Instrumentation Points (WHEN Events Are Emitted)

### Level 1: BullMQ Job Lifecycle

**Where**: BullMQ worker event handlers (already exist)

**Events to emit**:

```typescript
// In BullMQ worker setup
worker.on('active', async (job) => {
  await tracer.emit({
    trace_id: job.data.__trace?.trace_id || job.id,
    span_id: generateSpanId(),
    parent_span_id: job.data.__trace?.parent_span_id,
    event_type: 'job:started',
    timestamp: new Date().toISOString(),
    data: {
      job_id: job.id,
      job_name: job.name,
      queue: job.queueName,
      attempt: job.attemptsMade
    }
  })
})

worker.on('completed', async (job, result) => {
  await tracer.emit({
    trace_id: job.data.__trace?.trace_id || job.id,
    span_id: job.data.__span_id, // Set when job started
    event_type: 'job:completed',
    timestamp: new Date().toISOString(),
    status: 'success',
    data: {
      job_id: job.id,
      duration_ms: Date.now() - job.timestamp
    }
  })
})

worker.on('failed', async (job, error) => {
  await tracer.emit({
    trace_id: job.data.__trace?.trace_id || job.id,
    span_id: job.data.__span_id,
    event_type: 'job:failed',
    timestamp: new Date().toISOString(),
    status: 'failed',
    data: {
      job_id: job.id,
      error: error.message,
      stack: error.stack,
      attempt: job.attemptsMade,
      will_retry: job.attemptsMade < (job.opts.attempts || 1)
    }
  })
})
```

### Level 2: Actor Message Processing

**Where**: Actor base class (already exists)

**Current actor structure** (simplified):
```typescript
class BaseActor {
  async processMessage(message: ActorMessage) {
    // 1. Deserialize
    // 2. Call method
    // 3. Return result
  }
}
```

**Instrumented version**:
```typescript
class BaseActor {
  async processMessage(message: ActorMessage) {
    // Extract or create trace context
    const trace_id = message.__trace?.trace_id || generateTraceId()
    const parent_span_id = message.__trace?.parent_span_id
    const span_id = generateSpanId()
    
    // Store in async context (for nested calls)
    return await TraceContext.run(
      { trace_id, span_id, parent_span_id },
      async () => {
        // Emit start event
        await tracer.emit({
          trace_id,
          span_id,
          parent_span_id,
          event_type: 'actor:started',
          timestamp: new Date().toISOString(),
          data: {
            actor_type: this.constructor.name,
            actor_id: this.id,
            method: message.method
          }
        })
        
        try {
          // Execute business logic
          const result = await this[message.method](...message.params)
          
          // Emit success event
          await tracer.emit({
            trace_id,
            span_id,
            event_type: 'actor:completed',
            timestamp: new Date().toISOString(),
            status: 'success',
            data: {
              actor_type: this.constructor.name,
              method: message.method
            }
          })
          
          return result
        } catch (error) {
          // Emit failure event
          await tracer.emit({
            trace_id,
            span_id,
            event_type: 'actor:failed',
            timestamp: new Date().toISOString(),
            status: 'failed',
            data: {
              actor_type: this.constructor.name,
              method: message.method,
              error: error.message
            }
          })
          throw error
        }
      }
    )
  }
}
```

### Level 3: Actor-to-Actor Calls

**Where**: Message sending infrastructure (ActorProxy or similar)

**Current** (simplified):
```typescript
class ActorProxy {
  async call(method: string, ...params: any[]) {
    await bullmq.add('actor-queue', {
      actorId: this.actorId,
      method,
      params
    })
  }
}
```

**Instrumented**:
```typescript
class ActorProxy {
  async call(method: string, ...params: any[]) {
    // Get current trace context (from async storage)
    const currentContext = TraceContext.get()
    
    // Add trace context to message
    await bullmq.add('actor-queue', {
      actorId: this.actorId,
      method,
      params,
      __trace: {
        trace_id: currentContext.trace_id,
        parent_span_id: currentContext.span_id, // Current span is parent
        correlation_id: currentContext.correlation_id,
        tags: currentContext.tags
      }
    })
    
    // Optionally emit "message sent" event
    await tracer.emit({
      trace_id: currentContext.trace_id,
      span_id: currentContext.span_id,
      event_type: 'actor:message_sent',
      timestamp: new Date().toISOString(),
      data: {
        to_actor: this.actorId,
        method
      }
    })
  }
}
```

### Level 4: Executor/Pipeline Level

**Where**: Workflow executor (orchestrates multiple stages)

**Instrumentation**:
```typescript
class WorkflowExecutor {
  async execute(workflow: Workflow, input: any) {
    // Create new trace for workflow
    const trace_id = generateTraceId()
    const root_span_id = generateSpanId()
    
    await TraceContext.run(
      { trace_id, span_id: root_span_id },
      async () => {
        // Emit workflow start
        await tracer.emit({
          trace_id,
          span_id: root_span_id,
          event_type: 'workflow:started',
          timestamp: new Date().toISOString(),
          data: {
            workflow_id: workflow.id,
            workflow_name: workflow.name,
            input
          },
          tags: ['workflow']
        })
        
        try {
          // Execute stages (each stage creates child spans)
          for (const stage of workflow.stages) {
            await this.executeStage(stage)
          }
          
          // Emit workflow completion
          await tracer.emit({
            trace_id,
            span_id: root_span_id,
            event_type: 'workflow:completed',
            timestamp: new Date().toISOString(),
            status: 'success',
            tags: ['workflow']
          })
        } catch (error) {
          // Emit workflow failure
          await tracer.emit({
            trace_id,
            span_id: root_span_id,
            event_type: 'workflow:failed',
            timestamp: new Date().toISOString(),
            status: 'failed',
            data: { error: error.message },
            tags: ['workflow']
          })
          
          // Start compensation if configured
          if (workflow.hasCompensation) {
            await this.executeCompensation(trace_id, root_span_id)
          }
          
          throw error
        }
      }
    )
  }
  
  async executeStage(stage: Stage) {
    const currentContext = TraceContext.get()
    const stage_span_id = generateSpanId()
    
    // Child context for stage
    await TraceContext.run(
      {
        trace_id: currentContext.trace_id,
        span_id: stage_span_id,
        parent_span_id: currentContext.span_id
      },
      async () => {
        await tracer.emit({
          trace_id: currentContext.trace_id,
          span_id: stage_span_id,
          parent_span_id: currentContext.span_id,
          event_type: 'stage:started',
          timestamp: new Date().toISOString(),
          data: {
            stage_id: stage.id,
            stage_name: stage.name,
            actor: stage.actor
          }
        })
        
        // Call actor (context propagates automatically)
        const result = await actorProxy.call(stage.method, stage.input)
        
        await tracer.emit({
          trace_id: currentContext.trace_id,
          span_id: stage_span_id,
          event_type: 'stage:completed',
          timestamp: new Date().toISOString(),
          status: 'success'
        })
        
        return result
      }
    )
  }
}
```

---

## Part 4: Async Context Management

### The Problem: Maintaining Context Across Async Boundaries

When Actor A calls Actor B, the call goes through:
1. Actor A's code
2. BullMQ queue
3. Actor B's code

Standard thread-local storage doesn't work (different processes/workers).

### The Solution: Explicit Context Propagation

**Use Node.js AsyncLocalStorage for intra-process context**:

```typescript
import { AsyncLocalStorage } from 'async_hooks'

interface TraceContextData {
  trace_id: string
  span_id: string
  parent_span_id?: string
  correlation_id?: string
  tags?: string[]
}

class TraceContext {
  private static storage = new AsyncLocalStorage<TraceContextData>()
  
  // Run code with trace context
  static async run<T>(
    context: TraceContextData,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.storage.run(context, fn)
  }
  
  // Get current context
  static get(): TraceContextData | undefined {
    return this.storage.getStore()
  }
  
  // Get or create context (for root operations)
  static getOrCreate(): TraceContextData {
    const existing = this.get()
    if (existing) return existing
    
    // Create new trace
    return {
      trace_id: generateTraceId(),
      span_id: generateSpanId()
    }
  }
}
```

**Usage in actor code**:
```typescript
class LoanProcessor extends BaseActor {
  async processLoan(loan: Loan) {
    // Context is automatically available (set by BaseActor)
    const context = TraceContext.get()
    
    // Make decision (AI agent)
    const decision = await this.aiAgent.decide(loan)
    
    // Emit domain event
    await tracer.emit({
      trace_id: context.trace_id,
      span_id: generateSpanId(),
      parent_span_id: context.span_id,
      event_type: 'ai:decision',
      timestamp: new Date().toISOString(),
      data: {
        decision: decision.approved,
        reasoning: decision.reasoning,
        confidence: decision.confidence
      },
      tags: ['ai-decision', 'high-value']
    })
    
    if (decision.approved) {
      // Call another actor - context propagates automatically
      await this.fundingActor.transferFunds(loan.id, loan.amount)
    }
    
    return decision
  }
}
```

**Inter-process propagation** (through BullMQ):
- Context is serialized into message `__trace` field
- Receiving actor deserializes and restores context
- Framework handles this automatically

---

## Part 5: Saga Compensation Tracing

### The Challenge: Linking Compensations to Original Actions

When compensation runs, we need to know:
1. Which original action is being compensated
2. Was compensation successful?
3. What was compensated (for audit)

### The Mechanism

**During forward phase** (saga executing):
```typescript
async executeSagaStep(step: SagaStep) {
  const context = TraceContext.get()
  const step_span_id = generateSpanId()
  
  await tracer.emit({
    trace_id: context.trace_id,
    span_id: step_span_id,
    parent_span_id: context.span_id,
    event_type: 'saga:step_started',
    timestamp: new Date().toISOString(),
    data: {
      step_id: step.id,
      step_name: step.name,
      has_compensation: !!step.compensation
    }
  })
  
  try {
    const result = await step.execute()
    
    await tracer.emit({
      trace_id: context.trace_id,
      span_id: step_span_id,
      event_type: 'saga:step_completed',
      timestamp: new Date().toISOString(),
      status: 'success'
    })
    
    // Store span_id for potential compensation
    return { result, span_id: step_span_id }
  } catch (error) {
    await tracer.emit({
      trace_id: context.trace_id,
      span_id: step_span_id,
      event_type: 'saga:step_failed',
      timestamp: new Date().toISOString(),
      status: 'failed',
      data: { error: error.message }
    })
    throw error
  }
}
```

**During compensation phase**:
```typescript
async compensateSagaStep(
  originalSpanId: string,
  compensationFn: () => Promise<void>
) {
  const context = TraceContext.get()
  const comp_span_id = generateSpanId()
  
  await tracer.emit({
    trace_id: context.trace_id,
    span_id: comp_span_id,
    parent_span_id: context.span_id,
    event_type: 'saga:compensating',
    timestamp: new Date().toISOString(),
    data: {
      original_span_id: originalSpanId, // LINK to forward step
      compensation_reason: 'downstream_failure'
    },
    tags: ['compensation']
  })
  
  try {
    await compensationFn()
    
    await tracer.emit({
      trace_id: context.trace_id,
      span_id: comp_span_id,
      event_type: 'saga:compensated',
      timestamp: new Date().toISOString(),
      status: 'success',
      data: {
        original_span_id: originalSpanId
      },
      tags: ['compensation']
    })
  } catch (error) {
    await tracer.emit({
      trace_id: context.trace_id,
      span_id: comp_span_id,
      event_type: 'saga:compensation_failed',
      timestamp: new Date().toISOString(),
      status: 'failed',
      data: {
        original_span_id: originalSpanId,
        error: error.message
      },
      tags: ['compensation', 'critical']
    })
    throw error
  }
}
```

**Query to link them**:
```typescript
class TraceQuery {
  getCompensationChain(): Array<{
    original: TraceEvent,
    compensation: TraceEvent | null
  }> {
    const originals = this.events.filter(e => 
      e.event_type === 'saga:step_completed'
    )
    
    return originals.map(original => ({
      original,
      compensation: this.events.find(e => 
        e.event_type === 'saga:compensating' &&
        e.data?.original_span_id === original.span_id
      ) || null
    }))
  }
}
```

---

## Part 6: BullMQ Integration Points

### Existing BullMQ Infrastructure We Can Use

**1. Job Data** - already flows through system
```typescript
// We add __trace to existing job.data
job.data = {
  ...businessData,
  __trace: { trace_id, parent_span_id }
}
```

**2. Job Events** - already exist
```typescript
// BullMQ emits these - we just listen
worker.on('active', ...)
worker.on('completed', ...)
worker.on('failed', ...)
worker.on('stalled', ...)
```

**3. Job Metadata** - can store span_id
```typescript
// When job starts, store its span_id in job metadata
await job.updateData({
  ...job.data,
  __span_id: span_id
})
```

**4. Queue Metrics** - already tracked
```typescript
// BullMQ has built-in metrics
const counts = await queue.getJobCounts()
// { waiting, active, completed, failed, delayed }
```

### What We Add (Minimal)

**Just emit trace events at BullMQ lifecycle points**:

```typescript
// In existing worker setup code
export function instrumentWorker(worker: Worker, tracer: TraceEmitter) {
  worker.on('active', async (job) => {
    const span_id = generateSpanId()
    
    // Store span_id in job for later events
    await job.updateData({
      ...job.data,
      __span_id: span_id
    })
    
    // Emit trace event
    await tracer.emit({
      trace_id: job.data.__trace?.trace_id || job.id,
      span_id,
      parent_span_id: job.data.__trace?.parent_span_id,
      event_type: 'job:started',
      timestamp: new Date().toISOString(),
      data: {
        job_id: job.id,
        job_name: job.name,
        queue: job.queueName
      }
    })
  })
  
  worker.on('completed', async (job) => {
    await tracer.emit({
      trace_id: job.data.__trace?.trace_id || job.id,
      span_id: job.data.__span_id,
      event_type: 'job:completed',
      timestamp: new Date().toISOString(),
      status: 'success'
    })
  })
  
  worker.on('failed', async (job, error) => {
    await tracer.emit({
      trace_id: job.data.__trace?.trace_id || job.id,
      span_id: job.data.__span_id,
      event_type: 'job:failed',
      timestamp: new Date().toISOString(),
      status: 'failed',
      data: { error: error.message }
    })
  })
}
```

---

## Part 7: Complete Flow Example

### Scenario: Loan Approval Workflow with Compensation

```
Workflow: Process Loan Application
  ├─ Stage 1: Validate Application (ValidatorActor)
  ├─ Stage 2: Check Credit (CreditActor)
  ├─ Stage 3: AI Decision (AIActor)
  ├─ Stage 4: Reserve Funds (FundingActor) ← FAILS HERE
  └─ Compensation: Reverse stages 3, 2, 1
```

### Complete Event Flow with Trace Propagation

```typescript
// 1. Workflow starts
{
  trace_id: 'T1',
  span_id: 'S1',           // Root span
  parent_span_id: null,    // No parent
  event_type: 'workflow:started',
  timestamp: '2025-12-22T10:00:00Z',
  data: { workflow_id: 'loan-approval', loan_id: 'L123' }
}

// 2. Stage 1 starts (validator)
{
  trace_id: 'T1',
  span_id: 'S2',
  parent_span_id: 'S1',    // Child of workflow
  event_type: 'stage:started',
  timestamp: '2025-12-22T10:00:01Z',
  data: { stage_id: 'validate', actor: 'ValidatorActor' }
}

// 3. BullMQ job sent to ValidatorActor
// Message: { method: 'validate', params: {...}, __trace: { trace_id: 'T1', parent_span_id: 'S2' } }

// 4. ValidatorActor job starts
{
  trace_id: 'T1',
  span_id: 'S3',
  parent_span_id: 'S2',    // Child of stage
  event_type: 'job:started',
  timestamp: '2025-12-22T10:00:01.100Z',
  data: { job_id: 'J1', actor: 'ValidatorActor' }
}

// 5. ValidatorActor processes
{
  trace_id: 'T1',
  span_id: 'S4',
  parent_span_id: 'S3',    // Child of job
  event_type: 'actor:started',
  timestamp: '2025-12-22T10:00:01.200Z',
  data: { actor_type: 'ValidatorActor', method: 'validate' }
}

// 6. Validation succeeds
{
  trace_id: 'T1',
  span_id: 'S4',
  event_type: 'actor:completed',
  timestamp: '2025-12-22T10:00:02.000Z',
  status: 'success'
}

// 7. Job completes
{
  trace_id: 'T1',
  span_id: 'S3',
  event_type: 'job:completed',
  timestamp: '2025-12-22T10:00:02.100Z',
  status: 'success'
}

// 8. Stage 1 completes
{
  trace_id: 'T1',
  span_id: 'S2',
  event_type: 'stage:completed',
  timestamp: '2025-12-22T10:00:02.200Z',
  status: 'success'
}

// ... Stages 2 and 3 complete similarly ...

// 9. Stage 4 starts (funding)
{
  trace_id: 'T1',
  span_id: 'S10',
  parent_span_id: 'S1',
  event_type: 'stage:started',
  timestamp: '2025-12-22T10:00:05Z',
  data: { stage_id: 'reserve_funds', actor: 'FundingActor' }
}

// 10. FundingActor FAILS
{
  trace_id: 'T1',
  span_id: 'S11',
  parent_span_id: 'S10',
  event_type: 'actor:failed',
  timestamp: '2025-12-22T10:00:06Z',
  status: 'failed',
  data: { error: 'Insufficient funds' }
}

// 11. Compensation decision
{
  trace_id: 'T1',
  span_id: 'S12',
  parent_span_id: 'S1',
  event_type: 'saga:compensation_started',
  timestamp: '2025-12-22T10:00:06.100Z',
  data: { failed_at_span: 'S11', reason: 'Insufficient funds' }
}

// 12. Compensate Stage 3
{
  trace_id: 'T1',
  span_id: 'S13',
  parent_span_id: 'S12',
  event_type: 'saga:compensating',
  timestamp: '2025-12-22T10:00:06.200Z',
  data: { original_span_id: 'S8' },  // Links to original stage 3
  tags: ['compensation']
}

// 13. Compensation succeeds
{
  trace_id: 'T1',
  span_id: 'S13',
  event_type: 'saga:compensated',
  timestamp: '2025-12-22T10:00:07Z',
  status: 'success',
  tags: ['compensation']
}

// ... Compensate stages 2 and 1 ...

// 14. Workflow fails (after compensation)
{
  trace_id: 'T1',
  span_id: 'S1',
  event_type: 'workflow:failed',
  timestamp: '2025-12-22T10:00:10Z',
  status: 'failed',
  data: { error: 'Insufficient funds', compensated: true }
}
```

### Query Results

**"Why did workflow fail?"**
```typescript
const events = await reader.getTrace('T1')
const query = new TraceQuery(events)

const failure = query.getFailure()
// → span_id: 'S11', error: 'Insufficient funds'

const path = query.getPath('S11')
// → [S1, S10, S11] - workflow → stage 4 → actor failure
```

**"What got compensated?"**
```typescript
const compensations = query.findByType('saga:compensating')
// → [S13 (stage 3), S14 (stage 2), S15 (stage 1)]

const chain = compensations.map(comp => ({
  compensation: comp,
  original: events.find(e => e.span_id === comp.data.original_span_id)
}))
```

---

## Part 8: Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] TraceEmitter (writes to CosmosDB)
- [ ] TraceReader (queries CosmosDB)
- [ ] TraceQuery (in-memory operations)
- [ ] TraceContext (AsyncLocalStorage)

### Phase 2: BullMQ Integration
- [ ] `instrumentWorker()` - hook into job lifecycle
- [ ] Modify job data to include `__trace` field
- [ ] Store `__span_id` in job metadata

### Phase 3: Actor Instrumentation
- [ ] Modify `BaseActor.processMessage()` to:
  - Extract `__trace` from message
  - Create TraceContext
  - Emit start/complete/fail events
- [ ] Modify `ActorProxy.call()` to:
  - Get current TraceContext
  - Add `__trace` to message

### Phase 4: Executor Instrumentation
- [ ] Modify `WorkflowExecutor` to:
  - Create root trace
  - Emit workflow events
  - Handle compensation tracing
- [ ] Saga-specific helpers

### Phase 5: Developer API
- [ ] Helper to manually emit events
- [ ] Helper to create child spans
- [ ] Query API for debugging

---

## Conclusion: The Complete Picture

**WHAT**: TraceEvent with 7 fields

**WHEN**:
- Job lifecycle (BullMQ events)
- Actor start/complete/fail
- Workflow start/complete/fail
- Compensation start/complete
- Manual domain events

**HOW**:
- Context propagates through message `__trace` field
- AsyncLocalStorage maintains context within process
- Framework automatically instruments at boundaries
- Developer explicitly emits domain events

**WHERE**:
- BullMQ worker setup (instrument)
- BaseActor.processMessage (instrument)
- ActorProxy.call (inject context)
- WorkflowExecutor (orchestrate)
- Application code (domain events)

**Result**: Every message through the system carries trace context. Every boundary emits events. Queries work.
