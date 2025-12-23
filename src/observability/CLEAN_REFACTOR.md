# Observability: Clean Refactor (No Breaking Changes Concern)

## The Key Insight

**If observability is core to the system, make trace context REQUIRED, not optional.**

This eliminates:
- ❌ `if (trace)` conditionals everywhere
- ❌ `trace?: TraceContext` optional parameters
- ❌ Two code paths (with/without tracing)
- ❌ Uncertainty about whether events are being emitted

Instead:
- ✅ Trace context flows explicitly through all calls
- ✅ Every operation is traced by default
- ✅ Simpler, more predictable code
- ✅ Easier to test and debug

---

## Part 1: Core Changes

### Change 1: Message Interface (REQUIRED Trace)

**OLD (optional)**:
```typescript
interface Message {
  actorId: string
  messageType: string
  payload: any
  trace?: TraceContext  // Optional - messy
}
```

**NEW (required)**:
```typescript
interface Message {
  actorId: string
  messageType: string
  payload: any
  trace: TraceContext  // Always present
}
```

### Change 2: ActorContext Interface (REQUIRED Trace)

**OLD**:
```typescript
interface ActorContext {
  actorId: string
  correlationId?: string
  // ... other fields
}
```

**NEW**:
```typescript
interface ActorContext {
  actorId: string
  trace: TraceContext  // First-class citizen
  // ... other fields
}
```

### Change 3: Actor Base Class (REQUIRED Trace)

**OLD**:
```typescript
export abstract class Actor {
  protected trace?: TraceContext  // Optional
  
  constructor(context: ActorContext, initialState?: Record<string, unknown>) {
    this.trace = context.trace  // Might be undefined
    
    if (this.trace) {
      // Emit events
    }
  }
  
  protected async emitTraceEvent(...) {
    if (!this.trace) return  // Conditional check
    // ...
  }
}
```

**NEW**:
```typescript
export abstract class Actor {
  protected readonly trace: TraceContext  // Always present, immutable
  
  constructor(context: ActorContext, initialState?: Record<string, unknown>) {
    this.trace = context.trace  // Always defined
    
    // Always emit events (no conditionals)
    this.emitEvent('actor:created', { initialState })
  }
  
  // Cleaner helper (no conditionals)
  protected async emitEvent(
    event_type: string,
    data?: any,
    tags?: string[]
  ): Promise<void> {
    await tracer.emit({
      trace_id: this.trace.trace_id,
      span_id: generateId(),
      parent_span_id: this.trace.span_id,
      event_type,
      timestamp: new Date().toISOString(),
      data,
      tags
    })
  }
  
  // Create child context for nested operations
  protected createChildContext(): TraceContext {
    return {
      trace_id: this.trace.trace_id,
      span_id: generateId()
    }
  }
}
```

### Change 4: LockManager Interface (REQUIRED Trace)

**OLD**:
```typescript
interface LockManager {
  acquire(key: string, ttlMs: number, trace?: TraceContext): Promise<Lock | null>
  release(lock: Lock, trace?: TraceContext): Promise<void>
}
```

**NEW**:
```typescript
interface LockManager {
  acquire(key: string, ttlMs: number, trace: TraceContext): Promise<Lock | null>
  release(lock: Lock, trace: TraceContext): Promise<void>
}
```

### Change 5: SagaCoordinator (REQUIRED Trace)

**OLD**:
```typescript
async recordCompensation(
  pipelineId: string,
  stage: StageDefinition,
  stageOutput: any,
  trace?: TraceContext
): Promise<void>
```

**NEW**:
```typescript
async recordCompensation(
  pipelineId: string,
  stage: StageDefinition,
  stageOutput: any,
  trace: TraceContext  // Required
): Promise<void>
```

---

## Part 2: Simplified ActorWorker

**OLD (with conditionals)**:
```typescript
private async processMessage(message: Message): Promise<void> {
  // Extract or create trace context
  const trace = message.trace || tracer.createContext()
  
  if (trace) {
    await tracer.emit({ ... })
  }
  
  // More conditionals...
}
```

