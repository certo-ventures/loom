import { describe, it, expect, beforeEach } from 'vitest';
import { ActorMemory } from '../../../src/memory/graph/actor-memory';
import { InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage';
import { LamportClock } from '../../../src/timing/lamport-clock';

describe('ActorMemory', () => {
  let storage: InMemoryGraphStorage;
  let clock: LamportClock;
  let memory: ActorMemory;

  beforeEach(() => {
    storage = new InMemoryGraphStorage();
    clock = new LamportClock();
    memory = new ActorMemory('actor-1', storage, clock);
  });

  describe('Episodes', () => {
    it('should add and retrieve episodes', async () => {
      const episodeId = await memory.addEpisode('User said hello');
      expect(episodeId).toBeTruthy();

      const episodes = await memory.getRecentEpisodes();
      expect(episodes).toHaveLength(1);
      expect(episodes[0].content).toBe('User said hello');
      expect(episodes[0].source).toBe('message');
    });

    it('should support different source types', async () => {
      await memory.addEpisode('JSON data', 'json');
      const episodes = await memory.getRecentEpisodes();
      expect(episodes[0].source).toBe('json');
    });

    it('should respect limit on recent episodes', async () => {
      for (let i = 0; i < 5; i++) {
        await memory.addEpisode(`Episode ${i}`);
      }

      const episodes = await memory.getRecentEpisodes(3);
      expect(episodes).toHaveLength(3);
    });

    it('should return episodes in reverse chronological order', async () => {
      await memory.addEpisode('First');
      await new Promise(resolve => setTimeout(resolve, 10)); // Ensure different timestamps
      await memory.addEpisode('Second');

      const episodes = await memory.getRecentEpisodes();
      expect(episodes[0].content).toBe('Second');
      expect(episodes[1].content).toBe('First');
    });
  });

  describe('Entities', () => {
    it('should add and retrieve entities', async () => {
      const entityId = await memory.addEntity('Alice', 'person');
      expect(entityId).toBeTruthy();

      const entities = await memory.getEntities();
      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe('Alice');
      expect(entities[0].type).toBe('person');
    });

    it('should support optional summary', async () => {
      await memory.addEntity('TechStart', 'company', 'An AI startup');
      const entities = await memory.getEntities();
      expect(entities[0].summary).toBe('An AI startup');
    });
  });

  describe('Facts', () => {
    let aliceId: string;
    let techStartId: string;

    beforeEach(async () => {
      aliceId = await memory.addEntity('Alice', 'person');
      techStartId = await memory.addEntity('TechStart', 'company');
    });

    it('should add and retrieve facts', async () => {
      const factId = await memory.addFact(
        aliceId,
        'WORKS_AT',
        techStartId,
        'Alice works at TechStart'
      );
      expect(factId).toBeTruthy();

      const facts = await memory.getCurrentFacts();
      expect(facts).toHaveLength(1);
      expect(facts[0].relation).toBe('WORKS_AT');
      expect(facts[0].text).toBe('Alice works at TechStart');
    });

    it('should support optional fact metadata', async () => {
      const episodeId = await memory.addEpisode('User mentioned job');
      
      await memory.addFact(
        aliceId,
        'WORKS_AT',
        techStartId,
        'Alice works at TechStart',
        {
          episodeIds: [episodeId],
          source: 'auto_extracted',
          confidence: 0.95
        }
      );

      const facts = await memory.getCurrentFacts();
      expect(facts[0].source).toBe('auto_extracted');
      expect(facts[0].confidence).toBe(0.95);
      expect(facts[0].episodeIds).toContain(episodeId);
    });

    it('should get facts valid at specific time', async () => {
      const past = new Date('2024-01-01');
      const present = new Date('2024-06-01');

      await memory.addFact(
        aliceId,
        'WORKS_AT',
        techStartId,
        'Alice works at TechStart',
        { validFrom: present }
      );

      const pastFacts = await memory.getFactsAt(past);
      expect(pastFacts).toHaveLength(0);

      const presentFacts = await memory.getFactsAt(present);
      expect(presentFacts).toHaveLength(1);
    });

    it('should invalidate facts', async () => {
      const factId = await memory.addFact(
        aliceId,
        'WORKS_AT',
        techStartId,
        'Alice works at TechStart'
      );

      // Fact should be valid initially
      let facts = await memory.getCurrentFacts();
      expect(facts).toHaveLength(1);

      // Invalidate the fact
      await memory.invalidateFact(factId);

      // Fact should no longer be current (but still exists in history)
      facts = await memory.getCurrentFacts();
      expect(facts).toHaveLength(0);
    });
  });

  describe('Search', () => {
    beforeEach(async () => {
      const aliceId = await memory.addEntity('Alice', 'person');
      const bobId = await memory.addEntity('Bob', 'person');
      const techStartId = await memory.addEntity('TechStart', 'company');
      const pizzaId = await memory.addEntity('Pizza', 'food');

      await memory.addFact(aliceId, 'WORKS_AT', techStartId, 'Alice works at TechStart');
      await memory.addFact(bobId, 'WORKS_AT', techStartId, 'Bob works at TechStart');
      await memory.addFact(aliceId, 'LIKES', pizzaId, 'Alice likes pizza');
    });

    it('should search facts by text', async () => {
      const results = await memory.search('pizza');
      expect(results).toHaveLength(1);
      expect(results[0].text).toContain('pizza');
    });

    it('should search facts by relation', async () => {
      const results = await memory.search('WORKS_AT');
      expect(results).toHaveLength(2);
      expect(results.every(f => f.relation === 'WORKS_AT')).toBe(true);
    });

    it('should respect search limit', async () => {
      const results = await memory.search('WORKS_AT', 1);
      expect(results).toHaveLength(1);
    });
  });

  describe('Multi-tenant isolation', () => {
    it('should isolate memories by actorId', async () => {
      const clock1 = new LamportClock();
      const clock2 = new LamportClock();
      const memory1 = new ActorMemory('actor-1', storage, clock1);
      const memory2 = new ActorMemory('actor-2', storage, clock2);

      await memory1.addEpisode('Actor 1 episode');
      await memory2.addEpisode('Actor 2 episode');

      const episodes1 = await memory1.getRecentEpisodes();
      const episodes2 = await memory2.getRecentEpisodes();

      expect(episodes1).toHaveLength(1);
      expect(episodes2).toHaveLength(1);
      expect(episodes1[0].content).toBe('Actor 1 episode');
      expect(episodes2[0].content).toBe('Actor 2 episode');
    });

    it('should support shared graphs via graph_id', async () => {
      const clock1 = new LamportClock();
      const clock2 = new LamportClock();
      const memory1 = new ActorMemory('actor-1', storage, clock1, { graph_id: 'shared' });
      const memory2 = new ActorMemory('actor-2', storage, clock2, { graph_id: 'shared' });

      const aliceId = await memory1.addEntity('Alice', 'person');
      const techStartId = await memory2.addEntity('TechStart', 'company');

      await memory1.addFact(aliceId, 'WORKS_AT', techStartId, 'Alice works at TechStart');

      // Both actors can see the fact
      const facts1 = await memory1.getCurrentFacts();
      const facts2 = await memory2.getCurrentFacts();

      expect(facts1.length).toBeGreaterThan(0);
      expect(facts2.length).toBeGreaterThan(0);
    });
  });

  describe('Context Assembly', () => {
    beforeEach(async () => {
      const aliceId = await memory.addEntity('Alice', 'person');
      const bobId = await memory.addEntity('Bob', 'person');
      const techStartId = await memory.addEntity('TechStart', 'company');
      const oldCorpId = await memory.addEntity('OldCorp', 'company');

      // Current fact
      await memory.addFact(aliceId, 'WORKS_AT', techStartId, 'Alice works at TechStart');

      // Past fact (invalidated)
      const oldFactId = await memory.addFact(
        aliceId,
        'WORKS_AT',
        oldCorpId,
        'Alice worked at OldCorp',
        { validFrom: new Date('2023-01-01') }
      );
      await memory.invalidateFact(oldFactId, new Date('2024-01-01'));

      // Another current fact
      await memory.addFact(bobId, 'WORKS_AT', techStartId, 'Bob works at TechStart');
    });

    it('should compose context from current facts', async () => {
      const context = await memory.composeContext('works');
      
      expect(context).toContain('# Relevant Facts');
      expect(context).toContain('## Current:');
      expect(context).toContain('Alice works at TechStart');
      expect(context).toContain('Bob works at TechStart');
    });

    it('should exclude past facts by default', async () => {
      const context = await memory.composeContext('works');
      
      expect(context).not.toContain('OldCorp');
      expect(context).not.toContain('## Past:');
    });

    it('should include past facts when requested', async () => {
      const context = await memory.composeContext('works', { includeHistory: true });
      
      expect(context).toContain('## Past:');
      expect(context).toContain('Alice worked at OldCorp');
    });

    it('should respect factsLimit', async () => {
      const context = await memory.composeContext('works', { factsLimit: 1 });
      
      // Should have only one fact in the context
      const factMatches = context.match(/- \w+/g);
      expect(factMatches).toHaveLength(1);
    });
  });

  describe('Summary', () => {
    it('should generate summary with stats', async () => {
      await memory.addEpisode('Episode 1');
      await memory.addEpisode('Episode 2');

      const aliceId = await memory.addEntity('Alice', 'person');
      const bobId = await memory.addEntity('Bob', 'person');
      await memory.addFact(aliceId, 'KNOWS', bobId, 'Alice knows Bob');

      const summary = await memory.getSummary();
      
      expect(summary).toContain('Known facts: 1');
      expect(summary).toContain('Recent episodes: 2');
      expect(summary).toContain('Latest activity:');
    });

    it('should handle empty memory', async () => {
      const summary = await memory.getSummary();
      
      expect(summary).toContain('Known facts: 0');
      expect(summary).toContain('Recent episodes: 0');
      expect(summary).toContain('Latest activity: none');
    });
  });

  describe('Semantic Search', () => {
    it('should search facts by embedding', async () => {
      const aliceId = await memory.addEntity('Alice', 'person');
      const pizzaId = await memory.addEntity('Pizza', 'food');
      const pastaId = await memory.addEntity('Pasta', 'food');
      const mathId = await memory.addEntity('Math', 'subject');

      // Add facts with embeddings
      const fact1Id = await memory.addFact(aliceId, 'likes', pizzaId, 'Alice likes pizza');
      const fact2Id = await memory.addFact(aliceId, 'likes', pastaId, 'Alice likes pasta');
      const fact3Id = await memory.addFact(aliceId, 'studies', mathId, 'Alice studies math');

      // Add embeddings directly to storage (simulating embedding service)
      const fact1 = await storage.getFact(fact1Id, 'default');
      const fact2 = await storage.getFact(fact2Id, 'default');
      const fact3 = await storage.getFact(fact3Id, 'default');

      fact1!.embedding = [0.8, 0.2, 0.1]; // Food vector
      fact2!.embedding = [0.75, 0.25, 0.15]; // Food vector (similar)
      fact3!.embedding = [0.1, 0.1, 0.9]; // Education vector

      await storage.addFact(fact1!);
      await storage.addFact(fact2!);
      await storage.addFact(fact3!);

      // Search with food embedding
      const results = await memory.searchSemantic([0.8, 0.2, 0.1], 2);

      expect(results).toHaveLength(2);
      expect(results[0].text).toBe('Alice likes pizza'); // Exact match
      expect(results[1].text).toBe('Alice likes pasta'); // Similar
    });

    it('should support hybrid search (text + semantic)', async () => {
      const aliceId = await memory.addEntity('Alice', 'person');
      const bobId = await memory.addEntity('Bob', 'person');
      const pizzaId = await memory.addEntity('Pizza', 'food');

      const fact1Id = await memory.addFact(aliceId, 'likes', pizzaId, 'Alice likes pizza');
      const fact2Id = await memory.addFact(bobId, 'likes', pizzaId, 'Bob likes pizza');

      // Add embeddings
      const fact1 = await storage.getFact(fact1Id, 'default');
      const fact2 = await storage.getFact(fact2Id, 'default');

      fact1!.embedding = [0.8, 0.2, 0.1];
      fact2!.embedding = [0.78, 0.22, 0.12];

      await storage.addFact(fact1!);
      await storage.addFact(fact2!);

      // Hybrid search: text "Alice" + food embedding
      const results = await memory.searchHybrid('Alice', [0.8, 0.2, 0.1]);

      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('Alice likes pizza');
    });

    it('should handle empty semantic search results', async () => {
      const results = await memory.searchSemantic([0.5, 0.5, 0.5]);
      expect(results).toHaveLength(0);
    });
  });});