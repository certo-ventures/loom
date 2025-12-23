# Observability Integration: Complete System Hookup

## Part 1: System Architecture Understanding

### What We Have

```
Actors (src/actor/actor.ts)
  ↓ execute methods via messages
BullMQ (ActorWorker processes messages)
  ↓ dequeues and dispatches
Actor Runtime (activates/deactivates actors)
  ↓ manages lifecycle
Primitives (saga, locks, coordination)
  ↓ used by actors
Executors (pipeline, tool executors)
  ↓ orchestrates workflows
```

### Key Components

1. **Actor** - Base class, has state, processes messages
2. **ActorWorker** - Dequeues messages from BullMQ, calls runtime
3. **ActorRuntime** - Activates actors, manages pool
4. **SagaCoordinator** - Records/executes compensations
5. **LockManager** - Distributed locks
6. **CoordinationAdapter** - Actor activation locks
7. **Tool/Pipeline Executors** - High-level orchestration

---

## Part 2: Integration Points (Where to Hook Observability)

### Integration Point 1: ActorWorker Message Processing

**File**: `src/runtime/actor-worker.ts`

**Current code** (lines 82-110):
```typescript
private async processMessage(message: Message): Promise<void> {
  const { actorId, messageType, payload } = message

  try {
    // 1. Activate actor (or get if already active)
    logger.debug({ actorId, messageType }, 'Activating actor')
    const actor = await this.runtime.activateActor(actorId, this.actorType)
    metrics.increment('actor.activated', 1, { actorType: this.actorType })

    // 2. Execute based on message type
    // ... rest of processing
  }
}
```

**Add observability**:
```typescript
private async processMessage(message: Message): Promise<void> {
  const { actorId, messageType, payload } = message

  // Extract or create trace context
  const trace = message.trace || tracer.createContext()
  const span_id = tracer.generateId()

  // Emit message received event
  await tracer.emit({
    trace_id: trace.trace_id,
    span_id,
    parent_span_id: trace.parent_span_id,
    event_type: 'message:received',
    timestamp: new Date().toISOString(),
    data: {
      actor_id: actorId,
      actor_type: this.actorType,
      message_type: messageType,
      queue: `actor:${this.actorType}`
    }
  })

  try {
    // Activate actor
    const actor = await this.runtime.activateActor(actorId, this.actorType)
    
    // Emit activation event
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      event_type: 'actor:activated',
      timestamp: new Date().toISOString(),
      status: 'success'
    })

    // Execute (pass trace context)
    // ... rest of processing with trace context
    
  } catch (error) {
    // Emit failure event
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      event_type: 'message:failed',
      timestamp: new Date().toISOString(),
      status: 'failed',
      data: { error: error.message }
    })
    throw error
  }
}
```

### Integration Point 2: Actor Base Class Execution

**File**: `src/actor/actor.ts`

**Current**: Actor already has `tracer` field (line 29), but it's using old Tracer class

**Update**: Replace with new trace system

```typescript
export abstract class Actor {
  protected state: Record<string, unknown>
  protected context: ActorContext
  protected readonly simpleState: SimpleState
  
  // Add trace context
  protected trace?: TraceContext
  
  constructor(context: ActorContext, initialState?: Record<string, unknown>) {
    this.context = context
    this.state = initialState ?? this.getDefaultState()
    
    // Extract trace from context (added by worker)
    this.trace = context.trace
    
    // Initialize simple state facade
    this.simpleState = new SimpleStateImpl(
      () => this.state,
      (newState) => {
        this.state = newState
        if (!this.isReplaying) {
          this.journal.entries.push({
            type: 'state_updated',
            state: this.state,
          })
          
          // Emit state change event (if tracing enabled)
          if (this.trace) {
            emitEvent({
              trace_id: this.trace.trace_id,
              span_id: generateId(),
              parent_span_id: this.trace.span_id,
              event_type: 'actor:state_changed',
              timestamp: new Date().toISOString()
            })
          }
        }
      }
    )
  }
  
  /**
   * Actors can manually emit domain events
   */
  protected async emitTraceEvent(
    event_type: string,
    data?: any,
    tags?: string[]
  ): Promise<void> {
    if (!this.trace) return
    
    await emitEvent({
      trace_id: this.trace.trace_id,
      span_id: generateId(),
      parent_span_id: this.trace.span_id,
      event_type,
      timestamp: new Date().toISOString(),
      data,
      tags
    })
  }
}
```

