# Production Readiness Guide

**Version**: 0.3.0  
**Last Updated**: January 1, 2026

## Overview

Loom provides both in-memory (testing/development) and production-ready adapters for all infrastructure components. This guide helps you choose the right adapters for your environment.

---

## Adapter Readiness Matrix

| Component | Testing | Development | Staging | Production | Notes |
|-----------|---------|-------------|---------|------------|-------|
| **Message Queue** | InMemory | InMemory | BullMQ+Redis | BullMQ+Redis | Requires Redis 6+ |
| **State Store** | InMemory | InMemory | Cosmos | Cosmos | Partition by actorId |
| **Lock Manager** | InMemory | InMemory | Redis | Redis | Distributed locks with Redlock |
| **Journal Store** | InMemory | InMemory | Redis | Redis | Event sourcing support |
| **Idempotency Store** | InMemory | InMemory | Redis/Cosmos | Redis/Cosmos | Redis for speed, Cosmos for durability |
| **Coordination** | InMemory | InMemory | Redis | Redis | Actor-to-instance mapping |
| **Blob Storage** | InMemory | InMemory | Azure Blob | Azure Blob | For WASM modules, large payloads |
| **Activity Store** | InMemory | InMemory | Cosmos | Cosmos | Activity definitions |
| **Actor Registry** | InMemory | InMemory | Redis/Cosmos | Redis/Cosmos | Redis for speed, Cosmos for durability |
| **Config Store** | InMemory | Layered | Layered | Layered | In-memory cache + Cosmos persistence |
| **Secrets** | InMemory | InMemory | Key Vault | Key Vault | Azure Key Vault or Cosmos (encrypted) |
| **Memory Graph** | InMemory | InMemory | Cosmos/Redis | Cosmos/Redis | Cosmos for persistence, Redis for speed |
| **Trace Store** | InMemory | InMemory | Cosmos | Cosmos | Distributed tracing storage |
| **TLS Notary** | Mock | Mock (with flag) | WASM | WASM | `allowMock=false` in production |
| **Workflow Store** | InMemory | InMemory | Cosmos | Cosmos | Workflow definitions |
| **Workflow Executor** | InMemory | Actors | Actors | Actors | Use distributed actor-based execution |
| **Metrics** | InMemory | InMemory | Persistent | Persistent | Redis, Cosmos, or observability platform |

---

## Environment Configuration Examples

### Testing Environment

```typescript
import { AdapterFactory } from '@certo-ventures/loom/storage'

const adapters = new AdapterFactory({
  queue: { type: 'inmemory' },
  state: { type: 'inmemory' },
  coordination: { type: 'inmemory' },
  blob: { type: 'inmemory' },
  journal: { type: 'inmemory' }
})
```

**Characteristics**:
- ✅ Fast test execution
- ✅ No external dependencies
- ✅ Simple setup
- ⚠️ Data lost on restart
- ⚠️ Not suitable for distributed systems

---

### Development Environment

```typescript
const adapters = new AdapterFactory({
  queue: { 
    type: 'inmemory' // Or use local Redis if testing distributed behavior
  },
  state: { 
    type: 'inmemory' // Or use Cosmos DB Emulator
  },
  coordination: { type: 'inmemory' },
  blob: { type: 'inmemory' },
  journal: { type: 'inmemory' }
})
```

**Characteristics**:
- ✅ Quick iteration
- ✅ Optional: Use emulators for Cosmos/Redis
- ⚠️ Data lost on restart
- ⚠️ Single-instance only

---

### Staging Environment

```typescript
import { BullMQMessageQueue } from '@certo-ventures/loom/storage'
import { CosmosStateStore } from '@certo-ventures/loom/storage'
import { RedisLockManager } from '@certo-ventures/loom/storage'
import { AzureBlobStore } from '@certo-ventures/loom/storage'

const adapters = {
  queue: new BullMQMessageQueue({
    connection: {
      host: process.env.REDIS_HOST,
      port: 6379,
      password: process.env.REDIS_PASSWORD
    }
  }),
  
  state: new CosmosStateStore({
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY,
    databaseId: 'loom-staging',
    containerId: 'actor-state'
  }),
  
  lockManager: new RedisLockManager({
    host: process.env.REDIS_HOST,
    password: process.env.REDIS_PASSWORD
  }),
  
  blob: new AzureBlobStore({
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    containerName: 'loom-staging'
  })
}
```

**Characteristics**:
- ✅ Production-like infrastructure
- ✅ Distributed system testing
- ✅ Data persistence
- ✅ Cost-optimized (lower tier SKUs)

---

### Production Environment

```typescript
import { createProductionConfig } from '@certo-ventures/loom'

const config = createProductionConfig({
  // Redis (required for distributed locking, coordination, queues)
  redis: {
    host: process.env.REDIS_HOST,
    port: 6379,
    password: process.env.REDIS_PASSWORD,
    tls: true,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true
  },
  
  // Cosmos DB (required for state, traces, config)
  cosmos: {
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY,
    databaseId: 'loom-prod',
    defaultConsistencyLevel: 'Session'
  },
  
  // Azure Storage (required for WASM modules, large payloads)
  storage: {
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    containerName: 'loom-prod'
  },
  
  // Azure Key Vault (required for secrets)
  keyVault: {
    vaultUrl: process.env.KEYVAULT_URL
  },
  
  // TLS Notary (required for verifiable data)
  tlsnotary: {
    mode: 'production',
    allowMock: false // CRITICAL: Block mock in production
  }
})
```

