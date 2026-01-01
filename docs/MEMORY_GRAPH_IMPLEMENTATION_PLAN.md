# Memory Graph Implementation Plan for Loom

## Executive Summary

**What We're Building**: A temporal knowledge graph memory system for Loom's durable actors, enabling agents to remember facts, relationships, and context across conversations and time.

**Why It Matters**: Current AI agents have amnesia - they forget everything between sessions. With memory graphs, Loom actors can:
- Remember user preferences and history
- Track changing information over time
- Share knowledge between actors
- Build long-term relationships with users

**Timeline**: 12-16 weeks to production-ready system
**Effort**: 1-2 engineers full-time

---

## The Problem We're Solving

### Without Memory Graphs

```typescript
// Current state: Each conversation is isolated
const actor = await loom.createActor('CustomerServiceBot');
await actor.invoke({ message: "My name is Alice, I work at TechStart" });
// ... later ...
await actor.invoke({ message: "What company do I work for?" });
// ❌ Actor response: "I don't have that information"
```

**Pain Points:**
1. **No Persistence**: Actors forget everything between invocations
2. **No Relationships**: Can't track "Alice works at TechStart"
3. **No Time Awareness**: Can't handle "Alice used to work at Acme, now works at TechStart"
4. **No Sharing**: Each actor has isolated knowledge

### With Memory Graphs

```typescript
// With memory graphs: Persistent, queryable knowledge
const actor = await loom.createActor('CustomerServiceBot', {
  memory: { enabled: true, graphId: 'customer_alice_123' }
});

await actor.invoke({ message: "My name is Alice, I work at TechStart" });
// ✅ Automatically extracts: Entity(Alice), Entity(TechStart), Edge(Alice WORKS_AT TechStart)

// ... days later ...
await actor.invoke({ message: "What company do I work for?" });
// ✅ Actor response: "You work at TechStart" (retrieved from memory graph)

// ... months later ...
await actor.invoke({ message: "I just changed jobs to Acme Corp!" });
// ✅ Automatically: Marks old edge as invalid, creates new edge with timestamp

await actor.invoke({ message: "What's my job history?" });
// ✅ Actor response: "You currently work at Acme Corp (since March 2025). Previously you worked at TechStart."
```

---

## Concrete Use Cases for Loom

### Use Case 1: Personal AI Assistant

**Scenario**: User has a personal assistant actor that helps with daily tasks

```typescript
// Day 1: Initial interaction
await assistant.invoke({ 
  message: "I'm vegetarian and allergic to peanuts" 
});
// Memory graph stores: User(dietary_restrictions: [vegetarian, no_peanuts])

// Day 5: Restaurant recommendation
await assistant.invoke({ 
  message: "Find me a restaurant for dinner" 
});
// Response uses memory: "I found 3 vegetarian restaurants with no peanut dishes nearby..."

// Month 2: Life change
await assistant.invoke({ 
  message: "I'm no longer vegetarian, I eat chicken now" 
});
// Memory graph: Updates dietary_restrictions with timestamp

// Month 3: Query history
await assistant.invoke({ 
  message: "How have my food preferences changed?" 
});
// Response: "You were vegetarian until February 2025, now you eat chicken but still avoid peanuts."
```

**Value**: Personalization without re-explaining preferences every time

### Use Case 2: Customer Support Team

**Scenario**: Multiple support agents need to remember customer history

```typescript
// Create shared memory graph for customer
const sharedGraph = 'customer_acme_corp_123';

// Agent 1: First interaction (billing issue)
const billingAgent = await loom.createActor('BillingSupport', {
  memory: { graphId: sharedGraph }
});
await billingAgent.invoke({
  message: "We upgraded to Enterprise plan last month but were charged for Pro"
});
// Memory: Edge(AcmeCorp UPGRADED_TO EnterprisePlan, valid_at: Jan 2025)
//         Edge(AcmeCorp BILLED_FOR ProPlan, valid_at: Feb 2025)
//         Node(BillingIssue: "Charged for wrong plan")

// Agent 2: Follow-up (different agent, next day)
const followupAgent = await loom.createActor('FollowupSupport', {
  memory: { graphId: sharedGraph }
});
await followupAgent.invoke({
  message: "Hi, I'm calling about yesterday's billing issue"
});
// ✅ Agent knows full context: "Yes, I see you upgraded to Enterprise in January but were incorrectly charged for Pro. Our billing team is processing the refund."
```

**Value**: Seamless handoffs, no "can you repeat your issue?" frustration

### Use Case 3: Research Assistant with Evolving Knowledge

**Scenario**: Actor helps researcher track findings over time

