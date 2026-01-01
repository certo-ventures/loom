import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EntityExtractorActor,
  ConfidenceFilterActor,
  FactTransformerActor,
  EmbeddingEnricherActor,
  MemoryStoreActor
} from '../../../src/memory/graph/pipeline-actors';
import {
  basicMemoryPipeline,
  enrichedMemoryPipeline,
  parallelMemoryPipeline,
  createMemoryPipeline
} from '../../../src/memory/graph/pipeline-definitions';

describe('Memory Pipeline Actors', () => {
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  describe('EntityExtractorActor', () => {
    it('should extract entities and facts from text', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                entities: [
                  { name: 'Alice', type: 'person' },
                  { name: 'TechCorp', type: 'company' }
                ],
                facts: [
                  {
                    sourceEntity: 'Alice',
                    relation: 'works_at',
                    targetEntity: 'TechCorp',
                    text: 'Alice works at TechCorp',
                    confidence: 0.95
                  }
                ]
              })
            }
          }]
        })
      });

      const actor = new EntityExtractorActor(
        { actorId: 'extractor-1', correlationId: 'test' },
        {}
      );

      const result = await actor.execute({
        text: 'Alice works at TechCorp',
        extractorConfig: {
          endpoint: 'https://api.openai.com',
          apiKey: 'test-key',
          model: 'gpt-4'
        }
      });

      expect(result.entities).toHaveLength(2);
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0].confidence).toBe(0.95);
    });
  });

  describe('ConfidenceFilterActor', () => {
    it('should filter facts by confidence threshold', async () => {
      const actor = new ConfidenceFilterActor(
        { actorId: 'filter-1', correlationId: 'test' },
        {}
      );

      const result = await actor.execute({
        facts: [
          { text: 'High confidence', confidence: 0.95 },
          { text: 'Medium confidence', confidence: 0.75 },
          { text: 'Low confidence', confidence: 0.5 },
          { text: 'No confidence' }
        ],
        threshold: 0.8
      });

      expect(result.filtered_facts).toHaveLength(2);
      expect(result.filtered_facts[0].text).toBe('High confidence');
      expect(result.filtered_facts[1].text).toBe('No confidence');
    });

    it('should use default threshold of 0.8', async () => {
      const actor = new ConfidenceFilterActor(
        { actorId: 'filter-1', correlationId: 'test' },
        {}
      );

      const result = await actor.execute({
        facts: [
          { text: 'Above default', confidence: 0.85 },
          { text: 'Below default', confidence: 0.75 }
        ]
      });

      expect(result.filtered_facts).toHaveLength(1);
    });
  });

  describe('FactTransformerActor', () => {
    it('should transform extracted facts to storage format', async () => {
      const actor = new FactTransformerActor(
        { actorId: 'transformer-1', correlationId: 'test' },
        {}
      );

      const result = await actor.execute({
        facts: [
          {
            sourceEntity: 'Alice',
            relation: 'works_at',
            targetEntity: 'TechCorp',
            text: 'Alice works at TechCorp',
            confidence: 0.95
          }
        ],
        entities: [
          { name: 'Alice', type: 'person' },
          { name: 'TechCorp', type: 'company' }
        ],
        actorId: 'memory-actor-1',
        graphId: 'default',
        episodeId: 'episode-123'
      });

      expect(result.transformed_facts).toHaveLength(1);
      const fact = result.transformed_facts[0];
      expect(fact.id).toBeTruthy();
      expect(fact.sourceEntityId).toBeTruthy();
      expect(fact.targetEntityId).toBeTruthy();
      expect(fact.relation).toBe('works_at');
      expect(fact.source).toBe('auto_extracted');
      expect(fact.confidence).toBe(0.95);
      expect(fact.episodeIds).toContain('episode-123');
    });
  });

  describe('EmbeddingEnricherActor', () => {
    it('should pass through facts (lazy embedding)', async () => {
      const actor = new EmbeddingEnricherActor(
        { actorId: 'enricher-1', correlationId: 'test' },
        {}
      );

      const facts = [
        { text: 'Fact 1', id: '1' },
        { text: 'Fact 2', id: '2' }
      ];

      const result = await actor.execute({ facts });

      expect(result.enriched_facts).toEqual(facts);
    });
  });

  describe('MemoryStoreActor', () => {
    it('should return stored count', async () => {
      const actor = new MemoryStoreActor(
        { actorId: 'store-1', correlationId: 'test' },
        {}
      );

      const result = await actor.execute({
        facts: [
          { id: '1', text: 'Fact 1' },
          { id: '2', text: 'Fact 2' },
          { id: '3', text: 'Fact 3' }
        ]
      });

      expect(result.stored_count).toBe(3);
    });
  });
});

