import { randomUUID } from 'crypto';
import type { Episode, Entity, Fact, MemoryStorage } from './types';
import type { LamportClock } from '../../timing/lamport-clock';
import { MemoryExtractor } from './extractor';

export interface ActorMemoryOptions {
  graph_id?: string;
  extractor?: MemoryExtractor;  // Optional: enable auto-extraction
}

/**
 * ActorMemory provides a high-level API for actors to work with memory graphs.
 * 
 * Usage:
 *   const clock = new LamportClock();
 *   const memory = new ActorMemory('actor-1', storage, clock);
 *   await memory.addEpisode('User mentioned they like pizza');
 *   await memory.addFact('user-1', 'likes', 'pizza-1', 'User likes pizza');
 *   const facts = await memory.getCurrentFacts();
 */
export class ActorMemory {
  private readonly graph_id: string;
  private episodeSequence: number = 0;
  private entitySequence: number = 0;
  private readonly extractor?: MemoryExtractor;
  private entityCache: Map<string, string> = new Map(); // name -> id

  constructor(
    private readonly actorId: string,
    private readonly storage: MemoryStorage,
    private readonly lamportClock: LamportClock,
    options?: ActorMemoryOptions
  ) {
    this.graph_id = options?.graph_id || 'default';
    this.extractor = options?.extractor;
  }

  /**
   * Add an episode (conversation turn, event, etc.)
   * If extractor is configured, automatically extracts entities/facts
   */
  async addEpisode(content: string, source: 'message' | 'json' | 'text' = 'message'): Promise<string> {
    const episode: Episode = {
      id: randomUUID(),
      content,
      source,
      sequence: ++this.episodeSequence,
      created_at: new Date(),
      actorId: this.actorId,
      graph_id: this.graph_id
    };

    await this.storage.addEpisode(episode);

    // Auto-extract if extractor configured
    if (this.extractor) {
      await this.extractAndStore(content, episode.id);
    }

    return episode.id;
  }

  /**
   * Extract entities and facts from text and store them
   */
  private async extractAndStore(text: string, episodeId: string): Promise<void> {
    try {
      const extracted = await this.extractor!.extract(text);

      // Add entities and build name->id mapping
      for (const entity of extracted.entities) {
        // Check if entity already exists
        if (!this.entityCache.has(entity.name)) {
          const entityId = await this.addEntity(entity.name, entity.type, entity.summary);
          this.entityCache.set(entity.name, entityId);
        }
      }

      // Add facts
      for (const fact of extracted.facts) {
        const sourceId = this.entityCache.get(fact.sourceEntity);
        const targetId = this.entityCache.get(fact.targetEntity);

        if (sourceId && targetId) {
          await this.addFact(sourceId, fact.relation, targetId, fact.text, {
            episodeIds: [episodeId],
            source: 'auto_extracted',
            confidence: fact.confidence
          });
        }
      }
    } catch (error) {
      // Log error but don't fail episode creation
      console.warn('Auto-extraction failed:', error);
    }
  }

  /**
   * Get recent episodes
   */
  async getRecentEpisodes(limit: number = 10): Promise<Episode[]> {
    return this.storage.getEpisodes(this.actorId, this.graph_id, limit);
  }

  /**
   * Add an entity (person, place, thing)
   */
  async addEntity(name: string, type: string, summary?: string): Promise<string> {
    const entity: Entity = {
      id: randomUUID(),
      name,
      type,
      summary,
      sequence: ++this.entitySequence,
      created_at: new Date(),
      actorId: this.actorId,
      graph_id: this.graph_id
    };

    await this.storage.addEntity(entity);
    return entity.id;
  }

  /**
   * Get all entities
   */
  async getEntities(): Promise<Entity[]> {
    return this.storage.getEntities(this.actorId, this.graph_id);
  }

