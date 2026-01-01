# Loom Memory Graph: Pragmatic Implementation Plan

## Philosophy: Maximum Value, Minimum Code

**Core Principle**: Start with the simplest thing that works, add complexity only when needed.

**Goal**: Give Loom actors semantic memory in 3 phases over 6-8 weeks.

---

## Overview: What We're Building

```typescript
// Before: Actor forgets everything
class MyActor extends DurableActor {
  async handleMessage(msg: string) {
    // Process, respond, forget
  }
}

// After: Actor remembers semantically
class MyActor extends DurableActor {
  memory = this.useMemory();  // 🎯 One line to enable
  
  async handleMessage(msg: string) {
    // Store in memory (manual mode - full control)
    await this.memory.addEpisode(msg);
    
    // Query memory
    const context = await this.memory.search("user preferences");
    
    // Use context in response
    return this.generateResponse(msg, context);
  }
}
```

---

## Phase 1: Core Storage (Week 1-2)

**Goal**: Store episodes and relationships, query by ID/filter

### Files to Create

```
src/memory/
├── types.ts              (50 lines)  - Core interfaces
├── storage.ts            (150 lines) - Kuzu wrapper
├── memory-actor.ts       (100 lines) - Actor integration
└── index.ts              (10 lines)  - Exports

tests/memory/
└── storage.test.ts       (100 lines) - Basic tests
```

### 1.1 Core Types (`src/memory/types.ts`)

```typescript
// Minimal, portable data model
export interface Episode {
  id: string;
  content: string;
  timestamp: Date;
  actorId: string;
}

export interface Entity {
  id: string;
  name: string;
  type: string;  // 'person', 'company', etc.
  actorId: string;
}

export interface Fact {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relation: string;  // 'works_at', 'likes', etc.
  text: string;      // "Alice works at TechStart"
  validFrom: Date;
  validUntil?: Date;  // null = still valid
  episodeIds: string[];  // Evidence
  actorId: string;
}

export interface MemoryQuery {
  actorId: string;
  text?: string;      // Keyword search
  limit?: number;
}

export interface MemoryStorage {
  // Episodes
  addEpisode(episode: Episode): Promise<void>;
  getEpisodes(actorId: string, limit?: number): Promise<Episode[]>;
  
  // Entities
  addEntity(entity: Entity): Promise<void>;
  getEntity(id: string): Promise<Entity | null>;
  
  // Facts (relationships)
  addFact(fact: Fact): Promise<void>;
  getValidFacts(actorId: string, asOf?: Date): Promise<Fact[]>;
  searchFacts(query: MemoryQuery): Promise<Fact[]>;
}
```

**Decision**: Simple interfaces, no inheritance, easy to test.

### 1.2 Kuzu Storage (`src/memory/storage.ts`)

```typescript
import * as kuzu from 'kuzu';

export class KuzuMemoryStorage implements MemoryStorage {
  private db: kuzu.Database;
  private conn: kuzu.Connection;
  
  constructor(dbPath: string = ':memory:') {
    this.db = new kuzu.Database(dbPath);
    this.conn = new kuzu.Connection(this.db);
    this.initSchema();
  }
  
  private async initSchema(): Promise<void> {
    // Create tables
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
      episode
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
    return result.getAll().map(row => row.e);
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
        ...fact
      }
    );
  }
  
  async getValidFacts(actorId: string, asOf = new Date()): Promise<Fact[]> {
    const result = await this.conn.query(
      `MATCH (s:Entity)-[f:Fact]->(t:Entity)
       WHERE f.actorId = $actorId
         AND f.validFrom <= $asOf
         AND (f.validUntil IS NULL OR f.validUntil > $asOf)
       RETURN f, s, t`,
      { actorId, asOf }
    );
    
    return result.getAll().map(row => ({
      ...row.f,
      sourceEntityId: row.s.id,
      targetEntityId: row.t.id
    }));
  }
  
  async searchFacts(query: MemoryQuery): Promise<Fact[]> {
    const { actorId, text, limit = 20 } = query;
    
    // Simple keyword search for now
    const result = await this.conn.query(
      `MATCH (s:Entity)-[f:Fact]->(t:Entity)
       WHERE f.actorId = $actorId
         AND f.text CONTAINS $text
         AND (f.validUntil IS NULL OR f.validUntil > current_timestamp())
       ORDER BY f.validFrom DESC
       LIMIT $limit
       RETURN f, s, t`,
      { actorId, text: text || '', limit }
    );
    
    return result.getAll().map(row => ({
      ...row.f,
      sourceEntityId: row.s.id,
      targetEntityId: row.t.id
    }));
  }
  
  async close(): Promise<void> {
    this.conn.close();
    this.db.close();
  }
}
```

