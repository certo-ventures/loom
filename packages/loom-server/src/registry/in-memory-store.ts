/**
 * In-Memory Data Store - For development and testing
 */

import type { DataStore } from './data-store';
import type { ActorMetadata, ActorFilter, ExecutionResult } from '../types';

export class InMemoryDataStore implements DataStore {
  private actors = new Map<string, ActorMetadata>();
  private wasmModules = new Map<string, Buffer>();
  private actorStates = new Map<string, any>();
  private executionResults = new Map<string, ExecutionResult>();

  // Actor metadata
  async saveActorMetadata(metadata: ActorMetadata): Promise<void> {
    const key = `${metadata.actorId}:${metadata.version}`;
    this.actors.set(key, metadata);
  }

  async getActorMetadata(actorId: string, version?: string): Promise<ActorMetadata | null> {
    if (version) {
      return this.actors.get(`${actorId}:${version}`) || null;
    }
    
    // Get latest version
    const versions = Array.from(this.actors.values())
      .filter(m => m.actorId === actorId)
      .sort((a, b) => b.version.localeCompare(a.version));
    
    return versions[0] || null;
  }

  async listActors(filter?: ActorFilter): Promise<ActorMetadata[]> {
    let actors = Array.from(this.actors.values());
    
    if (filter?.tenantId) {
      actors = actors.filter(a => a.tenantId === filter.tenantId);
    }
    
    if (filter?.tags && filter.tags.length > 0) {
      actors = actors.filter(a => 
        filter.tags!.some(tag => a.tags?.includes(tag))
      );
    }
    
    if (filter?.public !== undefined) {
      actors = actors.filter(a => a.public === filter.public);
    }
    
    if (filter?.search) {
      const search = filter.search.toLowerCase();
      actors = actors.filter(a => 
        a.displayName.toLowerCase().includes(search) ||
        a.description?.toLowerCase().includes(search)
      );
    }
    
    return actors;
  }

  async deleteActorMetadata(actorId: string, version: string): Promise<void> {
    this.actors.delete(`${actorId}:${version}`);
  }

  // WASM modules
  async saveWasmModule(actorId: string, version: string, wasm: Buffer): Promise<void> {
    this.wasmModules.set(`${actorId}:${version}`, wasm);
  }

  async getWasmModule(actorId: string, version: string): Promise<Buffer | null> {
    return this.wasmModules.get(`${actorId}:${version}`) || null;
  }

  // Actor state
  async saveActorState(actorId: string, state: any): Promise<void> {
    this.actorStates.set(actorId, state);
  }

  async getActorState(actorId: string): Promise<any | null> {
    return this.actorStates.get(actorId) || null;
  }

  // Execution results
  async saveExecutionResult(executionId: string, result: ExecutionResult): Promise<void> {
    this.executionResults.set(executionId, result);
  }

  async getExecutionResult(executionId: string): Promise<ExecutionResult | null> {
    return this.executionResults.get(executionId) || null;
  }
}
