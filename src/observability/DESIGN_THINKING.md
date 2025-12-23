# Observability System Design: Problem Analysis & Implementation Plan

## Part 1: What Problems Are We Actually Solving?

### Problem 1: "Why did my workflow fail?"

**Scenario**: A loan approval saga fails at step 5 of 12. Engineer needs to understand:
- What was the execution path? (steps 1→2→3→4→5)
- What was the input to the failed step?
- What was the error?
- What led to this step being executed? (context from prior steps)

**Current pain without observability**:
- Scattered logs across different actors
- No correlation between log entries
- Manual mental reconstruction of execution flow
- Can't see "why this branch was taken" (especially with AI decisions)

**Solution requirements**:
- Single query to get all events for a trace
- Events must link together (parent-child relationships)
- Must capture inputs, outputs, errors
- Must be queryable: "give me the failure and everything that led to it"

### Problem 2: "Did the compensation work?"

**Scenario**: Step 5 fails. Saga starts compensating steps 4→3→2→1. Did it work?

**Current pain**:
- No visibility into compensation execution
- Can't tell if compensation succeeded or got stuck
- Can't see if there are "orphaned" resources (step 3 compensation failed but step 2 succeeded)

**Solution requirements**:
- Clear link between original action and its compensation
- Status of each compensation
- Timeline: when did compensation start? how long did it take?
- Ability to query: "show me all compensations for trace X"

### Problem 3: "Why did the AI agent choose path B instead of path A?"

**Scenario**: AI agent has 3 possible next steps. It chooses step B. Six steps later, workflow fails. Was the AI's decision wrong?

**Current pain**:
- AI decisions are opaque
- Can't review alternatives that were considered
- Can't trace failure back to AI decision point
- Can't learn from patterns (does the AI always fail when it chooses B?)

**Solution requirements**:
- Capture AI decision points as events
- Store: what was considered, what was chosen, why (reasoning)
- Link decision to downstream consequences
- Queryable: "show me all AI decisions in this trace"

### Problem 4: "Which workflows are running right now?"

**Scenario**: Operations team deploys a new version. Want to see active workflows to decide if safe to proceed.

**Current pain**:
- No real-time view of active traces
- Can't see "workflow started 2 minutes ago, currently at step 4 of 10"
- Can't monitor for stuck workflows

**Solution requirements**:
- Real-time feed of events
- Ability to subscribe to a specific trace
- Ability to list "all active traces right now"
- Low latency (sub-second)

### Problem 5: "Show me all failures from the last 24 hours"

**Scenario**: Weekly review - which workflows failed? Are there patterns?

**Current pain**:
- No cross-trace queries
- Can't aggregate across workflows
- Can't identify patterns (e.g., "step 5 fails 80% of the time")

**Solution requirements**:
- Query across multiple traces
- Filter by: time range, status, workflow type
- Aggregate: count failures, avg duration, common failure points

---

## Part 2: Non-Problems (What We're NOT Solving)

### ❌ Real-time distributed tracing across microservices
**Why not**: This is a single-runtime system (actors in one process). Not microservices.

### ❌ Sub-millisecond latency tracing
**Why not**: Workflow steps are seconds/minutes. Adding 10ms to write events is negligible.

### ❌ Millions of traces per day
**Why not**: Scale is modest. Thousands of traces per day, not millions.

### ❌ Complex graph queries (shortest path, centrality, etc.)
**Why not**: Workflows are 10-20 steps. Simple traversal is sufficient.

### ❌ Time-series metrics (counters, gauges, histograms)
**Why not**: Different problem. We have basic metrics already. This is about execution tracing.

### ❌ Log aggregation
**Why not**: Pino logger already handles this. Observability is about structured events, not logs.

---

## Part 3: Core Design Decisions

### Decision 1: Event Schema

**Question**: What fields must be in every event?

**Analysis**:
- Identity: `trace_id` (group events), `span_id` (unique event), `parent_span_id` (link events)
- What: `event_type` (describe what happened)
- When: `timestamp` (order events)
- Status: `status` (success/failure/pending)
- Context: flexible `data` payload

**Rejected alternatives**:
- ❌ Separate interfaces per event type (ExecutionSpan, CompensationSpan, etc.) - too rigid
- ❌ Fixed fields for every possible use case - can't predict future needs
- ❌ Fully unstructured (no required fields) - can't query effectively

