/**
 * Memory Pipeline Definitions
 * 
 * Pre-built pipeline definitions for common memory processing workflows
 */

import type { PipelineDefinition } from '../../pipelines/pipeline-dsl';

/**
 * Basic memory extraction pipeline
 * Extract -> Filter -> Store
 */
export const basicMemoryPipeline: PipelineDefinition = {
  name: 'basic-memory-extraction',
  version: '1.0.0',
  description: 'Extract entities and facts, filter by confidence, and store',
  
  stages: [
    {
      name: 'extract',
      actor: 'EntityExtractor',
      mode: 'single',
      input: {
        text: 'text',
        extractorConfig: 'extractorConfig'
      },
      output: {
        entities: 'entities',
        facts: 'facts'
      }
    },
    {
      name: 'filter',
      actor: 'ConfidenceFilter',
      mode: 'single',
      input: {
        facts: 'extract.facts',
        threshold: 'filterThreshold'
      },
      output: {
        filtered_facts: 'filtered_facts'
      }
    },
    {
      name: 'transform',
      actor: 'FactTransformer',
      mode: 'single',
      input: {
        facts: 'filter.filtered_facts',
        entities: 'extract.entities',
        actorId: 'actorId',
        graphId: 'graphId',
        episodeId: 'episodeId'
      },
      output: {
        transformed_facts: 'transformed_facts'
      }
    },
    {
      name: 'store',
      actor: 'MemoryStore',
      mode: 'single',
      input: {
        facts: 'transform.transformed_facts',
        storageConfig: 'storageConfig'
      }
    }
  ]
};

/**
 * Advanced memory pipeline with enrichment
 * Extract -> Filter -> Enrich -> Store
 */
export const enrichedMemoryPipeline: PipelineDefinition = {
  name: 'enriched-memory-extraction',
  version: '1.0.0',
  description: 'Extract, filter, enrich with embeddings, and store',
  
  stages: [
    {
      name: 'extract',
      actor: 'EntityExtractor',
      mode: 'single',
      input: {
        text: 'text',
        extractorConfig: 'extractorConfig'
      }
    },
    {
      name: 'filter',
      actor: 'ConfidenceFilter',
      mode: 'single',
      input: {
        facts: 'extract.facts',
        threshold: 'filterThreshold'
      }
    },
    {
      name: 'transform',
      actor: 'FactTransformer',
      mode: 'single',
      input: {
        facts: 'filter.filtered_facts',
        entities: 'extract.entities',
        actorId: 'actorId',
        graphId: 'graphId',
        episodeId: 'episodeId'
      }
    },
    {
      name: 'enrich',
      actor: 'EmbeddingEnricher',
      mode: 'single',
      input: {
        facts: 'transform.transformed_facts',
        embedderConfig: 'embedderConfig'
      }
    },
    {
      name: 'store',
      actor: 'MemoryStore',
      mode: 'single',
      input: {
        facts: 'enrich.enriched_facts',
        storageConfig: 'storageConfig'
      }
    }
  ]
};

/**
 * Parallel memory pipeline - process multiple conversations concurrently
 * Scatter conversations -> Extract each -> Gather -> Filter all -> Store
 */
export const parallelMemoryPipeline: PipelineDefinition = {
  name: 'parallel-memory-extraction',
  version: '1.0.0',
  description: 'Process multiple conversations in parallel',
  
  stages: [
    {
      name: 'extract-parallel',
      actor: 'EntityExtractor',
      mode: 'scatter',
      scatter: {
        input: 'conversations',
        as: 'conversation',
        condition: 'conversation.processed != true'
      },
      input: {
        text: 'item.text',
        extractorConfig: 'extractorConfig'
      }
    },
    {
      name: 'gather-results',
      actor: 'PassThrough',
      mode: 'gather',
      gather: {
        stage: 'extract-parallel',
        condition: 'all'
      },
      input: {
        results: 'gathered'
      }
    },
    {
      name: 'filter-all',
      actor: 'ConfidenceFilter',
      mode: 'single',
      input: {
        facts: "gather-results.results[*].facts",
        threshold: 'filterThreshold'
      }
    },
    {
      name: 'transform-all',
      actor: 'FactTransformer',
      mode: 'single',
      input: {
        facts: "filter-all.filtered_facts",
        entities: "gather-results.results[*].entities",
        actorId: 'actorId',
        graphId: 'graphId'
      }
    },
    {
      name: 'store',
      actor: 'MemoryStore',
      mode: 'single',
      input: {
        facts: "transform-all.transformed_facts",
        storageConfig: 'storageConfig'
      }
    }
  ]
};

/**
 * Helper to create custom memory pipeline
 */
export function createMemoryPipeline(options: {
  name: string;
  enableFilter?: boolean;
  enableEnrichment?: boolean;
  enableParallel?: boolean;
  filterThreshold?: number;
}): PipelineDefinition {
  const { name, enableFilter = true, enableEnrichment = false, enableParallel = false } = options;
  
  if (enableParallel) {
    return { ...parallelMemoryPipeline, name };
  }
  
  if (enableEnrichment) {
    return { ...enrichedMemoryPipeline, name };
  }
  
  return { ...basicMemoryPipeline, name };
}
