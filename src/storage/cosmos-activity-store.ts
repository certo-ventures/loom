import { CosmosClient, Container } from '@azure/cosmos'
import type { ActivityStore } from './activity-store'
import type { ActivityDefinition } from '../activities/wasm-executor'

/**
 * CosmosDB implementation of ActivityStore
 * 
 * Stores activity definitions in Cosmos with partition key: activityName
 * Document structure:
 * {
 *   id: "activity-name@version",
 *   partitionKey: "activity-name",
 *   ...ActivityDefinition
 * }
 */
export class CosmosActivityStore implements ActivityStore {
  private container: Container | null = null

  constructor(
    private cosmosClient: CosmosClient,
    private databaseId: string = 'loom',
    private containerId: string = 'activities'
  ) {}

  /**
   * Initialize database and container
   */
  async initialize(): Promise<void> {
    const { database } = await this.cosmosClient.databases.createIfNotExists({
      id: this.databaseId,
    })

    const { container } = await database.containers.createIfNotExists({
      id: this.containerId,
      partitionKey: '/partitionKey',
    })

    this.container = container
  }

  private ensureInitialized(): Container {
    if (!this.container) {
      throw new Error('CosmosActivityStore not initialized. Call initialize() first.')
    }
    return this.container
  }

  async save(definition: ActivityDefinition): Promise<void> {
    const container = this.ensureInitialized()

    const doc = {
      id: this.makeId(definition.name, definition.version),
      partitionKey: definition.name,
      ...definition,
      updatedAt: new Date().toISOString(),
    }

    await container.items.upsert(doc)
  }

  async resolve(name: string, version?: string): Promise<ActivityDefinition> {
    const container = this.ensureInitialized()

    // If version specified, try exact match
    if (version) {
      try {
        const { resource } = await container.item(
          this.makeId(name, version),
          name
        ).read()

        if (!resource) {
          throw new Error(`Activity ${name}@${version} not found`)
        }

        return this.toActivityDefinition(resource)
      } catch (error: any) {
        if (error.code === 404) {
          throw new Error(`Activity ${name}@${version} not found`)
        }
        throw error
      }
    }

    // No version specified - find latest
    const query = {
      query: 'SELECT * FROM c WHERE c.partitionKey = @name ORDER BY c.version DESC',
      parameters: [{ name: '@name', value: name }],
    }

    const { resources } = await container.items.query(query).fetchAll()

    if (resources.length === 0) {
      throw new Error(`Activity ${name} not found`)
    }

    return this.toActivityDefinition(resources[0])
  }

  async list(): Promise<ActivityDefinition[]> {
    const container = this.ensureInitialized()

    const { resources } = await container.items
      .query('SELECT * FROM c')
      .fetchAll()

    return resources.map(r => this.toActivityDefinition(r))
  }

  async delete(name: string, version: string): Promise<void> {
    const container = this.ensureInitialized()

    try {
      await container.item(this.makeId(name, version), name).delete()
    } catch (error: any) {
      if (error.code === 404) {
        // Already deleted, that's fine
        return
      }
      throw error
    }
  }

  async exists(name: string, version?: string): Promise<boolean> {
    try {
      await this.resolve(name, version)
      return true
    } catch {
      return false
    }
  }

  private makeId(name: string, version: string): string {
    return `${name}@${version}`
  }

  private toActivityDefinition(doc: any): ActivityDefinition {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, partitionKey, updatedAt, ...definition } = doc
    return definition as ActivityDefinition
  }
}