```typescript
const researchActor = await loom.createActor('ResearchAssistant', {
  memory: { graphId: 'quantum_computing_research' }
});

// Week 1: Initial finding
await researchActor.invoke({
  message: "Paper XYZ claims quantum advantage for algorithm ABC"
});
// Memory: Edge(PaperXYZ CLAIMS QuantumAdvantageForABC, valid_at: Jan 2025)

// Week 5: Contradictory finding
await researchActor.invoke({
  message: "New paper DEF shows no quantum advantage for algorithm ABC due to classical optimization"
});
// Memory: Marks previous edge as invalid_at: Feb 2025
//         Creates: Edge(PaperDEF DISPROVES QuantumAdvantageForABC, valid_at: Feb 2025)

// Week 10: Literature review
await researchActor.invoke({
  message: "What's the current consensus on quantum advantage for algorithm ABC?"
});
// Response: "Current consensus (as of Feb 2025) is NO quantum advantage, based on Paper DEF's classical optimization. This contradicts earlier claims from Paper XYZ (Jan 2025)."
```

**Value**: Track how scientific understanding evolves, automatic citation of sources

### Use Case 4: Multi-Actor Collaboration (Project Management)

**Scenario**: Multiple specialized actors work on a software project

```typescript
const projectGraph = 'project_loom_v2';

// Code Review Actor
const reviewActor = await loom.createActor('CodeReviewer', {
  memory: { graphId: projectGraph }
});
await reviewActor.invoke({
  message: "PR #123 introduces memory leak in actor.ts line 456"
});
// Memory: Node(Bug: "Memory leak actor.ts:456")
//         Edge(PR123 INTRODUCES Bug, valid_at: today)

// Documentation Actor
const docsActor = await loom.createActor('DocWriter', {
  memory: { graphId: projectGraph }
});
await docsActor.invoke({
  message: "What recent bugs should I document in release notes?"
});
// ✅ Finds Bug from shared graph: "Memory leak in actor.ts:456 from PR #123"

// Planning Actor
const planActor = await loom.createActor('SprintPlanner', {
  memory: { graphId: projectGraph }
});
await planActor.invoke({
  message: "What critical issues need attention?"
});
// ✅ Prioritizes: "Memory leak in actor.ts:456 is critical (found in code review, pending fix)"
```

**Value**: Shared knowledge graph enables true multi-agent collaboration

### Use Case 5: Compliance & Audit Trail (TLS Notary Integration)

**Scenario**: Legal/compliance actors need verifiable memory

```typescript
const complianceActor = await loom.createActor('ComplianceOfficer', {
  memory: { 
    graphId: 'gdpr_requests',
    verifiable: true  // Enable TLS Notary proofs
  }
});

// User requests data deletion
await complianceActor.invoke({
  message: "User alice@example.com requests GDPR deletion",
  proof: tlsNotaryProof  // Verified request from official GDPR portal
});
// Memory: Node(GDPRRequest: alice@example.com)
//         Metadata: { verified: true, proof_hash: "0x...", timestamp: "2025-03-15T10:30:00Z" }

// Later: Audit query
const auditResult = await complianceActor.queryMemory({
  query: "Show all verified GDPR requests in Q1 2025"
});
// Returns: All requests with TLS Notary proofs proving authenticity
```

**Value**: Cryptographically verifiable audit trail, unmatched by competitors

---

## Architecture Overview

### High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Loom Actor Runtime                        │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐ │
│  │ CustomerService│  │  Research      │  │  Compliance   │ │
│  │     Actor      │  │  Assistant     │  │    Officer    │ │
│  │                │  │  Actor         │  │    Actor      │ │
│  │  [Memory]      │  │  [Memory]      │  │  [Memory]     │ │
│  └────────┬───────┘  └────────┬───────┘  └───────┬───────┘ │
│           │                   │                   │         │
│           └───────────────────┴───────────────────┘         │
│                              │                              │
└──────────────────────────────┼──────────────────────────────┘
                               │
                               ▼
            ┌─────────────────────────────────────┐
            │   Memory Graph Service (New)        │
            │                                     │
            │  ┌──────────────────────────────┐  │
            │  │  GraphMemoryActor            │  │
            │  │  - addEpisode()              │  │
            │  │  - search()                  │  │
            │  │  - extractEntities()         │  │
            │  │  - invalidateFacts()         │  │
            │  └──────────────────────────────┘  │
            └─────────────────┬───────────────────┘
                              │
                 ┌────────────┴─────────────┐
                 │                          │
                 ▼                          ▼
    ┌─────────────────────┐    ┌────────────────────┐
    │  Kuzu (In-Memory)   │    │  CosmosDB Gremlin  │
    │  - Hot memory       │    │  - Cold storage    │
    │  - Per-actor graphs │    │  - Shared graphs   │
    │  - Sub-ms queries   │    │  - Durable         │
    └─────────────────────┘    └────────────────────┘
```

### Data Model

```typescript
// Core types
interface Episode {
  uuid: string;
  content: string;
  source: 'message' | 'json' | 'text';
  created_at: Date;
  valid_at: Date;
  actor_id: string;      // Which actor created this
  graph_id: string;      // Partition key (actor-specific or shared)
}

