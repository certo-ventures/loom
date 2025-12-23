# Loom Framework Documentation

> A durable, actor-based execution framework with journal-based persistence, distributed coordination, and real-time observability.

## Table of Contents

1. [Architecture Overview](./architecture.md)
2. [Core Concepts](./core-concepts.md)
3. [Adapters](./adapters.md)
4. [Configuration](./configuration.md)
5. [Tracing & Observability](./observability.md)
6. [Task Abstraction](./tasks.md)
7. [Migration Guide](./migration.md)
8. [API Reference](./api-reference.md)
9. [Best Practices](./best-practices.md)

## Quick Start

### Installation

```bash
npm install @your-org/loom
```

### Basic Actor Example

```typescript
import { LongLivedActorRuntime } from '@your-org/loom';

// Define your actor
class GreeterActor {
  private greetCount = 0;

  async greet(name: string): Promise<string> {
    this.greetCount++;
    return `Hello, ${name}! (Greeted ${this.greetCount} times)`;
  }
}

// Create runtime with Redis backend
const runtime = new LongLivedActorRuntime({
  createActor: () => new GreeterActor(),
  redisConfig: {
    host: 'localhost',
    port: 6379
  }
});

// Execute actor method
const result = await runtime.execute(
  'greeter-1',
  async (actor) => actor.greet('World')
);

console.log(result); // "Hello, World! (Greeted 1 times)"
```

### Using Tasks for Simple Operations

```typescript
import { createTask } from '@your-org/loom/task';

// Create a lightweight task (no journal overhead)
const sendEmail = createTask('SendEmail', async (input, context) => {
  await emailService.send({
    to: input.to,
    subject: input.subject,
    body: input.body
  });
  return { sent: true, messageId: '...' };
});

// Execute task
const result = await sendEmail.run({
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Thanks for signing up'
});

console.log(result.success); // true
console.log(result.duration); // 45 (ms)
```

## Key Features

### 🔒 Distributed Coordination
- **Distributed Locking**: Ensure only one instance owns an actor across multiple Loom processes
- **Automatic Lock Management**: Acquire on actor creation, renew periodically, release on eviction
- **Pluggable Adapters**: Redis, Cosmos DB, or custom implementations

### 📊 Observability & Tracing
- **Distributed Tracing**: Track actor interactions with correlation IDs and parent-child relationships
- **Health Endpoints**: `/health` and `/metrics` for production monitoring
- **Real-time Metrics**: Actor pool stats, message queue depths, lock status, trace statistics

### ⚙️ Flexible Configuration
- **YAML Configuration**: Load runtime config from `loom.config.yaml`
- **Type-Safe Schema**: Zod validation for all configuration options
- **Environment Variables**: `LOOM_CONFIG_PATH` for dynamic config loading
- **Smart Defaults**: Works out-of-the-box with sensible defaults

### 🔌 Pluggable Adapters
- **Message Adapters**: BullMQ, Redis Pub/Sub, RabbitMQ, InMemory
- **State Adapters**: Redis, Cosmos DB, InMemory, PostgreSQL
- **Coordination Adapters**: Redis locks, Cosmos leases, InMemory (dev)

### 🎯 Simplified State API
- **Key-Value Facade**: Simple `get()`, `set()`, `delete()`, `clear()` over journal system
- **Type-Safe**: Full TypeScript support with generics
- **Journal Integration**: All state changes persisted in actor journal

### 🪶 Lightweight Tasks
- **Stateless Operations**: Execute simple operations without actor overhead
- **No Journal**: Fire-and-forget tasks with automatic timing and error handling
- **Flexible Patterns**: Class-based or inline task definitions
- **Composition**: Chain tasks together for complex workflows

## Architecture Principles

### Journal-Based Execution
Every actor operation is logged to a persistent journal (Redis Streams, Cosmos DB). This enables:
- **Replay**: Reconstruct actor state from journal entries
- **Debugging**: Trace exactly what happened and when
- **Auditing**: Complete history of all actor operations
- **Recovery**: Resume from last known state after crashes

### Long-Lived Actor Pools
Actors stay in memory for configurable idle timeouts (default 5 minutes):
- **Hot Path Performance**: No cold starts for frequently-used actors
- **Automatic Eviction**: LRU eviction when pool reaches capacity
- **Distributed Locks**: Prevent duplicate actors across instances

### Durable Messaging
Messages are enqueued to BullMQ (Redis-backed) for guaranteed delivery:
- **At-Least-Once**: Messages retry on failure
- **Dead Letter Queue**: Failed messages moved to DLQ for inspection
- **Ordering**: FIFO or standard queue modes per actor

## Production Deployment

### Health Monitoring

```typescript
import { createObservabilityServer } from '@your-org/loom/observability';

// Start HTTP server with health endpoints
const server = await createObservabilityServer({
  port: 9090,
  collector: metricsCollector,
  traceStore: traceStore
});

// GET /health returns:
// {
//   "status": "healthy",
//   "timestamp": "2024-01-01T00:00:00.000Z",
//   "components": {
//     "actorPools": { "status": "healthy", ... },
//     "messageQueues": { "status": "healthy", ... },
//     "locks": { "status": "healthy", ... }
//   }
// }
```

### Distributed Tracing

```typescript
// Traces automatically include correlation IDs
const result = await runtime.execute(
  'order-processor-123',
  async (actor) => {
    // Child actors inherit parent's correlationId
    await actor.processOrder(orderId);
  },
  { correlationId: 'order-flow-456' }
);

// Query traces later
const traces = await traceStore.query({
  correlationId: 'order-flow-456'
});

console.log(traces.length); // All related actor operations
```

### YAML Configuration

```yaml
# loom.config.yaml
actorPools:
  orderProcessor:
    maxSize: 100
    idleTimeout: 300000
    evictionPolicy: lru

messageAdapter:
  type: bullmq
  queueMode: fifo
  maxRetries: 3

stateAdapter:
  type: redis
  host: redis.prod.example.com
  port: 6379
  password: ${REDIS_PASSWORD}

coordinationAdapter:
  type: redis
  lockTimeout: 30000
  renewInterval: 10000

tracing:
  enabled: true
  maxTraceAge: 3600000
```

## Next Steps

- Read the [Architecture Overview](./architecture.md) to understand Loom's design
- Check out [Configuration Guide](./configuration.md) for production setup
- Learn about [Adapters](./adapters.md) for pluggable backends
- Explore [Best Practices](./best-practices.md) for optimal patterns

## License

MIT