describe('Memory Pipeline Definitions', () => {
  describe('basicMemoryPipeline', () => {
    it('should have correct structure', () => {
      expect(basicMemoryPipeline.name).toBe('basic-memory-extraction');
      expect(basicMemoryPipeline.stages).toHaveLength(4);
      
      const stageNames = basicMemoryPipeline.stages.map(s => s.name);
      expect(stageNames).toEqual(['extract', 'filter', 'transform', 'store']);
    });

    it('should define extract stage', () => {
      const extractStage = basicMemoryPipeline.stages[0];
      expect(extractStage.actor).toBe('EntityExtractor');
      expect(extractStage.mode).toBe('single');
      expect(extractStage.input).toHaveProperty('text');
      expect(extractStage.output).toHaveProperty('entities');
      expect(extractStage.output).toHaveProperty('facts');
    });

    it('should define filter stage with threshold', () => {
      const filterStage = basicMemoryPipeline.stages[1];
      expect(filterStage.actor).toBe('ConfidenceFilter');
      expect(filterStage.input.facts).toBe('$.extract.facts');
      expect(filterStage.input.threshold).toBe('$.filterThreshold');
    });

    it('should chain stages correctly', () => {
      const stages = basicMemoryPipeline.stages;
      
      // Filter uses extract output
      expect(stages[1].input.facts).toBe('$.extract.facts');
      
      // Transform uses filter output
      expect(stages[2].input.facts).toBe('$.filter.filtered_facts');
      expect(stages[2].input.entities).toBe('$.extract.entities');
      
      // Store uses transform output
      expect(stages[3].input.facts).toBe('$.transform.transformed_facts');
    });
  });

  describe('enrichedMemoryPipeline', () => {
    it('should include enrichment stage', () => {
      expect(enrichedMemoryPipeline.stages).toHaveLength(5);
      
      const enrichStage = enrichedMemoryPipeline.stages[3];
      expect(enrichStage.name).toBe('enrich');
      expect(enrichStage.actor).toBe('EmbeddingEnricher');
    });

    it('should chain enrichment between transform and store', () => {
      const stages = enrichedMemoryPipeline.stages;
      
      // Enrich uses transform output
      expect(stages[3].input.facts).toBe('$.transform.transformed_facts');
      
      // Store uses enrich output
      expect(stages[4].input.facts).toBe('$.enrich.enriched_facts');
    });
  });

  describe('parallelMemoryPipeline', () => {
    it('should use scatter mode for parallel extraction', () => {
      const extractStage = parallelMemoryPipeline.stages[0];
      expect(extractStage.mode).toBe('scatter');
      expect(extractStage.scatter).toBeDefined();
      expect(extractStage.scatter?.input).toBe('$.conversations');
      expect(extractStage.scatter?.as).toBe('conversation');
    });

    it('should have gather stage to collect results', () => {
      const gatherStage = parallelMemoryPipeline.stages[1];
      expect(gatherStage.mode).toBe('gather');
      expect(gatherStage.gather).toBeDefined();
      expect(gatherStage.gather?.stage).toBe('extract-parallel');
      expect(gatherStage.gather?.condition).toBe('all');
    });

    it('should filter condition on processed status', () => {
      const extractStage = parallelMemoryPipeline.stages[0];
      expect(extractStage.scatter?.condition).toBe('$.conversation.processed != true');
    });
  });

  describe('createMemoryPipeline', () => {
    it('should create basic pipeline by default', () => {
      const pipeline = createMemoryPipeline({ name: 'custom-basic' });
      expect(pipeline.name).toBe('custom-basic');
      expect(pipeline.stages).toHaveLength(4);
    });

    it('should create enriched pipeline when enabled', () => {
      const pipeline = createMemoryPipeline({ 
        name: 'custom-enriched',
        enableEnrichment: true 
      });
      expect(pipeline.stages).toHaveLength(5);
      expect(pipeline.stages.find(s => s.name === 'enrich')).toBeDefined();
    });

    it('should create parallel pipeline when enabled', () => {
      const pipeline = createMemoryPipeline({ 
        name: 'custom-parallel',
        enableParallel: true 
      });
      expect(pipeline.stages[0].mode).toBe('scatter');
      expect(pipeline.stages.find(s => s.mode === 'gather')).toBeDefined();
    });
  });
});

describe('Memory Pipeline Integration', () => {
  it('should demonstrate full pipeline flow', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Mock LLM response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [
                { name: 'Sarah', type: 'person' },
                { name: 'Seattle', type: 'city' }
              ],
              facts: [
                {
                  sourceEntity: 'Sarah',
                  relation: 'lives_in',
                  targetEntity: 'Seattle',
                  text: 'Sarah lives in Seattle',
                  confidence: 0.92
                },
                {
                  sourceEntity: 'Sarah',
                  relation: 'likes',
                  targetEntity: 'coffee',
                  text: 'Sarah likes coffee',
                  confidence: 0.6  // Below threshold
                }
              ]
            })
          }
        }]
      })
    });

    // Step 1: Extract
    const extractor = new EntityExtractorActor(
      { actorId: 'extractor', correlationId: 'test' },
      {}
    );
    const extracted = await extractor.execute({
      text: 'Sarah lives in Seattle and likes coffee',
      extractorConfig: {
        endpoint: 'https://api.openai.com',
        apiKey: 'test-key',
        model: 'gpt-4'
      }
    });

    expect(extracted.entities).toHaveLength(2);
    expect(extracted.facts).toHaveLength(2);

    // Step 2: Filter
    const filter = new ConfidenceFilterActor(
      { actorId: 'filter', correlationId: 'test' },
      {}
    );
    const filtered = await filter.execute({
      facts: extracted.facts,
      threshold: 0.8
    });

    expect(filtered.filtered_facts).toHaveLength(1);
    expect(filtered.filtered_facts[0].text).toBe('Sarah lives in Seattle');

    // Step 3: Transform
    const transformer = new FactTransformerActor(
      { actorId: 'transformer', correlationId: 'test' },
      {}
    );
    const transformed = await transformer.execute({
      facts: filtered.filtered_facts,
      entities: extracted.entities,
      actorId: 'memory-actor',
      graphId: 'default',
      episodeId: 'episode-1'
    });

    expect(transformed.transformed_facts).toHaveLength(1);
    expect(transformed.transformed_facts[0].relation).toBe('lives_in');
    expect(transformed.transformed_facts[0].source).toBe('auto_extracted');

    // Step 4: Store
    const store = new MemoryStoreActor(
      { actorId: 'store', correlationId: 'test' },
      {}
    );
    const stored = await store.execute({
      facts: transformed.transformed_facts
    });

    expect(stored.stored_count).toBe(1);
  });
});
