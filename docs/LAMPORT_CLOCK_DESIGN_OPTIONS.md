# Lamport Clock Design Options for Loom

## Current State

**Lamport clocks are isolated to ActorMemory:**
```typescript
class ActorMemory {
  private lamportClock: number = 0;  // Only for graph memory facts
}
```

**Actors have no access:**
- Base `Actor` class: no Lamport clock
- `ActorContext`: no Lamport clock
- `Message` type: no Lamport timestamp field
- Journal entries: no Lamport timestamps

## The Problem

For true distributed ordering, we need:
1. **Per-actor clocks** (not per-subsystem)
2. **Message causality** - track happens-before relationships
3. **Cross-system consistency** - memory, journal, messages all use same clock
4. **Automatic propagation** - clock ticks on send/receive

## Design Options

---

## Option 1: ActorContext Integration (Recommended)

**Add Lamport clock to ActorContext - accessible to all actor code.**

### Implementation

```typescript
// src/actor/journal.ts
export interface ActorContext {
  actorId: string;
  actorType: string;
  correlationId?: string;
  
  // NEW: Lamport clock methods
  getLamportTime(): number;
  tickLamport(receivedTime?: number): number;
  
  // Existing methods
  recordEvent(eventType: string, data?: unknown): void;
  recordMetric(name: string, value: number, tags?: Record<string, string>): void;
  startSpan(operation: string): () => void;
}

// src/actor/actor.ts
export abstract class Actor {
  protected context: ActorContext;
  private lamportClock: number = 0;
  
  constructor(context: ActorContext, ...) {
    // Enhance context with Lamport methods
    this.context = {
      ...context,
      getLamportTime: () => this.lamportClock,
      tickLamport: (receivedTime?: number) => {
        if (receivedTime !== undefined) {
          this.lamportClock = Math.max(this.lamportClock, receivedTime) + 1;
        } else {
          this.lamportClock += 1;
        }
        return this.lamportClock;
      }
    };
  }
}

// Usage in actor code
class MyActor extends Actor {
  async execute(input: any) {
    const time = this.context.tickLamport();
    this.updateState({ lastEventTime: time });
  }
}

// Usage in ActorMemory
class ActorMemory {
  constructor(
    private actorId: string,
    private storage: MemoryStorage,
    private context: ActorContext  // NEW: receive context
  ) {}
  
  async addFact(...) {
    const lamport_ts = this.context.tickLamport();  // Use actor's clock
    // ...
  }
}
```

### Pros
✅ **Accessible everywhere** - All actor code can use it  
✅ **Single source of truth** - One clock per actor  
✅ **Backward compatible** - Optional feature  
✅ **Clean API** - `this.context.tickLamport()`  
✅ **Testable** - Easy to inject mock context  

### Cons
⚠️ **Context mutation** - We're adding methods to context at runtime  
⚠️ **Type complexity** - Need to make methods optional for backward compat  
⚠️ **Memory needs context** - ActorMemory now depends on ActorContext  

---

## Option 2: Separate LamportClock Service

**Create a standalone service, inject like tracer or memory.**

### Implementation

```typescript
// src/timing/lamport-clock.ts
export class LamportClock {
  private clock: number = 0;
  
  tick(receivedTime?: number): number {
    if (receivedTime !== undefined) {
      this.clock = Math.max(this.clock, receivedTime) + 1;
    } else {
      this.clock += 1;
    }
    return this.clock;
  }
  
  get(): number {
    return this.clock;
  }
  
  // For persistence/recovery
  restore(time: number): void {
    this.clock = Math.max(this.clock, time);
  }
}

// src/actor/actor.ts
export abstract class Actor {
  protected lamportClock?: LamportClock;
  
  constructor(
    context: ActorContext,
    initialState?: Record<string, unknown>,
    observabilityTracer?: TraceWriter,
    idempotencyStore?: IdempotencyStore,
    memoryAdapter?: MemoryAdapter,
    journalStore?: JournalStore,
    lamportClock?: LamportClock  // NEW: optional injection
  ) {
    this.lamportClock = lamportClock ?? new LamportClock();
    // ...
  }
}

// Usage
class MyActor extends Actor {
  async execute(input: any) {
    const time = this.lamportClock!.tick();
    // ...
  }
}

// Usage in ActorMemory
class ActorMemory {
  constructor(
    private actorId: string,
    private storage: MemoryStorage,
    private lamportClock: LamportClock  // Share actor's clock
  ) {}
  
  async addFact(...) {
    const lamport_ts = this.lamportClock.tick();
    // ...
  }
}
```

