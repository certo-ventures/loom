/**
 * Cosmos DB Memory Storage
 * 
 * Unified persistence layer for memory graph using the same
 * Cosmos DB infrastructure as config and secrets
 */

import type { Container } from '@azure/cosmos'
import type {
  MemoryStorage,
  Episode,
  Entity,
  Fact,
  MemoryQuery,
} from './types'

export interface CosmosMemoryStorageOptions {
  /** Cosmos DB container for memory graph */
  container: Container
  
  /** Partition strategy: 'actorId' | 'graphId' */
  partitionBy?: 'actorId' | 'graphId'
}

type MemoryDocument = EpisodeDocument | EntityDocument | FactDocument

interface BaseDocument {
  id: string
  partitionKey: string
  type: 'episode' | 'entity' | 'fact'
  actorId: string
  graph_id: string
  created_at: string
  sequence: number
}

interface EpisodeDocument extends BaseDocument {
  type: 'episode'
  content: string
  source: 'message' | 'json' | 'text'
  embedding?: number[]
  embedding_ref?: string
}

interface EntityDocument extends BaseDocument {
  type: 'entity'
  name: string
  entityType: string
  summary?: string
  summary_embedding?: number[]
}

interface FactDocument extends BaseDocument {
  type: 'fact'
  sourceEntityId: string
  targetEntityId: string
  relation: string
  text: string
  lamport_ts: number
  validFrom: string
  validUntil?: string
  episodeIds: string[]
  source: 'user_input' | 'auto_extracted' | 'imported'
  confidence?: number
  embedding?: number[]
  embedding_ref?: string
}

/**
 * Cosmos DB-backed memory storage
 */
export class CosmosMemoryStorage implements MemoryStorage {
  private container: Container
  private partitionBy: 'actorId' | 'graphId'

  constructor(options: CosmosMemoryStorageOptions) {
    this.container = options.container
    this.partitionBy = options.partitionBy || 'actorId'
  }

  // ========================================================================
  // Episodes
  // ========================================================================

  async addEpisode(episode: Episode): Promise<void> {
    const doc: EpisodeDocument = {
      id: episode.id,
      partitionKey: this.getPartitionKey(episode.actorId, episode.graph_id),
      type: 'episode',
      actorId: episode.actorId,
      graph_id: episode.graph_id,
      content: episode.content,
      source: episode.source,
      sequence: episode.sequence,
      created_at: episode.created_at.toISOString(),
      embedding: episode.embedding,
      embedding_ref: episode.embedding_ref,
    }

    await this.container.items.create(doc)
  }

  async getEpisodes(actorId: string, graph_id: string, limit = 100): Promise<Episode[]> {
    const query = {
      query: `
        SELECT * FROM c
        WHERE c.actorId = @actorId
          AND c.graph_id = @graph_id
          AND c.type = 'episode'
        ORDER BY c.sequence DESC
        OFFSET 0 LIMIT @limit
      `,
      parameters: [
        { name: '@actorId', value: actorId },
        { name: '@graph_id', value: graph_id },
        { name: '@limit', value: limit },
      ],
    }

    const { resources } = await this.container.items
      .query<EpisodeDocument>(query, {
        partitionKey: this.getPartitionKey(actorId, graph_id),
      })
      .fetchAll()

    return resources.map(this.toEpisode)
  }

  // ========================================================================
  // Entities
  // ========================================================================

  async addEntity(entity: Entity): Promise<void> {
    const doc: EntityDocument = {
      id: entity.id,
      partitionKey: this.getPartitionKey(entity.actorId, entity.graph_id),
      type: 'entity',
      actorId: entity.actorId,
      graph_id: entity.graph_id,
      name: entity.name,
      entityType: entity.type,
      summary: entity.summary,
      sequence: entity.sequence,
      created_at: entity.created_at.toISOString(),
      summary_embedding: entity.summary_embedding,
    }

    await this.container.items.create(doc)
  }