### Integration Point 3: SagaCoordinator

**File**: `src/pipelines/saga-coordinator.ts`

**Hook compensation recording and execution**:

```typescript
async recordCompensation(
  pipelineId: string,
  stage: StageDefinition,
  stageOutput: any,
  trace?: TraceContext  // Add trace parameter
): Promise<void> {
  if (!stage.compensation) return
  
  const compensationInput = this.resolveCompensationInput(
    stage.compensation.input,
    stageOutput
  )
  
  const action: CompensationAction = {
    pipelineId,
    stageName: stage.name,
    actor: stage.compensation.actor,
    input: compensationInput,
    timestamp: Date.now(),
    stageOutput
  }
  
  // Store in Redis
  await this.redis.lpush(
    `saga:${pipelineId}:compensations`,
    JSON.stringify(action)
  )
  
  // Emit trace event
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: generateId(),
      parent_span_id: trace.span_id,
      event_type: 'saga:compensation_recorded',
      timestamp: new Date().toISOString(),
      data: {
        pipeline_id: pipelineId,
        stage_name: stage.name,
        compensation_actor: stage.compensation.actor
      },
      tags: ['saga', 'compensation']
    })
  }
}

async executeCompensations(
  pipelineId: string,
  trace?: TraceContext  // Add trace parameter
): Promise<void> {
  // Create child span for compensation phase
  const comp_span_id = generateId()
  
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: comp_span_id,
      parent_span_id: trace.span_id,
      event_type: 'saga:compensation_started',
      timestamp: new Date().toISOString(),
      data: { pipeline_id: pipelineId },
      tags: ['saga', 'compensation']
    })
  }
  
  let compensationCount = 0
  let action: string | null
  
  while ((action = await this.redis.rpop(`saga:${pipelineId}:compensations`))) {
    const compensation: CompensationAction = JSON.parse(action)
    const comp_action_span_id = generateId()
    
    try {
      // Emit compensation start
      if (trace) {
        await tracer.emit({
          trace_id: trace.trace_id,
          span_id: comp_action_span_id,
          parent_span_id: comp_span_id,
          event_type: 'saga:compensating',
          timestamp: new Date().toISOString(),
          data: {
            stage_name: compensation.stageName,
            actor: compensation.actor,
            original_timestamp: compensation.timestamp
          },
          tags: ['saga', 'compensation']
        })
      }
      
      // Enqueue compensation message (with trace context)
      const message: PipelineMessage = {
        messageId: uuidv4(),
        pipelineId,
        stageIndex: -1, // Compensation marker
        input: compensation.input,
        trace: trace ? {  // Propagate trace
          trace_id: trace.trace_id,
          parent_span_id: comp_action_span_id
        } : undefined
      }
      
      await this.messageQueue.enqueue(`actor:${compensation.actor}`, message)
      
      // Wait for completion...
      
      // Emit compensation success
      if (trace) {
        await tracer.emit({
          trace_id: trace.trace_id,
          span_id: comp_action_span_id,
          event_type: 'saga:compensated',
          timestamp: new Date().toISOString(),
          status: 'success',
          tags: ['saga', 'compensation']
        })
      }
      
      compensationCount++
      
    } catch (error) {
      // Emit compensation failure
      if (trace) {
        await tracer.emit({
          trace_id: trace.trace_id,
          span_id: comp_action_span_id,
          event_type: 'saga:compensation_failed',
          timestamp: new Date().toISOString(),
          status: 'failed',
          data: { error: error.message },
          tags: ['saga', 'compensation', 'critical']
        })
      }
      throw error
    }
  }
  
  // Emit compensation phase complete
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: comp_span_id,
      event_type: 'saga:compensation_completed',
      timestamp: new Date().toISOString(),
      status: 'success',
      data: { compensations_executed: compensationCount },
      tags: ['saga', 'compensation']
    })
  }
}
```

