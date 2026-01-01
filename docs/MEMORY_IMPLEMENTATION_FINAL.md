# Loom Memory Graph: Final Implementation Plan

## Design Principles

1. **Dependency Injection**: Inject `ActorMemory` into actors - no magic, full control
2. **Storage Abstraction**: One `MemoryStorage` interface, multiple implementations (Kuzu, Redis, CosmosDB)
3. **Manual by Default**: Auto-extraction is opt-in for performance control
4. **Minimal Code**: ~500 lines total for full system
5. **Zero Breaking Changes**: Existing actors work unchanged
6. **Performance First**: Can disable expensive features anytime
7. **Portable**: Easy to swap storage backends

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│              Loom Actors                         │
│  ┌─────────────┐  ┌─────────────┐               │
│  │  MyActor    │  │ OtherActor  │               │
│  │             │  │             │               │
│  │  memory ────┼──┤  memory ────┼─────┐         │
│  └─────────────┘  └─────────────┘     │         │
└────────────────────────────────────────┼─────────┘
                                         │
                                         ▼
                              ┌──────────────────┐
                              │   ActorMemory    │
                              │  (Polymorphic)   │
                              └────────┬─────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
            ┌───────▼────────┐ ┌──────▼───────┐ ┌───────▼────────┐
            │ GraphMemory    │ │ RedisMemory  │ │ CosmosMemory   │
            │ Storage (Kuzu) │ │ Storage      │ │ Storage        │
            └────────────────┘ └──────────────┘ └────────────────┘
```

**Key Insight**: Actors depend on `ActorMemory`, which depends on `MemoryStorage` interface. Storage implementation is swappable.

---

## Core Types

### Data Model

```typescript
// src/memory/types.ts

// What gets stored
export interface Episode {
  id: string;
  content: string;
  timestamp: Date;
  actorId: string;
  
  // Optional: embedding for semantic search
  embedding?: number[];
  embedding_ref?: string;  // Or reference to external vector store
}

export interface Entity {
  id: string;
  name: string;
  type: string;  // 'person', 'company', 'product', etc.
  actorId: string;
  
  // Optional: summary for richer context
  summary?: string;
  summary_embedding?: number[];
}

export interface Fact {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relation: string;  // 'works_at', 'likes', 'purchased', etc.
  text: string;      // Human-readable: "Alice works at TechStart"
  
  // Temporal reasoning (the killer feature!)
  validFrom: Date;
  validUntil?: Date;  // null = still valid
  
  // Evidence
  episodeIds: string[];
  
  // Partitioning
  actorId: string;
  
  // Optional: embedding for semantic search
  embedding?: number[];
  embedding_ref?: string;
}

// Query interface
export interface MemoryQuery {
  actorId: string;
  text?: string;           // Keyword or semantic query
  embedding?: number[];    // Vector for semantic search
  asOf?: Date;            // Temporal query: "facts valid at this time"
  limit?: number;
}

// Storage interface (implement this for each backend)
export interface MemoryStorage {
  // Episodes
  addEpisode(episode: Episode): Promise<void>;
  getEpisodes(actorId: string, limit?: number): Promise<Episode[]>;
  
  // Entities
  addEntity(entity: Entity): Promise<void>;
  getEntity(id: string): Promise<Entity | null>;
  
  // Facts
  addFact(fact: Fact): Promise<void>;
  getFact(id: string): Promise<Fact | null>;
  getValidFacts(actorId: string, asOf?: Date): Promise<Fact[]>;
  searchFacts(query: MemoryQuery): Promise<Fact[]>;
  
  // Lifecycle
  close(): Promise<void>;
}
```

### Actor Interface

```typescript
// src/memory/actor-memory.ts

export class ActorMemory {
  constructor(
    private actorId: string,
    private storage: MemoryStorage,
    private options?: {
      embedder?: Embedder;      // For semantic search
      extractor?: FactExtractor; // For auto-extraction
    }
  ) {}
  
  // ═══════════════════════════════════════════════════
  // Core API (4 methods - covers 90% of use cases)
  // ═══════════════════════════════════════════════════
  
