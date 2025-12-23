# Loom Studio - Production Integration Guide

## The Problem (Before)

Studio was a beautiful but **empty** UI. It had no way to discover real actors because:

1. **No Auto-Discovery**: Actors had to manually POST to `/api/actor/register`
2. **Disconnected**: Studio Server had its own registry, separate from Loom Core
3. **Not Functional**: No real actors showed up in the interface

## The Solution (Now)

We've created a **Discovery Bridge** that connects Loom's `ActorRegistry` to Studio Server, enabling:

✅ **Auto-Discovery** - Automatically finds all registered actors  
✅ **Real-Time Updates** - Live monitoring via WebSocket  
✅ **Full Integration** - Uses Loom's existing discovery system  
✅ **Production Ready** - Proper lifecycle management & cleanup  

## Architecture

```
┌─────────────────────┐
│  Your Loom App      │
│  ┌──────────────┐   │
│  │ Discovery    │   │
│  │ Service      │   │
│  │ (Registry)   │   │
│  └───────┬──────┘   │
└──────────┼──────────┘
           │
           ├─ Actors register here
           │
           ▼
┌─────────────────────┐
│  Studio Server      │
│  ┌──────────────┐   │
│  │ Discovery    │   │
│  │ Bridge       │◄──┼── Polls registry every 1s
│  └───────┬──────┘   │
└──────────┼──────────┘
           │
           ├─ WebSocket broadcast
           │
           ▼
┌─────────────────────┐
│  Studio UI          │
│  (React)            │
│  - Actor List       │
│  - Network Graph    │
│  - Metrics          │
└─────────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
cd packages/studio-server
npm install
```

### 2. Start Studio Server

```bash
cd packages/studio-server
npm run dev
```

The server will start on `http://localhost:9090` and provide:
- REST API for queries
- WebSocket at `ws://localhost:9090/ws` for live updates

### 3. Start Studio UI

```bash
cd packages/studio
npm run dev
```

The UI will start on `http://localhost:5173`

### 4. Connect Your Loom App

**Option A: Use the integration helper (Recommended)**

```typescript
import { DiscoveryService } from '@loom/core';
import { getDiscoveryBridge } from '@loom/studio-server';

// In your application startup
const discovery = new DiscoveryService();

// Connect to Studio
getDiscoveryBridge().connect(discovery.registry);

console.log('🎨 Studio connected - actors will appear automatically!');
```

**Option B: Manual registration via HTTP**

If you can't integrate directly, actors can POST to:

```typescript
// Register an actor
await fetch('http://localhost:9090/api/actor/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: 'my-actor-1',
    type: 'CounterActor',
    status: 'idle',
    workerId: 'worker-1',
    messageCount: 0,
    queueDepth: 0,
    lastHeartbeat: new Date().toISOString(),
    uptime: 0,
  })
});

// Update actor status
await fetch('http://localhost:9090/api/actor/update', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: 'my-actor-1',
    status: 'active',
    messageCount: 5,
  })
});
```

## Complete Example

See `examples/studio-integration-demo.ts` for a full working example:

```bash
# Terminal 1: Start Studio Server
cd packages/studio-server && npm run dev

# Terminal 2: Start Studio UI  
cd packages/studio && npm run dev

# Terminal 3: Run the demo
npm run demo:studio-integration
```

This will:
1. Create a DiscoveryService with 3 actors
2. Simulate activity (heartbeats, status changes, messages)
3. Show live updates in Studio UI

## API Reference

### Studio Server Endpoints

#### GET `/api/actors`
Get all registered actors

```json
[
  {
    "id": "counter-1",
    "type": "CounterActor",
    "status": "active",
    "workerId": "worker-1",
    "messageCount": 42,
    "queueDepth": 2,
    "lastHeartbeat": "2025-12-13T03:33:58.077Z",
    "uptime": 15000,
    "metadata": { "initialValue": 0 }
  }
]
```

#### GET `/api/actors/type/:actorType`
Get all actors of a specific type

#### GET `/api/actors/:actorId`
Get a specific actor

#### GET `/api/metrics`
Get aggregated system metrics

```json
{
  "timestamp": "2025-12-13T03:33:58.077Z",
  "actorPools": {
    "totalActors": 3,
    "activeActors": 2,
    "idleActors": 1,
    "byType": {
      "CounterActor": 2,
      "AggregatorActor": 1
    }
  },
  "messageQueues": {
    "totalMessages": 157,
    "pendingMessages": 5
  }
}
```