### Integration Point 4: Lock Acquisition

**File**: `src/storage/lock-manager.ts` implementations

**Hook lock operations**:

```typescript
async acquire(
  key: string,
  ttlMs: number,
  trace?: TraceContext
): Promise<Lock | null> {
  const span_id = generateId()
  
  // Emit lock attempt
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      parent_span_id: trace.span_id,
      event_type: 'lock:attempting',
      timestamp: new Date().toISOString(),
      data: { lock_key: key, ttl_ms: ttlMs },
      tags: ['lock']
    })
  }
  
  const lock = await this.internalAcquire(key, ttlMs)
  
  // Emit result
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      event_type: lock ? 'lock:acquired' : 'lock:blocked',
      timestamp: new Date().toISOString(),
      status: lock ? 'success' : 'failed',
      data: { lock_key: key, blocked: !lock },
      tags: ['lock']
    })
  }
  
  return lock
}

async release(lock: Lock, trace?: TraceContext): Promise<void> {
  // Emit lock release
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: generateId(),
      parent_span_id: trace.span_id,
      event_type: 'lock:released',
      timestamp: new Date().toISOString(),
      data: { lock_key: lock.key },
      tags: ['lock']
    })
  }
  
  await this.internalRelease(lock)
}
```

### Integration Point 5: CoordinationAdapter (Actor Locks)

**File**: `src/storage/coordination-adapter.ts` implementations

**Hook actor activation locks**:

```typescript
async acquireLock(
  actorId: string,
  ttlMs: number,
  trace?: TraceContext
): Promise<ActorLock | null> {
  const span_id = generateId()
  
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      parent_span_id: trace.span_id,
      event_type: 'coordination:lock_attempt',
      timestamp: new Date().toISOString(),
      data: { actor_id: actorId, ttl_ms: ttlMs },
      tags: ['coordination', 'lock']
    })
  }
  
  const lock = await this.internalAcquireLock(actorId, ttlMs)
  
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      event_type: lock ? 'coordination:lock_acquired' : 'coordination:lock_blocked',
      timestamp: new Date().toISOString(),
      status: lock ? 'success' : 'failed',
      data: { actor_id: actorId, acquired: !!lock },
      tags: ['coordination', 'lock']
    })
  }
  
  return lock
}
```

---

## Part 3: Message Flow with Trace Propagation

### Complete Flow Example

```typescript
// 1. Pipeline Executor starts workflow
const trace = tracer.createContext() // New trace

await tracer.emit({
  trace_id: trace.trace_id,
  span_id: trace.span_id,
  event_type: 'pipeline:started',
  timestamp: new Date().toISOString(),
  data: { pipeline_id: 'loan-approval' }
})

// 2. Executor enqueues stage 1 message
await messageQueue.enqueue('actor:Validator', {
  actorId: 'validator-1',
  messageType: 'validate',
  payload: { loan_id: 'L123' },
  trace: {  // Propagate trace
    trace_id: trace.trace_id,
    parent_span_id: trace.span_id
  }
})

// 3. ActorWorker dequeues message
// - Extracts trace from message
// - Emits 'message:received' event
// - Activates actor

// 4. Actor executes
// - Has trace context in this.trace
// - Can emit domain events: this.emitTraceEvent('loan:validated', {...})

// 5. Actor calls another actor
await this.proxy.callActor('CreditChecker', 'checkCredit', {
  loan_id: 'L123',
  trace: {  // Propagate trace
    trace_id: this.trace.trace_id,
    parent_span_id: this.trace.span_id  // Current actor is parent
  }
})

// 6. If stage fails, saga compensation starts
await sagaCoordinator.executeCompensations(pipelineId, trace)
// - Emits compensation events
// - Links to original actions via data.original_span_id

// 7. Pipeline completes
await tracer.emit({
  trace_id: trace.trace_id,
  span_id: trace.span_id,
  event_type: 'pipeline:completed',
  timestamp: new Date().toISOString(),
  status: 'success'
})
```

