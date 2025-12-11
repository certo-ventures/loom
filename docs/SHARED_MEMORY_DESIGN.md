# Shared Memory Store - Deep Design Document

## Problem Statement

Currently, each actor has **isolated memory**. When multiple actors need to collaborate (e.g., a research agent + writing agent + reviewer agent), they can't share context efficiently. They have to:
1. Pass everything via messages (verbose, expensive)
2. Store in state and poll (slow, inefficient)
3. Use external coordination (complex)

**We need:** A shared memory system where agents can read/write common context.

---

## Use Cases

### 1. Multi-Agent Collaboration
```typescript
// Research agent writes findings
await sharedMemory.write('research-findings', {
  topic: 'AI Safety',
  sources: [...],
  summary: '...'
})

// Writing agent reads those findings
const findings = await sharedMemory.read('research-findings')
await sharedMemory.write('draft-article', article)

// Reviewer reads the draft
const draft = await sharedMemory.read('draft-article')
```

### 2. Conversation History (Group Chat)
```typescript
// All agents in a group share conversation history
await sharedMemory.append('chat:team-alpha', {
  role: 'assistant',
  agent: 'researcher',
  content: 'I found 3 relevant papers...'
})

// Any agent can read the full history
const history = await sharedMemory.readList('chat:team-alpha')
```

### 3. Workflow State
```typescript
// Workflow coordinator stores current state
await sharedMemory.write('workflow:onboarding:123', {
  step: 'email-verification',
  userEmail: 'user@example.com',
  startedAt: '...'
})

// Any actor in the workflow can check state
const state = await sharedMemory.read('workflow:onboarding:123')
```

### 4. Knowledge Base
```typescript
// Store learned knowledge
await sharedMemory.write('knowledge:customer-preferences', {
  userId: '123',
  preferences: ['dark-mode', 'email-notifications'],
  lastUpdated: '...'
})

// Any agent can query knowledge
const prefs = await sharedMemory.read('knowledge:customer-preferences')
```

---

## Design Options

### Option 1: Redis-Based (RECOMMENDED)
**Storage:** Redis (already have it for BullMQ)
**Structure:** Key-value with namespaces

```typescript
interface SharedMemoryStore {
  // Simple key-value
  write(key: string, value: any, ttl?: number): Promise<void>
  read(key: string): Promise<any | null>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  
  // List operations (for conversation history)
  append(key: string, value: any, maxLength?: number): Promise<void>
  readList(key: string, start?: number, end?: number): Promise<any[]>
  
  // Hash operations (for structured data)
  hset(key: string, field: string, value: any): Promise<void>
  hget(key: string, field: string): Promise<any | null>
  hgetall(key: string): Promise<Record<string, any>>
  
  // Set operations (for unique collections)
  sadd(key: string, ...values: any[]): Promise<void>
  smembers(key: string): Promise<any[]>
  
  // Pub/Sub (for notifications)
  publish(channel: string, message: any): Promise<void>
  subscribe(channel: string, callback: (message: any) => void): () => void
  
  // Atomic operations
  incr(key: string): Promise<number>
  decr(key: string): Promise<number>
}
```

**Pros:**
- ✅ Fast (in-memory)
- ✅ Rich data structures (lists, hashes, sets)
- ✅ Pub/Sub for real-time updates
- ✅ TTL support for auto-cleanup
- ✅ Already have Redis running

**Cons:**
- ⚠️ Not durable (data lost on Redis restart)
- ⚠️ Limited to Redis memory

**Solution:** Hybrid approach - critical data also saved to Cosmos

---

### Option 2: Cosmos DB-Based
**Storage:** Cosmos DB
**Structure:** Document store with namespaces

```typescript
interface SharedMemoryDocument {
  id: string // key
  partitionKey: string // namespace (e.g., 'workflow:123')
  value: any
  createdAt: string
  expiresAt?: string
  version: number
}
```

**Pros:**
- ✅ Durable
- ✅ Global distribution
- ✅ Complex queries
- ✅ Already have Cosmos

**Cons:**
- ❌ Slower than Redis
- ❌ More expensive
- ❌ Overkill for ephemeral data

---

### Option 3: Hybrid (BEST!)
**Strategy:** Redis for hot data, Cosmos for cold/critical data

