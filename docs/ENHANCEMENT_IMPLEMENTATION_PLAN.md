# Enhancement Implementation Plan

## Architecture Principles
- **Minimal Code**: Each feature < 100 lines
- **Maximum Functionality**: Solve 80% of use cases simply
- **No Bloat**: Zero dependencies if possible
- **Incremental**: Ship working code every phase

---

## Phase 1: Actor Telemetry (Week 1) ⭐⭐⭐⭐⭐

### Goal
Enable actors to record events, metrics, and spans for observability.

### Design: Minimal API Surface
```typescript
// Extend ActorContext (src/actor/journal.ts)
interface ActorContext {
  // Existing...
  actorId: string
  actorType: string
  
  // NEW: Minimal telemetry API (3 methods only)
  recordEvent(type: string, data?: unknown): void
  recordMetric(name: string, value: number, tags?: Record<string, string>): void
  startSpan(operation: string): () => void  // Returns end function
}
```

### Implementation Steps
1. ✅ Create `src/observability/telemetry-recorder.ts` (~50 lines)
2. ✅ Extend ActorContext interface
3. ✅ Wire to actor execution in `src/actor/base-actor.ts`
4. ✅ Store events in Redis (reuse existing connection)
5. ✅ Test with calculator actor

### Storage Strategy
```typescript
// Redis keys (minimal schema)
telemetry:events:{actorId}     → List of events
telemetry:metrics:{name}       → TimeSeries (optional)
telemetry:spans:{correlationId} → List of spans
```

---

## Phase 2: Conditional Scatter (Week 2) ⭐⭐⭐⭐⭐

### Goal
Skip items in scatter that don't match condition.

### Design: Single Field Addition
```typescript
// Extend ScatterConfig (src/pipelines/pipeline-dsl.ts)
scatter?: {
  input: string
  as: string
  condition?: string  // NEW: JSONPath boolean expression
}
```

### Implementation Steps
1. ✅ Add `condition` to scatter config type
2. ✅ Implement simple filter in ScatterExecutor (~10 lines)
3. ✅ Test with real pipeline (skip processed docs)

### Filter Logic (Minimal)
```typescript
// In ScatterExecutor.execute()
if (stage.scatter.condition) {
  items = items.filter(item => {
    const scopedContext = { ...pipelineContext, [stage.scatter.as]: item }
    const result = jp.query(scopedContext, stage.scatter.condition)
    return result[0] === true
  })
}
```

---

## Phase 3: Strategy Pattern (Week 3) ⭐⭐⭐⭐

### Goal
Allow runtime strategy selection for actors.

### Design: Backward Compatible Extension
```typescript
// Extend StageDefinition (src/pipelines/pipeline-dsl.ts)
interface StageDefinition {
  actor: string | {  // NEW: Object form
    type: string
    strategy?: string | string  // Static or expression
  }
}
```

### Implementation Steps
1. ✅ Extend actor definition type
2. ✅ Add strategy resolution in orchestrator (~20 lines)
3. ✅ Pass strategy to actor via context
4. ✅ Test with storage actor (blob vs cosmos)

### Actor-Side Pattern
```typescript
// Actor implements strategy internally
class StorageActor {
  private strategies = {
    blob: new BlobStrategy(),
    cosmos: new CosmosStrategy()
  }
  
  async execute(input: any, context: ActorContext) {
    const strategy = context.strategy || 'blob'
    return this.strategies[strategy].store(input)
  }
}
```

---

## Phase 4: Multi-Stage Gather (Week 4) ⭐⭐⭐

### Goal
Gather results from multiple upstream stages.

### Design: Simple Extension
```typescript
// Extend GatherConfig (src/pipelines/pipeline-dsl.ts)
gather?: {
  stage: string | string[]  // NEW: Allow array
  groupBy?: string
  combine?: 'concat' | 'object'  // NEW: Merge strategy
}
```

### Implementation Steps
1. ✅ Extend gather config to accept array
2. ✅ Implement multi-stage collection (~30 lines)
3. ✅ Add combine strategies
4. ✅ Test with diamond pipeline

### Combine Strategies
```typescript
// concat: [...stage1, ...stage2]
// object: { stage1: [...], stage2: [...] }
```

---

## Success Metrics

### Phase 1: Actor Telemetry
- [ ] Actors can record events with 1 line of code
- [ ] Events queryable via Redis
- [ ] Studio can display telemetry (future)

### Phase 2: Conditional Scatter
- [ ] Can skip 90% of items with simple condition
- [ ] Zero items processed = zero messages enqueued
- [ ] Saves $$$ on LLM rate limits

### Phase 3: Strategy Pattern
- [ ] Can switch storage backend via config
- [ ] A/B testing works (10% new strategy)
- [ ] Zero code changes to switch strategies

### Phase 4: Multi-Stage Gather
- [ ] Diamond pipeline works
- [ ] Can combine results from 2+ stages
- [ ] Type-safe merge strategies

---

## Implementation Order

**This Week (Dec 28 - Jan 3):**
- Day 1: Phase 1 - Actor Telemetry core
- Day 2: Phase 1 - Wire to actors + test
- Day 3: Phase 2 - Conditional Scatter
- Day 4: Phase 2 - Test + examples

**Next Week (Jan 4-10):**
- Day 1: Phase 3 - Strategy Pattern
- Day 2: Phase 3 - Test + docs
- Day 3: Phase 4 - Multi-Stage Gather design
- Day 4: Phase 4 - Implementation
- Day 5: Phase 4 - Test + examples

---

## Code Budget

| Phase | Files Changed | Lines Added | Complexity |
|-------|--------------|-------------|------------|
| Phase 1 | 3 files | ~80 lines | Low |
| Phase 2 | 2 files | ~15 lines | Very Low |
| Phase 3 | 3 files | ~40 lines | Low |
| Phase 4 | 2 files | ~50 lines | Medium |
| **Total** | **8-10 files** | **~185 lines** | **Low** |

All phases: < 200 lines total for 4 major features. This is the Loom way.