---

## Part 4: Querying "What Happened"

### Query Interface

```typescript
import { TraceReader, TraceQuery } from './observability/trace'

// Initialize reader with CosmosDB container
const reader = new TraceReader(cosmosContainer)

// === Query 1: Get full execution trace ===
const events = await reader.getTrace('pipeline-123')
const query = new TraceQuery(events)

// Get execution tree
const tree = query.buildTree()
console.log(tree)
/*
{
  event: { event_type: 'pipeline:started', ... },
  children: [
    {
      event: { event_type: 'stage:validate:started', ... },
      children: [
        { event: { event_type: 'message:received', ... }, children: [] },
        { event: { event_type: 'actor:activated', ... }, children: [] }
      ]
    },
    {
      event: { event_type: 'stage:credit:started', ... },
      children: [...]
    }
  ]
}
*/

// === Query 2: Find failure ===
const failure = query.getFailure()
if (failure) {
  console.log(`Failed at: ${failure.event_type}`)
  console.log(`Error: ${failure.data?.error}`)
  
  // Get path from root to failure
  const path = query.getPath(failure.span_id)
  path.forEach(event => {
    console.log(`  → ${event.event_type} (${event.timestamp})`)
  })
}

// === Query 3: What got compensated? ===
const compensations = query.getCompensations()
compensations.forEach(({ compensation, original }) => {
  console.log(`Compensated: ${original?.event_type}`)
  console.log(`  via: ${compensation.event_type}`)
  console.log(`  status: ${compensation.status}`)
})

// === Query 4: Find all lock operations ===
const locks = query.findByType('lock:acquired')
  .concat(query.findByType('lock:blocked'))
  .concat(query.findByType('lock:released'))

locks.forEach(lock => {
  console.log(`${lock.event_type}: ${lock.data.lock_key}`)
})

// === Query 5: Timeline view ===
events.forEach(event => {
  console.log(`[${event.timestamp}] ${event.event_type}`)
  if (event.status === 'failed') {
    console.log(`  ❌ ${event.data?.error}`)
  }
})

// === Query 6: AI decisions ===
const aiDecisions = events.filter(e => 
  e.tags?.includes('ai-decision')
)

aiDecisions.forEach(decision => {
  console.log(`AI Decision: ${decision.data.decision}`)
  console.log(`  Reasoning: ${decision.data.reasoning}`)
  console.log(`  Confidence: ${decision.data.confidence}`)
})
```

### Real-World Query Examples

**"Why did my loan approval fail?"**
```typescript
const events = await reader.getTrace('loan-approval-123')
const query = new TraceQuery(events)

const failure = query.getFailure()
// → { event_type: 'stage:funding:failed', data: { error: 'Insufficient funds' } }

const path = query.getPath(failure.span_id)
// → [ pipeline:started, stage:validate, stage:credit, stage:funding:failed ]

const compensations = query.getCompensations()
// → [ { original: stage:credit, compensation: saga:compensated } ]
```

**"Did all compensations succeed?"**
```typescript
const compensations = query.findByType('saga:compensating')
const failed = compensations.filter(c => c.status === 'failed')

if (failed.length > 0) {
  console.log('ALERT: Manual intervention needed!')
  failed.forEach(c => {
    console.log(`Failed to compensate: ${c.data.stage_name}`)
  })
}
```

