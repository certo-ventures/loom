# Quick Start: Accessing Loom Pipeline State APIs

Complete guide to starting the Loom API Service and accessing pipeline state, journal, and circuit breaker endpoints.

---

## 🚀 Starting the Service

### Option 1: Standalone Service (Recommended for Production)

```bash
# 1. Navigate to API service
cd packages/loom-api-service

# 2. Configure environment
cp .env.example .env
# Edit .env with your settings (Redis URL, JWT secret, etc.)

# 3. Ensure Redis is running
redis-server
# OR use Docker: docker run -d -p 6379:6379 redis

# 4. Start the service
npm run dev     # Development mode (auto-reload)
# OR
npm start       # Production mode

# Service will be available at:
# - REST API: http://localhost:8000
# - Metrics:  http://localhost:9090/metrics
# - Health:   http://localhost:8000/api/v1/health
```

### Option 2: Docker Compose (Includes Redis + Prometheus + Grafana)

```bash
cd packages/loom-api-service

# Start all services
npm run docker:up

# Services available:
# - API:        http://localhost:8000
# - Redis:      localhost:6379
# - Prometheus: http://localhost:9090
# - Grafana:    http://localhost:3001

# Stop all services
npm run docker:down
```

### Option 3: Quick Demo

```bash
cd packages/loom-api-service

# Run pre-configured demo
npm run quick-demo
# This starts the server and runs example API calls
```

---

## 🔑 Authentication (Optional)

If authentication is enabled in your `.env`:

```typescript
// Login to get JWT token
const response = await fetch('http://localhost:8000/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'admin',
    password: 'your-password',
    tenantId: 'default'
  })
})

const { token } = await response.json()

// Use token in subsequent requests
headers: {
  'Authorization': `Bearer ${token}`,
  'X-Tenant-ID': 'default'
}
```

---

## 📊 Accessing Pipeline State APIs

### 1. List Running Pipelines

```bash
curl http://localhost:8000/api/v1/workflows/pipelines/running?limit=50
```

```typescript
// Response
{
  "pipelines": [
    {
      "pipelineId": "pipeline-abc123",
      "status": "running",
      "activeStages": ["extract", "transform"],
      "stageOrder": ["extract", "transform", "load"],
      "createdAt": "2026-01-12T10:30:00.000Z",
      "startedAt": "2026-01-12T10:30:01.000Z"
    }
  ],
  "total": 5
}
```

### 2. Get Pipeline State

```bash
curl http://localhost:8000/api/v1/workflows/pipelines/pipeline-abc123/state
```

```typescript
// Response
{
  "pipelineId": "pipeline-abc123",
  "status": "running",
  "definition": { /* pipeline definition */ },
  "activeStages": ["transform"],
  "stageOrder": ["extract", "transform", "load"],
  "createdAt": "2026-01-12T10:30:00.000Z",
  "startedAt": "2026-01-12T10:30:01.000Z",
  "completedAt": null,
  "metadata": { "userId": "user-123" }
}
```

### 3. Get Pipeline Progress

```bash
curl http://localhost:8000/api/v1/workflows/pipelines/pipeline-abc123/progress
```

```typescript
// Response
{
  "pipelineId": "pipeline-abc123",
  "status": "running",
  "overallProgress": 66,
  "completedStages": 2,
  "totalStages": 3,
  "stages": [
    {
      "name": "extract",
      "status": "completed",
      "progress": 100,
      "completedTasks": 10,
      "expectedTasks": 10
    },
    {
      "name": "transform",
      "status": "running",
      "progress": 60,
      "completedTasks": 6,
      "expectedTasks": 10
    },
    {
      "name": "load",
      "status": "pending",
      "progress": 0
    }
  ],
  "runtime": 45000  // milliseconds
}
```

### 4. Get Stage Details

```bash
curl http://localhost:8000/api/v1/workflows/pipelines/pipeline-abc123/stages/transform
```

```typescript
// Response
{
  "stageName": "transform",
  "status": "running",
  "attempt": 0,
  "startedAt": "2026-01-12T10:30:15.000Z",
  "completedAt": null,
  "expectedTasks": 10,
  "completedTasks": 6,
  "error": null,
  "pendingApprovalId": null
}
```

### 5. Get Stage Outputs

```bash
curl http://localhost:8000/api/v1/workflows/pipelines/pipeline-abc123/stages/extract/outputs?attempt=0
```

```typescript
// Response
{
  "outputs": [
    { "id": 1, "data": "..." },
    { "id": 2, "data": "..." },
    { "id": 3, "data": "..." }
  ],
  "count": 10
}
```

### 6. Get Stage Tasks (Scatter/Broadcast Patterns)

```bash
curl http://localhost:8000/api/v1/workflows/pipelines/pipeline-abc123/stages/transform/tasks
```

```typescript
// Response
{
  "tasks": [
    {
      "taskIndex": 0,
      "status": "completed",
      "actor": "transformer",
      "retries": 0
    },
    {
      "taskIndex": 1,
      "status": "running",
      "actor": "transformer",
      "retries": 1,
      "lastError": "Timeout error"
    }
  ]
}
```

---

## 📖 Accessing Actor Journal APIs

### 7. Get Actor Journal Entries

```bash
curl http://localhost:8000/api/v1/workflows/actors/calculator-123/journal?limit=10
```

```typescript
// Response
{
  "actorId": "calculator-123",
  "entries": [
    {
      "streamId": "1736680200000-0",
      "entry": {
        "sequence": 1,
        "type": "invocation",
        "timestamp": 1736680200000,
        "method": "calculate",
        "args": [5, 10]
      }
    },
    {
      "streamId": "1736680201000-0",
      "entry": {
        "sequence": 2,
        "type": "decision",
        "timestamp": 1736680201000,
        "decision": "add",
        "context": {}
      }
    }
  ],
  "count": 10
}
```

