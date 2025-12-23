# Loom Studio - Live Testing Guide

## 🎯 Test Studio with REAL Actors!

No mocks! Run actual Loom actors and watch them LIVE in Studio.

## 🚀 Quick Start (3 Terminals)

### Terminal 1: Studio Server (Observability Backend)
```bash
cd packages/studio-server
npm install
npm run dev
```
**Port**: `9090` (WebSocket + HTTP API)  
**Status**: Wait for "✅ Server ready for actor connections!"

### Terminal 2: Studio UI (Frontend)
```bash
cd packages/studio  
npm run dev
```
**Port**: `3000` (or `3001` if 3000 is busy)  
**Status**: Wait for "ready in XXXms"

### Terminal 3: Live Demo (Real Actors)
```bash
# From loom root directory
npm run studio:demo
```
**Status**: Wait for "✅ Actors registered with Studio"

This runs **REAL actors** that:
- ✅ Process orders every 3 seconds
- ✅ Call activities (validate, payment, notification)
- ✅ Generate journal entries
- ✅ Send real-time updates to Studio

## 🎬 What You'll See

1. **Actors Tab**: 4 live actors (OrderProcessor x2, PaymentProcessor, Inventory)
2. **Network Tab**: Visual graph updating in real-time
3. **Timeline Tab**: Select an actor → see journal entries flowing
4. **Metrics Tab**: Live metrics updating every 2 seconds
5. **Overview**: Real-time activity stats

## 📊 Studio Server API

Actors report to the server via simple HTTP POST:

```typescript
// Register actor
POST /api/actor/register
{ id, type, status, createdAt, ... }

// Update actor state
POST /api/actor/update
{ id, status, messageCount, queueDepth, lastActiveAt }

// Add journal entry
POST /api/journal/:actorId
{ id, actorId, type, timestamp, data }

// Send metrics
POST /api/metrics
{ actorPools, messageQueues, locks, traces }

// Send trace event
POST /api/trace
{ correlationId, actorId, eventType, timestamp }
```

## 🔍 WebSocket Protocol

Studio UI connects to `ws://localhost:9090/ws` and receives:

```json
{
  "type": "actor:update",
  "data": { id, status, messageCount, ... }
}

{
  "type": "journal:entry", 
  "data": { actorId, entry }
}

{
  "type": "metrics:update",
  "data": { actorPools, messageQueues, ... }
}
```

## 🛠️ Customize the Demo

Edit `demos/studio-live-demo.ts`:

- **Add more actors**: Register new actor types
- **Change frequency**: Adjust `setInterval` timing
- **Different workflows**: Create new actor patterns
- **Simulate failures**: Throw errors to see failure handling

## 📝 Minimal Code, Maximum Function

**Studio Server**: ~150 lines  
**Live Demo**: ~200 lines  
**Result**: Full observability stack! 🎉

## 🎯 Use This For:

1. **Feature Development**: Test new Studio features with real data
2. **Performance Testing**: See how Studio handles high volumes
3. **Demos**: Show Loom's capabilities live
4. **Integration Testing**: Verify WebSocket protocol
5. **Time-Travel Debugging**: Test with real journal entries

## 🚀 Next: Integrate with Your Actors

To send data from YOUR actors to Studio:

```typescript
// In your actor runtime
async function reportActorUpdate(actor: Actor) {
  await fetch('http://localhost:9090/api/actor/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: actor.id,
      type: actor.type,
      status: actor.status,
      messageCount: actor.messageCount,
      queueDepth: actor.queueDepth,
      lastActiveAt: new Date().toISOString(),
    }),
  });
}
```

That's it! Studio will show your actors in real-time.

---

**Zero mocks. Zero fake data. Just REAL actors doing REAL work.** 🔥
