# Service Discovery - Find Your Actors! 🔍

**~250 lines of routing POWER!**

## What We Built

A complete service discovery system for actor-based applications!

### Features

1. **Actor Registry** (~80 lines)
   - Register/unregister actors
   - Get actors by ID or type
   - Heartbeat tracking
   - Status management (idle/active/busy)
   - Message count tracking
   - Automatic cleanup of stale actors

2. **Smart Routing** (~120 lines)
   - Route to specific actor by ID
   - Route to ANY of type with load balancing
   - Three strategies:
     - **Least-messages**: Pick least loaded
     - **Random**: Distribute randomly
     - **Round-robin**: Sequential distribution
   - Skip busy actors when alternatives available
   - Broadcast to all actors of a type

3. **Discovery Service** (~50 lines)
   - Simple API combining registry + router
   - One-liner actor registration
   - Flexible routing (ID or type-based)
   - Automatic heartbeat updates

## Architecture

```
DiscoveryService
  ├─ ActorRegistry (storage)
  │   ├─ In-memory implementation
  │   └─ Redis/CosmosDB (easy to add)
  └─ ActorRouter (routing logic)
      ├─ Load balancing strategies
      └─ Availability checking
```

## Usage Examples

### 1. Basic Registration & Routing

```typescript
const discovery = new DiscoveryService()

// Register actors
await discovery.registerActor('order-1', 'OrderProcessor', 'worker-1', {
  region: 'us-west',
  capacity: 100,
})

await discovery.registerActor('order-2', 'OrderProcessor', 'worker-2', {
  region: 'us-east',
  capacity: 150,
})

// Route to specific actor
const queue = await discovery.route('order-1')
// Returns: 'actor:order-1'

// Route to any OrderProcessor (load balanced)
const queue = await discovery.route({
  type: 'OrderProcessor',
  strategy: 'least-messages',
})
// Returns: 'actor:order-2' (if it has fewer messages)
```

### 2. Load Balancing Strategies

```typescript
// Least-messages: Pick the actor with fewest messages
const queue1 = await discovery.route({
  type: 'OrderProcessor',
  strategy: 'least-messages',
})

// Random: Randomly distribute load
const queue2 = await discovery.route({
  type: 'OrderProcessor',
  strategy: 'random',
})

// Round-robin: Sequential distribution
const queue3 = await discovery.route({
  type: 'OrderProcessor',
  strategy: 'round-robin',
})
```

### 3. Broadcasting

```typescript
// Send message to ALL actors of a type
const queues = await discovery.broadcast('Notifier')
// Returns: ['actor:notifier-1', 'actor:notifier-2', 'actor:notifier-3']

// Then enqueue to all
for (const queue of queues) {
  await messageQueue.enqueue(queue, message)
}
```

### 4. Heartbeat & Status Management

```typescript
// Update heartbeat (keeps actor alive)
await discovery.registry.heartbeat('order-1')

// Update status
await discovery.registry.updateStatus('order-1', 'busy')

// Router will skip busy actors if alternatives exist
const queue = await discovery.route({
  type: 'OrderProcessor',
  strategy: 'least-messages',
})
// Won't return order-1 if other OrderProcessors are available
```

### 5. Cleanup Stale Actors

```typescript
// Clean up actors that haven't heartbeated in 5 minutes
const cleaned = await discovery.cleanup(300) // seconds
console.log(`Cleaned ${cleaned} stale actors`)
```

## Integration with Worker

```typescript
class ActorWorker {
  constructor(
    private workerId: string,
    private discovery: DiscoveryService,
    private messageQueue: MessageQueue
  ) {}

  async activate(actorId: string, actorType: string): Promise<void> {
    // Register when actor is activated
    await this.discovery.registerActor(
      actorId,
      actorType,
      this.workerId,
      { activatedAt: new Date().toISOString() }
    )

    // Update status
    await this.discovery.registry.updateStatus(actorId, 'active')
  }

  async processMessage(message: Message): Promise<void> {
    // Mark busy during processing
    await this.discovery.registry.updateStatus(message.actorId, 'busy')
    
    try {
      // Process message...
      await this.discovery.registry.incrementMessageCount(message.actorId)
    } finally {
      // Back to idle
      await this.discovery.registry.updateStatus(message.actorId, 'idle')
      await this.discovery.registry.heartbeat(message.actorId)
    }
  }

  async startHeartbeat(actorId: string): Promise<void> {
    setInterval(async () => {
      await this.discovery.registry.heartbeat(actorId)
    }, 30000) // Every 30 seconds
  }
}
```

## Testing

**20 comprehensive tests** covering:

### Registry Tests (7)
1. ✅ Register and retrieve actors
2. ✅ Unregister actors
3. ✅ Get actors by type
4. ✅ Update heartbeat timestamps
5. ✅ Update status (idle/active/busy)
6. ✅ Increment message count
7. ✅ Cleanup stale registrations

### Router Tests (8)
8. ✅ Route to specific actor by ID
9. ✅ Return undefined for unknown actor
10. ✅ Route with least-messages strategy
11. ✅ Route with random strategy
12. ✅ Skip busy actors when alternatives exist
13. ✅ Return undefined if no actors of type
14. ✅ Get all actors for broadcast
15. ✅ Check actor availability

### Discovery Service Tests (5)
16. ✅ Register actors with metadata
17. ✅ Route by actor ID
18. ✅ Route by type with strategy
19. ✅ Broadcast to all of type
20. ✅ Cleanup stale actors

**ALL TESTS PASS!**

## Demo Output

```
🔍 Service Discovery Demo

📝 Registering actors...
✅ Registered 4 actors

⚖️  Load balancing with least-messages strategy...
  Request 1: actor:order-3
  Request 2: actor:order-3
  Request 3: actor:order-2
  Request 4: actor:order-3
  Request 5: actor:order-2

📊 Current load across OrderProcessors:
  order-1: 4 messages
  order-2: 4 messages
  order-3: 3 messages

🚦 Marking order-2 as busy...
  Routing 3 requests (should skip busy actor):
    Request 1: actor:order-3
    Request 2: actor:order-3
    Request 3: actor:order-1

✅ Checking availability:
  order-2 available: false
  order-3 available: true
  payment-1 available: true
```

## Key Files

- `src/discovery/index.ts` - Registry + router (~250 lines)
- `examples/discovery-demo.ts` - Complete demo (~130 lines)
- `src/tests/discovery/discovery.test.ts` - Tests (~280 lines)

## Why This Matters

1. **Horizontal Scaling** - Route work across multiple actor instances
2. **Load Balancing** - Distribute load intelligently
3. **High Availability** - Skip failed actors, cleanup stale ones
4. **Type-based Routing** - Send to any actor of a type
5. **Broadcasting** - Send to all actors simultaneously
6. **MINIMAL** - Only ~250 lines for complete discovery!

## Use Cases

- **Microservices**: Route to any available service instance
- **Worker Pools**: Distribute tasks across workers
- **Event Broadcasting**: Notify all subscribers
- **Failover**: Automatic detection of dead actors
- **Monitoring**: Track load across actor instances

**This is what MINIMAL distributed systems look like!** 🚀