### 8. Get Journal Statistics

```bash
curl http://localhost:8000/api/v1/workflows/actors/calculator-123/journal/stats
```

```typescript
// Response
{
  "actorId": "calculator-123",
  "entryCount": 127,
  "firstEntry": ["1736680100000-0", [...]],
  "lastEntry": ["1736680500000-0", [...]]
}
```

### 9. Get Actor Snapshots

```bash
curl http://localhost:8000/api/v1/workflows/actors/calculator-123/snapshots?limit=5
```

```typescript
// Response
{
  "snapshots": [
    {
      "sequence": 100,
      "timestamp": 1736680400000,
      "state": {
        "counter": 42,
        "lastOperation": "multiply"
      }
    }
  ]
}
```

---

## 🔧 Circuit Breaker Management APIs

### 10. List Circuit Breakers

```bash
curl http://localhost:8000/api/v1/workflows/circuit-breakers
```

```typescript
// Response
{
  "circuitBreakers": [
    {
      "key": "external-api:fetchData",
      "state": "open",
      "failures": 5,
      "lastFailureAt": "2026-01-12T10:45:00.000Z",
      "lastSuccessAt": "2026-01-12T10:30:00.000Z"
    },
    {
      "key": "database:query",
      "state": "closed",
      "failures": 0,
      "lastSuccessAt": "2026-01-12T10:50:00.000Z"
    }
  ]
}
```

### 11. Reset Circuit Breaker

```bash
curl -X POST http://localhost:8000/api/v1/workflows/circuit-breakers/external-api:fetchData/reset
```

```typescript
// Response
{
  "message": "Circuit breaker reset",
  "key": "external-api:fetchData"
}
```

---

## 💻 Using the Client Library

See [examples/loom-api-client-example.ts](../examples/loom-api-client-example.ts) for a complete TypeScript client:

```typescript
import { LoomAPIClient } from '../examples/loom-api-client-example'

// Initialize client
const client = new LoomAPIClient('http://localhost:8000')

// Optional: Authenticate
await client.login('admin', 'password')

// Query pipelines
const running = await client.listRunningPipelines()
console.log(`${running.total} pipelines running`)

// Get progress
const progress = await client.getPipelineProgress('pipeline-abc123')
console.log(`Progress: ${progress.overallProgress}%`)

// Get journal
const journal = await client.getActorJournal('calculator-123', 50)
console.log(`${journal.count} journal entries`)

// List circuit breakers
const breakers = await client.listCircuitBreakers()
for (const breaker of breakers.circuitBreakers) {
  if (breaker.state === 'open') {
    await client.resetCircuitBreaker(breaker.key)
  }
}
```

---

## 🔄 Integration Patterns

### Real-Time Monitoring Dashboard

```typescript
// Poll every 5 seconds for updates
setInterval(async () => {
  const running = await client.listRunningPipelines()
  
  for (const pipeline of running.pipelines) {
    const progress = await client.getPipelineProgress(pipeline.pipelineId)
    updateUI(pipeline.pipelineId, progress)
  }
}, 5000)
```

### Webhook Notifications

```typescript
// Check for completed pipelines and trigger webhooks
const running = await client.listRunningPipelines()

for (const pipeline of running.pipelines) {
  const state = await client.getPipelineState(pipeline.pipelineId)
  
  if (state.status === 'completed' && state.metadata?.webhookUrl) {
    await axios.post(state.metadata.webhookUrl, {
      pipelineId: pipeline.pipelineId,
      status: 'completed'
    })
  }
}
```

### Automated Recovery

```typescript
// Auto-reset circuit breakers after cooldown period
const breakers = await client.listCircuitBreakers()

for (const breaker of breakers.circuitBreakers) {
  if (breaker.state === 'open' && shouldReset(breaker)) {
    await client.resetCircuitBreaker(breaker.key)
  }
}
```

---

## 📚 Additional Resources

- **Full API Documentation**: See [PHASE7_ROADMAP.md](../../PHASE7_ROADMAP.md) for complete API surface
- **Examples**: [examples/access-pipeline-state.ts](../access-pipeline-state.ts) - Programmatic access
- **Client Library**: [examples/loom-api-client-example.ts](../loom-api-client-example.ts) - Ready-to-use client
- **Configuration**: [.env.example](../../packages/loom-api-service/.env.example) - All config options
- **Implementation**: [packages/loom-api-service/](../../packages/loom-api-service/) - Source code

---

## ⚡ Quick Reference

| Endpoint | Description |
|----------|-------------|
| `GET /workflows/pipelines/running` | List running pipelines |
| `GET /workflows/pipelines/:id/state` | Full pipeline state |
| `GET /workflows/pipelines/:id/progress` | Progress summary |
| `GET /workflows/pipelines/:id/stages/:name` | Stage details |
| `GET /workflows/pipelines/:id/stages/:name/outputs` | Stage outputs |
| `GET /workflows/pipelines/:id/stages/:name/tasks` | Parallel tasks |
| `GET /workflows/actors/:id/journal` | Actor journal |
| `GET /workflows/actors/:id/journal/stats` | Journal stats |
| `GET /workflows/actors/:id/snapshots` | Actor snapshots |
| `GET /workflows/circuit-breakers` | Circuit breaker list |
| `POST /workflows/circuit-breakers/:key/reset` | Reset breaker |

---

**Need Help?**
- Check service health: `curl http://localhost:8000/api/v1/health`
- View metrics: `curl http://localhost:9090/metrics`
- Run demo: `npm run quick-demo` in `packages/loom-api-service`
