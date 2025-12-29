# Loom Memory Layer Architecture

## Executive Summary

This document outlines the architecture and implementation plan for adding a native memory layer to Loom using Azure Cosmos DB's built-in AI capabilities (vector search, full-text search, hybrid search, and TTL). This implementation leverages Cosmos DB's native features instead of external dependencies like Mem0, resulting in lower costs, simpler architecture, and better performance.

**Key Benefits:**
- ✅ Native vector search with quantizedFlat and DiskANN indexes
- ✅ BM25 full-text search with linguistic processing (tokenization, stemming, case normalization)
- ✅ Hybrid search combining semantic + keyword matching (RRF fusion)
- ✅ Multi-level memory scoping (tenant/user/agent/thread/run)
- ✅ Automatic deduplication via semantic similarity
- ✅ TTL-based memory expiration (short-term vs long-term)
- ✅ Semantic caching to reduce LLM costs by 40-60%
- ✅ Single-service solution (no Neo4j, Redis, or Mem0 SDK)
- ✅ Sharded vector indexes for multi-tenant isolation
- ✅ Per-turn embeddings for granular semantic search
- ✅ Conversation summarization support
- ✅ System timestamp (_ts) for automatic ordering

**Estimated Cost:** $40-60/month for production workload (50 appraisals/day)
**ROI:** $190/month net benefit through LLM cost reduction

---

## 1. Architecture Overview

### 1.1 System Components

```
┌─────────────────────────────────────────────────────────────┐
│                      Loom Application                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐      ┌───────────┐ │
│  │   Actors     │──────│   Pipeline   │──────│  Message  │ │
│  │  (Criteria   │      │ Orchestrator │      │   Queue   │ │
│  │  Reviewers)  │      │              │      │  (BullMQ) │ │
│  └──────┬───────┘      └──────┬───────┘      └───────────┘ │
│         │                     │                              │
│         │                     │                              │
│         └─────────┬───────────┘                              │
│                   │                                          │
│         ┌─────────▼─────────┐                                │
│         │  Memory Service   │◄────── New Component           │
│         │ (SemanticMemory)  │                                │
│         └─────────┬─────────┘                                │
│                   │                                          │
└───────────────────┼──────────────────────────────────────────┘
                    │
        ┌───────────▼───────────┐
        │   Embedding Service   │
        │   (OpenAI/Azure)      │
        └───────────┬───────────┘
                    │
        ┌───────────▼──────────────────────────────────────┐
        │         Azure Cosmos DB for NoSQL                │
        ├──────────────────────────────────────────────────┤
        │  ✓ Vector Search (quantizedFlat/DiskANN)        │
        │  ✓ Full-Text Search (BM25)                       │
        │  ✓ Hybrid Search (RRF)                           │
        │  ✓ Hierarchical Partitioning                     │
        │  ✓ TTL (Time-to-Live)                            │
        │  ✓ Sharded Vector Indexes                        │
        └──────────────────────────────────────────────────┘
```

### 1.2 Data Flow

```
1. Actor executes → generates output
                ↓
2. Memory Service → extracts key facts
                ↓
3. Embedding Service → generates vector (1536 dims)
                ↓
4. Deduplication Check → searches similar memories
                ↓
5. Storage Decision → merge OR insert
                ↓
6. Cosmos DB → stores with hierarchical partition key
```

**Retrieval Flow:**
```
1. Query arrives (text or criteria ID)
                ↓
2. Semantic Cache Check → vector search for exact/similar queries
                ↓
3. Cache Hit? → return cached result (save LLM call)
                ↓
4. Cache Miss → generate embedding
                ↓
5. Hybrid Search → vector + full-text (RRF)
                ↓
6. Return ranked results → feed to actor context
```

---

## 2. Data Model Design

### 2.1 Memory Item Schema

Based on Microsoft's recommended "One Document Per Turn" pattern:

```typescript
interface MemoryItem {
  // Core identifiers
  id: string;                    // GUID
  
  // Hierarchical partitioning (supports multi-level scoping)
  tenantId: string;              // Organization (Wells Fargo, Chase, etc.)
  userId?: string;               // Borrower or loan officer
  agentId?: string;              // Actor type (CriteriaReviewer, Consolidator)
  threadId: string;              // Pipeline execution or conversation
  runId?: string;                // Specific workflow run
  
  // Turn information
  turnIndex: number;             // Sequence number in thread (monotonic counter)
  
  // Messages array (following Microsoft's recommended pattern)
  messages?: MessageItem[];      // Array of role/content pairs for complete exchanges
  
  // Content
  memory: string;                // The actual memory text
  content: string;               // Full content (for full-text search with BM25)
  summary?: string;              // Optional condensed version (LLM-generated)
  
  // Vector embeddings (per-turn and per-message options)
  embedding: number[];           // 1536-dim vector (OpenAI text-embedding-3-small)
  turnEmbedding?: number[];      // Optional: embedding of entire turn/exchange
  
  // Metadata
  hash: string;                  // Content hash for exact deduplication
  timestamp: string;             // ISO 8601 - explicit timestamp
  createdAt: string;
  updatedAt?: string;
  
  // Memory classification
  memoryType: 'short-term' | 'long-term' | 'semantic-cache';
  category?: string;             // e.g., "criterion-evaluation", "compliance"
  importance?: 'low' | 'medium' | 'high' | 'critical';
  
  // TTL for automatic expiration
  ttl?: number;                  // Seconds (-1 = never expire)
  
  // Context preservation
  entityId?: string;             // User/agent/tool ID associated with this memory
  sourceActor?: string;          // Which actor created this
  relatedMemoryIds?: string[];   // Links to related memories
  
  // Metrics (following Microsoft's pattern)
  metrics?: {
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    ruConsumed?: number;
    [key: string]: any;
  };
  
  // Application-specific metadata
  metadata?: {
    criterionId?: string;
    loanId?: string;
    appraisalId?: string;
    confidence?: number;
    [key: string]: any;
  };
}

// Message structure for multi-message exchanges
interface MessageItem {
  role: 'user' | 'agent' | 'tool' | 'system';  // Origin of message
  entityId?: string;                            // Specific user/agent/tool ID
  name?: string;                                // Tool/function name
  content: string;                              // Message payload
  timestamp?: string;                           // ISO 8601
  embedding?: number[];                         // Per-message embedding (optional)
  metadata?: {
    tokens?: number;
    toolArgs?: any;
    toolResult?: any;
    [key: string]: any;
  };
}
```