interface Entity {
  uuid: string;
  name: string;
  summary: string;
  labels: string[];      // e.g., ['Person', 'Customer']
  attributes: Record<string, any>;
  created_at: Date;
  graph_id: string;
}

interface Relationship {
  uuid: string;
  source_entity_id: string;
  target_entity_id: string;
  name: string;           // e.g., "WORKS_AT", "PURCHASED"
  fact: string;           // Human-readable: "Alice works at TechStart"
  episodes: string[];     // Supporting evidence (episode UUIDs)
  
  // Temporal fields (the killer feature)
  created_at: Date;
  valid_at?: Date;        // When fact became true
  invalid_at?: Date;      // When fact stopped being true
  expired_at?: Date;      // When fact was superseded
  
  graph_id: string;
}
```

### Two-Tier Storage Strategy

**Tier 1: Kuzu (Hot Memory)**
- Embedded in-memory graph database
- Lives inside each actor instance
- Ultra-fast queries (<1ms)
- Recent episodes (last 30 days or 10,000 episodes)
- Automatically syncs to Tier 2

**Tier 2: CosmosDB Gremlin (Cold Storage)**
- Durable, globally distributed
- All historical data
- Cross-actor queries
- Slower but reliable (10-50ms)
- Backup and disaster recovery

```typescript
class GraphMemoryActor extends DurableActor {
  private hotMemory: KuzuDatabase;     // In-memory, fast
  private coldStorage: CosmosDBClient;  // Durable, slow
  
  async addEpisode(episode: Episode): Promise<void> {
    // 1. Add to hot memory immediately
    await this.hotMemory.add(episode);
    
    // 2. Schedule background sync to cold storage
    await this.scheduleTask('syncToColdStorage', { episodeId: episode.uuid });
    
    // 3. Trigger entity extraction (async)
    await this.scheduleTask('extractEntities', { episodeId: episode.uuid });
  }
  
  async search(query: string): Promise<SearchResults> {
    // Try hot memory first (fast path)
    const hotResults = await this.hotMemory.search(query, { limit: 20 });
    
    // If insufficient results, query cold storage
    if (hotResults.length < 10) {
      const coldResults = await this.coldStorage.search(query, { limit: 20 });
      return [...hotResults, ...coldResults].slice(0, 20);
    }
    
    return hotResults;
  }
}
```

---

## Implementation Plan

### Phase 1: Foundation (4 weeks)

**Goal**: Basic episode storage and retrieval

**Deliverables**:
1. GraphMemoryActor with Kuzu integration
2. Simple episode add/retrieve operations
3. Actor memory configuration
4. Basic tests

**Technical Tasks**:
- [ ] Set up Kuzu npm package integration
- [ ] Create GraphMemoryActor base class
- [ ] Implement episode storage schema
- [ ] Add memory config to actor creation
- [ ] Write unit tests for basic operations

**Code Example**:
```typescript
// src/actors/graph-memory-actor.ts
export class GraphMemoryActor extends DurableActor {
  private kuzuDB: Database;
  private kuzuConn: Connection;
  
  async initialize(config: MemoryConfig): Promise<void> {
    // Initialize Kuzu database
    this.kuzuDB = new kuzu.Database(config.dbPath || ':memory:');
    this.kuzuConn = new kuzu.Connection(this.kuzuDB);
    
    // Create schema
    await this.kuzuConn.query(`
      CREATE NODE TABLE Episode(
        uuid STRING PRIMARY KEY,
        content STRING,
        source STRING,
        created_at TIMESTAMP,
        valid_at TIMESTAMP,
        actor_id STRING,
        graph_id STRING
      )
    `);
  }
  
  async addEpisode(content: string, source: 'message' | 'json' | 'text'): Promise<string> {
    const uuid = generateUUID();
    await this.kuzuConn.query(`
      CREATE (:Episode {
        uuid: $uuid,
        content: $content,
        source: $source,
        created_at: $now,
        valid_at: $now,
        actor_id: $actorId,
        graph_id: $graphId
      })
    `, { uuid, content, source, now: new Date(), actorId: this.actorId, graphId: this.config.graphId });
    
    return uuid;
  }
  
  async getRecentEpisodes(limit: number = 10): Promise<Episode[]> {
    const result = await this.kuzuConn.query(`
      MATCH (e:Episode)
      WHERE e.graph_id = $graphId
      ORDER BY e.created_at DESC
      LIMIT $limit
      RETURN e
    `, { graphId: this.config.graphId, limit });
    
    return result.getAll();
  }
}
```

**Demo at End of Phase 1**:
```typescript
// Create actor with memory
const actor = await loom.createActor('TestActor', {
  memory: { enabled: true, graphId: 'test_graph_1' }
});

