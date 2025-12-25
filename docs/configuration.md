# Configuration Guide

Loom supports both **TypeScript configuration** (programmatic) and **YAML configuration** (declarative) for runtime settings.

## Configuration Priority

1. **Environment Variables** (highest priority)
2. **YAML Configuration File** (`loom.config.yaml`)
3. **TypeScript Configuration** (programmatic)
4. **Default Values** (lowest priority)

## YAML Configuration

### Quick Start

Create `loom.config.yaml` in your project root:

```yaml
# loom.config.yaml
actorPools:
  default:
    maxSize: 100
    idleTimeout: 300000  # 5 minutes
    evictionPolicy: lru

messageAdapter:
  type: bullmq
  queueMode: standard
  maxRetries: 3
  retryDelay: 1000

stateAdapter:
  type: redis
  host: localhost
  port: 6379
  db: 0

coordinationAdapter:
  type: redis
  lockTimeout: 30000
  renewInterval: 10000

tracing:
  enabled: true
  maxTraceAge: 3600000  # 1 hour
```

### Loading YAML Configuration

```typescript
import { loadConfigAuto } from '@your-org/loom/config';

// Automatically discovers config file
const config = await loadConfigAuto();

// Or specify path explicitly
const config = await loadConfig('./config/loom.yaml');

// Or use environment variable
// LOOM_CONFIG_PATH=/etc/loom/config.yaml node server.js
const config = await loadConfigAuto();
```

### Auto-Discovery Order

`loadConfigAuto()` searches in this order:

1. `LOOM_CONFIG_PATH` environment variable
2. `./loom.config.yaml`
3. `./config/loom.yaml`
4. `./config/loom.config.yaml`
5. Falls back to defaults

## Configuration Schema

### Global Settings

```yaml
# Global settings inherited by all actor pools
redis:
  host: ${REDIS_HOST:-localhost}  # Environment variable with fallback
  port: ${REDIS_PORT:-6379}
  password: ${REDIS_PASSWORD}
  db: 0
  keyPrefix: loom:
  maxRetriesPerRequest: 3
  enableReadyCheck: true
  connectTimeout: 10000

tracing:
  enabled: true
  maxTraceAge: 3600000        # Keep traces for 1 hour
  maxTracesPerCorrelation: 100
  cleanupInterval: 300000     # Cleanup every 5 minutes

observability:
  enabled: true
  port: 9090                  # HTTP server for /health and /metrics
  metricsRetention: 3600000   # Keep metrics for 1 hour
```

### Actor Pool Configuration

Define multiple actor pools with different settings:

```yaml
actorPools:
  # High-priority actors (large pool, never evict)
  critical:
    maxSize: 1000
    idleTimeout: 0  # Never evict
    evictionPolicy: none

  # Standard actors (default settings)
  default:
    maxSize: 100
    idleTimeout: 300000  # 5 minutes
    evictionPolicy: lru

  # Background workers (aggressive eviction)
  background:
    maxSize: 50
    idleTimeout: 60000  # 1 minute
    evictionPolicy: lru
```

**Pool Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `maxSize` | number | 100 | Maximum actors in pool |
| `idleTimeout` | number | 300000 | Milliseconds before eviction (0 = never) |
| `evictionPolicy` | string | 'lru' | Eviction strategy: 'lru', 'lfu', 'fifo', 'none' |

**Using Pools**:

```typescript
// Assign actor to specific pool
await runtime.execute(
  'critical-actor-1',
  async (actor) => actor.process(),
  { poolName: 'critical' }
);
```

### Message Adapter Configuration

```yaml
messageAdapter:
  type: bullmq  # bullmq | redis-pubsub | inmemory | rabbitmq

  # BullMQ-specific settings
  queueMode: standard       # standard | fifo
  maxRetries: 3
  retryDelay: 1000         # Milliseconds
  backoffType: exponential # exponential | fixed
  backoffDelay: 2000
  timeout: 30000           # Job timeout
  removeOnComplete: true
  removeOnFail: false

  # Dead Letter Queue settings
  deadLetterQueue:
    enabled: true
    maxAge: 86400000  # 24 hours
```

**Queue Modes**:
- `standard`: Parallel message processing
- `fifo`: Strict ordering (one message at a time per actor)

**Backoff Strategies**:
- `exponential`: `retryDelay * (2 ^ attemptNumber)`
- `fixed`: Same delay for all retries

### State Adapter Configuration

```yaml
stateAdapter:
  type: redis  # redis | cosmos | postgres | inmemory

  # Redis-specific
  host: redis.prod.example.com
  port: 6379
  password: ${REDIS_PASSWORD}
  db: 1
  keyPrefix: loom:state:

  # Cosmos DB-specific
  # endpoint: https://my-cosmos.documents.azure.com:443/
  # Uses DefaultAzureCredential (Managed Identity) - no key needed!
  # databaseId: loom
  # containerId: actors

  # PostgreSQL-specific
  # connectionString: postgresql://user:pass@localhost:5432/loom
  # schema: public
  # table: actor_state
```

### Coordination Adapter Configuration

