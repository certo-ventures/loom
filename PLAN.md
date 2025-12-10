# Loom - Minimal Durable Execution Framework for AI Agents
## Project Plan & Architecture

**Status**: Planning Phase  
**Date**: December 9, 2025  
**Goal**: Create a MINIMAL, highly functional, performant durable execution framework for AI agents embracing the Actor pattern with WASM-based executables.

---

## Core Principles (YOUR NON-NEGOTIABLES!)

1. **MINIMAL** - No code bloat, no deep inheritance hierarchies, no BS
2. **LEAN** - Cry with joy at how small the codebase is
3. **FUNCTIONAL** - Extract maximum functionality from minimum code
4. **ACTOR-FIRST** - Actor pattern as a first-class citizen
5. **WASM-BASED** - All executables stored and run as WASM modules
6. **JSON-EVERYWHERE** - Inputs, outputs, journals, messages all in JSON
7. **ABSTRACT-STORAGE** - Swappable storage and messaging backends
8. **RESILIENT** - All best practices: retries, circuit breakers, distributed locks, outbox pattern

---

## Tech Stack

### Core
- **Language**: TypeScript/Node.js
- **Execution**: WASM (Wasmtime/Wasmer for sandboxing)
- **State Management**: Plain JSON (no Immer, no magic)
- **Validation**: Zod (JSON schema validation)

### Infrastructure (Default, but swappable)
- **Message Queue**: BullMQ on Redis
- **State Store**: CosmosDB (event sourcing + state snapshots)
- **Blob Storage**: Azure Blob Storage (for WASM modules, large payloads)
- **Distributed Lock**: Redlock (Redis-based)
- **Deployment**: Azure Container Apps and/or AKS

### Observability
- **Tracing**: OpenTelemetry
- **Logging**: Pino (structured JSON logs)
- **Metrics**: Prometheus-compatible

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  Orchestration Layer                         │
│  ┌──────────────────┐         ┌─────────────────────┐       │
│  │  WDL Interpreter │         │  Autonomous Agents  │       │
│  │  (Declarative)   │         │  (AI-Driven)        │       │
│  └──────────────────┘         └─────────────────────┘       │
└────────────────┬──────────────────────┬───────────────────────┘
                 │                      │
┌────────────────▼──────────────────────▼───────────────────────┐
│                   Actor Runtime                               │
│  • Virtual Actor Activation/Deactivation                      │
│  • Journal-based Deterministic Replay                         │
│  • Distributed Lock Management                                │
│  • Message Routing (Actor Mailboxes)                          │
└────────────────┬──────────────────────────────────────────────┘
                 │
┌────────────────▼──────────────────────────────────────────────┐
│                WASM Activity Executor                         │
│  • Load WASM from Blob Storage                                │
│  • Sandbox Execution with Capabilities                        │
│  • JSON Input/Output Validation (Zod)                         │
│  • Instance Pooling & Caching                                 │
└────────────────┬──────────────────────────────────────────────┘
                 │
┌────────────────▼──────────────────────────────────────────────┐
│              Storage Abstraction Layer                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ CosmosDB │  │  Redis   │  │   Blob   │  │  BullMQ     │  │
│  │ (State)  │  │ (Lock/   │  │ (WASM/   │  │ (Messages)  │  │
│  │          │  │  Cache)  │  │  Data)   │  │             │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

---

## Core Components (Minimal Set)

### 1. **Base Actor Class** (~150 lines)
Single base class with journal-based execution:

```typescript
abstract class Actor {
  protected state: any
  private journal: Journal
  private isReplaying: boolean
  
  // Methods:
  // - updateState(updater: (draft) => void)  // Using Immer
  // - callActivity(name: string, input: any)
  // - spawnChild(actorType: string, input: any)
  // - waitForEvent(eventType: string)
  // - suspend(reason: string)
  
  abstract getDefaultState(): any
  abstract execute(input: any): Promise<void>
}
```

**No inheritance beyond this!** Agents just extend `Actor` directly.

### 2. **Actor Runtime** (~300 lines)
Manages actor lifecycle:

```typescript
class ActorRuntime {
  // Core methods:
  // - activateActor(actorId: string): Promise<Actor>
  // - deactivateActor(actorId: string): Promise<void>
  // - sendMessage(actorId: string, message: Message): Promise<void>
  // - resumeActor(actorId: string, eventData: any): Promise<void>
}
```

Features:
- LRU cache for active actors
- Distributed lock (single activation guarantee)
- Automatic deactivation on idle timeout
- Graceful shutdown handling

