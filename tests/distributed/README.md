# Distributed Multi-Node Testing

Tests LoomDB real-time synchronization across multiple distributed nodes using Docker Compose.

## Architecture

```
┌─────────────────┐
│   GUN Relay     │ ← Central peer discovery
│   Port: 8765    │
└────────┬────────┘
         │
    ┌────┴────┬────────┐
    │         │        │
┌───▼───┐ ┌───▼───┐ ┌──▼────┐
│Node 1 │ │Node 2 │ │Node 3 │
│:3001  │ │:3002  │ │:3003  │
└───────┘ └───────┘ └───────┘
    │         │        │
    └────┬────┴────┬───┘
         │         │
    ┌────▼─────────▼───┐
    │ Test Orchestrator│
    └──────────────────┘
```

## Prerequisites

- Docker & Docker Compose installed
- Node.js 20+ (for local development)

## Quick Start

### 1. Start the Distributed Cluster

```bash
# Start all 3 nodes + relay
docker-compose up -d

# Check node health
docker-compose ps
```

### 2. Run Distributed Tests

```bash
# Run all tests
docker-compose run --rm test-orchestrator

# Or run specific test scenarios
docker-compose run --rm test-orchestrator npm run test:distributed
```

### 3. Monitor Nodes

```bash
# View logs from all nodes
docker-compose logs -f

# View specific node
docker-compose logs -f loom-node-1

# Check node health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
```

### 4. Manual Testing

```bash
# Create node on Node 1
curl -X POST http://localhost:3001/nodes \
  -H "Content-Type: application/json" \
  -d '{"id":"test-1","type":"agent","properties":{"name":"Test Agent"}}'

# Query from Node 2 (should see it after ~1-2 seconds)
curl http://localhost:3002/nodes

# Check stats
curl http://localhost:3001/stats
curl http://localhost:3002/stats
curl http://localhost:3003/stats
```

### 5. Cleanup

```bash
# Stop all containers
docker-compose down

# Remove volumes
docker-compose down -v
```

## Test Scenarios

### Test 1: Basic Synchronization
- **Goal**: Verify nodes sync simple operations
- **Steps**: Node 1 creates, all nodes should receive
- **Pass Criteria**: All 3 nodes see the new node within 2 seconds

### Test 2: Concurrent Updates
- **Goal**: Test multiple nodes creating simultaneously
- **Steps**: All 3 nodes create different nodes at same time
- **Pass Criteria**: All nodes eventually see all 3 creations

### Test 3: Cross-Node Edges
- **Goal**: Verify edges sync between nodes created on different nodes
- **Steps**: Node 1 creates 2 nodes, Node 2 creates edge, Node 3 queries
- **Pass Criteria**: Edge visible on all nodes

### Test 4: High Volume
- **Goal**: Stress test with many operations
- **Steps**: Create 50 nodes distributed across 3 nodes
- **Pass Criteria**: All nodes see all 50 nodes, no data loss

### Test 5: Sync Latency
- **Goal**: Measure end-to-end sync latency
- **Steps**: Create nodes and measure time until visible on other nodes
- **Metrics**: p50, p95, p99 latency

## Node API Reference

Each node exposes a REST API:

### Health Check
```
GET /health
Response: { nodeId, healthy, sync: {...}, stats: {...} }
```

### Create Node
```
POST /nodes
Body: { id?, type, properties }
Response: { success, node }
```

### Create Edge
```
POST /edges
Body: { id?, from, to, type, properties? }
Response: { success, edge }
```

### Query Nodes
```
GET /nodes?type=agent
Response: { success, count, nodes }
```

### Query Edges
```
GET /edges?type=collaborates_with&from=node-1
Response: { success, count, edges }
```

### Get Change History
```
GET /history
Response: { success, count, history }
```

### Get Stats
```
GET /stats
Response: { nodeId, stats, syncStatus }
```

## Network Partition Testing

### Simulate Network Partition

```bash
# Disconnect Node 2 from network
docker network disconnect loom-network loom-node-2

# Continue creating data on Node 1
curl -X POST http://localhost:3001/nodes -H "Content-Type: application/json" \
  -d '{"id":"partition-test","type":"event","properties":{"test":"partition"}}'

# Reconnect Node 2
docker network connect loom-network loom-node-2

# Node 2 should receive updates after reconnection
sleep 3
curl http://localhost:3002/nodes
```

### Chaos Testing

```bash
# Kill random node
docker-compose kill loom-node-2

# Restart it
docker-compose up -d loom-node-2

# Verify it syncs after restart
```

## Performance Benchmarks

Expected performance metrics:

- **Sync Latency (p50)**: < 500ms
- **Sync Latency (p95)**: < 1000ms
- **Sync Latency (p99)**: < 2000ms
- **Throughput**: 50+ ops/sec across 3 nodes
- **Data Loss**: 0% (all operations eventually consistent)

## Troubleshooting

### Nodes not syncing

```bash
# Check GUN relay is healthy
curl http://localhost:8765/health

# Check node connectivity
docker-compose logs gun-relay
docker-compose logs loom-node-1

# Verify peer configuration
docker-compose exec loom-node-1 env | grep GUN_PEERS
```

### Slow sync

```bash
# Check change history isn't too large
curl http://localhost:3001/history | jq '.count'

# Clear history
curl -X POST http://localhost:3001/history/clear
```

### Port conflicts

```bash
# Change ports in docker-compose.yml
# Default ports: 8765 (relay), 3001-3003 (nodes)
```

## Advanced Usage

### Custom Test Script

Create `tests/distributed/custom-test.ts`:

```typescript
import axios from 'axios'

async function myTest() {
  // Your test logic
  const node1 = 'http://localhost:3001'
  await axios.post(`${node1}/nodes`, { ... })
}

myTest()
```

Run it:
```bash
docker-compose run --rm test-orchestrator npx tsx tests/distributed/custom-test.ts
```

### Monitoring with Prometheus

Add to `docker-compose.yml`:

```yaml
prometheus:
  image: prom/prometheus
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml
  ports:
    - "9090:9090"
```

## Files

- `docker-compose.yml` - Multi-node cluster configuration
- `docker/relay.js` - GUN relay server
- `node-runner.ts` - Distributed node runner
- `tests/distributed/orchestrator.ts` - Test orchestrator
- `tests/distributed/README.md` - This file