// Add episodes
await actor.addEpisode("User mentioned they like pizza", "message");
await actor.addEpisode("User's favorite color is blue", "message");

// Retrieve
const recent = await actor.getRecentEpisodes(10);
console.log(recent); // Shows both episodes
```

### Phase 2: Entity Extraction (4 weeks)

**Goal**: Automatic entity and relationship extraction using LLM

**Deliverables**:
1. LLM integration for entity extraction
2. Entity and relationship storage
3. Deduplication logic
4. Context-aware extraction

**Technical Tasks**:
- [ ] Integrate OpenAI/Azure OpenAI client
- [ ] Create entity extraction prompts (adapt from Zep)
- [ ] Implement entity storage schema
- [ ] Build deduplication algorithm
- [ ] Add relationship extraction
- [ ] Write integration tests

**Code Example**:
```typescript
// src/actors/entity-extractor.ts
export class EntityExtractor {
  constructor(private llmClient: OpenAIClient) {}
  
  async extractEntities(
    episode: Episode,
    previousEpisodes: Episode[]
  ): Promise<{ entities: Entity[], relationships: Relationship[] }> {
    const prompt = `
      Extract entities and relationships from the following message.
      
      Previous context:
      ${previousEpisodes.map(e => e.content).join('\n')}
      
      Current message:
      ${episode.content}
      
      Return JSON with:
      {
        "entities": [{ "name": "Alice", "type": "Person", "summary": "..." }],
        "relationships": [{ "source": "Alice", "target": "TechStart", "relation": "WORKS_AT", "fact": "Alice works at TechStart" }]
      }
    `;
    
    const response = await this.llmClient.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    
    const extracted = JSON.parse(response.choices[0].message.content);
    
    // Deduplicate and save
    return this.deduplicateAndSave(extracted, episode);
  }
}
```

**Demo at End of Phase 2**:
```typescript
const actor = await loom.createActor('SmartAssistant', {
  memory: { enabled: true, extractEntities: true }
});

await actor.invoke({ 
  message: "Hi, I'm Alice and I work at TechStart as a software engineer" 
});

// Internally extracts:
// Entity: { name: "Alice", type: "Person" }
// Entity: { name: "TechStart", type: "Organization" }
// Entity: { name: "Software Engineer", type: "Role" }
// Relationship: { source: "Alice", target: "TechStart", relation: "WORKS_AT" }
// Relationship: { source: "Alice", target: "Software Engineer", relation: "HAS_ROLE" }

const memory = await actor.queryMemory({ query: "What do I do for work?" });
console.log(memory.context);
// "You are a Software Engineer at TechStart"
```

### Phase 3: Temporal Reasoning (3 weeks)

**Goal**: Handle facts that change over time

**Deliverables**:
1. Temporal validity on relationships
2. Automatic fact invalidation
3. Time-based queries
4. Contradiction detection

**Technical Tasks**:
- [ ] Add temporal fields to relationship schema
- [ ] Implement fact invalidation algorithm
- [ ] Build LLM-based contradiction detector
- [ ] Create time-aware query functions
- [ ] Add temporal visualization utilities

**Code Example**:
```typescript
// src/actors/temporal-reasoning.ts
export class TemporalReasoning {
  async invalidateContradictedFacts(
    newRelationship: Relationship,
    episode: Episode
  ): Promise<Relationship[]> {
    // Find potentially contradictory relationships
    const candidates = await this.kuzuConn.query(`
      MATCH (s:Entity {uuid: $sourceId})-[r:RELATES_TO]->(t:Entity)
      WHERE r.name = $relationType
        AND (r.invalid_at IS NULL OR r.invalid_at > $now)
      RETURN r
    `, { 
      sourceId: newRelationship.source_entity_id,
      relationType: newRelationship.name,
      now: episode.valid_at 
    });
    
    // Use LLM to determine contradictions
    const contradictions = await this.llmClient.detectContradictions({
      newFact: newRelationship.fact,
      existingFacts: candidates.getAll().map(r => r.fact),
      context: episode.content
    });
    
    // Mark contradicted facts as invalid
    const invalidated: Relationship[] = [];
    for (const idx of contradictions.contradictedIndices) {
      const oldRel = candidates.getAll()[idx];
      oldRel.invalid_at = episode.valid_at;
      await this.updateRelationship(oldRel);
      invalidated.push(oldRel);
    }
    
    return invalidated;
  }
  
  async getValidRelationships(
    entityId: string,
    asOf: Date = new Date()
  ): Promise<Relationship[]> {
    const result = await this.kuzuConn.query(`
      MATCH (e:Entity {uuid: $entityId})-[r:RELATES_TO]->(t:Entity)
      WHERE (r.valid_at IS NULL OR r.valid_at <= $asOf)
        AND (r.invalid_at IS NULL OR r.invalid_at > $asOf)
      ORDER BY r.valid_at DESC
      RETURN r, t
    `, { entityId, asOf });
    
    return result.getAll();
  }
}
```

**Demo at End of Phase 3**:
```typescript
const actor = await loom.createActor('CareerTracker', {
  memory: { enabled: true, temporal: true }
});