### 3. **WASM Activity Executor** (~250 lines)
Execute activities from WASM modules:

```typescript
class WasmActivityExecutor {
  // Core methods:
  // - execute(activityName: string, input: any, version?: string): Promise<any>
  // - loadWasmModule(definition: ActivityDefinition): Promise<WebAssembly.Module>
  // - validateInput(input: any, schema: ZodSchema): void
  // - executeInSandbox(module: Module, input: any, capabilities: Capabilities): Promise<any>
}
```

Features:
- WASM module caching (LRU)
- Instance pooling for hot paths
- Resource limits (memory, CPU, timeout)
- Capability-based security
- Zod schema validation

### 4. **Storage Abstraction** (~200 lines)
Interface + implementations:

```typescript
interface StateStore {
  saveActorState(actorId: string, data: ActorState): Promise<void>
  loadActorState(actorId: string): Promise<ActorState | null>
  queryActors(filter: Filter): Promise<ActorState[]>
}

interface BlobStore {
  upload(path: string, data: Buffer): Promise<string>
  download(path: string): Promise<Buffer>
}

interface MessageQueue {
  enqueue(queue: string, message: Message): Promise<void>
  dequeue(queue: string, timeout: number): Promise<Message | null>
  ack(message: Message): Promise<void>
  nack(message: Message, delay?: number): Promise<void>
}

interface LockManager {
  acquire(key: string, ttl: number): Promise<Lock | null>
  release(lock: Lock): Promise<void>
  extend(lock: Lock, ttl: number): Promise<void>
}
```

Implementations:
- `CosmosStateStore`
- `AzureBlobStore`
- `BullMQMessageQueue`
- `RedisLockManager`

### 5. **WDL Interpreter** (~200 lines)
Simple JSON-based workflow definition language:

```typescript
interface WorkflowDefinition {
  name: string
  version: string
  steps: WorkflowStep[]
}

type WorkflowStep = 
  | { type: 'activity', name: string, input: any }
  | { type: 'agent', agentType: string, input: any }
  | { type: 'parallel', branches: WorkflowStep[][] }
  | { type: 'condition', if: string, then: WorkflowStep[], else: WorkflowStep[] }
  | { type: 'wait', event: string }

class WDLInterpreter extends Actor {
  async execute(definition: WorkflowDefinition): Promise<void>
}
```

### 6. **AI Agent Builder** (~100 lines)
Minimal helper for creating AI-enabled actors:

```typescript
class AIActor extends Actor {
  // Built-in methods:
  // - callLLM(provider: string, prompt: string, schema?: ZodSchema): Promise<any>
  // - buildPromptFromConfig(configPath: string, variables: any): Promise<string>
  // - validateResponse(response: any, schema: ZodSchema): any
}
```

Supports multiple AI providers as WASM activities:
- `openai-chat` activity
- `anthropic-chat` activity
- `azure-openai-chat` activity

### 7. **Service Discovery** (~100 lines)
Actor discovery using Redis:

```typescript
class ServiceRegistry {
  // Methods:
  // - register(actorType: string, instanceId: string, metadata: any): Promise<void>
  // - discover(actorType: string): Promise<ActorInstance[]>
  // - deregister(actorType: string, instanceId: string): Promise<void>
}
```

Dapr-like actor functionality:
- Actor type registration
- Load balancing across instances
- Health checking
- Automatic deregistration on failure

---

## Data Structures

### Actor State (CosmosDB)
```json
{
  "id": "actor-uuid",
  "partitionKey": "actor-type",
  "actorType": "planning-agent",
  "status": "suspended",
  "suspendReason": "awaiting_event:user_input",
  
  "journal": {
    "entries": [
      { "type": "state_patches", "patches": [...], "inversePatches": [...] },
      { "type": "activity_scheduled", "activityId": "act-1", "name": "openai-chat", "input": {...} },
      { "type": "activity_completed", "activityId": "act-1", "result": {...} },
      { "type": "child_spawned", "childId": "actor-child-uuid", "actorType": "worker" },
      { "type": "suspended", "reason": "awaiting_event:user_input" }
    ],
    "cursor": 5
  },
  
  "state": {
    "messages": [...],
    "currentGoal": "...",
    "toolCalls": [...]
  },
  
  "metadata": {
    "correlationId": "workflow-uuid",
    "parentActorId": "actor-parent-uuid",
    "createdAt": "2024-12-09T...",
    "lastActivatedAt": "2024-12-09T...",
    "activationCount": 42
  }
}
```