**NEW (no conditionals)**:
```typescript
private async processMessage(message: Message): Promise<void> {
  const { trace } = message  // Always present
  const span_id = generateId()
  
  // Always emit (no conditionals)
  await tracer.emit({
    trace_id: trace.trace_id,
    span_id,
    parent_span_id: trace.span_id,
    event_type: 'message:received',
    timestamp: new Date().toISOString(),
    data: {
      actor_id: message.actorId,
      actor_type: this.actorType,
      message_type: message.messageType
    }
  })
  
  try {
    // Create context for actor
    const actorContext: ActorContext = {
      actorId: message.actorId,
      trace: {
        trace_id: trace.trace_id,
        span_id  // This becomes actor's span
      }
    }
    
    // Activate actor
    const actor = await this.runtime.activateActor(
      message.actorId,
      this.actorType,
      actorContext
    )
    
    // Execute actor (actor has trace in context)
    await actor.handleMessage(message)
    
    // Success event
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      event_type: 'message:completed',
      timestamp: new Date().toISOString(),
      status: 'success'
    })
    
  } catch (error) {
    // Failure event
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

---

## Part 3: Simplified Actor Usage

### Actor Implementation (Clean)

```typescript
export class LoanProcessorActor extends Actor {
  async processLoan(loanData: any): Promise<void> {
    // Emit domain event (no conditionals, always works)
    await this.emitEvent('loan:processing_started', { loan_id: loanData.id })
    
    // Call another actor - pass child trace
    const childTrace = this.createChildContext()
    await this.callActor('CreditChecker', 'checkCredit', loanData, childTrace)
    
    // Acquire lock - pass trace explicitly
    const lock = await this.lockManager.acquire(
      `loan:${loanData.id}`,
      5000,
      this.trace
    )
    
    if (!lock) {
      await this.emitEvent('lock:blocked', { loan_id: loanData.id })
      throw new Error('Could not acquire lock')
    }
    
    try {
      // Process loan...
      const decision = await this.aiAgent.decide(loanData)
      
      // Emit AI decision
      await this.emitEvent('ai:decision', {
        decision: decision.approved,
        reasoning: decision.reasoning,
        confidence: decision.confidence
      }, ['ai-decision'])
      
      await this.emitEvent('loan:processed', { loan_id: loanData.id })
      
    } finally {
      await this.lockManager.release(lock, this.trace)
    }
  }
  
