# Finalize Phase Plan - v0.3.1

**Status**: In Progress  
**Started**: January 1, 2026  
**Target**: v0.3.1 Release

## Overview

This document outlines the Finalize Phase - completing remaining work before full Production Hardening. The goal is to make v0.3.0 production-ready for early integrators while identifying areas that need hardening.

## Phase Objectives

1. **Production Readiness**: Ensure all adapters have clear production/testing boundaries
2. **Documentation**: Comprehensive guides for integrators
3. **Testing**: End-to-end validation with real infrastructure
4. **Performance**: Baseline benchmarks
5. **Deployment**: Multi-region patterns and guides

---

## Task 1: Mock vs Production Implementation Audit

### Current State Analysis

**In-Memory Implementations (Testing/Development Only)**:
- ✅ **Storage**:
  - `InMemoryStateStore` - Simple state storage for tests
  - `InMemoryMessageQueue` - Basic queue for single-instance dev
  - `InMemoryLockManager` - Non-distributed locking
  - `InMemoryJournalStore` - Event journal for testing
  - `InMemoryIdempotencyStore` - Idempotency tracking
  - `InMemoryCoordinationAdapter` - Single-instance coordination
  - `InMemoryBlobStore` - Simple blob storage
  - `InMemoryActivityStore` - Activity tracking
  - `InMemoryCosmos` - Document store mock
  - `InMemoryBlobStorage` - Key-value store

- ✅ **Configuration**:
  - `InMemoryConfigResolver` - Config caching layer
  - `InMemorySecretsStore` / `InMemorySecretsClient` - Secret storage

- ✅ **Discovery**:
  - `InMemoryActorRegistry` - Single-instance actor registry

- ✅ **Workflow**:
  - `InMemoryWorkflowStore` - Workflow state storage
  - `InMemoryWorkflowExecutor` - Simple workflow execution

- ✅ **Observability**:
  - `InMemoryMetricsCollector` - Metrics collection
  - `InMemoryTelemetryStore` - Telemetry storage

- ✅ **Memory**:
  - `InMemoryGraphStorage` - Graph memory storage

**Mock Implementations (Already Guarded)**:
- ✅ **TLSNotary**:
  - `MockTLSNotaryVerifier` - **Already has production guards**
  - `production.ts` - Blocks mock in production mode
  - Environment variable: `TLSNOTARY_ALLOW_MOCK=false` in production

**Production Implementations (Ready)**:
- ✅ **Storage**:
  - `CosmosStateStore`, `CosmosActivityStore` - Azure Cosmos DB
  - `BullMQMessageQueue` - Redis-backed queue
  - `RedisLockManager` - Distributed locking via Redis
  - `RedisJournalStore` - Event journal in Redis
  - `RedisIdempotencyStore` - Idempotency in Redis
  - `RedisCoordinationAdapter` - Distributed coordination
  - `AzureBlobStore` - Azure Blob Storage

- ✅ **Configuration**:
  - `CosmosConfigResolver` - Cosmos DB config storage

- ✅ **Secrets**:
  - `AzureKeyVault` - Azure Key Vault integration
  - `CosmosSecretsStore` - Cosmos DB secrets

- ✅ **Discovery**:
  - `RedisActorRegistry` - Distributed actor registry via Redis
  - `CosmosActorRegistry` - Actor registry in Cosmos DB

- ✅ **Memory**:
  - `CosmosGraphStorage` - Cosmos DB graph storage
  - `RedisGraphStorage` - Redis graph storage

- ✅ **Tracing**:
  - `CosmosTraceStore` - Distributed trace storage

### Action Items

#### 1.1: Add Production Mode Guards
**Goal**: Prevent accidental use of in-memory adapters in production

```typescript
// Add to all in-memory implementations
constructor() {
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      `⚠️  [${this.constructor.name}] Using in-memory adapter in production. ` +
      'This is not recommended for distributed systems. ' +
      'Use Redis/Cosmos adapters instead.'
    )
  }
}
```

**Files to update**:
- `src/storage/in-memory-*.ts` (11 files)
- `src/config-resolver/in-memory-resolver.ts`
- `src/secrets/in-memory-secrets*.ts` (2 files)
- `src/discovery/index.ts` (`InMemoryActorRegistry`)
- `src/workflow/index.ts` (`InMemoryWorkflowStore`, `InMemoryWorkflowExecutor`)
- `src/memory/graph/in-memory-storage.ts`
- `src/observability/collector.ts` (`InMemoryMetricsCollector`)