  async getEntity(id: string, graph_id: string): Promise<Entity | null> {
    // Need to query since we don't know actorId
    const query = {
      query: `
        SELECT * FROM c
        WHERE c.id = @id
          AND c.graph_id = @graph_id
          AND c.type = 'entity'
      `,
      parameters: [
        { name: '@id', value: id },
        { name: '@graph_id', value: graph_id },
      ],
    }

    const { resources } = await this.container.items.query<EntityDocument>(query).fetchAll()

    return resources.length > 0 ? this.toEntity(resources[0]) : null
  }

  async getEntities(actorId: string, graph_id: string): Promise<Entity[]> {
    const query = {
      query: `
        SELECT * FROM c
        WHERE c.actorId = @actorId
          AND c.graph_id = @graph_id
          AND c.type = 'entity'
        ORDER BY c.sequence DESC
      `,
      parameters: [
        { name: '@actorId', value: actorId },
        { name: '@graph_id', value: graph_id },
      ],
    }

    const { resources } = await this.container.items
      .query<EntityDocument>(query, {
        partitionKey: this.getPartitionKey(actorId, graph_id),
      })
      .fetchAll()

    return resources.map(this.toEntity)
  }

  // ========================================================================
  // Facts
  // ========================================================================

  async addFact(fact: Fact): Promise<void> {
    const doc: FactDocument = {
      id: fact.id,
      partitionKey: this.getPartitionKey(fact.actorId, fact.graph_id),
      type: 'fact',
      actorId: fact.actorId,
      graph_id: fact.graph_id,
      sourceEntityId: fact.sourceEntityId,
      targetEntityId: fact.targetEntityId,
      relation: fact.relation,
      text: fact.text,
      sequence: 0, // Facts don't use sequence
      created_at: fact.created_at.toISOString(),
      lamport_ts: fact.lamport_ts,
      validFrom: fact.validFrom.toISOString(),
      validUntil: fact.validUntil?.toISOString(),
      episodeIds: fact.episodeIds,
      source: fact.source as any,
      confidence: fact.confidence,
      embedding: fact.embedding,
      embedding_ref: fact.embedding_ref,
    }

    await this.container.items.create(doc)
  }

  async getFact(id: string, graph_id: string): Promise<Fact | null> {
    // Need to query since we don't know actorId
    const query = {
      query: `
        SELECT * FROM c
        WHERE c.id = @id
          AND c.graph_id = @graph_id
          AND c.type = 'fact'
      `,
      parameters: [
        { name: '@id', value: id },
        { name: '@graph_id', value: graph_id },
      ],
    }

    const { resources } = await this.container.items.query<FactDocument>(query).fetchAll()

    return resources.length > 0 ? this.toFact(resources[0]) : null
  }

  async getFactsBetween(
    sourceEntityId: string,
    targetEntityId: string,
    graph_id: string
  ): Promise<Fact[]> {
    const query = {
      query: `
        SELECT * FROM c
        WHERE c.graph_id = @graph_id
          AND c.type = 'fact'
          AND (
            (c.sourceEntityId = @sourceId AND c.targetEntityId = @targetId)
            OR (c.sourceEntityId = @targetId AND c.targetEntityId = @sourceId)
          )
        ORDER BY c.lamport_ts DESC
      `,
      parameters: [
        { name: '@graph_id', value: graph_id },
        { name: '@sourceId', value: sourceEntityId },
        { name: '@targetId', value: targetEntityId },
      ],
    }

    const { resources } = await this.container.items.query<FactDocument>(query).fetchAll()

    return resources.map(this.toFact)
  }

  async getFactsForEntity(entityId: string, graph_id: string): Promise<Fact[]> {
    const query = {
      query: `
        SELECT * FROM c
        WHERE c.graph_id = @graph_id
          AND c.type = 'fact'
          AND (c.sourceEntityId = @entityId OR c.targetEntityId = @entityId)
        ORDER BY c.lamport_ts DESC
      `,
      parameters: [
        { name: '@graph_id', value: graph_id },
        { name: '@entityId', value: entityId },
      ],
    }

    const { resources } = await this.container.items.query<FactDocument>(query).fetchAll()

    return resources.map(this.toFact)
  }

