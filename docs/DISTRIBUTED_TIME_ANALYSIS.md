# Distributed Time Analysis for Graph Memory

## The Problem

Using `created_at: Date` (wall-clock time) for ordering events in distributed systems is **fundamentally broken** due to:

1. **Clock Skew**: Different machines have different times
2. **Clock Drift**: Clocks drift apart over time
3. **No Causality**: Wall clocks don't capture happens-before relationships
4. **NTP Adjustments**: Clocks can jump backwards
5. **Multi-DC**: Different datacenters, different timezones, different latencies

### Example Failure Scenario

```
Actor A (machine 1, clock: 10:00:00.100): Creates fact "Alice works at TechStart"
Actor B (machine 2, clock: 10:00:00.050): Creates fact "Alice leaves TechStart"

Despite B happening AFTER A causally, B's timestamp is EARLIER.
Result: Wrong ordering, broken temporal reasoning!
```

## Options for Distributed Ordering

### Option 1: Lamport Timestamps (Logical Clocks)

**How it works:**
- Each actor maintains a counter
- Increment counter on every local event
- On message receive: counter = max(local, received) + 1
- Guarantees: if A happens-before B, then timestamp(A) < timestamp(B)

**Pros:**
- Simple (single integer)
- Captures causality
- Low overhead
- Used by: Cassandra, Riak, many distributed systems

**Cons:**
- Doesn't give total ordering (concurrent events may have same timestamp)
- Can't tell if events are concurrent or causally ordered
- Single number can conflict across actors

**Implementation for Graph Memory:**
```typescript
interface Fact {
  lamport_ts: number;  // Logical timestamp
  actorId: string;     // Tie-breaker for concurrent events
}

// On fact creation:
lamport_ts = ++this.lamportClock

// When syncing facts from another actor:
this.lamportClock = Math.max(this.lamportClock, receivedFact.lamport_ts) + 1
```

### Option 2: Vector Clocks

**How it works:**
- Each actor maintains a vector of counters (one per actor)
- Increment own position on local event
- Merge vectors on message receive
- Can detect concurrent events

**Pros:**
- Detects concurrency (crucial for conflict resolution)
- Full causality tracking
- Used by: Dynamo, Riak, version control systems

**Cons:**
- Space overhead (vector grows with actor count)
- Complexity (vector comparisons)
- Overkill for many use cases

**Implementation:**
```typescript
interface Fact {
  vector_clock: Record<string, number>;  // { 'actor-1': 5, 'actor-2': 3 }
}
```

### Option 3: Hybrid Logical Clocks (HLC)

**How it works:**
- Combines physical time with logical counter
- Format: (physical_time, logical_counter)
- Monotonic even if wall clock goes backward
- Best of both worlds

**Pros:**
- Close to physical time (human-readable)
- Captures causality
- Monotonic
- Used by: CockroachDB, YugabyteDB

**Cons:**
- More complex than Lamport
- Still needs physical clock (but tolerate skew)

**Implementation:**
```typescript
interface Fact {
  hlc_time: number;     // Physical time component
  hlc_counter: number;  // Logical counter
}
```

### Option 4: Sequence Numbers (Per-Actor Ordering)

**How it works:**
- Each actor maintains monotonic counters for each data type
- Episodes: sequence 1, 2, 3... (per actor)
- Entities: sequence 1, 2, 3... (per actor)
- No cross-actor ordering

**Pros:**
- Simplest solution
- Perfect for single-actor scenarios
- No coordination needed
- Works with existing Loom `turnIndex` pattern

**Cons:**
- Can't order events across actors
- No causality between actors
- Need additional mechanism for shared graphs

**Implementation:**
```typescript
interface Episode {
  actorId: string;
  sequence: number;  // Monotonic per actor
}

// Sorting: ORDER BY actorId, sequence DESC
```

### Option 5: Centralized Sequencer

**How it works:**
- Central service issues monotonic IDs
- Like Twitter Snowflake, Instagram IDs
- Format: timestamp + counter + machine_id

**Pros:**
- Total ordering
- Globally unique
- K-sortable (timestamp-based)

**Cons:**
- Single point of failure
- Latency (network call for every ID)
- Not suitable for edge/offline scenarios
- Defeats actor model isolation

## Comparison Matrix

| Solution | Causality | Concurrency Detection | Overhead | Complexity | Offline Support |
|----------|-----------|----------------------|----------|------------|-----------------|
| Wall Clock | ❌ | ❌ | Low | Simple | ✅ |
| Lamport | ✅ | ❌ | Low | Simple | ✅ |
| Vector Clocks | ✅ | ✅ | High | Complex | ✅ |
| HLC | ✅ | ❌ | Medium | Medium | ✅ |
| Sequence Numbers | Per-Actor | ❌ | Low | Simple | ✅ |
| Centralized | ✅ | ❌ | High | Simple | ❌ |

## What Does Loom Already Use?

Looking at existing Loom code:

```typescript
// src/memory/types.ts - Semantic memory uses turnIndex
interface MemoryItem {
  turnIndex: number;  // Simple monotonic counter
  timestamp: string;  // Wall clock (for display only?)
}

// src/actor/memory-helpers.ts
const turnIndex = Date.now()  // ⚠️ Using wall clock as sequence!
```

**Analysis**: Loom's semantic memory uses `turnIndex` for ordering, but populates it with `Date.now()` which is still a wall clock! This works within a single process but breaks in distributed scenarios.

