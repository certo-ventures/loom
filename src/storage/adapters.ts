/**
 * Adapter Pattern - Pluggable Infrastructure
 * 
 * Loom uses the Adapter Pattern to provide pluggable implementations
 * for core infrastructure components. This enables:
 * 
 * - Configuration-based selection (no code changes)
 * - Multiple implementations per adapter type
 * - Easy testing with in-memory adapters
 * - Production deployment with cloud-native adapters
 * 
 * ## Available Adapters
 * 
 * ### MessageQueue
 * Reliable message delivery between actors
 * - BullMQMessageQueue (production, Redis-backed)
 * - InMemoryMessageQueue (dev/test)
 * 
 * ### StateStore
 * Persist and retrieve actor state
 * - CosmosStateStore (production, Azure Cosmos DB)
 * - InMemoryStateStore (dev/test)
 * 
 * ### CoordinationAdapter
 * Distributed actor locking for horizontal scaling
 * - RedisCoordinationAdapter (production, Redlock algorithm)
 * - InMemoryCoordinationAdapter (dev/test, single-instance only)
 * 
 * ### BlobStore
 * Store large binary objects (WASM modules, files)
 * - AzureBlobStore (production, Azure Blob Storage)
 * - InMemoryBlobStore (dev/test)
 * 
 * ### ActivityStore
 * Manage activity (WASM) metadata and versioning
 * - CosmosActivityStore (production)
 * - InMemoryActivityStore (dev/test)
 * 
 * ### LockManager
 * Distributed locking for critical sections
 * - RedisLockManager (production, Redlock algorithm)
 * - InMemoryLockManager (dev/test, single-instance only)
 * 
 * ## Usage Pattern
 * 
 * ```typescript
 * import { 
 *   BullMQMessageQueue, 
 *   RedisCoordinationAdapter,
 *   CosmosStateStore 
 * } from '@loom/storage'
 * 
 * // Production configuration
 * const runtime = new LongLivedActorRuntime({
 *   messageQueue: new BullMQMessageQueue(redis),
 *   coordinationAdapter: new RedisCoordinationAdapter(redis),
 *   stateStore: new CosmosStateStore(cosmos),
 *   blobStore: new AzureBlobStore(config),
 * })
 * 
 * // Development configuration
 * const runtime = new LongLivedActorRuntime({
 *   messageQueue: new InMemoryMessageQueue(),
 *   coordinationAdapter: new InMemoryCoordinationAdapter(),
 *   stateStore: new InMemoryStateStore(),
 *   blobStore: new InMemoryBlobStore(),
 * })
 * ```
 * 
 * ## Creating Custom Adapters
 * 
 * To create a custom adapter, implement the interface:
 * 
 * ```typescript
 * import { MessageQueue, Message } from '@loom/storage'
 * 
 * export class RabbitMQMessageQueue implements MessageQueue {
 *   async enqueue(queueName: string, message: Message) {
 *     // Your implementation
 *   }
 *   
 *   async dequeue(queueName: string, timeoutMs: number) {
 *     // Your implementation
 *   }
 *   
 *   // ... other methods
 * }
 * ```
 * 
 * ## Adapter Selection Matrix
 * 
 * | Use Case | MessageQueue | StateStore | CoordinationAdapter | BlobStore |
 * |----------|-------------|------------|---------------------|-----------|
 * | Local Dev | InMemory | InMemory | InMemory | InMemory |
 * | Testing | InMemory | InMemory | InMemory | InMemory |
 * | Single Instance | BullMQ | Cosmos | None (optional) | Azure |
 * | Multi-Instance | BullMQ | Cosmos | Redis | Azure |
 * | Kubernetes | BullMQ | Cosmos | Redis | Azure |
 * 
 * ## Design Principles
 * 
 * 1. **Interface-First**: All adapters implement a well-defined interface
 * 2. **No Silent Fallbacks**: Missing adapters throw errors, not warnings
 * 3. **Fail Fast**: Errors surface immediately, not in production
 * 4. **Minimal Code**: Interfaces define only essential methods
 * 5. **Maximum Flexibility**: Swap implementations without code changes
 */

// Re-export all adapter interfaces
export type { MessageQueue } from './message-queue'
export type { StateStore } from './state-store'
export type { CoordinationAdapter, ActorLock } from './coordination-adapter'
export type { BlobStore } from './blob-store'
export type { ActivityStore } from './activity-store'
export type { LockManager } from './lock-manager'

// Re-export all implementations
export { BullMQMessageQueue } from './bullmq-message-queue'
export { InMemoryMessageQueue } from './in-memory-message-queue'
export { CosmosStateStore } from './cosmos-state-store'
export { InMemoryStateStore } from './in-memory-state-store'
export { RedisCoordinationAdapter } from './redis-coordination-adapter'
export { InMemoryCoordinationAdapter } from './in-memory-coordination-adapter'
export { AzureBlobStore } from './azure-blob-store'
export { InMemoryBlobStore } from './in-memory-blob-store'
export { CosmosActivityStore } from './cosmos-activity-store'
export { InMemoryActivityStore } from './in-memory-activity-store'
export { RedisLockManager } from './redis-lock-manager'
export { InMemoryLockManager } from './in-memory-lock-manager'