**Decision**:
```typescript
interface TraceEvent {
  // Required (OpenTelemetry-compatible)
  trace_id: string           // Partition key
  span_id: string            // Unique ID
  parent_span_id?: string    // Link to parent (null = root)
  event_type: string         // e.g., "stage:started", "saga:compensating"
  timestamp: string          // ISO 8601
  
  // Optional
  status?: 'success' | 'failed' | 'pending'
  data?: Record<string, any> // Flexible payload
  tags?: string[]            // e.g., ["ai-decision", "expensive"]
}
```

**Rationale**: 
- Required fields enable core queries (fetch by trace_id, order by timestamp, filter by status)
- `data` payload provides flexibility without schema changes
- Compatible with OpenTelemetry (can integrate with standard tools later)
- Simple enough to test (just an object with 7 fields)

### Decision 2: Storage Strategy

**Question**: When/where to store events?

**Analysis**:
Two storage systems available:
- **Redis Streams**: Fast, in-memory, pub/sub capable, TTL support
- **CosmosDB**: Persistent, queryable, partitioned, indexed

**Use cases**:
- Real-time monitoring → Redis (low latency, streaming)
- Historical queries → CosmosDB (persistent, indexed)
- Cross-trace analytics → CosmosDB (query engine)

**Decision**: Dual-write with different purposes

```
Event emitted
    ↓
    ├→ Redis Stream (real-time)
    │   - Key: trace:{trace_id}
    │   - TTL: 1 hour
    │   - Purpose: Live monitoring
    │
    └→ CosmosDB (persistent)
        - Container: trace-events
        - Partition: /trace_id
        - Purpose: Historical queries
```

**Write strategy**:
```typescript
async emit(event: TraceEvent) {
  // 1. Redis: fire-and-forget (don't block on this)
  this.redis.xadd(`trace:${event.trace_id}`, '*', 
    'span_id', event.span_id,
    'event_type', event.event_type,
    'status', event.status || 'pending',
    'timestamp', event.timestamp
  ).catch(err => logger.warn('Redis write failed', err))
  
  // 2. CosmosDB: await (critical)
  await this.cosmos.items.create(event)
}
```

