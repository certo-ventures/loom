# Observability: Final Design (Ruthlessly Simplified)

## Part 1: What the Conversation Actually Said

### Key Insights from observabilityreview.md

**The Conclusion (Most Important)**:
> "For 10-20 steps per saga, the 'fetch all events and build graph in memory' approach is simpler, faster, cheaper, easier to maintain"

**Storage Decision**:
> "Single SQL Account (What I Recommend for You) - Just use SQL and build graphs in memory"

**Performance Reality**:
> "Fetching all events: ~10ms. Building graph in memory: <1ms. Total: ~11ms. That's excellent."

**Philosophy**:
> "The graph database approach is solving a problem you don't have"

**What Works**:
- CosmosDB SQL API (one container, partition by trace_id)
- Redis Streams (real-time, optional)
- In-memory graph building (trivial for 10-20 events)
- Simple event schema (trace_id, span_id, parent_span_id, timestamp, data)

**What Doesn't**:
- Causality chain array (optimization you don't need)
- Graph database (complexity you don't need)
- Pre-computed summaries (YAGNI)
- Complex indexing strategies (default is fine)

---

## Part 2: What I Proposed vs What Was Needed

### I Over-Engineered

❌ **TRACE_PROPAGATION.md**: 340 lines explaining AsyncLocalStorage, context propagation
- **Reality**: BullMQ job.data already carries context. Just add `trace: { trace_id, parent_span_id }`

❌ **DESIGN_THINKING.md**: 570 lines of "phases" and "open questions"
- **Reality**: Build it in 300 lines total, not 570 lines of planning

❌ **Multiple storage layers**: Redis + Cosmos + "optional" projections
- **Reality**: Cosmos is enough. Redis is nice-to-have, not architectural

❌ **TraceContext class with AsyncLocalStorage**
- **Reality**: Pass context explicitly through function parameters (simpler)

### I Got Right

✅ Single event type with flexible `data` field
✅ Fetch all events for trace, build graph in memory
✅ CosmosDB SQL API only
✅ BullMQ as the message layer

---

## Part 3: The Absolute Minimal Design

### Core Principle
> **Events are just data. Storage is simple. Queries are code.**

### Event Schema (Final)

```typescript
interface TraceEvent {
  // Identity (required)
  trace_id: string       // Workflow/saga ID (partition key)
  span_id: string        // Unique event ID
  parent_span_id?: string // Link to parent event
  
  // What happened (required)
  event_type: string     // "workflow:started", "stage:failed", "saga:compensating"
  timestamp: string      // ISO 8601
  
  // Status (optional)
  status?: 'success' | 'failed' | 'pending'
  
  // Everything else (optional, unstructured)
  data?: Record<string, any>
  tags?: string[]
}
```

**That's it. 7 fields. No more.**

### Storage: CosmosDB SQL

**One container**:
```typescript
{
  id: span_id,                    // Document ID
  partitionKey: trace_id,         // Co-locate all events for a trace
  indexingPolicy: { automatic: true }, // Default indexing (sufficient)
  defaultTtl: 7776000             // 90 days
}
```

**No composite indexes. No secondary containers. No summaries.**

Why? Because:
- Fetching a partition is already optimized
- 10-20 events = trivial to process in memory
- Default indexing handles common queries (timestamp, status, event_type)

### Instrumentation: Add to Existing Code

**1. BullMQ Worker (ONLY place to instrument)**

```typescript
// In your existing worker setup
worker.on('active', async (job) => {
  // Create or extract trace context
  const trace_id = job.data.trace?.trace_id || job.id
  const parent_span_id = job.data.trace?.parent_span_id
  const span_id = generateId()
  
  // Store span_id for later events
  job.data.span_id = span_id
  
  // Emit event
  await emitEvent({
    trace_id,
    span_id,
    parent_span_id,
    event_type: 'job:started',
    timestamp: new Date().toISOString(),
    data: { job_id: job.id, job_name: job.name }
  })
})

worker.on('completed', async (job, result) => {
  await emitEvent({
    trace_id: job.data.trace?.trace_id || job.id,
    span_id: job.data.span_id,
    event_type: 'job:completed',
    timestamp: new Date().toISOString(),
    status: 'success'
  })
})

worker.on('failed', async (job, error) => {
  await emitEvent({
    trace_id: job.data.trace?.trace_id || job.id,
    span_id: job.data.span_id,
    event_type: 'job:failed',
    timestamp: new Date().toISOString(),
    status: 'failed',
    data: { error: error.message }
  })
})
```

**2. When Actor Calls Another Actor**

```typescript
// In ActorProxy or wherever you queue jobs
class ActorProxy {
  async call(method: string, params: any, currentTrace?: TraceContext) {
    await queue.add('actor-job', {
      actorId: this.actorId,
      method,
      params,
      // Propagate trace context
      trace: currentTrace ? {
        trace_id: currentTrace.trace_id,
        parent_span_id: currentTrace.span_id
      } : undefined
    })
  }
}
```

**3. Manual Events (in application code)**

```typescript
// When AI makes decision
await emitEvent({
  trace_id: currentTrace.trace_id,
  span_id: generateId(),
  parent_span_id: currentTrace.span_id,
  event_type: 'ai:decision',
  timestamp: new Date().toISOString(),
  status: 'success',
  data: {
    decision: 'approved',
    reasoning: 'Credit score above threshold',
    confidence: 0.95
  },
  tags: ['ai-decision']
})
```

**That's it. Three instrumentation points.**

---

## Part 4: The Complete Implementation (300 lines total)

### File 1: `trace.ts` (~150 lines)

```typescript
import { Container } from '@azure/cosmos'
import { randomUUID } from 'crypto'

// Event type
export interface TraceEvent {
  trace_id: string
  span_id: string
  parent_span_id?: string
  event_type: string
  timestamp: string
  status?: 'success' | 'failed' | 'pending'
  data?: Record<string, any>
  tags?: string[]
}

// Trace context (passed through functions)
export interface TraceContext {
  trace_id: string
  span_id: string
}

// Writer
export class TraceWriter {
  constructor(private container: Container) {}
  
  async emit(event: TraceEvent): Promise<void> {
    await this.container.items.create({
      id: event.span_id,
      ...event
    })
  }
  
  generateId(): string {
    return randomUUID()
  }
  
  createContext(trace_id?: string): TraceContext {
    return {
      trace_id: trace_id || this.generateId(),
      span_id: this.generateId()
    }
  }
}

// Reader
export class TraceReader {
  constructor(private container: Container) {}
  
  async getTrace(trace_id: string): Promise<TraceEvent[]> {
    const { resources } = await this.container.items
      .query<TraceEvent>({
        query: 'SELECT * FROM c WHERE c.trace_id = @trace_id ORDER BY c.timestamp',
        parameters: [{ name: '@trace_id', value: trace_id }]
      })
      .fetchAll()
    
    return resources
  }
}

// Query builder (in-memory operations)
export class TraceQuery {
  private eventMap: Map<string, TraceEvent>
  private childrenMap: Map<string, TraceEvent[]>
  
  constructor(private events: TraceEvent[]) {
    this.eventMap = new Map(events.map(e => [e.span_id, e]))
    this.childrenMap = new Map()
    
    // Build children map
    for (const event of events) {
      if (event.parent_span_id) {
        const siblings = this.childrenMap.get(event.parent_span_id) || []
        siblings.push(event)
        this.childrenMap.set(event.parent_span_id, siblings)
      }
    }
  }
  
  // Get root event
  getRoot(): TraceEvent | undefined {
    return this.events.find(e => !e.parent_span_id)
  }
  
  // Get path from root to event
  getPath(span_id: string): TraceEvent[] {
    const path: TraceEvent[] = []
    let current = this.eventMap.get(span_id)
    
    while (current) {
      path.unshift(current)
      current = current.parent_span_id 
        ? this.eventMap.get(current.parent_span_id)
        : undefined
    }
    
    return path
  }
  
  // Get children
  getChildren(span_id: string): TraceEvent[] {
    return this.childrenMap.get(span_id) || []
  }
  
  // Find events by type
  findByType(event_type: string): TraceEvent[] {
    return this.events.filter(e => e.event_type === event_type)
  }
  
  // Find events by status
  findByStatus(status: 'success' | 'failed' | 'pending'): TraceEvent[] {
    return this.events.filter(e => e.status === status)
  }
  
  // Get first failure
  getFailure(): TraceEvent | undefined {
    return this.events.find(e => e.status === 'failed')
  }
  
  // Get compensations (events that reference original_span_id)
  getCompensations(): Array<{ compensation: TraceEvent, original?: TraceEvent }> {
    return this.events
      .filter(e => e.event_type.includes('compensat'))
      .map(comp => ({
        compensation: comp,
        original: comp.data?.original_span_id 
          ? this.eventMap.get(comp.data.original_span_id)
          : undefined
      }))
  }
  
  // Build tree structure
  buildTree(root?: TraceEvent): TraceNode {
    const rootEvent = root || this.getRoot()
    if (!rootEvent) throw new Error('No root event found')
    
    const buildNode = (event: TraceEvent): TraceNode => ({
      event,
      children: this.getChildren(event.span_id).map(buildNode)
    })
    
    return buildNode(rootEvent)
  }
}

export interface TraceNode {
  event: TraceEvent
  children: TraceNode[]
}

// Helper to create trace context from job data
export function getTraceFromJob(jobData: any): TraceContext | undefined {
  if (!jobData.trace) return undefined
  
  return {
    trace_id: jobData.trace.trace_id,
    span_id: jobData.trace.parent_span_id // This becomes parent for new spans
  }
}

// Helper to add trace to job data
export function addTraceToJob(jobData: any, trace: TraceContext): any {
  return {
    ...jobData,
    trace: {
      trace_id: trace.trace_id,
      parent_span_id: trace.span_id // Current span becomes parent
    }
  }
}
```

### File 2: `bullmq-tracer.ts` (~80 lines)

```typescript
import { Worker, Job } from 'bullmq'
import { TraceWriter } from './trace'

/**
 * Instrument BullMQ worker to emit trace events
 */
export function instrumentWorker(worker: Worker, tracer: TraceWriter): void {
  worker.on('active', async (job: Job) => {
    const trace_id = job.data.trace?.trace_id || job.id
    const parent_span_id = job.data.trace?.parent_span_id
    const span_id = tracer.generateId()
    
    // Store span_id in job for later events
    job.data.span_id = span_id
    
    await tracer.emit({
      trace_id,
      span_id,
      parent_span_id,
      event_type: 'job:started',
      timestamp: new Date().toISOString(),
      data: {
        job_id: job.id,
        job_name: job.name,
        queue: job.queueName
      }
    })
  })
  
  worker.on('completed', async (job: Job, result: any) => {
    if (!job.data.span_id) return
    
    await tracer.emit({
      trace_id: job.data.trace?.trace_id || job.id,
      span_id: job.data.span_id,
      event_type: 'job:completed',
      timestamp: new Date().toISOString(),
      status: 'success'
    })
  })
  
  worker.on('failed', async (job: Job, error: Error) => {
    if (!job.data.span_id) return
    
    await tracer.emit({
      trace_id: job.data.trace?.trace_id || job.id,
      span_id: job.data.span_id,
      event_type: 'job:failed',
      timestamp: new Date().toISOString(),
      status: 'failed',
      data: {
        error: error.message,
        stack: error.stack
      }
    })
  })
}
```

### File 3: `helpers.ts` (~70 lines)

```typescript
import { TraceWriter, TraceContext } from './trace'

/**
 * Wrap a function with automatic tracing
 */
export async function traced<T>(
  event_type: string,
  trace: TraceContext,
  tracer: TraceWriter,
  fn: (childTrace: TraceContext) => Promise<T>,
  options?: { data?: any; tags?: string[] }
): Promise<T> {
  const child_span_id = tracer.generateId()
  
  // Create child context
  const childTrace: TraceContext = {
    trace_id: trace.trace_id,
    span_id: child_span_id
  }
  
  // Emit start
  await tracer.emit({
    trace_id: trace.trace_id,
    span_id: child_span_id,
    parent_span_id: trace.span_id,
    event_type: `${event_type}:started`,
    timestamp: new Date().toISOString(),
    data: options?.data,
    tags: options?.tags
  })
  
  try {
    const result = await fn(childTrace)
    
    // Emit success
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: child_span_id,
      event_type: `${event_type}:completed`,
      timestamp: new Date().toISOString(),
      status: 'success'
    })
    
    return result
  } catch (error) {
    // Emit failure
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: child_span_id,
      event_type: `${event_type}:failed`,
      timestamp: new Date().toISOString(),
      status: 'failed',
      data: {
        error: error instanceof Error ? error.message : String(error)
      }
    })
    
    throw error
  }
}
```

---

## Part 5: How It Actually Works

### Scenario: Loan Approval with Compensation

```typescript
// 1. Start workflow
const trace = tracer.createContext() // New trace

await tracer.emit({
  trace_id: trace.trace_id,
  span_id: trace.span_id,
  event_type: 'workflow:started',
  timestamp: new Date().toISOString(),
  data: { workflow_id: 'loan-approval', loan_id: 'L123' }
})

// 2. Execute stage 1 (validation)
await traced('stage:validate', trace, tracer, async (stageTrace) => {
  // Queue job with trace context
  await queue.add('validate-job', {
    loan_id: 'L123',
    trace: {
      trace_id: stageTrace.trace_id,
      parent_span_id: stageTrace.span_id
    }
  })
  
  // Wait for result...
})

// 3. Execute stage 2 (credit check)
await traced('stage:credit', trace, tracer, async (stageTrace) => {
  await queue.add('credit-job', {
    loan_id: 'L123',
    trace: {
      trace_id: stageTrace.trace_id,
      parent_span_id: stageTrace.span_id
    }
  })
})

// 4. Stage 3 fails (funding)
await traced('stage:funding', trace, tracer, async (stageTrace) => {
  await queue.add('funding-job', {
    loan_id: 'L123',
    trace: {
      trace_id: stageTrace.trace_id,
      parent_span_id: stageTrace.span_id
    }
  })
  
  // Fails - traced() automatically emits failure event
})

// 5. Start compensation
await traced('saga:compensation', trace, tracer, async (compTrace) => {
  // Compensate stage 2
  await tracer.emit({
    trace_id: compTrace.trace_id,
    span_id: tracer.generateId(),
    parent_span_id: compTrace.span_id,
    event_type: 'saga:compensating',
    timestamp: new Date().toISOString(),
    data: {
      original_span_id: '<stage-2-span-id>',
      reason: 'Funding failed'
    },
    tags: ['compensation']
  })
  
  // Execute compensation logic...
})

// 6. Query results
const events = await reader.getTrace(trace.trace_id)
const query = new TraceQuery(events)

const failure = query.getFailure()
// → Event with status='failed', event_type='stage:funding:failed'

const path = query.getPath(failure.span_id)
// → [workflow, stage:funding]

const compensations = query.getCompensations()
// → [{ compensation: Event, original: Event }]
```

### What Events Look Like

```json
[
  {
    "trace_id": "T1",
    "span_id": "S1",
    "event_type": "workflow:started",
    "timestamp": "2025-12-22T10:00:00Z",
    "data": { "workflow_id": "loan-approval" }
  },
  {
    "trace_id": "T1",
    "span_id": "S2",
    "parent_span_id": "S1",
    "event_type": "stage:validate:started",
    "timestamp": "2025-12-22T10:00:01Z"
  },
  {
    "trace_id": "T1",
    "span_id": "S3",
    "parent_span_id": "S2",
    "event_type": "job:started",
    "timestamp": "2025-12-22T10:00:01.100Z",
    "data": { "job_name": "validate-job" }
  },
  {
    "trace_id": "T1",
    "span_id": "S3",
    "event_type": "job:completed",
    "timestamp": "2025-12-22T10:00:02Z",
    "status": "success"
  },
  {
    "trace_id": "T1",
    "span_id": "S2",
    "event_type": "stage:validate:completed",
    "timestamp": "2025-12-22T10:00:02.100Z",
    "status": "success"
  },
  {
    "trace_id": "T1",
    "span_id": "S6",
    "parent_span_id": "S1",
    "event_type": "stage:funding:failed",
    "timestamp": "2025-12-22T10:00:05Z",
    "status": "failed",
    "data": { "error": "Insufficient funds" }
  },
  {
    "trace_id": "T1",
    "span_id": "S7",
    "parent_span_id": "S1",
    "event_type": "saga:compensating",
    "timestamp": "2025-12-22T10:00:05.100Z",
    "data": { "original_span_id": "S2" },
    "tags": ["compensation"]
  }
]
```

---

## Part 6: What Makes This Minimal

### No AsyncLocalStorage
- Pass `trace` explicitly through function parameters
- Simpler, more explicit, easier to test

### No Redis Streams
- Can add later if needed for real-time monitoring
- CosmosDB is sufficient for debugging

### No Context Manager Class
- Just a simple interface: `{ trace_id, span_id }`
- Helper functions, not classes

### No Pre-computation
- Don't store summaries
- Don't maintain causality chains
- Query events, compute on-demand

### No Complex Indexing
- Partition by trace_id (automatic optimization)
- Default indexing (automatic on all fields)
- No composite indexes needed

### No Framework Magic
- Instrument BullMQ worker (3 event handlers)
- Pass trace in job data
- Emit events manually when needed

---

## Part 7: The Complete File Structure

```
src/observability/
├── trace.ts              (~150 lines)  Core types, writer, reader, query
├── bullmq-tracer.ts      (~80 lines)   BullMQ instrumentation
├── helpers.ts            (~70 lines)   Convenience functions
└── index.ts              (~10 lines)   Re-exports

Total: ~310 lines
```

Compare to current:
- execution-trace.ts: 665 lines
- pipeline-tracer.ts: 579 lines
- **Total: 1,244 lines**

**Reduction: 75% less code**

---

## Part 8: What We DON'T Build

### ❌ Automatic Instrumentation
- Don't wrap every actor method
- Don't intercept every call
- Emit events where it matters

### ❌ Real-Time Dashboard
- Different concern
- Use existing tools (Grafana, etc.)
- Export data if needed

### ❌ Analytics Engine
- Compute on-demand
- Add later if actually needed
- Don't pre-compute

### ❌ Complex Query DSL
- Just provide query methods
- Users can write their own
- TypeScript is the query language

### ❌ OpenTelemetry Integration
- Can add later
- Schema is compatible
- Don't couple now

---

## Part 9: Migration Path

### Phase 1: Add New System (No Breaking Changes)
1. Create `trace.ts`, `bullmq-tracer.ts`, `helpers.ts`
2. Instrument one BullMQ worker as proof of concept
3. Run one workflow, verify events written

### Phase 2: Gradually Instrument
1. Add `instrumentWorker()` to existing workers
2. Update actor proxy to propagate trace
3. Add manual events for key decisions

### Phase 3: Remove Old Code (Once Proven)
1. Delete `execution-trace.ts` (665 lines)
2. Delete `pipeline-tracer.ts` (579 lines)
3. Delete `types.ts` (129 lines)
4. Keep `collector.ts` (metrics - different concern)

**Result**: 1,244 lines → 310 lines (75% reduction)

---

## Part 10: Success Criteria

### Must Work
- ✅ Emit events from workflows
- ✅ Trace context propagates through BullMQ
- ✅ Query single trace in <100ms
- ✅ Answer "why did trace X fail?"
- ✅ Answer "what got compensated?"

### Must Be Simple
- ✅ <500 lines of code
- ✅ No complex frameworks
- ✅ No magic/hidden behavior
- ✅ Easy to test (pass in-memory storage)

### Must Be Cheap
- ✅ <$10/month for 1000 traces/day
- ✅ Single CosmosDB container
- ✅ Minimal write overhead (<10ms per event)

---

## Conclusion

**From the conversation**: "For 10-20 steps per saga, fetch all and build graph in memory. Simpler, faster, cheaper."

**My design**: Exactly that. No more, no less.

**Key insight**: The conversation already had the right answer. I just needed to implement it, not redesign it.

**Philosophy**: 
- Events are data
- Storage is simple (one table)
- Queries are code (in-memory operations)
- Instrumentation is explicit (BullMQ hooks + manual events)

**Result**: 310 lines instead of 1,244 lines. Same functionality. Easier to understand, test, and maintain.
