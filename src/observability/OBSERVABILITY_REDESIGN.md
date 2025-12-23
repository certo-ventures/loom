# Observability Redesign: Back to Minimalism

## The Problem

The current implementation in `/src/observability/` violates our minimalist philosophy:

### What Was Discussed (from observabilityreview.md)
- **Simple event sourcing**: Store events with trace_id, span_id, parent_span_id
- **Single SQL container in CosmosDB**: Partition by trace_id
- **In-memory graph building**: For 10-20 step sagas, fetch all events and build graph in application code
- **Declarative queries**: "Show me why saga X failed" in one query
- **Redis Streams**: Real-time monitoring, then batch to Cosmos
- **Conclusion**: "For your scale, SQL is actually faster... simpler, faster, cheaper, easier to maintain"

### What Was Built (execution-trace.ts + pipeline-tracer.ts)
- ❌ **665 lines** of execution-trace.ts with massive interface bloat
- ❌ **579 lines** of pipeline-tracer.ts with automatic instrumentation
- ❌ Over-engineered types: `ExecutionSpan` with 20+ optional fields
- ❌ Duplicate concepts: health checks, metrics, traces all separate
- ❌ Heavy CosmosDB integration baked in
- ❌ Two separate containers (spans + summaries)
- ❌ Complex query builders, performance analytics, percentile calculations
- ❌ Hardcoded to pipeline orchestrator patterns

### The Disconnect

**Discussed**: "Just enough to debug and monitor in production"  
**Built**: Enterprise observability platform with every bell and whistle

**Discussed**: "Build graph in memory for 10-20 steps (takes milliseconds)"  
**Built**: Pre-computed summaries, composite indexes, dual containers

**Discussed**: "Minimalist approach"  
**Built**: 1,244 lines of over-abstracted complexity

---

## What We Actually Need

### Core Philosophy
> Write events. Query events. Build understanding in code, not in the database.

### The Minimalist Architecture

```
┌─────────────────┐
│  Application    │
│  (Actors/Sagas) │
└────────┬────────┘
         │ emits events
         ▼
┌─────────────────┐      ┌──────────────┐
│  Event Stream   │─────▶│ Redis Stream │ (real-time, TTL)
│  (write-only)   │      └──────────────┘
└────────┬────────┘             │
         │                      │ batch write
         │ batch write          ▼
         ▼                 ┌──────────────┐
┌─────────────────┐        │ Query Layer  │
│ CosmosDB SQL    │◀───────│ (in-memory   │
│ (single table)  │        │  graph ops)  │
└─────────────────┘        └──────────────┘
```

### The Event Schema (ONE TYPE)

```typescript
interface TraceEvent {
  // Identity (OpenTelemetry standard)
  trace_id: string      // Partition key - groups all related events
  span_id: string       // Unique event ID
  parent_span_id?: string  // Links to parent event
  
  // What happened
  event_type: string    // "stage:started", "saga:compensating", etc.
  timestamp: string     // ISO 8601
  
  // Context
  actor?: string        // Which actor (if relevant)
  status?: 'success' | 'failed' | 'pending'
  
  // Payload (unstructured)
  data?: Record<string, any>  // Whatever you need, no schema
  
  // Optional metadata
  tags?: string[]       // ["ai-decision", "high-value", etc.]
}
```

That's it. **7 fields**. Everything else goes in `data`.

### Storage: CosmosDB SQL API

**One container**:
- Container: `trace-events`
- Partition key: `/trace_id`
- Index: default (automatic on all fields)
- TTL: 90 days
- No composite indexes, no summaries, no pre-computation

**Why one table?**
- All events for a trace co-located (fast fetch)
- Simple queries: `WHERE trace_id = X ORDER BY timestamp`
- No joins, no aggregations at write time
- Let CosmosDB do what it's good at: fetch a partition fast

### Real-Time: Redis Streams

**Purpose**: Live monitoring only, not querying

```typescript
// Write to Redis for anyone watching
await redis.xadd(`trace:${trace_id}`, '*', 
  'event_type', event.event_type,
  'span_id', event.span_id,
  'status', event.status
)

// TTL: 1 hour (Redis EXPIRE)
```

**Consumer example**:
```typescript
// Watch a specific trace live
const stream = redis.xread('STREAMS', `trace:${trace_id}`, '0')
```

### Query Layer: In-Memory Graph Builder

**Fetch once, query many times**:

```typescript
class TraceQuery {
  constructor(private events: TraceEvent[]) {}
  
  // Build graph structure once
  private buildGraph() {
    const nodes = new Map(this.events.map(e => [e.span_id, e]))
    const children = new Map<string, TraceEvent[]>()
    
    for (const event of this.events) {
      if (event.parent_span_id) {
        const sibs = children.get(event.parent_span_id) || []
        sibs.push(event)
        children.set(event.parent_span_id, sibs)
      }
    }
    
    return { nodes, children }
  }
  
  // Declarative query methods
  getPath(): TraceEvent[] { /* walk parent chain */ }
  getFailure(): TraceEvent | null { /* find first failure */ }
  getCompensations(): TraceEvent[] { /* filter by event_type */ }
  getTree(): TreeNode { /* build hierarchical view */ }
}
```

**Usage**:
```typescript
// One query to Cosmos
const events = await cosmos.query(
  "SELECT * FROM c WHERE c.trace_id = @trace ORDER BY c.timestamp"
)

// Build query interface
const trace = new TraceQuery(events)

// Ask questions
const failure = trace.getFailure()
const path = trace.getPath()
const compensations = trace.getCompensations()
```

**Performance**: For 10-20 events, total time ~10-15ms

---

## Implementation Plan

### Phase 1: Minimal Core (1-2 hours)

**File**: `src/observability/trace.ts` (~150 lines)

```typescript
// Event writer
export class TraceWriter {
  emit(event: TraceEvent): Promise<void>
  // Writes to Redis + queues for Cosmos batch
}

// Event reader  
export class TraceReader {
  getTrace(trace_id: string): Promise<TraceEvent[]>
  // Fetches from Cosmos
}

// Query builder
export class TraceQuery {
  constructor(events: TraceEvent[])
  getPath(): TraceEvent[]
  getFailure(): TraceEvent | null
  getCompensations(): TraceEvent[]
  findByType(type: string): TraceEvent[]
  // etc.
}
```

**File**: `src/observability/index.ts` (~50 lines)
- Re-export trace.ts
- Keep existing Pino logger (it's good!)
- Keep simple metrics

**Total**: ~200 lines replaces 1,244 lines

### Phase 2: Integration Helpers (1 hour)

**File**: `src/observability/helpers.ts` (~100 lines)

```typescript
// Helper to instrument a saga step
export function traceSagaStep<T>(
  trace_id: string,
  parent_span_id: string,
  stage_id: string,
  fn: () => Promise<T>
): Promise<T> {
  const span_id = generateSpanId()
  
  await writer.emit({
    trace_id,
    span_id,
    parent_span_id,
    event_type: 'stage:started',
    timestamp: new Date().toISOString(),
    data: { stage_id }
  })
  
  try {
    const result = await fn()
    await writer.emit({
      trace_id, span_id,
      event_type: 'stage:completed',
      status: 'success',
      timestamp: new Date().toISOString()
    })
    return result
  } catch (error) {
    await writer.emit({
      trace_id, span_id,
      event_type: 'stage:failed',
      status: 'failed',
      timestamp: new Date().toISOString(),
      data: { error: error.message }
    })
    throw error
  }
}
```

Similar helpers for:
- `traceCompensation()`
- `traceAIDecision()`
- `traceLockAcquisition()`

### Phase 3: Dashboard Queries (optional, 1 hour)

**File**: `src/observability/analytics.ts` (~100 lines)

```typescript
// Cross-trace analytics (run occasionally, not per-query)
export class TraceAnalytics {
  async getRecentFailures(hours: number): Promise<Summary[]>
  async getSlowTraces(threshold_ms: number): Promise<Summary[]>
  async getCompensationRate(pipeline_id: string): Promise<number>
}
```

---

## Migration Strategy

### Step 1: Keep Existing, Add New (Non-Breaking)
1. Create new `trace.ts` with minimal implementation
2. Don't touch existing execution-trace.ts yet
3. Test new system in parallel

### Step 2: Migrate Gradually
1. Update one saga/pipeline to use new tracing
2. Validate queries work
3. Compare complexity

### Step 3: Remove Old (Once Proven)
1. Delete execution-trace.ts (665 lines)
2. Delete pipeline-tracer.ts (579 lines)
3. Keep only: trace.ts (~150), helpers.ts (~100), analytics.ts (~100)

**Result**: 350 lines instead of 1,244 (72% reduction)

---

## Key Principles

### 1. Events Over State
Don't pre-compute summaries. Store events, compute on read.

**Bad** (current):
```typescript
interface ExecutionSummary {
  totalSpans: number
  stagesExecuted: number
  stagesFailed: number
  hadCompensations: boolean
  compensationsExecuted: number
  // ... 15 more computed fields
}
```

**Good** (proposed):
```typescript
// Just query the events
const failures = events.filter(e => e.status === 'failed')
const compensations = events.filter(e => e.event_type.includes('compensation'))
```

### 2. Flexible Schema
Use `data: Record<string, any>` instead of 20 optional fields.

**Bad** (current):
```typescript
interface ExecutionSpan {
  aiContext?: { model, tokens, reasoning, confidence, alternatives }
  compensationInfo?: { type, originalSpanId, reason, steps }
  approvalInfo?: { approvalId, assignedTo, decidedBy, decision }
  parallelInfo?: { totalTasks, completedTasks, failedTasks }
  // ...
}
```

**Good** (proposed):
```typescript
// AI decision event
{ event_type: 'ai:decision', data: { model, reasoning, confidence } }

// Compensation event
{ event_type: 'saga:compensating', data: { original_span_id, reason } }

// Whatever you need, no schema changes
```

### 3. Query in Code, Not Database
Let application code understand domain logic.

**Bad** (current):
```sql
SELECT * FROM c 
WHERE c.spanType = 'compensation'
  AND c.status = 'success'
  AND c.compensationInfo.compensationType = 'backward'
```

**Good** (proposed):
```typescript
events
  .filter(e => e.event_type === 'saga:compensating')
  .filter(e => e.status === 'success')
  .filter(e => e.data.type === 'backward')
```

### 4. Simple > Complete
Build what you need now, extend later.

**Bad**: Anticipate every possible query, index everything, pre-compute summaries  
**Good**: Store events, query when needed, optimize if it's slow (it won't be)