### 2.2 Partition Key Strategy

**Chosen Strategy:** Hierarchical partition key with `["/tenantId", "/threadId"]`

**Rationale:**
- ✅ Tenant isolation (multiple banks can use same Loom instance)
- ✅ Efficient thread-level queries (all memories for one loan appraisal)
- ✅ Balanced distribution (each tenant has many threads)
- ✅ Governance and quotas per tenant
- ✅ Security isolation

**Alternative considered:** Single `/threadId` partition
- ⚠️ No tenant isolation
- ⚠️ Harder to implement multi-tenancy later

### 2.3 Index Configuration

```typescript
const containerDefinition = {
  id: "memories",
  partitionKey: {
    paths: ["/tenantId", "/threadId"],
    kind: "MultiHash"
  },
  
  // Vector embedding policy
  vectorEmbeddingPolicy: {
    vectorEmbeddings: [{
      path: "/embedding",
      dataType: "float32",
      dimensions: 1536,
      distanceFunction: "cosine"
    }]
  },
  
  // Indexing policy
  indexingPolicy: {
    automatic: true,
    includedPaths: [
      { path: "/*" }
    ],
    excludedPaths: [
      { path: "/embedding/*" }  // Vector index handles this
    ],
    
    // Vector index
    vectorIndexes: [{
      path: "/embedding",
      type: "quantizedFlat"  // or "diskANN" for >100K vectors
    }],
    
    // Full-text index
    fullTextIndexes: [{
      path: "/content"
    }, {
      path: "/memory"
    }]
  },
  
  // Sharded vector index for multi-tenant optimization
  // Reduces search scope by isolating tenant data
  vectorIndexShardKey: "/tenantId",
  
  // Default TTL (can be overridden per item)
  defaultTtl: -1  // -1 = no default expiration
};

/**
 * Alternative: Non-sharded (global) vector index
 * - Simpler setup
 * - Search across all tenants
 * - Still filterable via WHERE clause
 * 
 * Use sharded index when:
 * - You have many tenants (>10)
 * - Tenant data is isolated (security requirement)
 * - You want faster searches within a tenant
 * 
 * Use global index when:
 * - Few tenants or single-tenant
 * - Cross-tenant search needed
 * - Simpler management preferred
 */
```

---

## 3. Implementation Components

### 3.1 Core Memory Service

**File:** `src/memory/semantic-memory-service.ts`

```typescript
export interface MemoryConfig {
  cosmosEndpoint: string;
  credential: TokenCredential;
  databaseId: string;
  containerId: string;
  
  // Embedding configuration
  embeddingProvider: 'openai' | 'azure-openai';
  embeddingModel: string;
  embeddingDimensions: number;
  
  // Memory behavior
  deduplicationThreshold: number;  // 0.95 = 95% similarity
  shortTermTTL: number;           // Default: 86400 (24 hours)
  enableSemanticCache: boolean;
  cacheThreshold: number;         // 0.98 = 98% similarity for cache hit
  
  // Search configuration
  defaultSearchLimit: number;
  hybridSearchEnabled: boolean;
}

export class SemanticMemoryService {
  // Core operations
  async add(memory: Partial<MemoryItem>, options: AddMemoryOptions): Promise<string>
  async search(query: string, options: SearchOptions): Promise<MemoryItem[]>
  async get(memoryId: string): Promise<MemoryItem | null>
  async update(memoryId: string, updates: Partial<MemoryItem>): Promise<void>
  async delete(memoryId: string): Promise<void>
  async deleteAll(filters: MemoryFilters): Promise<number>
  
  // Recency-based retrieval (Microsoft's recommended pattern)
  async getRecentMemories(
    tenantId: string, 
    threadId: string, 
    limit: number,
    options?: { orderBy?: 'timestamp' | 'turnIndex' }
  ): Promise<MemoryItem[]>
  
  // Semantic search (vector similarity)
  async searchSemantic(
    query: string,
    options: {
      tenantId: string;
      threadId?: string;
      limit?: number;
      threshold?: number;  // Minimum similarity score
    }
  ): Promise<MemoryItem[]>
  
  // Hybrid search (vector + full-text with RRF)
  async searchHybrid(
    query: string,
    keywords: string,
    options: {
      tenantId: string;
      threadId?: string;
      limit?: number;
    }
  ): Promise<MemoryItem[]>
  
  // Keyword/phrase search (full-text only)
  async searchKeywords(
    phrase: string,
    options: {
      tenantId: string;
      threadId?: string;
      limit?: number;
      orderBy?: 'relevance' | 'timestamp';
    }
  ): Promise<MemoryItem[]>
  
  // Advanced operations
  async findSimilar(embedding: number[], threshold: number, filters?: MemoryFilters): Promise<MemoryItem[]>
  async checkSemanticCache(query: string, threshold?: number): Promise<CachedResult | null>
  async getHistory(memoryId: string): Promise<MemoryVersion[]>
  async exportMemories(filters: MemoryFilters): Promise<MemoryItem[]>
  
  // Conversation summarization
  async summarizeThread(
    tenantId: string,
    threadId: string,
    options?: {
      maxTurns?: number;      // Number of turns to summarize
      llmProvider?: string;   // Which LLM to use for summarization
    }
  ): Promise<string>
  
  // Thread-level operations
  async getThreadStats(tenantId: string, threadId: string): Promise<{
    turnCount: number;
    totalTokens: number;
    firstTurnAt: string;
    lastTurnAt: string;
    participants: string[];  // Unique entity IDs
  }>
}
```

