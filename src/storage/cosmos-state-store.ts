import { CosmosClient, Database, Container } from '@azure/cosmos'
import type { StateStore } from './state-store'
import type { ActorState } from '../types'

/**
 * CosmosDB StateStore - Production-ready actor state persistence
 */
export class CosmosStateStore implements StateStore {
  private container!: Container

  constructor(
    private client: CosmosClient,
    private databaseId: string,
    private containerId: string
  ) {}

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

  async save(actorId: string, state: ActorState): Promise<void> {
    await this.container.items.upsert(state)
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
