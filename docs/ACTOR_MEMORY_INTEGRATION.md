# Actor Memory Integration Guide

How to integrate semantic memory into your Loom actors.

## Quick Start

### 1. Enable Memory in Configuration

```typescript
import { DynamicConfigService } from '../src/config/dynamic-config'

const configService = new DynamicConfigService({
  cosmosEndpoint: process.env.COSMOS_ENDPOINT,
  databaseId: 'loom',
  containerId: 'configs',
})

await configService.initialize()

// Enable for specific tenant
await configService.saveConfig({
  tenantId: 'wells-fargo',
  memory: { enabled: true },
  priority: 100,
})
```

### 2. Create Memory Adapter

```typescript
import { MemoryFactory } from '../src/memory'

const config = await configService.getConfig('wells-fargo', 'MyActor')

let memoryAdapter = undefined
if (config.memory?.enabled) {
  memoryAdapter = await MemoryFactory.createAdapterFromEnv()
}
```

### 3. Pass to Actor Constructor

```typescript
const actor = new MyActor(
  context,
  initialState,
  observabilityTracer,
  idempotencyStore,
  memoryAdapter // <-- Add this parameter
)
```

### 4. Use Memory in Actor

```typescript
class MyActor extends Actor {
  async execute(input: any) {
    // Check cache
    const cached = await this.memory.checkCache(query)
    if (cached) return cached
    
    // Recall similar
    const similar = await this.memory.recall(query)
    
    // Do work
    const result = await this.doWork(input, similar)
    
    // Remember
    await this.memory.remember({ memory: result })
    await this.memory.cache(query, result)
  }
}
```

## Memory API

All memory methods are **no-op if memory not configured** - safe to call always!

### remember()
Store important information for later recall.

```typescript
await this.memory.remember({
  memory: 'Short description',
  content: JSON.stringify(fullData),
}, {
  importance: 'high', // 'low' | 'medium' | 'high' | 'critical'
  category: 'criterion-evaluation',
  ttl: 86400, // Optional: seconds
})
```

### recall()
Search for relevant past memories.

```typescript
const memories = await this.memory.recall(
  'foundation inspection criteria',
  {
    limit: 5,
    category: 'criterion-evaluation',
    threadId: 'specific-thread', // Optional
  }
)
```

### checkCache()
Fast semantic cache lookup.

```typescript
const cached = await this.memory.checkCache(
  'query string',
  {
    threshold: 0.98, // Optional
    maxAge: 3600, // Optional: seconds
  }
)

if (cached) {
  // Use cached result, skip LLM call
  return cached
}
```

### cache()
Store query/response for future cache hits.

```typescript
await this.memory.cache(
  'query string',
  response,
  {
    ttl: 3600, // Optional: seconds
    metadata: { /* optional */ },
  }
)
```

### getRecentMemories()
Get last N memories for current thread.

```typescript
const recent = await this.memory.getRecentMemories(10)
```

## Real Example: CriteriaReviewerActor

```typescript
class CriteriaReviewerActor extends Actor {
  async execute(input: CriteriaReviewerInput) {
    // 1. Check cache
    const cacheKey = `criterion:${input.criterion.id}:property:${input.appraisalData.propertyType}`
    const cached = await this.memory.checkCache(cacheKey)
    
    if (cached) {
      console.log('💾 Cache hit! Saved LLM call')
      this.state.review = cached
      return
    }

    // 2. Recall similar evaluations
    const similarQuery = `${input.criterion.criterion} ${input.appraisalData.propertyType}`
    const similar = await this.memory.recall(similarQuery, {
      category: 'criterion-evaluation',
      limit: 3,
    })
    
    if (similar.length > 0) {
      console.log(`📚 Found ${similar.length} similar evaluations`)
    }

    // 3. Build prompt with context
    const prompt = this.buildPrompt(input, similar)

    // 4. Call LLM
    const result = await this.callLLM(prompt)

    // 5. Remember result
    await this.memory.remember({
      memory: `Criterion ${result.criterionId}: ${result.evaluation}`,
      content: JSON.stringify(result),
    }, {
      importance: result.evaluation === 'fail' ? 'high' : 'medium',
      category: 'criterion-evaluation',
    })

    // 6. Cache for future
    await this.memory.cache(cacheKey, result, { ttl: 3600 })

    this.state.review = result
  }
}
```

## Configuration Patterns

### Per-Tenant Settings

```typescript
// Wells Fargo: Memory enabled
await configService.saveConfig({
  tenantId: 'wells-fargo',
  memory: { enabled: true },
  priority: 100,
})

// Chase: Memory disabled
await configService.saveConfig({
  tenantId: 'chase',
  memory: { enabled: false },
  priority: 100,
})
```

### Per-Actor Overrides

```typescript
// CriteriaReviewer: Longer cache
await configService.saveConfig({
  tenantId: 'wells-fargo',
  actorType: 'CriteriaReviewerActor',
  memory: {
    semanticCacheTTL: 7200, // 2 hours
  },
  priority: 200, // Higher priority
})

// DataProcessor: No memory
await configService.saveConfig({
  tenantId: 'wells-fargo',
  actorType: 'DataProcessor',
  memory: { enabled: false },
  priority: 200,
})
```