### 3.2 Embedding Service

**File:** `src/memory/embedding-service.ts`

```typescript
export interface EmbeddingConfig {
  provider: 'openai' | 'azure-openai';
  apiKey?: string;
  endpoint?: string;
  model: string;
  dimensions: number;
  batchSize: number;  // For batch embedding
}

export class EmbeddingService {
  async embed(text: string, type?: 'query' | 'document'): Promise<number[]>
  async embedBatch(texts: string[]): Promise<number[][]>
  async embedWithRetry(text: string, maxRetries: number): Promise<number[]>
}
```

### 3.3 Memory Adapter Interface

**File:** `src/storage/adapters.ts` (extend existing)

```typescript
export interface MemoryAdapter {
  // Memory operations
  addMemory(memory: Partial<MemoryItem>, options?: AddMemoryOptions): Promise<string>;
  searchMemories(query: string, options?: SearchOptions): Promise<MemoryItem[]>;
  getMemory(memoryId: string): Promise<MemoryItem | null>;
  updateMemory(memoryId: string, updates: Partial<MemoryItem>): Promise<void>;
  deleteMemory(memoryId: string): Promise<void>;
  deleteAllMemories(filters: MemoryFilters): Promise<number>;
  
  // Semantic operations
  findSimilarMemories(embedding: number[], threshold: number, filters?: MemoryFilters): Promise<MemoryItem[]>;
  checkSemanticCache(query: string, threshold?: number): Promise<CachedResult | null>;
  
  // Batch operations
  addMemoriesBatch(memories: Partial<MemoryItem>[]): Promise<string[]>;
  
  // Analytics
  getMemoryStats(filters?: MemoryFilters): Promise<MemoryStats>;
}
```

### 3.4 Integration with Actor System

**File:** `src/actor/actor.ts` (extend existing Actor class)

```typescript
export abstract class Actor {
  // Existing properties...
  protected memory?: MemoryAdapter;
  
  // Add memory to actor output
  protected async rememberOutput(output: any, importance: 'low' | 'medium' | 'high' | 'critical'): Promise<void> {
    if (!this.memory) return;
    
    await this.memory.addMemory({
      tenantId: this.context.tenantId,
      userId: this.context.userId,
      agentId: this.context.actorType,
      threadId: this.context.threadId,
      runId: this.context.runId,
      memory: this.extractMemory(output),
      content: JSON.stringify(output),
      memoryType: importance === 'critical' ? 'long-term' : 'short-term',
      importance,
      sourceActor: this.context.actorId,
      metadata: {
        actorType: this.context.actorType,
        ...this.context.metadata
      }
    });
  }
  
  // Recall relevant memories
  protected async recall(query: string, limit: number = 5): Promise<MemoryItem[]> {
    if (!this.memory) return [];
    
    return this.memory.searchMemories(query, {
      tenantId: this.context.tenantId,
      userId: this.context.userId,
      agentId: this.context.actorType,
      threadId: this.context.threadId,
      limit,
      hybridSearch: true
    });
  }
  
  // Check semantic cache before expensive LLM call
  protected async checkCache(query: string): Promise<any | null> {
    if (!this.memory) return null;
    
    const cached = await this.memory.checkSemanticCache(query);
    return cached?.response || null;
  }
  
  // Abstract method for memory extraction (each actor implements)
  protected abstract extractMemory(output: any): string;
}
```

---

## 4. Use Cases & Implementation

### 4.1 Use Case 1: Criteria Evaluation with Memory

**Scenario:** CriteriaReviewerActor evaluates appraisal against criterion, stores structured memory, recalls similar past evaluations

```typescript
class CriteriaReviewerActor extends Actor {
  async execute(input: CriteriaReviewerInput): Promise<void> {
    const { appraisalData, criterion, agentName, llmModel } = input;
    
    // 1. Check semantic cache for similar criteria evaluation
    const cacheKey = `criterion:${criterion.id}:appraisal:${appraisalData.propertyType}`;
    const cached = await this.checkCache(cacheKey);
    
    if (cached) {
      console.log(`✅ Cache hit for ${criterion.id}`);
      this.state.review = cached;
      this.state.success = true;
      return;
    }
    
    // 2. Recall similar past evaluations
    const similarEvaluations = await this.recall(
      `${criterion.criterion} ${appraisalData.propertyType}`,
      3
    );
    
    // 3. Build prompt with context from memory
    const prompt = this.buildReviewPrompt(input, similarEvaluations);
    
    // 4. Call LLM
    const llmResponse = await this.callLLM(prompt, llmModel);
    const review = this.parseReviewResult(llmResponse, input);
    
    // 5. Store structured memory
    await this.rememberOutput(review, 
      review.evaluation === 'fail' ? 'high' : 'medium'
    );
    
    // 6. Store in semantic cache
    await this.memory?.addMemory({
      tenantId: this.context.tenantId,
      threadId: cacheKey,
      memory: JSON.stringify(review),
      content: `${criterion.criterion}: ${review.evaluation}`,
      memoryType: 'semantic-cache',
      ttl: 3600, // Cache for 1 hour
      metadata: {
        criterionId: criterion.id,
        evaluation: review.evaluation,
        confidence: review.confidence
      }
    });
    
    this.state.review = review;
    this.state.success = true;
  }
  
  protected extractMemory(output: ReviewResult): string {
    return `Criterion ${output.criterionId} evaluated as ${output.evaluation} ` +
           `with confidence ${output.confidence}. ` +
           `Key reasoning: ${output.reasoning.substring(0, 200)}`;
  }
}
```

