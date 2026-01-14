# Setting the Record Straight: Dapr vs Loom Actor Models

## TL;DR - The Assessment Was Wrong

The AI's analysis claiming **"Loom uses stateless queue-based workers"** is **fundamentally incorrect**. Loom implements a **full virtual actor model** similar to Dapr/Orleans, with:

✅ **Stateful actors** with in-memory state  
✅ **Actor instance registry** (ActorRuntime)  
✅ **Sticky actor routing** (one actor instance per actorId)  
✅ **Journal-based persistence** (event sourcing)  
✅ **Distributed coordination** (locks to prevent duplicates)  
✅ **Single-threaded actor semantics**  
✅ **Virtual actor pattern** (activation on-demand)  

The confusion likely stems from **pipeline orchestrator** using message queues for task distribution, but that's just ONE execution pattern. Loom supports multiple invocation models.

---

## Detailed Comparison

### What Dapr Does

```typescript
// Dapr approach
// 1. Placement service tracks actor locations
// 2. Direct HTTP/gRPC calls to actor instances
// 3. Actors are sticky (pinned to hosts)
// 4. Single-threaded per actor
// 5. State persisted to external store

// Call actor-123
GET http://host-A:3500/actors/MyActorType/actor-123/method
```

### What Loom Actually Does (Not What The AI Claimed)

```typescript
// Loom approach
// 1. ActorRuntime maintains in-memory actor pool
// 2. getActor(actorId) returns THE actor instance (creates if needed)
// 3. Actors are sticky (one instance per actorId in pool)
// 4. Single-threaded via journal-based execution
// 5. State + journal persisted to Redis/Cosmos

const runtime = new LongLivedActorRuntime({ blobStore, stateStore })

// Get or create actor-123 (SAME instance returned every time)
const actor = await runtime.getActor('actor-123', 'MyActorType', context)

// Actor maintains state between calls
await actor.execute({ method: 'increment' })
await actor.execute({ method: 'getValue' }) // State persists!
```

---

## Evidence from Loom Codebase

### 1. Actor Pool (ActorRuntime Registry)

**File**: `src/actor/actor-runtime.ts`

```typescript
export class LongLivedActorRuntime {
  // THIS IS THE REGISTRY - not "vestigial"!
  private actorPool = new Map<string, Actor>()
  private actorLastUsed = new Map<string, number>()
  private actorLocks = new Map<string, ActorLock>()
  
  /**
   * Get or create long-lived actor
   * Returns THE SAME INSTANCE for same actorId (sticky routing!)
   */
  async getActor(actorId: string, actorType: string, context: ActorContext): Promise<Actor> {
    // Check pool first - REUSE existing actor instance
    let actor = this.actorPool.get(actorId)
    
    if (actor) {
      this.actorLastUsed.set(actorId, Date.now())
      return actor  // ← STICKY: same instance every time!
    }
    
    // Acquire distributed lock (prevent duplicates across hosts)
    if (this.coordinationAdapter) {
      const lock = await this.coordinationAdapter.acquireLock(actorId, 60000)
      if (!lock) {
        throw new Error(`Actor ${actorId} locked by another instance`)
      }
      this.actorLocks.set(actorId, lock)
    }
    
    // Create new actor instance
    const definition = await this.resolveActorDefinition(actorType)
    let newActor: Actor
    
    if (definition.type === 'typescript') {
      newActor = new definition.actorClass(context)
    } else if (definition.type === 'wasm') {
      newActor = new WASMActorAdapter(definition.blobPath, this.blobStore, context)
    }
    
    // Restore state from durable storage
    if (this.stateStore) {
      const savedState = await this.stateStore.load(actorId)
      if (savedState) {
        (actor as any).state = savedState.state  // ← STATEFUL!
        
        // Restore journal for deterministic replay
        if (savedState.metadata?.journal) {
          actor.loadJournal(savedState.metadata.journal)
        }
      }
    }
    
    // Add to pool (registry)
    this.actorPool.set(actorId, newActor)  // ← STICKY REGISTRATION!
    this.actorLastUsed.set(actorId, Date.now())
    
    return newActor
  }
  
  /**
   * Route message to correct actor instance
   */
  async routeMessage(message: Message, context: ActorContext): Promise<void> {
    const actorType = (message.metadata as any).actorType || 'unknown'
    
    // Gets THE actor instance from registry
    const actor = await this.getActor(message.actorId, actorType, context)
    
    // Record in journal (event sourcing)
    actor.recordInvocation(message)
    
    // Persist state + journal
    await this.persistInvocationSnapshot(message, actorType, actor)
    
    // Execute on THIS specific actor instance
    await actor.execute(message.payload)
  }
}
```