### Activity Definition (CosmosDB)
```json
{
  "id": "activity-uuid",
  "partitionKey": "activity-definition",
  "activityName": "openai-chat",
  "version": "1.0.0",
  
  "wasmBlobUrl": "https://.../activities/openai-chat-v1.0.0.wasm",
  
  "inputSchema": {
    "messages": "z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))",
    "model": "z.string().default('gpt-4')",
    "responseFormat": "z.object({...}).optional()"
  },
  
  "outputSchema": {
    "content": "z.string()",
    "usage": "z.object({ tokens: z.number() })"
  },
  
  "capabilities": {
    "network": true,
    "secrets": ["OPENAI_API_KEY"]
  },
  
  "limits": {
    "maxMemoryMB": 256,
    "maxExecutionMs": 30000
  },
  
  "retryPolicy": {
    "maxAttempts": 3,
    "backoffMs": [1000, 2000, 4000]
  }
}
```

### Message (BullMQ)
```json
{
  "messageId": "msg-uuid",
  "actorId": "actor-uuid",
  "messageType": "event" | "activate" | "resume",
  "correlationId": "workflow-uuid",
  
  "payload": {
    "eventType": "user_input",
    "data": {...}
  },
  
  "metadata": {
    "timestamp": "2024-12-09T...",
    "sender": "actor-parent-uuid",
    "priority": 0,
    "ttl": 3600000
  }
}
```

---

## Best Practices Implementation

### 1. Retry & Resilience Patterns
```typescript
// Exponential backoff with jitter
const retryWithBackoff = async (fn, maxAttempts = 3) => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn()
    } catch (error) {
      if (i === maxAttempts - 1) throw error
      const backoff = Math.min(1000 * Math.pow(2, i), 10000)
      const jitter = Math.random() * 1000
      await sleep(backoff + jitter)
    }
  }
}

// Circuit breaker for activities
class CircuitBreaker {
  private failures = 0
  private lastFailureTime = 0
  private state: 'closed' | 'open' | 'half-open' = 'closed'
}
```

### 2. Distributed Lock Pattern
```typescript
// Ensure single actor activation across cluster
const lock = await lockManager.acquire(`actor:${actorId}`, 30000)
if (!lock) {
  throw new Error('Actor already active elsewhere')
}

try {
  // Activate and process
  const heartbeat = setInterval(() => lockManager.extend(lock, 30000), 10000)
  await processActor()
} finally {
  clearInterval(heartbeat)
  await lockManager.release(lock)
}
```

### 3. Outbox Pattern
```typescript
// Atomic state update + message send
class OutboxPattern {
  async saveStateAndSendMessages(actorId: string, state: any, messages: Message[]) {
    // Save to CosmosDB with outbox table
    await cosmosDB.transaction([
      { op: 'update', collection: 'actors', id: actorId, data: state },
      ...messages.map(msg => ({ op: 'insert', collection: 'outbox', data: msg }))
    ])
    
    // Background worker polls outbox and sends to BullMQ
  }
}
```

### 4. Message Queue Best Practices
```typescript
// Visibility timeout for worker failures
const message = await queue.dequeue('actor-events', { visibilityTimeout: 30000 })

try {
  await processMessage(message)
  await queue.ack(message)
} catch (error) {
  // Retry with backoff
  await queue.nack(message, { delay: 5000 })
}

// Dead letter queue after max retries
if (message.attempts >= 3) {
  await queue.moveToDeadLetter(message)
}
```

### 5. Idempotency
```typescript
// Message deduplication
const messageId = message.messageId
const processed = await redis.get(`processed:${messageId}`)
if (processed) {
  await queue.ack(message)  // Already processed
  return
}

await processMessage(message)
await redis.set(`processed:${messageId}`, '1', 'EX', 86400)  // 24h TTL
await queue.ack(message)
```

---

## Workflow Definition Language (WDL)