**Estimated Effort**: 2 hours

#### 1.2: Document Production-Ready Adapters
**Goal**: Clear matrix of testing vs production adapters

Create `docs/PRODUCTION_READINESS.md`:

| Component | Testing | Development | Production |
|-----------|---------|-------------|------------|
| Message Queue | InMemory | InMemory | BullMQ+Redis |
| State Store | InMemory | InMemory | Cosmos |
| Lock Manager | InMemory | InMemory | Redis |
| Journal Store | InMemory | InMemory | Redis |
| Blob Storage | InMemory | InMemory | Azure Blob |
| Actor Registry | InMemory | InMemory | Redis/Cosmos |
| Config Store | InMemory | Layered | Cosmos |
| Secrets | InMemory | InMemory | Key Vault |
| Memory Graph | InMemory | InMemory | Cosmos/Redis |
| TLS Notary | Mock | Mock (allowMock:true) | WASM only |

**Estimated Effort**: 1 hour

#### 1.3: Adapter Factory Validation
**Goal**: Warn when mixing in-memory and production adapters

Add to `src/storage/adapter-factory.ts`:
```typescript
export function validateProductionConfig(config: AdapterFactoryConfig): void {
  const isProduction = process.env.NODE_ENV === 'production'
  const inMemoryUsed = []
  
  if (config.queue?.type === 'inmemory') inMemoryUsed.push('queue')
  if (config.state?.type === 'inmemory') inMemoryUsed.push('state')
  // ... check all adapters
  
  if (isProduction && inMemoryUsed.length > 0) {
    console.error(
      `⚠️  [Loom] Production mode with in-memory adapters: ${inMemoryUsed.join(', ')}\n` +
      '   This configuration is NOT suitable for distributed production systems.\n' +
      '   Please configure Redis/Cosmos adapters for reliability.'
    )
  }
}
```

**Estimated Effort**: 1 hour

---

## Task 2: Comprehensive Integration Tests

### Current State
- ✅ Section 5 integration tests exist (`src/tests/integration/section5-integration.test.ts`)
- ✅ WASM integration tests exist
- ❌ Missing: Real Redis + Cosmos end-to-end tests
- ❌ Missing: Multi-actor coordination tests
- ❌ Missing: Pipeline resume/recovery tests

### Action Items

#### 2.1: Redis + Cosmos Integration Test Suite
**Goal**: Validate real infrastructure integration

Create `src/tests/integration/production-adapters.test.ts`:
```typescript
describe('Production Adapters Integration', () => {
  describe('Redis Adapters', () => {
    // Test BullMQ + RedisLockManager + RedisJournalStore together
  })
  
  describe('Cosmos Adapters', () => {
    // Test CosmosStateStore + CosmosTraceStore + CosmosSecretsStore
  })
  
  describe('Hybrid Configuration', () => {
    // BullMQ + Cosmos state + Redis locks
  })
})
```

**Estimated Effort**: 6 hours

#### 2.2: Actor Lifecycle Integration Tests
**Goal**: Test full actor lifecycle with production adapters

Create `src/tests/integration/actor-lifecycle.test.ts`:
- Actor registration → discovery → execution → recovery
- State persistence across restarts
- Message queue processing with retries

**Estimated Effort**: 4 hours

#### 2.3: Pipeline Resume Tests
**Goal**: Verify pipelines can resume after failures

Create `src/tests/integration/pipeline-resume.test.ts`:
- Stop pipeline mid-execution
- Restart with same state
- Verify compensation/retry logic

**Estimated Effort**: 3 hours

---

## Task 3: Operational Runbooks

### Required Documentation

#### 3.1: Deployment Guide
**File**: `docs/DEPLOYMENT_GUIDE.md`

Contents:
- Azure resources checklist (Cosmos DB, Redis, Key Vault, Blob Storage)
- Environment variable reference
- Docker/Kubernetes configuration
- Health check endpoints
- Scaling considerations

**Estimated Effort**: 3 hours

#### 3.2: Configuration Guide
**File**: `docs/CONFIGURATION_GUIDE.md`

Contents:
- Adapter configuration patterns
- Layered config (env vars → files → Cosmos)
- Secrets management best practices
- Actor config loading strategies

**Estimated Effort**: 2 hours

#### 3.3: Troubleshooting Guide
**File**: `docs/TROUBLESHOOTING.md`

