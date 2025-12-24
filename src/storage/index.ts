// Adapter Pattern - Pluggable Infrastructure
// See adapters.ts for comprehensive documentation
export * from './adapters'
export * from './adapter-factory'

// Individual exports for tree-shaking
export * from './state-store'
export * from './message-queue'
export * from './blob-store'
export * from './lock-manager'
export * from './activity-store'
export * from './coordination-adapter'
export * from './idempotency-store'

// Implementations
export * from './bullmq-message-queue'
export * from './redis-lock-manager'
export * from './redis-coordination-adapter'
export * from './redis-idempotency-store'
export * from './cosmos-state-store'
export * from './cosmos-activity-store'
export * from './cosmosdb-actor-registry'
export * from './cosmosdb-idempotency-store'
export * from './in-memory-activity-store'
export * from './in-memory-blob-store'
export * from './in-memory-coordination-adapter'
export * from './in-memory-idempotency-store'
export * from './azure-blob-store'