**Decision**: ~150 lines covers full storage. Kuzu query syntax is SQL-like (easy to read).

### 1.3 Actor Integration (`src/memory/memory-actor.ts`)

```typescript
import { DurableActor } from '../actors/durable-actor';
import { MemoryStorage, Episode, Fact, Entity } from './types';
import { KuzuMemoryStorage } from './storage';

export class ActorMemory {
  constructor(
    private actorId: string,
    private storage: MemoryStorage
  ) {}
  
  // Simple API - actors only need these 4 methods
  async addEpisode(content: string): Promise<string> {
    const episode: Episode = {
      id: crypto.randomUUID(),
      content,
      timestamp: new Date(),
      actorId: this.actorId
    };
    await this.storage.addEpisode(episode);
    return episode.id;
  }
  
  async addFact(
    source: string,
    relation: string,
    target: string,
    text: string
  ): Promise<string> {
    // Ensure entities exist
    const sourceEntity = await this.storage.getEntity(source) || {
      id: source,
      name: source,
      type: 'unknown',
      actorId: this.actorId
    };
    const targetEntity = await this.storage.getEntity(target) || {
      id: target,
      name: target,
      type: 'unknown',
      actorId: this.actorId
    };
    
    await this.storage.addEntity(sourceEntity);
    await this.storage.addEntity(targetEntity);
    
    const fact: Fact = {
      id: crypto.randomUUID(),
      sourceEntityId: source,
      targetEntityId: target,
      relation,
      text,
      validFrom: new Date(),
      episodeIds: [],
      actorId: this.actorId
    };
    
    await this.storage.addFact(fact);
    return fact.id;
  }
  
  async search(query: string): Promise<Fact[]> {
    return this.storage.searchFacts({
      actorId: this.actorId,
      text: query,
      limit: 10
    });
  }
  
  async getRecentEpisodes(limit = 10): Promise<Episode[]> {
    return this.storage.getEpisodes(this.actorId, limit);
  }
  
  async getCurrentFacts(): Promise<Fact[]> {
    return this.storage.getValidFacts(this.actorId);
  }
}

// Mixin pattern for DurableActor
export function withMemory(dbPath?: string) {
  const storage = new KuzuMemoryStorage(dbPath);
  
  return function<T extends new (...args: any[]) => DurableActor>(Base: T) {
    return class extends Base {
      protected memory: ActorMemory;
      
      constructor(...args: any[]) {
        super(...args);
        this.memory = new ActorMemory(this.actorId, storage);
      }
      
      async dispose() {
        await storage.close();
        await super.dispose();
      }
    };
  };
}
```

**Decision**: Mixin pattern keeps it optional. Actors opt-in with one decorator.

### 1.4 Usage Example