  async addEpisode(content: string, opts?: { extract?: boolean }): Promise<string> {
    const episode: Episode = {
      id: crypto.randomUUID(),
      content,
      timestamp: new Date(),
      actorId: this.actorId,
      embedding: this.options?.embedder ? await this.options.embedder.embed(content) : undefined
    };
    
    await this.storage.addEpisode(episode);
    
    // Auto-extract if enabled
    if (opts?.extract && this.options?.extractor) {
      await this.extractAndStore(episode);
    }
    
    return episode.id;
  }
  
  async addFact(
    source: string,
    relation: string,
    target: string,
    text: string
  ): Promise<string> {
    // Ensure entities exist
    await this.ensureEntity(source);
    await this.ensureEntity(target);
    
    const fact: Fact = {
      id: crypto.randomUUID(),
      sourceEntityId: source,
      targetEntityId: target,
      relation,
      text,
      validFrom: new Date(),
      episodeIds: [],
      actorId: this.actorId,
      embedding: this.options?.embedder ? await this.options.embedder.embed(text) : undefined
    };
    
    await this.storage.addFact(fact);
    return fact.id;
  }
  
  async search(query: string, limit = 10): Promise<Fact[]> {
    const embedding = this.options?.embedder 
      ? await this.options.embedder.embed(query)
      : undefined;
    
    return this.storage.searchFacts({
      actorId: this.actorId,
      text: query,
      embedding,
      limit
    });
  }
  
  async getCurrentFacts(): Promise<Fact[]> {
    return this.storage.getValidFacts(this.actorId, new Date());
  }
  
  // ═══════════════════════════════════════════════════
  // Advanced API (for power users)
  // ═══════════════════════════════════════════════════
  
  async getRecentEpisodes(limit = 10): Promise<Episode[]> {
    return this.storage.getEpisodes(this.actorId, limit);
  }
  
  async getFactsAsOf(date: Date): Promise<Fact[]> {
    return this.storage.getValidFacts(this.actorId, date);
  }
  
  async invalidateFact(factId: string): Promise<void> {
    const fact = await this.storage.getFact(factId);
    if (fact) {
      fact.validUntil = new Date();
      await this.storage.addFact(fact);  // Update
    }
  }
  
  // ═══════════════════════════════════════════════════
  // Internal helpers
  // ═══════════════════════════════════════════════════
  
  private async ensureEntity(name: string): Promise<void> {
    const existing = await this.storage.getEntity(name);
    if (!existing) {
      await this.storage.addEntity({
        id: name,
        name,
        type: 'unknown',
        actorId: this.actorId
      });
    }
  }
  
  private async extractAndStore(episode: Episode): Promise<void> {
    if (!this.options?.extractor) return;
    
    const recent = await this.getRecentEpisodes(3);
    const context = recent.slice(0, -1).map(e => e.content);
    
    const result = await this.options.extractor.extract(episode.content, context);
    
    for (const entity of result.entities) {
      await this.ensureEntity(entity.name);
    }
    
    for (const fact of result.facts) {
      await this.addFact(fact.source, fact.relation, fact.target, fact.text);
    }
  }
  
  async dispose(): Promise<void> {
    await this.storage.close();
  }
}
```

---

## Phase 1: Core Storage (Week 1-2)

**Goal**: Manual memory storage with keyword search

### Files to Create

```
src/memory/
├── types.ts                    (80 lines)  - Interfaces
├── graph-memory-storage.ts     (200 lines) - Kuzu implementation
├── actor-memory.ts             (120 lines) - ActorMemory class
├── index.ts                    (10 lines)  - Exports

tests/memory/
└── storage.test.ts             (150 lines) - Tests
```

### Implementation: GraphMemoryStorage

```typescript
// src/memory/graph-memory-storage.ts
import * as kuzu from 'kuzu';
import { MemoryStorage, Episode, Entity, Fact, MemoryQuery } from './types';

export class GraphMemoryStorage implements MemoryStorage {
  private db: kuzu.Database;
  private conn: kuzu.Connection;
  
  constructor(options?: { path?: string }) {
    const path = options?.path || ':memory:';
    this.db = new kuzu.Database(path);
    this.conn = new kuzu.Connection(this.db);
    this.initSchema();
  }
  