---

## Comparison Table

| Aspect | Current Implementation | Proposed Implementation |
|--------|----------------------|------------------------|
| **Lines of Code** | 1,244 | ~350 |
| **Core Types** | 15+ interfaces | 1 interface |
| **Cosmos Containers** | 2 (spans + summaries) | 1 (events) |
| **Query Complexity** | SQL with composite indexes | Simple `WHERE trace_id = X` |
| **Real-time** | Not implemented | Redis Streams (simple) |
| **Extensibility** | Add fields to interfaces | Put anything in `data` |
| **Testing** | Mock CosmosDB, recorder, tracer | Array of events |
| **Dependencies** | @azure/cosmos deeply integrated | Swappable (interface) |
| **Learning Curve** | High (understand all patterns) | Low (events + queries) |

---

## Example: "Why did this saga fail?"

### Current (Complex)
```typescript
const recorder = new ExecutionTraceRecorder(cosmos, 'db', 'spans', 'summaries')
await recorder.initialize()
const spans = await recorder.getTraceSpans(trace_id)
const tree = await recorder.getExecutionTree(trace_id)
const failure = spans.find(s => s.status === 'failed')
const path = await recorder.getExecutionPath(trace_id)
// Navigate through nested ExecutionSpan interfaces...
```

### Proposed (Simple)
```typescript
const events = await reader.getTrace(trace_id)
const trace = new TraceQuery(events)
const failure = trace.getFailure()
const path = trace.getPath()
// Done. 3 lines.
```

---

## The Real Win: Flexibility

When you need to add a new pattern (e.g., "workflow loops"), you don't need to:
- ❌ Add fields to ExecutionSpan
- ❌ Add fields to ExecutionSummary
- ❌ Update composite indexes
- ❌ Migrate existing data
- ❌ Update query methods

You just:
- ✅ Emit events with `event_type: 'loop:iteration'`
- ✅ Query: `events.filter(e => e.event_type.startsWith('loop:'))`

---

## Conclusion

**The conversation** you had was about building **simple, declarative observability** for 10-20 step workflows.

**The code** that was written is an **enterprise-grade distributed tracing platform** suitable for 1000-step workflows across hundreds of services.

**The fix**: Strip away 70% of the code. Return to first principles:
1. Events are data
2. Queries are code  
3. Storage is simple
4. Build understanding in application logic, not database schemas

**Bottom line**: For 10-20 step sagas, an array of events and a for-loop is all you need. The rest is YAGNI (You Aren't Gonna Need It).

---

## Next Steps

1. **Review this document** - Do you agree with the philosophy?
2. **Prototype** - Build `trace.ts` with minimal implementation
3. **Validate** - Test with one real saga/workflow
4. **Decide** - Keep or refactor existing code

**My recommendation**: Start fresh with minimal implementation. Prove it works. Delete the bloat.