```typescript
// Enable memory with one line
@withMemory('./actor-memory.db')
class CustomerServiceActor extends DurableActor {
  async handleMessage(message: string): Promise<string> {
    // Store episode
    await this.memory.addEpisode(message);
    
    // Manually add facts (Phase 1 - no auto-extraction yet)
    if (message.includes('my name is')) {
      const name = this.extractName(message);
      await this.memory.addFact('user', 'has_name', name, `User's name is ${name}`);
    }
    
    // Search memory
    const facts = await this.memory.search('name');
    
    return `I remember: ${facts.map(f => f.text).join(', ')}`;
  }
}
```

**Phase 1 Deliverable**: Manual memory storage with keyword search. ~300 lines total.

---

## Phase 2: Semantic Search (Week 3-4)

**Goal**: Add vector embeddings for semantic search

### Changes Required

#### 2.1 Add Embedding Fields to Types

```typescript
// src/memory/types.ts - ADD these fields
export interface Fact {
  // ... existing fields ...
  embedding?: number[];  // ADD: Vector for semantic search
}

export interface MemoryQuery {
  // ... existing fields ...
  embedding?: number[];  // ADD: Vector query
}
```

#### 2.2 Add Embedding Support to Storage

```typescript
// src/memory/storage.ts - UPDATE schema
private async initSchema(): Promise<void> {
  // ... existing tables ...
  
  // UPDATE Fact table to include embedding
  await this.conn.query(`
    CREATE REL TABLE IF NOT EXISTS Fact(
      FROM Entity TO Entity,
      id STRING,
      relation STRING,
      text STRING,
      embedding FLOAT[1536],  -- ADD: Vector field
      validFrom TIMESTAMP,
      validUntil TIMESTAMP,
      episodeIds STRING[],
      actorId STRING
    )
  `);
}

// ADD: Vector search method
async searchFacts(query: MemoryQuery): Promise<Fact[]> {
  const { actorId, text, embedding, limit = 20 } = query;
  
  if (embedding) {
    // Semantic search
    const result = await this.conn.query(
      `MATCH (s:Entity)-[f:Fact]->(t:Entity)
       WHERE f.actorId = $actorId
         AND f.embedding IS NOT NULL
         AND (f.validUntil IS NULL OR f.validUntil > current_timestamp())
       WITH f, s, t, array_cosine_similarity(f.embedding, $embedding) AS score
       WHERE score > 0.7
       ORDER BY score DESC
       LIMIT $limit
       RETURN f, s, t, score`,
      { actorId, embedding, limit }
    );
    return result.getAll().map(row => ({ ...row.f, sourceEntityId: row.s.id, targetEntityId: row.t.id }));
  }
  
  // Fallback to keyword search (existing code)
  // ...
}
```

#### 2.3 Add Embedder Helper

```typescript
// src/memory/embedder.ts - NEW FILE (40 lines)
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

#### 2.4 Update ActorMemory

```typescript
// src/memory/memory-actor.ts - UPDATE
export class ActorMemory {
  constructor(
    private actorId: string,
    private storage: MemoryStorage,
    private embedder?: Embedder  // ADD: Optional embedder
  ) {}
  
  async addFact(
    source: string,
    relation: string,
    target: string,
    text: string
  ): Promise<string> {
    // ... existing entity code ...
    
    const fact: Fact = {
      id: crypto.randomUUID(),
      sourceEntityId: source,
      targetEntityId: target,
      relation,
      text,
      validFrom: new Date(),
      episodeIds: [],
      actorId: this.actorId,
      embedding: this.embedder ? await this.embedder.embed(text) : undefined  // ADD
    };
    
    await this.storage.addFact(fact);
    return fact.id;
  }
  
  async search(query: string): Promise<Fact[]> {
    const embedding = this.embedder ? await this.embedder.embed(query) : undefined;
    
    return this.storage.searchFacts({
      actorId: this.actorId,
      text: query,
      embedding,  // ADD: Semantic search if embedder available
      limit: 10
    });
  }
}

// Update withMemory to accept embedder
export function withMemory(config?: { dbPath?: string; apiKey?: string }) {
  const storage = new KuzuMemoryStorage(config?.dbPath);
  const embedder = config?.apiKey ? new Embedder(config.apiKey) : undefined;
  
  return function<T extends new (...args: any[]) => DurableActor>(Base: T) {
    return class extends Base {
      protected memory: ActorMemory;
      
      constructor(...args: any[]) {
        super(...args);
        this.memory = new ActorMemory(this.actorId, storage, embedder);
      }
      
      async dispose() {
        await storage.close();
        await super.dispose();
      }
    };
  };
}
```