  private async initSchema(): Promise<void> {
    // Create node tables
    await this.conn.query(`
      CREATE NODE TABLE IF NOT EXISTS Episode(
        id STRING PRIMARY KEY,
        content STRING,
        timestamp TIMESTAMP,
        actorId STRING
      )
    `);
    
    await this.conn.query(`
      CREATE NODE TABLE IF NOT EXISTS Entity(
        id STRING PRIMARY KEY,
        name STRING,
        type STRING,
        actorId STRING
      )
    `);
    
    // Create relationship table
    await this.conn.query(`
      CREATE REL TABLE IF NOT EXISTS Fact(
        FROM Entity TO Entity,
        id STRING,
        relation STRING,
        text STRING,
        validFrom TIMESTAMP,
        validUntil TIMESTAMP,
        episodeIds STRING[],
        actorId STRING
      )
    `);
  }
  
  async addEpisode(episode: Episode): Promise<void> {
    await this.conn.query(
      `CREATE (:Episode {
        id: $id,
        content: $content,
        timestamp: $timestamp,
        actorId: $actorId
      })`,
      {
        id: episode.id,
        content: episode.content,
        timestamp: episode.timestamp,
        actorId: episode.actorId
      }
    );
  }
  
  async getEpisodes(actorId: string, limit = 10): Promise<Episode[]> {
    const result = await this.conn.query(
      `MATCH (e:Episode)
       WHERE e.actorId = $actorId
       ORDER BY e.timestamp DESC
       LIMIT $limit
       RETURN e`,
      { actorId, limit }
    );
    
    return result.getAll().map(row => ({
      id: row.e.id,
      content: row.e.content,
      timestamp: new Date(row.e.timestamp),
      actorId: row.e.actorId
    }));
  }
  
  async addEntity(entity: Entity): Promise<void> {
    await this.conn.query(
      `CREATE (:Entity {
        id: $id,
        name: $name,
        type: $type,
        actorId: $actorId
      })`,
      entity
    );
  }
  
  async getEntity(id: string): Promise<Entity | null> {
    const result = await this.conn.query(
      `MATCH (e:Entity {id: $id}) RETURN e`,
      { id }
    );
    const rows = result.getAll();
    return rows.length > 0 ? rows[0].e : null;
  }
  
  async addFact(fact: Fact): Promise<void> {
    await this.conn.query(
      `MATCH (s:Entity {id: $sourceId}), (t:Entity {id: $targetId})
       CREATE (s)-[:Fact {
         id: $id,
         relation: $relation,
         text: $text,
         validFrom: $validFrom,
         validUntil: $validUntil,
         episodeIds: $episodeIds,
         actorId: $actorId
       }]->(t)`,
      {
        sourceId: fact.sourceEntityId,
        targetId: fact.targetEntityId,
        id: fact.id,
        relation: fact.relation,
        text: fact.text,
        validFrom: fact.validFrom,
        validUntil: fact.validUntil || null,
        episodeIds: fact.episodeIds,
        actorId: fact.actorId
      }
    );
  }
  
  async getFact(id: string): Promise<Fact | null> {
    const result = await this.conn.query(
      `MATCH (s:Entity)-[f:Fact {id: $id}]->(t:Entity)
       RETURN f, s.id AS sourceId, t.id AS targetId`,
      { id }
    );
    const rows = result.getAll();
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
      id: row.f.id,
      sourceEntityId: row.sourceId,
      targetEntityId: row.targetId,
      relation: row.f.relation,
      text: row.f.text,
      validFrom: new Date(row.f.validFrom),
      validUntil: row.f.validUntil ? new Date(row.f.validUntil) : undefined,
      episodeIds: row.f.episodeIds,
      actorId: row.f.actorId
    };
  }
  
  async getValidFacts(actorId: string, asOf = new Date()): Promise<Fact[]> {
    const result = await this.conn.query(
      `MATCH (s:Entity)-[f:Fact]->(t:Entity)
       WHERE f.actorId = $actorId
         AND f.validFrom <= $asOf
         AND (f.validUntil IS NULL OR f.validUntil > $asOf)
       RETURN f, s.id AS sourceId, t.id AS targetId
       ORDER BY f.validFrom DESC`,
      { actorId, asOf }
    );
    
    return result.getAll().map(row => ({
      id: row.f.id,
      sourceEntityId: row.sourceId,
      targetEntityId: row.targetId,
      relation: row.f.relation,
      text: row.f.text,
      validFrom: new Date(row.f.validFrom),
      validUntil: row.f.validUntil ? new Date(row.f.validUntil) : undefined,
      episodeIds: row.f.episodeIds,
      actorId: row.f.actorId
    }));
  }
  
  async searchFacts(query: MemoryQuery): Promise<Fact[]> {
    const { actorId, text, asOf, limit = 20 } = query;
    const now = asOf || new Date();
    
    // Simple keyword search for Phase 1
    const result = await this.conn.query(
      `MATCH (s:Entity)-[f:Fact]->(t:Entity)
       WHERE f.actorId = $actorId
         AND f.text CONTAINS $text
         AND f.validFrom <= $now
         AND (f.validUntil IS NULL OR f.validUntil > $now)
       ORDER BY f.validFrom DESC
       LIMIT $limit
       RETURN f, s.id AS sourceId, t.id AS targetId`,
      { actorId, text: text || '', now, limit }
    );
    
    return result.getAll().map(row => ({
      id: row.f.id,
      sourceEntityId: row.sourceId,
      targetEntityId: row.targetId,
      relation: row.f.relation,
      text: row.f.text,
      validFrom: new Date(row.f.validFrom),
      validUntil: row.f.validUntil ? new Date(row.f.validUntil) : undefined,
      episodeIds: row.f.episodeIds,
      actorId: row.f.actorId
    }));
  }
  
  async close(): Promise<void> {
    this.conn.close();
    this.db.close();
  }
}
```

### Usage Example (Phase 1)

```typescript
// Create storage
const storage = new GraphMemoryStorage({ path: './memory.db' });