**This is NOT "vestigial"** - it's the core actor registry!

---

### 2. Stateful Actors with In-Memory State

**File**: `src/actor/actor.ts`

```typescript
/**
 * Base Actor class - all actors extend this
 * Uses journal-based execution for deterministic replay
 */
export abstract class Actor {
  // IN-MEMORY STATE (not stateless!)
  protected state: Record<string, unknown>
  protected context: ActorContext
  
  // Simple key-value state API
  protected readonly simpleState: SimpleState
  
  // Journal for event sourcing (deterministic replay)
  private journal: Journal
  
  // Optional journal store for durable persistence
  private journalStore?: JournalStore
  
  // Optional memory adapter (long-term memory)
  private memoryAdapter?: MemoryAdapter
  
  /**
   * Get current actor state (STATEFUL!)
   */
  getState(): Record<string, unknown> {
    return this.state
  }
  
  /**
   * Update state (persists to journal)
   */
  protected updateState(updates: Record<string, unknown>): void {
    this.state = { ...this.state, ...updates }
    this.recordDecision({ type: 'state-update', updates })
  }
  
  /**
   * Get journal (for persistence and replay)
   */
  getJournal(): Journal {
    return this.journal
  }
  
  /**
   * Load journal (restore from durable storage)
   */
  loadJournal(journal: Journal): void {
    this.journal = journal
  }
}
```

**Actors maintain state between invocations!**

---

### 3. Distributed Coordination (Prevent Actor Duplicates)

**File**: `src/actor/actor-runtime.ts`

```typescript
// Acquire distributed lock BEFORE creating actor
if (this.coordinationAdapter) {
  const lock = await this.coordinationAdapter.acquireLock(actorId, 60000)
  if (!lock) {
    throw new Error(`Actor ${actorId} locked by another instance`)
  }
  this.actorLocks.set(actorId, lock)
}
```

**This ensures only ONE instance of `actor-123` exists across ALL hosts** - just like Dapr's placement service!

---

### 4. State Persistence (Durable Actors)

**File**: `src/actor/actor-runtime.ts`

```typescript
/**
 * Persist actor state and journal before eviction
 */
private async persistActor(actorId: string): Promise<void> {
  if (!this.stateStore) return
  
  const actor = this.actorPool.get(actorId)
  if (!actor) return
  
  await this.stateStore.save(actorId, {
    id: actorId,
    actorType: context?.actorType || 'unknown',
    status: 'suspended',
    state: actor.getState(),  // ← Persist state!
    metadata: {
      journal: actor.getJournal(),  // ← Persist journal!
      lastInvocation: actor.getLastInvocation()
    }
  })
}
```

**Actors persist state to Redis/Cosmos** - they're NOT stateless!

---

### 5. Virtual Actor Pattern (Activation on Demand)

**File**: `src/actor/actor-runtime.ts`

```typescript
// If actor not in pool, create it (virtual actor pattern)
if (!actor) {
  // Create new actor
  const definition = await this.resolveActorDefinition(actorType)
  actor = new definition.actorClass(context)
  
  // Restore state from storage (if exists)
  const savedState = await this.stateStore.load(actorId)
  if (savedState) {
    actor.state = savedState.state
  }
  
  // Add to pool
  this.actorPool.set(actorId, actor)
}
```

