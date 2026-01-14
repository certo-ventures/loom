# Loom vs Temporal: Comprehensive Comparison

## Executive Summary

Both Loom and Temporal provide **durable execution** for building reliable distributed systems, but they take fundamentally different architectural approaches:

**Temporal**: Enterprise workflow orchestration platform with centralized server infrastructure  
**Loom**: Lightweight actor framework with pluggable backends and minimal infrastructure

| Aspect | Temporal | Loom |
|--------|----------|------|
| **Architecture** | Server-based (Temporal Server + Workers) | Actor-based (ActorRuntime + Message Queues) |
| **Primary Pattern** | Workflows + Activities | Actors + Pipelines |
| **State Management** | Event sourcing via Temporal Server | Journal-based with pluggable stores |
| **Infrastructure** | Requires Temporal Server (self-hosted or cloud) | Works with existing Redis/Cosmos/Postgres |
| **Complexity** | More complex (server cluster, workers) | Simpler (just app + storage backend) |
| **Best For** | Long-running workflows, enterprise scale | Microservices, AI agents, moderate scale |
| **Maturity** | Battle-tested, 9 years production (Uber origins) | Newer, built on proven patterns |

---

## Core Concepts Comparison

### Temporal's Model: Workflows + Activities + Server

```
┌─────────────────────────────────────────────────────────┐
│                   Temporal Server                        │
│  (Central orchestration, event history, task queues)    │
│  - History Service (event sourcing)                     │
│  - Matching Service (task routing)                      │
│  - Frontend Service (API gateway)                       │
└──────────────┬──────────────────────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
┌───────▼─────┐ ┌────▼──────┐
│  Workflow   │ │ Workflow  │
│  Workers    │ │ Workers   │
│  (Pool)     │ │ (Pool)    │
└─────────────┘ └───────────┘
        │
        ▼
  Execute Activities
  (API calls, DB ops, etc.)
```

**Key characteristics:**
- **Workflows** are deterministic orchestration code (must be pure, no side effects)
- **Activities** are non-deterministic work (API calls, database operations)
- **Temporal Server** stores all event history and manages routing
- **Workers** execute workflow and activity code
- State reconstructed by replaying event history

### Loom's Model: Actors + Journals + Storage

```
┌─────────────────────────────────────────────────────────┐
│                 Your Application                         │
│  ┌────────────────────────────────────────────────┐    │
│  │          LongLivedActorRuntime                  │    │
│  │  (Actor pool, message routing, coordination)   │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐     │    │
│  │  │ Actor 1  │  │ Actor 2  │  │ Actor N  │     │    │
│  │  │ +state   │  │ +state   │  │ +state   │     │    │
│  │  │ +journal │  │ +journal │  │ +journal │     │    │
│  │  └──────────┘  └──────────┘  └──────────┘     │    │
│  └────────────────────────────────────────────────┘    │
└─────────────┬───────────────────────────────────────────┘
              │
       ┌──────┴──────┐
       │             │
┌──────▼─────┐ ┌────▼──────────┐
│   Redis    │ │  BullMQ/Queue │
│  (State +  │ │  (Messages)   │
│   Locks)   │ │               │
└────────────┘ └───────────────┘
```

**Key characteristics:**
- **Actors** are stateful objects with in-memory state
- **Journals** log every operation for replay/audit
- **Message queues** for decoupled communication (optional - also supports direct invocation)
- **Pluggable storage** - use existing infrastructure
- No central server required

---

## Feature Comparison

### 1. Durable Execution

**Temporal:**
```typescript
// Workflow code - must be deterministic
@workflow.defn
class OrderWorkflow {
  @workflow.run
  async run(orderId: string) {
    // Sleep for 30 days (state persisted automatically)
    await workflow.sleep('30 days')
    
    // Execute activity (with retries)
    const result = await workflow.executeActivity(
      processPayment,
      { orderId },
      { startToCloseTimeout: '5m', retryPolicy: {...} }
    )
    
    return result
  }
}
```