## Runtime Integration

### With ActorRuntime

```typescript
import { ActorRuntime } from '../src/runtime/actor-runtime'

// Create runtime
const runtime = new ActorRuntime({
  blobStore,
  stateStore,
})

// Register actor type
runtime.registerActorType('CriteriaReviewer', {
  name: 'CriteriaReviewer',
  version: '1.0.0',
  type: 'typescript',
  actorClass: CriteriaReviewerActor,
})

// Before spawning actor, check if memory enabled
const config = await configService.getConfig(tenantId, 'CriteriaReviewer')
const memoryAdapter = config.memory?.enabled 
  ? await MemoryFactory.createAdapterFromEnv()
  : undefined

// Spawn with memory
const actor = await runtime.spawnActor(
  'CriteriaReviewer',
  'reviewer-001',
  context,
  initialState,
  observabilityTracer,
  idempotencyStore,
  memoryAdapter // <-- Pass memory adapter
)
```

### With Worker Pools

```typescript
// Create memory adapter once per worker
const memoryAdapter = await MemoryFactory.createAdapterFromEnv()

// Pass to all actors in worker
worker.on('job', async (job) => {
  const actor = new CriteriaReviewerActor(
    job.context,
    undefined,
    undefined,
    undefined,
    memoryAdapter // Shared across jobs
  )
  
  await actor.execute(job.input)
})
```

## Environment Variables

Required for memory:

```bash
# Cosmos DB
COSMOS_ENDPOINT=https://your-cosmos.documents.azure.com:443/
COSMOS_DATABASE_ID=loom
COSMOS_MEMORY_CONTAINER=memories

# Embedding API
EMBEDDING_PROVIDER=azure-openai  # or 'openai'
OPENAI_API_KEY=sk-...
OPENAI_ENDPOINT=https://your-openai.openai.azure.com/
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# Optional: Tuning
DEDUPLICATION_ENABLED=true
DEDUPLICATION_THRESHOLD=0.95
SEMANTIC_CACHE_ENABLED=true
SEMANTIC_CACHE_THRESHOLD=0.98
SEMANTIC_CACHE_TTL=3600
```

## Testing

### Mock Memory in Tests

```typescript
import { createMemoryHelpers } from '../src/actor/memory-helpers'

// Create no-op memory
const actor = new MyActor(
  context,
  undefined,
  undefined,
  undefined,
  undefined // No memory adapter
)

// All memory calls are no-op
await actor.memory.remember({ memory: 'test' }) // Does nothing
const cached = await actor.memory.checkCache('test') // Returns null
```

### Integration Tests

```typescript
describe('Actor with memory', () => {
  test('should cache results', async () => {
    const memoryAdapter = await MemoryFactory.createAdapter({
      config: testConfig,
    })
    
    const actor = new MyActor(context, undefined, undefined, undefined, memoryAdapter)
    
    // First call
    await actor.execute(input)
    const result1 = actor.state.result
    
    // Second call - should hit cache
    await actor.execute(input)
    const result2 = actor.state.result
    
    expect(result1).toEqual(result2)
  })
})
```

## Performance Tips

1. **Cache TTL**: Set appropriate cache expiration
   - Criteria evaluations: 1-2 hours
   - Compliance rules: Never expire (-1)
   - User data: 24 hours

2. **Deduplication**: Prevent storing duplicates
   - Default threshold: 0.95 (95% similarity)
   - Lower = more aggressive deduplication

3. **Batch Operations**: Use for bulk imports
   ```typescript
   await memoryAdapter.addMemoriesBatch(memories)
   ```

4. **Selective Memory**: Not everything needs memory
   - Temporary calculations: Skip
   - Important decisions: Remember
   - Compliance findings: High importance

## Troubleshooting

### Memory Not Working

1. Check config is enabled:
   ```typescript
   const config = await configService.getConfig(tenantId, actorType)
   console.log('Memory enabled:', config.memory?.enabled)
   ```

2. Check adapter passed to constructor:
   ```typescript
   console.log('Memory adapter:', actor.memoryAdapter ? 'Yes' : 'No')
   ```

3. Check environment variables:
   ```bash
   echo $COSMOS_ENDPOINT
   echo $OPENAI_API_KEY
   ```

### Cache Not Hitting

- Check threshold: Lower = more hits (0.95 recommended)
- Check TTL: May have expired
- Check query similarity: Must be >98% similar

### High Costs

- Increase cache TTL (more reuse)
- Enable deduplication (less storage)
- Tune thresholds (fewer embeddings)

## Best Practices

1. ✅ **Always use memory helpers** (not direct adapter)
2. ✅ **Check cache first** (before expensive operations)
3. ✅ **Remember important results** (with appropriate importance)
4. ✅ **Use categories** (for easier filtering)
5. ✅ **Set TTLs** (avoid infinite growth)
6. ✅ **Add context to recalls** (better semantic search)
7. ✅ **Test without memory** (ensure graceful degradation)

## See Also

- [Memory Architecture](./MEMORY_LAYER_ARCHITECTURE.md)
- [Dynamic Configuration](./DYNAMIC_CONFIG.md)
- [Memory API Reference](../src/memory/README.md)
- [Integration Example](../examples/memory-integration-demo.ts)
