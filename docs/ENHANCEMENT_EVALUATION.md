# Production Enhancement Suggestions - Evaluation

**Date**: December 28, 2025  
**Source**: Partner AI using Loom in production  
**Evaluator**: Technical review of Loom architecture

## Summary

| Enhancement | Priority | Complexity | Recommendation | Timeline |
|------------|----------|------------|----------------|----------|
| **Conditional Scatter** | ⭐⭐⭐⭐⭐ | Low | **IMPLEMENT NOW** | Week 2 |
| **Multi-Stage Gather** | ⭐⭐⭐ | Medium | Implement Q1 2026 | Week 4-5 |
| **Strategy Pattern** | ⭐⭐⭐⭐ | Low | **IMPLEMENT NOW** | Week 3 |
| **Actor Telemetry** | ⭐⭐⭐⭐⭐ | Medium | **IMPLEMENT NOW** | Week 1-2 |
| **Parallel Limits per Stage** | ⭐⭐⭐⭐⭐ | **Already Exists!** | Document better | Week 1 |

---

## 1. Conditional Scatter - Skip items based on condition

### Proposal
```typescript
scatter: {
  input: '$.items[*]',
  as: 'item',
  condition: '$.item.needsProcessing === true'  // NEW
}
```

### Current State
```typescript
// Currently: scatter processes ALL items
// From: src/pipelines/builtin-executors.ts:66-108
export class ScatterExecutor extends BaseStageExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    let items = jp.query(pipelineContext, stage.scatter.input)
    // ALL items are processed - no filtering
    for (let i = 0; i < items.length; i++) {
      await messageQueue.enqueue(`actor-${stage.actor}`, message)
    }
  }
}
```

### Evaluation: ⭐⭐⭐⭐⭐ **EXCELLENT SUGGESTION**

**Why this is valuable:**
1. **Cost Savings**: Skip LLM calls for items that don't need processing (huge $ savings)
2. **Performance**: Reduces queue depth and processing time
3. **Clean API**: Fits naturally into existing scatter config
4. **Common Pattern**: Partner AI is right - this is a production necessity

**Real-world use case:**
```typescript
{
  name: 'process_documents',
  mode: 'scatter',
  scatter: {
    input: '$.documents[*]',
    as: 'doc',
    condition: '$.doc.status === "pending" && $.doc.language === "en"'  // Skip non-English or already processed
  },
  actor: 'DocumentProcessing'
}
```

**Implementation Complexity**: LOW
- Add `condition?: string` to scatter config
- Evaluate condition before enqueuing message
- Use existing expression evaluator or simple JSONPath filter

**Recommendation**: ✅ **IMPLEMENT IMMEDIATELY** - Week 2 priority

---

## 2. Multi-Stage Gather - Gather from multiple stages

### Proposal
```typescript
gather: {
  stages: ['stage1', 'stage2'],  // Gather from multiple stages
  combine: 'merge'
}
```

### Current State
```typescript
// From: src/pipelines/builtin-executors.ts:146-200
export class GatherExecutor extends BaseStageExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    if (!stage.gather) {
      throw new Error(`Stage ${stage.name} missing gather config`)
    }
    // Only supports single stage: stage.gather.stage (string)
    const targetOutputs = pipelineContext.stages[stage.gather.stage] || []
  }
}
```

### Evaluation: ⭐⭐⭐ **GOOD SUGGESTION, NEEDS REFINEMENT**

**Why this matters:**
1. **Fan-in from multiple sources**: Real pipelines often need to consolidate results from parallel branches
2. **Complex orchestration**: Enables diamond patterns (A → B+C → D)
3. **Data aggregation**: Combine classification results, validation checks, etc.

**Concerns:**
1. **Ambiguity**: What does "combine: 'merge'" mean exactly?
   - Array concatenation?
   - Object merge (shallow/deep)?
   - Custom reducer function?
2. **Type safety**: Different stages may have incompatible output schemas
3. **Ordering guarantees**: Which stage's outputs come first?

**Better API Design:**
```typescript
gather: {
  from: {
    classification: 'stage1',  // Named inputs
    validation: 'stage2'
  },
  combine: (inputs) => ({       // Explicit combiner function
    classification: inputs.classification,
    validation: inputs.validation,
    merged: [...inputs.classification, ...inputs.validation]
  })
}

// OR simpler version for common case:
gather: {
  stages: ['stage1', 'stage2'],
  strategy: 'concat' | 'object' | 'custom'  // Clear semantics
}
```

**Real-world use case:**
```typescript
// Diamond pattern: Split → Process both ways → Combine
{
  name: 'combine_results',
  mode: 'gather',
  gather: {
    from: {
      ai_classification: 'classify_with_ai',
      rule_validation: 'validate_with_rules'
    },
    strategy: 'object'  // Produces: { ai_classification: [...], rule_validation: [...] }
  }
}
```

**Recommendation**: ✅ **IMPLEMENT with refinement** - Q1 2026 (Week 4-5)
- Define clear semantics for combine strategies
- Support both simple (array concat) and complex (custom reducer) cases
- Add type validation warnings

---

