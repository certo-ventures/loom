# Operational Runbooks

Comprehensive operational guides for deploying, monitoring, and maintaining Loom in production environments.

## Table of Contents

1. [Deployment Runbooks](#deployment-runbooks)
2. [Incident Response](#incident-response)
3. [Maintenance Procedures](#maintenance-procedures)
4. [Monitoring & Alerts](#monitoring--alerts)
5. [Troubleshooting Guide](#troubleshooting-guide)

---

## Deployment Runbooks

### 1.1 Initial Production Deployment

**Prerequisites:**
- Azure subscription with Cosmos DB and Redis Cache
- Container registry (ACR, Docker Hub, or GitHub Packages)
- Kubernetes cluster or Azure Container Instances
- Environment variables configured

**Checklist:**

```bash
# 1. Build the package
npm run build

# 2. Run production tests
SKIP_INTEGRATION=false npm test

# 3. Build container (if using Docker)
docker build -t loom:latest .

# 4. Configure environment
export NODE_ENV=production
export COSMOS_ENDPOINT=https://your-cosmos.documents.azure.com:443/
export COSMOS_KEY=your-cosmos-key
export REDIS_HOST=your-redis.redis.cache.windows.net
export REDIS_PASSWORD=your-redis-password

# 5. Verify production readiness
npm run validate:production  # (if script exists)

# 6. Deploy
# (Deploy to your platform: K8s, ACI, App Service, etc.)
```

**Production Adapter Configuration:**

```typescript
import { 
  CosmosStateStore, 
  BullMQMessageQueue, 
  RedisLockManager 
} from '@certo-ventures/loom'
import { CosmosClient } from '@azure/cosmos'
import Redis from 'ioredis'

// Cosmos DB State Store
const cosmosClient = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT!,
  key: process.env.COSMOS_KEY!,
})

const stateStore = new CosmosStateStore(
  cosmosClient,
  'loom-production',
  'actor-state'
)
await stateStore.initialize()

// Redis for Message Queue
const redis = new Redis({
  host: process.env.REDIS_HOST!,
  port: 6380,
  password: process.env.REDIS_PASSWORD!,
  tls: { servername: process.env.REDIS_HOST },
  maxRetriesPerRequest: null,
})

const messageQueue = new BullMQMessageQueue(redis, {
  prefix: 'loom-prod',
})

// Redis Lock Manager
const lockManager = new RedisLockManager(redis)
```

**Validation Steps:**

1. ✅ No in-memory adapters in production (warnings will appear if present)
2. ✅ WASM verifier loaded (not mock TLSNotary)
3. ✅ Health check responds: `GET /health`
4. ✅ Metrics endpoint accessible (if configured)
5. ✅ All required environment variables set

---

### 1.2 Rolling Update Procedure

**Zero-Downtime Deployment Strategy:**

```bash
# 1. Build new version
npm version patch  # or minor/major
npm run build
docker build -t loom:v0.3.1 .

# 2. Push to registry
docker push your-registry/loom:v0.3.1

# 3. Update deployment (Kubernetes example)
kubectl set image deployment/loom loom=your-registry/loom:v0.3.1

# 4. Monitor rollout
kubectl rollout status deployment/loom

# 5. Verify health
kubectl exec -it deployment/loom -- curl localhost:3000/health
```

**Pre-deployment Checklist:**
- [ ] Database migrations applied (if any)
- [ ] Backward-compatible changes only
- [ ] Integration tests passing
- [ ] Staging environment validated
- [ ] Rollback plan prepared

**Post-deployment Validation:**
- [ ] Health checks passing
- [ ] No spike in error rates
- [ ] Circuit breakers closed
- [ ] Message queue processing normally
- [ ] Cosmos DB RU usage stable

---

### 1.3 Rollback Procedure

**When to Rollback:**
- Health check failures > 3 consecutive
- Error rate > 5% for 5 minutes
- Circuit breakers opening repeatedly
- Critical feature failure
- Data corruption detected

**Immediate Rollback (Kubernetes):**

```bash
# Option 1: Rollback to previous version
kubectl rollout undo deployment/loom

# Option 2: Roll back to specific revision
kubectl rollout history deployment/loom
kubectl rollout undo deployment/loom --to-revision=3

# Verify rollback
kubectl rollout status deployment/loom
```

**Post-Rollback Actions:**
1. Document the issue in incident log
2. Review application logs: `kubectl logs -l app=loom --tail=200`
3. Check dead letter queues for failed messages
4. Verify data integrity
5. Schedule post-mortem meeting

---

### 1.4 Scaling Operations

**Horizontal Scaling:**

```bash
# Scale up (add replicas)
kubectl scale deployment/loom --replicas=5

# Scale down
kubectl scale deployment/loom --replicas=2

# Auto-scaling (HPA)
kubectl autoscale deployment/loom \
  --min=2 --max=10 \
  --cpu-percent=70 \
  --memory-percent=80
```

**Scaling Considerations:**

| Component | Scaling Strategy | Notes |
|-----------|------------------|-------|
| **Message Queue** | Horizontal (workers) | BullMQ supports multiple workers |
| **State Store** | Vertical (Cosmos RUs) | Increase RU/s for Cosmos containers |
| **Lock Manager** | N/A | Redis handles distributed locks |
| **Actor Registry** | Horizontal | Redis/Cosmos support multiple readers |

**Performance Indicators for Scaling:**

- **Scale Up Triggers:**
  - CPU > 70% for 5 minutes
  - Memory > 80% for 5 minutes
  - Message queue backlog > 1000 messages
  - Request latency p95 > 2 seconds

- **Scale Down Triggers:**
  - CPU < 30% for 15 minutes
  - Memory < 40% for 15 minutes
  - Message queue empty for 10 minutes

---

## Incident Response

### 2.1 Service Degradation Playbook

**Symptoms:**
- Increased latency (p95 > 3s)
- Higher error rates (>2%)
- Circuit breakers opening

**Investigation Steps:**

```bash
# 1. Check health endpoint
curl https://your-loom-service/health

# 2. Check Redis connectivity
redis-cli -h your-redis.redis.cache.windows.net \
  -p 6380 -a your-password --tls ping

# 3. Check Cosmos DB metrics (Azure Portal)
# - Request Units (RU/s) throttling?
# - Query performance?

# 4. Review application logs
kubectl logs -l app=loom --since=10m | grep ERROR

# 5. Check circuit breaker states
# (Implement GET /metrics/circuit-breakers endpoint)
```

**Common Root Causes & Remediation:**

| Issue | Detection | Fix |
|-------|-----------|-----|
| **Cosmos RU Throttling** | `429` status codes in logs | Increase Cosmos RU/s provisioning |
| **Redis Connection Pool Exhausted** | `ECONNREFUSED` errors | Increase `maxRetriesPerRequest`, add more Redis nodes |
| **Memory Leak** | Gradual memory increase | Restart pods, investigate with heap dump |
| **Downstream Service Failure** | Circuit breakers open | Wait for recovery, check external dependencies |
| **Message Queue Backlog** | Growing queue size | Scale workers, check for poison messages |

---

### 2.2 Data Recovery Procedures

**Scenario 1: Actor State Corruption**

```typescript
// 1. Identify corrupted actor
const actorId = 'actor-123'

// 2. Load state from Cosmos DB backup (point-in-time restore)
// Use Azure Portal to restore Cosmos container to previous point

// 3. Replay events from journal store
import { RedisJournalStore } from '@certo-ventures/loom'

const journalStore = new RedisJournalStore(redis)
const entries = await journalStore.readEntries(actorId)

// 4. Reconstruct state from journal
let state = { /* initial state */ }
for (const entry of entries) {
  state = applyEvent(state, entry)
}

// 5. Save corrected state
await stateStore.save(actorId, state)
```

**Scenario 2: Lost Messages (Dead Letter Queue Recovery)**

```typescript
// 1. List dead letter messages
import { PipelineOrchestrator } from '@certo-ventures/loom/pipelines'

const dlqMessages = await orchestrator.listDeadLetterMessages(
  'actor-EmailSender:dlq',
  100
)

// 2. Review failures
dlqMessages.forEach(msg => {
  console.log(`Failed at: ${msg.timestamp}`)
  console.log(`Reason: ${msg.error}`)
  console.log(`Attempts: ${msg.retryAttempt}`)
})

// 3. Fix root cause (e.g., update config, fix bug)

// 4. Reprocess messages manually
for (const msg of dlqMessages) {
  // Re-enqueue with fixed configuration
  await messageQueue.enqueue(msg.originalQueue, msg.message)
}
```

**Scenario 3: Journal Replay for Audit**

```bash
# Get all events for an actor
node scripts/replay-journal.js actor-123

# Expected output:
# Event 1: StateChanged at 2026-01-01T10:00:00Z
# Event 2: MessageReceived at 2026-01-01T10:01:23Z
# Event 3: StateChanged at 2026-01-01T10:02:45Z
```

---

### 2.3 Circuit Breaker Recovery

**Circuit Breaker States:**

```
CLOSED → OPEN → HALF-OPEN → CLOSED
         ↓
    (failures)
```

**Manual Recovery Steps:**

```typescript
import { ResilienceManager } from '@certo-ventures/loom/workflow'

const resilience = new ResilienceManager()
const breaker = resilience.getCircuitBreaker('cosmos-write')

// Check state
console.log(breaker.getState()) // 'open', 'closed', or 'half-open'

// Force reset (use with caution)
breaker.reset()

// Monitor for automatic recovery
// Circuit breaker will transition to half-open after timeout
```

**Circuit Breaker Configuration:**

```typescript
const breaker = resilience.getCircuitBreaker('external-api', {
  failureThreshold: 5,      // Open after 5 failures
  successThreshold: 2,       // Close after 2 successes in half-open
  timeout: 60000,           // 60s timeout before half-open
})
```

---

## Maintenance Procedures

### 3.1 Backup Procedures

**Cosmos DB Automated Backup:**
- Automatic backups every 4 hours (default)
- Retention: 30 days
- Point-in-time restore available

**Redis Persistence (if configured):**

```bash
# Enable RDB persistence on Azure Redis Cache
# Azure Portal → Redis Cache → Settings → Data persistence
# Schedule: Every 6 hours
# Storage Account: your-backup-storage
```

**Manual Backup Script:**

```bash
#!/bin/bash
# backup-loom-data.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups/$DATE"
mkdir -p "$BACKUP_DIR"

# 1. Export Cosmos data (using Azure CLI)
az cosmosdb sql container export \
  --account-name your-cosmos \
  --database-name loom-production \
  --container-name actor-state \
  --output-path "$BACKUP_DIR/actor-state.json"

# 2. Redis backup (create RDB snapshot)
redis-cli -h your-redis.redis.cache.windows.net \
  -p 6380 -a "$REDIS_PASSWORD" --tls \
  BGSAVE

# 3. Upload to blob storage
az storage blob upload-batch \
  --account-name your-backup-storage \
  --destination loom-backups \
  --source "$BACKUP_DIR"

echo "Backup completed: $DATE"
```

---

### 3.2 Database Maintenance

**Cosmos DB Index Optimization:**

```typescript
// Review and optimize indexing policy
const containerDef = {
  id: 'actor-state',
  partitionKey: '/partitionKey',
  indexingPolicy: {
    indexingMode: 'consistent',
    automatic: true,
    includedPaths: [
      { path: '/actorId/?' },
      { path: '/actorType/?' },
      { path: '/status/?' },
      { path: '/updatedAt/?' },
    ],
    excludedPaths: [
      { path: '/data/*' },  // Large nested objects
    ],
  },
}
```

**Redis Maintenance:**

```bash
# Check memory usage
redis-cli INFO memory

# Remove expired keys (automatic, but can force)
redis-cli --scan --pattern "loom:*" | xargs redis-cli DEL

# Analyze slow queries
redis-cli SLOWLOG GET 10

# Defragmentation (if needed)
redis-cli MEMORY PURGE
```

**Cleanup Old Data:**

```typescript
// Clean up old traces (older than 90 days)
import { CosmosTraceStore } from '@certo-ventures/loom/tracing'

const traceStore = new CosmosTraceStore(config)
const cleaned = await traceStore.cleanup(90 * 24 * 60 * 60 * 1000)
console.log(`Cleaned ${cleaned} old traces`)

// Clean up old journal entries (after snapshot)
import { RedisJournalStore } from '@certo-ventures/loom'

const journalStore = new RedisJournalStore(redis)
const snapshot = await journalStore.getLatestSnapshot('actor-123')

if (snapshot) {
  await journalStore.trimEntries('actor-123', snapshot.sequence)
}
```

---

### 3.3 Certificate Rotation

**Azure Key Vault Certificate Rotation:**

```bash
# 1. Upload new certificate to Key Vault
az keyvault certificate import \
  --vault-name your-keyvault \
  --name tls-cert \
  --file new-cert.pfx \
  --password cert-password

# 2. Update application configuration
# (Loom automatically picks up new certificate via Key Vault integration)

# 3. Verify rotation
curl https://your-loom-service/health --cacert new-ca.crt
```

**TLS Configuration:**

```typescript
import { AzureKeyVaultSecretsClient } from '@certo-ventures/loom/secrets'

const secretsClient = new AzureKeyVaultSecretsClient({
  vaultUrl: process.env.KEY_VAULT_URL!,
})

// Certificates auto-rotate when updated in Key Vault
const cert = await secretsClient.getSecret('tls-cert')
```

---

### 3.4 Dependency Updates

**Update Strategy:**

```bash
# 1. Update dependencies in staging environment first
npm update

# 2. Run full test suite
npm test

# 3. Build and test integration
npm run build
SKIP_INTEGRATION=false npm test

# 4. Deploy to staging
# (Deploy and monitor for 24 hours)

# 5. Deploy to production (rolling update)
kubectl set image deployment/loom loom=loom:v0.3.2
```

**Critical Dependencies to Monitor:**

- `@azure/cosmos` - Cosmos DB SDK
- `ioredis` - Redis client
- `bullmq` - Message queue
- `@azure/keyvault-secrets` - Secrets management

**Security Updates:**

```bash
# Check for security vulnerabilities
npm audit

# Fix automatically (if possible)
npm audit fix

# Manual review for breaking changes
npm audit fix --force
```

---

## Monitoring & Alerts

### 4.1 Health Check Monitoring

**Endpoint:** `GET /health`

**Expected Response:**

```json
{
  "status": "healthy",
  "timestamp": "2026-01-01T12:00:00Z",
  "checks": {
    "redis": "healthy",
    "cosmos": "healthy",
    "tlsnotary": "healthy"
  },
  "uptime": 86400
}
```

**Monitoring Setup (Prometheus):**

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'loom'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['loom-service:3000']
    scrape_interval: 15s
```

---

### 4.2 Key Metrics to Monitor

| Metric | Threshold | Alert Level | Action |
|--------|-----------|-------------|--------|
| **Error Rate** | > 2% | Warning | Investigate logs |
| **Error Rate** | > 5% | Critical | Page on-call |
| **Latency (p95)** | > 2s | Warning | Check dependencies |
| **Latency (p95)** | > 5s | Critical | Immediate action |
| **Circuit Breaker Open** | Any | Warning | Check downstream |
| **Dead Letter Queue Size** | > 100 | Warning | Review failures |
| **Memory Usage** | > 80% | Warning | Scale up |
| **Memory Usage** | > 90% | Critical | Emergency scale |
| **CPU Usage** | > 70% | Warning | Scale horizontally |

---

### 4.3 Alert Configuration

**Azure Monitor Alerts:**

```bash
# Create alert for high error rate
az monitor metrics alert create \
  --name loom-high-error-rate \
  --resource-group your-rg \
  --scopes /subscriptions/.../loom-service \
  --condition "avg Percentage CPU > 80" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --action email admin@example.com
```

**PagerDuty Integration:**

```typescript
// Send critical alerts to PagerDuty
import { sendAlert } from './monitoring/pagerduty'

if (errorRate > 0.05) {
  await sendAlert({
    severity: 'critical',
    summary: 'Loom error rate exceeded 5%',
    source: 'loom-production',
    details: { errorRate, timestamp: new Date() },
  })
}
```

---

## Troubleshooting Guide

### 5.1 Common Issues

#### Issue: "Mock verifier in production" Warning

**Symptom:**
```
⚠️  [TLSNotary] Using in-memory adapter in production
```

**Cause:** WASM module not built or not loaded

**Fix:**
```bash
npm run build:tlsn
# Verify: ls -la build/tlsn/
```

---

#### Issue: Redis Connection Timeout

**Symptom:**
```
Error: connect ETIMEDOUT
```

**Diagnosis:**
```bash
# Check Redis reachability
nc -zv your-redis.redis.cache.windows.net 6380

# Test authentication
redis-cli -h your-redis.redis.cache.windows.net \
  -p 6380 -a "$REDIS_PASSWORD" --tls ping
```

**Fix:**
- Verify firewall rules allow connection
- Check Redis access key is correct
- Ensure TLS is configured properly

---

#### Issue: Cosmos DB 429 (Rate Limited)

**Symptom:**
```
RequestRateTooLarge: Request rate is large
```

**Diagnosis:**
```typescript
// Check Cosmos metrics in Azure Portal
// Metrics → Normalized RU Consumption
```

**Fix:**
```bash
# Increase provisioned throughput
az cosmosdb sql container throughput update \
  --account-name your-cosmos \
  --database-name loom-production \
  --name actor-state \
  --throughput 1000  # Increase from 400
```

---

#### Issue: Circuit Breaker Stuck Open

**Symptom:**
```
Error: Circuit breaker [cosmos-write] is OPEN
```

**Diagnosis:**
```typescript
const breaker = resilience.getCircuitBreaker('cosmos-write')
console.log(breaker.getState())  // 'open'
```

**Fix:**
1. Verify downstream service is healthy
2. Wait for automatic recovery (60s default)
3. Manual reset if needed: `breaker.reset()`

---

#### Issue: Message Queue Backlog Growing

**Symptom:** Queue size increasing, not processing

**Diagnosis:**
```typescript
const queueSize = await messageQueue.size('actor:EmailSender')
console.log(`Queue size: ${queueSize}`)
```

**Fix:**
```bash
# Scale up workers
kubectl scale deployment/loom --replicas=10

# Check for poison messages in DLQ
# Review dead letter queue for repeated failures
```

---

### 5.2 Debug Mode

**Enable Verbose Logging:**

```bash
export DEBUG=loom:*
export LOG_LEVEL=debug
npm start
```

**Inspect Actor State:**

```typescript
import { CosmosStateStore } from '@certo-ventures/loom'

const state = await stateStore.load('actor-123')
console.log(JSON.stringify(state, null, 2))
```

**Trace Pipeline Execution:**

```typescript
import { PipelineOrchestrator } from '@certo-ventures/loom/pipelines'

// Pipeline tracer automatically logs execution steps
// Check logs for:
// - Stage execution times
// - Retry attempts
// - Circuit breaker checks
```

---

### 5.3 Performance Profiling

**Node.js CPU Profile:**

```bash
node --prof src/index.js
# Generates isolate-*.log

# Process profile
node --prof-process isolate-*.log > profile.txt
```

**Memory Heap Snapshot:**

```bash
node --inspect src/index.js

# In Chrome DevTools:
# 1. Navigate to chrome://inspect
# 2. Click "Open dedicated DevTools for Node"
# 3. Go to Memory tab → Take heap snapshot
```

---

## Emergency Contacts

| Role | Contact | Escalation |
|------|---------|------------|
| On-Call Engineer | Slack: #loom-oncall | Primary |
| Platform Lead | email@example.com | After 15 min |
| CTO | exec@example.com | Critical only |

**Incident Response Time SLAs:**
- **Critical (P0):** 15 minutes
- **High (P1):** 1 hour
- **Medium (P2):** 4 hours
- **Low (P3):** Next business day

---

## Appendix

### A. Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | development | Runtime environment |
| `COSMOS_ENDPOINT` | Yes | - | Cosmos DB endpoint URL |
| `COSMOS_KEY` | Yes | - | Cosmos DB master key |
| `REDIS_HOST` | Yes | - | Redis hostname |
| `REDIS_PORT` | No | 6380 | Redis port |
| `REDIS_PASSWORD` | Yes | - | Redis access key |
| `KEY_VAULT_URL` | No | - | Azure Key Vault URL |
| `LOG_LEVEL` | No | info | Logging verbosity |

### B. Useful Commands

```bash
# Check Loom version
npm list @certo-ventures/loom

# Validate configuration
node scripts/validate-config.js

# Export metrics
curl http://localhost:3000/metrics > metrics.txt

# Test circuit breaker
curl http://localhost:3000/test/circuit-breaker

# Force garbage collection
kill -USR2 $(pgrep -f "node.*loom")
```

---

**Document Version:** 1.0.0  
**Last Updated:** January 1, 2026  
**Owner:** Platform Engineering Team  
**Review Frequency:** Quarterly