  async searchFacts(query: MemoryQuery): Promise<Fact[]> {
    const { actorId, graph_id, text, asOf, limit = 100 } = query

    // Build query dynamically
    let sql = `
      SELECT * FROM c
      WHERE c.type = 'fact'
        AND c.actorId = @actorId
    `
    const parameters: any[] = [{ name: '@actorId', value: actorId }]

    if (graph_id) {
      sql += ' AND c.graph_id = @graph_id'
      parameters.push({ name: '@graph_id', value: graph_id })
    }

    if (text) {
      sql += ' AND CONTAINS(c.text, @text)'
      parameters.push({ name: '@text', value: text })
    }

    if (asOf) {
      sql += ' AND c.validFrom <= @asOf AND (NOT IS_DEFINED(c.validUntil) OR c.validUntil > @asOf)'
      parameters.push({ name: '@asOf', value: asOf.toISOString() })
    }

    sql += ' ORDER BY c.lamport_ts DESC'
    sql += ' OFFSET 0 LIMIT @limit'
    parameters.push({ name: '@limit', value: limit })

    const { resources } = await this.container.items
      .query<FactDocument>({ query: sql, parameters })
      .fetchAll()

    return resources.map(this.toFact)
  }

  // ========================================================================
  // Helper Methods
  // ========================================================================

  private getPartitionKey(actorId: string, graph_id: string): string {
    return this.partitionBy === 'actorId' ? actorId : graph_id
  }

  private toEpisode(doc: EpisodeDocument): Episode {
    return {
      id: doc.id,
      content: doc.content,
      source: doc.source,
      sequence: doc.sequence,
      created_at: new Date(doc.created_at),
      actorId: doc.actorId,
      graph_id: doc.graph_id,
      embedding: doc.embedding,
      embedding_ref: doc.embedding_ref,
    }
  }

  private toEntity(doc: EntityDocument): Entity {
    return {
      id: doc.id,
      name: doc.name,
      type: doc.entityType,
      summary: doc.summary,
      sequence: doc.sequence,
      created_at: new Date(doc.created_at),
      actorId: doc.actorId,
      graph_id: doc.graph_id,
      summary_embedding: doc.summary_embedding,
    }
  }

  private toFact(doc: FactDocument): Fact {
    return {
      id: doc.id,
      sourceEntityId: doc.sourceEntityId,
      targetEntityId: doc.targetEntityId,
      relation: doc.relation,
      text: doc.text,
      created_at: new Date(doc.created_at),
      lamport_ts: doc.lamport_ts,
      validFrom: new Date(doc.validFrom),
      validUntil: doc.validUntil ? new Date(doc.validUntil) : undefined,
      episodeIds: doc.episodeIds,
      source: doc.source,
      confidence: doc.confidence,
      actorId: doc.actorId,
      graph_id: doc.graph_id,
      embedding: doc.embedding,
      embedding_ref: doc.embedding_ref,
    }
  }

  /**
   * Bulk insert episodes (more efficient)
   */
  async getValidFacts(actorId: string, graph_id: string, asOf?: Date): Promise<Fact[]> {
    return this.searchFacts({ actorId, graph_id, asOf })
  }

  async close(): Promise<void> {
    // No-op for Cosmos - connections managed by client
  }

  async bulkAddEpisodes(episodes: Episode[]): Promise<void> {
    const operations = episodes.map(episode => ({
      operationType: 'Create' as const,
      resourceBody: {
        id: episode.id,
        partitionKey: this.getPartitionKey(episode.actorId, episode.graph_id),
        type: 'episode',
        actorId: episode.actorId,
        graph_id: episode.graph_id,
        content: episode.content,
        source: episode.source,
        sequence: episode.sequence,
        created_at: episode.created_at.toISOString(),
        embedding: episode.embedding || null,
        embedding_ref: episode.embedding_ref || null,
      },
    }))

    // Cosmos bulk operations support up to 100 items
    for (let i = 0; i < operations.length; i += 100) {
      const batch = operations.slice(i, i + 100)
      await this.container.items.bulk(batch as any)
    }
  }
}
