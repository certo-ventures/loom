import { describe, it, expect } from 'vitest';
import type { Episode, Entity, Fact, MemoryQuery } from '../../../src/memory/graph/types';

describe('Graph Memory Types', () => {
  describe('Episode', () => {
    it('should create valid episode with all required fields', () => {
      const episode: Episode = {
        id: 'ep-1',
        content: 'User mentioned they like pizza',
        source: 'message',
        sequence: 1,
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'default'
      };
      
      expect(episode.id).toBe('ep-1');
      expect(episode.content).toBe('User mentioned they like pizza');
      expect(episode.source).toBe('message');
      expect(episode.sequence).toBe(1);
      expect(episode.actorId).toBe('actor-1');
      expect(episode.graph_id).toBe('default');
      expect(episode.created_at).toBeInstanceOf(Date);
    });
    
    it('should support optional embedding fields', () => {
      const episode: Episode = {
        id: 'ep-1',
        content: 'Test',
        source: 'text',
        sequence: 1,
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'default',
        embedding: [0.1, 0.2, 0.3],
        embedding_ref: 'vec-123'
      };
      
      expect(episode.embedding).toHaveLength(3);
      expect(episode.embedding_ref).toBe('vec-123');
    });
  });

  describe('Entity', () => {
    it('should create valid entity with required fields', () => {
      const entity: Entity = {
        id: 'ent-1',
        name: 'Alice',
        type: 'person',
        sequence: 1,
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'default'
      };
      
      expect(entity.name).toBe('Alice');
      expect(entity.type).toBe('person');
    });
    
    it('should support optional summary', () => {
      const entity: Entity = {
        id: 'ent-1',
        name: 'TechStart',
        type: 'company',
        summary: 'A tech startup focused on AI',
        sequence: 1,
        created_at: new Date(),
        actorId: 'actor-1',
        graph_id: 'default',
        summary_embedding: [0.5, 0.6]
      };
      
      expect(entity.summary).toContain('AI');
      expect(entity.summary_embedding).toHaveLength(2);
    });
  });

  describe('Fact', () => {
    it('should create valid fact with temporal fields', () => {
      const now = new Date();
      const fact: Fact = {
        id: 'fact-1',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-2',
        relation: 'WORKS_AT',
        text: 'Alice works at TechStart',
        created_at: now,
        lamport_ts: 1,
        validFrom: now,
        episodeIds: ['ep-1'],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'default'
      };
      
      expect(fact.relation).toBe('WORKS_AT');
      expect(fact.text).toBe('Alice works at TechStart');
      expect(fact.lamport_ts).toBe(1);
      expect(fact.validFrom).toEqual(now);
      expect(fact.validUntil).toBeUndefined();
    });
    
    it('should support fact invalidation with validUntil', () => {
      const start = new Date('2024-01-01');
      const end = new Date('2024-06-01');
      
      const fact: Fact = {
        id: 'fact-1',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-2',
        relation: 'WORKS_AT',
        text: 'Alice worked at OldCorp',
        created_at: start,
        lamport_ts: 2,
        validFrom: start,
        validUntil: end,
        episodeIds: ['ep-1'],
        source: 'auto_extracted',
        confidence: 0.92,
        actorId: 'actor-1',
        graph_id: 'default'
      };
      
      expect(fact.validUntil).toEqual(end);
      expect(fact.source).toBe('auto_extracted');
      expect(fact.confidence).toBe(0.92);
    });
  });

  describe('MemoryQuery', () => {
    it('should create minimal query', () => {
      const query: MemoryQuery = {
        actorId: 'actor-1'
      };
      
      expect(query.actorId).toBe('actor-1');
    });
    
    it('should support all query options', () => {
      const query: MemoryQuery = {
        actorId: 'actor-1',
        graph_id: 'shared',
        text: 'work history',
        embedding: [0.1, 0.2],
        asOf: new Date('2024-06-01'),
        limit: 10
      };
      
      expect(query.text).toBe('work history');
      expect(query.limit).toBe(10);
      expect(query.asOf).toBeInstanceOf(Date);
    });
  });
});
