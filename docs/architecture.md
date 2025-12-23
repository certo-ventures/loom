# Loom Architecture Overview

## System Design

Loom is built on **three core pillars**:

1. **Journal-Based Persistence**: Every actor operation logged to durable storage
2. **Long-Lived Actor Pools**: Actors stay in memory with automatic lifecycle management
3. **Distributed Coordination**: Prevent duplicate actors across multiple processes

```
┌─────────────────────────────────────────────────────────────────┐
│                         Loom Instance 1                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐      ┌─────────────────────────────────┐ │
│  │  Actor Pool      │      │   Coordination Adapter          │ │
│  │  (LRU Eviction)  │◄────►│   (Distributed Locks)           │ │
│  │                  │      └─────────────────────────────────┘ │
│  │ ┌──────────────┐ │              ▲                           │
│  │ │ Actor 1      │ │              │ Lock Acquisition          │
│  │ │ (Hot)        │ │              │ Lock Renewal              │
│  │ └──────────────┘ │              │                           │
│  │                  │              ▼                           │
│  │ ┌──────────────┐ │      ┌─────────────────────────────────┐ │
│  │ │ Actor 2      │ │      │   Redis / Cosmos DB              │ │
│  │ │ (Idle)       │ │      │   (Locks + State + Streams)      │ │
│  │ └──────────────┘ │      └─────────────────────────────────┘ │
│  └──────────────────┘              ▲                           │
│           ▲                        │                           │
│           │                        │ Journal Operations        │
│           │                        │ State Persistence         │
│           │                        ▼                           │
│  ┌────────────────────────────────────────────────────────┐   │
│  │            Message Adapter (BullMQ)                     │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐  │   │
│  │  │ Queue 1 │  │ Queue 2 │  │ Queue N │  │   DLQ    │  │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └──────────┘  │   │
│  └────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         Loom Instance 2                          │
│  (Same structure - coordination prevents actor duplication)      │
└─────────────────────────────────────────────────────────────────┘
```

## Component Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    LongLivedActorRuntime                      │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────┐      ┌──────────────────────────────┐  │
│  │   Actor Pool    │      │   Tracer                      │  │
│  │   Management    │      │   (Distributed Tracing)       │  │
│  └────────┬────────┘      └──────────────────────────────┘  │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │               Adapter Layer                          │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  MessageAdapter  │  StateAdapter  │  CoordinationAdapter │
│  │  (BullMQ)        │  (Redis)       │  (Redis Locks)   │    │
│  └─────────────────────────────────────────────────────┘    │
│           │                  │                  │            │
│           ▼                  ▼                  ▼            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           External Infrastructure                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐            │  │
│  │  │  Redis   │  │ Cosmos DB│  │ Postgres │            │  │
│  │  └──────────┘  └──────────┘  └──────────┘            │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │          Observability Layer                         │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  TraceStore  │  MetricsCollector  │  Health Checks  │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. LongLivedActorRuntime

**Purpose**: Central orchestrator for actor lifecycle and execution.

**Responsibilities**:
- Create/retrieve actors from pool
- Acquire distributed locks before actor access
- Coordinate message delivery via MessageAdapter
- Persist journal entries via StateAdapter
- Manage actor eviction (LRU policy)
- Automatic lock renewal for active actors

**Key Methods**:
```typescript
execute<T>(
  actorId: string,
  fn: (actor: TActor) => Promise<T>,
  context?: ExecutionContext
): Promise<T>

enqueue(
  actorId: string,
  message: Message
): Promise<void>
```

### 2. Journal System

**Purpose**: Provide durable, append-only log of actor operations.

**Journal Entry Types**:
- `state_updated`: State change from actor method
- `activity_scheduled`: Async operation started
- `activity_completed`: Async operation succeeded
- `activity_failed`: Async operation failed
- `message_received`: Message dequeued from queue

**Persistence**:
- **Redis Streams**: Lightweight, high-throughput
- **Cosmos DB**: Global distribution, strong consistency
- **PostgreSQL**: JSONB storage, SQL queries

**Replay**:
Actors can be reconstructed by replaying journal entries in order:
```typescript
const journal = await stateAdapter.getJournal(actorId);
for (const entry of journal) {
  if (entry.type === 'state_updated') {
    actor.state = entry.state;
  }
}
```

### 3. Adapter Pattern

**Purpose**: Decouple Loom core from infrastructure backends.

#### MessageAdapter
Handles asynchronous message delivery to actors.