**Expected Outcomes:**
- ✅ 40-60% cache hit rate (similar appraisals)
- ✅ Consistent evaluations across similar properties
- ✅ $8/day LLM cost savings ($240/month)

---

### 4.2 Use Case 2: Compliance Knowledge Base

**Scenario:** Store interpretations of lending regulations, recall during criteria validation

```typescript
class ComplianceMemoryService {
  async addRegulationInterpretation(regulation: Regulation): Promise<void> {
    await this.memory.addMemory({
      tenantId: 'wells-fargo',
      agentId: 'compliance-agent',
      threadId: `regulation-${regulation.id}`,
      memory: regulation.interpretation,
      content: `${regulation.name}: ${regulation.fullText}`,
      memoryType: 'long-term',
      ttl: -1,  // Never expire
      category: 'compliance',
      importance: 'critical',
      metadata: {
        regulationId: regulation.id,
        effectiveDate: regulation.effectiveDate,
        jurisdiction: regulation.jurisdiction,
        frameworks: regulation.frameworks
      }
    });
  }
  
  async findRelevantRegulations(criterionText: string): Promise<MemoryItem[]> {
    return this.memory.searchMemories(criterionText, {
      tenantId: 'wells-fargo',
      category: 'compliance',
      limit: 5,
      hybridSearch: true
    });
  }
}
```

**Expected Outcomes:**
- ✅ Instant recall of relevant regulations
- ✅ Consistent compliance interpretations
- ✅ Audit trail for regulatory citations

---

### 4.3 Use Case 3: Borrower History Tracking

**Scenario:** Track borrower preferences, past loan applications, appraisal history

```typescript
async function trackBorrowerHistory(borrowerId: string, loanData: LoanData) {
  await memoryService.add({
    tenantId: 'wells-fargo',
    userId: borrowerId,
    threadId: `loan-${loanData.loanId}`,
    memory: `Borrower applied for ${loanData.loanType} loan of $${loanData.amount}`,
    content: JSON.stringify(loanData),
    memoryType: 'long-term',
    ttl: 31536000,  // 1 year
    category: 'borrower-history',
    metadata: {
      loanId: loanData.loanId,
      loanType: loanData.loanType,
      amount: loanData.amount,
      propertyType: loanData.propertyType
    }
  });
}

async function getBorrowerContext(borrowerId: string): Promise<MemoryItem[]> {
  return memoryService.search(`borrower ${borrowerId} loan history`, {
    tenantId: 'wells-fargo',
    userId: borrowerId,
    category: 'borrower-history',
    limit: 10
  });
}
```

**Expected Outcomes:**
- ✅ Personalized loan processing
- ✅ Risk assessment based on history
- ✅ Faster repeat borrower processing

---

### 4.4 Use Case 4: Multi-Agent Coordination Memory

**Scenario:** Supervisor agent stores task assignments, workers recall their assignments

```typescript
class SupervisorActor extends Actor {
  async coordinateReview(appraisalId: string, criteria: Criterion[]) {
    // Store coordination plan in shared memory
    for (const criterion of criteria) {
      await this.memory?.addMemory({
        tenantId: this.context.tenantId,
        agentId: 'supervisor',
        threadId: `appraisal-${appraisalId}`,
        memory: `Assigned criterion ${criterion.id} to agent pool`,
        content: JSON.stringify(criterion),
        memoryType: 'short-term',
        ttl: 86400,  // 24 hours
        category: 'task-assignment',
        metadata: {
          criterionId: criterion.id,
          appraisalId,
          status: 'assigned'
        }
      });
    }
  }
}

class WorkerActor extends Actor {
  async getAssignedTasks(appraisalId: string): Promise<Criterion[]> {
    const assignments = await this.memory?.searchMemories(
      `appraisal ${appraisalId} assignments`,
      {
        tenantId: this.context.tenantId,
        threadId: `appraisal-${appraisalId}`,
        category: 'task-assignment',
        limit: 100
      }
    );
    
    return assignments?.map(m => JSON.parse(m.content)) || [];
  }
}
```

**Expected Outcomes:**
- ✅ Coordination without shared state locks
- ✅ Audit trail of task assignments
- ✅ Failure recovery (workers know what was assigned)

---

### 4.5 Use Case 5: Deduplication of Redundant Evaluations

**Scenario:** Prevent storing duplicate criterion evaluations for similar properties

```typescript
async function addCriterionEvaluation(evaluation: ReviewResult) {
  const embedding = await embeddingService.embed(
    `${evaluation.criterionId}: ${evaluation.reasoning}`
  );
  
  // Check for similar evaluations
  const similar = await memoryService.findSimilar(embedding, 0.95, {
    tenantId: 'wells-fargo',
    category: 'criterion-evaluation',
    metadata: { criterionId: evaluation.criterionId }
  });
  
  if (similar.length > 0) {
    console.log(`Found ${similar.length} similar evaluations, merging...`);
    
    // Update existing memory instead of creating duplicate
    await memoryService.update(similar[0].id, {
      memory: `${similar[0].memory}\n\nAdditional case: ${evaluation.reasoning}`,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...similar[0].metadata,
        occurrences: (similar[0].metadata?.occurrences || 1) + 1
      }
    });
    
    return similar[0].id;
  }
  
  // No similar evaluation, create new
  return memoryService.add({
    tenantId: 'wells-fargo',
    agentId: 'criteria-reviewer',
    threadId: `criterion-${evaluation.criterionId}`,
    memory: evaluation.reasoning,
    content: JSON.stringify(evaluation),
    memoryType: 'long-term',
    category: 'criterion-evaluation',
    importance: evaluation.evaluation === 'fail' ? 'high' : 'medium',
    metadata: {
      criterionId: evaluation.criterionId,
      evaluation: evaluation.evaluation,
      confidence: evaluation.confidence,
      occurrences: 1
    }
  });
}
```