**"Was this actor blocked by a lock?"**
```typescript
const locks = query.findByType('lock:blocked')
if (locks.length > 0) {
  locks.forEach(lock => {
    console.log(`Blocked waiting for: ${lock.data.lock_key}`)
    console.log(`  at: ${lock.timestamp}`)
  })
}
```

**"Show me all AI decisions in this workflow"**
```typescript
const aiDecisions = events.filter(e => e.tags?.includes('ai-decision'))
aiDecisions.forEach(d => {
  console.log(`Decision: ${d.data.decision}`)
  console.log(`Reasoning: ${d.data.reasoning}`)
  console.log(`Alternatives: ${d.data.alternatives.join(', ')}`)
})
```

---

## Part 5: Integration with ALL System Primitives

### Primitive 1: Locks (LockManager)
✅ **Integrated**: See Integration Point 4
- Events: `lock:attempting`, `lock:acquired`, `lock:blocked`, `lock:released`
- Query: Find deadlocks, blocked actors, lock duration

### Primitive 2: Saga (SagaCoordinator)
✅ **Integrated**: See Integration Point 3
- Events: `saga:compensation_recorded`, `saga:compensating`, `saga:compensated`, `saga:compensation_failed`
- Query: What was compensated, did compensations succeed

### Primitive 3: Actor Coordination (CoordinationAdapter)
✅ **Integrated**: See Integration Point 5
- Events: `coordination:lock_attempt`, `coordination:lock_acquired`, `coordination:lock_blocked`
- Query: Which instances tried to activate same actor, race conditions

### Primitive 4: State Machines (if exists)
**To integrate**: Emit events on state transitions
```typescript
async transition(from: string, to: string, trace?: TraceContext) {
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: generateId(),
      parent_span_id: trace.span_id,
      event_type: 'state:transition',
      timestamp: new Date().toISOString(),
      data: { from_state: from, to_state: to },
      tags: ['state-machine']
    })
  }
  
  this.currentState = to
}
```

### Primitive 5: Fan-out/Gather (if exists)
**To integrate**: Emit events when forking/gathering
```typescript
async fanOut(tasks: Task[], trace?: TraceContext) {
  const fan_span_id = generateId()
  
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: fan_span_id,
      parent_span_id: trace.span_id,
      event_type: 'fanout:started',
      timestamp: new Date().toISOString(),
      data: { task_count: tasks.length },
      tags: ['fanout']
    })
  }
  
  // Execute tasks in parallel (each gets fan_span_id as parent)
  const results = await Promise.all(
    tasks.map(task => 
      executeTask(task, {
        trace_id: trace.trace_id,
        parent_span_id: fan_span_id
      })
    )
  )
  
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: fan_span_id,
      event_type: 'fanout:completed',
      timestamp: new Date().toISOString(),
      status: 'success',
      data: { completed: results.length },
      tags: ['fanout']
    })
  }
}
```

### Primitive 6: Human-in-the-Loop (if exists)
**To integrate**: Emit events for approval requests/responses
```typescript
async requestApproval(request: ApprovalRequest, trace?: TraceContext) {
  const approval_span_id = generateId()
  
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: approval_span_id,
      parent_span_id: trace.span_id,
      event_type: 'approval:requested',
      timestamp: new Date().toISOString(),
      data: {
        approver: request.assignedTo,
        reason: request.reason
      },
      tags: ['approval', 'human-in-loop']
    })
  }
  
  // Wait for decision...
  
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: approval_span_id,
      event_type: 'approval:decided',
      timestamp: new Date().toISOString(),
      status: decision.approved ? 'success' : 'failed',
      data: {
        decision: decision.approved ? 'approved' : 'rejected',
        decided_by: decision.decidedBy,
        reason: decision.reason
      },
      tags: ['approval', 'human-in-loop']
    })
  }
}
```

---

## Part 6: Implementation Checklist

