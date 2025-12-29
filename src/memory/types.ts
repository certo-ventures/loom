/**
 * Memory Layer Types
 * Minimal interfaces for semantic memory storage
 */

export interface MemoryItem {
  id: string
  tenantId: string
  threadId: string
  turnIndex: number
  memory: string
  content: string
  embedding: number[]
  timestamp: string
  memoryType: 'short-term' | 'long-term' | 'semantic-cache'
  category?: string
  ttl?: number
  metadata?: Record<string, any>
}

export interface SearchOptions {
  tenantId: string
  threadId?: string
  category?: string
  limit?: number
}

export interface AddMemoryOptions {
  skipEmbedding?: boolean
  skipDeduplication?: boolean
  deduplicationThreshold?: number
}

export interface CachedResult {
  id: string
  query: string
  response: any
  timestamp: string
  age: number
  metadata?: Record<string, any>
}