**Loom:**
```typescript
// Actor code - stateful, journal-based
class OrderActor extends Actor {
  async execute(input: { action: string, orderId: string }) {
    // State persists automatically via journal
    const order = this.state.order as Order
    
    if (input.action === 'process-payment') {
      // Call external service (retries handled by infrastructure)
      const result = await this.processPayment(order)
      
      // Update state (logged to journal)
      this.updateState({ 
        paymentStatus: result.status,
        paymentId: result.id 
      })
      
      // Schedule follow-up (30 days later)
      await this.scheduleMessage({
        actorId: this.context.actorId,
        payload: { action: 'send-reminder' },
        scheduleAt: Date.now() + 30 * 24 * 60 * 60 * 1000
      })
    }
    
    return order
  }
}
```

**Comparison:**
- Both guarantee state persistence and recovery
- Temporal: Implicit state management (replay-based)
- Loom: Explicit state management (journal + in-memory)
- Temporal: Centralized event history
- Loom: Distributed journals per actor

---

### 2. Long-Running Processes

**Temporal:** ✅ **Best-in-class**
- Workflows can run for **years** without issues
- Built-in timers with millisecond precision
- Event history compaction for long workflows
- Automatic versioning for code updates

```typescript
// Run for a year, sending monthly emails
for (let i = 0; i < 12; i++) {
  await workflow.executeActivity(sendEmail)
  await workflow.sleep('30 days') // ← This is what Temporal excels at!
}
```

**Loom:** ✅ **Good with caveats**
- Actors can persist indefinitely (with eviction/resurrection)
- Long delays via scheduled messages (Redis Streams, BullMQ delayed jobs)
- State restored from journal on activation
- More suitable for hours/days than months/years

```typescript
// Schedule message 30 days out
await this.scheduleMessage({
  actorId: 'reminder-actor',
  payload: { action: 'send-reminder' },
  scheduleAt: Date.now() + 30 * 24 * 60 * 60 * 1000
})
```

**Winner:** Temporal - purpose-built for long-running workflows

---

### 3. Fault Tolerance & Recovery

**Temporal:**
- **Automatic replay** from event history
- **Deterministic execution** ensures identical replay
- **Activity retries** with exponential backoff
- **Workflow versioning** for code updates during execution
- Requires Temporal Server for history storage

```typescript
// Activity with automatic retries
await workflow.executeActivity(
  chargePayment,
  { orderId: '123' },
  {
    startToCloseTimeout: '5m',
    retryPolicy: {
      initialInterval: '1s',
      maximumAttempts: 5,
      backoffCoefficient: 2.0
    }
  }
)
```

**Loom:**
- **Journal replay** reconstructs actor state
- **Distributed locks** prevent duplicate actors
- **Idempotency keys** prevent duplicate execution
- **Retry policies** via message queue or pipeline config
- Works with any storage backend (Redis, Cosmos, Postgres)

```typescript
// Actor automatically replays journal on activation
const actor = await runtime.getActor('payment-123', 'PaymentProcessor', context)

// Idempotency prevents duplicate execution
await actor.execute({
  method: 'charge',
  idempotencyKey: 'order-123-charge'
})
```

**Winner:** Tie - different approaches, both effective

---

### 4. State Management

**Temporal:**
- State implicit in workflow variables
- Reconstructed by replaying event history
- Workflow variables must be serializable
- No direct state queries (must query via workflow)

```typescript
@workflow.defn
class OrderWorkflow {
  @workflow.run
  async run(orderId: string) {
    // Local variables = state (reconstructed on replay)
    let orderStatus = 'pending'
    
    const result = await workflow.executeActivity(processOrder)
    orderStatus = result.status // ← State updated
    
    return { orderId, orderStatus }
  }
}
```

**Loom:**
- Explicit state object in actors
- Persisted to journal + durable storage
- Can query state directly from storage
- Flexible state access patterns