```yaml
coordinationAdapter:
  type: redis  # redis | cosmos | inmemory

  # Lock settings
  lockTimeout: 30000      # Lock expires after 30 seconds
  renewInterval: 10000    # Renew lock every 10 seconds
  maxRenewAttempts: 3     # Give up after 3 failed renewals

  # Health check
  healthCheckInterval: 30000
```

**Lock Mechanics**:
- **Lock Timeout**: How long a lock is valid (protects against crashes)
- **Renew Interval**: How often active locks are renewed
- **Max Renew Attempts**: Failures before releasing lock

## TypeScript Configuration

For programmatic configuration:

```typescript
import { LongLivedActorRuntime } from '@your-org/loom';
import { BullMQAdapter } from '@your-org/loom/adapters/message';
import { RedisStateAdapter } from '@your-org/loom/adapters/state';
import { RedisCoordinationAdapter } from '@your-org/loom/adapters/coordination';

const runtime = new LongLivedActorRuntime({
  createActor: () => new MyActor(),

  // Actor pool settings
  poolConfig: {
    maxSize: 100,
    idleTimeout: 300000,
    evictionPolicy: 'lru'
  },

  // Redis configuration (shared)
  redisConfig: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: 0
  },

  // Message adapter
  messageAdapter: new BullMQAdapter({
    queueMode: 'fifo',
    maxRetries: 3,
    retryDelay: 1000
  }),

  // State adapter
  stateAdapter: new RedisStateAdapter({
    host: 'localhost',
    port: 6379,
    keyPrefix: 'loom:state:'
  }),

  // Coordination adapter
  coordinationAdapter: new RedisCoordinationAdapter({
    lockTimeout: 30000,
    renewInterval: 10000
  }),

  // Tracing
  tracing: {
    enabled: true,
    maxTraceAge: 3600000
  }
});
```

## Merging Configurations

When using both YAML and TypeScript config, they merge with this priority:

```typescript
import { loadConfig, mergeConfig } from '@your-org/loom/config';

// Load YAML config
const yamlConfig = await loadConfig('./loom.config.yaml');

// Define TypeScript overrides
const tsConfig = {
  actorPools: {
    critical: {
      maxSize: 2000  // Override YAML value
    }
  }
};

// Merge (TypeScript takes precedence)
const finalConfig = mergeConfig(yamlConfig, tsConfig);
```

**Merge Rules**:
1. **Objects**: Deep merge (combine keys)
2. **Arrays**: Replace (TypeScript overrides YAML)
3. **Primitives**: Replace (TypeScript overrides YAML)

## Environment Variables

### Using Environment Variables in YAML

```yaml
redis:
  host: ${REDIS_HOST:-localhost}     # Fallback to localhost
  port: ${REDIS_PORT:-6379}          # Fallback to 6379
  password: ${REDIS_PASSWORD}        # Required (no fallback)
```

**Syntax**:
- `${VAR}`: Required variable (error if missing)
- `${VAR:-default}`: Optional with fallback
- `${VAR:?error message}`: Required with custom error

### Common Environment Variables

```bash
# Configuration file path
export LOOM_CONFIG_PATH=/etc/loom/config.yaml

# Redis connection
export REDIS_HOST=redis.prod.example.com
export REDIS_PORT=6379
export REDIS_PASSWORD=secret123

# Cosmos DB (if using Cosmos adapter)
export COSMOS_ENDPOINT=https://my-cosmos.documents.azure.com:443/
# Uses DefaultAzureCredential (Managed Identity) - no COSMOS_KEY needed!

# Observability
export LOOM_OBSERVABILITY_PORT=9090
export LOOM_TRACING_ENABLED=true

# Actor pools
export LOOM_POOL_MAX_SIZE=1000
export LOOM_POOL_IDLE_TIMEOUT=300000
```

## Per-Actor Configuration

Actors can have individual settings that override pool defaults:

```typescript
class MyActor {
  // Static method defines actor-specific config
  static getConfig() {
    return {
      timeout: 60000,         // Override default timeout
      maxRetries: 5,          // Override default retries
      queueMode: 'fifo',      // Override queue mode
      priority: 'high'        // Custom priority
    };
  }

  async process() {
    // Actor logic
  }
}

// Runtime merges actor config with pool config
const runtime = new LongLivedActorRuntime({
  createActor: () => new MyActor()
});
```

## Validation

Loom uses **Zod** for runtime validation of all configuration:

```typescript
import { validateConfig } from '@your-org/loom/config';

// Validation happens automatically on load
const config = await loadConfig('./loom.config.yaml');

// Or validate manually
const result = validateConfig(rawConfig);

if (!result.success) {
  console.error('Invalid configuration:');
  result.error.issues.forEach(issue => {
    console.error(`- ${issue.path.join('.')}: ${issue.message}`);
  });
}
```

**Common Validation Errors**:

```
- actorPools.default.maxSize: Expected number, received string
- messageAdapter.type: Invalid enum value. Expected 'bullmq' | 'redis-pubsub' | 'inmemory'
- redis.port: Number must be greater than 0
- coordinationAdapter.lockTimeout: Required
```

## Configuration Examples