**Actors "exist" even when not in memory** - they get activated on-demand from durable storage (Orleans/Dapr pattern!)

---

## What About the Queues?

### Loom Supports BOTH Patterns

Loom has a **hybrid architecture**:

1. **Direct Actor Invocation** (like Dapr)
   ```typescript
   const actor = await runtime.getActor('actor-123', 'Calculator', context)
   await actor.execute({ method: 'add', args: [5, 10] })
   ```

2. **Queue-Based Invocation** (for decoupling/retry/scale)
   ```typescript
   // Pipeline orchestrator uses queues for task distribution
   await messageQueue.publish('actor-Calculator', {
     actorId: 'actor-123',
     payload: { method: 'add', args: [5, 10] }
   })
   ```

**Both patterns route to THE SAME actor instance in the registry!**

The queue is just a **transport mechanism** - it doesn't make actors stateless. The message still gets routed to `getActor('actor-123')` which returns the sticky actor instance.

---

## Architecture Diagram: The Truth

```
┌─────────────────────────────────────────────────────────────┐
│                    Loom Instance 1                           │
├─────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐ │
│  │         LongLivedActorRuntime (REGISTRY)               │ │
│  │  ┌────────────────────────────────────────────────┐    │ │
│  │  │  Actor Pool (In-Memory Registry)               │    │ │
│  │  │  ┌──────────────────┐  ┌──────────────────┐   │    │ │
│  │  │  │ actor-123        │  │ actor-456        │   │    │ │
│  │  │  │ Type: Calculator │  │ Type: Validator  │   │    │ │
│  │  │  │ State: {sum: 42} │  │ State: {...}     │   │    │ │
│  │  │  │ Journal: [...]   │  │ Journal: [...]   │   │    │ │
│  │  │  └──────────────────┘  └──────────────────┘   │    │ │
│  │  └────────────────────────────────────────────────┘    │ │
│  └────────────────────────────────────────────────────────┘ │
│           ▲                              ▲                   │
│           │                              │                   │
│  ┌────────┴────────┐          ┌─────────┴────────┐          │
│  │ Direct Invoke   │          │  Queue Invoke    │          │
│  │ getActor()      │          │  routeMessage()  │          │
│  └─────────────────┘          └──────────────────┘          │
│           ▲                              ▲                   │
│           │                              │                   │
│  ┌────────┴──────────────────────────────┴────────┐         │
│  │        BullMQ (Transport - NOT State!)         │         │
│  └────────────────────────────────────────────────┘         │
│           ▲                                                  │
│           │                                                  │
│  ┌────────┴───────────────────────────────────────┐         │
│  │  Redis/Cosmos (Durable State + Journal)        │         │
│  │  - Actor state (persisted on eviction)         │         │
│  │  - Journal entries (event sourcing)            │         │
│  │  - Distributed locks (prevent duplicates)      │         │
│  └────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Loom Instance 2 (Different Host)                           │
│  - getActor('actor-123') BLOCKED by distributed lock        │
│  - Can only get actor-123 if Instance 1 releases it         │
└─────────────────────────────────────────────────────────────┘
```

**Key Point**: Even when using queues, messages route to sticky actor instances in the registry!

---

## Side-by-Side Comparison

| Feature | Dapr | Loom | AI's Claim |
|---------|------|------|------------|
| **Stateful actors** | ✅ Yes | ✅ Yes | ❌ Said "stateless" |
| **Actor registry** | ✅ Placement service | ✅ ActorRuntime pool | ❌ Said "vestigial" |
| **Sticky routing** | ✅ Yes | ✅ Yes | ❌ Said "any worker" |
| **Single-threaded** | ✅ Yes | ✅ Yes (via journal) | ❌ Missed this |
| **Virtual actors** | ✅ Yes | ✅ Yes | ❌ Missed this |
| **State persistence** | ✅ State stores | ✅ StateStore + Journal | ❌ Missed this |
| **Distributed locks** | ✅ Placement svc | ✅ CoordinationAdapter | ❌ Missed this |
| **Transport** | HTTP/gRPC | Queues OR Direct | ⚠️ Only saw queues |
| **Actor model** | Orleans-style | Orleans-style | ❌ Said "Celery-style" |