// January
await actor.invoke({ message: "I work at Acme Corp" });
// Creates: Relationship(Alice WORKS_AT AcmeCorp, valid_at: 2025-01-15)

// March
await actor.invoke({ message: "I just started at TechStart!" });
// Creates: Relationship(Alice WORKS_AT TechStart, valid_at: 2025-03-01)
// Marks old: Relationship(Alice WORKS_AT AcmeCorp, invalid_at: 2025-03-01)

// Query current state
const current = await actor.queryMemory({ 
  query: "Where do I work?",
  asOf: new Date()
});
// Response: "You work at TechStart (since March 2025)"

// Query historical state
const past = await actor.queryMemory({ 
  query: "Where did I work in February?",
  asOf: new Date('2025-02-01')
});
// Response: "You worked at Acme Corp"
```

### Phase 4: Search & Retrieval (3 weeks)

**Goal**: Semantic search across memory graph

**Deliverables**:
1. Embedding generation for episodes/facts
2. Vector similarity search
3. Hybrid search (vector + fulltext)
4. Context composition for LLM prompts

**Technical Tasks**:
- [ ] Integrate Azure OpenAI embeddings
- [ ] Add embedding fields to schema
- [ ] Implement vector similarity search (Kuzu supports this)
- [ ] Build context composition utilities
- [ ] Create search ranking algorithm
- [ ] Add search caching

**Code Example**:
```typescript
// src/actors/memory-search.ts
export class MemorySearch {
  async search(query: string, options: SearchOptions): Promise<SearchResults> {
    // 1. Generate query embedding
    const embedding = await this.embedder.embed(query);
    
    // 2. Vector search for similar facts
    const vectorResults = await this.kuzuConn.query(`
      MATCH (r:RELATES_TO)
      WHERE r.graph_id = $graphId
        AND (r.invalid_at IS NULL OR r.invalid_at > $now)
      ORDER BY array_cosine_similarity(r.embedding, $embedding) DESC
      LIMIT $limit
      RETURN r
    `, { graphId: this.config.graphId, embedding, now: new Date(), limit: 20 });
    
    // 3. Fulltext search for keyword matches
    const fulltextResults = await this.kuzuConn.query(`
      MATCH (r:RELATES_TO)
      WHERE r.graph_id = $graphId
        AND r.fact CONTAINS $query
        AND (r.invalid_at IS NULL OR r.invalid_at > $now)
      RETURN r
      LIMIT $limit
    `, { graphId: this.config.graphId, query, now: new Date(), limit: 20 });
    
    // 4. Combine with reciprocal rank fusion
    const combined = this.reciprocalRankFusion(
      vectorResults.getAll(),
      fulltextResults.getAll()
    );
    
    // 5. Compose context string for LLM
    return this.composeContext(combined.slice(0, options.limit || 10));
  }
  
  private composeContext(results: Relationship[]): string {
    const facts = results.map(r => {
      const status = r.invalid_at ? 
        `(${r.valid_at.toLocaleDateString()} - ${r.invalid_at.toLocaleDateString()})` :
        `(since ${r.valid_at.toLocaleDateString()}, currently valid)`;
      return `- ${r.fact} ${status}`;
    }).join('\n');
    
    return `# Relevant Facts from Memory\n${facts}`;
  }
}
```

**Demo at End of Phase 4**:
```typescript
const actor = await loom.createActor('KnowledgeBot', {
  memory: { enabled: true, search: true }
});

// Build up memory
await actor.invoke({ message: "I'm vegetarian" });
await actor.invoke({ message: "I love Italian food" });
await actor.invoke({ message: "I'm allergic to shellfish" });
await actor.invoke({ message: "My favorite restaurant is Tony's Pizza" });

// Semantic search
const results = await actor.queryMemory({ 
  query: "What should I eat for dinner?" 
});

console.log(results.context);
// # Relevant Facts from Memory
// - User is vegetarian (since 2025-01-15, currently valid)
// - User loves Italian food (since 2025-01-16, currently valid)
// - User is allergic to shellfish (since 2025-01-17, currently valid)
// - User's favorite restaurant is Tony's Pizza (since 2025-01-18, currently valid)