```typescript
class OrderActor extends Actor {
  async execute(input: any) {
    // Explicit state management
    const currentStatus = this.state.status
    
    // Update state (triggers journal entry)
    this.updateState({ 
      status: 'processing',
      updatedAt: Date.now() 
    })
    
    // State persisted to Redis/Cosmos
    return this.state
  }
}

// Query state directly
const state = await stateStore.load('order-123')
```

**Winner:** Loom - more flexible state access and querying

---

### 5. Scalability

**Temporal:**
- **Horizontal scaling** via worker pools
- **Task routing** handled by Temporal Server
- **Event history** stored centrally (can grow large)
- **Best for:** 100k-1M+ concurrent workflows
- Requires managing Temporal Server cluster

**Loom:**
- **Actor pools** across multiple processes
- **Message queue** load balancing (BullMQ, etc.)
- **Distributed locks** prevent actor duplication
- **Best for:** 10k-100k concurrent actors
- Uses existing infrastructure (Redis, Cosmos)

**Winner:** Temporal - battle-tested at massive scale (Uber, Netflix)

---

### 6. Infrastructure Requirements

**Temporal:**

**Required:**
```yaml
# Temporal Server (cluster)
temporal-server:
  - Frontend service
  - History service
  - Matching service
  - Worker service
  
# Persistence
database:
  - PostgreSQL/MySQL (metadata)
  - Cassandra/ElasticSearch (history)
  
# Workers
temporal-workers:
  - Run your workflow/activity code
```

**Complexity:** High
- Must deploy and manage Temporal Server
- Database for metadata + search
- Visibility pipeline (ElasticSearch)
- Monitoring and operational overhead

**OR use Temporal Cloud** ($1000/month starting price)

**Loom:**

**Required:**
```yaml
# Just your application + storage backend
your-app:
  - ActorRuntime embedded in your service
  
# Storage (choose one)
storage:
  - Redis (most common)
  - Cosmos DB
  - PostgreSQL
  - InMemory (dev/test)
```

**Complexity:** Low
- No additional servers required
- Uses infrastructure you likely already have
- Lower operational overhead

**Winner:** Loom - much simpler infrastructure

---

### 7. Developer Experience

**Temporal:**

**Pros:**
- Rich SDKs (Go, Java, TypeScript, Python, PHP, .NET)
- Extensive documentation and tutorials
- Strong typing and IDE support
- Large community and ecosystem
- Web UI for debugging

**Cons:**
- Learning curve (workflows vs activities, determinism rules)
- Deterministic constraints can be confusing
- Requires understanding of event sourcing
- Debugging replay issues can be tricky

```typescript
// Must understand determinism rules
@workflow.defn
class MyWorkflow {
  @workflow.run
  async run() {
    // ❌ NOT ALLOWED - non-deterministic!
    const now = Date.now()
    
    // ✅ ALLOWED - deterministic
    const now = workflow.now()
    
    // ❌ NOT ALLOWED - direct API call
    await fetch('https://api.example.com')
    
    // ✅ ALLOWED - via activity
    await workflow.executeActivity(callAPI)
  }
}
```

**Loom:**

**Pros:**
- Actor model is intuitive (like classes)
- TypeScript-native with full type safety
- No determinism constraints in actor code
- Flexible - use any libraries/tools
- Simpler mental model

**Cons:**
- Smaller ecosystem (newer project)
- Less documentation and examples
- No web UI yet (Studio in development)
- Must handle infrastructure choices

```typescript
// Actor code - no special constraints
class MyActor extends Actor {
  async execute(input: any) {
    // ✅ Direct API calls allowed
    const result = await fetch('https://api.example.com')
    
    // ✅ Use Date.now() directly
    const now = Date.now()
    
    // ✅ Any library/tool works
    const data = await db.query('SELECT * FROM users')
    
    // State automatically persisted via journal
    this.updateState({ lastFetch: now })
  }
}
```

