# Journal Store Adapter Pattern

## Architecture Overview

The journal persistence system follows Loom's **adapter factory pattern** for pluggable infrastructure. This ensures:

- ✅ Configuration-driven adapter selection
- ✅ No direct Redis/BullMQ instantiation in application code
- ✅ Consistent connection management across all storage adapters
- ✅ Easy switching between implementations (redis vs inmemory)

## Correct Usage

### ✅ Production Code (AdapterFactory)

```typescript
import { AdapterFactory } from '@certo-ventures/loom/storage'

// Configuration-based instantiation
const journalStore = AdapterFactory.createJournalStore({
  type: 'redis',
  redis: { host: 'localhost', port: 6379 }
})

const actor = new Actor(
  context,
  {},
  undefined,
  undefined,
  undefined,
  journalStore
)
```

### ❌ Incorrect (Direct Instantiation)

```typescript
// DON'T DO THIS - bypasses factory pattern
import Redis from 'ioredis'
import { RedisJournalStore } from './storage/redis-journal-store'

const redis = new Redis('redis://localhost:6379')  // ❌
const journalStore = new RedisJournalStore(redis)   // ❌
```

## Why Use AdapterFactory?

1. **Centralized Configuration**: All Redis connections managed in one place
2. **Lazy Loading**: Dependencies (ioredis) only loaded when needed
3. **Consistent Patterns**: Matches MessageQueue, StateStore, CoordinationAdapter
4. **Testability**: Easy to swap redis ↔ inmemory for testing
5. **Production Ready**: Proper connection pooling and error handling

## Adapter Types

### Redis (Production)
```typescript
const store = AdapterFactory.createJournalStore({
  type: 'redis',
  redis: { host: 'localhost', port: 6379 }
})
```

- Uses Redis Streams (XADD/XRANGE/XTRIM)
- Persistent storage
- Snapshot support
- Auto-compaction

### In-Memory (Development/Testing)
```typescript
const store = AdapterFactory.createJournalStore({
  type: 'inmemory'
})
```

- Map-based storage
- No external dependencies
- Fast for unit tests
- Data lost on restart

## Integration with Other Adapters

Create all adapters at once:

```typescript
const adapters = AdapterFactory.createAll({
  messageQueue: {
    type: 'bullmq',
    redis: { host: 'localhost', port: 6379 }
  },
  journalStore: {
    type: 'redis',
    redis: { host: 'localhost', port: 6379 }  // Shares connection pool
  },
  coordinationAdapter: {
    type: 'redis',
    redis: { host: 'localhost', port: 6379 }
  },
  stateStore: {
    type: 'cosmos',
    cosmos: { endpoint: '...', database: 'loom' }
  }
})
```

## Connection Management

The factory handles connection lifecycle:

```typescript
// Factory creates ioredis client internally
const Redis = require('ioredis')
const redis = new Redis(config.redis || { host: 'localhost', port: 6379 })
return new RedisJournalStore(redis)
```

Benefits:
- Connection pooling
- Retry logic
- Graceful shutdown
- Shared connections across adapters

## Testing Strategy

### Unit Tests
Use in-memory or mocks:
```typescript
const store = new InMemoryJournalStore()  // Direct OK for unit tests
```

### Integration Tests
Use factory with real Redis:
```typescript
const store = AdapterFactory.createJournalStore({
  type: 'redis',
  redis: { host: 'localhost', port: 6379 }
})
```

This tests the **actual** configuration path used in production.

## Configuration Files

### loom.config.yaml
```yaml
infrastructure:
  journalStore:
    type: redis
    redis:
      host: ${REDIS_HOST}
      port: ${REDIS_PORT}
  
  messageQueue:
    type: bullmq
    redis:
      host: ${REDIS_HOST}
      port: ${REDIS_PORT}
```

### Environment Variables
```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379
```

## Migration Path

If you have direct instantiation:

**Before:**
```typescript
import Redis from 'ioredis'
import { RedisJournalStore } from './storage/redis-journal-store'

const redis = new Redis(process.env.REDIS_URL)
const store = new RedisJournalStore(redis)
```

**After:**
```typescript
import { AdapterFactory } from '@certo-ventures/loom/storage'

const [host, port] = process.env.REDIS_URL
  .replace('redis://', '')
  .split(':')

const store = AdapterFactory.createJournalStore({
  type: 'redis',
  redis: { host, port: parseInt(port) }
})
```

## Best Practices

1. ✅ Always use `AdapterFactory` in application code
2. ✅ Define adapter config once, reuse everywhere
3. ✅ Use environment variables for connection details
4. ✅ Share Redis config across adapters (messageQueue, journalStore, coordination)
5. ✅ Use `inmemory` type for local development
6. ✅ Integration tests should use factory pattern
7. ❌ Never instantiate Redis clients directly in application code
8. ❌ Don't import ioredis in application code

## See Also

- [examples/journal-with-adapter-factory.ts](../examples/journal-with-adapter-factory.ts) - Complete example
- [src/storage/adapter-factory.ts](../src/storage/adapter-factory.ts) - Factory implementation
- [src/tests/integration/](../src/tests/integration/) - Integration test examples
- [docs/LIBRARY_CONFIGURATION_PATTERN.md](./LIBRARY_CONFIGURATION_PATTERN.md) - Configuration patterns
