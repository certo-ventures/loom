/**
 * CosmosDB Actor Registry
 * 
 * Stores actor metadata with versioning, revision history, and querying capabilities.
 * Optimized for:
 * - Version tracking and rollback
 * - Audit trails
 * - Fast discovery queries
 * - Historical analysis
 */

import { CosmosClient, Container, Database } from '@azure/cosmos'
import type { ActorMetadata } from '../discovery/actor-metadata'

/**
 * Actor document stored in CosmosDB
 */
export interface ActorDocument {
  // Partition key: actorType for efficient querying
  id: string // Format: {actorType}:{version}
  actorType: string // Partition key
  
  // Core metadata
  metadata: ActorMetadata
  
  // Versioning
  version: string
  revision: number // Auto-incremented for same version
  previousVersion?: string
  previousRevision?: number
  
  // Audit trail
  registeredBy: string
  registeredAt: string // ISO 8601
  updatedBy?: string
  updatedAt?: string
  
  // Status
  status: 'draft' | 'published' | 'deprecated' | 'retired'
  publishedAt?: string
  deprecatedAt?: string
  retiredAt?: string
  
  // Usage tracking
  usageStats?: {
    totalInvocations: number
    lastInvokedAt?: string
    avgLatencyMs?: number
    successRate?: number
    activeInstances?: number
  }
  
  // Testing & validation
  testResults?: {
    passed: boolean
    testSuite: string
    testedAt: string
    coverage?: number
    failures?: string[]
  }[]
  
  // Deployment
  deployments?: {
    environment: string
    deployedAt: string
    deployedBy: string
    instanceCount: number
    status: 'active' | 'inactive'
  }[]
  
  // Cost tracking
  costMetrics?: {
    period: string // e.g., "2024-12"
    totalCost: number
    currency: string
    invocations: number
    avgCostPerInvocation: number
  }[]
  
  // Compatibility
  compatibleWith?: {
    actorType: string
    versionRange: string // semver range
  }[]
  
  // Schema validation results
  schemaValidation?: {
    inputSchemaValid: boolean
    outputSchemaValid: boolean
    validatedAt: string
    errors?: string[]
  }
  
  // Custom metadata
  custom?: Record<string, any>
  
  // CosmosDB fields
  _etag?: string
  _ts?: number
}

/**
 * Query filters for actor search
 */
export interface ActorQueryFilter {
  actorType?: string
  version?: string
  status?: ActorDocument['status']
  tags?: string[]
  category?: string
  author?: string
  owner?: string
  stage?: 'experimental' | 'beta' | 'stable' | 'deprecated' | 'retired'
  hasCapability?: string
  minSuccessRate?: number
  registeredAfter?: string
  registeredBefore?: string
}

/**
 * Actor registry backed by CosmosDB
 */
export class CosmosDBActorRegistry {
  private client: CosmosClient
  private database: Database
  private container: Container
  
  constructor(
    private endpoint: string,
    private key: string,
    private databaseId: string = 'loom',
    private containerId: string = 'actors'
  ) {
    this.client = new CosmosClient({ endpoint, key })
    this.database = this.client.database(databaseId)
    this.container = this.database.container(containerId)
  }

  /**
   * Initialize database and container with proper indexing
   */
  async initialize(): Promise<void> {
    // Create database if not exists
    await this.client.databases.createIfNotExists({
      id: this.databaseId
    })

    // Create container with optimized indexing
    await this.database.containers.createIfNotExists({
      id: this.containerId,
      partitionKey: {
        paths: ['/actorType'],
        kind: 'Hash' as any  // CosmosDB SDK type issue
      },
      indexingPolicy: {
        automatic: true,
        indexingMode: 'consistent',
        includedPaths: [
          { path: '/*' }
        ],
        excludedPaths: [
          { path: '/metadata/aiContext/examples/*' },
          { path: '/custom/*' }
        ],
        compositeIndexes: [
          [
            { path: '/actorType', order: 'ascending' },
            { path: '/version', order: 'descending' }
          ],
          [
            { path: '/status', order: 'ascending' },
            { path: '/registeredAt', order: 'descending' }
          ],
          [
            { path: '/metadata/tags', order: 'ascending' },
            { path: '/usageStats/totalInvocations', order: 'descending' }
          ]
        ]
      },
      defaultTtl: -1 // No auto-deletion
    })
  }

