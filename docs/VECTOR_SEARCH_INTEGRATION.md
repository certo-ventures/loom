# Vector Search Integration in Loom

## Current Implementation

Loom has **existing vector search infrastructure** built into the GraphMemory system. Here's how it works:

### Core Components

#### 1. **EmbeddingService** (`src/memory/embedding-service.ts`)
Generates vector embeddings using OpenAI or Azure OpenAI:

```typescript
class EmbeddingService {
  async embed(text: string): Promise<number[]>
  async embedBatch(texts: string[]): Promise<number[][]>
}
```

**Providers supported:**
- OpenAI: `text-embedding-3-small`, `text-embedding-3-large`, `ada-002`
- Azure OpenAI: With managed identity or API key

#### 2. **Graph Storage with Embeddings** (`src/memory/graph/types.ts`)
All memory entities support optional embeddings:

```typescript
interface Episode {
  content: string
  embedding?: number[]        // Vector for semantic search
  embedding_ref?: string      // Reference to external embedding store
  // ...
}

interface Entity {
  name: string
  summary?: string
  summary_embedding?: number[] // Vector of entity summary
  // ...
}

interface Fact {
  text: string
  embedding?: number[]        // Vector for fact content
  embedding_ref?: string
  // ...
}

interface MemoryQuery {
  text?: string               // Text filtering
  embedding?: number[]        // Vector similarity search
  // ...
}
```

#### 3. **Cosine Similarity** (`src/memory/graph/in-memory-storage.ts`)
Built-in similarity calculation:

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  // Returns value between -1 and 1, where 1 = identical direction
  // Handles dimension mismatch, zero vectors
}
```

#### 4. **Storage Implementations**

All storage backends support vector search:

**InMemoryGraphStorage:**
```typescript
async searchFacts(query: MemoryQuery): Promise<Fact[]> {
  // 1. Filter by text, entities, relations, temporal
  // 2. If query.embedding provided:
  //    - Filter to facts with embeddings
  //    - Calculate cosine similarity for each
  //    - Sort by similarity descending
  // 3. Return top results
}
```

**RedisGraphStorage:** Same pattern with Redis persistence
**CosmosGraphStorage:** Leverages Cosmos DB vector search capabilities

#### 5. **ActorMemory API** (`src/memory/graph/actor-memory.ts`)

High-level API for actors:

```typescript
class ActorMemory {
  // Pure semantic search
  async searchSemantic(embedding: number[], limit?: number): Promise<Fact[]>
  
  // Hybrid: text filter + semantic ranking
  async searchHybrid(text: string, embedding: number[], limit?: number): Promise<Fact[]>
}
```

### Usage Pattern in Existing Code

```typescript
// 1. Actor with graph memory enabled
class MyActor extends Actor {
  constructor(context: ActorContext) {
    super(context, {}, undefined, undefined, undefined, undefined, undefined, graphMemory)
  }
  
  async execute(input: any) {
    // 2. Store fact with optional embedding
    await this.graphMemory.addFact(
      sourceEntityId,
      'relation',
      targetEntityId,
      'Fact text',
      { embedding: await embedService.embed('Fact text') }
    )
    
    // 3. Search by embedding
    const embedding = await embedService.embed('Query text')
    const similar = await this.graphMemory.searchSemantic(embedding, 10)
    
    // 4. Hybrid search (text + semantic)
    const results = await this.graphMemory.searchHybrid(
      'keyword filter',
      embedding,
      10
    )
  }
}
```

### Configuration

```yaml
memory:
  embedding:
    provider: openai  # or azure-openai
    
    openai:
      apiKey: ${OPENAI_API_KEY}
      model: text-embedding-3-small
    
    # OR
    
    azure:
      endpoint: https://xxx.openai.azure.com
      deploymentName: text-embedding-ada-002
      apiKey: ${AZURE_OPENAI_KEY}
      # OR use managed identity:
      credential: true
    
    dimensions: 1536  # For ada-002
