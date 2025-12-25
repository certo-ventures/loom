/**
 * Cosmos Adapter - Query helper for Cosmos DB with Managed Identity
 * 
 * Provides SQL query capabilities using DefaultAzureCredential
 */

import { CosmosClient, type Container } from '@azure/cosmos'
import type { TokenCredential } from '@azure/identity'

interface CosmosAdapterConfig {
  endpoint: string
  credential: TokenCredential
  database: string
}

interface QueryFragment {
  where: string
  params: Array<{ name: string; value: any }>
}

interface QueryOptions {
  limit?: number
  continuationToken?: string
}

interface QueryResult {
  items: any[]
  continuationToken?: string
}

/**
 * Cosmos Adapter for executing SQL queries with Managed Identity
 */
export class CosmosAdapter {
  private client: CosmosClient
  private databaseId: string

  constructor(config: CosmosAdapterConfig) {
    this.client = new CosmosClient({
      endpoint: config.endpoint,
      aadCredentials: config.credential,
    })
    this.databaseId = config.database
  }

  /**
   * Execute a SQL query against a container
   */
  async queryWithSql(
    containerName: string,
    partitionKey: string,
    fragment: QueryFragment,
    options: QueryOptions = {}
  ): Promise<QueryResult> {
    const database = this.client.database(this.databaseId)
    const container = database.container(containerName)

    // Build query
    const query = `SELECT * FROM c WHERE ${fragment.where}`
    
    const querySpec = {
      query,
      parameters: fragment.params,
    }

    // Execute query
    const queryIterator = container.items.query(querySpec, {
      maxItemCount: options.limit || 100,
      continuationToken: options.continuationToken,
      partitionKey: partitionKey || undefined,
    })

    const { resources, continuationToken } = await queryIterator.fetchNext()

    return {
      items: resources,
      continuationToken,
    }
  }
}
