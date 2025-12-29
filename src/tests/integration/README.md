# Integration Tests for Journal Persistence

Real integration tests that use actual Redis instead of mocks.

## Prerequisites

You need a **real Redis instance** running. Two options:

### Option 1: Docker (Recommended)

```bash
# Start Redis
docker run -d -p 6379:6379 --name loom-redis redis:latest

# Stop Redis when done
docker stop loom-redis
docker rm loom-redis
```

### Option 2: Local Redis

```bash
# Install Redis (macOS)
brew install redis
redis-server

# Install Redis (Ubuntu)
sudo apt-get install redis-server
sudo systemctl start redis
```

## Running Integration Tests

### Run all integration tests

```bash
# Default (expects Redis at localhost:6379)
npm test -- integration

# Custom Redis URL
REDIS_URL=redis://localhost:6380 npm test -- integration
```

### Run specific integration test suites

```bash
# Only Redis journal store tests
npm test -- redis-journal-store.integration

# Only actor persistence tests  
npm test -- actor-persistence.integration
```

### Skip integration tests

```bash
# Skip if Redis not available
SKIP_REDIS_TESTS=1 npm test
```

## Test Coverage

### `redis-journal-store.integration.test.ts`
- ✅ Real Redis XADD/XRANGE/XTRIM operations
- ✅ Complex nested state persistence
- ✅ High-volume writes (1000+ entries)
- ✅ Concurrent writes from multiple actors
- ✅ Snapshot save/load
- ✅ Journal trimming and compaction
- ✅ Edge cases (empty trim, special characters, etc.)
- ✅ Performance benchmarks

### `actor-persistence.integration.test.ts`
- ✅ End-to-end actor state persistence
- ✅ Actor restart and recovery
- ✅ Auto-compaction behavior
- ✅ Snapshot-based recovery
- ✅ Concurrent actor operations
- ✅ Failure recovery (corrupted entries, partial journal)
- ✅ Performance under load

## What's Different from Unit Tests?

| Aspect | Unit Tests | Integration Tests |
|--------|-----------|-------------------|
| **Redis** | Mocked | Real via AdapterFactory |
| **Abstractions** | Direct instantiation | Uses AdapterFactory pattern |
| **I/O** | Synchronous | Actual network I/O |
| **Performance** | Fast (~1ms) | Realistic (~10-50ms) |
| **Edge Cases** | Simulated | Real behavior |
| **Concurrency** | Mocked | Real race conditions |
| **Setup** | None | Requires Redis |

**Key Architecture Note**: Integration tests use `AdapterFactory.createJournalStore()` instead of directly instantiating `RedisJournalStore`. This tests the actual configuration-based factory pattern used in production, ensuring Redis connections are created and managed correctly through the abstraction layer.

## Debugging

### Check Redis connection

```bash
redis-cli ping
# Should return: PONG
```

### View test data in Redis

```bash
redis-cli

# List all journal streams
SCAN 0 MATCH journal:* COUNT 100

# Read a specific journal
XRANGE journal:test-actor-id:entries - +

# Get snapshot
GET journal:test-actor-id:snapshot
```

### Clean up test data manually

```bash
redis-cli FLUSHDB
```

## CI/CD Integration

Add to your CI pipeline:

```yaml
# GitHub Actions example
- name: Start Redis
  run: docker run -d -p 6379:6379 redis:latest

- name: Run integration tests
  run: npm test -- integration
  env:
    REDIS_URL: redis://localhost:6379
```

## Performance Expectations

Based on test benchmarks:

- **Write throughput**: ~200-500 ops/sec
- **Read throughput**: ~100-300 ops/sec  
- **Actor operations**: ~50-200 ops/sec (includes journal persistence)

*Performance varies based on hardware and Redis configuration*

## Troubleshooting

### Tests fail with "Redis not available"

1. Check Redis is running: `redis-cli ping`
2. Check port: `netstat -an | grep 6379`
3. Check URL: `echo $REDIS_URL`

### Tests timeout

- Increase test timeout in vitest.config.ts
- Check Redis memory: `redis-cli INFO memory`
- Check network latency to Redis

### Data not persisting

- Verify Redis persistence config (RDB/AOF)
- Check Redis logs: `docker logs loom-redis`
- Ensure sufficient disk space

## Next Steps

After integration tests pass:

1. ✅ Unit tests verify logic
2. ✅ Integration tests verify Redis behavior
3. 🔜 Load tests for production capacity
4. 🔜 Chaos tests for failure scenarios