## What Does Zep/Graphiti Use?

From our earlier GitHub research, Zep/Graphiti uses:
- Wall-clock timestamps for temporal validity (`validFrom`, `invalidAt`)
- UUIDs for identity
- No explicit distributed ordering mechanism visible

**Interpretation**: They may be relying on database-level ordering (like insertion order) or assuming single-writer scenarios.

## Recommendation

### For Graph Memory System

Given the constraints and use cases:

**Hybrid Approach: Sequence Numbers + Lamport Timestamps**

1. **Episodes & Entities**: Use per-actor sequence numbers
   - Most common case: single actor querying own history
   - Simple, efficient, no coordination needed
   - Matches Loom's existing `turnIndex` pattern

2. **Facts**: Use Lamport timestamps
   - Facts are shared across actors (via `graph_id`)
   - Need causal ordering for fact invalidation
   - Lamport captures happens-before for temporal reasoning

3. **Wall Clock**: Keep for human readability only
   - Not used for ordering
   - Useful for debugging, auditing, UI display

### Implementation Strategy

```typescript
export interface Episode {
  id: string;
  actorId: string;
  sequence: number;       // Ordering: per-actor monotonic
  created_at: Date;       // Display only
  // ... other fields
}

export interface Entity {
  id: string;
  actorId: string;
  sequence: number;       // Ordering: per-actor monotonic
  created_at: Date;       // Display only
  // ... other fields
}

export interface Fact {
  id: string;
  actorId: string;        // Creator
  lamport_ts: number;     // Ordering: distributed causality
  created_at: Date;       // Display only
  validFrom: Date;        // Temporal reasoning (semantic)
  validUntil?: Date;      // Temporal reasoning (semantic)
  // ... other fields
}

export class ActorMemory {
  private episodeSequence = 0;
  private entitySequence = 0;
  private lamportClock = 0;
  
  async addEpisode(...) {
    const episode = {
      sequence: ++this.episodeSequence,
      created_at: new Date(),  // Human-readable only
      ...
    };
  }
  
  async addFact(..., options?: { lamport_ts?: number }) {
    // Tick Lamport clock (possibly receiving from another actor)
    const lamport_ts = options?.lamport_ts 
      ? Math.max(this.lamportClock, options.lamport_ts) + 1
      : ++this.lamportClock;
      
    const fact = {
      lamport_ts,
      created_at: new Date(),  // Human-readable only
      ...
    };
  }
}
```

### Storage Layer

```typescript
// Sort episodes by sequence (per actor)
ORDER BY sequence DESC

// Sort facts by Lamport timestamp (global causality)
ORDER BY lamport_ts DESC

// Temporal queries use validFrom/validUntil (semantic time)
WHERE validFrom <= @queryTime 
  AND (validUntil IS NULL OR validUntil > @queryTime)
```

## Edge Cases to Consider

### 1. Actor Restarts
**Problem**: In-memory sequence counters reset to 0

**Solution**: 
- Load max sequence from storage on initialization
- Or: Include actorId + incarnation_id in ordering

### 2. Fact Synchronization
**Problem**: Actor A creates fact, Actor B receives it later

**Solution**:
```typescript
// Actor A creates fact
const fact = { lamport_ts: 42, ... };

// Actor B receives fact and adds to its own memory
await memory.addFact(..., { lamport_ts: 42 });
// B's clock becomes max(B.clock, 42) + 1 = 43
```

### 3. Shared Graph Conflicts
**Problem**: Two actors invalidate the same fact concurrently

**Solution**:
- Use Lamport timestamp to determine winner (last-write-wins)
- Or: Keep both invalidations and show conflict to user
- Or: Use vector clocks for conflict detection (overkill?)

### 4. Cross-Actor Queries
**Problem**: "Show me all episodes across all actors, ordered"

**Solution**:
- Can't order episodes across actors (they use different sequences)
- Options:
  - Use created_at for approximate ordering (best effort)
  - Add session_id or correlation_id for related episodes
  - Facts already handle this via lamport_ts

## Questions for Decision

1. **Do we need to order episodes/entities across actors?**
   - If yes: Use Lamport for everything
   - If no: Sequence numbers are simpler

2. **Do facts from different actors need causality?**
   - If yes: Lamport timestamps (recommended)
   - If no: Could use sequences + actor_id

3. **What about actor restarts?**
   - Persist max sequence in storage?
   - Or accept gaps (episodes 1,2,3... restart → 1,2,3...)?

4. **Is wall-clock time needed for anything besides display?**
   - Probably not for ordering
   - Maybe for TTL/expiration?
   - Maybe for temporal queries ("facts from last week")?

## Recommendation Summary

**Start with:**
- ✅ Sequence numbers for Episodes/Entities (per-actor)
- ✅ Lamport timestamps for Facts (cross-actor causality)
- ✅ Keep `created_at` for human readability
- ✅ `validFrom`/`validUntil` are semantic (not for ordering)

**Later additions (if needed):**
- Persist sequence counters across restarts
- Add correlation IDs for cross-actor queries
- Consider HLC if physical time matters
- Consider vector clocks if conflict detection needed

This gives us:
- Correct ordering in distributed scenarios
- Causality for fact invalidation
- Simplicity for common single-actor case
- Compatibility with Loom's existing patterns
