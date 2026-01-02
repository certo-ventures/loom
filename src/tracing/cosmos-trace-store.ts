/**
 * CosmosDB TraceStore - Durable trace persistence with batching
 * 
 * Optimized for Cosmos DB with:
 * - Batch writes to reduce RU consumption
 * - Efficient partition key strategy
 * - Indexed queries for common patterns
 */

import { CosmosClient, Container, FeedOptions } from '@azure/cosmos'
import { DefaultAzureCredential, type TokenCredential } from '@azure/identity'
import type { ActorTrace, TraceQuery, TraceStats } from './types'
import type { TraceStore } from './trace-store'

export interface CosmosTraceStoreConfig {
  endpoint: string
  key?: string // Optional: uses managed identity if not provided
  credential?: TokenCredential // Optional: custom credential
  databaseId: string
  containerId: string
  batchSize?: number
  flushIntervalMs?: number
}

/**
 * CosmosDB-backed trace store with batching
 */
export class CosmosTraceStore implements TraceStore {
  private client: CosmosClient
  private container?: Container
  private batchBuffer: ActorTrace[] = []
  private flushTimer?: NodeJS.Timeout
  private batchSize: number
  private flushIntervalMs: number

  constructor(private config: CosmosTraceStoreConfig) {
    this.batchSize = config.batchSize || 50
    this.flushIntervalMs = config.flushIntervalMs || 5000
    
    // Use managed identity if no key or credential provided
    const credential = config.credential || (!config.key ? new DefaultAzureCredential() : undefined)
    
    this.client = new CosmosClient(
      credential
        ? { endpoint: config.endpoint, aadCredentials: credential }
        : { endpoint: config.endpoint, key: config.key! }
    )
  }

  /**
   * Initialize the container
   */
  async initialize(): Promise<void> {
    const { database } = await this.client.databases.createIfNotExists({
      id: this.config.databaseId,
    })

    const { container } = await database.containers.createIfNotExists({
      id: this.config.containerId,
      partitionKey: '/correlationId', // Partition by correlation ID for efficient queries
      indexingPolicy: {
        indexingMode: 'consistent',
        automatic: true,
        includedPaths: [
          { path: '/*' }
        ],
        excludedPaths: [
          { path: '/data/*' },  // Don't index trace data payloads
          { path: '/error/stack/*' }, // Don't index stack traces
        ],
        compositeIndexes: [
          // Optimize for time-based queries
          [
            { path: '/correlationId', order: 'ascending' },
            { path: '/startTime', order: 'descending' }
          ],
          // Optimize for actor queries
          [
            { path: '/actorId', order: 'ascending' },
            { path: '/startTime', order: 'descending' }
          ],
          // Optimize for operation queries
          [
            { path: '/operation', order: 'ascending' },
            { path: '/startTime', order: 'descending' }
          ],
        ]
      }
    })

    this.container = container

    // Start flush timer
    this.startFlushTimer()
  }

  /**
   * Save a trace (batched)
   */
  async save(trace: ActorTrace): Promise<void> {
    if (!this.container) {
      throw new Error('CosmosTraceStore not initialized. Call initialize() first.')
    }

    // Add to batch buffer
    this.batchBuffer.push(trace)

    // Flush if batch is full
    if (this.batchBuffer.length >= this.batchSize) {
      await this.flush()
    }
  }

  /**
   * Flush pending traces to Cosmos DB
   */
  async flush(): Promise<void> {
    if (this.batchBuffer.length === 0 || !this.container) {
      return
    }

    const tracesToFlush = [...this.batchBuffer]
    this.batchBuffer = []

    try {
      // Use bulk operations for efficiency
      const operations = tracesToFlush.map(trace => ({
        operationType: 'Create' as const,
        resourceBody: {
          id: trace.traceId,
          ...trace,
        }
      }))

      await this.container.items.bulk(operations as any)
    } catch (error) {
      // On error, restore traces to buffer for retry
      this.batchBuffer.unshift(...tracesToFlush)
      throw error
    }
  }

  /**
   * Get a trace by ID
   */
  async get(traceId: string): Promise<ActorTrace | null> {
    if (!this.container) {
      throw new Error('CosmosTraceStore not initialized')
    }

    // Flush pending traces first to ensure consistency
    await this.flush()

    try {
      // Need to query since we don't have the partition key
      const query = {
        query: 'SELECT * FROM c WHERE c.traceId = @traceId',
        parameters: [{ name: '@traceId', value: traceId }]
      }

      const { resources } = await this.container.items.query<ActorTrace>(query).fetchAll()
      return resources.length > 0 ? resources[0] : null
    } catch (error) {
      return null
    }
  }