```typescript
class HybridSharedMemory implements SharedMemoryStore {
  constructor(
    private redis: Redis,
    private cosmos: CosmosDB
  ) {}
  
  async write(key: string, value: any, options?: {
    ttl?: number
    persistent?: boolean // Save to Cosmos too
  }): Promise<void> {
    // Always write to Redis (fast)
    await this.redis.set(key, JSON.stringify(value), options?.ttl)
    
    // Optionally persist to Cosmos (durable)
    if (options?.persistent) {
      await this.cosmos.upsert({
        id: key,
        partitionKey: this.getNamespace(key),
        value,
        updatedAt: new Date().toISOString()
      })
    }
  }
  
  async read(key: string): Promise<any | null> {
    // Try Redis first (fast path)
    const cached = await this.redis.get(key)
    if (cached) return JSON.parse(cached)
    
    // Fall back to Cosmos (slow path, but durable)
    const doc = await this.cosmos.read(key, this.getNamespace(key))
    if (doc) {
      // Repopulate Redis cache
      await this.redis.set(key, JSON.stringify(doc.value))
      return doc.value
    }
    
    return null
  }
}
```

---

## Namespace Design

**Key Pattern:** `<namespace>:<scope>:<identifier>`

Examples:
- `chat:team-alpha:messages` - Group chat history
- `workflow:onboarding:123:state` - Workflow state
- `knowledge:customer:456:preferences` - Customer knowledge
- `agent:researcher:memory` - Agent-specific memory
- `temp:cache:xyz` - Temporary cache

**Benefits:**
- Clear organization
- Easy to query by namespace
- Simple access control
- Easy cleanup (delete namespace)

---

## Access Control

### Option A: No Access Control (Simple)
Any actor can read/write any key. Trust-based.

**Pros:** Simple, fast
**Cons:** No security

---

### Option B: Namespace-Based Access (Recommended)
Actors specify their namespace on creation:

```typescript
class AIAgent extends Actor {
  private sharedMemory: SharedMemoryStore
  
  constructor(context: ActorContext) {
    super(context)
    this.sharedMemory = new SharedMemoryStore({
      namespace: context.namespace || 'global',
      actorId: context.actorId
    })
  }
  
  async execute(input: any) {
    // Can only write to own namespace or global
    await this.sharedMemory.write('findings', findings) // key: 'research:agent-123:findings'
    
    // Can read from allowed namespaces
    await this.sharedMemory.read('chat:team-alpha:messages')
  }
}
```

**Access Rules:**
- Can always write to: `<own-namespace>:<actor-id>:*`
- Can read from: Any namespace they're subscribed to
- Global namespace: `global:*` (everyone can read/write)

---

### Option C: RBAC (Complex, Maybe Later)
Role-based access control with permissions.

**Skip for now** - adds too much complexity

---

## Memory Types

### 1. Ephemeral Memory (Redis only, TTL)
**Use:** Temporary coordination, caches
**TTL:** Seconds to hours
**Example:** `temp:cache:api-response`

### 2. Session Memory (Redis + Cosmos backup)
**Use:** Conversation history, workflow state
**TTL:** Hours to days
**Example:** `chat:team:messages`

### 3. Knowledge Memory (Cosmos primary, Redis cache)
**Use:** Long-term learning, preferences
**TTL:** Infinite (or very long)
**Example:** `knowledge:customer:preferences`

---

## Implementation Plan

### Phase 1: Basic Redis Store (~100 lines)
```typescript
export class RedisSharedMemory implements SharedMemoryStore {
  constructor(private redis: Redis) {}
  
  async write(key: string, value: any, ttl?: number): Promise<void>
  async read(key: string): Promise<any | null>
  async delete(key: string): Promise<void>
  async append(key: string, value: any): Promise<void>
  async readList(key: string): Promise<any[]>
}
```

**Integration with Actor:**
```typescript
abstract class Actor {
  protected sharedMemory: SharedMemoryStore
  
  constructor(context: ActorContext) {
    // ...
    this.sharedMemory = context.sharedMemory
  }
}
```

### Phase 2: Hybrid Store (~50 lines)
Add Cosmos backup for persistent data

