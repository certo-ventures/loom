/**
 * CosmosDB Data Store - For production
 */

import { CosmosClient, type Container } from '@azure/cosmos';
import type { DataStore } from './data-store';
import type { ActorMetadata, ActorFilter, ExecutionResult } from '../types';

export class CosmosDataStore implements DataStore {
  private actorsContainer: Container;
  private wasmContainer: Container;
  private stateContainer: Container;
  private resultsContainer: Container;

  constructor(endpoint: string, key: string, database: string = 'loom') {
    const client = new CosmosClient({ endpoint, key });
    const db = client.database(database);
    
    this.actorsContainer = db.container('actors');
    this.wasmContainer = db.container('wasm');
    this.stateContainer = db.container('state');
    this.resultsContainer = db.container('results');
  }

  // Actor metadata
  async saveActorMetadata(metadata: ActorMetadata): Promise<void> {
    await this.actorsContainer.items.upsert({
      id: `${metadata.actorId}:${metadata.version}`,
      ...metadata,
    });
  }

  async getActorMetadata(actorId: string, version?: string): Promise<ActorMetadata | null> {
    if (version) {
      try {
        const { resource } = await this.actorsContainer.item(`${actorId}:${version}`, actorId).read();
        return resource || null;
      } catch {
        return null;
      }
    }
    
    // Get latest version
    const query = `
      SELECT * FROM c 
      WHERE c.actorId = @actorId 
      ORDER BY c.version DESC 
      OFFSET 0 LIMIT 1
    `;
    
    const { resources } = await this.actorsContainer.items
      .query({ query, parameters: [{ name: '@actorId', value: actorId }] })
      .fetchAll();
    
    return resources[0] || null;
  }

  async listActors(filter?: ActorFilter): Promise<ActorMetadata[]> {
    let query = 'SELECT * FROM c WHERE 1=1';
    const parameters: any[] = [];
    
    if (filter?.tenantId) {
      query += ' AND c.tenantId = @tenantId';
      parameters.push({ name: '@tenantId', value: filter.tenantId });
    }
    
    if (filter?.tags && filter.tags.length > 0) {
      query += ' AND ARRAY_CONTAINS(@tags, c.tags)';
      parameters.push({ name: '@tags', value: filter.tags });
    }
    
    if (filter?.public !== undefined) {
      query += ' AND c.public = @public';
      parameters.push({ name: '@public', value: filter.public });
    }
    
    if (filter?.search) {
      query += ' AND (CONTAINS(LOWER(c.displayName), LOWER(@search)) OR CONTAINS(LOWER(c.description), LOWER(@search)))';
      parameters.push({ name: '@search', value: filter.search });
    }
    
    const { resources } = await this.actorsContainer.items
      .query({ query, parameters })
      .fetchAll();
    
    return resources;
  }

  async deleteActorMetadata(actorId: string, version: string): Promise<void> {
    await this.actorsContainer.item(`${actorId}:${version}`, actorId).delete();
  }

  // WASM modules
  async saveWasmModule(actorId: string, version: string, wasm: Buffer): Promise<void> {
    await this.wasmContainer.items.upsert({
      id: `${actorId}:${version}`,
      actorId,
      version,
      wasm: wasm.toString('base64'),
      size: wasm.length,
    });
  }

  async getWasmModule(actorId: string, version: string): Promise<Buffer | null> {
    try {
      const { resource } = await this.wasmContainer.item(`${actorId}:${version}`, actorId).read();
      if (!resource?.wasm) return null;
      return Buffer.from(resource.wasm, 'base64');
    } catch {
      return null;
    }
  }

  // Actor state
  async saveActorState(actorId: string, state: any): Promise<void> {
    await this.stateContainer.items.upsert({
      id: actorId,
      state,
      updatedAt: new Date().toISOString(),
    });
  }

  async getActorState(actorId: string): Promise<any | null> {
    try {
      const { resource } = await this.stateContainer.item(actorId, actorId).read();
      return resource?.state || null;
    } catch {
      return null;
    }
  }

  // Execution results
  async saveExecutionResult(executionId: string, result: ExecutionResult): Promise<void> {
    await this.resultsContainer.items.upsert({
      id: executionId,
      ...result,
    });
  }

  async getExecutionResult(executionId: string): Promise<ExecutionResult | null> {
    try {
      const { resource } = await this.resultsContainer.item(executionId, executionId).read();
      return resource || null;
    } catch {
      return null;
    }
  }
}
