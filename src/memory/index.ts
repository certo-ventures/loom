/**
 * Memory Layer Exports
 */

export { SemanticMemoryService } from './semantic-memory-service.js'
export { EmbeddingService } from './embedding-service.js'
export { CosmosMemoryAdapter } from './memory-adapter.js'
export { MemoryFactory } from './factory.js'
export type { MemoryAdapter } from './memory-adapter.js'
export type { 
  MemoryItem, 
  SearchOptions, 
  AddMemoryOptions,
  CachedResult 
} from './types.js'

// Re-export memory graph storage
export * from './graph'

// Re-export memory helpers for convenience
export { createMemoryHelpers } from '../actor/memory-helpers.js'
export type { MemoryHelpers, MemoryContext } from '../actor/memory-helpers.js'