  /**
   * Register new actor version
   */
  async register(
    metadata: ActorMetadata,
    registeredBy: string,
    status: ActorDocument['status'] = 'draft'
  ): Promise<ActorDocument> {
    const actorType = this.getActorType(metadata)
    
    // Get previous revision for this version
    const existingRevisions = await this.getRevisions(actorType, metadata.version)
    const revision = existingRevisions.length > 0 
      ? Math.max(...existingRevisions.map(r => r.revision)) + 1
      : 1

    // Get previous version for tracking
    const previousVersions = await this.getVersions(actorType)
    const sortedVersions = previousVersions
      .filter(v => v.version !== metadata.version)
      .sort((a, b) => b.revision - a.revision)
    const previousVersion = sortedVersions[0]

    const document: ActorDocument = {
      id: `${actorType}:${metadata.version}:${revision}`,
      actorType,
      metadata,
      version: metadata.version,
      revision,
      previousVersion: previousVersion?.version,
      previousRevision: previousVersion?.revision,
      registeredBy,
      registeredAt: new Date().toISOString(),
      status,
      publishedAt: status === 'published' ? new Date().toISOString() : undefined
    }

    const { resource } = await this.container.items.create(document)
    return resource as ActorDocument
  }

  /**
   * Update existing actor revision
   */
  async update(
    actorType: string,
    version: string,
    revision: number,
    updates: Partial<ActorDocument>,
    updatedBy: string
  ): Promise<ActorDocument> {
    const id = `${actorType}:${version}:${revision}`
    
    const { resource: existing } = await this.container.item(id, actorType).read<ActorDocument>()
    if (!existing) {
      throw new Error(`Actor not found: ${id}`)
    }

    const updated: ActorDocument = {
      ...existing,
      ...updates,
      updatedBy,
      updatedAt: new Date().toISOString()
    }

    const { resource } = await this.container.item(id, actorType).replace(updated)
    return resource as ActorDocument
  }

  /**
   * Publish actor (mark as production-ready)
   */
  async publish(
    actorType: string,
    version: string,
    revision: number,
    publishedBy: string
  ): Promise<ActorDocument> {
    return this.update(actorType, version, revision, {
      status: 'published',
      publishedAt: new Date().toISOString()
    }, publishedBy)
  }

  /**
   * Deprecate actor version
   */
  async deprecate(
    actorType: string,
    version: string,
    revision: number,
    replacedBy: string | undefined,
    deprecatedBy: string
  ): Promise<ActorDocument> {
    // Get existing document to preserve metadata
    const existing = await this.get(actorType, version, revision)
    if (!existing) {
      throw new Error(`Actor not found: ${actorType}:${version}:${revision}`)
    }

    const updates: Partial<ActorDocument> = {
      status: 'deprecated',
      deprecatedAt: new Date().toISOString(),
      metadata: {
        ...existing.metadata,
        lifecycle: {
          ...existing.metadata.lifecycle,
          stage: 'deprecated',
          deprecated: true,
          replacedBy
        }
      }
    }

    return this.update(actorType, version, revision, updates, deprecatedBy)
  }

  /**
   * Get specific actor version
   */
  async get(
    actorType: string,
    version: string,
    revision?: number
  ): Promise<ActorDocument | undefined> {
    if (revision) {
      const id = `${actorType}:${version}:${revision}`
      const { resource } = await this.container.item(id, actorType).read<ActorDocument>()
      return resource
    }

    // Get latest revision for version
    const revisions = await this.getRevisions(actorType, version)
    return revisions.length > 0 ? revisions[0] : undefined
  }

  /**
   * Get latest published version
   */
  async getLatest(actorType: string): Promise<ActorDocument | undefined> {
    const query = `
      SELECT * FROM c 
      WHERE c.actorType = @actorType 
        AND c.status = 'published'
      ORDER BY c.version DESC, c.revision DESC
      OFFSET 0 LIMIT 1
    `

    const { resources } = await this.container.items
      .query<ActorDocument>({
        query,
        parameters: [{ name: '@actorType', value: actorType }]
      })
      .fetchAll()

    return resources[0]
  }

  /**
   * Get all versions of an actor
   */
  async getVersions(actorType: string): Promise<ActorDocument[]> {
    const query = `
      SELECT * FROM c 
      WHERE c.actorType = @actorType
      ORDER BY c.version DESC, c.revision DESC
    `

    const { resources } = await this.container.items
      .query<ActorDocument>({
        query,
        parameters: [{ name: '@actorType', value: actorType }]
      })
      .fetchAll()

    return resources
  }

  /**
   * Get all revisions of a specific version
   */
  async getRevisions(actorType: string, version: string): Promise<ActorDocument[]> {
    const query = `
      SELECT * FROM c 
      WHERE c.actorType = @actorType 
        AND c.version = @version
      ORDER BY c.revision DESC
    `

    const { resources } = await this.container.items
      .query<ActorDocument>({
        query,
        parameters: [
          { name: '@actorType', value: actorType },
          { name: '@version', value: version }
        ]
      })
      .fetchAll()

    return resources
  }