```

## Key Insights for Phase 2

### 1. **Embeddings are Optional**
- Embeddings can be `undefined` - storage handles this gracefully
- Search works with or without embeddings (falls back to text filtering)
- Can add embeddings lazily via `EmbeddingEnricherActor` pipeline

### 2. **Two Search Modes**
- **Pure semantic**: `searchSemantic(embedding)` - only similarity ranking
- **Hybrid**: `searchHybrid(text, embedding)` - filter by text, rank by similarity

### 3. **Storage Abstraction**
- `MemoryStorage` interface supports all backends
- Vector search works identically across InMemory, Redis, Cosmos
- Cosmos DB has native vector index support for better performance

### 4. **Similarity Threshold**
- Current implementation returns all results sorted by similarity
- No minimum similarity threshold enforced
- Caller can filter by similarity score if needed

### 5. **Embedding Generation**
- Not automatic - must be explicit
- Can use `EmbeddingService` directly
- Or use `EmbeddingEnricherActor` in pipeline for lazy enrichment

## Applying to Phase 2: DecisionMemory

### Decision Traces with Embeddings

```typescript
interface DecisionTrace {
  decisionId: string
  rationale: string
  reasoning?: string[]
  inputs: DecisionInput[]
  outcome: any
  // ...
  
  // Add embedding support
  embedding?: number[]       // Embed rationale + reasoning + context
  embedding_ref?: string
}
```

### DecisionMemory Implementation Pattern

```typescript
class DecisionMemory extends ActorMemory {
  private embeddingService?: EmbeddingService
  
  /**
   * Add decision trace to searchable graph
   */
  async addDecisionTrace(trace: DecisionTrace): Promise<void> {
    // Generate embedding if service available
    const embedding = this.embeddingService
      ? await this.embeddingService.embed(this.serializeForSearch(trace))
      : undefined
    
    // Store as entity in graph
    await this.addEntity(
      trace.decisionId,
      'decision',
      trace.rationale,
      { embedding }  // Pass embedding to storage
    )
    
    // Add facts linking to precedents, policies, entities
    // (same as current ActorMemory pattern)
  }
  
  /**
   * Search for similar decisions
   */
  async searchDecisions(query: {
    decisionType?: string
    embedding?: number[]  // For semantic similarity
    contextSimilarity?: Record<string, any>
    withinDays?: number
  }): Promise<DecisionTrace[]> {
    // Use existing searchHybrid pattern
    const facts = await this.searchHybrid(
      this.buildTextQuery(query),  // Text filters
      query.embedding,             // Semantic ranking
      10
    )
    
    // Convert facts back to decision traces
    return this.factsToDecisionTraces(facts)
  }
  
  /**
   * Find similar decisions to current context
   */
  async findSimilarDecisions(trace: DecisionTrace, limit = 5): Promise<DecisionTrace[]> {
    // Generate embedding for current decision
    const embedding = this.embeddingService
      ? await this.embeddingService.embed(this.serializeForSearch(trace))
      : undefined
    
    if (!embedding) {
      // Fall back to text-based search
      return this.searchDecisions({
        decisionType: trace.decisionType,
        contextSimilarity: trace.context
      })
    }
    
    // Pure semantic search
    return this.searchDecisions({
      decisionType: trace.decisionType,
      embedding,
      withinDays: 90  // Last 3 months
    })
  }
  
  /**
   * Serialize decision for embedding generation
   */
  private serializeForSearch(trace: DecisionTrace): string {
    // Combine key fields into searchable text
    return [
      `Decision: ${trace.decisionType}`,
      `Rationale: ${trace.rationale}`,
      trace.reasoning ? `Reasoning: ${trace.reasoning.join('; ')}` : '',
      `Context: ${JSON.stringify(trace.context)}`,
      trace.policy ? `Policy: ${trace.policy.rule}` : '',
      trace.isException ? 'Exception to policy' : 'Standard policy application'
    ].filter(Boolean).join('\n')
  }
}
```

### Integration with Actor

```typescript
class DiscountApprovalAgent extends Actor {
  private embeddingService?: EmbeddingService
  private decisionMemory?: DecisionMemory
  