// Create memory
const memory = new ActorMemory('actor1', storage);

// Inject into actor
class CustomerServiceActor extends DurableActor {
  constructor(
    config: ActorConfig,
    private memory: ActorMemory
  ) {
    super(config);
  }
  
  async handleMessage(message: string): Promise<string> {
    // Store episode
    await this.memory.addEpisode(message);
    
    // Manually add facts (no auto-extraction yet)
    if (message.includes('my name is')) {
      const name = this.extractName(message);
      await this.memory.addFact('user', 'has_name', name, `User's name is ${name}`);
    }
    
    // Search memory
    const facts = await this.memory.search('name');
    
    return `I remember: ${facts.map(f => f.text).join(', ')}`;
  }
  
  async dispose() {
    await this.memory.dispose();
    await super.dispose();
  }
  
  private extractName(msg: string): string {
    const match = msg.match(/my name is (\w+)/i);
    return match ? match[1] : 'unknown';
  }
}

// Create and use
const storage = new GraphMemoryStorage({ path: './memory.db' });
const memory = new ActorMemory('cs1', storage);
const actor = new CustomerServiceActor({ actorId: 'cs1' }, memory);

await actor.handleMessage("Hi, my name is Alice");
await actor.handleMessage("What's my name?");
// Response: "I remember: User's name is Alice"
```

**Phase 1 Complete**: ~400 lines, manual memory with keyword search

---

## Phase 2: Semantic Search (Week 3-4)

**Goal**: Add vector embeddings for semantic search

### Changes Required

#### 2.1 Update Schema

```typescript
// src/memory/graph-memory-storage.ts - UPDATE initSchema()
private async initSchema(): Promise<void> {
  // ... existing Episode and Entity tables ...
  
  // UPDATE: Add embedding field to Fact table
  await this.conn.query(`
    CREATE REL TABLE IF NOT EXISTS Fact(
      FROM Entity TO Entity,
      id STRING,
      relation STRING,
      text STRING,
      embedding FLOAT[1536],  -- ADD: Vector for semantic search
      validFrom TIMESTAMP,
      validUntil TIMESTAMP,
      episodeIds STRING[],
      actorId STRING
    )
  `);
}
```

#### 2.2 Add Embedder

```typescript
// src/memory/embedder.ts - NEW FILE
import { OpenAI } from 'openai';