  // Helper to call other actors
  private async callActor(
    actorType: string,
    method: string,
    params: any,
    childTrace: TraceContext
  ): Promise<any> {
    // Enqueue message with trace
    await this.messageQueue.enqueue(`actor:${actorType}`, {
      actorId: `${actorType}-1`,
      messageType: method,
      payload: params,
      trace: childTrace  // Explicitly pass child trace
    })
  }
}
```

---

## Part 4: Trace Creation at Entry Points

### Entry Point: HTTP Request

```typescript
app.post('/api/loans', async (req, res) => {
  // Create root trace for this request
  const trace = tracer.createContext()
  
  // Emit entry event
  await tracer.emit({
    trace_id: trace.trace_id,
    span_id: trace.span_id,
    event_type: 'http:request',
    timestamp: new Date().toISOString(),
    data: {
      method: req.method,
      path: req.path,
      user_id: req.user?.id
    },
    tags: ['http']
  })
  
  try {
    // Start workflow with trace
    const result = await startLoanWorkflow(req.body, trace)
    
    res.json(result)
    
  } catch (error) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: trace.span_id,
      event_type: 'http:error',
      timestamp: new Date().toISOString(),
      status: 'failed',
      data: { error: error.message },
      tags: ['http']
    })
    
    res.status(500).json({ error: error.message })
  }
})
```

### Entry Point: Scheduled Job

```typescript
async function runDailyReportJob() {
  // Create root trace for job
  const trace = tracer.createContext()
  
  await tracer.emit({
    trace_id: trace.trace_id,
    span_id: trace.span_id,
    event_type: 'job:started',
    timestamp: new Date().toISOString(),
    data: { job_name: 'daily-report' },
    tags: ['scheduled-job']
  })
  
  // Run job with trace
  await generateDailyReport(trace)
  
  await tracer.emit({
    trace_id: trace.trace_id,
    span_id: trace.span_id,
    event_type: 'job:completed',
    timestamp: new Date().toISOString(),
    status: 'success',
    tags: ['scheduled-job']
  })
}
```

### Entry Point: Event Handler

```typescript
eventBus.on('loan:approved', async (loanId: string) => {
  // Create trace for event processing
  const trace = tracer.createContext()
  
  await tracer.emit({
    trace_id: trace.trace_id,
    span_id: trace.span_id,
    event_type: 'event:received',
    timestamp: new Date().toISOString(),
    data: { event: 'loan:approved', loan_id: loanId },
    tags: ['event-driven']
  })
  
  // Process event with trace
  await notifyCustomer(loanId, trace)
})
```

---

## Part 5: Simplified Saga Integration

**OLD (with conditionals)**:
```typescript
async executeCompensations(pipelineId: string, trace?: TraceContext): Promise<void> {
  if (trace) {
    await tracer.emit({ ... })
  }
  // More conditionals...
}
```

**NEW (no conditionals)**:
```typescript
async executeCompensations(pipelineId: string, trace: TraceContext): Promise<void> {
  const comp_span_id = generateId()
  
  // Always emit
  await tracer.emit({
    trace_id: trace.trace_id,
    span_id: comp_span_id,
    parent_span_id: trace.span_id,
    event_type: 'saga:compensation_started',
    timestamp: new Date().toISOString(),
    data: { pipeline_id: pipelineId },
    tags: ['saga', 'compensation']
  })
  
  let compensationCount = 0
  let action: string | null
  
  while ((action = await this.redis.rpop(`saga:${pipelineId}:compensations`))) {
    const compensation: CompensationAction = JSON.parse(action)
    const comp_action_span = generateId()
    
    // Always emit
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: comp_action_span,
      parent_span_id: comp_span_id,
      event_type: 'saga:compensating',
      timestamp: new Date().toISOString(),
      data: {
        stage_name: compensation.stageName,
        actor: compensation.actor
      },
      tags: ['saga', 'compensation']
    })
    
    try {
      // Enqueue compensation message (with trace)
      await this.messageQueue.enqueue(`actor:${compensation.actor}`, {
        actorId: `${compensation.actor}-compensation`,
        messageType: 'compensate',
        payload: compensation.input,
        trace: {  // Required trace
          trace_id: trace.trace_id,
          parent_span_id: comp_action_span
        }
      })
      
      // Wait for completion...
      
      // Always emit success
      await tracer.emit({
        trace_id: trace.trace_id,
        span_id: comp_action_span,
        event_type: 'saga:compensated',
        timestamp: new Date().toISOString(),
        status: 'success',
        tags: ['saga', 'compensation']
      })
      
      compensationCount++
      
    } catch (error) {
      // Always emit failure
      await tracer.emit({
        trace_id: trace.trace_id,
        span_id: comp_action_span,
        event_type: 'saga:compensation_failed',
        timestamp: new Date().toISOString(),
        status: 'failed',
        data: { error: error.message },
        tags: ['saga', 'compensation', 'critical']
      })
      throw error
    }
  }
  
  // Always emit completion
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
```

---

## Part 6: Benefits of Required Trace

### 1. Simpler Code (No Conditionals)

**Before**:
```typescript
if (trace) {
  await tracer.emit({ ... })
}
if (trace) {
  const child = { trace_id: trace.trace_id, ... }
}
```

**After**:
```typescript
await tracer.emit({ ... })
const child = { trace_id: trace.trace_id, ... }
```

### 2. Explicit Context Flow

**Before** (implicit, might be missing):
```typescript
await lockManager.acquire('key', 5000)
// Where does trace come from? Is it being traced?
```

**After** (explicit, always clear):
```typescript
await lockManager.acquire('key', 5000, this.trace)
// Clear: using this actor's trace context
```

### 3. Better Type Safety

**Before**:
```typescript
trace?: TraceContext  // Might be undefined
trace.trace_id  // Type error: trace might be undefined
```

**After**:
```typescript
trace: TraceContext  // Always defined
trace.trace_id  // Type-safe
```

### 4. Easier Testing

**Before** (need to handle optional):
```typescript
const message = {
  actorId: 'test',
  messageType: 'test',
  payload: {},
  trace: undefined  // Or create one?
}
```

**After** (always provide):
```typescript
const trace = { trace_id: 'test-trace', span_id: 'test-span' }
const message = {
  actorId: 'test',
  messageType: 'test',
  payload: {},
  trace  // Always required, clear what to provide
}
```

### 5. No Silent Failures

**Before**:
```typescript
if (!trace) return  // Silent - event not emitted
```

**After**:
```typescript
await tracer.emit({ ... })  // Always emits
// If tracer fails, it throws (visible error)
```

---

## Part 7: What Changes in Implementation

### Updated File Structure

```typescript
// src/observability/trace.ts (same as before, ~150 lines)
export interface TraceEvent { ... }
export interface TraceContext { ... }
export class TraceWriter { ... }
export class TraceReader { ... }
export class TraceQuery { ... }

// src/observability/instrumentation.ts (NEW - centralized)
import { TraceWriter } from './trace'

// Global tracer instance
export const tracer = new TraceWriter(cosmosContainer)

// Helper functions
export function generateId(): string {
  return randomUUID()
}

export function createRootTrace(): TraceContext {
  return {
    trace_id: generateId(),
    span_id: generateId()
  }
}

export function createChildTrace(parent: TraceContext): TraceContext {
  return {
    trace_id: parent.trace_id,
    span_id: generateId()
  }
}
```

### Updated Types

```typescript
// src/types/index.ts
export interface Message {
  actorId: string
  messageType: string
  payload: any
  trace: TraceContext  // Required, not optional
}

