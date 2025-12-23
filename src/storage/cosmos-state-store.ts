import { CosmosClient, Database, Container } from '@azure/cosmos'
import type { StateStore } from './state-store'
import type { ActorState, TraceContext } from '../types'
import { TraceWriter } from '../observability/tracer'

/**
 * CosmosDB StateStore - Production-ready actor state persistence
 */
export class CosmosStateStore implements StateStore {
  private container!: Container
  private tracer?: TraceWriter

  constructor(
    private client: CosmosClient,
    private databaseId: string,
    private containerId: string,
    tracer?: TraceWriter
  ) {
    this.tracer = tracer
  }

  /**
   * Initialize - create database and container if needed
   */
  async initialize(): Promise<void> {
    const { database } = await this.client.databases.createIfNotExists({
      id: this.databaseId,
    })

    const { container } = await database.containers.createIfNotExists({
      id: this.containerId,
      partitionKey: { paths: ['/partitionKey'] },
    })

    this.container = container
  }

  async save(actorId: string, state: ActorState, trace?: TraceContext): Promise<void> {
    const response = await this.container.items.upsert(state)
    
    // Emit trace event with reference to document
    if (this.tracer && trace) {
      await this.tracer.emit({
        trace_id: trace.trace_id,
        span_id: TraceWriter.generateId(),
        parent_span_id: trace.span_id,
        event_type: 'cosmosdb:write',
        timestamp: new Date().toISOString(),
        refs: {
          document: {
            container: this.containerId,
            id: state.id,
            partition_key: state.partitionKey
          }
        },
        metadata: {
          operation: 'upsert',
          actor_type: state.actorType,
          ru_consumed: response.requestCharge
        }
      }).catch(() => {}) // Silent failure
    }
  }

  async load(actorId: string): Promise<ActorState | null> {
    try {
      const { resource } = await this.container.item(actorId, actorId).read<ActorState>()
      return resource || null
    } catch (error: any) {
      if (error.code === 404) {
        return null
      }
      throw error
    }
  }

  async delete(actorId: string): Promise<void> {
    try {
      await this.container.item(actorId, actorId).delete()
    } catch (error: any) {
      if (error.code === 404) {
        return // Already deleted
      }
      throw error
    }
  }

  async query(actorType: string, limit?: number): Promise<ActorState[]> {
    const querySpec = {
      query: 'SELECT * FROM c WHERE c.actorType = @actorType',
      parameters: [{ name: '@actorType', value: actorType }],
    }

    const { resources } = await this.container.items
      .query<ActorState>(querySpec, {
        maxItemCount: limit,
      })
      .fetchAll()

    return resources
  }
}