// Actor uses this context to recommend Italian vegetarian food
```

### Phase 5: Multi-Actor Collaboration (2 weeks)

**Goal**: Shared graphs between actors

**Deliverables**:
1. Shared graph partitioning
2. Access control
3. Cross-actor queries
4. CosmosDB integration for shared graphs

**Technical Tasks**:
- [ ] Implement graph_id partitioning
- [ ] Add access control middleware
- [ ] Build shared graph management
- [ ] Integrate CosmosDB for shared graphs
- [ ] Create graph synchronization
- [ ] Add collaboration examples

**Code Example**:
```typescript
// src/actors/shared-graph-manager.ts
export class SharedGraphManager extends DurableActor {
  async createSharedGraph(graphId: string, participants: string[]): Promise<void> {
    // Store in CosmosDB for durability and cross-actor access
    await this.cosmosDB.createGraph(graphId, {
      participants,
      created_at: new Date(),
      access_policy: 'read-write'
    });
    
    // Grant access to each participant
    for (const actorId of participants) {
      await this.grantAccess(actorId, graphId);
    }
  }
  
  async addToSharedGraph(graphId: string, episode: Episode): Promise<void> {
    // Check permission
    if (!await this.hasAccess(this.actorId, graphId)) {
      throw new Error('Access denied to shared graph');
    }
    
    // Add to shared graph (goes to CosmosDB, not local Kuzu)
    await this.cosmosDB.addEpisode(graphId, episode);
    
    // Notify other participants
    await this.notifyParticipants(graphId, 'episode_added', { episodeId: episode.uuid });
  }
}
```

**Demo at End of Phase 5**:
```typescript
// Create shared project graph
await loom.createSharedGraph('project_alpha', {
  participants: ['dev_actor_1', 'qa_actor_2', 'pm_actor_3']
});

// Developer adds code review findings
const devActor = await loom.createActor('DevActor', {
  memory: { graphId: 'project_alpha' }
});
await devActor.invoke({ 
  message: "Found memory leak in server.ts line 456" 
});

// QA actor can access same memory
const qaActor = await loom.createActor('QAActor', {
  memory: { graphId: 'project_alpha' }
});
const bugs = await qaActor.queryMemory({ 
  query: "What bugs were found in code review?" 
});
// Response: "Memory leak in server.ts line 456"

// PM actor uses for sprint planning
const pmActor = await loom.createActor('PMActor', {
  memory: { graphId: 'project_alpha' }
});
const issues = await pmActor.queryMemory({ 
  query: "What critical issues need attention?" 
});
// Response: "Memory leak in server.ts line 456 (found in code review, status: open)"
```

### Phase 6: Production Hardening (2 weeks)

**Goal**: Production-ready system with monitoring, optimization, cost controls

**Deliverables**:
1. Performance optimization
2. Cost tracking and limits
3. Monitoring and observability
4. Documentation and examples
5. Migration tools

**Technical Tasks**:
- [ ] Add performance metrics
- [ ] Implement LLM cost tracking
- [ ] Build rate limiting
- [ ] Create observability dashboard
- [ ] Write comprehensive docs
- [ ] Build migration scripts
- [ ] Load testing

---

## Integration with Loom's Existing Features

### 1. Durable Actors

Memory graphs are themselves durable actors:

```typescript
export class GraphMemoryActor extends DurableActor {
  // Inherits all durability features:
  // - Journal-based persistence
  // - Automatic recovery after crashes
  // - Replay capabilities
  
  async addEpisode(episode: Episode): Promise<void> {
    // Operation is journaled automatically
    await this.journal.log('addEpisode', { episode });
    
    try {
      await this.hotMemory.add(episode);
      await this.scheduleTask('extractEntities', { episodeId: episode.uuid });
      await this.journal.commit();
    } catch (error) {
      await this.journal.rollback();
      throw error;
    }
  }
}
```

### 2. WASM Sandboxing

Custom extraction logic can run in WASM:

```typescript
class SecureMemoryActor extends GraphMemoryActor {
  async addEpisodeWithCustomExtractor(
    episode: Episode,
    extractorWasm: Uint8Array
  ): Promise<void> {
    // Run untrusted extraction logic safely
    const result = await this.wasmRuntime.execute(extractorWasm, {
      input: episode.content,
      context: await this.getRecentEpisodes(3)
    });
    
    // Validate and save extracted entities
    const validated = this.validateExtraction(result);
    await this.saveEntities(validated.entities);
    await this.saveRelationships(validated.relationships);
  }
}
```

**Use Case**: Allow users to upload custom entity extractors without compromising security

### 3. TLS Notary

Verifiable memory for compliance:

```typescript
class VerifiableMemoryActor extends GraphMemoryActor {
  async addVerifiedEpisode(
    episode: Episode,
    proof: TLSNotaryProof
  ): Promise<void> {
    // Verify TLS Notary proof
    const verified = await this.tlsNotary.verify(proof);
    if (!verified) {
      throw new Error('Invalid TLS Notary proof');
    }
    
    // Add episode with verification metadata
    episode.metadata = {
      verified: true,
      proof_hash: proof.hash,
      proof_timestamp: proof.timestamp,
      source_url: proof.url
    };
    
    await this.addEpisode(episode);
  }
  