---

## Why The Confusion?

The AI likely saw:

1. **PipelineOrchestrator** using BullMQ queues for task distribution
2. Scatter/gather patterns distributing work across multiple workers
3. Message queue terminology everywhere

**But missed:**

1. ActorRuntime's `getActor()` returns **THE SAME instance** per actorId
2. Actors maintain **in-memory state** between calls
3. **Distributed locks** ensure only one instance per host
4. **State persistence** to durable storage
5. **Journal-based execution** for deterministic replay

The pipeline orchestrator uses queues for **task distribution**, but those tasks still invoke **stateful actors** in the registry!

---

## Example: Stateful Counter Actor

```typescript
// Define stateful actor
class CounterActor extends Actor {
  async execute(input: { operation: string }) {
    // Get current state (persists between calls!)
    let count = this.state.count as number || 0
    
    if (input.operation === 'increment') {
      count++
    }
    
    // Update state (triggers journal entry + persistence)
    this.updateState({ count })
    
    return { count }
  }
}

// Register actor type
runtime.registerActorType('Counter', {
  type: 'typescript',
  actorClass: CounterActor
})

// SAME actor instance used for all calls to counter-123
const actor1 = await runtime.getActor('counter-123', 'Counter', context)
await actor1.execute({ operation: 'increment' }) // count = 1

const actor2 = await runtime.getActor('counter-123', 'Counter', context)
await actor2.execute({ operation: 'increment' }) // count = 2

// actor1 === actor2 (same instance!)
// State persists between calls!
```

**This is NOT stateless worker pooling** - it's virtual actor model!

---

## Documentation Evidence

**From `docs/architecture.md`**:

> Loom is built on **three core pillars**:
> 1. **Journal-Based Persistence**: Every actor operation logged to durable storage
> 2. **Long-Lived Actor Pools**: Actors stay in memory with automatic lifecycle management
> 3. **Distributed Coordination**: Prevent duplicate actors across multiple processes

**From `README.md`**:

> Loom is a TypeScript framework for building reliable, durable distributed systems using **the actor model**.

**From `docs/JOURNAL_PERSISTENCE_COMPLETE.md`**:

> Actors maintain state through journal entries, enabling deterministic replay after crashes.

---

## Conclusion

The AI's assessment was **fundamentally wrong**. Here's the truth:

❌ **"Loom uses stateless queue-based workers"**  
✅ **Loom uses stateful virtual actors with sticky routing**

❌ **"ActorRegistry is vestigial/placeholder"**  
✅ **ActorRuntime is the core registry, essential for actor lifecycle**

❌ **"No stickiness - any worker can handle any message"**  
✅ **Strong stickiness - getActor(actorId) returns THE SAME instance**

❌ **"Like Celery/Bull/Step Functions"**  
✅ **Like Orleans/Dapr/Akka - virtual actor model**

❌ **"No actor instances"**  
✅ **Actor instances in memory with state, journal, and lifecycle**

**Loom implements a full Orleans-style virtual actor model**, just like Dapr. The queue-based transport is ONE invocation pattern, but actors are **stateful, sticky, and registered** - not stateless worker pools.

The confusion came from looking at the pipeline orchestrator (which uses queues for task distribution) without understanding the underlying actor runtime architecture. The ActorRuntime registry is the heart of the system, not "vestigial."

---

## References

- `src/actor/actor-runtime.ts` - ActorRuntime with registry and sticky routing
- `src/actor/actor.ts` - Base Actor class with state and journal
- `docs/architecture.md` - Architecture overview
- `docs/JOURNAL_PERSISTENCE_COMPLETE.md` - Journal system details
- `src/storage/coordination-adapter.ts` - Distributed lock implementation
- `README.md` - Actor model description