  /**
   * Query traces
   */
  async query(query: TraceQuery): Promise<ActorTrace[]> {
    if (!this.container) {
      throw new Error('CosmosTraceStore not initialized')
    }

    // Flush pending traces first
    await this.flush()

    const conditions: string[] = []
    const parameters: Array<{ name: string; value: any }> = []

    // Build WHERE clause
    if (query.correlationId) {
      conditions.push('c.correlationId = @correlationId')
      parameters.push({ name: '@correlationId', value: query.correlationId })
    }

    if (query.traceId) {
      conditions.push('c.traceId = @traceId')
      parameters.push({ name: '@traceId', value: query.traceId })
    }

    if (query.actorId) {
      conditions.push('c.actorId = @actorId')
      parameters.push({ name: '@actorId', value: query.actorId })
    }

    if (query.actorType) {
      conditions.push('c.actorType = @actorType')
      parameters.push({ name: '@actorType', value: query.actorType })
    }

    if (query.operation) {
      conditions.push('c.operation = @operation')
      parameters.push({ name: '@operation', value: query.operation })
    }

    if (query.status) {
      conditions.push('c.status = @status')
      parameters.push({ name: '@status', value: query.status })
    }

    if (query.timeRange) {
      conditions.push('c.startTime >= @startTime AND c.startTime <= @endTime')
      parameters.push(
        { name: '@startTime', value: query.timeRange.start.toISOString() },
        { name: '@endTime', value: query.timeRange.end.toISOString() }
      )
    }

    // Build query string
    let queryStr = 'SELECT * FROM c'
    if (conditions.length > 0) {
      queryStr += ' WHERE ' + conditions.join(' AND ')
    }
    queryStr += ' ORDER BY c.startTime DESC'

    const cosmosQuery = {
      query: queryStr,
      parameters,
    }

    // Execute query with options
    const options: FeedOptions = {}
    if (query.limit) {
      options.maxItemCount = query.limit
    }

    const { resources } = await this.container.items.query<ActorTrace>(cosmosQuery, options).fetchAll()
    return resources
  }

  /**
   * Get trace statistics
   */
  async getStats(correlationId?: string): Promise<TraceStats> {
    if (!this.container) {
      throw new Error('CosmosTraceStore not initialized')
    }

    await this.flush()

    let query: any
    const parameters: Array<{ name: string; value: any }> = []

    if (correlationId) {
      query = {
        query: `
          SELECT 
            COUNT(1) as totalTraces,
            SUM(CASE WHEN c.status = 'success' THEN 1 ELSE 0 END) as completedTraces,
            SUM(CASE WHEN c.status = 'failed' THEN 1 ELSE 0 END) as failedTraces,
            SUM(CASE WHEN c.status = 'in-progress' THEN 1 ELSE 0 END) as runningTraces,
            AVG(c.durationMs) as avgDurationMs,
            COUNT(c.events) as totalEvents
          FROM c 
          WHERE c.correlationId = @correlationId
        `,
        parameters: [{ name: '@correlationId', value: correlationId }]
      }
    } else {
      query = {
        query: `
          SELECT 
            COUNT(1) as totalTraces,
            SUM(CASE WHEN c.status = 'success' THEN 1 ELSE 0 END) as completedTraces,
            SUM(CASE WHEN c.status = 'failed' THEN 1 ELSE 0 END) as failedTraces,
            SUM(CASE WHEN c.status = 'in-progress' THEN 1 ELSE 0 END) as runningTraces,
            AVG(c.durationMs) as avgDurationMs,
            COUNT(c.events) as totalEvents
          FROM c
        `,
        parameters: []
      }
    }

    const { resources } = await this.container.items.query(query).fetchAll()
    
    if (resources.length === 0) {
      return {
        totalTraces: 0,
        completed: 0,
        completedTraces: 0,
        failed: 0,
        failedTraces: 0,
        running: 0,
        runningTraces: 0,
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        totalEvents: 0,
      }
    }

    const stats = resources[0]
    return {
      totalTraces: stats.totalTraces || 0,
      completed: stats.completedTraces || 0,
      completedTraces: stats.completedTraces || 0,
      failed: stats.failedTraces || 0,
      failedTraces: stats.failedTraces || 0,
      running: stats.runningTraces || 0,
      runningTraces: stats.runningTraces || 0,
      avgDuration: stats.avgDuration || 0,
      minDuration: stats.minDuration || 0,
      maxDuration: stats.maxDuration || 0,
      totalEvents: stats.totalEvents || 0,
    }
  }

  /**
   * Delete old traces
   */
  async cleanup(olderThan: Date): Promise<number> {
    if (!this.container) {
      throw new Error('CosmosTraceStore not initialized')
    }

    await this.flush()

    const query = {
      query: 'SELECT c.id, c.correlationId FROM c WHERE c.startTime < @olderThan',
      parameters: [{ name: '@olderThan', value: olderThan.toISOString() }]
    }

    const { resources } = await this.container.items.query(query).fetchAll()

    // Delete in batches
    const operations = resources.map(item => ({
      operationType: 'Delete' as const,
      id: item.id,
      partitionKey: item.correlationId,
    }))

    if (operations.length > 0) {
      await this.container.items.bulk(operations)
    }

    return operations.length
  }

  /**
   * Stop the flush timer and flush remaining traces
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = undefined
    }
    await this.flush()
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      try {
        await this.flush()
      } catch (error) {
        console.error('Failed to flush traces:', error)
      }
    }, this.flushIntervalMs)
  }
}