#### 2.5 Usage with Semantic Search

```typescript
@withMemory({ 
  dbPath: './memory.db',
  apiKey: process.env.OPENAI_API_KEY  // ADD: Enable semantic search
})
class SmartActor extends DurableActor {
  async handleMessage(message: string): Promise<string> {
    await this.memory.addEpisode(message);
    
    // Add fact (automatically gets embedding)
    await this.memory.addFact('user', 'likes', 'pizza', 'User likes pizza');
    
    // Semantic search (finds "pizza" when querying "food preferences")
    const facts = await this.memory.search('food preferences');
    
    return `I remember: ${facts.map(f => f.text).join(', ')}`;
  }
}
```

**Phase 2 Deliverable**: Semantic search with ~100 lines added. Total ~400 lines.

---

## Phase 3: Auto-Extraction (Week 5-8)

**Goal**: LLM automatically extracts entities and facts

### 3.1 Add Extractor

```typescript
// src/memory/extractor.ts - NEW FILE (80 lines)
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
      model: 'gpt-4o-mini',  // Cheaper model for extraction
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

### 3.2 Update ActorMemory with Auto-Extract

```typescript
// src/memory/memory-actor.ts - UPDATE
export class ActorMemory {
  constructor(
    private actorId: string,
    private storage: MemoryStorage,
    private embedder?: Embedder,
    private extractor?: FactExtractor  // ADD
  ) {}
  
  async addEpisode(content: string, options?: { extract?: boolean }): Promise<string> {
    // Store episode
    const episode: Episode = {
      id: crypto.randomUUID(),
      content,
      timestamp: new Date(),
      actorId: this.actorId
    };
    await this.storage.addEpisode(episode);
    
    // Auto-extract if enabled
    if (options?.extract && this.extractor) {
      await this.extractAndStore(episode);
    }
    
    return episode.id;
  }
  
  private async extractAndStore(episode: Episode): Promise<void> {
    // Get recent episodes for context
    const recent = await this.getRecentEpisodes(3);
    const context = recent.slice(0, -1).map(e => e.content);  // Exclude current
    
    // Extract entities and facts
    const result = await this.extractor!.extract(episode.content, context);
    
    // Store entities
    for (const entity of result.entities) {
      const existing = await this.storage.getEntity(entity.name);
      if (!existing) {
        await this.storage.addEntity({
          id: entity.name,
          name: entity.name,
          type: entity.type,
          actorId: this.actorId
        });
      }
    }
    
    // Store facts
    for (const fact of result.facts) {
      await this.addFact(fact.source, fact.relation, fact.target, fact.text);
    }
  }
}

