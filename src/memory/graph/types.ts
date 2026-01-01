/**
 * Graph Memory Types
 * 
 * Knowledge graph structures for temporal memory with entity-relationship model.
 * Separate from semantic memory to enable graph-based reasoning.
 */

export interface Episode {
  id: string;
  content: string;
  source: 'message' | 'json' | 'text';
  sequence: number;  // Monotonic counter per actor for ordering
  created_at: Date;  // Wall clock time for human readability only
  actorId: string;
  graph_id: string;
  
  embedding?: number[];
  embedding_ref?: string;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  summary?: string;
  sequence: number;      // Monotonic counter per actor
  created_at: Date;      // Wall clock for human readability only
  actorId: string;
  graph_id: string;
  
  summary_embedding?: number[];
}

export interface Fact {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relation: string;
  text: string;
  
  // Temporal reasoning
  created_at: Date;      // Wall clock for human readability only
  lamport_ts: number;    // Logical timestamp for distributed ordering
  validFrom: Date;
  validUntil?: Date;
  
  // Evidence
  episodeIds: string[];
  
  // Quality tracking
  source: 'user_input' | 'auto_extracted' | 'imported';
  confidence?: number;
  
  // Partitioning
  actorId: string;
  graph_id: string;
  
  embedding?: number[];
  embedding_ref?: string;
}

export interface MemoryQuery {
  actorId: string;
  graph_id?: string;
  text?: string;
  embedding?: number[];
  asOf?: Date;
  limit?: number;
  source_entity_ids?: string[];
  target_entity_ids?: string[];
  relations?: string[];
}

export interface MemoryStorage {
  addEpisode(episode: Episode): Promise<void>;
  getEpisodes(actorId: string, graph_id: string, limit?: number): Promise<Episode[]>;
  
  addEntity(entity: Entity): Promise<void>;
  getEntity(id: string, graph_id: string): Promise<Entity | null>;
  getEntities(actorId: string, graph_id: string): Promise<Entity[]>;
  
  addFact(fact: Fact): Promise<void>;
  getFact(id: string, graph_id: string): Promise<Fact | null>;
  getValidFacts(actorId: string, graph_id: string, asOf?: Date): Promise<Fact[]>;
  searchFacts(query: MemoryQuery): Promise<Fact[]>;
  
  close(): Promise<void>;
}