  async auditMemory(dateRange: { from: Date, to: Date }): Promise<AuditReport> {
    // Return only episodes with valid proofs
    const episodes = await this.getEpisodes(dateRange);
    const verified = episodes.filter(e => e.metadata?.verified);
    
    return {
      total: episodes.length,
      verified: verified.length,
      proofs: verified.map(e => ({
        episodeId: e.uuid,
        proofHash: e.metadata.proof_hash,
        timestamp: e.metadata.proof_timestamp,
        sourceUrl: e.metadata.source_url
      }))
    };
  }
}
```

**Use Case**: Legal discovery, GDPR compliance, audit trails

### 4. Pipeline Execution

Memory graphs enhance pipeline actors:

```typescript
// Before: Pipeline actor has no memory of previous runs
class DataProcessingPipeline extends PipelineActor {
  async execute(input: Data): Promise<Result> {
    return this.stages.reduce((acc, stage) => stage.process(acc), input);
  }
}

// After: Pipeline learns from previous runs
class LearningPipeline extends PipelineActor {
  memory: GraphMemoryActor;
  
  async execute(input: Data): Promise<Result> {
    // Query memory for similar past inputs
    const similar = await this.memory.queryMemory({
      query: `Similar data to: ${JSON.stringify(input)}`,
      limit: 5
    });
    
    // Use learned patterns to optimize processing
    if (similar.context.includes('error')) {
      // Apply learned error handling
      return this.executeWithRetry(input);
    }
    
    const result = await this.stages.reduce((acc, stage) => stage.process(acc), input);
    
    // Store result in memory for future reference
    await this.memory.addEpisode({
      content: JSON.stringify({ input, result, success: true }),
      source: 'json'
    });
    
    return result;
  }
}
```

---

## Cost Analysis

### LLM Costs (Primary Cost Driver)

**Per Episode Processing**:
- Entity extraction: ~500 input tokens, ~100 output tokens
- Relationship extraction: ~800 input tokens, ~150 output tokens
- Deduplication: ~400 input tokens, ~50 output tokens
- Invalidation: ~300 input tokens, ~50 output tokens
- **Total per episode**: ~2000 input tokens, ~350 output tokens

**Pricing** (Azure OpenAI GPT-4):
- Input: $0.03 per 1K tokens
- Output: $0.06 per 1K tokens
- **Cost per episode**: ~$0.08

**Optimization Strategies**:
1. Use GPT-3.5-turbo for non-critical tasks: **$0.02 per episode** (75% cost reduction)
2. Batch processing: Reduce overhead by 30%
3. Caching: Skip extraction for duplicate/similar episodes
4. Selective extraction: Only extract on "interesting" episodes

**Real-World Cost Examples**:

| Use Case | Episodes/Day | Monthly Cost (GPT-4) | Monthly Cost (GPT-3.5) |
|----------|--------------|---------------------|----------------------|
| Personal Assistant | 50 | $120 | $30 |
| Customer Support (single agent) | 500 | $1,200 | $300 |
| Enterprise (10 agents) | 5,000 | $12,000 | $3,000 |
| Large Scale (100 agents) | 50,000 | $120,000 | $30,000 |

**Cost Controls**:
```typescript
interface MemoryConfig {
  budget?: {
    maxCostPerDay: number;      // e.g., $10
    maxEpisodesPerDay: number;  // e.g., 100
    modelTier: 'premium' | 'standard' | 'economy';  // GPT-4 vs GPT-3.5
  };
}
```

### Storage Costs

**Kuzu**: Free (in-memory, no persistent storage cost)

**CosmosDB Gremlin**:
- Request Units: ~10 RU per simple query, ~50 RU per complex query
- Storage: $0.25 per GB/month
- Typical usage: 10MB per 1000 episodes = $2.50 per million episodes

**Total Monthly Cost Example** (100 agents, 50K episodes/day):
- LLM (GPT-3.5): $30,000
- CosmosDB storage (50K * 30 * 0.01MB = 15GB): $3.75
- CosmosDB queries (~1M queries/month at 10 RU each): $50
- **Total: ~$30,054/month** for 1.5M episodes processed

---

## Success Metrics

### Technical Metrics
- **Query Latency**: <50ms P95 (hot memory), <200ms P95 (cold storage)
- **Extraction Accuracy**: >80% entity precision, >75% relationship precision
- **Temporal Accuracy**: >90% correct invalidation decisions
- **Search Relevance**: >80% user satisfaction with search results

### Business Metrics
- **Cost per Episode**: <$0.05 (including LLM + storage)
- **Adoption Rate**: >30% of Loom actors use memory within 6 months
- **Retention**: Users with memory-enabled actors have 3x longer sessions
- **Monetization**: Memory features enable $50-200/month premium tier

### Competitive Metrics
- **vs Zep Cloud**: Match performance, 50% lower cost (self-hosted)
- **vs Supermemory**: 5x better multi-user support, temporal reasoning
- **vs LangChain Memory**: 10x faster queries, automatic extraction
- **Unique**: Only solution with verifiable memory (TLS Notary) + WASM sandboxing

---

## Risks and Mitigation

### Risk 1: LLM Extraction Quality
**Risk**: Entities/relationships extracted incorrectly (e.g., "Alice" vs "Alice Smith")

**Mitigation**:
- Use high-quality models (GPT-4) for initial extraction
- Implement human-in-the-loop validation for critical domains
- Build feedback mechanism to improve prompts
- Provide manual override capabilities

### Risk 2: Cost Overruns
**Risk**: LLM costs spiral out of control at scale

**Mitigation**:
- Implement hard budget limits per actor/graph
- Use cheaper models for non-critical tasks
- Cache aggressively
- Provide cost dashboard and alerts
- Allow users to disable expensive features

### Risk 3: Temporal Reasoning Complexity
**Risk**: Invalidation logic makes mistakes (marks valid facts as invalid)

**Mitigation**:
- Conservative invalidation (only mark invalid with high confidence)
- Soft deletes (facts marked invalid but not removed)
- Audit trail for all invalidation decisions
- Allow users to restore incorrectly invalidated facts

### Risk 4: Performance at Scale
**Risk**: Queries slow down with large graphs (millions of facts)

**Mitigation**:
- Two-tier storage (hot/cold)
- Aggressive caching
- Query result pagination
- Graph pruning (archive old, irrelevant facts)
- Horizontal scaling (partition graphs across multiple actors)

### Risk 5: Privacy and Security
**Risk**: Shared graphs leak sensitive information between actors

**Mitigation**:
- Strict access control on shared graphs
- Audit logging for all graph access
- Encryption at rest and in transit
- GDPR-compliant deletion (cascade delete all related facts)
- User consent for shared graphs

---

## Go/No-Go Decision Framework

### GREEN LIGHTS (Proceed with Implementation)
- ✅ Clear use cases with measurable value
- ✅ Technical feasibility validated (Kuzu + CosmosDB work)
- ✅ Cost model is sustainable (<$0.05 per episode)
- ✅ Competitive differentiation (verifiable memory, WASM sandboxing)
- ✅ Integrates well with existing Loom features
- ✅ 12-16 week timeline is acceptable

### YELLOW LIGHTS (Proceed with Caution)
- ⚠️ LLM costs could be high for large-scale usage → **Mitigation**: Cost controls, cheaper models
- ⚠️ Temporal reasoning is complex → **Mitigation**: Start simple, iterate based on feedback
- ⚠️ CosmosDB Gremlin is less proven than Neo4j → **Mitigation**: Test early, have Kuzu fallback

### RED LIGHTS (Do Not Proceed)
- ❌ Unable to achieve <200ms query latency
- ❌ LLM extraction accuracy <60%
- ❌ Cost per episode >$0.10
- ❌ No clear user demand/use cases

**Current Assessment**: **GREEN** - Proceed with implementation

---

## Next Steps

### Immediate (This Week)
1. **Prototype Kuzu integration** (1-2 days)
   - Install Kuzu npm package
   - Create basic schema
   - Test episode storage and retrieval
   
2. **Cost validation** (1 day)
   - Run test extraction on 100 sample episodes
   - Measure actual token usage
   - Validate cost model

3. **User research** (2 days)
   - Interview 5-10 potential users
   - Validate use cases
   - Prioritize features

### Month 1 (Phase 1)
- Set up project structure
- Build GraphMemoryActor foundation
- Integrate Kuzu
- Create basic tests and documentation
- Demo: Basic episode add/retrieve

### Month 2 (Phase 2)
- Integrate OpenAI for entity extraction
- Build deduplication logic
- Create relationship storage
- Demo: Automatic entity extraction from conversations

### Month 3 (Phase 3-4)
- Implement temporal reasoning
- Build search and retrieval
- Add embedding generation
- Demo: Time-aware facts and semantic search

### Month 4 (Phase 5-6)
- Add multi-actor collaboration
- Integrate CosmosDB
- Production hardening
- Launch beta

---

## Conclusion

Memory graphs are a **game-changer** for Loom:

1. **Clear Value**: Solves real problems (agent amnesia, no collaboration, can't handle changing facts)
2. **Proven Architecture**: Based on Zep's production system (<200ms latency, 80% accuracy)
3. **Competitive Moat**: Only solution with verifiable memory + WASM sandboxing
4. **Integrates Naturally**: Works seamlessly with durable actors, pipelines, TLS Notary
5. **Sustainable Economics**: <$0.05 per episode, with cost controls
6. **Reasonable Timeline**: 12-16 weeks to production

**Recommendation: PROCEED with implementation**

Let's start with Phase 1 prototype (Kuzu integration + basic episode storage) to validate technical approach and cost model.