## 3. Strategy Pattern Support - Actor with multiple strategies

### Proposal
```typescript
actor: {
  type: 'StrategyActor',
  strategies: {
    blob_storage: BlobStorageStrategy,
    cosmos_db: CosmosDbStrategy
  }
}
```

### Current State
```typescript
// From: src/discovery/index.ts:31-33
export type LoadBalancingStrategy = 'round-robin' | 'least-messages' | 'random'

// Actors CAN have strategies but not in pipeline DSL yet
// From: src/discovery/index.ts:317
target: string | { type: string; strategy?: LoadBalancingStrategy }
```

### Evaluation: ⭐⭐⭐⭐ **VERY GOOD SUGGESTION**

**Why this is valuable:**
1. **Runtime strategy selection**: Choose storage backend based on data size, cost, compliance
2. **A/B testing**: Route 10% to new strategy, 90% to old
3. **Fallback patterns**: Try Cosmos, fallback to Blob if quota exceeded
4. **Config-driven behavior**: Change strategy without code changes

**Current workaround:**
```typescript
// Partner AI probably doing something like this:
{
  name: 'store_data',
  actor: 'StorageActor',  // Actor internally checks config
  input: {
    data: '$.result',
    storageType: 'cosmos_db'  // Passed as input
  }
}

// Actor code:
class StorageActor {
  async execute(input) {
    const strategy = this.strategies[input.storageType]
    return strategy.store(input.data)
  }
}
```

**Better API in Pipeline DSL:**
```typescript
{
  name: 'store_data',
  actor: 'StorageActor',
  strategy: '$.metadata.size > 1000000 ? "blob_storage" : "cosmos_db"',  // Expression-based
  input: {
    data: '$.result'
  }
}

// OR more explicit:
{
  name: 'store_data',
  actor: {
    type: 'StorageActor',
    strategy: 'blob_storage',  // Static selection
    // OR
    strategyExpression: '$.selectStorageStrategy()'  // Dynamic
  }
}
```

**Implementation Complexity**: LOW-MEDIUM
- Already have strategy pattern in discovery service
- Just need to expose in pipeline DSL
- Add expression evaluation for dynamic strategy selection

**Recommendation**: ✅ **IMPLEMENT** - Week 3 priority
- Extend actor definition to support strategy selection
- Support both static and expression-based selection
- Document strategy pattern best practices

---

## 4. Actor Telemetry - Built-in comprehensive monitoring

### Proposal
```typescript
// Inside actor execution
context.recordEvent({
  eventType: 'extraction_started',
  metadata: { ... }
});
```

### Current State
```typescript
// From: src/actor/journal.ts:24-31
export interface ActorContext {
  actorId: string
  actorType: string
  correlationId?: string
  parentActorId?: string
  parentTraceId?: string
  trace?: import('../types').TraceContext  // Has trace but no recordEvent()
  sharedMemory?: SharedMemory
}

// Telemetry exists but NOT in ActorContext:
// From: src/observability/pipeline-tracer.ts
export class PipelineTracer {
  async recordScatter(...)
  async recordAIDecision(...)  // ← Exists but not accessible from actors!
}
```

### Evaluation: ⭐⭐⭐⭐⭐ **CRITICAL MISSING FEATURE**

**Why this is absolutely necessary:**
1. **Production Observability**: Cannot debug production issues without actor-level telemetry
2. **Cost Attribution**: Track which actors consume most LLM tokens, storage, compute
3. **Performance Analysis**: Identify slow actors, bottlenecks, optimization opportunities
4. **Business Metrics**: Track domain events (documents processed, classifications made, etc.)
5. **Compliance/Audit**: Record decision points for regulatory requirements

**Current Gap:**
```typescript
// Partner AI probably doing hacky workarounds:
class MyActor extends Actor {
  async execute(input: any, context: ActorContext) {
    // NO CLEAN WAY TO RECORD METRICS
    console.log('extraction_started')  // ❌ Not queryable
    
    // Or worse - direct Redis calls:
    await redis.lpush('metrics', JSON.stringify({...}))  // ❌ Couples actor to Redis
  }
}
```

**Proposed API:**
```typescript
export interface ActorContext {
  actorId: string
  actorType: string
  correlationId?: string
  trace?: TraceContext
  sharedMemory?: SharedMemory
  
  // NEW: Telemetry methods
  recordEvent(event: {
    eventType: string
    metadata?: Record<string, unknown>
    severity?: 'debug' | 'info' | 'warn' | 'error'
  }): void
  
  recordMetric(metric: {
    name: string
    value: number
    unit?: string
    dimensions?: Record<string, string>
  }): void
  
  recordSpan<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T>
}
```

**Usage:**
```typescript
class DocumentProcessor extends Actor {
  async execute(input: any, context: ActorContext) {
    context.recordEvent({
      eventType: 'extraction_started',
      metadata: { documentId: input.documentId, pages: input.pages.length }
    })
    
    const result = await context.recordSpan('llm_extraction', async () => {
      const extracted = await this.extractWithLLM(input)
      
      context.recordMetric({
        name: 'llm_tokens',
        value: extracted.tokensUsed,
        unit: 'tokens',
        dimensions: { model: 'gpt-4', actor: context.actorType }
      })
      
      return extracted
    })
    
    context.recordEvent({
      eventType: 'extraction_completed',
      metadata: { tokensUsed: result.tokensUsed, duration: result.duration }
    })
  }
}
```