// Update withMemory
export function withMemory(config?: { 
  dbPath?: string; 
  apiKey?: string;
  autoExtract?: boolean;  // ADD
}) {
  const storage = new KuzuMemoryStorage(config?.dbPath);
  const embedder = config?.apiKey ? new Embedder(config.apiKey) : undefined;
  const extractor = config?.apiKey && config?.autoExtract 
    ? new FactExtractor(config.apiKey) 
    : undefined;
  
  return function<T extends new (...args: any[]) => DurableActor>(Base: T) {
    return class extends Base {
      protected memory: ActorMemory;
      
      constructor(...args: any[]) {
        super(...args);
        this.memory = new ActorMemory(this.actorId, storage, embedder, extractor);
      }
      
      async dispose() {
        await storage.close();
        await super.dispose();
      }
    };
  };
}
```

### 3.3 Usage with Auto-Extraction

```typescript
@withMemory({ 
  dbPath: './memory.db',
  apiKey: process.env.OPENAI_API_KEY,
  autoExtract: true  // ADD: Enable auto-extraction
})
class FullyAutomatedActor extends DurableActor {
  async handleMessage(message: string): Promise<string> {
    // Automatically extracts entities and facts
    await this.memory.addEpisode(message, { extract: true });
    
    // Search semantically
    const facts = await this.memory.search('user information');
    
    return `I remember: ${facts.map(f => f.text).join(', ')}`;
  }
}
```

**Phase 3 Deliverable**: Full auto-extraction with ~150 lines added. Total ~550 lines.

---

## Temporal Reasoning (Optional Enhancement)

Add fact invalidation when contradictions are detected:

```typescript
// src/memory/temporal.ts - NEW FILE (60 lines)
export class TemporalReasoning {
  constructor(private llm: OpenAI) {}
  
  async detectContradiction(
    newFact: string,
    existingFacts: string[]
  ): Promise<number[]> {
    const response = await this.llm.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: 'Which existing facts contradict the new fact? Return array of indices.'
      }, {
        role: 'user',
        content: `New: ${newFact}\nExisting: ${JSON.stringify(existingFacts)}`
      }],
      response_format: { type: 'json_object' }
    });
    
    const result = JSON.parse(response.choices[0].message.content || '{"contradictions":[]}');
    return result.contradictions;
  }
}

// Add to ActorMemory.addFact():
async addFact(source: string, relation: string, target: string, text: string): Promise<string> {
  // ... existing code ...
  
  // Check for contradictions
  if (this.temporal) {
    const existing = await this.storage.getValidFacts(this.actorId);
    const sameTopic = existing.filter(f => 
      f.sourceEntityId === source && f.relation === relation
    );
    
    if (sameTopic.length > 0) {
      const contradicted = await this.temporal.detectContradiction(
        text,
        sameTopic.map(f => f.text)
      );
      
      // Mark contradicted facts as invalid
      for (const idx of contradicted) {
        sameTopic[idx].validUntil = new Date();
        await this.storage.addFact(sameTopic[idx]);  // Update
      }
    }
  }
  
  // ... rest of existing code ...
}
```

---

## Configuration Matrix

```typescript
// Maximum flexibility with minimal code

// Level 0: No memory
class BasicActor extends DurableActor {}

// Level 1: Manual memory (keyword search only)
@withMemory({ dbPath: './memory.db' })
class ManualActor extends DurableActor {
  async handle(msg: string) {
    await this.memory.addEpisode(msg);
    await this.memory.addFact('user', 'said', msg, msg);  // Manual
  }
}

// Level 2: Semantic search (no auto-extract)
@withMemory({ 
  dbPath: './memory.db',
  apiKey: process.env.OPENAI_API_KEY 
})
class SemanticActor extends DurableActor {
  async handle(msg: string) {
    await this.memory.addEpisode(msg);
    const facts = await this.memory.search('preferences');  // Semantic!
  }
}

// Level 3: Full auto-extraction + semantic search
@withMemory({ 
  dbPath: './memory.db',
  apiKey: process.env.OPENAI_API_KEY,
  autoExtract: true 
})
class AutoActor extends DurableActor {
  async handle(msg: string) {
    await this.memory.addEpisode(msg, { extract: true });  // Auto!
  }
}

// Level 4: Shared memory across actors
const sharedStorage = new KuzuMemoryStorage('./shared-memory.db');

@withMemory({ storage: sharedStorage, apiKey: '...' })
class TeamActor1 extends DurableActor {}

@withMemory({ storage: sharedStorage, apiKey: '...' })
class TeamActor2 extends DurableActor {}
// Both actors share the same memory graph!
```

---

## Storage Portability

```typescript
// src/memory/types.ts - Storage abstraction already supports this