**Winner:** Depends on preference
- Temporal: More mature, better docs
- Loom: Simpler mental model, more flexible

---

### 8. Use Case Fit

**Temporal Excels At:**

✅ **Long-running workflows** (days, weeks, months, years)
```typescript
// Perfect for Temporal - yearly subscriptions
await workflow.sleep('365 days')
```

✅ **Complex orchestration** with many steps
```typescript
// Multi-stage approval workflows
await approvals.getManagerApproval()
await approvals.getDirectorApproval()
await approvals.getCFOApproval()
```

✅ **Human-in-the-loop** workflows
```typescript
// Wait for human input
await workflow.waitForSignal('managerApproved')
```

✅ **Enterprise-scale** (10M+ workflows)
- Battle-tested at Uber, Snap, Coinbase

**Loom Excels At:**

✅ **AI agent systems** with memory and decision-making
```typescript
class AIAgentActor extends Actor {
  async execute(input: any) {
    // Actor memory + decision traces
    const context = await this.memory.search(input.query)
    const decision = await this.decide(context)
    return decision
  }
}
```

✅ **Microservices** with actor isolation
```typescript
// Each user/order/session is an actor
class UserActor extends Actor {
  // Isolated state per user
}
```

✅ **Event-driven architectures**
```typescript
// Actors react to events via message queues
await queue.publish('order-created', { orderId: '123' })
```

✅ **Rapid development** without infrastructure overhead
- Start with in-memory, scale to Redis/Cosmos later

---

### 9. Observability

**Temporal:**
- **Web UI** with full workflow visibility
- **Event history** viewer (every step recorded)
- **Search and filter** workflows
- **Metrics** (Prometheus integration)
- **Distributed tracing** (OpenTelemetry)

**Loom:**
- **Journal inspection** via API/tooling
- **Reference-based tracing** (lightweight)
- **Pipeline state** queryable via REST API
- **Metrics** via custom integration
- **Studio** (web UI in development)

**Winner:** Temporal - mature observability stack

---

### 10. Cost Comparison

**Temporal:**

**Self-Hosted:**
- Infrastructure: $500-5000+/month (servers, DB, monitoring)
- Engineering: Ongoing cluster management
- Scaling: Add capacity as needed

**Temporal Cloud:**
- Starting: $1000/month (includes $200 credit)
- Production: $2000-10000+/month depending on usage
- Enterprise: Custom pricing

**Loom:**

**Self-Hosted Only:**
- Infrastructure: $50-500/month (Redis/Cosmos you likely already have)
- Engineering: Minimal (embedded in app)
- Scaling: Add app instances as needed

**Winner:** Loom - significantly lower infrastructure costs

---

## Architectural Differences

### Event Sourcing vs Journal-Based

**Temporal:**
```
┌─────────────────────────────────────────┐
│        Temporal Event History           │
├─────────────────────────────────────────┤
│ 1. WorkflowExecutionStarted             │
│ 2. ActivityTaskScheduled                │
│ 3. ActivityTaskStarted                  │
│ 4. ActivityTaskCompleted                │
│ 5. TimerStarted                         │
│ 6. TimerFired                           │
│ 7. WorkflowTaskScheduled                │
│ 8. WorkflowTaskCompleted                │
│ 9. WorkflowExecutionCompleted           │
└─────────────────────────────────────────┘
         ▲
         │ Replay entire history to
         │ reconstruct state
```

**Loom:**
```
┌─────────────────────────────────────────┐
│        Actor Journal (Per Actor)        │
├─────────────────────────────────────────┤
│ 1. InvocationEntry (execute called)     │
│ 2. DecisionEntry (business logic)       │
│ 3. StateChanged (state updated)         │
│ 4. EmitEntry (event emitted)            │
└─────────────────────────────────────────┘
         ▲
         │ Replay journal to reconstruct
         │ actor state + use snapshots
```