**Implementation Complexity**: MEDIUM
1. Extend ActorContext interface with telemetry methods
2. Wire up to existing PipelineTracer
3. Store events in Redis/database for querying
4. Expose via Studio API for visualization

**Recommendation**: ✅ **CRITICAL - IMPLEMENT ASAP** - Week 1-2 priority
- This is a production blocker for serious deployments
- Partner AI is 100% correct - actors need first-class telemetry
- Should integrate with existing observability stack

---

## 5. Parallel Limits per Stage - Concurrency control

### Proposal
```typescript
{
  name: 'process_documents',
  mode: 'scatter',
  actor: 'DocumentProcessing',
  concurrency: 3  // Max 3 parallel (LLM rate limits)
}
```

### Current State
```typescript
// From: src/pipelines/pipeline-dsl.ts:70-83
export interface StageDefinition {
  config?: {
    concurrency?: number  // ← ALREADY EXISTS!
    timeout?: number
    retryPolicy?: RetryPolicy
  }
}

// From: src/pipelines/builtin-executors.ts:50-53
export interface ScatterConfig {
  maxParallel?: number  // ← ALSO EXISTS!
  batchSize?: number
}
```

### Evaluation: ⭐⭐⭐⭐⭐ **ALREADY IMPLEMENTED!**

**Reality Check:**
This feature **ALREADY EXISTS** in Loom! Partner AI either:
1. Didn't read the documentation thoroughly
2. API is not discoverable enough
3. Documentation is incomplete

**Current Usage:**
```typescript
// OPTION 1: Stage-level config
{
  name: 'process_documents',
  mode: 'scatter',
  actor: 'DocumentProcessing',
  config: {
    concurrency: 3  // ✅ Works today!
  }
}

// OPTION 2: Executor-specific config
{
  name: 'process_documents',
  mode: 'scatter',
  actor: 'DocumentProcessing',
  executorConfig: {
    maxParallel: 3  // ✅ Also works!
  }
}
```

**Evidence from real example:**
```typescript
// From: src/pipelines/pipeline-dsl.ts:171-184
{
  name: 'ClassifyPages',
  actor: 'ClassificationActor',
  mode: 'scatter',
  scatter: {
    input: '$.stages.SplitFiles.*',
    as: 'page'
  },
  config: {
    concurrency: 20  // ← LOOK, IT'S RIGHT HERE!
  }
}
```

**Root Cause**: Documentation problem, not feature gap.

**Recommendation**: ✅ **IMPROVE DOCUMENTATION** - Week 1
1. Add prominent "Rate Limiting & Concurrency Control" section to docs
2. Show examples for LLM rate limits specifically
3. Explain difference between `config.concurrency` and `executorConfig.maxParallel`
4. Add validation warning if concurrency not set on scatter stages

---

## Implementation Roadmap

### Week 1: Documentation & Quick Wins
- [ ] Document existing `config.concurrency` feature prominently
- [ ] Add validation warning if scatter stage missing concurrency
- [ ] Design ActorContext telemetry API

### Week 2: Critical Features
- [ ] **Conditional Scatter**: Add `condition` to scatter config
- [ ] **Actor Telemetry**: Implement `context.recordEvent()` and `context.recordMetric()`
- [ ] Add Studio visualization for actor telemetry

### Week 3: Strategy Pattern
- [ ] **Strategy Support**: Extend actor definition to support strategy selection
- [ ] Add expression-based strategy selection
- [ ] Document strategy pattern best practices

### Week 4-5: Advanced Gather
- [ ] **Multi-Stage Gather**: Design API for gathering from multiple stages
- [ ] Implement combine strategies (concat, object, custom)
- [ ] Add type validation warnings

### Week 6: Testing & Polish
- [ ] Integration tests for all new features
- [ ] Performance benchmarks
- [ ] Production documentation

---

## Conclusion

**Partner AI's suggestions are EXCELLENT** - they represent real production needs:

| Feature | Status | Action |
|---------|--------|--------|
| Conditional Scatter | ❌ Missing | **IMPLEMENT** |
| Multi-Stage Gather | ❌ Missing | **IMPLEMENT** (with refinement) |
| Strategy Pattern | ⚠️ Partial | **EXTEND** to pipeline DSL |
| Actor Telemetry | ❌ **CRITICAL GAP** | **IMPLEMENT ASAP** |
| Parallel Limits | ✅ **EXISTS** | **DOCUMENT BETTER** |

**Key Takeaway**: Partner AI is using Loom in anger and hitting real limitations. These enhancements will make Loom production-ready for serious workloads.

**Priority Order:**
1. **Actor Telemetry** - Production blocker
2. **Conditional Scatter** - Cost savings
3. **Documentation** - Prevent confusion
4. **Strategy Pattern** - Flexibility
5. **Multi-Stage Gather** - Advanced orchestration