### Pros
✅ **Clear ownership** - Explicit dependency  
✅ **Testable** - Easy to mock  
✅ **Reusable** - Can share clock between components  
✅ **Type safe** - Proper TypeScript types  
✅ **Persistence-ready** - Easy to save/restore  

### Cons
⚠️ **Boilerplate** - Need to pass clock around  
⚠️ **Another dependency** - More constructor params  
⚠️ **Opt-in** - Not automatic  

---

## Option 3: Global Per-Actor Clock Registry

**Maintain a global registry of clocks indexed by actorId.**

### Implementation

```typescript
// src/timing/clock-registry.ts
class LamportClockRegistry {
  private clocks = new Map<string, number>();
  
  tick(actorId: string, receivedTime?: number): number {
    const current = this.clocks.get(actorId) ?? 0;
    const next = receivedTime !== undefined
      ? Math.max(current, receivedTime) + 1
      : current + 1;
    this.clocks.set(actorId, next);
    return next;
  }
  
  get(actorId: string): number {
    return this.clocks.get(actorId) ?? 0;
  }
}

export const globalClockRegistry = new LamportClockRegistry();

// Usage anywhere
import { globalClockRegistry } from './timing/clock-registry';

class MyActor extends Actor {
  async execute(input: any) {
    const time = globalClockRegistry.tick(this.context.actorId);
    // ...
  }
}
```

### Pros
✅ **Simple** - No dependency injection needed  
✅ **Automatic** - Works everywhere immediately  
✅ **Stateless components** - No need to pass clocks  

### Cons
❌ **Global state** - Hard to test, race conditions  
❌ **Memory leak** - Clocks accumulate forever  
❌ **Not scalable** - Single process only  
❌ **Hidden dependency** - Magic globals are bad  

---

## Option 4: Add to Message Type (Message-Level Causality)

**Track Lamport timestamps in messages only, not in actors.**

### Implementation

```typescript
// src/types.ts
export interface Message {
  messageId: string;
  actorId: string;
  messageType: string;
  payload: Record<string, unknown>;
  
  // NEW: Lamport timestamp
  lamportTime: number;
  
  metadata: {
    timestamp: string;
    sender?: string;
    // ...
  }
}

// Message queue automatically increments
export class MessageQueueWithLamport implements MessageQueue {
  private senderClocks = new Map<string, number>();
  
  async enqueue(queueName: string, message: Message): Promise<void> {
    // Increment sender's clock
    const senderId = message.metadata.sender || message.actorId;
    const currentTime = this.senderClocks.get(senderId) ?? 0;
    const lamportTime = currentTime + 1;
    this.senderClocks.set(senderId, lamportTime);
    
    // Add to message
    message.lamportTime = lamportTime;
    
    // Enqueue
    await this.queue.enqueue(queueName, message);
  }
  
  async dequeue(queueName: string): Promise<Message | null> {
    const message = await this.queue.dequeue(queueName);
    if (message) {
      // Update receiver's clock
      const receiverId = message.actorId;
      const currentTime = this.senderClocks.get(receiverId) ?? 0;
      const newTime = Math.max(currentTime, message.lamportTime) + 1;
      this.senderClocks.set(receiverId, newTime);
    }
    return message;
  }
}
```

### Pros
✅ **Message causality** - Track happens-before for messages  
✅ **Automatic** - Queue handles it  
✅ **Transparent** - Actors don't need to know  

### Cons
⚠️ **Limited scope** - Only messages, not all events  
⚠️ **Queue-dependent** - Requires message queue  
⚠️ **State in queue** - Clock state lives in queue  

