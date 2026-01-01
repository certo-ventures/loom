# Zep Comprehensive Deep Dive Review and Implementation Analysis

## Executive Summary

After extensive analysis of Zep's architecture, implementation patterns, and competitive positioning, I recommend **implementing a Zep-inspired memory system with CosmosDB Gremlin for Loom**. This approach combines Zep's proven architectural patterns with Loom's unique strengths (durable actors, WASM sandboxing, verifiable compute) to create a market-leading solution.

**Key Decision Factors:**
- **✅ IMPLEMENT**: Temporal knowledge graph architecture
- **✅ IMPLEMENT**: Graph-based memory with automatic entity/relationship extraction
- **✅ IMPLEMENT**: Multi-user collaboration via shared graphs
- **⚠️ ADAPT**: Use CosmosDB Gremlin instead of Zep's native graph DB
- **⚠️ ADAPT**: Integrate with Loom's durable actor model (not Zep's session model)
- **❌ SKIP**: Zep's specific Python/Go implementation (use TypeScript for Loom)

---

## 1. Zep Architecture Deep Dive

### 1.1 Core Components

#### **Graphiti - The Knowledge Graph Engine**
Zep is powered by [Graphiti](https://github.com/getzep/graphiti), an open-source temporal knowledge graph framework.

```python
# Core architecture from graphiti_core/graphiti.py
class Graphiti:
    def __init__(self, driver: GraphDriver, llm_client: LLMClient, embedder: EmbedderClient):
        self.driver = driver  # Graph database driver (Neo4j, etc.)
        self.llm_client = llm_client  # LLM for entity extraction
        self.embedder = embedder  # Embedding model for semantic search
```

**Key Architectural Principles:**
1. **Native Graph Storage**: Uses graph databases (Neo4j, Neptune, etc.) - not simulated like supermemory
2. **Temporal Validity**: Every fact has `valid_at`, `invalid_at`, `expired_at` timestamps
3. **Automatic Extraction**: LLM-powered entity and relationship detection
4. **Embedding-based Search**: Vector embeddings for semantic retrieval

### 1.2 Data Model

#### **Three Core Node Types:**

```typescript
// EpisodicNode - Raw conversation/data snapshots
interface EpisodicNode {
  uuid: string;
  content: string;           // Original message/data
  source: 'message' | 'json' | 'text';
  created_at: DateTime;
  valid_at: DateTime;
  group_id: string;          // Partition key for multi-tenancy
  entity_edges: string[];    // References to extracted entities
}

// EntityNode - Extracted entities (people, places, concepts)
interface EntityNode {
  uuid: string;
  name: string;
  summary: string;
  labels: string[];          // Entity types: ['Person', 'Organization', etc.]
  created_at: DateTime;
  group_id: string;
}

// EntityEdge - Relationships between entities (THE KEY INSIGHT)
interface EntityEdge {
  uuid: string;
  source_node_uuid: string;
  target_node_uuid: string;
  name: string;              // Relationship type
  fact: string;              // "Alice works at Acme Corp"
  episodes: string[];        // Episode UUIDs that support this fact
  created_at: DateTime;
  valid_at: DateTime | null;
  invalid_at: DateTime | null;
  expired_at: DateTime | null;
  fact_embedding: number[];  // For semantic search
}
```

#### **Critical Design Insight:**
The `EntityEdge.episodes` array is the bridge between raw episodes and extracted knowledge. When episodes are deleted, edges with no supporting episodes can be cleaned up.

### 1.3 Processing Pipeline

```
┌─────────────┐
│  Episode    │
│  Added      │
└──────┬──────┘
       │
       ▼
┌─────────────────────────┐
│ 1. Retrieve Previous    │  ← Get last N episodes for context
│    Episodes (Context)   │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ 2. Extract Entities     │  ← LLM extracts people, places, concepts
│    (EntityNode)         │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ 3. Deduplicate Nodes    │  ← Resolve "Alice" vs "Alice Smith"
│    (Similarity Check)   │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ 4. Extract Edges        │  ← LLM extracts relationships
│    (EntityEdge)         │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ 5. Deduplicate Edges    │  ← Check for duplicate/contradictory facts
│    (LLM Reasoning)      │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ 6. Invalidate Old Edges │  ← Mark contradicted facts as invalid
│    (Temporal Reasoning) │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ 7. Generate Embeddings  │  ← Vector embeddings for search
│    (Semantic Search)    │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ 8. Save to Graph DB     │  ← Persist to Neo4j/Neptune
└─────────────────────────┘
```

**Key Implementation from `graphiti_core/graphiti.py`:**

```python
async def add_episode(
    self,
    episode_body: str,
    reference_time: datetime,
    source: EpisodeType = EpisodeType.message,
    group_id: str | None = None,
):
    # 1. Retrieve context
    previous_episodes = await self.retrieve_episodes(
        reference_time, last_n=RELEVANT_SCHEMA_LIMIT, group_ids=[group_id]
    )
    
    # 2. Extract and resolve entities
    extracted_nodes, uuid_map, extracted_edges = await self._extract_and_dedupe_nodes(
        episode, previous_episodes, entity_types, excluded_entity_types
    )
    
    # 3. Extract and resolve edges
    entity_edges, invalidated_edges = await self._extract_and_resolve_edges(
        episode, extracted_nodes, previous_episodes, edge_type_map, group_id
    )
    
    # 4. Save everything
    await add_nodes_and_edges_bulk(
        self.driver, [episode], episodic_edges, nodes, entity_edges, self.embedder
    )
```

---

## 2. Critical Implementation Details

### 2.1 Temporal Reasoning (THE KILLER FEATURE)

**Problem**: How do you handle conflicting information over time?
- "Alice works at Acme Corp" (Jan 2024)
- "Alice now works at TechStart" (March 2024)

**Zep's Solution**: Temporal validity on edges

```python
# From graphiti_core/edges.py
class EntityEdge(Edge):
    valid_at: datetime | None      # When fact became true
    invalid_at: datetime | None    # When fact stopped being true
    expired_at: datetime | None    # When fact was superseded
```

**How it works:**
1. New episode arrives: "Alice works at TechStart"
2. LLM extracts new edge with `valid_at = March 2024`
3. System searches for contradictory edges
4. Finds old edge "Alice works at Acme Corp"
5. LLM reasons about contradiction
6. Marks old edge with `invalid_at = March 2024`

**Implementation from `graphiti_core/prompts/invalidate_edges.py`:**

```python
def v1(context: dict[str, Any]) -> list[Message]:
    return [
        Message(role='system', content='Determine which relationships should be invalidated...'),
        Message(role='user', content=f"""
            Based on provided edges and timestamps, determine which should be expired.
            Only mark invalid if there is CLEAR EVIDENCE the relationship is no longer true.
            
            Existing Edges: {context['existing_edges']}
            New Edge: {context['new_edge']}
        """)
    ]
```

### 2.2 Entity Extraction with LLM

**From `graphiti_core/prompts/extract_nodes.py`:**

```python
def node(context: dict[str, Any]) -> list[Message]:
    return [
        Message(role='system', content='Extract entities from text...'),
        Message(role='user', content=f"""
            <ENTITY_TYPES>
            {context['entity_types']}  # User-defined ontology
            </ENTITY_TYPES>
            
            <PREVIOUS_MESSAGES>
            {context['previous_episodes']}  # Context from prior episodes
            </PREVIOUS_MESSAGES>
            
            <CURRENT_MESSAGE>
            {context['episode_content']}
            </CURRENT_MESSAGE>
            
            Extract all entities, resolve references, deduplicate.
        """)
    ]
```

**Key Insight**: Context matters! Previous episodes help resolve ambiguous references ("she" → "Alice").

### 2.3 Edge Deduplication (Complex!)

**From `graphiti_core/utils/maintenance/edge_operations.py`:**

```python
async def resolve_extracted_edge(
    llm_client: LLMClient,
    extracted_edge: EntityEdge,
    related_edges: list[EntityEdge],  # Edges about same entities
    existing_edges: list[EntityEdge], # All edges (for contradiction check)
    episode: EpisodicNode,
) -> tuple[EntityEdge, list[EntityEdge], list[EntityEdge]]:
    # If edge is exact duplicate, append episode UUID and return
    for existing in related_edges:
        if _normalize_string_exact(extracted_edge.fact) == _normalize_string_exact(existing.fact):
            existing.episodes.append(episode.uuid)
            return existing, [], []
    
    # Use LLM to check for duplicates and contradictions
    response = await llm_client.generate_response(
        prompt_library.dedupe_edges.v1({
            'existing_edges': related_edges,
            'new_edge': extracted_edge.fact,
            'edge_invalidation_candidates': existing_edges
        }),
        response_model=EdgeDuplicate
    )
    
    # Handle duplicates
    if response.duplicate_facts:
        resolved_edge = related_edges[response.duplicate_facts[0]]
        resolved_edge.episodes.append(episode.uuid)
        return resolved_edge, [], []
    
    # Handle contradictions
    contradicted_edges = [existing_edges[i] for i in response.contradicted_facts]
    for edge in contradicted_edges:
        edge.invalid_at = episode.valid_at
    
    return extracted_edge, [], contradicted_edges
```

**Why This Matters**: 
- Prevents duplicate facts: "Alice works at Acme" vs "Alice is employed by Acme Corp"
- Handles contradictions automatically
- Maintains episode provenance

### 2.4 Search Implementation

**Hybrid Search Strategy** (from `graphiti_core/search/search_utils.py`):

```python
async def edge_hybrid_search(
    driver: GraphDriver,
    query: str,
    embedder: EmbedderClient,
    group_ids: list[str] | None,
    limit: int = 20
) -> list[EntityEdge]:
    # 1. Vector search (semantic)
    query_embedding = await embedder.create_embeddings([query])
    vector_results = await edge_vector_search(driver, query_embedding, group_ids, limit)
    
    # 2. Fulltext search (keyword)
    fulltext_results = await edge_fulltext_search(driver, query, group_ids, limit)
    
    # 3. Combine with RRF (Reciprocal Rank Fusion)
    combined_results = rrf_fuse(vector_results, fulltext_results, k=60)
    
    return combined_results
```

**Retrieval Modes**:
1. **Edges (Facts)**: "Alice works at Acme Corp"
2. **Nodes (Entities)**: "Alice", "Acme Corp"
3. **Episodes**: Raw conversation snippets

### 2.5 Context Assembly

**From integration examples (`zep_livekit/agent.py`):**

```python
# Parallel search across scopes
results = await asyncio.gather(
    graph.search(scope="edges", limit=facts_limit),    # Get facts
    graph.search(scope="nodes", limit=entity_limit),   # Get entities
    graph.search(scope="episodes", limit=episode_limit) # Get raw episodes
)

# Compose into formatted context block
from zep_cloud.graph.utils import compose_context_string
context = compose_context_string(
    results[0].edges,
    results[1].nodes,
    results[2].episodes
)
```

**Context Format** (from `zep-eval-harness/zep_evaluate.py`):

```
# These are the most relevant facts
# Facts ending in "present" are currently valid
# Facts with a past end date are NO LONGER VALID.
<FACTS>
- Alice works at TechStart (2024-03-01 - present)
- Alice worked at Acme Corp (2024-01-01 - 2024-02-28)
</FACTS>

# These are the most relevant entities
<ENTITIES>
- Alice: Software Engineer with 5 years experience
- TechStart: AI startup founded in 2023
</ENTITIES>

# Recent conversation snippets
<EPISODES>
- [2024-03-15] Alice: "I just started at TechStart last month"
</EPISODES>
```

---

## 3. Multi-User Collaboration Analysis

### 3.1 Graph Partitioning Strategy

**Two Modes**:

1. **User Graph** (`user_id` based):
```python
# User-specific graph
await client.graph.add(
    user_id="alice_123",
    type="text",
    data="I prefer dark mode"
)
```

2. **Shared Graph** (`graph_id` based):
```python
# Company-wide knowledge graph
await client.graph.add(
    graph_id="company_knowledge",
    type="text",
    data="Q4 revenue targets are $10M"
)
```

**Implementation from `graphiti_core/nodes.py`:**

```python
class Node(BaseModel):
    uuid: str
    group_id: str  # Acts as partition key
    created_at: datetime
    
class EpisodicNode(Node):
    source: EpisodeType  # 'message', 'json', 'text'
```

### 3.2 Access Control

**Current State**: Zep uses `group_id` for partitioning but access control is application-level.

**From code analysis**:
- No built-in ACL system in Graphiti
- SOC2/HIPAA compliance at infrastructure layer
- Application must enforce access rules

**For Loom**: Need to design actor-level access control

---

## 4. Performance Characteristics

### 4.1 Benchmarked Performance

**From LoCoMo Benchmark** (Zep marketing page):
- **Retrieval Latency**: <200ms P95
- **Accuracy**: 80.32% on LoCoMo benchmark
- **Context Assembly**: <100ms for typical queries

### 4.2 Scalability Patterns

**From `graphiti_core/utils/bulk_utils.py`:**

```python
async def add_episode_bulk(
    self, 
    bulk_episodes: list[RawEpisode]
) -> AddBulkEpisodeResults:
    """Process multiple episodes efficiently with batching"""
    # 1. Save all episodes first
    await add_nodes_and_edges_bulk(driver, episodes, ...)
    
    # 2. Extract in parallel with semaphore
    results = await semaphore_gather(*extraction_tasks, max_coroutines=10)
    
    # 3. Deduplicate
    resolved_nodes = await dedupe_nodes_bulk(...)
    
    # 4. Save in batch
    await add_nodes_and_edges_bulk(driver, nodes, edges, embedder)
```

**Key Optimizations**:
- Semaphore-controlled parallelism
- Batch database writes
- Async embedding generation
- Connection pooling

---

## 5. Integration Patterns

### 5.1 Framework Integrations

Zep provides first-class integrations for:

1. **AutoGen** (`zep_autogen/`):
```python
from zep_autogen import ZepGraphMemory

memory = ZepGraphMemory(
    client=zep_client,
    graph_id="agent_knowledge",
    facts_limit=20,
    entity_limit=5
)

agent = AssistantAgent(
    name="ResearchAgent",
    memory=[memory]  # Automatic context injection
)
```

2. **CrewAI** (`zep_crewai/`):
```python
from zep_crewai import ZepGraphStorage

graph_storage = ZepGraphStorage(
    client=zep_client,
    graph_id="crew_knowledge",
    search_filters=SearchFilters(node_labels=["Technology", "Project"])
)

crew = Crew(
    agents=[...],
    external_memory=ExternalMemory(storage=graph_storage)
)
```

3. **LiveKit** (`zep_livekit/`):
```python
from zep_livekit import ZepGraphAgent

agent = ZepGraphAgent(
    zep_client=zep_client,
    graph_id="voice_assistant",
    facts_limit=15,
    entity_limit=5,
    instructions="You have access to persistent memory..."
)
```

### 5.2 Integration Architecture Pattern

**Common Pattern Across Integrations**:

```python
class ZepMemoryAdapter:
    async def add(self, content: MemoryContent):
        """Store content in Zep graph"""
        await self.client.graph.add(
            graph_id=self.graph_id,
            type="message" if content.metadata['type'] == 'message' else "text",
            data=str(content.content)
        )
    
    async def search(self, query: str) -> list[MemoryContent]:
        """Retrieve relevant context"""
        results = await asyncio.gather(
            self.client.graph.search(graph_id=self.graph_id, query=query, scope="edges"),
            self.client.graph.search(graph_id=self.graph_id, query=query, scope="nodes")
        )
        
        # Compose context string
        context = compose_context_string(results[0].edges, results[1].nodes, [])
        return [MemoryContent(content=context, ...)]
```

---

## 6. Critical Analysis: Should Loom Implement This?

### 6.1 ✅ Strong Reasons TO Implement

#### **1. Proven Architecture**
- **Production-ready**: SOC2 Type 2, HIPAA compliant
- **Benchmarked performance**: <200ms retrieval, 80% accuracy
- **Active development**: Backed by Zep team, regular updates

#### **2. Temporal Reasoning Solves Real Problems**
```
Without temporal validity:
Agent: "Where does Alice work?"
System: Returns both "Acme Corp" and "TechStart" (confusing!)

With temporal validity:
Agent: "Where does Alice work?"
System: "TechStart (current)" + context "Previously worked at Acme Corp"
```

#### **3. Automatic Entity Extraction**
No manual tagging required:
```python
# Input: Natural conversation
"Alice just started at TechStart as a Senior Engineer. 
 She previously worked at Acme Corp for 3 years."

# Output: Automatic extraction
Entities:
  - Alice (Person)
  - TechStart (Organization)
  - Acme Corp (Organization)
  - Senior Engineer (Role)

Edges:
  - Alice WORKS_AT TechStart (valid_at: today)
  - Alice WORKED_AT Acme Corp (invalid_at: today)
  - Alice HAS_ROLE Senior Engineer
```

#### **4. Multi-Actor Collaboration**
Unlike supermemory (single-user only), Zep supports:
- Shared knowledge graphs
- User-specific contexts
- Thread-based memory
- Graph-based memory

#### **5. Framework-Agnostic**
Integration patterns work across:
- AutoGen, CrewAI, LangGraph, LiveKit
- Easy to adapt for Loom's actor model

### 6.2 ⚠️ Challenges & Mitigations

#### **Challenge 1: LLM-Heavy Processing**
**Problem**: Every episode triggers 4-6 LLM calls:
1. Extract entities
2. Extract relationships
3. Deduplicate entities
4. Deduplicate relationships
5. Invalidate contradictions
6. Extract temporal information

**Mitigation for Loom**:
```typescript
// Actor-based async processing
class MemoryProcessorActor extends DurableActor {
  async processEpisode(episode: Episode) {
    // Queue LLM tasks as sub-actors
    const [entities, edges] = await Promise.all([
      this.spawnSubActor('EntityExtractor', episode),
      this.spawnSubActor('EdgeExtractor', episode)
    ]);
    
    // Continue processing in background
    this.scheduleTask('deduplicate', { entities, edges });
  }
}
```

#### **Challenge 2: Graph Database Dependency**
**Problem**: Zep requires Neo4j/Neptune/FalkorDB

**Mitigation for Loom**: CosmosDB Gremlin API
```typescript
// CosmosDB Gremlin supports temporal queries
g.V().has('group_id', actorId)
  .outE('RELATES_TO')
  .has('valid_at', lte(currentTime))
  .where(
    or(
      not(has('invalid_at')),
      has('invalid_at', gt(currentTime))
    )
  )
  .order().by('valid_at', desc)
  .limit(20)
```

#### **Challenge 3: Embedding Storage**
**Problem**: Vector embeddings are large (1536 dimensions x 4 bytes = 6KB per edge)

**Mitigation for Loom**:
```typescript
// Store embeddings separately in Azure AI Search
interface EntityEdge {
  uuid: string;
  fact: string;
  embedding_ref: string;  // Reference to Azure AI Search document
}

// Lazy load embeddings only when needed
async getEmbedding(edge: EntityEdge): Promise<number[]> {
  return await this.aiSearchClient.getDocument(edge.embedding_ref);
}
```

#### **Challenge 4: Cost of LLM Calls**
**Rough Estimate** (per episode):
- Entity extraction: ~500 tokens
- Edge extraction: ~800 tokens
- Deduplication: ~400 tokens
- Invalidation: ~300 tokens
- **Total**: ~2000 tokens input + 500 tokens output = **$0.01-0.05 per episode** at GPT-4 prices

**Mitigation**:
1. Use cheaper models (GPT-3.5-turbo) for extraction
2. Batch episodes for bulk processing
3. Cache extraction results
4. Optional: User can disable features (no temporal reasoning = 50% cost reduction)

### 6.3 ❌ What NOT to Implement

#### **1. Zep's Session Model**
**Zep**: Uses threads/sessions tied to conversations
```python
await client.thread.create(thread_id="chat_123", user_id="alice")
await client.thread.add_messages(thread_id="chat_123", messages=[...])
```

**Loom Should Use**: Actor-based memory
```typescript
// Each actor has its own memory graph partition
class ConversationActor extends DurableActor {
  async addMessage(message: string) {
    await this.graphMemory.addEpisode({
      content: message,
      group_id: this.actorId,  // Actor ID = partition key
      source: 'message'
    });
  }
}
```

#### **2. Zep's Python/Go Stack**
**Loom Should Use**: TypeScript throughout
- Consistency with existing codebase
- Type safety
- Better IDE support

#### **3. Zep's Ontology System (Initially)**
**Zep** has complex entity type definitions:
```python
class TechnologyEntity(EntityModel):
    name: EntityText = Field(description="Name of the technology")
    category: EntityText = Field(description="Category (language, framework, etc.)")
    use_case: EntityText = Field(description="Primary use case")
```

**Loom Should Start With**: Simple, flexible model
```typescript
// Start simple, add ontology later
interface Entity {
  uuid: string;
  name: string;
  labels: string[];  // Simple string labels
  attributes: Record<string, any>;  // Flexible attributes
}
```

---

## 7. Recommended Implementation Strategy for Loom

### Phase 1: Foundation (2-3 weeks)

#### **CosmosDB Gremlin Schema**
```typescript
// Vertex types
type EpisodeVertex = {
  label: 'Episode';
  id: string;
  partition: string;  // actor_id
  content: string;
  source: 'message' | 'json' | 'text';
  created_at: string;
  valid_at: string;
};

type EntityVertex = {
  label: 'Entity';
  id: string;
  partition: string;
  name: string;
  summary: string;
  entity_type: string[];
};

// Edge types
type MentionsEdge = {
  label: 'MENTIONS';
  from: string;  // Episode ID
  to: string;    // Entity ID
};

type RelatesTo Edge = {
  label: 'RELATES_TO';
  from: string;  // Entity ID
  to: string;    // Entity ID
  fact: string;
  valid_at?: string;
  invalid_at?: string;
  expired_at?: string;
  episodes: string[];  // Episode IDs
};
```

#### **Core Actor: GraphMemoryActor**
```typescript
class GraphMemoryActor extends DurableActor {
  private cosmosClient: CosmosClient;
  private llmClient: OpenAIClient;
  private embedder: AzureOpenAIEmbedder;
  
  async addEpisode(episode: {
    content: string;
    source: 'message' | 'json' | 'text';
    reference_time: Date;
  }): Promise<void> {
    // 1. Save episode to graph
    const episodeId = await this.saveEpisode(episode);
    
    // 2. Schedule background extraction
    await this.scheduleTask('extractEntities', { episodeId });
  }
  
  private async extractEntities(episodeId: string): Promise<void> {
    // Get episode + context
    const episode = await this.getEpisode(episodeId);
    const previousEpisodes = await this.getPreviousEpisodes(3);
    
    // Extract with LLM
    const entities = await this.llmClient.extractEntities({
      currentMessage: episode.content,
      previousMessages: previousEpisodes.map(e => e.content)
    });
    
    // Save and deduplicate
    await this.saveAndDedupeEntities(entities, episodeId);
    
    // Schedule edge extraction
    await this.scheduleTask('extractEdges', { episodeId });
  }
}
```

### Phase 2: Temporal Reasoning (3-4 weeks)

#### **Implement Fact Invalidation**
```typescript
class FactInvalidationActor extends DurableActor {
  async invalidateContradictedFacts(
    newEdge: EntityEdge,
    episode: Episode
  ): Promise<EntityEdge[]> {
    // 1. Find potentially contradictory edges
    const candidates = await this.cosmosClient.query(
      `g.V('${newEdge.source_id}')
         .outE('RELATES_TO')
         .has('name', '${newEdge.name}')
         .where(
           or(
             not(has('invalid_at')),
             has('invalid_at', gt('${episode.valid_at}'))
           )
         )`
    );
    
    // 2. Use LLM to reason about contradictions
    const response = await this.llmClient.reasonAboutContradictions({
      newFact: newEdge.fact,
      existingFacts: candidates.map(e => e.fact),
      context: episode.content
    });
    
    // 3. Mark contradicted facts as invalid
    const invalidated = [];
    for (const idx of response.contradicted_fact_indices) {
      const edge = candidates[idx];
      edge.invalid_at = episode.valid_at;
      await this.cosmosClient.updateEdge(edge);
      invalidated.push(edge);
    }
    
    return invalidated;
  }
}
```

### Phase 3: Search & Retrieval (2-3 weeks)

#### **Hybrid Search Implementation**
```typescript
class GraphSearchActor extends DurableActor {
  async search(query: {
    text: string;
    scope: 'edges' | 'nodes' | 'episodes';
    limit: number;
  }): Promise<SearchResults> {
    // 1. Generate query embedding
    const embedding = await this.embedder.embed(query.text);
    
    // 2. Parallel search: vector + fulltext
    const [vectorResults, fulltextResults] = await Promise.all([
      this.azureAISearch.vectorSearch({
        embedding,
        top: query.limit,
        filter: `partition eq '${this.actorId}'`
      }),
      this.cosmosClient.fulltextSearch({
        query: query.text,
        partition: this.actorId,
        limit: query.limit
      })
    ]);
    
    // 3. Combine with RRF
    const combined = this.reciprocalRankFusion(vectorResults, fulltextResults);
    
    // 4. Load temporal context
    return this.enrichWithTemporalContext(combined);
  }
  
  private async enrichWithTemporalContext(results: any[]): Promise<SearchResults> {
    // Filter out invalid facts
    const currentTime = new Date();
    return results.filter(r => {
      if (!r.valid_at) return true;
      if (r.valid_at > currentTime) return false;
      if (r.invalid_at && r.invalid_at <= currentTime) return false;
      return true;
    });
  }
}
```

### Phase 4: Multi-Actor Collaboration (3-4 weeks)

#### **Shared Graph Support**
```typescript
class SharedGraphManager extends DurableActor {
  async createSharedGraph(graphId: string, participants: string[]): Promise<void> {
    // Create graph partition
    await this.cosmosClient.createPartition(graphId);
    
    // Grant access to actors
    for (const actorId of participants) {
      await this.grantAccess(actorId, graphId);
    }
  }
  
  async addToSharedGraph(graphId: string, episode: Episode): Promise<void> {
    // Check permissions
    if (!await this.hasAccess(this.actorId, graphId)) {
      throw new Error('Access denied');
    }
    
    // Add episode with graph_id as partition key
    await this.graphMemory.addEpisode({
      ...episode,
      group_id: graphId
    });
  }
}
```

---

## 8. Competitive Advantage for Loom

By implementing Zep-style memory with Loom's unique features:

### **1. Verifiable Memory with TLS Notary**
```typescript
class VerifiableMemoryActor extends GraphMemoryActor {
  async addVerifiedEpisode(episode: Episode, proof: TLSNotaryProof): Promise<void> {
    // Verify proof first
    const verified = await this.tlsNotary.verify(proof);
    if (!verified) throw new Error('Invalid proof');
    
    // Add episode with verification metadata
    await this.addEpisode({
      ...episode,
      metadata: {
        verified: true,
        proof_hash: proof.hash,
        timestamp: proof.timestamp
      }
    });
  }
}
```

**Use Case**: Legal/compliance applications where memory provenance matters

### **2. WASM-Sandboxed Memory Processing**
```typescript
class WASMMemoryProcessor extends DurableActor {
  async processEpisodeInWASM(episode: Episode): Promise<void> {
    // Run untrusted extraction logic in WASM sandbox
    const result = await this.wasmRuntime.execute('entity_extractor.wasm', {
      episode: episode.content,
      context: await this.getPreviousEpisodes(3)
    });
    
    // Safely integrate results
    await this.saveExtractedEntities(result.entities);
  }
}
```

**Use Case**: Allow custom extraction logic from third parties without security risk

### **3. Durable Memory Operations**
```typescript
// Memory operations are journaled and recoverable
class DurableGraphMemoryActor extends GraphMemoryActor {
  async addEpisode(episode: Episode): Promise<void> {
    // Operation is logged to journal automatically
    await this.journal.log('addEpisode', { episode });
    
    try {
      await super.addEpisode(episode);
      await this.journal.commit();
    } catch (error) {
      await this.journal.rollback();
      throw error;
    }
  }
  
  async recover(): Promise<void> {
    // Replay journal after crash
    const uncommittedOps = await this.journal.getUncommitted();
    for (const op of uncommittedOps) {
      await this.execute(op);
    }
  }
}
```

**Use Case**: Guaranteed memory consistency even after system failures

### **4. Cost-Optimized Processing**
```typescript
// Loom can dynamically choose LLM based on cost/quality trade-offs
class AdaptiveMemoryActor extends GraphMemoryActor {
  async addEpisode(episode: Episode, options: { budget?: number }): Promise<void> {
    const llmConfig = this.chooseLLM(options.budget);
    
    // Use GPT-4 for critical extraction, GPT-3.5 for simple deduplication
    const entities = await llmConfig.premium.extractEntities(episode);
    const deduped = await llmConfig.economy.deduplicate(entities);
    
    await this.saveEntities(deduped);
  }
}
```

---

## 9. Technical Risks & Mitigation

### Risk 1: CosmosDB Gremlin Limitations
**Risk**: CosmosDB Gremlin may not support all Neo4j features

**Mitigation**:
- Test Gremlin API capabilities early (Week 1)
- Have fallback plan: Azure SQL Graph Tables
- Document feature gaps

### Risk 2: LLM Cost Explosion
**Risk**: Processing millions of episodes = huge LLM costs

**Mitigation**:
- Implement rate limiting per actor
- Use smaller models for non-critical tasks
- Cache extraction results aggressively
- Provide cost controls in UI

### Risk 3: Temporal Reasoning Complexity
**Risk**: Handling time-based facts is hard

**Mitigation**:
- Start with simple "valid until" model
- Add full temporal reasoning in Phase 2
- Use Zep's prompts as reference

### Risk 4: Search Performance
**Risk**: Graph queries may be slow at scale

**Mitigation**:
- Use CosmosDB partition keys correctly
- Implement caching layer (Redis)
- Benchmark early and optimize
- Consider read replicas for search

---

## 10. Final Recommendation

### ✅ IMPLEMENT Zep-Style Memory for Loom

**Core Value Propositions:**
1. **Temporal knowledge graphs** solve real problems (conflicting facts, evolving relationships)
2. **Automatic entity extraction** reduces manual work
3. **Multi-actor collaboration** enables shared memory
4. **Proven architecture** with production deployments

**Loom's Differentiators:**
1. **Verifiable memory** with TLS Notary proofs
2. **Durable operations** with journal-based recovery
3. **WASM sandboxing** for custom extraction
4. **Actor-based partitioning** for natural multi-tenancy

**Implementation Timeline:**
- **Phase 1** (2-3 weeks): CosmosDB schema + basic actor
- **Phase 2** (3-4 weeks): Temporal reasoning + invalidation
- **Phase 3** (2-3 weeks): Search & retrieval
- **Phase 4** (3-4 weeks): Multi-actor collaboration
- **Total**: 10-14 weeks to MVP

**Success Metrics:**
- Query latency: <300ms P95 (CosmosDB vs Zep's Neo4j)
- Accuracy: >75% on LoCoMo benchmark
- Cost: <$0.05 per episode processed
- Actor throughput: 100+ episodes/sec across system

**Next Steps:**
1. Prototype CosmosDB Gremlin schema (1 week)
2. Build GraphMemoryActor with basic operations (2 weeks)
3. Test extraction + deduplication pipeline (2 weeks)
4. Validate search performance (1 week)
5. Plan Phase 2 implementation

---

## 11. Appendix: Key Code References

### Zep Repository Structure
```
getzep/zep/
├── graphiti_core/          # Core graph engine (Python)
│   ├── graphiti.py        # Main Graphiti class
│   ├── nodes.py           # Node definitions
│   ├── edges.py           # Edge definitions
│   └── utils/
│       ├── maintenance/   # Extraction, deduplication
│       └── bulk_utils.py  # Batch processing
├── integrations/python/
│   ├── zep_autogen/       # AutoGen integration
│   ├── zep_crewai/        # CrewAI integration
│   └── zep_livekit/       # LiveKit integration
└── examples/
    ├── python/graph_example/
    └── typescript/graph/

getzep/graphiti/           # Graphiti standalone repo
├── graphiti_core/
└── mcp_server/            # MCP server implementation
```

### Critical Files to Study
1. `graphiti_core/graphiti.py` - Main orchestration logic
2. `graphiti_core/utils/maintenance/edge_operations.py` - Edge extraction & deduplication
3. `graphiti_core/utils/maintenance/node_operations.py` - Entity extraction
4. `graphiti_core/search/search_utils.py` - Hybrid search implementation
5. `integrations/python/zep_autogen/src/zep_autogen/graph_memory.py` - Integration pattern

### Key Prompts to Adapt
1. `graphiti_core/prompts/extract_nodes.py` - Entity extraction
2. `graphiti_core/prompts/extract_edges.py` - Relationship extraction
3. `graphiti_core/prompts/dedupe_edges.py` - Edge deduplication
4. `graphiti_core/prompts/invalidate_edges.py` - Temporal invalidation

---

## Conclusion

Zep represents the state-of-the-art in memory systems for AI agents. Its temporal knowledge graph architecture, automatic entity extraction, and hybrid search capabilities solve real problems that simpler systems (like supermemory) cannot address.

For Loom, implementing a Zep-inspired memory system with CosmosDB Gremlin combines proven patterns with Loom's unique strengths in durable actors, verifiable compute, and WASM sandboxing. This creates a differentiated, production-ready memory layer that can compete with—and potentially exceed—commercial offerings like Zep Cloud.

**The investment is justified by:**
- Growing demand for agent memory systems
- Loom's architectural fit (durable actors + graph memory)
- Competitive moat (verifiable + durable + sandboxed memory)
- Clear path to market (10-14 week MVP)

**Proceed with implementation.**