// Swap storage backend with zero code changes:

// Option A: Kuzu (embedded)
const storage = new KuzuMemoryStorage('./memory.db');

// Option B: Redis (in-memory, fast)
const storage = new RedisMemoryStorage({ host: 'localhost', port: 6379 });

// Option C: CosmosDB (Azure, durable)
const storage = new CosmosMemoryStorage({ endpoint: '...', key: '...' });

// Use same interface
@withMemory({ storage })
class MyActor extends DurableActor {}
```

To add a new backend, implement `MemoryStorage` interface (~150 lines).

---

## Testing Strategy

```typescript
// tests/memory/storage.test.ts
describe('KuzuMemoryStorage', () => {
  let storage: KuzuMemoryStorage;
  
  beforeEach(() => {
    storage = new KuzuMemoryStorage(':memory:');
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
  
  it('searches facts by keyword', async () => {
    // Add entities
    await storage.addEntity({ id: 'alice', name: 'Alice', type: 'person', actorId: 'actor1' });
    await storage.addEntity({ id: 'techstart', name: 'TechStart', type: 'company', actorId: 'actor1' });
    
    // Add fact
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
    
    // Search
    const results = await storage.searchFacts({ actorId: 'actor1', text: 'works' });
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain('TechStart');
  });
  
  it('temporal queries work', async () => {
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
    
    // Query as of June 2024 (should find it)
    const pastFacts = await storage.getValidFacts('actor1', new Date('2024-05-01'));
    expect(pastFacts).toHaveLength(1);
    
    // Query as of now (should not find it)
    const currentFacts = await storage.getValidFacts('actor1', new Date());
    expect(currentFacts).toHaveLength(0);
  });
});
```

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Add episode | <5ms | Just insert to Kuzu |
| Add fact (manual) | <10ms | Insert + maybe embedding |
| Add fact (auto-extract) | <2s | LLM call dominates |
| Keyword search | <20ms | Kuzu full-text search |
| Semantic search | <50ms | Vector similarity in Kuzu |
| Get recent episodes | <5ms | Simple SELECT |
| Temporal query | <30ms | Filter on timestamps |

**Optimization levers**:
1. Batch embeddings (10x faster)
2. Cache LLM extractions
3. Use cheaper models (gpt-4o-mini vs gpt-4)
4. Async extraction (don't block actor)

---

## Cost Estimates

### Phase 1 (No LLM)
- **Cost**: $0 per operation
- **Functionality**: Manual fact storage, keyword search

### Phase 2 (Embeddings Only)
- **Embedding cost**: $0.0001 per fact (~$1 per 10,000 facts)
- **Functionality**: Semantic search

### Phase 3 (Auto-Extraction)
- **Extraction cost**: ~$0.0005 per episode with gpt-4o-mini
- **Total per episode**: ~$0.001 (extraction + embedding)
- **Monthly at 1000 episodes/day**: ~$30

**Cost controls**:
```typescript
const config = {
  budget: {
    maxCostPerDay: 10,
    alertAt: 0.8
  },
  extraction: {
    model: 'gpt-4o-mini',  // Cheaper
    batchSize: 10,         // Batch for efficiency
    skipIfShort: true      // Skip "ok", "thanks"
  }
};
```

---

## Migration Path

### Existing Actors (No Code Changes)
```typescript
// Old code still works
class MyActor extends DurableActor {
  async handle(msg: string) {
    // No memory
  }
}
```

### Add Memory (One Line)
```typescript
@withMemory({ dbPath: './memory.db' })
class MyActor extends DurableActor {
  async handle(msg: string) {
    await this.memory.addEpisode(msg);  // ADD
  }
}
```

### Enable Semantic Search (Config Change)
```typescript
@withMemory({ 
  dbPath: './memory.db',
  apiKey: process.env.OPENAI_API_KEY  // CHANGE
})
class MyActor extends DurableActor {
  async handle(msg: string) {
    await this.memory.addEpisode(msg);
    const facts = await this.memory.search('preferences');  // Now semantic!
  }
}
```

### Enable Auto-Extract (Config Change)
```typescript
@withMemory({ 
  dbPath: './memory.db',
  apiKey: process.env.OPENAI_API_KEY,
  autoExtract: true  // CHANGE
})
class MyActor extends DurableActor {
  async handle(msg: string) {
    await this.memory.addEpisode(msg, { extract: true });  // Now automatic!
  }
}
```

---

## Implementation Checklist

### Week 1-2: Core Storage
- [ ] Create `src/memory/types.ts` (interfaces)
- [ ] Install Kuzu: `npm install kuzu`
- [ ] Create `src/memory/storage.ts` (Kuzu wrapper)
- [ ] Create `src/memory/memory-actor.ts` (actor integration)
- [ ] Write tests for basic CRUD
- [ ] Demo: Manual fact storage working

### Week 3-4: Semantic Search
- [ ] Add embedding fields to types
- [ ] Update Kuzu schema with FLOAT[] columns
- [ ] Create `src/memory/embedder.ts`
- [ ] Update storage with vector search
- [ ] Update ActorMemory with semantic search
- [ ] Write tests for semantic search
- [ ] Demo: "pizza" found when searching "food"

### Week 5-8: Auto-Extraction
- [ ] Create `src/memory/extractor.ts` (LLM extraction)
- [ ] Update ActorMemory with auto-extract option
- [ ] Add batching for performance
- [ ] Add cost tracking
- [ ] Write tests for extraction accuracy
- [ ] Demo: Full conversation → automatic knowledge graph

### Optional Enhancements
- [ ] Temporal reasoning (fact invalidation)
- [ ] Shared graphs (multi-actor collaboration)
- [ ] Alternative storage backends (Redis, CosmosDB)
- [ ] Memory visualization UI
- [ ] Export/import utilities

---

## Success Metrics

**Phase 1 Complete When**:
- ✅ Actor can store episodes
- ✅ Actor can manually add facts
- ✅ Actor can search facts by keyword
- ✅ All tests pass
- ✅ <300 lines of code

**Phase 2 Complete When**:
- ✅ Semantic search works (query "food" finds "pizza")
- ✅ Performance: <50ms for semantic search
- ✅ All tests pass
- ✅ <400 lines of code

**Phase 3 Complete When**:
- ✅ Auto-extraction works (conversation → graph automatically)
- ✅ Cost: <$0.001 per episode
- ✅ Accuracy: >70% entities extracted correctly
- ✅ All tests pass
- ✅ <550 lines of code

---

## Key Design Decisions

1. **Kuzu over CosmosDB**: Embedded, zero infrastructure, SQL-like syntax
2. **Manual first**: Auto-extract is opt-in, not default
3. **Simple interfaces**: 4 methods cover 90% of use cases
4. **Mixin pattern**: Memory is optional, non-invasive
5. **Storage abstraction**: Easy to swap backends later
6. **Embeddings inline**: Start simple, optimize later if needed
7. **No frameworks**: Just TypeScript, Kuzu, OpenAI
8. **Test-first**: Every feature has tests

---

## Next Steps

1. **Prototype Week 1**: Core storage (150 lines)
2. **Demo to team**: Get feedback on API
3. **Week 2-3**: Add semantic search (100 lines)
4. **Evaluate**: Is this useful? Should we continue?
5. **Week 4-8**: Add auto-extraction if valuable (150 lines)

**Total Investment**: 6-8 weeks, ~550 lines of code, massive functionality gain.

**Decision Point**: After Phase 1 (2 weeks), evaluate if manual memory is useful. If yes, continue to Phase 2. If no, pivot.

Ready to start? 🚀
