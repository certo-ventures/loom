# Loom

> A production-ready, durable execution framework for building reliable distributed systems and AI agents with actor-based isolation, exactly-once semantics, and comprehensive observability.

[![npm version](https://img.shields.io/npm/v/@certo-ventures/loom.svg)](https://www.npmjs.com/package/@certo-ventures/loom)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

Loom is a TypeScript framework for building reliable, durable distributed systems using the actor model. It combines journal-based execution, distributed coordination, and pluggable storage backends to provide production-grade reliability without the complexity of traditional orchestration platforms.

**Perfect for:**
- 🤖 AI agent systems with reliable state management
- 💳 Payment processing requiring exactly-once semantics
- 📦 Order fulfillment and workflow orchestration
- 🔄 Distributed data pipelines with fault tolerance
- 🌐 Multi-tenant SaaS applications with actor isolation

## Key Features

### 🎯 Exactly-Once Semantics
Prevent duplicate payments, shipments, emails, and data writes with built-in idempotency:
```typescript
// Message with idempotency key - guaranteed to execute only once
await queue.send({
  actorId: 'payment-processor',
  body: { orderId: '123', amount: 100 },
  idempotencyKey: `order-123-payment`, // Prevents duplicate charges
  trace: context.trace
});
```

**Three storage backends:**
- **InMemory**: Fast, for development and testing
- **Redis**: Production-ready with auto-expiration
- **CosmosDB**: Globally distributed with query capabilities

### 🏗️ Actor-Based Architecture
Isolate state and behavior into actors with automatic lifecycle management:
```typescript
class PaymentProcessor extends Actor {
  async processPayment(order: Order): Promise<PaymentResult> {
    // Check idempotency automatically
    if (await this.checkIdempotency(`payment-${order.id}`)) {
      return this.cachedResult; // Already processed
    }

    // Process payment (guaranteed exactly-once)
    const result = await stripe.charge(order);
    
    // Cache result for future duplicate requests
    await this.storeIdempotency(`payment-${order.id}`, result);
    
    return result;
  }
}
```

### 📊 Journal-Based Persistence
Every operation is logged to a persistent journal for complete auditability:
- **Replay**: Reconstruct actor state from journal entries
- **Debugging**: Trace exactly what happened and when
- **Recovery**: Resume from last known state after crashes
- **Compliance**: Full audit trail for regulatory requirements

### 🔒 Distributed Coordination
Built-in distributed locking ensures single-instance ownership:
- **Automatic Lock Management**: Acquire on creation, renew periodically, release on eviction
- **Multiple Backends**: Redis locks, Cosmos DB leases, or custom implementations
- **Fault Tolerant**: Automatic lock recovery on node failures

### 📡 Reference-Based Observability
Lightweight tracing that references data instead of duplicating it:
```typescript
// Trace event with references (not full data)
{
  trace_id: 'abc123',
  event_type: 'actor:message_deduplicated',
  refs: {
    message: { message_id: 'msg-456', queue_name: 'orders' },
    idempotency: { key: 'order-123-payment', original_execution: '2024-12-01' }
  }
}
```

**Benefits:**
- 90% reduction in trace storage costs
- Join traces with actual data for detailed analysis
- Efficient querying and correlation across distributed systems

### 🔌 Pluggable Storage Adapters
Choose the right backend for your needs:

**Message Queues:**
- BullMQ (Redis-backed)
- Redis Pub/Sub
- RabbitMQ
- InMemory (testing)

**State Storage:**
- Redis (fast key-value)
- CosmosDB (globally distributed)
- PostgreSQL (relational)
- InMemory (testing)

**Coordination:**
- Redis distributed locks
- CosmosDB leases
- InMemory (development)

### 🌐 WASM Support
Run untrusted or polyglot actors in isolated WebAssembly sandboxes:
```typescript
// Compile actor to WASM
import { compileWasmActor } from '@certo-ventures/loom/wasm';

const wasmBuffer = await compileWasmActor('calculator-actor.ts');

// Execute in isolated sandbox
const runtime = new WasmActorRuntime(wasmBuffer);
const result = await runtime.execute('add', { a: 5, b: 3 });
```

**Use cases:**
- Multi-tenant isolation
- User-provided code execution
- Cross-language actors (Rust, AssemblyScript, C++)
- Resource-constrained environments

### 🔐 Secrets Management
Secure credential handling with Azure Key Vault integration:
```typescript
const actor = new MyActor(context, state, tracer, {
  secrets: {
    apiKey: 'vault://my-vault/api-key',
    dbPassword: 'vault://my-vault/db-password'
  }
});
```

### 🎨 Loom Studio (Development UI)
Real-time development dashboard with:
- Live actor monitoring and state inspection
- Message queue visualization
- Trace explorer with reference resolution
- Manual actor invocation
- Configuration management

## Quick Start

### Installation

```bash
npm install @certo-ventures/loom
```

### Basic Example

```typescript
import { Actor, RedisStateAdapter, BullMQMessageAdapter } from '@certo-ventures/loom';

// Define your actor
class OrderProcessor extends Actor {
  async processOrder(orderId: string): Promise<void> {
    // Check idempotency
    if (await this.checkIdempotency(`order-${orderId}`)) {
      return; // Already processed
    }

    // Process order
    await this.chargePayment(orderId);
    await this.shipOrder(orderId);
    await this.sendConfirmationEmail(orderId);

    // Store idempotency result
    await this.storeIdempotency(`order-${orderId}`, { success: true });
  }
}

// Configure runtime
const runtime = new ActorRuntime({
  stateAdapter: new RedisStateAdapter(redis),
  messageAdapter: new BullMQMessageAdapter(redis),
  idempotencyStore: new RedisIdempotencyStore(redis, 86400),
});

// Send message with idempotency key
await runtime.send({
  actorId: 'order-processor-123',
  body: { orderId: 'order-123' },
  idempotencyKey: 'process-order-123', // Prevents duplicate processing
});
```

### With Configuration File

```yaml
# loom.config.yaml
redis:
  host: localhost
  port: 6379

actors:
  payment-processor:
    timeout: 30000
    idempotencyTtl: 86400  # 24 hours
    retryPolicy:
      maxAttempts: 3
      backoff: exponential

observability:
  enabled: true
  port: 9090
```

```typescript
import { loadConfig } from '@certo-ventures/loom/config';

const config = await loadConfig('loom.config.yaml');
const runtime = await createRuntimeFromConfig(config);
```

## Architecture

### Actor Lifecycle

```
┌─────────────────────────────────────────────────────┐
│                   Message Queue                      │
│              (BullMQ, Redis, RabbitMQ)              │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│              Actor Pool (LRU Cache)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ Actor A  │  │ Actor B  │  │ Actor C  │  ...    │
│  │ (Locked) │  │ (Active) │  │ (Idle)   │         │
│  └────┬─────┘  └────┬─────┘  └──────────┘         │
│       │             │                               │
└───────┼─────────────┼───────────────────────────────┘
        │             │
        ▼             ▼
┌────────────────────────────┐  ┌──────────────────┐
│     Journal Storage        │  │  Idempotency     │
│  (Redis Streams, Cosmos)   │  │      Store       │
│                            │  │ (Redis, Cosmos)  │
└────────────────────────────┘  └──────────────────┘
```

### Exactly-Once Processing Flow

```
1. Message arrives with idempotencyKey
2. Actor checks IdempotencyStore
   ├─ If found: Return cached result (deduplicated)
   └─ If not found: Continue to step 3
3. Execute business logic
4. Store result in IdempotencyStore with TTL
5. Return result to caller
```

## Production Deployment

### Docker Compose Example

```yaml
version: '3.8'
services:
  loom-worker:
    image: my-loom-app:latest
    environment:
      - REDIS_HOST=redis
      - COSMOS_ENDPOINT=https://my-cosmos.documents.azure.com:443/
    depends_on:
      - redis
      - cosmos

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  loom-studio:
    image: my-loom-app:latest
    command: npm run studio
    ports:
      - "3000:3000"
    environment:
      - REDIS_HOST=redis
```

### Health Monitoring

```typescript
import { createHealthServer } from '@certo-ventures/loom/observability';

const server = await createHealthServer({
  port: 9090,
  runtime: actorRuntime
});

// GET /health -> { status: 'ok', actors: 15, messages: 42 }
// GET /metrics -> Prometheus-compatible metrics
```

## Configuration

### Runtime Configuration

```typescript
interface ActorInfrastructureConfig {
  timeout?: number;                    // Default: 30000ms
  idempotencyTtl?: number;            // Default: 86400s (24h)
  retryPolicy?: {
    maxAttempts?: number;             // Default: 3
    backoff?: 'fixed' | 'exponential'; // Default: 'exponential'
    initialDelayMs?: number;          // Default: 1000ms
    maxDelayMs?: number;              // Default: 30000ms
    multiplier?: number;              // Default: 2
  };
  messageOrdering?: 'fifo' | 'standard'; // Default: 'standard'
  concurrency?: number;                // Default: 1
}
```

### Storage Configuration

```typescript
// Redis
const redis = new Redis({
  host: 'localhost',
  port: 6379,
  password: process.env.REDIS_PASSWORD
});

// Cosmos DB with Managed Identity
const { DefaultAzureCredential } = require('@azure/identity');
const cosmosClient = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  aadCredentials: new DefaultAzureCredential()
});
```

## Advanced Features

### WASM Actor Composition

```typescript
// Compose multiple WASM actors
const loanEngine = await composeWasmActors([
  'credit-scorer.wasm',
  'risk-analyzer.wasm',
  'rate-calculator.wasm'
]);

const decision = await loanEngine.execute('evaluateLoan', loanApplication);
```

### Service Discovery

```typescript
// Register actor for discovery
await discovery.register({
  actorId: 'payment-processor',
  capabilities: ['stripe', 'paypal'],
  metadata: { region: 'us-east-1' }
});

// Discover actors by capability
const processors = await discovery.find({ capability: 'stripe' });
```

### Event-Driven Triggers

```typescript
// HTTP trigger
const trigger = createHttpTrigger({
  path: '/api/orders',
  method: 'POST',
  actorType: 'order-processor'
});

// Schedule trigger
const trigger = createScheduleTrigger({
  cron: '0 */6 * * *', // Every 6 hours
  actorId: 'report-generator'
});
```

## Comparison with Other Frameworks

| Feature | Loom | Temporal | DBOS | Dapr |
|---------|------|----------|------|------|
| Exactly-Once Semantics | ✅ Built-in | ✅ Built-in | ✅ Built-in | ❌ External |
| TypeScript Native | ✅ | ⚠️ SDK | ✅ | ⚠️ SDK |
| WASM Support | ✅ | ❌ | ❌ | ⚠️ Limited |
| Actor Model | ✅ | ❌ Workflows | ✅ | ⚠️ Pub/Sub |
| Reference-Based Tracing | ✅ | ❌ | ❌ | ❌ |
| Development UI | ✅ Studio | ✅ Web UI | ✅ | ✅ Dashboard |
| Self-Hosted | ✅ | ✅ | ✅ | ✅ |
| Learning Curve | Low | High | Low | Medium |

## Documentation

- [Architecture Overview](./docs/architecture.md)
- [Configuration Guide](./docs/configuration.md)
- [Observability & Tracing](./docs/REDIS_MESSAGE_FLOW.md)
- [WASM Integration](./docs/WASM_INTEGRATION_ARCHITECTURE.md)
- [Production Deployment](./docs/STUDIO_PRODUCTION_READY.md)
- [API Reference](./docs/README.md)

## Examples

- [Basic Actor](./examples/hello-world/)
- [Payment Processing](./examples/payment-processor/)
- [Mortgage Appraisal](./demos/mortgage-appraisal/)
- [WASM Calculator](./examples/wasm/)
- [Event-Driven Triggers](./demos/coordination-example.ts)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT © Certo Ventures

## Support

- 📖 [Documentation](./docs/README.md)
- 💬 [GitHub Discussions](https://github.com/certo-ventures/loom/discussions)
- 🐛 [Issue Tracker](https://github.com/certo-ventures/loom/issues)
- 📧 Email: support@certo.ventures

---

**Built with ❤️ for reliable distributed systems**