### Phase 1: Core Trace System
- [ ] Create `src/observability/trace.ts` (TraceEvent, TraceWriter, TraceReader, TraceQuery)
- [ ] Create CosmosDB container: `trace-events` with partition key `/trace_id`
- [ ] Test: Write event, read event, query events

### Phase 2: ActorWorker Integration
- [ ] Update `ActorWorker.processMessage()` to extract/create trace
- [ ] Emit `message:received`, `actor:activated`, `message:completed`, `message:failed` events
- [ ] Propagate trace in `message.trace` field

### Phase 3: Actor Base Class
- [ ] Update `Actor` constructor to accept trace in context
- [ ] Add `this.trace` field
- [ ] Add `emitTraceEvent()` helper method
- [ ] Update ActorContext interface to include `trace?: TraceContext`

### Phase 4: Message Queue Integration
- [ ] Update message enqueue to accept trace parameter
- [ ] Ensure trace is included in message payload
- [ ] Update ActorProxy to propagate trace when calling actors

### Phase 5: Saga Integration
- [ ] Update `SagaCoordinator.recordCompensation()` to accept trace
- [ ] Update `SagaCoordinator.executeCompensations()` to emit events
- [ ] Propagate trace through compensation messages

### Phase 6: Lock Manager Integration
- [ ] Update `LockManager.acquire()` to emit events
- [ ] Update `LockManager.release()` to emit events
- [ ] Update `CoordinationAdapter` methods similarly

### Phase 7: Testing & Validation
- [ ] Run existing test: Verify no regressions
- [ ] Create trace for test workflow
- [ ] Query trace, verify all expected events present
- [ ] Verify trace_id propagates correctly through actor calls
- [ ] Verify compensations link to original actions

### Phase 8: Documentation & Examples
- [ ] Document how to query traces
- [ ] Provide example queries for common scenarios
- [ ] Document how actors can emit custom events
- [ ] Create troubleshooting guide

---

## Part 7: Zero-Breaking-Changes Strategy

### Make Trace Optional Everywhere

All integration points accept **optional** trace parameter:

```typescript
// Old code still works
await lockManager.acquire('key', 5000)

// New code with tracing
await lockManager.acquire('key', 5000, trace)
```

### Backward Compatibility

```typescript
// Message interface
interface Message {
  actorId: string
  messageType: string
  payload: any
  trace?: TraceContext  // Optional - old messages don't have it
}

// ActorContext interface
interface ActorContext {
  actorId: string
  // ... existing fields
  trace?: TraceContext  // Optional - old actors don't need it
}
```

### Gradual Rollout

1. Add trace system (no usage yet)
2. Update ActorWorker to emit events (auto-instruments all actors)
3. Update specific actors to emit domain events (opt-in)
4. Update saga/locks to emit events (opt-in via trace parameter)

**Result**: System works with or without tracing. No breaking changes.

---

## Summary

### How It Works with Actors
- Actors receive trace in `context.trace`
- Actors can emit events: `this.emitTraceEvent(...)`
- Actor calls propagate trace automatically via message queue

### How It Works with Workers
- Workers extract trace from message
- Workers emit lifecycle events (received, activated, completed)
- Workers pass trace to actors via context

### How It Works with Executors
- Executors create root trace
- Executors propagate trace when enqueuing stages
- Executors emit orchestration events (pipeline started/completed)

### How to Query "What Happened"
```typescript
const events = await reader.getTrace(trace_id)
const query = new TraceQuery(events)

query.getFailure()           // Find what failed
query.getPath(span_id)       // Get execution path
query.getCompensations()     // Get compensation chain
query.findByType(type)       // Find specific events
query.buildTree()            // Get hierarchical view
```

### Integration with Primitives
✅ Locks - emit acquire/release events
✅ Saga - emit compensation events, link to originals
✅ Coordination - emit actor lock events
✅ State Machines - emit transition events
✅ Fan-out/Gather - emit fork/join events
✅ Human-in-Loop - emit approval events

**Everything traces. Everything queries. Zero breaking changes.**