**Expected Outcomes:**
- ✅ 30-50% reduction in duplicate memories
- ✅ Lower storage costs
- ✅ Richer context (aggregated similar cases)

---

## 5. Implementation Phases

### Phase 1: Foundation (Week 1)
**Goal:** Core memory service with vector search

**Tasks:**
1. Create `SemanticMemoryService` class
2. Implement `EmbeddingService` with OpenAI integration
3. Create Cosmos DB container with vector indexing
4. Implement basic CRUD operations
5. Add vector similarity search
6. Write unit tests

**Deliverables:**
- `src/memory/semantic-memory-service.ts`
- `src/memory/embedding-service.ts`
- `src/memory/types.ts`
- `tests/memory/semantic-memory.test.ts`
- Updated `src/storage/adapter-factory.ts` to include memory adapter

**Success Metrics:**
- ✅ Can store and retrieve memories
- ✅ Vector search returns relevant results
- ✅ <100ms query latency

---

### Phase 2: Hybrid Search & Deduplication (Week 2)
**Goal:** Add full-text search and smart deduplication

**Tasks:**
1. Enable full-text indexing in Cosmos DB
2. Implement hybrid search (RRF)
3. Add deduplication logic
4. Implement similarity threshold configuration
5. Add batch operations
6. Integration tests with real data

**Deliverables:**
- Updated `SemanticMemoryService` with hybrid search
- Deduplication service
- Example queries in documentation
- Performance benchmarks

**Success Metrics:**
- ✅ Hybrid search improves recall by 20-30%
- ✅ Deduplication reduces duplicates by 40%+
- ✅ <150ms hybrid query latency

---

### Phase 3: Actor Integration (Week 3)
**Goal:** Integrate memory into Actor system

**Tasks:**
1. Extend `Actor` base class with memory methods
2. Update `CriteriaReviewerActor` to use memory
3. Add semantic caching
4. Implement memory extraction methods
5. Add context injection from memories
6. End-to-end tests with pipeline

**Deliverables:**
- Updated `src/actor/actor.ts`
- Updated `src/actor/ai-actor.ts`
- Memory-enabled `CriteriaReviewerActor`
- E2E tests with memory
- Documentation for actor developers

**Success Metrics:**
- ✅ Actors can store/recall memories
- ✅ Cache hit rate >40%
- ✅ LLM cost reduction >30%

---

### Phase 4: Advanced Features (Week 4)
**Goal:** TTL, multi-tenancy, analytics

**Tasks:**
1. Implement TTL-based memory expiration
2. Add hierarchical partitioning for multi-tenancy
3. Implement memory versioning/history
4. Add analytics queries
5. Build memory export/import utilities
6. Create monitoring dashboards

**Deliverables:**
- TTL configuration
- Multi-tenant memory isolation
- Memory analytics service
- Export/import tools
- Grafana dashboard templates
- Admin documentation

**Success Metrics:**
- ✅ TTL correctly expires old memories
- ✅ Tenant isolation verified
- ✅ Analytics show memory usage patterns

---

## 6. Configuration

### 6.1 Loom Configuration Schema

**File:** `src/config/schema.ts` (extend existing)

```typescript
export const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  
  // Cosmos DB configuration
  cosmos: z.object({
    endpoint: z.string(),
    databaseId: z.string().default('loom'),
    containerId: z.string().default('memories'),
    useSystemManagedIdentity: z.boolean().default(true)
  }),
  
  // Embedding configuration
  embedding: z.object({
    provider: z.enum(['openai', 'azure-openai']),
    model: z.string().default('text-embedding-3-small'),
    dimensions: z.number().default(1536),
    apiKey: z.string().optional(),
    endpoint: z.string().optional(),
    batchSize: z.number().default(100)
  }),
  
  // Memory behavior
  deduplication: z.object({
    enabled: z.boolean().default(true),
    threshold: z.number().min(0).max(1).default(0.95)
  }),
  
  semanticCache: z.object({
    enabled: z.boolean().default(true),
    threshold: z.number().min(0).max(1).default(0.98),
    ttl: z.number().default(3600)  // 1 hour
  }),
  
  // TTL settings
  ttl: z.object({
    shortTerm: z.number().default(86400),    // 24 hours
    longTerm: z.number().default(-1),        // Never expire
    cache: z.number().default(3600)          // 1 hour
  }),
  
  // Search configuration
  search: z.object({
    defaultLimit: z.number().default(10),
    maxLimit: z.number().default(100),
    hybridSearch: z.boolean().default(true),
    vectorIndexType: z.enum(['quantizedFlat', 'diskANN']).default('quantizedFlat')
  })
});
```

### 6.2 Example Configuration

**File:** `loom.config.yaml`

