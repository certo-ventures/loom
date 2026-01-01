import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage';
import type { Episode, Entity, Fact } from '../../../src/memory/graph/types';

describe('InMemoryGraphStorage', () => {
  let storage: InMemoryGraphStorage;

  beforeEach(() => {
    storage = new InMemoryGraphStorage();
  });

  describe('Episodes', () => {
    it('should add and retrieve episodes', async () => {
      const episode: Episode = {
        id: 'ep-1',
        content: 'User said hello',
        source: 'message',
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'default'
      };

      await storage.addEpisode(episode);
      const episodes = await storage.getEpisodes('actor-1', 'default');

      expect(episodes).toHaveLength(1);
      expect(episodes[0].content).toBe('User said hello');
    });

    it('should sort episodes by sequence (lamport_ts) descending', async () => {
      const ep1: Episode = {
        id: 'ep-1',
        sequence: 1,
        content: 'First',
        source: 'message',
        created_at: new Date('2024-01-01'),
        actorId: 'actor-1',
        graph_id: 'default'
      };

      const ep2: Episode = {
        id: 'ep-2',
        sequence: 2,
        content: 'Second',
        source: 'message',
        created_at: new Date('2024-01-02'),
        actorId: 'actor-1',
        graph_id: 'default'
      };

      await storage.addEpisode(ep1);
      await storage.addEpisode(ep2);

      const episodes = await storage.getEpisodes('actor-1', 'default');
      expect(episodes[0].content).toBe('Second'); // sequence: 2
      expect(episodes[1].content).toBe('First');  // sequence: 1
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.addEpisode({
          id: `ep-${i}`,
          content: `Episode ${i}`,
          source: 'message',
          created_at: new Date(),
          actorId: 'actor-1',
          graph_id: 'default'
        });
      }

      const episodes = await storage.getEpisodes('actor-1', 'default', 3);
      expect(episodes).toHaveLength(3);
    });

    it('should filter by actorId and graph_id', async () => {
      await storage.addEpisode({
        id: 'ep-1',
        content: 'Actor 1',
        source: 'message',
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'default'
      });

      await storage.addEpisode({
        id: 'ep-2',
        content: 'Actor 2',
        source: 'message',
        created_at: new Date(),
        actorId: 'actor-2',
        graph_id: 'default'
      });

      const episodes = await storage.getEpisodes('actor-1', 'default');
      expect(episodes).toHaveLength(1);
      expect(episodes[0].content).toBe('Actor 1');
    });
  });

  describe('Entities', () => {
    it('should add and retrieve entities', async () => {
      const entity: Entity = {
        id: 'ent-1',
        name: 'Alice',
        type: 'person',
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'default'
      };

      await storage.addEntity(entity);
      const retrieved = await storage.getEntity('ent-1', 'default');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Alice');
    });

    it('should return null for non-existent entity', async () => {
      const entity = await storage.getEntity('non-existent', 'default');
      expect(entity).toBeNull();
    });

    it('should filter entities by actorId and graph_id', async () => {
      await storage.addEntity({
        id: 'ent-1',
        name: 'Alice',
        type: 'person',
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'default'
      });

      await storage.addEntity({
        id: 'ent-2',
        name: 'Bob',
        type: 'person',
        created_at: new Date(),
        actorId: 'actor-2',
        graph_id: 'default'
      });

      const entities = await storage.getEntities('actor-1', 'default');
      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe('Alice');
    });
  });

  describe('Facts', () => {
    it('should add and retrieve facts', async () => {
      const fact: Fact = {
        id: 'fact-1',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-2',
        relation: 'WORKS_AT',
        text: 'Alice works at TechStart',
        created_at: new Date(),
        validFrom: new Date(),
        episodeIds: ['ep-1'],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'default'
      };

      await storage.addFact(fact);
      const retrieved = await storage.getFact('fact-1', 'default');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.text).toBe('Alice works at TechStart');
    });

    it('should get valid facts (no validUntil)', async () => {
      const fact: Fact = {
        id: 'fact-1',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-2',
        relation: 'WORKS_AT',
        text: 'Alice works at TechStart',
        created_at: new Date('2024-01-01'),
        validFrom: new Date('2024-01-01'),
        episodeIds: ['ep-1'],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'default'
      };

      await storage.addFact(fact);
      const facts = await storage.getValidFacts('actor-1', 'default');

      expect(facts).toHaveLength(1);
      expect(facts[0].text).toBe('Alice works at TechStart');
    });

    it('should exclude invalidated facts', async () => {
      const fact: Fact = {
        id: 'fact-1',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-2',
        relation: 'WORKS_AT',
        text: 'Alice worked at OldCorp',
        created_at: new Date('2024-01-01'),
        validFrom: new Date('2024-01-01'),
        validUntil: new Date('2024-06-01'),
        episodeIds: ['ep-1'],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'default'
      };

      await storage.addFact(fact);
      
      // Check before invalidation
      const factsBefore = await storage.getValidFacts('actor-1', 'default', new Date('2024-03-01'));
      expect(factsBefore).toHaveLength(1);

      // Check after invalidation
      const factsAfter = await storage.getValidFacts('actor-1', 'default', new Date('2024-07-01'));
      expect(factsAfter).toHaveLength(0);
    });

    it('should support temporal queries with asOf', async () => {
      const fact1: Fact = {
        id: 'fact-1',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-2',
        relation: 'WORKS_AT',
        text: 'Alice worked at OldCorp',
        created_at: new Date('2024-01-01'),
        validFrom: new Date('2024-01-01'),
        validUntil: new Date('2024-06-01'),
        episodeIds: ['ep-1'],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'default'
      };

      const fact2: Fact = {
        id: 'fact-2',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-3',
        relation: 'WORKS_AT',
        text: 'Alice works at TechStart',
        created_at: new Date('2024-06-01'),
        validFrom: new Date('2024-06-01'),
        episodeIds: ['ep-2'],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'default'
      };

      await storage.addFact(fact1);
      await storage.addFact(fact2);

      // Query in past: should get fact1
      const pastFacts = await storage.getValidFacts('actor-1', 'default', new Date('2024-03-01'));
      expect(pastFacts).toHaveLength(1);
      expect(pastFacts[0].text).toContain('OldCorp');

      // Query in present: should get fact2
      const presentFacts = await storage.getValidFacts('actor-1', 'default', new Date('2024-07-01'));
      expect(presentFacts).toHaveLength(1);
      expect(presentFacts[0].text).toContain('TechStart');
    });
  });

  describe('Search', () => {
    beforeEach(async () => {
      await storage.addFact({
        id: 'fact-1',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-2',
        relation: 'WORKS_AT',
        text: 'Alice works at TechStart',
        created_at: new Date(),
        validFrom: new Date(),
        episodeIds: ['ep-1'],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'default'
      });

      await storage.addFact({
        id: 'fact-2',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-3',
        relation: 'LIKES',
        text: 'Alice likes pizza',
        created_at: new Date(),
        validFrom: new Date(),
        episodeIds: ['ep-2'],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'default'
      });
    });

    it('should search by text', async () => {
      const results = await storage.searchFacts({
        actorId: 'actor-1',
        text: 'pizza'
      });

      expect(results).toHaveLength(1);
      expect(results[0].text).toContain('pizza');
    });

    it('should search by relation', async () => {
      const results = await storage.searchFacts({
        actorId: 'actor-1',
        text: 'WORKS_AT'
      });

      expect(results).toHaveLength(1);
      expect(results[0].relation).toBe('WORKS_AT');
    });

    it('should respect limit', async () => {
      const results = await storage.searchFacts({
        actorId: 'actor-1',
        limit: 1
      });

      expect(results).toHaveLength(1);
    });

    it('should filter by graph_id', async () => {
      await storage.addFact({
        id: 'fact-3',
        sourceEntityId: 'ent-4',
        targetEntityId: 'ent-5',
        relation: 'KNOWS',
        text: 'Bob knows Charlie',
        created_at: new Date(),
        validFrom: new Date(),
        episodeIds: ['ep-3'],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'other'
      });

      const defaultResults = await storage.searchFacts({
        actorId: 'actor-1',
        graph_id: 'default'
      });

      expect(defaultResults).toHaveLength(2);
      expect(defaultResults.every(f => f.graph_id === 'default')).toBe(true);
    });
  });

  describe('Lifecycle', () => {
    it('should clear all data on close', async () => {
      await storage.addEpisode({
        id: 'ep-1',
        content: 'Test',
        source: 'message',
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'default'
      });

      await storage.close();

      const episodes = await storage.getEpisodes('actor-1', 'default');
      expect(episodes).toHaveLength(0);
    });
  });
});