**Implementations**:
- `BullMQAdapter`: Redis-backed queues (default)
- `RedisPubSubAdapter`: Simple pub/sub pattern
- `InMemoryAdapter`: Testing only

**Interface**:
```typescript
interface MessageAdapter {
  enqueue(actorId: string, message: Message): Promise<void>
  subscribe(actorId: string, handler: (msg: Message) => Promise<void>): Promise<void>
  unsubscribe(actorId: string): Promise<void>
  getQueueDepth(actorId: string): Promise<number>
}
```

#### StateAdapter
Persists actor state and journal entries.

**Implementations**:
- `RedisStateAdapter`: Fast, in-memory persistence
- `CosmosStateAdapter`: Global distribution, multi-region
- `InMemoryStateAdapter`: Development only

**Interface**:
```typescript
interface StateAdapter {
  saveState<T>(actorId: string, state: T): Promise<void>
  loadState<T>(actorId: string): Promise<T | null>
  appendToJournal(actorId: string, entry: JournalEntry): Promise<void>
  getJournal(actorId: string): Promise<JournalEntry[]>
}
```

#### CoordinationAdapter
Prevents duplicate actor instances across processes.

**Implementations**:
- `RedisCoordinationAdapter`: Redis-based distributed locks
- `CosmosCoordinationAdapter`: Cosmos DB lease-based locking
- `InMemoryCoordinationAdapter`: Single-process only

**Interface**:
```typescript
interface CoordinationAdapter {
  acquireLock(actorId: string, timeout: number): Promise<string | null>
  releaseLock(actorId: string, token: string): Promise<boolean>
  renewLock(actorId: string, token: string, timeout: number): Promise<boolean>
  isHealthy(): Promise<boolean>
}
```

### 4. Actor Pool Management

**Purpose**: Keep frequently-used actors in memory for performance.

**Configuration**:
```typescript
{
  maxSize: 1000,           // Max actors in pool
  idleTimeout: 300000,     // 5 minutes idle before eviction
  evictionPolicy: 'lru'    // Least recently used
}
```

**Lifecycle**:
1. **Creation**: Actor instantiated on first `execute()` call
2. **Active**: Lock acquired, operations executed
3. **Idle**: Lock released, actor remains in pool
4. **Eviction**: Pool full → LRU actor removed from memory
5. **Recreation**: Evicted actor reconstructed from journal on next access

**Lock Management**:
- Lock acquired before actor retrieved from pool
- Lock renewed every `renewInterval` (default 10s) for active actors
- Lock released when actor returns to pool
- Lock timeout (default 30s) prevents orphaned locks

### 5. Distributed Tracing

**Purpose**: Track actor interactions across the system.

**Concepts**:
- **Correlation ID**: Groups related operations (e.g., "order-flow-123")
- **Parent Trace ID**: Links child actors to parent actor
- **Trace Events**: 11 event types (actor.created, message.sent, etc.)

**Automatic Propagation**:
```typescript
// Parent actor
await runtime.execute('parent-1', async (actor) => {
  // Child actor inherits correlationId
  await actor.sendMessage('child-1', { ... });
}, { correlationId: 'my-flow' });

// Query all traces for flow
const traces = await traceStore.query({
  correlationId: 'my-flow'
});
```

**Trace Event Types**:
- `actor.created`: Actor instantiated
- `actor.evicted`: Actor removed from pool
- `message.sent`: Message enqueued to another actor
- `message.received`: Message dequeued
- `state.updated`: Actor state changed
- `activity.scheduled`: Async operation started
- `activity.completed`: Async operation succeeded
- `activity.failed`: Async operation failed
- `lock.acquired`: Distributed lock obtained
- `lock.released`: Distributed lock freed
- `lock.renewed`: Lock timeout extended

### 6. Observability Layer

**Purpose**: Expose runtime metrics and health status.

