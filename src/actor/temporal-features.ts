/**
 * Temporal-Inspired Features for Loom
 * 
 * Minimal implementation of powerful patterns from Temporal:
 * - Signal/Query: Async updates + sync reads
 * - Continue-as-New: Journal compaction for long-lived actors
 * - Versioning: Safe code deployments
 * - Child Actors: Hierarchical supervision
 * - Search Attributes: Actor querying
 * - Async Tasks: External completion
 */

// ============================================================================
// 1. SIGNAL/QUERY PATTERN (No Decorators - Plain TypeScript)
// ============================================================================

export interface SignalMetadata {
  name: string
  method: string
}

export interface QueryMetadata {
  name: string
  method: string
}

/**
 * Declare signals in your actor class as a static property:
 * 
 * static signals = {
 *   approve: 'approveOrder',
 *   cancel: 'cancelOrder'
 * }
 */
export type SignalRegistry = Record<string, string>

/**
 * Declare queries in your actor class as a static property:
 * 
 * static queries = {
 *   getStatus: 'getOrderStatus',
 *   canApprove: 'canApprove'
 * }
 */
export type QueryRegistry = Record<string, string>

// ============================================================================
// 2. CONTINUE-AS-NEW
// ============================================================================

export interface ContinueAsNewOptions {
  archiveJournal?: boolean // Default: true
  resetCounters?: boolean // Default: true
  preserveState?: boolean // Default: true (only reset journal)
}

export interface ContinueAsNewResult {
  newActorId?: string
  archivedEntries: number
  compactedAt: number
}

// ============================================================================
// 3. ACTOR VERSIONING
// ============================================================================

export interface ActorVersionInfo {
  version: number
  previousVersion?: number
  migratedAt?: number
}

export interface MigrationContext {
  fromVersion: number
  toVersion: number
  state: Record<string, unknown>
  journal: any
}

export type MigrationFn = (ctx: MigrationContext) => Promise<Record<string, unknown>> | Record<string, unknown>

// ============================================================================
// 4. CHILD ACTORS
// ============================================================================

export interface ChildActorOptions {
  actorId: string
  input: any
  restartPolicy?: 'never' | 'on-failure' | 'always'
  maxRestarts?: number
  restartDelay?: number
  timeout?: number
}

export interface ChildActorHandle {
  actorId: string
  parentActorId: string
  status: 'running' | 'completed' | 'failed'
  result?: any
  error?: any
  startedAt: number
  completedAt?: number
}

export interface SupervisionStrategy {
  restartPolicy: 'never' | 'on-failure' | 'always'
  maxRestarts: number
  restartDelay: number
}

// ============================================================================
// 5. SEARCH ATTRIBUTES
// ============================================================================

export type SearchAttributeType = 'string' | 'number' | 'boolean' | 'datetime' | 'keyword'

export interface SearchAttributeDefinition {
  [key: string]: SearchAttributeType
}

export interface SearchQuery {
  type?: string // Actor type filter
  query?: string // Query string (e.g., "status = 'active' AND amount > 100")
  attributes?: Record<string, any> // Key-value filters
  limit?: number
  offset?: number
}

export interface SearchResult {
  actorId: string
  type: string
  attributes: Record<string, any>
  updatedAt: number
}

// ============================================================================
// 6. ASYNC TASK COMPLETION
// ============================================================================

export interface AsyncTask {
  taskToken: string
  actorId: string
  type: string
  createdAt: number
  expiresAt: number
  data: any
  status: 'pending' | 'completed' | 'cancelled' | 'expired'
}

export interface AsyncTaskOptions {
  type: string
  data?: any
  timeout?: number // Default: 86400000 (24 hours)
}

export interface AsyncTaskResult {
  taskToken: string
  result: any
  completedAt: number
}

// ============================================================================
// 7. HELPER TYPES
// ============================================================================

export interface SignalRequest {
  actorId: string
  signalName: string
  args: any[]
}

export interface QueryRequest {
  actorId: string
  queryName: string
  args: any[]
}

export interface QueryResponse {
  result: any
  executedAt: number
}