---

## Option 5: Hybrid - Context + Message

**Combine Option 1 and Option 4 for best coverage.**

### Implementation

```typescript
// ActorContext has Lamport methods (Option 1)
interface ActorContext {
  getLamportTime(): number;
  tickLamport(receivedTime?: number): number;
}

// Messages carry Lamport timestamps (Option 4)
interface Message {
  lamportTime: number;
}

// Message handling auto-syncs clock
class Actor {
  async handleMessage(message: Message) {
    // Sync clock on receive
    this.context.tickLamport(message.lamportTime);
    
    // Execute
    await this.execute(message.payload);
  }
  
  async sendMessage(target: string, payload: any) {
    // Tick clock on send
    const lamportTime = this.context.tickLamport();
    
    // Create message with timestamp
    const message = {
      actorId: target,
      payload,
      lamportTime,
      metadata: { sender: this.context.actorId }
    };
    
    await messageQueue.enqueue(target, message);
  }
}
```

### Pros
✅ **Complete coverage** - Both local events and messages  
✅ **Automatic causality** - Messages sync clocks  
✅ **Best correctness** - True distributed ordering  

### Cons
⚠️ **Most complex** - Two integration points  
⚠️ **More changes** - Requires updating message handling  

---

## Comparison Matrix

| Aspect | Option 1: Context | Option 2: Service | Option 3: Registry | Option 4: Message | Option 5: Hybrid |
|--------|------------------|-------------------|-------------------|------------------|-----------------|
| **Ease of Use** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Correctness** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Testability** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Scalability** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Code Changes** | Medium | Medium | Small | Large | Large |
| **Backward Compat** | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| **Memory Leak Risk** | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| **Global State** | ❌ | ❌ | ✅ | ❌ | ❌ |

---

## Recommendation: Option 2 (LamportClock Service)

**Why:**
1. **Clean architecture** - Explicit dependency, no magic
2. **Flexible** - Easy to share between Actor and ActorMemory
3. **Testable** - Mock-friendly
4. **Future-proof** - Easy to add persistence/recovery
5. **Type-safe** - No runtime context mutation

**Migration path:**
```typescript
// Phase 1: Add LamportClock class
export class LamportClock { /* ... */ }

// Phase 2: Update Actor to create/accept clock
class Actor {
  protected lamportClock: LamportClock;
  constructor(..., lamportClock?: LamportClock) {
    this.lamportClock = lamportClock ?? new LamportClock();
  }
}

// Phase 3: Update ActorMemory to accept clock
class ActorMemory {
  constructor(
    actorId: string,
    storage: MemoryStorage,
    lamportClock: LamportClock  // Share actor's clock
  ) { /* ... */ }
}

// Phase 4: Usage
const clock = new LamportClock();
const actor = new MyActor(context, state, tracer, idempStore, memory, journal, clock);
const actorMemory = new ActorMemory('actor-1', storage, clock);
```

**Later (optional): Add Option 5 features**
- Add `lamportTime` to Message type
- Auto-sync on message send/receive
- Full distributed causality

---

## Alternative: Start with Option 1 (Simpler)

If you want **faster implementation with less boilerplate:**

**Option 1 (ActorContext)** is simpler because:
- No new class to create
- Available via `this.context.tickLamport()`
- ActorMemory can receive context in constructor

The runtime context mutation is not ideal, but it's pragmatic and gets us 90% there.

---

## Questions to Decide

1. **Do we need message-level causality now?** (Option 4/5)
   - If yes → Option 5
   - If no → Option 1 or 2

2. **How important is explicit dependency injection?**
   - Very important → Option 2
   - Less important → Option 1

3. **Should ActorMemory be tightly coupled to Actor?**
   - Yes, it's part of actor → Option 1 (share context)
   - No, it's independent → Option 2 (inject clock)

4. **Do we need clock persistence/recovery?**
   - Yes → Option 2 (easier to add)
   - No → Either works

**My vote: Option 2** for clean architecture, but **Option 1** if you want to ship faster.