  /**
   * Search actors with filters
   */
  async search(filter: ActorQueryFilter): Promise<ActorDocument[]> {
    let query = 'SELECT * FROM c WHERE 1=1'
    const parameters: any[] = []

    if (filter.actorType) {
      query += ' AND c.actorType = @actorType'
      parameters.push({ name: '@actorType', value: filter.actorType })
    }

    if (filter.version) {
      query += ' AND c.version = @version'
      parameters.push({ name: '@version', value: filter.version })
    }

    if (filter.status) {
      query += ' AND c.status = @status'
      parameters.push({ name: '@status', value: filter.status })
    }

    if (filter.category) {
      query += ' AND c.metadata.category = @category'
      parameters.push({ name: '@category', value: filter.category })
    }

    if (filter.author) {
      query += ' AND c.metadata.author = @author'
      parameters.push({ name: '@author', value: filter.author })
    }

    if (filter.tags && filter.tags.length > 0) {
      query += ' AND ARRAY_CONTAINS(c.metadata.tags, @tag)'
      parameters.push({ name: '@tag', value: filter.tags[0] })
    }

    if (filter.minSuccessRate) {
      query += ' AND c.usageStats.successRate >= @minSuccessRate'
      parameters.push({ name: '@minSuccessRate', value: filter.minSuccessRate })
    }

    query += ' ORDER BY c.registeredAt DESC'

    const { resources } = await this.container.items
      .query<ActorDocument>({ query, parameters })
      .fetchAll()

    return resources
  }

  /**
   * Record usage statistics
   */
  async recordUsage(
    actorType: string,
    version: string,
    revision: number,
    stats: {
      latencyMs: number
      success: boolean
    }
  ): Promise<void> {
    const id = `${actorType}:${version}:${revision}`
    const { resource: doc } = await this.container.item(id, actorType).read<ActorDocument>()
    
    if (!doc) return

    const currentStats = doc.usageStats || {
      totalInvocations: 0,
      avgLatencyMs: 0,
      successRate: 1
    }

    const totalInvocations = currentStats.totalInvocations + 1
    const avgLatencyMs = ((currentStats.avgLatencyMs || 0) * currentStats.totalInvocations + stats.latencyMs) / totalInvocations
    const successRate = ((currentStats.successRate || 1) * currentStats.totalInvocations + (stats.success ? 1 : 0)) / totalInvocations

    doc.usageStats = {
      totalInvocations,
      lastInvokedAt: new Date().toISOString(),
      avgLatencyMs,
      successRate,
      activeInstances: currentStats.activeInstances
    }

    await this.container.item(id, actorType).replace(doc)
  }

  /**
   * Get usage analytics
   */
  async getUsageAnalytics(actorType: string): Promise<{
    totalInvocations: number
    avgLatency: number
    successRate: number
    byVersion: Record<string, number>
  }> {
    const versions = await this.getVersions(actorType)
    
    let totalInvocations = 0
    let totalLatency = 0
    let totalSuccess = 0
    const byVersion: Record<string, number> = {}

    for (const version of versions) {
      if (version.usageStats) {
        totalInvocations += version.usageStats.totalInvocations
        totalLatency += version.usageStats.avgLatencyMs || 0
        totalSuccess += (version.usageStats.successRate || 0) * version.usageStats.totalInvocations
        byVersion[version.version] = version.usageStats.totalInvocations
      }
    }

    return {
      totalInvocations,
      avgLatency: totalInvocations > 0 ? totalLatency / versions.length : 0,
      successRate: totalInvocations > 0 ? totalSuccess / totalInvocations : 0,
      byVersion
    }
  }

  /**
   * Helper: Extract actor type from metadata
   */
  private getActorType(metadata: ActorMetadata): string {
    // Use name normalized as actor type if not explicitly set
    return metadata.name.toLowerCase().replace(/\s+/g, '-')
  }

  /**
   * Delete actor (soft delete by marking as retired)
   */
  async delete(
    actorType: string,
    version: string,
    revision: number,
    deletedBy: string
  ): Promise<void> {
    await this.update(actorType, version, revision, {
      status: 'retired',
      retiredAt: new Date().toISOString()
    }, deletedBy)
  }

  /**
   * Hard delete (permanently remove from database)
   */
  async hardDelete(actorType: string, version: string, revision: number): Promise<void> {
    const id = `${actorType}:${version}:${revision}`
    await this.container.item(id, actorType).delete()
  }
}
