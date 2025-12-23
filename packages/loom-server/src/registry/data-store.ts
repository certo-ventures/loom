/**
 * Data Store Interface - Abstract storage layer
 * 
 * Supports both in-memory (dev) and CosmosDB (production)
 */

import type { ActorMetadata, ActorFilter, ExecutionResult } from '../types';

export interface DataStore {
  // Actor metadata (registry)
  saveActorMetadata(metadata: ActorMetadata): Promise<void>;
  getActorMetadata(actorId: string, version?: string): Promise<ActorMetadata | null>;
  listActors(filter?: ActorFilter): Promise<ActorMetadata[]>;
  deleteActorMetadata(actorId: string, version: string): Promise<void>;
  
  // WASM modules (binary storage)
  saveWasmModule(actorId: string, version: string, wasm: Buffer): Promise<void>;
  getWasmModule(actorId: string, version: string): Promise<Buffer | null>;
  
  // Actor state (runtime data)
  saveActorState(actorId: string, state: any): Promise<void>;
  getActorState(actorId: string): Promise<any | null>;
  
  // Execution results
  saveExecutionResult(executionId: string, result: ExecutionResult): Promise<void>;
  getExecutionResult(executionId: string): Promise<ExecutionResult | null>;
}