  async execute(request: DiscountRequest) {
    // ... gather context ...
    
    // Find precedents using vector search
    const embedding = this.embeddingService
      ? await this.embeddingService.embed(
          `Healthcare customer requesting ${request.requestedDiscount}% discount with service issues`
        )
      : undefined
    
    const precedents = await this.decisionMemory?.searchDecisions({
      decisionType: 'exception',
      embedding,
      contextSimilarity: {
        industry: customer.industry,
        arrRange: this.getARRRange(customer.ARR)
      },
      withinDays: 90
    }) || []
    
    // ... make decision ...
    
    // Record with embedding
    await this.recordDecision({
      decisionType: 'exception',
      rationale: 'Healthcare customer with service issues',
      // ... other fields ...
    })
    
    // DecisionMemory will auto-generate embedding and store
  }
}
```

### Configuration for Phase 2

```yaml
decisionTraces:
  enabled: true
  
  # Use existing embedding service
  embeddings:
    enabled: true  # Enable semantic precedent search
    provider: openai
    model: text-embedding-3-small
    dimensions: 1536
  
  llmEnrichment:
    mode: hybrid
    # ... existing config ...
```

## Key Advantages

1. **Reuse Existing Infrastructure** - Don't rebuild vector search
2. **Consistent API** - Same patterns as ActorMemory
3. **Backend Agnostic** - Works with InMemory, Redis, Cosmos
4. **Optional Embeddings** - Graceful degradation if not configured
5. **Proven Implementation** - Already tested and working

## Phase 2 Implementation Checklist

- [ ] Create `DecisionMemory` class extending `ActorMemory`
- [ ] Add `embedding?: number[]` to `DecisionTrace` interface
- [ ] Implement `serializeForSearch(trace)` - convert trace to searchable text
- [ ] Implement `addDecisionTrace()` - store with embedding
- [ ] Implement `searchDecisions()` - use existing `searchHybrid()`
- [ ] Implement `findSimilarDecisions()` - pure semantic search
- [ ] Add `embeddingService` to actor context (optional)
- [ ] Update `recordDecision()` to generate embeddings if service available
- [ ] Add tests for semantic precedent search
- [ ] Document embedding configuration

## Example Test

```typescript
describe('DecisionMemory with Vector Search', () => {
  it('should find similar decisions using embeddings', async () => {
    const embeddingService = new EmbeddingService({
      provider: 'openai',
      openai: { apiKey: 'test', model: 'text-embedding-3-small' }
    })
    
    const decisionMemory = new DecisionMemory(
      actorId,
      storage,
      lamportClock,
      { embeddingService }
    )
    
    // Store decision 1
    await decisionMemory.addDecisionTrace({
      decisionType: 'exception',
      rationale: 'Healthcare customer with service issues',
      context: { industry: 'Healthcare' }
      // ... other fields
    })
    
    // Store decision 2 (similar)
    await decisionMemory.addDecisionTrace({
      decisionType: 'exception',
      rationale: 'Medical company experiencing technical problems',
      context: { industry: 'Healthcare' }
    })
    
    // Search for similar decisions
    const query = 'Healthcare organization with support tickets'
    const embedding = await embeddingService.embed(query)
    
    const similar = await decisionMemory.searchDecisions({
      embedding,
      limit: 5
    })
    
    expect(similar).toHaveLength(2)
    expect(similar[0].rationale).toContain('Healthcare')
  })
})
```

## Performance Considerations

**Embedding Generation:**
- ~50-100ms per embedding (OpenAI API)
- Can batch multiple embeddings
- Cache embeddings in storage (don't regenerate)

**Similarity Search:**
- In-memory: O(n) scan, fast for <10k decisions
- Redis: O(n) but with network latency
- Cosmos DB: Native vector index, O(log n) + approximate nearest neighbor

**Optimization Strategies:**
1. Generate embeddings async (don't block decision recording)
2. Use `EmbeddingEnricherActor` pipeline for lazy enrichment
3. Store `embedding_ref` instead of full embedding (save space)
4. Use Cosmos DB native vector search for production (faster)
5. Cache recent embeddings in-memory

## Summary

**Loom already has production-ready vector search!** Phase 2 should:
1. Extend `ActorMemory` to create `DecisionMemory`
2. Add `embedding` field to `DecisionTrace`
3. Use existing `searchHybrid()` and `searchSemantic()` methods
4. Leverage existing `EmbeddingService` and `cosineSimilarity()`
5. Follow established patterns from graph memory system

**No need to rebuild vector search from scratch** - we have it! 🎉