export interface ActorContext {
  actorId: string
  trace: TraceContext  // Required, not optional
  // ... other fields
}
```

### Updated Actor Base Class

```typescript
// src/actor/actor.ts
export abstract class Actor {
  protected readonly trace: TraceContext  // Required
  
  constructor(context: ActorContext, initialState?: Record<string, unknown>) {
    this.trace = context.trace  // No conditional check
    
    // Always emit creation event
    this.emitEvent('actor:created', { initialState })
  }
  
  // Simplified helper (no conditionals)
  protected async emitEvent(
    event_type: string,
    data?: any,
    tags?: string[]
  ): Promise<void> {
    await tracer.emit({
      trace_id: this.trace.trace_id,
      span_id: generateId(),
      parent_span_id: this.trace.span_id,
      event_type,
      timestamp: new Date().toISOString(),
      data,
      tags
    })
  }
  
  protected createChildContext(): TraceContext {
    return createChildTrace(this.trace)
  }
}
```

### Updated ActorWorker

```typescript
// src/runtime/actor-worker.ts
export class ActorWorker {
  private async processMessage(message: Message): Promise<void> {
    // No conditional - trace is always present
    const { trace } = message
    const span_id = generateId()
    
    // Always emit
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      parent_span_id: trace.span_id,
      event_type: 'message:received',
      timestamp: new Date().toISOString(),
      data: {
        actor_id: message.actorId,
        message_type: message.messageType
      }
    })
    
    try {
      // Create actor context with trace
      const context: ActorContext = {
        actorId: message.actorId,
        trace: { trace_id: trace.trace_id, span_id }
      }
      
      const actor = await this.runtime.activateActor(
        message.actorId,
        this.actorType,
        context
      )
      
      await actor.handleMessage(message)
      
      await tracer.emit({
        trace_id: trace.trace_id,
        span_id,
        event_type: 'message:completed',
        timestamp: new Date().toISOString(),
        status: 'success'
      })
      
    } catch (error) {
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
}
```

---

## Part 8: Migration Strategy (Still Easy)

### Step 1: Update Types (Breaking Change, But Simple)
```typescript
// Change all interfaces to require trace
interface Message { trace: TraceContext }  // Remove ?
interface ActorContext { trace: TraceContext }  // Remove ?
```

### Step 2: Update Entry Points
```typescript
// Every entry point creates root trace
const trace = createRootTrace()
```

### Step 3: Update Actor Base Class
```typescript
// Remove all conditionals
this.trace = context.trace  // No if check
```

### Step 4: Update All Call Sites
```typescript
// Add trace parameter everywhere
await lockManager.acquire('key', 5000, this.trace)
await sagaCoordinator.executeCompensations(id, this.trace)
```

### Step 5: Fix Compilation Errors
```typescript
// TypeScript will show every place that needs trace
// Just add: trace parameter or createRootTrace()
```

**Estimate**: 2-3 hours to update entire codebase (TypeScript guides you)

---

## Part 9: Side-by-Side Comparison

### Complexity Comparison

**Optional Trace Approach**:
- Lines of code: ~400 (with conditionals)
- If statements: ~50 (`if (trace)` checks)
- Test scenarios: 2× (with and without trace)
- Uncertainty: High (is this being traced?)

**Required Trace Approach**:
- Lines of code: ~300 (no conditionals)
- If statements: 0 (no trace checks)
- Test scenarios: 1 (always traced)
- Uncertainty: None (always traced)

### Code Clarity Comparison

**Optional**:
```typescript
async doSomething(trace?: TraceContext) {
  if (trace) {
    await tracer.emit({ ... })
  }
  
  const result = await operation()
  
  if (trace) {
    await tracer.emit({ ... })
  }
  
  return result
}
```

**Required**:
```typescript
async doSomething(trace: TraceContext) {
  await tracer.emit({ ... })
  
  const result = await operation()
  
  await tracer.emit({ ... })
  
  return result
}
```

---

## Conclusion: The Right Choice for Development

### If Observability is Core (It Is)
- Make trace context **required**
- No optional parameters
- No conditionals
- Explicit context flow

### Benefits
- ✅ 25% less code
- ✅ 100% less conditionals
- ✅ Better type safety
- ✅ Clearer API
- ✅ Easier to test
- ✅ Impossible to forget tracing

### Cost
- ❌ Must update all interfaces (1-time cost)
- ❌ Must create trace at entry points

### Verdict
**For a system in development where observability is critical: REQUIRED TRACE IS THE WAY.**

The upfront cost of updating interfaces is paid back immediately in code clarity and maintainability.