#### GET `/api/health`
Health check endpoint

### WebSocket Events

#### `actor:update`
Broadcast when an actor is registered or updated

```json
{
  "type": "actor:update",
  "data": {
    "id": "counter-1",
    "type": "CounterActor",
    "status": "active"
  }
}
```

#### `actor:removed`
Broadcast when an actor is unregistered

```json
{
  "type": "actor:removed",
  "data": { "id": "counter-1" }
}
```

#### `metrics`
Periodic metrics broadcast (every 2 seconds)

## Production Considerations

### 1. Discovery Service Integration

In production, integrate with your existing ActorRuntime:

```typescript
import { ActorRuntime } from '@loom/core';
import { getDiscoveryBridge } from '@loom/studio-server';

class ProductionRuntime extends ActorRuntime {
  async initialize() {
    await super.initialize();
    
    // Connect Studio
    if (process.env.STUDIO_ENABLED === 'true') {
      getDiscoveryBridge().connect(this.discovery.registry);
      console.log('🎨 Studio monitoring enabled');
    }
  }
}
```

### 2. Security

**IMPORTANT**: Studio has no authentication! Only run in:
- Development environments
- Internal networks
- Behind a VPN/firewall

For production monitoring, consider:
- Add authentication middleware
- Use HTTPS/WSS
- Restrict CORS origins
- Rate limit API endpoints

```typescript
// Example: Add basic auth
app.use('/api/*', (req, res, next) => {
  const token = req.headers.authorization;
  if (token !== `Bearer ${process.env.STUDIO_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

### 3. Performance

The Discovery Bridge polls the registry every 1 second. For large deployments:

```typescript
const bridge = new DiscoveryBridge({
  pollInterval: 5000, // Poll every 5 seconds instead
  autoCleanup: true,
  maxAge: 600, // Clean up actors idle for 10 minutes
});
```

### 4. Persistence

Currently, Studio uses in-memory storage. For production:

- **Replace with Redis** for distributed deployments
- **Add database** for historical data
- **Implement journaling** for audit trails

### 5. Scaling

For multi-instance deployments:

```
Load Balancer
    │
    ├─ Studio Server 1 ──┐
    ├─ Studio Server 2 ──┼── Redis (shared state)
    └─ Studio Server 3 ──┘
           │
           ▼
    Loom App Cluster
```

## Next Steps

Now that Studio can discover actors, you can:

1. **Add More Observability**
   - Implement `/api/journal/:actorId` to show actor event history
   - Add distributed tracing with correlation IDs
   - Capture and display error logs

2. **Interactive Features**
   - Send messages to actors from UI
   - Trigger state snapshots
   - Kill/restart actors
   - Adjust actor configuration live

3. **Advanced Visualizations**
   - Message flow animation
   - Performance heatmaps
   - Dependency graphs
   - Query builder for actors

4. **Production Features**
   - Authentication & authorization
   - Multi-workspace support
   - Alerts & notifications
   - Time-travel debugging with snapshots

## Troubleshooting

### "No actors showing up"

1. Check Studio Server is running: `curl http://localhost:9090/api/health`
2. Verify actors are registered: `curl http://localhost:9090/api/actors`
3. Check your app called `getDiscoveryBridge().connect(registry)`
4. Look for "Discovered actor" messages in Studio Server logs

### "WebSocket not connecting"

1. Check browser console for errors
2. Verify WebSocket endpoint: `ws://localhost:9090/ws`
3. Check for CORS issues
4. Try refreshing the page

### "Stale actors not cleaning up"

Adjust cleanup settings:

```typescript
const bridge = new DiscoveryBridge({
  autoCleanup: true,
  maxAge: 60, // Remove actors idle for 1 minute
});
```

## Summary

**Before**: Studio was a pretty but useless UI with no data  
**After**: Studio is a functional monitoring tool with real-time actor discovery

**Key Components**:
1. **DiscoveryBridge** - Connects Loom Core to Studio Server
2. **Enhanced ActorRegistry** - Added `getAll()` method for polling
3. **Integration Examples** - Clear path to connect your app

**Result**: A production-ready observability platform for Loom! 🎉