### Development Environment

```yaml
# loom.config.dev.yaml
actorPools:
  default:
    maxSize: 10
    idleTimeout: 60000  # Evict after 1 minute

messageAdapter:
  type: inmemory  # No Redis needed

stateAdapter:
  type: inmemory  # No persistence

coordinationAdapter:
  type: inmemory  # Single process only

tracing:
  enabled: true
  maxTraceAge: 300000  # Keep 5 minutes

observability:
  enabled: true
  port: 9090
```

### Production Environment

```yaml
# loom.config.prod.yaml
actorPools:
  default:
    maxSize: 1000
    idleTimeout: 300000  # 5 minutes
    evictionPolicy: lru

messageAdapter:
  type: bullmq
  queueMode: standard
  maxRetries: 5
  retryDelay: 2000
  backoffType: exponential
  timeout: 60000

stateAdapter:
  type: redis
  host: ${REDIS_HOST}
  port: ${REDIS_PORT}
  password: ${REDIS_PASSWORD}
  db: 0
  keyPrefix: loom:prod:

coordinationAdapter:
  type: redis
  lockTimeout: 30000
  renewInterval: 10000
  maxRenewAttempts: 5

redis:
  host: ${REDIS_HOST}
  port: ${REDIS_PORT}
  password: ${REDIS_PASSWORD}
  enableReadyCheck: true
  maxRetriesPerRequest: 3

tracing:
  enabled: true
  maxTraceAge: 3600000  # 1 hour

observability:
  enabled: true
  port: 9090
  metricsRetention: 3600000
```

### High-Throughput Environment

```yaml
# loom.config.high-throughput.yaml
actorPools:
  default:
    maxSize: 5000       # Large pool
    idleTimeout: 600000 # Keep actors longer
    evictionPolicy: lfu # Evict least frequently used

messageAdapter:
  type: bullmq
  queueMode: standard  # Parallel processing
  maxRetries: 3
  timeout: 30000
  removeOnComplete: true  # Don't accumulate completed jobs

stateAdapter:
  type: redis
  host: ${REDIS_HOST}
  port: ${REDIS_PORT}
  keyPrefix: loom:

coordinationAdapter:
  type: redis
  lockTimeout: 20000   # Shorter timeout
  renewInterval: 5000  # Renew more frequently

redis:
  maxRetriesPerRequest: 2
  connectTimeout: 5000
```

## Best Practices

### 1. Use Environment Variables for Secrets
```yaml
# ❌ Bad - hardcoded password
redis:
  password: mypassword123

# ✅ Good - environment variable
redis:
  password: ${REDIS_PASSWORD}
```

### 2. Set Appropriate Pool Sizes
```yaml
# Rule of thumb: maxSize = expectedConcurrentActors * 1.5
actorPools:
  default:
    maxSize: 150  # For ~100 concurrent actors
```

### 3. Configure Timeouts Carefully
```yaml
# Lock timeout > message timeout > actor operation timeout
coordinationAdapter:
  lockTimeout: 60000     # 60 seconds

messageAdapter:
  timeout: 45000         # 45 seconds

# Actor operation should complete in < 45 seconds
```

### 4. Enable Tracing in Production
```yaml
tracing:
  enabled: true          # Critical for debugging
  maxTraceAge: 3600000   # Retain for investigation
```

### 5. Monitor Health Endpoints
```yaml
observability:
  enabled: true
  port: 9090

# Then configure monitoring:
# - Prometheus scraping http://localhost:9090/metrics
# - Health checks http://localhost:9090/health
# - Alerts on degraded status
```

### 6. Use Different Configs per Environment
```bash
# Development
LOOM_CONFIG_PATH=./config/loom.dev.yaml npm run dev

# Staging
LOOM_CONFIG_PATH=./config/loom.staging.yaml npm start

# Production
LOOM_CONFIG_PATH=./config/loom.prod.yaml npm start
```

## Troubleshooting

### Config Not Loading

**Problem**: Default config used instead of YAML
**Solution**: Check file path and permissions
```bash
ls -la loom.config.yaml
# Should show readable file

# Or set explicit path
export LOOM_CONFIG_PATH=/full/path/to/loom.config.yaml
```

### Validation Errors

**Problem**: Config file has invalid structure
**Solution**: Check error messages from Zod
```typescript
const result = await loadConfigSafe('./loom.config.yaml');
if (!result.success) {
  console.error(result.error.issues);
}
```

### Environment Variables Not Substituted

**Problem**: `${REDIS_HOST}` appears literally in logs
**Solution**: Ensure variable is exported
```bash
# Check if variable exists
echo $REDIS_HOST

# Export if missing
export REDIS_HOST=localhost
```

### Redis Connection Failures

**Problem**: Cannot connect to Redis
**Solution**: Verify config and network
```yaml
redis:
  host: localhost
  port: 6379
  connectTimeout: 10000  # Increase timeout
  enableReadyCheck: true # Verify connection
```

## Next Steps

- [Adapters Guide](./adapters.md) for backend selection
- [Best Practices](./best-practices.md) for production patterns
- [API Reference](./api-reference.md) for programmatic config
