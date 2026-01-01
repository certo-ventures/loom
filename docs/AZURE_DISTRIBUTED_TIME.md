# Azure Services for Distributed Time & Ordering

## Summary

Yes! Azure has several services that handle distributed time and ordering:

## 1. Azure Cosmos DB - Built-in Logical Timestamps

**What it provides:**
- **Session Tokens**: Partition-bound tokens that track causality within a session
- **`_ts` field**: Server-side timestamp on every document (monotonic per partition)
- **Consistency Levels**: 5 levels from Strong to Eventual
- **Last-Write-Wins (LWW)**: Conflict resolution using `_ts`

**How it works:**
```typescript
// Cosmos DB automatically adds _ts to every document
{
  id: "fact-123",
  text: "Alice works at TechStart",
  _ts: 1704067200  // Seconds since epoch, server-assigned
}

// Query with consistency guarantees
const client = new CosmosClient({ 
  endpoint, 
  key,
  consistencyLevel: "Session"  // Read-your-writes guaranteed
});
```

**Relevant for Graph Memory:**
- Cosmos DB Gremlin API (graph database) inherits all these features
- Each edge/node gets automatic `_ts` field
- Session consistency = causality within a session
- Bounded staleness = configurable lag between regions

**Pros:**
- ✅ Built-in, no manual clock management
- ✅ Multi-region replication with ordering guarantees
- ✅ TLA+ formally verified consistency models
- ✅ We're already planning to use Cosmos DB

**Cons:**
- ⚠️ `_ts` is server-side (not client-controlled)
- ⚠️ Session tokens are partition-bound
- ⚠️ Strong consistency requires all-region commit (latency hit)

## 2. Azure Event Hubs - Sequence Numbers

**What it provides:**
- **Sequence Numbers**: Monotonic per partition, server-assigned
- **Offset**: Position in partition (byte-based)
- **Partition Key**: Route related events to same partition (ordering guarantee)

**How it works:**
```typescript
// Event Hubs automatically adds sequence number
interface EventData {
  body: any;
  sequenceNumber: number;  // Auto-assigned, monotonic per partition
  offset: string;          // Position in partition
  enqueuedTimeUtc: Date;   // Server timestamp
  partitionKey?: string;   // For routing
}

// Events in same partition are totally ordered
await producer.send({
  body: { factId: "123", action: "create" },
  partitionKey: "actor-1"  // All actor-1 events → same partition → ordered
});
```

**Relevant for Graph Memory:**
- Could use Event Hubs for fact synchronization between actors
- Sequence numbers provide total order within a partition
- Natural fit for event sourcing patterns

**Pros:**
- ✅ Perfect for event streams
- ✅ Guaranteed ordering within partition
- ✅ High throughput (millions of events/sec)
- ✅ Built-in capture to Data Lake/Blob

**Cons:**
- ⚠️ Not a database (1-90 day retention only)
- ⚠️ Ordering only within partition, not across
- ⚠️ Adds complexity (need separate storage)

## 3. Azure Service Bus - Message Sequences

**What it provides:**
- **SequenceNumber**: Int64, monotonic, server-assigned
- **EnqueuedTimeUtc**: Server timestamp
- **Sessions**: Ordered message processing for related messages

**Similar to Event Hubs but designed for messaging, not streaming.**

## Recommendation for Loom Graph Memory

### Option A: Use Cosmos DB `_ts` (Simplest)

**Implementation:**
```typescript
interface Fact {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relation: string;
  text: string;
  
  // Cosmos DB auto-adds this
  _ts: number;  // Server timestamp, use for ordering
  
  // Keep for human readability
  created_at: Date;
  
  // Keep for semantic queries
  validFrom: Date;
  validUntil?: Date;
  
  actorId: string;
  graph_id: string;
}

// Query facts ordered by _ts
g.V().hasLabel('Fact')
  .has('graph_id', 'default')
  .order().by('_ts', desc)
```

**Pros:**
- Zero additional code
- Cosmos DB handles it
- Works cross-region with consistency guarantees
- Server-side = immune to client clock issues