**Key Difference:**
- Temporal: Central server maintains ALL workflow history
- Loom: Each actor maintains its own journal in distributed storage

---

## Code Comparison: Order Processing

### Temporal Implementation

```typescript
// Workflow (deterministic orchestration)
@workflow.defn
export class OrderWorkflow {
  @workflow.run
  async processOrder(orderId: string): Promise<OrderResult> {
    // Reserve inventory
    const inventoryReserved = await workflow.executeActivity(
      reserveInventory,
      { orderId },
      { startToCloseTimeout: '30s', retryPolicy: {...} }
    )
    
    if (!inventoryReserved) {
      return { status: 'failed', reason: 'out of stock' }
    }
    
    // Charge payment
    const paymentResult = await workflow.executeActivity(
      chargePayment,
      { orderId },
      { startToCloseTimeout: '30s', retryPolicy: {...} }
    )
    
    if (!paymentResult.success) {
      // Compensate - release inventory
      await workflow.executeActivity(releaseInventory, { orderId })
      return { status: 'failed', reason: 'payment failed' }
    }
    
    // Ship order
    await workflow.executeActivity(
      shipOrder,
      { orderId },
      { startToCloseTimeout: '5m' }
    )
    
    // Wait 30 days for feedback
    await workflow.sleep('30 days')
    await workflow.executeActivity(requestFeedback, { orderId })
    
    return { status: 'completed' }
  }
}

// Activities (non-deterministic work)
async function reserveInventory(args: { orderId: string }) {
  // Call inventory service
  const response = await fetch('https://inventory.example.com/reserve', {...})
  return response.ok
}

async function chargePayment(args: { orderId: string }) {
  // Call payment service
  const response = await stripe.charge(...)
  return { success: response.status === 'succeeded' }
}
```

### Loom Implementation

```typescript
// Actor (stateful, handles all logic)
class OrderActor extends Actor {
  async execute(input: { action: string, orderId: string }) {
    const orderId = input.orderId
    const order = this.state.order as Order || { id: orderId, status: 'new' }
    
    switch (input.action) {
      case 'process':
        // Reserve inventory
        const inventoryReserved = await this.callService('inventory', 'reserve', { orderId })
        if (!inventoryReserved) {
          this.updateState({ order: { ...order, status: 'failed', reason: 'out of stock' } })
          return this.state.order
        }
        
        // Charge payment
        const paymentResult = await this.callService('payment', 'charge', { orderId })
        if (!paymentResult.success) {
          // Compensate
          await this.callService('inventory', 'release', { orderId })
          this.updateState({ order: { ...order, status: 'failed', reason: 'payment failed' } })
          return this.state.order
        }
        
        // Ship order
        await this.callService('shipping', 'ship', { orderId })
        this.updateState({ order: { ...order, status: 'shipped' } })
        
        // Schedule feedback request (30 days)
        await this.scheduleMessage({
          actorId: this.context.actorId,
          payload: { action: 'request-feedback', orderId },
          scheduleAt: Date.now() + 30 * 24 * 60 * 60 * 1000
        })
        break
        
      case 'request-feedback':
        await this.callService('feedback', 'request', { orderId })
        this.updateState({ order: { ...order, feedbackRequested: true } })
        break
    }
    
    return this.state.order
  }
  
  private async callService(service: string, method: string, args: any) {
    // Retry logic handled by infrastructure or custom implementation
    return await fetch(`https://${service}.example.com/${method}`, {
      method: 'POST',
      body: JSON.stringify(args)
    })
  }
}
```

**Key Differences:**
- Temporal: Separation of workflows and activities
- Loom: Everything in one actor class
- Temporal: Automatic retry/timeout on activities
- Loom: Explicit service call handling
- Temporal: `await workflow.sleep('30 days')` is trivial
- Loom: Schedule message for long delays

---

## When to Choose Temporal

Choose **Temporal** if you need:

1. ✅ **Long-running workflows** (months/years)
2. ✅ **Enterprise-scale** (millions of concurrent workflows)
3. ✅ **Mature ecosystem** and extensive documentation
4. ✅ **Web UI** and observability out of the box
5. ✅ **Multi-language** support (Go, Java, Python, etc.)
6. ✅ **Cloud hosting option** (Temporal Cloud)
7. ✅ **Battle-tested** infrastructure (Uber origins)
8. ✅ **Complex orchestration** with many steps/conditions
9. ✅ **Willing to manage** server infrastructure (or pay for cloud)

**Best use cases:**
- Order fulfillment with 30-day returns
- Subscription billing (yearly cycles)
- Customer onboarding journeys
- CI/CD pipelines
- Multi-stage approval workflows

---

## When to Choose Loom

Choose **Loom** if you need:

1. ✅ **AI agent systems** with memory and decision-making
2. ✅ **Actor-based architecture** (isolated state per entity)
3. ✅ **TypeScript-native** development
4. ✅ **Minimal infrastructure** (no separate servers)
5. ✅ **Flexible backend** (Redis, Cosmos, Postgres, in-memory)
6. ✅ **Lower cost** (no server cluster required)
7. ✅ **Rapid development** without operational overhead
8. ✅ **Microservices** with event-driven patterns
9. ✅ **Moderate scale** (10k-100k actors)

**Best use cases:**
- AI agents with long-term memory
- User session management
- IoT device actors
- Real-time collaboration systems
- Multi-tenant SaaS applications

---

## Hybrid Approach?

You can use **both** in the same system:

```
Temporal Workflows          Loom Actors
     (Orchestration)     (Stateful services)
          │                     │
          ▼                     ▼
    ┌──────────┐          ┌──────────┐
    │ Process  │          │   User   │
    │  Order   │──calls──▶│  Actor   │
    │ Workflow │          │ (State)  │
    └──────────┘          └──────────┘
          │
          ▼
    ┌──────────┐
    │ Payment  │
    │ Activity │
    └──────────┘
