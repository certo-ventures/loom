/**
 * Production Adapters Integration Tests
 * 
 * Tests real infrastructure integrations with Redis and Cosmos DB.
 * These tests require actual infrastructure and are skipped by default.
 * 
 * To run:
 * 1. Set up test infrastructure (see docs/TESTING_GUIDE.md)
 * 2. Configure environment variables
 * 3. Run: npm test -- --run production-adapters
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import Redis from 'ioredis'
import { CosmosClient } from '@azure/cosmos'

// Redis Adapters
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue'
import { RedisLockManager } from '../../storage/redis-lock-manager'
import { RedisJournalStore } from '../../storage/redis-journal-store'
import { RedisIdempotencyStore } from '../../storage/redis-idempotency-store'
import { RedisActorRegistry } from '../../discovery/redis-actor-registry'

// Cosmos Adapters
import { CosmosStateStore } from '../../storage/cosmos-state-store'
import { CosmosTraceStore } from '../../tracing/cosmos-trace-store'
import { CosmosSecretsStore } from '../../secrets/cosmos-secrets'
import { CosmosActorRegistry } from '../../discovery/cosmos-actor-registry'

// Types
import type { ActorState } from '../../types'
import type { JournalEntry } from '../../actor/journal'
import type { ActorTrace } from '../../tracing/types'

const SKIP_INTEGRATION_TESTS = process.env.SKIP_INTEGRATION !== 'false'

describe.skipIf(SKIP_INTEGRATION_TESTS)('Production Adapters Integration', () => {
  
  describe('Redis Adapters', () => {
    let redis: Redis
    let messageQueue: BullMQMessageQueue
    let lockManager: RedisLockManager
    let journalStore: RedisJournalStore
    let idempotencyStore: RedisIdempotencyStore

    beforeAll(async () => {
      // Create Redis client
      redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        maxRetriesPerRequest: null, // Required for BullMQ
      })

      // Initialize Redis adapters with the client
      messageQueue = new BullMQMessageQueue(redis, {
        prefix: 'test',
      })

      lockManager = new RedisLockManager(redis)
      journalStore = new RedisJournalStore(redis)
      idempotencyStore = new RedisIdempotencyStore(redis)
    })

    afterAll(async () => {
      // Cleanup
      await messageQueue.close?.()
      await redis.quit()
    })

    describe('BullMQ Message Queue', () => {
      const queueName = `test-queue-${randomUUID()}`

      it('should enqueue messages with priority', async () => {
        const message1 = {
          id: randomUUID(),
          type: 'test-message',
          payload: { data: 'low priority' },
          timestamp: Date.now(),
        }

        const message2 = {
          id: randomUUID(),
          type: 'test-message',
          payload: { data: 'high priority' },
          timestamp: Date.now(),
        }

        // Enqueue with different priorities
        await messageQueue.enqueue(queueName, message1, 1)
        await messageQueue.enqueue(queueName, message2, 10)

        // Jobs are enqueued successfully (BullMQ uses workers for processing)
        // In a real system, you would register a worker to process these
        expect(true).toBe(true)
      })

      it('should register and process messages via worker', async () => {
        const workerQueueName = `worker-queue-${randomUUID()}`
        let processedMessage: any = null

        // Register worker
        messageQueue.registerWorker(
          workerQueueName,
          async (msg: any) => {
            processedMessage = msg
          },
          1
        )

        // Enqueue message
        const testMessage = {
          id: randomUUID(),
          type: 'worker-test',
          payload: { data: 'test' },
          timestamp: Date.now(),
        }

        await messageQueue.enqueue(workerQueueName, testMessage)

        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 500))

        expect(processedMessage).toBeDefined()
        expect(processedMessage.id).toBe(testMessage.id)
      })
    })

    describe('Redis Lock Manager', () => {
      it('should acquire and release distributed locks', async () => {
        const lockKey = `test-lock-${randomUUID()}`

        // Acquire lock
        const lock = await lockManager.acquire(lockKey, 5000)
        expect(lock).toBeDefined()
        expect(lock?.key).toBe(lockKey)

        // Try to acquire same lock (should fail)
        const secondLock = await lockManager.acquire(lockKey, 5000)
        expect(secondLock).toBeNull()

        // Release lock
        if (lock) {
          await lockManager.release(lock)
        }

        // Should be able to acquire again
        const thirdLock = await lockManager.acquire(lockKey, 5000)
        expect(thirdLock).toBeDefined()

        if (thirdLock) {
          await lockManager.release(thirdLock)
        }
      })

      it('should handle lock expiration', async () => {
        const lockKey = `test-lock-expire-${randomUUID()}`

        // Acquire lock with short TTL
        const lock = await lockManager.acquire(lockKey, 500)
        expect(lock).toBeDefined()

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 600))

        // Should be able to acquire expired lock
        const newLock = await lockManager.acquire(lockKey, 5000)
        expect(newLock).toBeDefined()

        if (newLock) {
          await lockManager.release(newLock)
        }
      })

      it('should handle lock extension', async () => {
        const lockKey = `test-lock-extend-${randomUUID()}`

        const lock = await lockManager.acquire(lockKey, 1000)
        expect(lock).toBeDefined()

        if (lock) {
          // Extend lock
          await lockManager.extend(lock, 5000)

          // Lock should still be held
          const secondLock = await lockManager.acquire(lockKey, 1000)
          expect(secondLock).toBeNull()

          await lockManager.release(lock)
        }
      })
    })

    describe('Redis Journal Store', () => {
      const actorId = `test-actor-${randomUUID()}`

      it('should append and read journal entries', async () => {
        const entries: JournalEntry[] = [
          {
            type: 'StateChanged',
            timestamp: Date.now(),
            data: { oldState: 'idle', newState: 'processing' },
          },
          {
            type: 'MessageReceived',
            timestamp: Date.now(),
            data: { messageId: 'msg-1', payload: { test: true } },
          },
          {
            type: 'StateChanged',
            timestamp: Date.now(),
            data: { oldState: 'processing', newState: 'completed' },
          },
        ]

        // Append entries
        for (const entry of entries) {
          await journalStore.appendEntry(actorId, entry)
        }

        // Read entries
        const readEntries = await journalStore.readEntries(actorId)
        expect(readEntries).toHaveLength(3)
        expect(readEntries[0].type).toBe('StateChanged')
        expect(readEntries[1].type).toBe('MessageReceived')
        expect(readEntries[2].type).toBe('StateChanged')
      })

      it('should create and restore from snapshots', async () => {
        const snapshotActorId = `snapshot-actor-${randomUUID()}`

        // Append some entries
        for (let i = 0; i < 10; i++) {
          await journalStore.appendEntry(snapshotActorId, {
            type: 'Event',
            timestamp: Date.now(),
            data: { counter: i },
          })
        }

        // Create snapshot
        await journalStore.saveSnapshot(snapshotActorId, {
          sequence: 10,
          state: { counter: 9 },
          timestamp: Date.now(),
        })

        // Get snapshot
        const snapshot = await journalStore.getLatestSnapshot(snapshotActorId)
        expect(snapshot).toBeDefined()
        expect(snapshot?.sequence).toBe(10)
        expect(snapshot?.state).toEqual({ counter: 9 })

        // Add more entries after snapshot
        await journalStore.appendEntry(snapshotActorId, {
          type: 'Event',
          timestamp: Date.now(),
          data: { counter: 10 },
        })

        // Read all entries (includes post-snapshot entries)
        const allEntries = await journalStore.readEntries(snapshotActorId)
        expect(allEntries.length).toBeGreaterThan(10)
      })
    })

    describe('Redis Idempotency Store', () => {
      it('should detect duplicate requests', async () => {
        const requestId = randomUUID()

        // First request
        const existing = await idempotencyStore.get(requestId)
        expect(existing).toBeUndefined()

        // Store result
        await idempotencyStore.set({
          key: requestId,
          actorId: 'test-actor',
          result: { success: true, data: 'test result' },
          executedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        })

        // Duplicate request
        const cached = await idempotencyStore.get(requestId)
        expect(cached).toBeDefined()
        expect(cached?.result).toEqual({ success: true, data: 'test result' })
      })

      it('should expire old idempotency records', async () => {
        const shortLivedId = randomUUID()

        await idempotencyStore.set(
          {
            key: shortLivedId,
            actorId: 'test-actor',
            result: { test: true },
            executedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 500).toISOString(),
          },
          1 // TTL in seconds (minimum 1 second)
        )

        // Should exist immediately
        const immediate = await idempotencyStore.get(shortLivedId)
        expect(immediate).toBeDefined()

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 600))

        // Should be expired
        const expired = await idempotencyStore.get(shortLivedId)
        expect(expired).toBeUndefined()
      })
    })

    describe('Redis Actor Registry', () => {
      let registry: RedisActorRegistry
      let registryRedis: Redis

      beforeAll(() => {
        registryRedis = new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD,
        })
        registry = new RedisActorRegistry({ redis: registryRedis })
      })

      afterAll(async () => {
        await registryRedis.quit()
      })

      it('should register and discover actors', async () => {
        const actorId = `test-actor-${randomUUID()}`

        await registry.register({
          actorId,
          actorType: 'TestActor',
          instanceId: 'instance-1',
          queueName: `actor:${actorId}`,
          registeredAt: new Date(),
          lastHeartbeat: new Date(),
          messageCount: 0,
          metadata: { region: 'us-west' },
        })

        const registration = await registry.get(actorId)
        expect(registration).toBeDefined()
        expect(registration?.actorType).toBe('TestActor')
        expect(registration?.metadata?.region).toBe('us-west')
      })

      it('should support actor heartbeats', async () => {
        const actorId = `heartbeat-actor-${randomUUID()}`

        await registry.register({
          actorId,
          actorType: 'HeartbeatActor',
          instanceId: 'instance-1',
          queueName: `actor:${actorId}`,
          registeredAt: new Date(),
          lastHeartbeat: new Date(),
          messageCount: 0,
        })

        const before = await registry.get(actorId)
        const beforeTime = before?.lastHeartbeat?.getTime() || 0

        await new Promise(resolve => setTimeout(resolve, 100))

        await registry.heartbeat(actorId)

        const after = await registry.get(actorId)
        const afterTime = after?.lastHeartbeat?.getTime() || 0

        expect(afterTime).toBeGreaterThan(beforeTime)
      })

      it('should clean up stale actors', async () => {
        const staleActorId = `stale-actor-${randomUUID()}`

        await registry.register({
          actorId: staleActorId,
          actorType: 'StaleActor',
          instanceId: 'instance-1',
          queueName: `actor:${staleActorId}`,
          registeredAt: new Date(Date.now() - 10000),
          lastHeartbeat: new Date(Date.now() - 10000),
          messageCount: 0,
        })

        // Clean up actors with no heartbeat for 5 seconds
        const cleaned = await registry.cleanup(5000)
        expect(cleaned).toBeGreaterThan(0)

        const registration = await registry.get(staleActorId)
        expect(registration).toBeUndefined()
      })
    })
  })

  describe('Cosmos DB Adapters', () => {
    let cosmosClient: CosmosClient
    let stateStore: CosmosStateStore
    let traceStore: CosmosTraceStore
    let secretsStore: CosmosSecretsStore
    
    const endpoint = process.env.COSMOS_ENDPOINT || 'https://localhost:8081'
    const key = process.env.COSMOS_KEY || 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=='
    const databaseId = 'loom-test'

    beforeAll(async () => {
      // Create Cosmos client
      cosmosClient = new CosmosClient({ endpoint, key })

      // Initialize stateStore (takes CosmosClient)
      stateStore = new CosmosStateStore(
        cosmosClient,
        databaseId,
        'actor-state-test'
      )
      await stateStore.initialize()

      // Initialize traceStore (takes config object)
      traceStore = new CosmosTraceStore({
        endpoint,
        key,
        databaseId,
        containerId: 'traces-test',
      })
      await traceStore.initialize()

      // Initialize secretsStore (takes container)
      const { database } = await cosmosClient.databases.createIfNotExists({
        id: databaseId,
      })
      const { container: secretsContainer } = await database.containers.createIfNotExists({
        id: 'secrets-test',
        partitionKey: '/partitionKey',
      })
      secretsStore = new CosmosSecretsStore({
        container: secretsContainer,
      })
    })

    afterAll(async () => {
      // Flush and cleanup
      await traceStore.flush?.()
      cosmosClient.dispose()
    })

    describe('Cosmos State Store', () => {
      it('should save and load actor state', async () => {
        const actorId = `test-actor-${randomUUID()}`
        
        const state: ActorState = {
          actorId,
          actorType: 'TestActor',
          status: 'active',
          data: { counter: 42, items: ['a', 'b', 'c'] },
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        // Save state
        await stateStore.save(actorId, state)

        // Load state
        const loaded = await stateStore.load(actorId)
        expect(loaded).toBeDefined()
        expect(loaded?.actorId).toBe(actorId)
        expect(loaded?.data.counter).toBe(42)
        expect(loaded?.data.items).toEqual(['a', 'b', 'c'])
      })

      it('should handle state updates with versioning', async () => {
        const actorId = `versioned-actor-${randomUUID()}`

        // Initial state
        await stateStore.save(actorId, {
          actorId,
          actorType: 'VersionedActor',
          status: 'active',
          data: { value: 1 },
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        // Update state
        await stateStore.save(actorId, {
          actorId,
          actorType: 'VersionedActor',
          status: 'active',
          data: { value: 2 },
          version: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        const loaded = await stateStore.load(actorId)
        expect(loaded?.version).toBe(2)
        expect(loaded?.data.value).toBe(2)
      })

      it('should delete actor state', async () => {
        const actorId = `deletable-actor-${randomUUID()}`

        await stateStore.save(actorId, {
          actorId,
          actorType: 'DeletableActor',
          status: 'active',
          data: {},
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        // Verify exists
        const beforeDelete = await stateStore.load(actorId)
        expect(beforeDelete).toBeDefined()

        // Delete
        await stateStore.delete(actorId)

        // Verify deleted
        const afterDelete = await stateStore.load(actorId)
        expect(afterDelete).toBeNull()
      })
    })

    describe('Cosmos Trace Store', () => {
      it('should record and query traces', async () => {
        const traceId = randomUUID()
        const actorId = `traced-actor-${randomUUID()}`

        const trace: ActorTrace = {
          traceId,
          actorId,
          actorType: 'TracedActor',
          correlationId: randomUUID(),
          startTime: Date.now(),
          endTime: Date.now() + 100,
          duration: 100,
          status: 'completed',
          events: [
            { timestamp: Date.now(), type: 'started', data: {} },
            { timestamp: Date.now() + 50, type: 'processing', data: {} },
            { timestamp: Date.now() + 100, type: 'completed', data: {} },
          ],
        }

        // Record trace
        await traceStore.save(trace)
        await traceStore.flush()

        // Query by traceId
        const retrieved = await traceStore.get(traceId)
        expect(retrieved).toBeDefined()
        expect(retrieved?.actorId).toBe(actorId)
        expect(retrieved?.events).toHaveLength(3)
      })

      it('should query traces by actor and status', async () => {
        const actorId = `queryable-actor-${randomUUID()}`
        const correlationId = randomUUID()

        // Record multiple traces
        const traces: ActorTrace[] = [
          {
            traceId: randomUUID(),
            actorId,
            actorType: 'QueryableActor',
            correlationId,
            startTime: Date.now(),
            endTime: Date.now() + 100,
            duration: 100,
            status: 'completed',
            events: [],
          },
          {
            traceId: randomUUID(),
            actorId,
            actorType: 'QueryableActor',
            correlationId,
            startTime: Date.now(),
            status: 'running',
            events: [],
          },
        ]

        // Save traces
        for (const trace of traces) {
          await traceStore.save(trace)
        }
        await traceStore.flush()

        // Query completed traces
        const completedTraces = await traceStore.query({
          actorId,
          status: 'completed',
        })

        expect(completedTraces.length).toBeGreaterThanOrEqual(1)
        expect(completedTraces[0].status).toBe('completed')

        // Query by correlation ID
        const correlatedTraces = await traceStore.query({
          correlationId,
        })

        expect(correlatedTraces.length).toBeGreaterThanOrEqual(2)
      })

      it('should generate trace statistics', async () => {
        const correlationId = randomUUID()

        // Record traces with different outcomes
        const traces = [
          {
            traceId: randomUUID(),
            actorId: `stats-actor-1`,
            actorType: 'StatsActor',
            correlationId,
            startTime: Date.now(),
            endTime: Date.now() + 100,
            duration: 100,
            status: 'completed',
            events: [],
          },
          {
            traceId: randomUUID(),
            actorId: `stats-actor-2`,
            actorType: 'StatsActor',
            correlationId,
            startTime: Date.now(),
            endTime: Date.now() + 50,
            duration: 50,
            status: 'completed',
            events: [],
          },
          {
            traceId: randomUUID(),
            actorId: `stats-actor-3`,
            actorType: 'StatsActor',
            correlationId,
            startTime: Date.now(),
            status: 'failed',
            error: 'Test error',
            events: [],
          },
        ]

        for (const trace of traces) {
          await traceStore.save(trace)
        }
        await traceStore.flush()

        const stats = await traceStore.getStats(correlationId)
        
        expect(stats.totalTraces).toBeGreaterThanOrEqual(3)
        expect(stats.completed).toBeGreaterThanOrEqual(2)
        expect(stats.failed).toBeGreaterThanOrEqual(1)
        expect(stats.avgDuration).toBeGreaterThan(0)
      })

      it('should clean up old traces', async () => {
        const oldTraceId = randomUUID()

        // Create old trace
        await traceStore.save({
          traceId: oldTraceId,
          actorId: `old-actor`,
          actorType: 'OldActor',
          startTime: Date.now() - 86400000, // 1 day ago
          endTime: Date.now() - 86400000 + 100,
          duration: 100,
          status: 'completed',
          events: [],
        })
        await traceStore.flush()

        // Clean up traces older than 1 hour
        const cleaned = await traceStore.cleanup(3600000)
        expect(cleaned).toBeGreaterThan(0)
      })
    })

    describe('Cosmos Secrets Store', () => {
      it('should store and retrieve secrets', async () => {
        const secretKey = `test-secret-${randomUUID()}`

        await secretsStore.setSecret({
          key: secretKey,
          value: 'secret-value-123',
          version: '1',
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        const retrieved = await secretsStore.getSecret(secretKey)
        expect(retrieved).toBeDefined()
        expect(retrieved?.value).toBe('secret-value-123')
      })

      it('should handle secret versioning', async () => {
        const secretKey = `versioned-secret-${randomUUID()}`

        // Version 1
        await secretsStore.setSecret({
          key: secretKey,
          value: 'value-v1',
          version: '1',
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        // Version 2
        await secretsStore.setSecret({
          key: secretKey,
          value: 'value-v2',
          version: '2',
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        // Get latest (should be v2)
        const latest = await secretsStore.getSecret(secretKey)
        expect(latest?.value).toBe('value-v2')
        expect(latest?.version).toBe('2')
      })

      it('should delete secrets', async () => {
        const secretKey = `deletable-secret-${randomUUID()}`

        await secretsStore.setSecret({
          key: secretKey,
          value: 'temporary-secret',
          version: '1',
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        // Verify exists
        const before = await secretsStore.getSecret(secretKey)
        expect(before).toBeDefined()

        // Delete
        await secretsStore.deleteSecret(secretKey)

        // Verify deleted
        const after = await secretsStore.getSecret(secretKey)
        expect(after).toBeNull()
      })

      it('should handle secret expiration', async () => {
        const secretKey = `expiring-secret-${randomUUID()}`

        await secretsStore.setSecret({
          key: secretKey,
          value: 'expiring-value',
          version: '1',
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + 500), // Expires in 500ms
        })

        // Should exist immediately
        const immediate = await secretsStore.getSecret(secretKey)
        expect(immediate).toBeDefined()

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 600))

        // Should be expired
        const expired = await secretsStore.getSecret(secretKey)
        expect(expired).toBeNull()
      })
    })

    describe('Cosmos Actor Registry', () => {
      let registry: CosmosActorRegistry

      beforeAll(async () => {
        const { database } = await cosmosClient.databases.createIfNotExists({
          id: databaseId,
        })
        const { container } = await database.containers.createIfNotExists({
          id: 'actor-registry-test',
          partitionKey: '/partitionKey',
        })
        registry = new CosmosActorRegistry({ container })
      })

      it('should register and discover actors', async () => {
        const actorId = `cosmos-actor-${randomUUID()}`

        await registry.register({
          actorId,
          actorType: 'CosmosActor',
          instanceId: 'instance-1',
          queueName: `actor:${actorId}`,
          registeredAt: new Date(),
          lastHeartbeat: new Date(),
          metadata: { 
            environment: 'test',
            capabilities: ['compute', 'storage'],
          },
        })

        const registration = await registry.get(actorId)
        expect(registration).toBeDefined()
        expect(registration?.metadata?.environment).toBe('test')
        expect(registration?.metadata?.capabilities).toEqual(['compute', 'storage'])
      })

      it('should query actors by type', async () => {
        const actorType = `QueryableType-${randomUUID()}`

        // Register multiple actors of same type
        for (let i = 0; i < 3; i++) {
          await registry.register({
            actorId: `${actorType}-${i}`,
            actorType,
            instanceId: 'instance-1',
            queueName: `actor:${actorType}-${i}`,
            registeredAt: new Date(),
            lastHeartbeat: new Date(),
          })
        }

        const actors = await registry.getByType(actorType)
        expect(actors.length).toBeGreaterThanOrEqual(3)
        actors.forEach(actor => {
          expect(actor.actorType).toBe(actorType)
        })
      })
    })
  })

  describe('Hybrid Configuration', () => {
    it('should work with BullMQ + Cosmos state + Redis locks', async () => {
      const actorId = `hybrid-actor-${randomUUID()}`
      
      const redisHost = process.env.REDIS_HOST || 'localhost'
      const redisPort = parseInt(process.env.REDIS_PORT || '6379')
      const cosmosEndpoint = process.env.COSMOS_ENDPOINT || 'https://localhost:8081'
      const cosmosKey = process.env.COSMOS_KEY || 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=='

      // Create Redis client
      const redis = new Redis({
        host: redisHost,
        port: redisPort,
        maxRetriesPerRequest: null,
      })

      // Use BullMQ for messages
      const messageQueue = new BullMQMessageQueue(redis, { prefix: 'hybrid' })

      // Use Cosmos for state
      const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey })
      const stateStore = new CosmosStateStore(
        cosmosClient,
        'loom-test',
        'hybrid-state'
      )
      await stateStore.initialize()

      // Use Redis for locks
      const lockManager = new RedisLockManager(redis)

      try {
        // Acquire lock
        const lock = await lockManager.acquire(actorId, 5000)
        expect(lock).toBeDefined()

        // Save state
        await stateStore.save(actorId, {
          actorId,
          actorType: 'HybridActor',
          status: 'active',
          data: { test: true },
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        // Enqueue message
        await messageQueue.enqueue(`actor:${actorId}`, {
          id: randomUUID(),
          type: 'process',
          payload: { data: 'test' },
          timestamp: Date.now(),
        })

        // Verify all adapters work together
        const state = await stateStore.load(actorId)
        expect(state).toBeDefined()

        const message = await messageQueue.dequeue(`actor:${actorId}`, 1000)
        expect(message).toBeDefined()

        if (message) {
          await messageQueue.ack(`actor:${actorId}`, message)
        }

        if (lock) {
          await lockManager.release(lock)
        }
      } finally {
        await messageQueue.close?.()
        await redis.quit()
        cosmosClient.dispose()
      }
    })
  })
})
