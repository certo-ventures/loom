# Loom Studio - Event-Driven Monitoring

## Architecture

**Event-Driven with Redis Pub/Sub - NO POLLING!**

```
Actors → DiscoveryService → Redis Pub/Sub → Studio Server → WebSocket → Studio UI
```

## Quick Start

```bash
# Terminal 1: Start Studio Server
cd packages/studio-server && npm run dev

# Terminal 2: Start Studio UI
cd packages/studio && npm run dev

# Terminal 3: Run demo with actors
npm run demo:studio-integration
```

Open `http://localhost:5173` to see live actor monitoring.

## Integration

```typescript
import { DiscoveryService, ActorEventBus } from '@loom/core';
import { Redis } from 'ioredis';

const redis = new Redis();
const eventBus = new ActorEventBus(redis);
const discovery = new DiscoveryService(undefined, eventBus);

// All actor lifecycle events are automatically published!
await discovery.registerActor('my-actor', 'MyType', 'worker-1');
```

Studio Server subscribes to the Redis channel and updates UI in real-time.

## Lifecycle Events

- `actor:registered` - New actor created
- `actor:unregistered` - Actor removed  
- `actor:message-processed` - Message handled
- `actor:status-changed` - Status updated
- `actor:heartbeat` - Keep-alive ping

ANY system can subscribe to these events, not just Studio!

## Benefits

✅ **Event-driven** - No polling waste  
✅ **Scalable** - Redis Pub/Sub handles millions of events  
✅ **Extensible** - Any system can subscribe to actor lifecycle  
✅ **Real-time** - Instant updates via WebSocket  
✅ **Minimal** - ~100 lines of code