**Characteristics**:
- ✅ High availability
- ✅ Data durability
- ✅ Distributed across regions
- ✅ Enterprise security
- ✅ Observable and monitorable

**Required Azure Resources**:
- Redis Cache (Premium for clustering)
- Cosmos DB (Multi-region writes optional)
- Storage Account (Standard or Premium)
- Key Vault (Standard or Premium HSM)
- Application Insights (for telemetry)

---

## Production Checklist

### Infrastructure

- [ ] Redis Cache configured with TLS
- [ ] Cosmos DB with appropriate consistency level
- [ ] Azure Blob Storage with geo-redundancy
- [ ] Key Vault with RBAC policies
- [ ] Virtual Network (VNet) integration
- [ ] Private endpoints for services

### Configuration

- [ ] `NODE_ENV=production` set
- [ ] All in-memory adapters replaced
- [ ] `TLSNOTARY_ALLOW_MOCK=false` enforced
- [ ] Connection strings in Key Vault
- [ ] Retry policies configured
- [ ] Circuit breakers enabled

### Security

- [ ] Managed Identity for Azure resources
- [ ] Secrets rotation policies
- [ ] Network security groups (NSGs)
- [ ] API rate limiting
- [ ] Audit logging enabled
- [ ] Encryption at rest verified

### Observability

- [ ] Application Insights instrumentation
- [ ] Custom metrics dashboards
- [ ] Alert rules configured
- [ ] Log aggregation setup
- [ ] Distributed tracing enabled
- [ ] Health check endpoints

### Testing

- [ ] Load testing completed
- [ ] Failover testing validated
- [ ] Chaos engineering scenarios
- [ ] Performance benchmarks met
- [ ] Security scan passed
- [ ] Compliance requirements verified

---

## Warning Signs

If you see these warnings in production logs, immediate action required:

### In-Memory Adapter Warnings

```
⚠️  [InMemoryStateStore] Using in-memory adapter in production.
⚠️  [InMemoryMessageQueue] Using in-memory adapter in production.
⚠️  [MockTLSNotaryVerifier] Mock verifier cannot be used in production.
```

**Resolution**: Replace with production adapters listed in matrix above.

### Configuration Issues

```
ERROR: REDIS_HOST not configured
ERROR: COSMOS_ENDPOINT not configured
ERROR: AZURE_STORAGE_CONNECTION_STRING not configured
```

**Resolution**: Set required environment variables or use Key Vault references.

---

## Deployment Patterns

### Single Region (Simple)

```
┌─────────────────────────────────────┐
│         Application Tier            │
│  ┌──────────┐      ┌──────────┐    │
│  │  Loom    │      │  Loom    │    │
│  │ Instance │      │ Instance │    │
│  └────┬─────┘      └────┬─────┘    │
└───────┼─────────────────┼──────────┘
        │                 │
        ├─────────┬───────┤
        │         │       │
   ┌────▼───┐ ┌──▼───┐ ┌─▼─────┐
   │ Redis  │ │Cosmos│ │Storage│
   │ Cache  │ │  DB  │ │ Blob  │
   └────────┘ └──────┘ └───────┘
```

### Multi-Region (Advanced)

```
    Region 1                 Region 2
┌──────────────┐        ┌──────────────┐
│ Loom Cluster │◄──────►│ Loom Cluster │
│  + Redis     │        │  + Redis     │
└──────┬───────┘        └───────┬──────┘
       │                        │
       └────────┬───────────────┘
                │
         ┌──────▼──────┐
         │   Cosmos    │
         │(Multi-Write)│
         └─────────────┘
```

---

## Performance Guidelines

### Request Throughput

| Adapter | Reads/sec | Writes/sec | Notes |
|---------|-----------|------------|-------|
| Redis | 100k+ | 50k+ | With clustering |
| Cosmos | 10k+ | 5k+ | With 400 RU/s |
| Blob Storage | 2k+ | 1k+ | Per account |

### Latency Targets

| Operation | p50 | p95 | p99 |
|-----------|-----|-----|-----|
| Actor invocation | < 5ms | < 20ms | < 50ms |
| State read | < 2ms | < 10ms | < 30ms |
| State write | < 10ms | < 30ms | < 100ms |
| Queue enqueue | < 5ms | < 15ms | < 40ms |
| Lock acquire | < 2ms | < 10ms | < 30ms |

---

## Cost Optimization

### Development

- Use in-memory adapters (free)
- Cosmos DB Free Tier (1000 RU/s)
- Azure Storage LRS (locally redundant)
- Redis Cache Basic (250 MB)

**Estimated**: $10-50/month

### Staging

- Redis Cache Standard (1 GB)
- Cosmos DB (1000 RU/s)
- Storage Account Standard GRS
- Key Vault Standard

**Estimated**: $100-300/month

### Production

- Redis Cache Premium (6 GB, clustered)
- Cosmos DB (10,000+ RU/s, multi-region)
- Storage Account Premium GRS
- Key Vault Premium HSM

**Estimated**: $1,000-5,000/month (scales with usage)

---

## Support

For production deployment assistance:
- Documentation: [/docs/DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- Issues: https://github.com/certo-ventures/loom/issues
- Discussions: https://github.com/certo-ventures/loom/discussions

---

## Next Steps

1. Review [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for step-by-step setup
2. Set up infrastructure using [Infrastructure as Code templates](../infrastructure/)
3. Configure production adapters
4. Run integration tests against staging
5. Deploy to production with monitoring