Contents:
- Common errors and solutions
- Debug logging patterns
- Performance issues
- Network/connectivity problems

**Estimated Effort**: 2 hours

#### 3.4: Operations Runbook
**File**: `docs/OPERATIONS_RUNBOOK.md`

Contents:
- Startup procedures
- Graceful shutdown
- Database migrations
- Monitoring and alerting
- Disaster recovery

**Estimated Effort**: 3 hours

---

## Task 4: Performance Benchmarking

### Baseline Metrics Needed

#### 4.1: Throughput Benchmarks
**Goal**: Establish performance baselines

Create `scripts/benchmark-throughput.ts`:
- Messages/second (BullMQ)
- Actors created/second
- State reads/writes per second
- Pipeline execution time

**Estimated Effort**: 4 hours

#### 4.2: Latency Benchmarks
**Goal**: Measure p50/p95/p99 latencies

Create `scripts/benchmark-latency.ts`:
- Actor invocation latency
- State store latency (Cosmos vs Redis)
- Memory graph query latency
- Trace query latency

**Estimated Effort**: 3 hours

#### 4.3: Resource Usage
**Goal**: Memory and connection limits

Create `scripts/benchmark-resources.ts`:
- Memory usage per actor
- Redis connection pooling
- Cosmos RU consumption
- Concurrent actor limits

**Estimated Effort**: 3 hours

---

## Task 5: Multi-Region Deployment Patterns

### Requirements

#### 5.1: Active-Active Pattern
**File**: `docs/MULTI_REGION_ACTIVE_ACTIVE.md`

Contents:
- Cosmos DB multi-region write
- Redis cluster configuration
- Actor routing strategies
- Data consistency model

**Estimated Effort**: 4 hours

#### 5.2: Active-Passive Pattern
**File**: `docs/MULTI_REGION_ACTIVE_PASSIVE.md`

Contents:
- Failover procedures
- Data replication
- Health monitoring
- Traffic routing

**Estimated Effort**: 3 hours

#### 5.3: Regional Isolation Pattern
**File**: `docs/MULTI_REGION_ISOLATED.md`

Contents:
- Separate Cosmos containers per region
- Cross-region actor invocation
- Latency considerations

**Estimated Effort**: 2 hours

---

## Timeline & Priorities

### Week 1 (High Priority)
- ✅ Task 1.1: Production mode guards (2h)
- ✅ Task 1.2: Production readiness matrix (1h)
- ✅ Task 1.3: Adapter validation (1h)
- ⬜ Task 3.1: Deployment guide (3h)
- ⬜ Task 3.2: Configuration guide (2h)

**Total**: 9 hours

### Week 2 (Medium Priority)
- ⬜ Task 2.1: Redis + Cosmos integration tests (6h)
- ⬜ Task 2.2: Actor lifecycle tests (4h)
- ⬜ Task 3.3: Troubleshooting guide (2h)
- ⬜ Task 3.4: Operations runbook (3h)

**Total**: 15 hours

### Week 3 (Lower Priority)
- ⬜ Task 2.3: Pipeline resume tests (3h)
- ⬜ Task 4.1: Throughput benchmarks (4h)
- ⬜ Task 4.2: Latency benchmarks (3h)
- ⬜ Task 4.3: Resource usage (3h)

**Total**: 13 hours

### Week 4 (Nice to Have)
- ⬜ Task 5.1: Active-active pattern (4h)
- ⬜ Task 5.2: Active-passive pattern (3h)
- ⬜ Task 5.3: Regional isolation (2h)

**Total**: 9 hours

**Grand Total**: 46 hours (~6 days)

---

## Success Criteria

### Release Blockers (v0.3.1)
- ✅ All in-memory adapters have production warnings
- ✅ Production readiness matrix documented
- ✅ Deployment guide complete
- ✅ At least one comprehensive integration test with Redis + Cosmos

### Post-Release (v0.3.2+)
- ⬜ Full integration test suite passing
- ⬜ Performance benchmarks established
- ⬜ All operational runbooks complete
- ⬜ Multi-region patterns documented

---

## Next Phase

After completing Finalize Phase → **Production Hardening** (Section 7):
1. Circuit breakers for external services
2. Enhanced error recovery
3. Advanced observability (correlation IDs, dashboards)
4. Security hardening (encryption, rate limiting)
5. Deployment automation (Helm, Terraform)
