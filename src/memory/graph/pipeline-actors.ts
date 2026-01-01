/**
 * Memory Pipeline Actors
 * 
 * Actors designed to work with Loom's pipeline DSL for memory processing workflows
 */

import { Actor } from '../../actor/actor';
import type { ActorContext } from '../../actor/journal';
import { MemoryExtractor, type ExtractionResult } from './extractor';
import type { Fact } from './types';

/**
 * EntityExtractorActor - Extracts entities and facts from text using LLM
 * 
 * Input: { text: string }
 * Output: { entities: ExtractedEntity[], facts: ExtractedFact[] }
 */
export class EntityExtractorActor extends Actor {
  private extractor?: MemoryExtractor;

  async execute(input: { text: string; extractorConfig?: any }): Promise<ExtractionResult> {
    // Initialize extractor if config provided
    if (input.extractorConfig && !this.extractor) {
      this.extractor = new MemoryExtractor(input.extractorConfig);
    }

    if (!this.extractor) {
      throw new Error('EntityExtractorActor requires extractorConfig on first call');
    }

    const result = await this.extractor.extract(input.text);
    
    return {
      entities: result.entities,
      facts: result.facts
    };
  }
}

/**
 * ConfidenceFilterActor - Filters facts by confidence threshold
 * 
 * Input: { facts: ExtractedFact[], threshold?: number }
 * Output: { filtered_facts: ExtractedFact[] }
 */
export class ConfidenceFilterActor extends Actor {
  async execute(input: { 
    facts: Array<{ confidence?: number; [key: string]: any }>;
    threshold?: number;
  }): Promise<{ filtered_facts: any[] }> {
    const threshold = input.threshold ?? 0.8;
    
    const filtered = input.facts.filter(fact => {
      if (fact.confidence === undefined) {
        return true; // Keep facts without confidence scores
      }
      return fact.confidence >= threshold;
    });

    return { filtered_facts: filtered };
  }
}

/**
 * FactTransformerActor - Transforms extracted facts into storage format
 * 
 * Input: { facts: ExtractedFact[], entities: ExtractedEntity[], actorId: string, graphId: string }
 * Output: { transformed_facts: Fact[] }
 */
export class FactTransformerActor extends Actor {
  async execute(input: {
    facts: Array<{
      sourceEntity: string;
      relation: string;
      targetEntity: string;
      text: string;
      confidence?: number;
    }>;
    entities: Array<{ name: string; type: string; summary?: string }>;
    actorId: string;
    graphId: string;
    episodeId?: string;
  }): Promise<{ transformed_facts: any[] }> {
    const { facts, entities, actorId, graphId, episodeId } = input;
    
    // Build entity name -> id mapping (simplified - in real system would check storage)
    const entityMap = new Map<string, string>();
    entities.forEach((entity, idx) => {
      entityMap.set(entity.name, `entity-${idx}`);
    });

    const transformed = facts.map((fact, idx) => ({
      id: `fact-${idx}`,
      sourceEntityId: entityMap.get(fact.sourceEntity) || `entity-${fact.sourceEntity}`,
      targetEntityId: entityMap.get(fact.targetEntity) || `entity-${fact.targetEntity}`,
      relation: fact.relation,
      text: fact.text,
      created_at: new Date(),
      lamport_ts: idx + 1, // Simplified - would use real LamportClock
      validFrom: new Date(),
      episodeIds: episodeId ? [episodeId] : [],
      source: 'auto_extracted' as const,
      confidence: fact.confidence,
      actorId,
      graph_id: graphId
    }));

    return { transformed_facts: transformed };
  }
}

/**
 * EmbeddingEnricherActor - Adds embeddings to facts (lazy/on-demand)
 * 
 * Input: { facts: Fact[], embedderConfig?: any }
 * Output: { enriched_facts: Fact[] }
 */
export class EmbeddingEnricherActor extends Actor {
  async execute(input: { 
    facts: Array<{ text: string; [key: string]: any }>;
    embedderConfig?: any;
  }): Promise<{ enriched_facts: any[] }> {
    // For now, just pass through without embedding (lazy approach)
    // Real implementation would use EmbeddingService if embedderConfig provided
    
    return { enriched_facts: input.facts };
  }
}

/**
 * MemoryStoreActor - Stores facts to memory graph
 * 
 * Input: { facts: Fact[], storageConfig: any }
 * Output: { stored_count: number }
 */
export class MemoryStoreActor extends Actor {
  async execute(input: {
    facts: any[];
    storageConfig?: any;
  }): Promise<{ stored_count: number }> {
    // In real implementation, would use ActorMemory to store
    // For now, just return count
    
    return { stored_count: input.facts.length };
  }
}