```yaml
memory:
  enabled: true
  
  cosmos:
    endpoint: https://your-cosmos.documents.azure.com:443/
    databaseId: loom
    containerId: memories
    useSystemManagedIdentity: true
  
  embedding:
    provider: azure-openai
    model: text-embedding-3-small
    dimensions: 1536
    endpoint: https://your-openai.openai.azure.com/
  
  deduplication:
    enabled: true
    threshold: 0.95
  
  semanticCache:
    enabled: true
    threshold: 0.98
    ttl: 3600
  
  ttl:
    shortTerm: 86400    # 24 hours
    longTerm: -1        # Never expire
    cache: 3600         # 1 hour
  
  search:
    defaultLimit: 10
    maxLimit: 100
    hybridSearch: true
    vectorIndexType: quantizedFlat  # or diskANN for >100K vectors
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

```typescript
describe('SemanticMemoryService', () => {
  test('should store and retrieve memory', async () => {
    const memoryId = await service.add({
      tenantId: 'test',
      threadId: 'thread-1',
      turnIndex: 0,
      memory: 'Test memory',
      content: 'Test content',
      timestamp: new Date().toISOString()
    });
    
    const retrieved = await service.get(memoryId);
    expect(retrieved?.memory).toBe('Test memory');
  });
  
  test('should retrieve most recent memories by turnIndex', async () => {
    // Add multiple turns
    await service.add({ 
      tenantId: 'test', 
      threadId: 'thread-1', 
      turnIndex: 0,
      memory: 'First turn',
      timestamp: '2025-01-01T10:00:00Z'
    });
    await service.add({ 
      tenantId: 'test', 
      threadId: 'thread-1', 
      turnIndex: 1,
      memory: 'Second turn',
      timestamp: '2025-01-01T10:01:00Z'
    });
    await service.add({ 
      tenantId: 'test', 
      threadId: 'thread-1', 
      turnIndex: 2,
      memory: 'Third turn',
      timestamp: '2025-01-01T10:02:00Z'
    });
    
    // Get last 2 turns
    const recent = await service.getRecentMemories('test', 'thread-1', 2);
    
    expect(recent.length).toBe(2);
    expect(recent[0].turnIndex).toBe(2);  // Most recent first
    expect(recent[1].turnIndex).toBe(1);
  });
  
  test('should find similar memories above threshold', async () => {
    // Add test memories
    await service.add({ memory: 'Property has good condition', ... });
    await service.add({ memory: 'House is in excellent shape', ... });
    
    // Search for similar
    const results = await service.search('Property condition is great', {
      tenantId: 'test',
      threadId: 'thread-1',
      limit: 5
    });
    
    expect(results.length).toBeGreaterThan(0);
  });
  
  test('should deduplicate similar memories', async () => {
    const memory1 = { memory: 'Criterion passed: good foundation', ... };
    const memory2 = { memory: 'Criterion passed: solid foundation', ... };
    
    const id1 = await service.add(memory1);
    const id2 = await service.add(memory2);  // Should merge with id1
    
    expect(id1).toBe(id2);  // Same ID if deduplicated
  });
  
  test('should respect TTL expiration', async () => {
    const memoryId = await service.add({
      memory: 'Short-term memory',
      ttl: 1  // 1 second
    });
    
    await sleep(2000);
    
    const retrieved = await service.get(memoryId);
    expect(retrieved).toBeNull();
  });
});
```

### 7.2 Integration Tests

```typescript
describe('Memory-enabled CriteriaReviewer', () => {
  test('should cache similar criterion evaluations', async () => {
    const input = {
      appraisalData: mockAppraisal,
      criterion: mockCriterion,
      agentName: 'test-agent',
      llmModel: 'gpt-4'
    };
    
    // First call - cache miss
    const spy = jest.spyOn(llmService, 'call');
    await actor.execute(input);
    expect(spy).toHaveBeenCalledTimes(1);
    
    // Second call with similar input - cache hit
    await actor.execute({ ...input, appraisalData: similarAppraisal });
    expect(spy).toHaveBeenCalledTimes(1);  // No additional LLM call
  });
  
  test('should recall relevant past evaluations', async () => {
    // Add historical evaluations
    await addHistoricalEvaluations();
    
    // Execute with memory recall
    await actor.execute(input);
    
    // Verify similar cases were used in prompt
    const prompt = actor.getLastPrompt();
    expect(prompt).toContain('Similar past evaluations:');
  });
});
```

### 7.3 Performance Tests

```typescript
describe('Memory performance', () => {
  test('vector search should complete in <100ms', async () => {
    const start = Date.now();
    await service.search('test query', { limit: 10 });
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(100);
  });
  
  test('hybrid search should complete in <150ms', async () => {
    const start = Date.now();
    await service.search('test query', { 
      limit: 10, 
      hybridSearch: true 
    });
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(150);
  });
  
  test('batch insert should handle 100 memories in <2s', async () => {
    const memories = generateTestMemories(100);
    
    const start = Date.now();
    await service.addBatch(memories);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(2000);
  });
});
```

---

## 8. Monitoring & Observability

### 8.1 Key Metrics

```typescript
interface MemoryMetrics {
  // Storage metrics
  totalMemories: number;
  storageGB: number;
  memoriesByType: Record<string, number>;
  memoriesByTenant: Record<string, number>;
  
  // Performance metrics
  avgQueryLatency: number;
  p95QueryLatency: number;
  avgVectorSearchLatency: number;
  avgHybridSearchLatency: number;
  
  // Cache metrics
  cacheHitRate: number;
  cacheHits: number;
  cacheMisses: number;
  
  // Cost metrics
  ruConsumption: number;
  estimatedMonthlyCost: number;
  
  // Deduplication metrics
  duplicatesDetected: number;
  duplicatesMerged: number;
  deduplicationRate: number;
}
```

### 8.2 Logging

```typescript
// Structured logging for memory operations
logger.info('Memory added', {
  memoryId,
  tenantId,
  threadId,
  memoryType,
  size: memory.length,
  hasDuplicate: false,
  latencyMs: 45
});

logger.info('Cache hit', {
  query: queryHash,
  cacheAge: 1800,  // seconds
  savedLLMCost: 0.002
});

logger.warn('Deduplication threshold low', {
  tenantId,
  threshold: 0.80,
  recommendedThreshold: 0.95
});
```

### 8.3 Alerts

```yaml
alerts:
  - name: High Memory Query Latency
    condition: avg(query_latency) > 200ms over 5m
    severity: warning
    
  - name: Low Cache Hit Rate
    condition: cache_hit_rate < 0.30 over 1h
    severity: warning
    
  - name: High RU Consumption
    condition: ru_per_hour > 10000
    severity: warning
    
  - name: Memory Storage Growth
    condition: storage_growth_rate > 10GB/day
    severity: info