### Example: Customer Onboarding
```json
{
  "name": "customer-onboarding",
  "version": "1.0.0",
  "steps": [
    {
      "id": "collect-info",
      "type": "activity",
      "activity": "http-request",
      "input": {
        "url": "https://api.example.com/forms/signup",
        "method": "POST"
      },
      "output": "userInfo"
    },
    {
      "id": "create-account",
      "type": "activity",
      "activity": "create-user-account",
      "input": "{{ userInfo }}",
      "output": "account",
      "compensation": {
        "activity": "delete-user-account",
        "input": "{{ account.userId }}"
      }
    },
    {
      "id": "send-verification",
      "type": "agent",
      "agentType": "email-verification-agent",
      "input": {
        "email": "{{ userInfo.email }}",
        "userId": "{{ account.userId }}"
      }
    },
    {
      "id": "wait-verification",
      "type": "wait",
      "event": "email_verified",
      "timeout": 3600000
    },
    {
      "id": "notify-success",
      "type": "parallel",
      "branches": [
        [
          { "type": "activity", "activity": "send-welcome-email", "input": "{{ account }}" }
        ],
        [
          { "type": "activity", "activity": "log-event", "input": { "event": "user_onboarded" } }
        ]
      ]
    }
  ]
}
```

---

## Development Phases

### Phase 1: Core Foundation (4-5 weeks)
**Goal**: Minimal working system with basic actor lifecycle

**Week 1-2: Storage & Messaging Abstractions**
- [ ] Storage interfaces (StateStore, BlobStore, MessageQueue, LockManager)
- [ ] CosmosDB implementation
- [ ] Redis/BullMQ implementation
- [ ] Azure Blob Storage implementation
- [ ] Zod schemas for all data structures
- [ ] Unit tests with in-memory implementations

**Week 3: Actor Runtime**
- [ ] Base Actor class with journal
- [ ] Immer-based state management with patches
- [ ] Actor activation/deactivation logic
- [ ] Distributed lock integration
- [ ] Message routing and mailboxes
- [ ] Basic replay mechanism

**Week 4-5: WASM Executor**
- [ ] WASM activity loader (from Blob Storage)
- [ ] Sandbox execution (Wasmtime/Wasmer integration)
- [ ] JSON input/output marshaling
- [ ] Zod schema validation
- [ ] Module caching and instance pooling
- [ ] Resource limits enforcement
- [ ] Sample WASM activities (Rust): echo, http-request, openai-chat

**Deliverable**: Can create an actor, call WASM activities, suspend, resume

---

### Phase 2: Resilience & Production Features (3-4 weeks)
**Goal**: Production-ready with all best practices

**Week 6: Retry & Error Handling**
- [ ] Exponential backoff with jitter
- [ ] Circuit breaker pattern
- [ ] Activity-level retries
- [ ] Actor-level error recovery
- [ ] Compensation/saga pattern
- [ ] Dead letter queues

**Week 7: Distributed Patterns**
- [ ] Outbox pattern implementation
- [ ] Message deduplication
- [ ] Exactly-once processing guarantees
- [ ] Distributed tracing (OpenTelemetry)
- [ ] Correlation ID propagation
- [ ] Structured logging (Pino)

**Week 8-9: Service Discovery & Clustering**
- [ ] Service registry (Redis-based)
- [ ] Actor type registration
- [ ] Health checking
- [ ] Load balancing
- [ ] Graceful shutdown
- [ ] Cluster coordination

**Deliverable**: Production-ready system with full resilience

---

### Phase 3: Developer Experience (3-4 weeks)
**Goal**: Easy to use, well-documented

**Week 10: WDL Interpreter**
- [ ] JSON workflow parser
- [ ] Step execution engine
- [ ] Variable interpolation
- [ ] Conditional logic
- [ ] Parallel execution
- [ ] Compensation support
- [ ] Workflow versioning

**Week 11: AI Agent Helpers**
- [ ] AIActor base class
- [ ] Prompt builder from config
- [ ] Multi-provider LLM support
- [ ] Response validation
- [ ] Token tracking
- [ ] Cost estimation

**Week 12: Tooling & CLI**
- [ ] CLI for deployment
- [ ] Local development mode (in-memory stores)
- [ ] Testing utilities (mock actors/activities)
- [ ] WASM activity scaffolding
- [ ] Actor scaffolding
- [ ] Debugging tools

**Week 13: Documentation**
- [ ] Architecture guide
- [ ] Quick start tutorial
- [ ] API reference
- [ ] WASM activity development guide
- [ ] Best practices guide
- [ ] Example applications

**Deliverable**: Developer-friendly framework with great DX

---

## Project Structure

