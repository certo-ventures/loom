import type { Episode, Entity, Fact, MemoryQuery, MemoryStorage } from './types';

/**
 * Calculate cosine similarity between two vectors
 * Returns value between -1 and 1, where 1 = identical direction
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} !== ${b.length}`);
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  
  // Avoid division by zero
  if (denominator === 0) {
    return 0;
  }
  
  return dotProduct / denominator;
}

/**
 * In-memory implementation of MemoryStorage for testing and development.
 * All data lost when process exits.
 */
export class InMemoryGraphStorage implements MemoryStorage {
  private episodes: Map<string, Episode> = new Map();
  private entities: Map<string, Entity> = new Map();
  private facts: Map<string, Fact> = new Map();

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '⚠️  [InMemoryGraphStorage] Using in-memory adapter in production. ' +
        'This is not recommended for distributed systems. ' +
        'Use CosmosGraphStorage or RedisGraphStorage instead.'
      )
    }
  }

  async addEpisode(episode: Episode): Promise<void> {
    this.episodes.set(episode.id, episode);
  }

  async getEpisodes(actorId: string, graph_id: string, limit?: number): Promise<Episode[]> {
    const filtered = Array.from(this.episodes.values())
      .filter(ep => ep.actorId === actorId && ep.graph_id === graph_id)
      .sort((a, b) => b.sequence - a.sequence);  // Sort by sequence, not timestamp
    
    return limit ? filtered.slice(0, limit) : filtered;
  }

  async addEntity(entity: Entity): Promise<void> {
    this.entities.set(entity.id, entity);
  }

  async getEntity(id: string, graph_id: string): Promise<Entity | null> {
    const entity = this.entities.get(id);
    return entity?.graph_id === graph_id ? entity : null;
  }

  async getEntities(actorId: string, graph_id: string): Promise<Entity[]> {
    return Array.from(this.entities.values())
      .filter(e => e.actorId === actorId && e.graph_id === graph_id);
  }

  async addFact(fact: Fact): Promise<void> {
    this.facts.set(fact.id, fact);
  }

  async getFact(id: string, graph_id: string): Promise<Fact | null> {
    const fact = this.facts.get(id);
    return fact?.graph_id === graph_id ? fact : null;
  }

  async getValidFacts(actorId: string, graph_id: string, asOf?: Date): Promise<Fact[]> {
    const checkDate = asOf || new Date();
    
    return Array.from(this.facts.values()).filter(fact => {
      // In shared graphs, all facts are visible regardless of actorId
      // In private graphs (graph_id === actorId), only actor's facts are visible
      if (fact.graph_id !== graph_id) {
        return false;
      }
      
      // For private graphs, filter by actorId
      if (graph_id === actorId && fact.actorId !== actorId) {
        return false;
      }
      
      // Check temporal validity
      if (fact.validFrom > checkDate) {
        return false;
      }
      
      if (fact.validUntil && fact.validUntil <= checkDate) {
        return false;
      }
      
      return true;
    });
  }

  async searchFacts(query: MemoryQuery): Promise<Fact[]> {
    let results = Array.from(this.facts.values());
    
    // Filter by actorId if provided
    if (query.actorId) {
      results = results.filter(f => f.actorId === query.actorId);
    }
    
    if (query.graph_id) {
      results = results.filter(f => f.graph_id === query.graph_id);
    }
    
    // Support both 'subject' and 'source_entity_ids' for backward compatibility
    const subjectField = (query as any).subject;
    if (subjectField) {
      results = results.filter(f => f.sourceEntityId === subjectField);
    }
    
    // Support both 'object' and 'target_entity_ids' for backward compatibility
    const objectField = (query as any).object;
    if (objectField) {
      results = results.filter(f => f.targetEntityId === objectField);
    }
    
    // Support singular 'relation' in addition to 'relations' array
    const relationField = (query as any).relation;
    if (relationField) {
      results = results.filter(f => f.relation === relationField);
    }
    
    // Filter by source entity IDs
    if (query.source_entity_ids && query.source_entity_ids.length > 0) {
      results = results.filter(f => query.source_entity_ids!.includes(f.sourceEntityId));
    }
    
    // Filter by target entity IDs
    if (query.target_entity_ids && query.target_entity_ids.length > 0) {
      results = results.filter(f => query.target_entity_ids!.includes(f.targetEntityId));
    }
    
    // Filter by relations
    if (query.relations && query.relations.length > 0) {
      results = results.filter(f => query.relations!.includes(f.relation));
    }
    
    // Temporal filtering
    if (query.asOf) {
      results = results.filter(f => {
        return f.validFrom <= query.asOf! && 
               (!f.validUntil || f.validUntil > query.asOf!);
      });
    }
    
    // Text search (simple keyword matching)
    if (query.text && typeof query.text === 'string' && query.text.trim()) {
      const searchLower = query.text.toLowerCase();
      results = results.filter(f => 
        f.text.toLowerCase().includes(searchLower) ||
        f.relation.toLowerCase().includes(searchLower)
      );
    }
    
    // Vector similarity search
    if (query.embedding) {
      // Filter to facts with embeddings
      const factsWithEmbeddings = results.filter(f => f.embedding && f.embedding.length > 0);
      
      // Calculate similarity scores
      const scored = factsWithEmbeddings.map(fact => ({
        fact,
        similarity: cosineSimilarity(query.embedding!, fact.embedding!)
      }));
      
      // Sort by similarity descending
      scored.sort((a, b) => b.similarity - a.similarity);
      
      // Return just the facts
      results = scored.map(s => s.fact);
    }
    
    return query.limit ? results.slice(0, query.limit) : results;
  }

  async getFactsForEntity(entityId: string, graph_id: string): Promise<Fact[]> {
    return Array.from(this.facts.values())
      .filter(f => 
        f.graph_id === graph_id && 
        (f.sourceEntityId === entityId || f.targetEntityId === entityId)
      )
      .sort((a, b) => b.lamport_ts - a.lamport_ts);
  }

  async getFactsBetween(sourceEntityId: string, targetEntityId: string, graph_id: string): Promise<Fact[]> {
    return Array.from(this.facts.values())
      .filter(f => 
        f.graph_id === graph_id && 
        (
          (f.sourceEntityId === sourceEntityId && f.targetEntityId === targetEntityId) ||
          (f.sourceEntityId === targetEntityId && f.targetEntityId === sourceEntityId)
        )
      )
      .sort((a, b) => b.lamport_ts - a.lamport_ts);
  }

  async close(): Promise<void> {
    this.episodes.clear();
    this.entities.clear();
    this.facts.clear();
  }
}