export class Embedder {
  private client: OpenAI;
  
  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }
  
  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text
    });
    return response.data[0].embedding;
  }
  
  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts
    });
    return response.data.map(d => d.embedding);
  }
}
```

#### 2.3 Update Storage Search

```typescript
// src/memory/graph-memory-storage.ts - UPDATE searchFacts()
async searchFacts(query: MemoryQuery): Promise<Fact[]> {
  const { actorId, text, embedding, asOf, limit = 20 } = query;
  const now = asOf || new Date();
  
  if (embedding) {
    // Semantic search using vector similarity
    const result = await this.conn.query(
      `MATCH (s:Entity)-[f:Fact]->(t:Entity)
       WHERE f.actorId = $actorId
         AND f.embedding IS NOT NULL
         AND f.validFrom <= $now
         AND (f.validUntil IS NULL OR f.validUntil > $now)
       WITH f, s, t, array_cosine_similarity(f.embedding, $embedding) AS score
       WHERE score > 0.7
       ORDER BY score DESC
       LIMIT $limit
       RETURN f, s.id AS sourceId, t.id AS targetId, score`,
      { actorId, embedding, now, limit }
    );
    
    return result.getAll().map(row => ({
      id: row.f.id,
      sourceEntityId: row.sourceId,
      targetEntityId: row.targetId,
      relation: row.f.relation,
      text: row.f.text,
      validFrom: new Date(row.f.validFrom),
      validUntil: row.f.validUntil ? new Date(row.f.validUntil) : undefined,
      episodeIds: row.f.episodeIds,
      actorId: row.f.actorId
    }));
  }
  
  // Fallback to keyword search
  // ... existing keyword search code ...
}
```

#### 2.4 Update ActorMemory to Store Embeddings

```typescript
// src/memory/actor-memory.ts - UPDATE addFact()
async addFact(source: string, relation: string, target: string, text: string): Promise<string> {
  await this.ensureEntity(source);
  await this.ensureEntity(target);
  
  const fact: Fact = {
    id: crypto.randomUUID(),
    sourceEntityId: source,
    targetEntityId: target,
    relation,
    text,
    validFrom: new Date(),
    episodeIds: [],
    actorId: this.actorId,
    embedding: this.options?.embedder 
      ? await this.options.embedder.embed(text)  // ADD: Generate embedding
      : undefined
  };
  
  await this.storage.addFact(fact);
  return fact.id;
}
```

### Usage Example (Phase 2)

```typescript
// Create storage
const storage = new GraphMemoryStorage({ path: './memory.db' });

// Create embedder
const embedder = new Embedder(process.env.OPENAI_API_KEY!);

// Create memory with embedder
const memory = new ActorMemory('actor1', storage, { embedder });

// Inject into actor
const actor = new CustomerServiceActor({ actorId: 'cs1' }, memory);

// Add facts (now with embeddings)
await actor.memory.addFact('user', 'likes', 'pizza', 'User likes pizza');

// Semantic search works!
const facts = await actor.memory.search('food preferences');
// Finds "User likes pizza" even though query was "food preferences"!
```

**Phase 2 Complete**: +100 lines, semantic search working

---

## Phase 3: Auto-Extraction (Week 5-8)

**Goal**: LLM automatically extracts entities and facts

### Add Extractor

```typescript
// src/memory/extractor.ts - NEW FILE
import { OpenAI } from 'openai';

export interface ExtractionResult {
  entities: Array<{ name: string; type: string }>;
  facts: Array<{
    source: string;
    relation: string;
    target: string;
    text: string;
  }>;
}

export class FactExtractor {
  private client: OpenAI;
  
  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }
  
  async extract(
    episodeContent: string,
    previousEpisodes: string[] = []
  ): Promise<ExtractionResult> {
    const context = previousEpisodes.length > 0
      ? `Previous context:\n${previousEpisodes.join('\n')}\n\n`
      : '';
    
    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',  // Cheaper model
      messages: [{
        role: 'system',
        content: `Extract entities and relationships from text. Return JSON:
{
  "entities": [{"name": "Alice", "type": "person"}],
  "facts": [{"source": "Alice", "relation": "works_at", "target": "TechStart", "text": "Alice works at TechStart"}]
}`
      }, {
        role: 'user',
        content: `${context}Current message:\n${episodeContent}`
      }],
      response_format: { type: 'json_object' }
    });
    
    return JSON.parse(response.choices[0].message.content || '{"entities":[],"facts":[]}');
  }
}
```

### Usage Example (Phase 3)

```typescript
// Create all components
const storage = new GraphMemoryStorage({ path: './memory.db' });
const embedder = new Embedder(process.env.OPENAI_API_KEY!);
const extractor = new FactExtractor(process.env.OPENAI_API_KEY!);

// Create memory with auto-extraction
const memory = new ActorMemory('actor1', storage, { embedder, extractor });