**Failure modes**:
- Redis down: Lose real-time monitoring, but historical queries still work
- CosmosDB down: **Block** (can't lose audit trail)
- Both down: Workflow fails (acceptable - need observability)

**Rationale**:
- Redis is optional (nice-to-have for real-time)
- CosmosDB is critical (must-have for debugging)
- Don't batch to Cosmos - write immediately (simpler, and 10-20 events per trace is low volume)

### Decision 3: Query Interface

**Question**: What queries must be supported?

**Analysis of use cases**:

**Primary**: Single-trace queries (90% of usage)
- "Get all events for trace X"
- "Show me the failure in trace X"
- "Show me compensations in trace X"
- "Show me the execution path in trace X"

**Secondary**: Cross-trace queries (10% of usage)
- "Show me all failures in last 24 hours"
- "Show me all traces for pipeline Y"
- "Show me slow traces (>1 minute)"

**Decision**: Two-tier query interface

**Tier 1: TraceQuery (in-memory operations)**
```typescript
class TraceQuery {
  constructor(events: TraceEvent[])
  
  // Tree operations
  getRoot(): TraceEvent | null
  getChildren(span_id: string): TraceEvent[]
  getPath(span_id: string): TraceEvent[]  // From root to span
  getTree(): TreeNode  // Hierarchical structure
  
  // Status queries
  getFailure(): TraceEvent | null
  getSuccesses(): TraceEvent[]
  getPending(): TraceEvent[]
  
  // Pattern queries
  findByType(event_type: string): TraceEvent[]
  findByTag(tag: string): TraceEvent[]
  getCompensations(): TraceEvent[]
  getAIDecisions(): TraceEvent[]
  
  // Timeline
  getDuration(): number  // millis from first to last event
  getTimeline(): TraceEvent[]  // Sorted by timestamp
}
```

**Tier 2: TraceReader (Cosmos queries)**
```typescript
class TraceReader {
  // Primary query
  async getTrace(trace_id: string): Promise<TraceEvent[]>
  
  // Cross-trace queries (simple filters only)
  async findRecent(hours: number, filters?: {
    status?: string
    event_type?: string
    tags?: string[]
  }): Promise<TraceEvent[]>
}
```

**Rationale**:
- Single-trace queries are fast (fetch partition, operate in memory)
- Don't try to do graph traversal in SQL - do it in code
- Cross-trace queries are simple filters (leverage CosmosDB indexes)
- Complex analytics can be added later if needed (not in v1)

### Decision 4: Event Emission (Integration)

**Question**: How do actors/sagas emit events?

**Options**:
1. **Automatic instrumentation**: Framework auto-emits events
2. **Manual emission**: Developer calls `emitEvent()` explicitly
3. **Hybrid**: Auto-emit lifecycle events, manual for domain events

**Analysis**:

Automatic pros/cons:
- ✅ No developer effort
- ✅ Consistent (never forget to emit)
- ❌ Opaque (hard to understand what's being emitted)
- ❌ Too much data (every internal step)
- ❌ Framework coupling (hard to change)

Manual pros/cons:
- ✅ Explicit (clear what's being tracked)
- ✅ Minimal data (only what matters)
- ✅ Flexible (emit domain events, not just lifecycle)
- ❌ Developer effort
- ❌ Can forget to emit

**Decision**: Hybrid with helpers

**Automatic (framework level)**:
- Workflow start/end
- Stage start/end
- Compensation trigger

**Manual (application level)**:
- AI decision points
- Business events ("approved", "validated", "calculated")
- Domain-specific context

**Implementation**:
```typescript
// Framework emits automatically
class WorkflowExecutor {
  async execute(workflow: Workflow) {
    const trace_id = workflow.id
    const span_id = generateSpanId()
    
    await tracer.emit({
      trace_id,
      span_id,
      event_type: 'workflow:started',
      timestamp: now(),
      data: { workflow_id: workflow.id, input: workflow.input }
    })
    
    // Execute...
    
    await tracer.emit({
      trace_id,
      span_id,
      event_type: 'workflow:completed',
      timestamp: now(),
      status: 'success',
      data: { output: result }
    })
  }
}

// Developer emits explicitly
async function processLoan(loan: Loan, tracer: TraceEmitter) {
  const decision = await aiAgent.evaluate(loan)
  
  // Explicit event emission
  await tracer.emit({
    trace_id: loan.workflow_id,
    span_id: generateSpanId(),
    parent_span_id: currentSpanId(),
    event_type: 'ai:decision',
    timestamp: now(),
    status: 'success',
    data: {
      decision: decision.choice,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      alternatives: decision.alternatives
    },
    tags: ['ai-decision', 'high-value']
  })
  
  return decision
}
```

**Rationale**:
- Framework handles plumbing (start/end events)
- Developer adds domain insight (why was this path taken?)
- Balance: enough automation to not be burdensome, enough control to be useful

### Decision 5: CosmosDB Schema

**Question**: What indexing strategy?

**Analysis**:

**Queries we need to support**:
1. `WHERE trace_id = X` (most common) → Partition key handles this
2. `WHERE trace_id = X ORDER BY timestamp` → Needs index on timestamp
3. `WHERE status = 'failed' AND timestamp > X` → Needs composite index
4. `WHERE event_type = 'workflow:started' AND timestamp > X` → Needs composite index

**Decision**: Minimal indexing

```typescript
{
  partitionKey: { paths: ['/trace_id'] },
  indexingPolicy: {
    automatic: true,
    includedPaths: [
      { path: '/*' }  // Index everything by default
    ],
    excludedPaths: [
      { path: '/data/*' }  // Don't index payload (variable schema)
    ],
    compositeIndexes: [
      [
        { path: '/timestamp', order: 'descending' },
        { path: '/status', order: 'ascending' }
      ],
      [
        { path: '/event_type', order: 'ascending' },
        { path: '/timestamp', order: 'descending' }
      ]
    ]
  },
  defaultTtl: 7776000  // 90 days
}
```

**Rationale**:
- Partition by trace_id (co-locates all events for a trace)
- Index timestamp (for ordering and time-range queries)
- Composite indexes for common cross-trace queries
- Exclude `/data/*` (flexible payload, don't index internals)
- TTL: 90 days (compliance retention, auto-cleanup)

---

## Part 4: Implementation Plan

### Phase 1: Core Infrastructure (Foundation)

**Goal**: Emit and retrieve events

**Components**:
1. **types.ts** (~30 lines)
   - `TraceEvent` interface
   - `TreeNode` interface
   - Helper types

2. **emitter.ts** (~80 lines)
   ```typescript
   class TraceEmitter {
     constructor(redis, cosmos)
     
     async emit(event: TraceEvent): Promise<void>
     // Writes to Redis + Cosmos
     
     generateSpanId(): string
     generateTraceId(): string
   }
   ```

3. **reader.ts** (~60 lines)
   ```typescript
   class TraceReader {
     constructor(cosmos)
     
     async getTrace(trace_id: string): Promise<TraceEvent[]>
     async findRecent(hours, filters): Promise<TraceEvent[]>
   }
   ```

4. **query.ts** (~120 lines)
   ```typescript
   class TraceQuery {
     constructor(events: TraceEvent[])
     
     // All the query methods (getFailure, getPath, etc.)
   }
   ```

**Total**: ~290 lines

**Test**: Can emit event → retrieve event → query it

### Phase 2: Integration Helpers (Convenience)

**Goal**: Make it easy to use from actors/sagas

**Components**:
1. **helpers.ts** (~100 lines)
   ```typescript
   // Context manager for nested spans
   class TraceContext {
     constructor(trace_id: string, parent_span_id?: string)
     
     async trace<T>(
       event_type: string,
       fn: () => Promise<T>,
       options?: { data?, tags? }
     ): Promise<T>
   }
   
   // Usage:
   const ctx = new TraceContext(workflow_id)
   const result = await ctx.trace('stage:process', async () => {
     return await processStage()
   })
   // Automatically emits start/success/failure events
   ```

2. **saga-integration.ts** (~80 lines)
   ```typescript
   // Saga-specific helpers
   async function traceSagaCompensation(
     trace_id: string,
     original_span_id: string,
     compensationFn: () => Promise<void>
   ): Promise<void>
   ```

**Total**: ~180 lines

**Test**: Instrument a real saga → see events → verify timeline

### Phase 3: Real-Time Monitoring (Optional but Valuable)

**Goal**: Watch active traces

**Components**:
1. **stream.ts** (~100 lines)
   ```typescript
   class TraceStream {
     constructor(redis)
     
     // Subscribe to a specific trace
     async *watch(trace_id: string): AsyncGenerator<TraceEvent>
     
     // Subscribe to all traces
     async *watchAll(): AsyncGenerator<TraceEvent>
   }
   
   // Usage:
   for await (const event of stream.watch('trace-123')) {
     console.log('Event:', event.event_type, event.status)
   }
   ```

**Total**: ~100 lines

**Test**: Emit events → watch stream → see real-time updates

### Phase 4: Cross-Trace Analytics (Future)

**Goal**: Answer questions across multiple traces

**Components**:
1. **analytics.ts** (~150 lines)
   ```typescript
   class TraceAnalytics {
     async getFailureRate(workflow_id: string, days: number): Promise<number>
     async getSlowestStages(workflow_id: string): Promise<StageStat[]>
     async getCompensationRate(workflow_id: string): Promise<number>
   }
   ```

**Total**: ~150 lines

**Note**: This is lower priority. Can be added when actually needed.

---

## Part 5: Critical Design Constraints

### Constraint 1: Performance

**Requirement**: Event emission must not significantly slow workflows

**Strategy**:
- Redis write: Fire-and-forget (don't await)
- Cosmos write: Await, but < 10ms (acceptable for workflow steps that take seconds)
- Query: Fetch partition (fast), process in memory (10-20 events = trivial)

**Measurement**:
- Emit event: < 15ms p99
- Query trace: < 50ms p99
- Build query interface: < 1ms (in-memory)

### Constraint 2: Reliability

**Requirement**: Must not lose critical events

**Strategy**:
- CosmosDB write: Await (block workflow if it fails)
- Redis write: Optional (don't block workflow)
- Retry: Up to 3 retries with exponential backoff

**Trade-off**: Accept workflow failure if can't write to Cosmos (rather than continue without observability)

### Constraint 3: Cost

**Requirement**: Observability shouldn't double infrastructure cost

**Strategy**:
- CosmosDB: 1 write per event (~5 RU), 1 partition fetch per trace query (~3 RU)
- For 1000 workflows/day × 15 events avg = 15,000 events
- Write: 15,000 × 5 RU = 75,000 RU/day
- Storage: ~10KB/trace × 1000 = 10MB/day × 90 days = 900MB
- Cost: ~$5-10/month (negligible)

### Constraint 4: Testability

**Requirement**: Must be easy to test

**Strategy**:
- Interfaces over implementations (swap Cosmos for in-memory)
- Pure functions (TraceQuery has no I/O)
- Dependency injection (pass redis/cosmos clients)

**Example**:
```typescript
// Production
const emitter = new TraceEmitter(redisClient, cosmosClient)

// Test
const emitter = new TraceEmitter(
  mockRedis,
  new InMemoryCosmosDB()
)
```

---

## Part 6: What This System Does NOT Do

### 1. Automatic Workflow Discovery
**Won't do**: Automatically discover all workflow types
**Reason**: Framework already knows workflows (pipeline definitions)
**Alternative**: Tag events with workflow_id, query by that

### 2. Predictive Analytics
**Won't do**: "This workflow will probably fail based on history"
**Reason**: Out of scope, different problem (ML/anomaly detection)
**Alternative**: Export data, analyze externally

### 3. Real-Time Alerting
**Won't do**: "Alert on-call if workflow X fails"
**Reason**: Different concern (alerting system)
**Alternative**: Query failed traces, send to alerting system

### 4. Performance Profiling
**Won't do**: Code-level profiling (function call times, memory usage)
**Reason**: Different tool (profiler)
**Alternative**: Application-level timing only (stage durations)

### 5. Multi-Tenant Isolation
**Won't do**: Separate traces by tenant/customer
**Reason**: Not multi-tenant system (yet)
**Alternative**: Add tenant_id to tags if needed later

---

## Part 7: Success Criteria

### Must Have (v1)
- ✅ Emit events from workflows
- ✅ Query single trace by ID
- ✅ Answer "why did trace X fail?"
- ✅ Answer "what compensations ran?"
- ✅ < 20ms latency for event emission
- ✅ < 100ms latency for single-trace query
- ✅ < 500 lines of core code

### Should Have (v1.1)
- ✅ Real-time streaming (watch active traces)
- ✅ Integration helpers (TraceContext)
- ✅ Cross-trace queries (find recent failures)

### Nice to Have (v2)
- ⭕ Analytics (failure rates, p99 latencies)
- ⭕ Dashboard (visualize traces)
- ⭕ Export (to external systems)

### Won't Have (Out of Scope)
- ❌ Code-level profiling
- ❌ Alerting/paging
- ❌ Machine learning
- ❌ Multi-cloud sync
- ❌ Custom query DSL

---

## Part 8: Open Questions

### Q1: How to handle very large traces?

**Scenario**: AI agent creates 100-step workflow (beyond typical 10-20)

**Options**:
1. Fetch all, warn if > 100 events
2. Paginate (fetch in chunks)
3. Summarize (store summary separately)

**Decision**: Start with option 1 (fetch all), optimize later if needed

**Rationale**: Better to have all data and optimize retrieval than to prematurely optimize

### Q2: How to link traces across workflow boundaries?

**Scenario**: Workflow A triggers workflow B (separate traces)

**Options**:
1. Store parent_trace_id
2. Use correlation_id (business ID)
3. Store both

**Decision**: Option 3 (both)

```typescript
interface TraceEvent {
  trace_id: string         // This workflow
  parent_trace_id?: string // Calling workflow (if any)
  correlation_id?: string  // Business entity (e.g., loan_id)
}
```

**Rationale**: Supports both technical debugging (parent_trace_id) and business queries (correlation_id)

### Q3: How to handle sensitive data?

**Scenario**: Event payload contains PII (customer name, SSN, etc.)

**Options**:
1. Don't store in events (only IDs)
2. Encrypt payload
3. Redact specific fields

**Decision**: Option 1 + 3 (don't store, but provide redaction helper)

```typescript
async emit(event: TraceEvent) {
  // Auto-redact known sensitive fields
  if (event.data) {
    event.data = redactSensitive(event.data)
  }
  await this.cosmos.create(event)
}

function redactSensitive(obj: any): any {
  const sensitive = ['ssn', 'password', 'creditCard']
  // ... redact logic
}
```

**Rationale**: Observability is for debugging, not data storage. Store IDs, not values.

### Q4: Integration with existing metrics/logging?

**Scenario**: Already using Pino (logs), basic metrics (counters)

**Decision**: Keep separate, correlate via trace_id

```typescript
// In actor code
logger.info({ trace_id, span_id }, 'Processing stage')
metrics.increment('stage.processed', { workflow_id })
await tracer.emit({ trace_id, span_id, event_type: 'stage:completed' })
```

**Rationale**: 
- Logs: Unstructured developer output
- Metrics: Aggregate counters
- Traces: Structured workflow execution
- Different concerns, different tools, correlated by trace_id

---

## Conclusion

**Core Philosophy**: Events are data. Store them simply. Query them in code.

**What we're building**:
- Event emitter (writes to Redis + Cosmos)
- Event reader (fetches from Cosmos)  
- Query builder (operates on events in memory)
- Integration helpers (make it easy to use)

**What we're NOT building**:
- Complex graph database
- Real-time analytics engine
- ML-powered insights
- Custom query language

**Total complexity**: ~500 lines of core code

**Key insight**: For 10-20 step workflows, array operations on in-memory data are sufficient. Everything else is over-engineering.

**Next step**: Implement Phase 1 (emit + retrieve + query), validate with real saga.
