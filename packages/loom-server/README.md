# Loom Server

**Enterprise-grade actor execution platform powered by Loom Core.**

## Features

- 🚀 **Dynamic Actor Loading** - Deploy actors without restart
- 🔒 **Schema Validation** - JSON Schema + Ajv for inputs/outputs
- 🌐 **WASM First-Class** - Run actors in any language
- 🎯 **Event-Driven** - Redis Pub/Sub for actor lifecycle
- 📊 **Built-in Monitoring** - Integrated Loom Studio
- 🔐 **Production Ready** - Auth, rate limiting, circuit breakers

## Quick Start

```bash
# Install dependencies
npm install

# Start server
npm run dev

# Or run built binary
npm run build
npm start
```

## Architecture

```
packages/loom-server/
├── src/
│   ├── api/           # HTTP/WebSocket endpoints
│   ├── registry/      # Actor metadata & WASM storage
│   ├── execution/     # Actor execution engine
│   ├── resilience/    # Circuit breakers, health checks
│   ├── types/         # TypeScript types
│   └── server.ts      # Main entry point
```

## Configuration

```bash
# .env
PORT=8080
REDIS_URL=redis://localhost:6379
COSMOS_ENDPOINT=https://...
COSMOS_KEY=...
JWT_SECRET=your-secret
```

## API

### Register Actor
```bash
curl -X POST http://localhost:8080/api/registry/actors \
  -F 'metadata=@actor.json' \
  -F 'wasm=@actor.wasm'
```

### Execute Actor
```bash
curl -X POST http://localhost:8080/api/execute \
  -H "Content-Type: application/json" \
  -d '{
    "actorType": "payment-processor",
    "input": {
      "amount": 100,
      "currency": "USD"
    }
  }'
```

## Powered by Loom Core

Loom Server uses [@loom/core](../../src) as its foundation.