  /**
   * Add a fact (relationship between entities)
   */
  async addFact(
    sourceEntityId: string,
    relation: string,
    targetEntityId: string,
    text: string,
    options?: {
      episodeIds?: string[];
      source?: 'user_input' | 'auto_extracted' | 'imported';
      confidence?: number;
      validFrom?: Date;
      lamport_ts?: number;  // For syncing facts from other actors
    }
  ): Promise<string> {
    // Tick Lamport clock (sync with received or local event)
    const lamport_ts = this.lamportClock.tick(options?.lamport_ts);
    
    const fact: Fact = {
      id: randomUUID(),
      sourceEntityId,
      targetEntityId,
      relation,
      text,
      created_at: new Date(),
      lamport_ts,
      validFrom: options?.validFrom || new Date(),
      episodeIds: options?.episodeIds || [],
      source: options?.source || 'user_input',
      confidence: options?.confidence,
      actorId: this.actorId,
      graph_id: this.graph_id
    };

    await this.storage.addFact(fact);
    return fact.id;
  }

  /**
   * Get all currently valid facts
   */
  async getCurrentFacts(): Promise<Fact[]> {
    return this.storage.getValidFacts(this.actorId, this.graph_id);
  }

  /**
   * Get facts valid at a specific point in time
   */
  async getFactsAt(date: Date): Promise<Fact[]> {
    return this.storage.getValidFacts(this.actorId, this.graph_id, date);
  }

  /**
   * Search for facts by text query
   */
  async search(text: string, limit?: number): Promise<Fact[]> {
    return this.storage.searchFacts({
      actorId: this.actorId,
      graph_id: this.graph_id,
      text,
      limit
    });
  }

  /**
   * Advanced search with full query options
   */
  async searchByQuery(query: {
    text?: string;
    source_entity_ids?: string[];
    target_entity_ids?: string[];
    relations?: string[];
    asOf?: Date;
    limit?: number;
  }): Promise<Fact[]> {
    return this.storage.searchFacts({
      actorId: this.actorId,
      graph_id: this.graph_id,
      ...query,
    });
  }

  /**   * Search facts by semantic similarity using embeddings
   */
  async searchSemantic(embedding: number[], limit?: number): Promise<Fact[]> {
    return this.storage.searchFacts({
      actorId: this.actorId,
      graph_id: this.graph_id,
      embedding,
      limit
    });
  }

  /**
   * Hybrid search: combine text filtering with semantic ranking
   */
  async searchHybrid(text: string, embedding: number[], limit?: number): Promise<Fact[]> {
    return this.storage.searchFacts({
      actorId: this.actorId,
      graph_id: this.graph_id,
      text,
      embedding,
      limit
    });
  }

  /**   * Invalidate a fact (mark it as no longer valid)
   */
  async invalidateFact(factId: string, validUntil: Date = new Date()): Promise<void> {
    const fact = await this.storage.getFact(factId, this.graph_id);
    if (!fact) {
      throw new Error(`Fact ${factId} not found`);
    }

    // Create a new fact with validUntil set
    const updatedFact: Fact = {
      ...fact,
      validUntil
    };

    await this.storage.addFact(updatedFact);
  }

  /**
   * Compose context string for LLM from relevant facts.
   * This formats facts into a human-readable markdown string.
   */
  async composeContext(query: string, options?: {
    factsLimit?: number;
    includeHistory?: boolean;
  }): Promise<string> {
    const facts = await this.search(query, options?.factsLimit || 10);
    const current = facts.filter(f => !f.validUntil);
    const past = facts.filter(f => f.validUntil);
    
    let context = '# Relevant Facts\n\n';
    
    if (current.length > 0) {
      context += '## Current:\n';
      current.forEach(f => {
        context += `- ${f.text} (since ${f.validFrom.toLocaleDateString()})\n`;
      });
    }
    
    if (past.length > 0 && options?.includeHistory) {
      context += '\n## Past:\n';
      past.forEach(f => {
        context += `- ${f.text} (${f.validFrom.toLocaleDateString()} to ${f.validUntil?.toLocaleDateString()})\n`;
      });
    }
    
    return context;
  }

  /**
   * Get memory summary with statistics
   */
  async getSummary(): Promise<string> {
    const facts = await this.getCurrentFacts();
    const episodes = await this.getRecentEpisodes(5);
    
    return `
Known facts: ${facts.length}
Recent episodes: ${episodes.length}
Latest activity: ${episodes[0]?.created_at.toISOString() || 'none'}
    `.trim();
  }
}