#### Health Checks (`/health`)
Returns status of all system components:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "components": {
    "actorPools": {
      "status": "healthy",
      "activeActors": 45,
      "idleActors": 12,
      "evictedActors": 3
    },
    "messageQueues": {
      "status": "degraded",
      "totalQueues": 10,
      "averageDepth": 150,
      "maxDepth": 500
    },
    "locks": {
      "status": "healthy",
      "activeLocks": 45,
      "failedAcquisitions": 2
    }
  }
}
```

#### Metrics (`/metrics`)
Detailed statistics for monitoring:
```json
{
  "actorPools": {
    "totalActors": 60,
    "activeActors": 45,
    "idleActors": 12,
    "evictedActors": 3,
    "poolUtilization": 0.60
  },
  "messageQueues": {
    "totalMessages": 1500,
    "pendingMessages": 150,
    "processingMessages": 45,
    "completedMessages": 1200,
    "failedMessages": 5
  },
  "traces": {
    "totalTraces": 300,
    "activeTraces": 45,
    "averageEventCount": 12.5
  }
}
```

### 7. Task Abstraction

**Purpose**: Lightweight execution for stateless operations.

**Use Cases**:
- Send email/SMS notifications
- Trigger webhooks
- Simple data transformations
- External API calls

**Comparison to Actors**:

| Feature | Actor | Task |
|---------|-------|------|
| State | ✅ Persistent | ❌ None |
| Journal | ✅ Full history | ❌ No persistence |
| Messaging | ✅ Async queues | ❌ Direct invocation |
| Locking | ✅ Distributed | ❌ Not needed |
| Overhead | High | Minimal |
| Use Case | Stateful workflows | Fire-and-forget ops |

**Example**:
```typescript
const sendNotification = createTask('SendNotification', async (input, context) => {
  await notificationService.send(input.userId, input.message);
  return { sent: true };
});

// Execute with automatic timing and error handling
const result = await sendNotification.run({
  userId: '123',
  message: 'Hello!'
});

console.log(result.success);  // true
console.log(result.duration); // 45ms
```

## Data Flow: Message Processing

1. **Enqueue**: `runtime.enqueue(actorId, message)`
   - Message adapter adds to BullMQ queue
   - Returns immediately (async)

2. **Dequeue**: BullMQ worker processes message
   - Calls `runtime.execute(actorId, handler)`
   - Runtime acquires distributed lock

3. **Retrieve Actor**:
   - Check pool for actor
   - If not found, reconstruct from journal
   - Add to pool

4. **Execute Handler**:
   - Call actor method
   - Log operations to journal
   - Update state via state adapter

5. **Complete**:
   - Release distributed lock
   - Mark message as completed in BullMQ
   - Actor remains in pool (idle)

## Failure Scenarios

### Actor Crashes Mid-Execution
- **Detection**: Lock timeout expires (30s default)
- **Recovery**: Next instance acquires lock, replays journal
- **Message**: BullMQ retries message (max 3 attempts)

### Instance Dies
- **Detection**: Lock renewals stop
- **Recovery**: Locks expire after timeout, other instances take over
- **State**: Fully preserved in Redis/Cosmos

### Redis/Cosmos Unavailable
- **Detection**: Adapter health checks fail
- **Impact**: `/health` returns degraded status
- **Recovery**: Exponential backoff retries, alerts via monitoring

### Message Processing Fails
- **Retry**: BullMQ automatically retries (configurable)
- **DLQ**: After max retries, message moves to dead letter queue
- **Inspection**: View DLQ via observability endpoints or Redis CLI

## Performance Characteristics

### Latency
- **Hot Actor** (in pool): ~1-5ms (in-memory)
- **Cold Actor** (journal replay): ~10-50ms (depends on journal size)
- **Message Delivery**: ~5-20ms (BullMQ + Redis)

### Throughput
- **Actors per Instance**: 1000-10,000 (configurable pool size)
- **Messages per Second**: 1,000-10,000 (depends on actor complexity)
- **Journal Writes**: Limited by Redis/Cosmos throughput

### Memory
- **Per Actor**: ~1-10KB (depends on state size)
- **Pool Overhead**: ~10-100MB (for 1000 actors)
- **BullMQ**: ~1KB per pending message

## Horizontal Scaling

### Add More Instances
```bash
# Terminal 1
LOOM_INSTANCE_ID=1 node server.js

# Terminal 2
LOOM_INSTANCE_ID=2 node server.js

# Terminal 3
LOOM_INSTANCE_ID=3 node server.js
```

**Coordination**:
- Distributed locks prevent actor duplication
- Each instance processes different actors
- Load balancing via BullMQ queue sharing

### Recommendations
- 1-4 instances per Redis/Cosmos connection
- Monitor lock contention via `/metrics`
- Scale horizontally for message throughput
- Scale vertically for actor pool size

## Next Steps

- [Configuration Guide](./configuration.md) for production settings
- [Adapters](./adapters.md) for backend selection
- [Best Practices](./best-practices.md) for optimal patterns