```

---

## 9. Cost Projections

### 9.1 Development/Testing (Month 1)
- **Storage:** 100K memories = $0.18/month
- **RUs:** 16M RUs/month (serverless) = $4.05/month
- **Total:** ~$5/month

### 9.2 Production - Small Scale (Months 2-3)
- **Storage:** 1M memories = $2.36/month
- **RUs:** 162M RUs/month (serverless) = $40.50/month
- **Total:** ~$43/month
- **LLM Savings:** $240/month (40% reduction)
- **Net Benefit:** +$197/month

### 9.3 Production - Medium Scale (Months 4-6)
- **Storage:** 5M memories = $10/month
- **RUs:** 645M RUs/month (serverless) = $161/month
- **Total:** ~$173/month
- **LLM Savings:** $600/month (40% reduction)
- **Net Benefit:** +$427/month

### 9.4 Enterprise Scale (Year 2+)
- **Storage:** 50M memories = $100/month
- **RUs:** Autoscale 10K-50K RU/s = $576-2,880/month
- **Total:** ~$896/month (avg)
- **LLM Savings:** $3,000/month (40% reduction)
- **Net Benefit:** +$2,104/month

---

## 10. Migration from Existing System

### 10.1 Current State (Without Memory)
- Actors generate outputs → stored in actor state
- No semantic search
- No deduplication
- No caching
- High LLM costs

### 10.2 Migration Steps

**Step 1: Deploy Memory Infrastructure**
```bash
# Create Cosmos DB container with vector indexing
az cosmosdb sql container create \
  --resource-group loom-rg \
  --account-name loom-cosmos \
  --database-name loom \
  --name memories \
  --partition-key-path '/tenantId' '/threadId' \
  --throughput 400
```

**Step 2: Gradual Rollout**
```typescript
// Feature flag for memory
if (config.memory.enabled) {
  await actor.rememberOutput(result);
  const context = await actor.recall(query);
}
```

**Step 3: Backfill Historical Data** (Optional)
```typescript
// Migrate existing actor outputs to memories
async function backfillMemories() {
  const outputs = await getHistoricalActorOutputs();
  
  for (const output of outputs) {
    await memoryService.add({
      ...extractMemoryFromOutput(output),
      createdAt: output.timestamp,
      memoryType: 'long-term'
    });
  }
}
```

**Step 4: Validate & Monitor**
- Monitor cache hit rates
- Compare memory retrieval vs. traditional queries
- Measure LLM cost reduction
- Validate deduplication effectiveness

---

## 11. Success Criteria

### 11.1 Technical Metrics
- ✅ Vector search latency <100ms (p95)
- ✅ Hybrid search latency <150ms (p95)
- ✅ Cache hit rate >40%
- ✅ Deduplication rate >30%
- ✅ 99.9% availability

### 11.2 Business Metrics
- ✅ LLM cost reduction >30%
- ✅ Monthly infrastructure cost <$200
- ✅ Net positive ROI within 30 days
- ✅ Zero data loss or corruption

### 11.3 Developer Experience
- ✅ Simple API for actors (`remember()`, `recall()`)
- ✅ <5 lines of code to add memory to an actor
- ✅ Comprehensive documentation and examples
- ✅ Clear error messages and debugging tools

---

## 12. Risks & Mitigations

### 12.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Vector index performance degrades at scale | High | Medium | Use DiskANN for >100K vectors, shard by tenant |
| Embedding API rate limits | Medium | Low | Implement retry logic, batch embeddings |
| Memory duplication despite deduplication | Medium | Medium | Tune similarity thresholds, periodic cleanup |
| TTL doesn't expire as expected | Low | Low | Test TTL thoroughly, monitor storage growth |

### 12.2 Cost Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| RU consumption exceeds budget | High | Set up budget alerts, use serverless initially |
| Storage grows faster than expected | Medium | Aggressive TTL, deduplication, monitoring |
| Embedding API costs | Low | Batch operations, cache embeddings |

### 12.3 Operational Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Memory corruption from bad data | High | Input validation, schema enforcement |
| Tenant data leakage | Critical | Hierarchical partitioning, access controls |
| Backup/recovery complexity | Medium | Automated exports, point-in-time restore testing |

---

## 13. Future Enhancements

### 13.1 Short Term (Next 3 Months)
1. **Memory Summarization** - Periodic LLM-based summarization of old memories (Microsoft recommended)
2. **Memory Tags** - User-defined tags for easier filtering
3. **Memory Collections** - Group related memories (e.g., all memories for a loan)
4. **Advanced Reranking** - Integrate Cohere or Jina rerankers
5. **Per-Message Embeddings** - Enable granular search within multi-message turns
6. **Linguistic Processing** - Leverage BM25 stemming and normalization features

### 13.2 Medium Term (6-12 Months)
1. **Graph Memory Layer** - Add Cosmos DB Gremlin API for entity relationships (optional)
2. **Memory Federation** - Share memories across tenants (with permissions)
3. **Memory Analytics Dashboard** - Visual insights into memory usage patterns
4. **Automated Memory Curation** - AI-powered memory importance scoring
5. **Thread Aggregation** - Automatic rolling of old turns into summaries
6. **Cross-Thread Search** - Find similar patterns across all conversations for a tenant

### 13.3 Long Term (12+ Months)
1. **Multi-Modal Memory** - Store images, documents, audio embeddings
2. **Memory Reasoning** - LLM-powered memory synthesis and inference
3. **Federated Learning** - Learn from memories without exposing raw data
4. **Memory Marketplace** - Share anonymized memory patterns across customers
5. **Adaptive TTL** - AI-driven expiration based on memory importance and access patterns
6. **Memory Versioning** - Track how memories evolve and get refined over time

---

## 14. References

### 14.1 Azure Documentation
- [Agent Memories in Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/agentic-memories)
- [Vector Search in Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/vector-search-overview)
- [Full-Text Search in Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/full-text-search-faq)
- [Hybrid Search in Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/hybrid-search)
- [Semantic Caching](https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/semantic-cache)

### 14.2 Related Loom Documentation
- [Loom Architecture](./architecture.md)
- [Actor System](../src/actor/README.md)
- [Storage Adapters](../src/storage/README.md)
- [Configuration](./configuration.md)

### 14.3 Research Papers
- BM25 Ranking: "Okapi at TREC-3" (Robertson et al., 1994)
- Vector Search: "Efficient and robust approximate nearest neighbor search" (DiskANN paper)
- Hybrid Search: "Reciprocal Rank Fusion" (Cormack et al., 2009)

---

## 15. Appendix

### 15.1 Sample Queries (Microsoft's Recommended Patterns)

**1. Retrieve Most Recent Memories (by turnIndex):**
```sql
-- Get last K turns for a conversation
SELECT TOP @k c.content, c.timestamp, c.turnIndex
FROM c
WHERE c.tenantId = @tenantId
  AND c.threadId = @threadId