```
loom/
├── packages/
│   ├── core/                    # Core framework
│   │   ├── src/
│   │   │   ├── actor/
│   │   │   │   ├── Actor.ts           # Base actor class (~150 lines)
│   │   │   │   ├── Journal.ts         # Journal types & utils (~50 lines)
│   │   │   │   └── AIActor.ts         # AI-specific helpers (~100 lines)
│   │   │   ├── runtime/
│   │   │   │   ├── ActorRuntime.ts    # Lifecycle manager (~300 lines)
│   │   │   │   ├── WasmExecutor.ts    # WASM activity executor (~250 lines)
│   │   │   │   └── ServiceRegistry.ts # Service discovery (~100 lines)
│   │   │   ├── storage/
│   │   │   │   ├── interfaces.ts      # Storage interfaces (~200 lines)
│   │   │   │   ├── cosmos.ts          # CosmosDB impl (~150 lines)
│   │   │   │   ├── blob.ts            # Blob storage impl (~100 lines)
│   │   │   │   ├── bullmq.ts          # BullMQ impl (~150 lines)
│   │   │   │   ├── redis-lock.ts      # Redlock impl (~100 lines)
│   │   │   │   └── inmemory.ts        # In-memory (dev/test) (~200 lines)
│   │   │   ├── wdl/
│   │   │   │   ├── WDLInterpreter.ts  # Workflow interpreter (~200 lines)
│   │   │   │   └── schema.ts          # WDL types & schemas (~100 lines)
│   │   │   ├── patterns/
│   │   │   │   ├── retry.ts           # Retry logic (~80 lines)
│   │   │   │   ├── circuit-breaker.ts # Circuit breaker (~100 lines)
│   │   │   │   ├── outbox.ts          # Outbox pattern (~120 lines)
│   │   │   │   └── idempotency.ts     # Deduplication (~80 lines)
│   │   │   └── observability/
│   │   │       ├── tracing.ts         # OpenTelemetry (~100 lines)
│   │   │       └── logging.ts         # Structured logging (~50 lines)
│   │   └── package.json
│   │
│   └── cli/                     # CLI tooling
│       ├── src/
│       │   ├── commands/
│       │   │   ├── init.ts            # Project scaffolding
│       │   │   ├── dev.ts             # Local dev server
│       │   │   ├── deploy.ts          # Deployment
│       │   │   └── wasm.ts            # WASM activity tools
│       │   └── index.ts
│       └── package.json
│
├── examples/                    # Example applications
│   ├── email-verification/
│   ├── customer-onboarding/
│   └── autonomous-planner/
│
├── activities/                  # Sample WASM activities
│   ├── openai-chat/            # Rust WASM activity
│   ├── http-request/
│   └── email-sender/
│
└── docs/
    ├── architecture.md
    ├── quickstart.md
    ├── api-reference.md
    └── wasm-development.md
```

**Total Core Framework**: ~2,500-3,000 lines of TypeScript (excluding tests)

---

## Key Decisions & Trade-offs

### 1. Journal-based vs Event Sourcing
**Decision**: Hybrid approach
- Use Immer patches for state (efficient, minimal)
- Full journal for activities (replay capability)
- Optional: Save state snapshots for fast querying

**Why**: Balance between developer experience and replay capability

### 2. WASM vs Native Functions
**Decision**: WASM-first, allow native fallback
- Activities are WASM by default
- Framework functions (retry, etc.) are native TypeScript
- Escape hatch for critical native code

**Why**: Security, portability, multi-language support

### 3. CosmosDB vs Other Databases
**Decision**: Abstract interface, CosmosDB default
- Works with Azure ecosystem
- Strong consistency options
- Can swap for PostgreSQL, MongoDB, etc.

**Why**: Flexibility without lock-in

### 4. BullMQ vs Other Queues
**Decision**: BullMQ on Redis
- Production-ready
- Great DX
- Can swap for RabbitMQ, SQS, etc. via interface

**Why**: Mature, reliable, Redis already needed for locks

### 5. Immer vs Manual State
**Decision**: Immer with patches
- Clean updates
- Automatic change detection
- Compensation support (inverse patches)

**Why**: Developer experience without magic

---

## Success Metrics

### Code Size Goals
- Core framework: **< 3,000 lines** (excluding tests)
- Base Actor class: **< 150 lines**
- Actor Runtime: **< 300 lines**
- WASM Executor: **< 250 lines**
- Total package (with dependencies): **< 5MB**

### Performance Goals
- Actor activation (cold): **< 100ms**
- Actor activation (warm/cached): **< 10ms**
- Replay 100 journal entries: **< 50ms**
- WASM activity execution overhead: **< 5ms**
- Message throughput: **> 1,000 msg/sec per worker**

### Developer Experience Goals
- Time to first actor: **< 5 minutes**
- Lines of code for simple agent: **< 30 lines**
- WASM activity template to working: **< 10 minutes**