// Actor can now use auto-extraction
class SmartActor extends DurableActor {
  constructor(config: ActorConfig, private memory: ActorMemory) {
    super(config);
  }
  
  async handleMessage(message: string): Promise<string> {
    // Automatically extracts entities and facts!
    await this.memory.addEpisode(message, { extract: true });
    
    // Search semantically
    const facts = await this.memory.search('user information');
    
    return `I remember: ${facts.map(f => f.text).join(', ')}`;
  }
}

const actor = new SmartActor({ actorId: 'smart1' }, memory);

await actor.handleMessage("My name is Alice and I work at TechStart as a software engineer");
// Automatically creates:
// - Entity: Alice (person)
// - Entity: TechStart (company)
// - Entity: software engineer (role)
// - Fact: Alice works_at TechStart
// - Fact: Alice has_role software engineer

const facts = await actor.memory.search("Alice's job");
// Returns: "Alice works at TechStart", "Alice is a software engineer"
```

**Phase 3 Complete**: +150 lines, full auto-extraction

---

## Storage Implementations

### Swapping Storage Backends

```typescript
// Option 1: Kuzu (embedded graph DB)
const storage = new GraphMemoryStorage({ path: './memory.db' });

// Option 2: Redis (future implementation)
class RedisMemoryStorage implements MemoryStorage {
  constructor(options: { host: string; port: number }) { /* ... */ }
  // Implement all MemoryStorage methods
}
const storage = new RedisMemoryStorage({ host: 'localhost', port: 6379 });

// Option 3: CosmosDB Gremlin (future implementation)
class CosmosMemoryStorage implements MemoryStorage {
  constructor(options: { endpoint: string; key: string }) { /* ... */ }
  // Implement all MemoryStorage methods
}
const storage = new CosmosMemoryStorage({ endpoint: '...', key: '...' });

// Actor code doesn't change!
const memory = new ActorMemory('actor1', storage);
const actor = new MyActor(config, memory);
```

---

## Configuration Patterns

### Pattern 1: Simple (No Semantic Search)

```typescript
const storage = new GraphMemoryStorage({ path: './memory.db' });
const memory = new ActorMemory('actor1', storage);
const actor = new MyActor(config, memory);

// Manual fact storage, keyword search only
```

### Pattern 2: With Semantic Search

```typescript
const storage = new GraphMemoryStorage({ path: './memory.db' });
const embedder = new Embedder(process.env.OPENAI_API_KEY!);
const memory = new ActorMemory('actor1', storage, { embedder });
const actor = new MyActor(config, memory);

// Manual fact storage, semantic search enabled
```

### Pattern 3: Full Auto-Extraction

```typescript
const storage = new GraphMemoryStorage({ path: './memory.db' });
const embedder = new Embedder(process.env.OPENAI_API_KEY!);
const extractor = new FactExtractor(process.env.OPENAI_API_KEY!);
const memory = new ActorMemory('actor1', storage, { embedder, extractor });
const actor = new MyActor(config, memory);

// Auto-extraction + semantic search
await memory.addEpisode("I like pizza", { extract: true });
```

### Pattern 4: Shared Memory

```typescript
// Multiple actors share the same storage
const sharedStorage = new GraphMemoryStorage({ path: './shared-memory.db' });

const memory1 = new ActorMemory('actor1', sharedStorage);
const memory2 = new ActorMemory('actor2', sharedStorage);

const actor1 = new Actor1(config1, memory1);
const actor2 = new Actor2(config2, memory2);