### Phase 3: Pub/Sub (~50 lines)
Add real-time notifications when data changes

### Phase 4: Namespace Security (~50 lines)
Add access control based on namespaces

**Total: ~250 lines** (more than estimated, but comprehensive!)

---

## API Design

### Simple API (Actor-Facing)
```typescript
class AIAgent extends Actor {
  async execute(input: any) {
    // Write to shared memory
    await this.sharedMemory.write('my-findings', {
      data: '...',
      timestamp: new Date()
    })
    
    // Read from shared memory
    const teamContext = await this.sharedMemory.read('chat:team-alpha:context')
    
    // Append to conversation
    await this.sharedMemory.append('chat:team-alpha:messages', {
      role: 'assistant',
      agent: this.context.actorId,
      content: 'My response...'
    })
    
    // Listen for updates
    this.sharedMemory.subscribe('chat:team-alpha:messages', (msg) => {
      console.log('New message:', msg)
    })
  }
}
```

---

## Memory Patterns

### Pattern 1: Shared Context
```typescript
// Research agent populates shared context
await this.sharedMemory.write('context:project-123', {
  topic: 'AI Safety',
  goals: [...],
  constraints: [...]
})

// All agents read the context
const context = await this.sharedMemory.read('context:project-123')
```

### Pattern 2: Message Board
```typescript
// Agents post messages
await this.sharedMemory.append('board:team-alpha', {
  from: 'researcher',
  message: 'Found 3 papers',
  timestamp: new Date()
})

// Agents read recent messages
const messages = await this.sharedMemory.readList('board:team-alpha', -10) // Last 10
```

### Pattern 3: Task Queue (Using Sets)
```typescript
// Add tasks
await this.sharedMemory.sadd('tasks:pending', 'task-1', 'task-2')

// Claim task
await this.sharedMemory.spop('tasks:pending') // Atomic pop

// Mark complete
await this.sharedMemory.sadd('tasks:completed', 'task-1')
```

### Pattern 4: Knowledge Graph (Using Hashes)
```typescript
// Store structured knowledge
await this.sharedMemory.hset('knowledge:customer:123', 'name', 'Alice')
await this.sharedMemory.hset('knowledge:customer:123', 'tier', 'premium')

// Read all knowledge
const customer = await this.sharedMemory.hgetall('knowledge:customer:123')
```

---

## Questions to Answer

1. **Should shared memory be part of Actor context by default?**
   - ✅ YES - Makes it easy to use
   - Just add to ActorContext

2. **Should we support semantic search in shared memory?**
   - 🟡 LATER - Need embeddings + vector DB
   - Start simple with key-value

3. **How do we handle conflicts (multiple writes)?**
   - Use Redis atomic operations (INCR, LPUSH, etc.)
   - Last-write-wins for simple values
   - Version numbers for conflict detection

4. **How do we prevent memory leaks?**
   - Always set TTLs on ephemeral data
   - Periodic cleanup jobs
   - Namespace-based deletion

5. **How do we handle large data?**
   - Store large data in Blob Storage
   - Put blob reference in shared memory
   - Example: `{ type: 'blob', path: 'blobs/data.json' }`

---

## Comparison to Other Frameworks

### CrewAI
- Uses in-memory dicts (not distributed)
- No persistence
- **We're better:** Redis + Cosmos = distributed + durable

### LangGraph
- Uses checkpoints (not shared memory)
- Each agent has own memory
- **We're better:** True shared memory across agents

### Semantic Kernel
- Has "Kernel Memory" with vector search
- More complex, semantic search
- **We're simpler:** Start with key-value, add vectors later

---

## Decision: Go with Hybrid Approach

**Phase 1 (Now):**
- Redis-based SharedMemoryStore
- Simple key-value + lists
- No access control yet
- ~100 lines

**Phase 2 (Later):**
- Add Cosmos backup for persistent data
- Add pub/sub for real-time updates
- Add namespace-based access
- ~150 more lines

**Total: ~250 lines for a complete shared memory system!**

---

## Next Steps

1. Implement `RedisSharedMemory` class
2. Add `sharedMemory` to `ActorContext`
3. Update `AIAgent` to use shared memory
4. Create examples showing multi-agent collaboration
5. Add tests

**Should I build it now?**