**Cons:**
- Can't control the timestamp
- `_ts` granularity is seconds (not milliseconds)
- If multiple facts created in same second, need secondary sort

### Option B: Hybrid - Cosmos `_ts` + Lamport for Causality

**Implementation:**
```typescript
interface Fact {
  id: string;
  // ... other fields
  
  _ts: number;          // Cosmos auto-assigned (primary sort)
  lamport_ts: number;   // Client logical clock (secondary sort, captures causality)
  
  actorId: string;
  graph_id: string;
}

class ActorMemory {
  private lamportClock = 0;
  
  async addFact(..., options?: { lamport_ts?: number }) {
    // Sync Lamport clock with received facts
    const lamport_ts = options?.lamport_ts
      ? Math.max(this.lamportClock, options.lamport_ts) + 1
      : ++this.lamportClock;
    
    const fact = {
      lamport_ts,
      // Cosmos will add _ts
      ...
    };
    
    await cosmos.createDocument(fact);
  }
}

// Query: ORDER BY _ts DESC, lamport_ts DESC
// This handles both time ordering AND causality
```

**Pros:**
- Server time for coarse ordering (`_ts`)
- Lamport for fine-grained causality
- Best of both worlds
- Can detect causal relationships

**Cons:**
- Slightly more complex
- Need to maintain Lamport clock

### Option C: Pure Lamport (No Cloud Dependencies)

Keep our current implementation - works anywhere, portable across storage backends.

## Decision Matrix

| Factor | Cosmos `_ts` Only | Cosmos `_ts` + Lamport | Pure Lamport |
|--------|------------------|----------------------|--------------|
| Simplicity | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Causality Tracking | ⚠️ Approximate | ✅ Perfect | ✅ Perfect |
| Cloud-Native | ✅ Yes | ✅ Yes | ❌ No |
| Portability | ❌ Cosmos-only | ❌ Cosmos-only | ✅ Any storage |
| Client Clock Issues | ✅ Immune | ✅ Immune to time | ⚠️ Sequence reset |
| Multi-Region | ✅ Built-in | ✅ Built-in | 🤷 Manual |
| Code Complexity | Low | Medium | Low |

## My Recommendation

### **Hybrid Approach: Cosmos `_ts` + Lamport**

**Rationale:**
1. We're using Cosmos DB anyway (per earlier docs)
2. `_ts` gives us server-side ordering for free
3. Lamport adds causality tracking for fact invalidation logic
4. Minimal additional code (~20 lines)
5. Best correctness guarantees

**Migration path:**
- Phase 1: Start with Cosmos `_ts` only (simplest)
- Phase 2: Add Lamport if we need better causality tracking
- Storage abstraction makes this easy to add later

## Code Changes Needed

### Minimal (Cosmos _ts only):
```typescript
// Remove sequence/lamport from Episode/Entity (not needed cross-actor)
interface Episode {
  // Let Cosmos _ts handle ordering
  created_at: Date;  // Human readable only
  // NO sequence field
}

// Keep Lamport for Facts (causality matters here)
interface Fact {
  lamport_ts: number;  // Client-side causality
  // Cosmos adds _ts automatically
  created_at: Date;    // Human readable
  validFrom: Date;     // Semantic time
  validUntil?: Date;
}
```

### Storage queries:
```gremlin
// Cosmos Gremlin - order by _ts
g.V().hasLabel('Episode')
  .has('actorId', 'actor-1')
  .order().by('_ts', desc)
  .limit(10)

// Facts: order by lamport_ts (causality), then _ts (server time)
g.E().hasLabel('Fact')
  .has('graph_id', 'default')
  .order().by('lamport_ts', desc).by('_ts', desc)
```

## Summary

**Yes, Azure has this covered!**

Use **Cosmos DB `_ts`** (server-side timestamps) as your foundation. It's built-in, proven, and handles distributed time correctly across regions with formal consistency guarantees.

Add **Lamport timestamps for Facts** if you need causal ordering for fact invalidation logic.

This is simpler than rolling our own and leverages Azure's TLA+ verified consistency models.
