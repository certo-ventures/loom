/**
 * LoomMesh Service Module
 * 
 * Distributed state synchronization service using GUN library.
 * Provides shared state across Loom nodes with P2P sync.
 */

export { LoomMeshService } from './loommesh-service.js'
export { LoomMeshStateStore } from './state-store.js'
export type {
  LoomMeshConfig,
  StorageConfig,
  PeerConfig,
  WebSocketConfig,
  ConfigLoaderOptions
} from './config.js'
export {
  AzureConfig,
  validateConfig,
  applyDefaults,
  loadLoomMeshConfig,
  saveLoomMeshConfig
} from './config.js'
export type { LoomMeshMetrics } from './metrics.js'
export type {
  ActorState,
  StateQueryOptions,
  IStateStore
} from './state-store.js'
export {
  SyncLatencyTracker,
  PrometheusMetricsFormatter,
  OperationCounter
} from './metrics.js'