```

Example:
- **Temporal**: Manages 30-day order workflow
- **Loom**: Each user/order is an actor with state
- Temporal workflow calls Loom actors as activities

---

## Migration Path

### From Temporal to Loom
**Difficult** - fundamentally different patterns
- Rewrite workflows as actors
- Replace activities with actor methods
- Implement your own long-delay mechanisms

### From Loom to Temporal
**Moderate** - map concepts
- Actors → Workflows
- Actor methods → Activities
- Message passing → Signals/queries
- Long delays → Built-in timers

---

## Conclusion

**Temporal** and **Loom** solve overlapping problems with different philosophies:

**Temporal:**
- 🏢 Enterprise-focused
- 📊 Centralized orchestration
- ⚙️ Complex but powerful
- 💰 Higher cost
- 🎯 Best for: Long-running, complex workflows at scale

**Loom:**
- 🚀 Developer-focused
- 🎭 Distributed actors
- ⚡ Simple and flexible
- 💵 Lower cost
- 🎯 Best for: AI agents, microservices, rapid development

**If you're building:**
- **Subscription billing system** → Temporal
- **AI agent platform** → Loom
- **Order fulfillment** (with long delays) → Temporal
- **Real-time collaboration** → Loom
- **Multi-month customer journey** → Temporal
- **IoT device management** → Loom
- **CI/CD pipeline** → Temporal
- **Multi-tenant SaaS** → Loom

**Both are excellent choices** - pick based on your specific needs, scale, and infrastructure preferences!

---

## Further Reading

**Temporal:**
- Website: https://temporal.io/
- Docs: https://docs.temporal.io/
- GitHub: https://github.com/temporalio/temporal

**Loom:**
- GitHub: https://github.com/certo-ventures/loom
- Docs: [docs/architecture.md](./architecture.md)
- Examples: [examples/](../examples/)