// Both actors can access each other's facts (partitioned by actorId)
```

---

## Performance Controls

### Control 1: Disable Auto-Extraction

```typescript
// Just don't pass { extract: true }
await memory.addEpisode(message);  // Fast, no LLM call
```

### Control 2: Disable Semantic Search

```typescript
// Don't pass embedder to ActorMemory
const memory = new ActorMemory('actor1', storage);  // No embedder
// Keyword search only, no embedding generation
```

### Control 3: Batch Operations

```typescript
// Future enhancement
await memory.addEpisodeBatch(messages, { extract: true });
// Process multiple episodes in one LLM call
```

### Control 4: Circuit Breaker

```typescript
// Future enhancement
const memory = new ActorMemory('actor1', storage, {
  embedder,
  extractor,
  circuitBreaker: {
    maxLatency: 100,      // Skip if >100ms
    failureThreshold: 5,   // Open after 5 failures
    cooldown: 60000       // Retry after 1 min
  }
});
```

---

## Testing Strategy

```typescript
// tests/memory/storage.test.ts
describe('GraphMemoryStorage', () => {
  let storage: GraphMemoryStorage;
  
  beforeEach(() => {
    storage = new GraphMemoryStorage();  // In-memory
  });
  
  afterEach(async () => {
    await storage.close();
  });
  
  it('stores and retrieves episodes', async () => {
    await storage.addEpisode({
      id: '1',
      content: 'test',
      timestamp: new Date(),
      actorId: 'actor1'
    });
    
    const episodes = await storage.getEpisodes('actor1');
    expect(episodes).toHaveLength(1);
    expect(episodes[0].content).toBe('test');
  });
  
  it('temporal queries work', async () => {
    // Add entity
    await storage.addEntity({ id: 'alice', name: 'Alice', type: 'person', actorId: 'actor1' });
    await storage.addEntity({ id: 'acme', name: 'Acme', type: 'company', actorId: 'actor1' });
    
    // Add fact valid only in past
    await storage.addFact({
      id: '1',
      sourceEntityId: 'alice',
      targetEntityId: 'acme',
      relation: 'works_at',
      text: 'Alice works at Acme',
      validFrom: new Date('2024-01-01'),
      validUntil: new Date('2024-06-01'),
      episodeIds: [],
      actorId: 'actor1'
    });
    
    // Query past
    const pastFacts = await storage.getValidFacts('actor1', new Date('2024-05-01'));
    expect(pastFacts).toHaveLength(1);
    
    // Query now
    const currentFacts = await storage.getValidFacts('actor1', new Date());
    expect(currentFacts).toHaveLength(0);
  });
  
  it('keyword search works', async () => {
    await storage.addEntity({ id: 'alice', name: 'Alice', type: 'person', actorId: 'actor1' });
    await storage.addEntity({ id: 'techstart', name: 'TechStart', type: 'company', actorId: 'actor1' });
    
    await storage.addFact({
      id: '1',
      sourceEntityId: 'alice',
      targetEntityId: 'techstart',
      relation: 'works_at',
      text: 'Alice works at TechStart',
      validFrom: new Date(),
      episodeIds: [],
      actorId: 'actor1'
    });
    
    const results = await storage.searchFacts({ actorId: 'actor1', text: 'works' });
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain('TechStart');
  });
});
```

---

## Cost Estimates

### Phase 1 (Manual)
- **Cost**: $0
- **Functionality**: Keyword search, manual fact storage

### Phase 2 (Semantic Search)
- **Embedding cost**: $0.0001 per fact (~$1 per 10,000 facts)
- **Functionality**: Semantic search

### Phase 3 (Auto-Extraction)
- **Extraction cost**: ~$0.0005 per episode (gpt-4o-mini)
- **Total**: ~$0.0006 per episode (extraction + embedding)
- **Monthly at 1000 episodes/day**: ~$18

### Cost Controls

```typescript
const extractor = new FactExtractor(apiKey, {
  model: 'gpt-4o-mini',  // Cheaper than gpt-4
  maxTokens: 500,        // Limit output
  skipIfShort: true,     // Skip "ok", "thanks"
  minLength: 20          // Only extract from substantial messages
});
```

---

## Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Add episode (no extract) | <5ms | Just DB insert |
| Add fact (no embedding) | <10ms | DB insert + entity check |
| Add fact (with embedding) | <100ms | Includes OpenAI API call |
| Add episode (with extract) | <2s | LLM extraction dominates |
| Keyword search | <20ms | Kuzu full-text search |
| Semantic search | <50ms | Kuzu vector similarity |
| Get recent episodes | <5ms | Simple SELECT |
| Temporal query | <30ms | Filter on timestamps |

---

## Migration Path

### Existing Actors (No Changes)

```typescript
class MyActor extends DurableActor {
  async handleMessage(msg: string) {
    // No memory, works as before
  }
}
```

### Add Memory (Inject Dependency)

```typescript
class MyActor extends DurableActor {
  constructor(
    config: ActorConfig,
    private memory: ActorMemory  // ADD
  ) {
    super(config);
  }
  