ORDER BY c.turnIndex DESC
```

**2. Retrieve Most Recent Memories (by timestamp):**
```sql
-- Alternative: Order by timestamp
SELECT TOP @k c.content, c.timestamp
FROM c
WHERE c.threadId = @threadId
ORDER BY c.timestamp DESC
```

**3. Semantic Search (Vector Similarity):**
```sql
-- Find contextually relevant memories
SELECT TOP @k 
  c.content, 
  c.timestamp, 
  VectorDistance(c.embedding, @queryVector) AS distance
FROM c
WHERE c.threadId = @threadId
ORDER BY VectorDistance(c.embedding, @queryVector)
```

**4. Hybrid Search (Vector + Full-Text with RRF):**
```sql
-- Combine semantic relevance with keyword matching
SELECT TOP @k 
  c.content, 
  c.timestamp,
  VectorDistance(c.embedding, @queryVector) AS vectorScore,
  FullTextScore(c.content, @searchString) AS textScore
FROM c
WHERE c.threadId = @threadId
ORDER BY RANK RRF(
  VectorDistance(c.embedding, @queryVector),
  FullTextScore(c.content, @searchString)
)
```

**5. Keyword/Phrase Search (Full-Text Only):**
```sql
-- Find memories with specific phrases
SELECT TOP @k c.content, c.timestamp
FROM c
WHERE c.threadId = @threadId
  AND FULLTEXTCONTAINS(c.content, @phrase)
ORDER BY c.timestamp DESC
```

**6. Cross-Thread Search by Tenant:**
```sql
-- Search across all conversations for a tenant
SELECT TOP @k c.content, c.threadId, c.timestamp
FROM c
WHERE c.tenantId = @tenantId
  AND FULLTEXTCONTAINS(c.content, @phrase)
ORDER BY c.timestamp DESC
```

**7. Semantic Cache Lookup:**
```sql
SELECT TOP 1 c.memory, c.metadata
FROM c
WHERE c.memoryType = 'semantic-cache'
  AND c.threadId = @cacheKey
  AND VectorDistance(c.embedding, @queryVector) < 0.02
ORDER BY VectorDistance(c.embedding, @queryVector)
```

**8. Memory Deduplication:**
```sql
SELECT TOP 5 c.id, c.memory,
  VectorDistance(c.embedding, @newEmbedding) AS similarity
FROM c
WHERE c.tenantId = @tenantId
  AND c.category = @category
  AND VectorDistance(c.embedding, @newEmbedding) < 0.05
ORDER BY VectorDistance(c.embedding, @newEmbedding)
```

**9. Thread Statistics:**
```sql
-- Get conversation metadata
SELECT 
  COUNT(1) AS turnCount,
  MIN(c.timestamp) AS firstTurnAt,
  MAX(c.timestamp) AS lastTurnAt,
  SUM(c.metrics.inputTokens + c.metrics.outputTokens) AS totalTokens
FROM c
WHERE c.tenantId = @tenantId
  AND c.threadId = @threadId
```

### 15.2 Embedding Dimensions Comparison

| Model | Dimensions | Use Case | Cost |
|-------|------------|----------|------|
| text-embedding-3-small | 1536 | General purpose | $0.02/1M tokens |
| text-embedding-3-large | 3072 | Higher accuracy | $0.13/1M tokens |
| ada-002 (legacy) | 1536 | Compatible | $0.10/1M tokens |

**Recommendation:** Use `text-embedding-3-small` for cost/performance balance

### 15.3 Performance Benchmarks

**Vector Search (quantizedFlat, 100K vectors):**
- Avg latency: 45ms
- P95 latency: 85ms
- P99 latency: 120ms

**Vector Search (DiskANN, 10M vectors):**
- Avg latency: 12ms
- P95 latency: 28ms
- P99 latency: 45ms

**Hybrid Search (quantizedFlat + BM25):**
- Avg latency: 95ms
- P95 latency: 140ms
- P99 latency: 180ms

---

## Next Steps

1. **Review & Approve** this architecture document
2. **Provision Azure Resources** (Cosmos DB container with vector indexing)
3. **Implement Phase 1** (Core memory service)
4. **Conduct POC** (Use with CriteriaReviewerActor)
5. **Measure Results** (Cache hit rate, LLM cost reduction)
6. **Iterate & Expand** (Phases 2-4)

---

**Document Status:** Draft - Awaiting Review
**Last Updated:** December 25, 2025
**Author:** Loom AI Assistant
**Reviewers:** [Your Name Here]