---

## Risks & Mitigations

### Risk: WASM ecosystem immaturity
**Mitigation**: 
- Start with Wasmtime (mature, Mozilla-backed)
- Support native TypeScript activities as fallback
- Community is growing rapidly

### Risk: CosmosDB costs
**Mitigation**:
- Use partition keys wisely
- Cache hot actors in memory
- Provide PostgreSQL adapter

### Risk: Complexity creep
**Mitigation**:
- Strict line count budgets
- Regular code reviews for bloat
- YAGNI principle religiously

### Risk: Learning curve (WASM)
**Mitigation**:
- Excellent documentation
- Pre-built activity templates
- Support TypeScript → WASM (AssemblyScript)

---

## Next Steps (Priority Order)

### Immediate (This Week)
1. ✅ Review and refine this plan
2. ✅ Set up monorepo structure
3. ✅ Define TypeScript interfaces for all abstractions
4. ✅ Set up testing framework (Vitest)
5. ✅ Create initial Zod schemas

### Week 1-2
1. Implement storage interfaces
2. Build in-memory implementations (for testing)
3. Build CosmosDB implementation
4. Build BullMQ implementation
5. Build Redis lock manager

### Week 3
1. Implement Base Actor class
2. Implement journal with Immer patches
3. Build replay mechanism
4. Add suspend/resume logic

### Week 4-5
1. Implement WASM executor
2. Create sample Rust WASM activities
3. Add schema validation
4. Add resource limits

---

## Suggested Improvements & Enhancements

### 1. **Workflow Visualization**
- Generate Mermaid diagrams from WDL
- Real-time execution visualization
- Debugging timeline view

### 2. **Hot Code Reloading**
- Update WASM activities without restarting
- A/B testing for activities
- Gradual rollout support

### 3. **Multi-Tenancy**
- Namespace isolation
- Per-tenant resource quotas
- Shared vs isolated storage

### 4. **Advanced Patterns**
- Saga orchestrator as built-in actor
- Event streaming integration
- Long-running human workflows

### 5. **Developer Tools**
- VS Code extension
- Interactive debugger
- Time-travel debugging (replay to any point)

### 6. **Performance Optimizations**
- Actor pooling (keep warm)
- Predictive pre-activation
- Journal compaction
- State snapshots for fast queries

### 7. **Security Enhancements**
- WASM capability-based security
- Secrets management integration (Azure Key Vault)
- Audit logging
- Rate limiting per actor type

### 8. **Ecosystem**
- Activity marketplace
- Pre-built agents library
- Integration templates (Stripe, Twilio, etc.)

---

## Questions to Resolve

1. **Actor ID Generation**: UUID vs custom scheme?
2. **Versioning Strategy**: Semantic versioning for actors and activities?
3. **Multi-region**: Support for geo-distributed deployments?
4. **Billing/Metering**: Built-in usage tracking?
5. **TypeScript vs JavaScript**: Require TypeScript or allow JS?

---

## Comparison with Alternatives

| Feature | Loom | Temporal | Durable Functions | Restate |
|---------|------|----------|------------------|---------|
| Language | Node/TS | Go/TS/Python | C#/JS/Python | TS/Java |
| Actor Model | ✅ First-class | ⚠️ Via workflows | ❌ No | ✅ First-class |
| WASM Support | ✅ Native | ❌ No | ❌ No | ✅ Planned |
| Self-hosted | ✅ Yes | ✅ Yes | ⚠️ Via Azure | ✅ Yes |
| Code Size | 🎯 < 3k LOC | ~100k+ LOC | N/A (Azure) | ~50k+ LOC |
| Learning Curve | 🎯 Low | Medium | Low | Medium |
| AI-First | ✅ Yes | ❌ No | ❌ No | ❌ No |

**Loom's Unique Value**: Minimal, AI-first, actor-native, WASM-powered

---

## Conclusion

This plan provides a **MINIMAL** yet **COMPLETE** durable execution framework that:

✅ Embraces the Actor pattern as first-class  
✅ Uses WASM for portable, secure execution  
✅ Supports both declarative (WDL) and autonomous (AI) orchestration  
✅ Implements all resilience best practices  
✅ Keeps the codebase tiny (< 3k LOC)  
✅ Provides swappable storage/messaging backends  
✅ Delivers excellent developer experience  

**Timeline**: 12-13 weeks to production-ready v1.0

**Ready to start coding?** Let's begin with Phase 1: Storage & Messaging Abstractions! 🚀