  async handleMessage(msg: string) {
    await this.memory.addEpisode(msg);  // ADD
  }
  
  async dispose() {
    await this.memory.dispose();  // ADD
    await super.dispose();
  }
}

// Create with memory
const storage = new GraphMemoryStorage({ path: './memory.db' });
const memory = new ActorMemory('actor1', storage);
const actor = new MyActor(config, memory);
```

### Make Memory Optional

```typescript
class MyActor extends DurableActor {
  constructor(
    config: ActorConfig,
    private memory?: ActorMemory  // Optional
  ) {
    super(config);
  }
  
  async handleMessage(msg: string) {
    if (this.memory) {
      await this.memory.addEpisode(msg);
    }
  }
}

// Without memory
const actor = new MyActor(config);

// With memory
const actor = new MyActor(config, memory);
```

---

## File Structure Summary

```
src/memory/
├── types.ts                    (80 lines)   - Core interfaces
├── graph-memory-storage.ts     (200 lines)  - Kuzu implementation
├── actor-memory.ts             (120 lines)  - ActorMemory class
├── embedder.ts                 (40 lines)   - OpenAI embeddings
├── extractor.ts                (80 lines)   - LLM extraction
└── index.ts                    (10 lines)   - Exports

tests/memory/
├── storage.test.ts             (150 lines)  - Storage tests
├── actor-memory.test.ts        (100 lines)  - ActorMemory tests
└── integration.test.ts         (100 lines)  - End-to-end tests

Total: ~880 lines
```

---

## Decision Checklist

### Architecture
- ✅ **Dependency Injection**: ActorMemory injected into actors
- ✅ **Storage Abstraction**: MemoryStorage interface, multiple implementations
- ✅ **No Magic**: No decorators, no factories, just classes
- ✅ **Portable**: Easy to swap Kuzu → Redis → CosmosDB

### Data Model
- ✅ **Episodes**: Raw conversation/data
- ✅ **Entities**: Extracted people, places, things
- ✅ **Facts**: Relationships with temporal validity
- ✅ **Embeddings**: Support both inline and reference storage

### Performance
- ✅ **Manual by Default**: Auto-extract is opt-in
- ✅ **Can Disable Features**: Remove embedder/extractor for speed
- ✅ **Temporal Queries**: Filter by date without full scan
- ✅ **Keyword + Semantic**: Both search modes supported

### Implementation
- ✅ **3 Phases**: Core → Semantic → Auto-extract
- ✅ **~500 lines**: Minimal code, maximum functionality
- ✅ **Zero Breaking Changes**: Existing actors unchanged
- ✅ **Well Tested**: Unit + integration tests

---

## Next Steps

1. **Week 1**: Implement types.ts + graph-memory-storage.ts (Phase 1)
2. **Week 2**: Implement actor-memory.ts + tests
3. **Demo**: Show manual memory to team, get feedback
4. **Week 3-4**: Add embedder.ts + semantic search (Phase 2)
5. **Demo**: Show semantic search working
6. **Evaluate**: Is this valuable? Continue to Phase 3?
7. **Week 5-8**: Add extractor.ts + auto-extraction (Phase 3)
8. **Launch**: Beta with select actors

---

## Success Criteria

### Phase 1 Complete When
- ✅ Can store episodes
- ✅ Can manually add facts
- ✅ Can search by keyword
- ✅ Temporal queries work
- ✅ All tests pass

### Phase 2 Complete When
- ✅ Semantic search works ("pizza" found when searching "food")
- ✅ Performance <100ms for embedding generation
- ✅ Performance <50ms for semantic search

### Phase 3 Complete When
- ✅ Auto-extraction works (conversation → entities/facts automatically)
- ✅ Cost <$0.001 per episode
- ✅ Accuracy >70% (manual spot check)

---

## Questions for Approval

1. **Architecture**: DI pattern good? (Inject ActorMemory into actors)
2. **Storage**: Start with Kuzu (GraphMemoryStorage)?
3. **Naming**: `ActorMemory`, `GraphMemoryStorage`, `MemoryStorage` interface OK?
4. **Phases**: 3 phases over 6-8 weeks reasonable?
5. **Manual first**: Auto-extraction opt-in, not default?
6. **Optional memory**: Actors can work with or without memory?

---

**Ready to approve and start implementation?**
