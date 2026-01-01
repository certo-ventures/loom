import { describe, it, expect, beforeEach } from 'vitest';
import { cosineSimilarity, InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage';
import type { Fact } from '../../../src/memory/graph/types';

describe('Cosine Similarity', () => {
  it('should return 1 for identical vectors', () => {
    const vec = [1, 2, 3];
    expect(cosineSimilarity(vec, vec)).toBe(1);
  });

  it('should return 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBe(0);
  });

  it('should return -1 for opposite vectors', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(-1, 5);
  });

  it('should calculate similarity for realistic embeddings', () => {
    // Similar concepts should have high similarity
    const food = [0.8, 0.2, 0.1];
    const pizza = [0.75, 0.25, 0.15];
    const similarity = cosineSimilarity(food, pizza);
    expect(similarity).toBeGreaterThan(0.9);
  });

  it('should handle zero vectors', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('should throw error for mismatched dimensions', () => {
    const a = [1, 2, 3];
    const b = [1, 2];
    expect(() => cosineSimilarity(a, b)).toThrow('Vector dimensions must match');
  });
});

describe('InMemoryGraphStorage - Semantic Search', () => {
  let storage: InMemoryGraphStorage;

  beforeEach(() => {
    storage = new InMemoryGraphStorage();
  });

  it('should find facts by embedding similarity', async () => {
    // Add facts with embeddings
    const fact1: Fact = {
      id: 'f1',
      sourceEntityId: 'alice',
      targetEntityId: 'pizza',
      relation: 'likes',
      text: 'Alice likes pizza',
      created_at: new Date(),
      lamport_ts: 1,
      validFrom: new Date('2024-01-01'),
      episodeIds: [],
      source: 'user_input',
      actorId: 'actor-1',
      graph_id: 'default',
      embedding: [0.8, 0.2, 0.1] // "food" embedding
    };

    const fact2: Fact = {
      id: 'f2',
      sourceEntityId: 'bob',
      targetEntityId: 'math',
      relation: 'studies',
      text: 'Bob studies math',
      created_at: new Date(),
      lamport_ts: 2,
      validFrom: new Date('2024-01-01'),
      episodeIds: [],
      source: 'user_input',
      actorId: 'actor-1',
      graph_id: 'default',
      embedding: [0.1, 0.1, 0.9] // "education" embedding
    };

    const fact3: Fact = {
      id: 'f3',
      sourceEntityId: 'charlie',
      targetEntityId: 'pasta',
      relation: 'loves',
      text: 'Charlie loves pasta',
      created_at: new Date(),
      lamport_ts: 3,
      validFrom: new Date('2024-01-01'),
      episodeIds: [],
      source: 'user_input',
      actorId: 'actor-1',
      graph_id: 'default',
      embedding: [0.75, 0.25, 0.15] // Similar to "food"
    };

    await storage.addFact(fact1);
    await storage.addFact(fact2);
    await storage.addFact(fact3);

    // Search with "food" embedding
    const results = await storage.searchFacts({
      actorId: 'actor-1',
      graph_id: 'default',
      embedding: [0.8, 0.2, 0.1]
    });

    // Should return facts sorted by similarity
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe('f1'); // Exact match
    expect(results[1].id).toBe('f3'); // Similar (pasta/food)
    expect(results[2].id).toBe('f2'); // Different (math/education)
  });

  it('should limit semantic search results', async () => {
    // Add 3 facts
    for (let i = 0; i < 3; i++) {
      await storage.addFact({
        id: `f${i}`,
        sourceEntityId: 'user',
        targetEntityId: 'thing',
        relation: 'likes',
        text: `Fact ${i}`,
        created_at: new Date(),
        lamport_ts: i + 1,
        validFrom: new Date(),
        episodeIds: [],
        source: 'user_input',
        actorId: 'actor-1',
        graph_id: 'default',
        embedding: [Math.random(), Math.random(), Math.random()]
      });
    }

    const results = await storage.searchFacts({
      actorId: 'actor-1',
      graph_id: 'default',
      embedding: [0.5, 0.5, 0.5],
      limit: 2
    });

    expect(results).toHaveLength(2);
  });

  it('should only search facts with embeddings', async () => {
    const withEmbedding: Fact = {
      id: 'f1',
      sourceEntityId: 'alice',
      targetEntityId: 'pizza',
      relation: 'likes',
      text: 'Alice likes pizza',
      created_at: new Date(),
      lamport_ts: 1,
      validFrom: new Date(),
      episodeIds: [],
      source: 'user_input',
      actorId: 'actor-1',
      graph_id: 'default',
      embedding: [0.8, 0.2, 0.1]
    };

    const withoutEmbedding: Fact = {
      id: 'f2',
      sourceEntityId: 'bob',
      targetEntityId: 'math',
      relation: 'studies',
      text: 'Bob studies math',
      created_at: new Date(),
      lamport_ts: 2,
      validFrom: new Date(),
      episodeIds: [],
      source: 'user_input',
      actorId: 'actor-1',
      graph_id: 'default'
      // No embedding
    };

    await storage.addFact(withEmbedding);
    await storage.addFact(withoutEmbedding);

    const results = await storage.searchFacts({
      actorId: 'actor-1',
      graph_id: 'default',
      embedding: [0.8, 0.2, 0.1]
    });

    // Should only return fact with embedding
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('f1');
  });

  it('should combine text and semantic search', async () => {
    const fact1: Fact = {
      id: 'f1',
      sourceEntityId: 'alice',
      targetEntityId: 'pizza',
      relation: 'likes',
      text: 'Alice likes pizza',
      created_at: new Date(),
      lamport_ts: 1,
      validFrom: new Date(),
      episodeIds: [],
      source: 'user_input',
      actorId: 'actor-1',
      graph_id: 'default',
      embedding: [0.8, 0.2, 0.1]
    };

    const fact2: Fact = {
      id: 'f2',
      sourceEntityId: 'alice',
      targetEntityId: 'pasta',
      relation: 'likes',
      text: 'Alice likes pasta',
      created_at: new Date(),
      lamport_ts: 2,
      validFrom: new Date(),
      episodeIds: [],
      source: 'user_input',
      actorId: 'actor-1',
      graph_id: 'default',
      embedding: [0.75, 0.25, 0.15]
    };

    const fact3: Fact = {
      id: 'f3',
      sourceEntityId: 'bob',
      targetEntityId: 'pizza',
      relation: 'dislikes',
      text: 'Bob dislikes pizza',
      created_at: new Date(),
      lamport_ts: 3,
      validFrom: new Date(),
      episodeIds: [],
      source: 'user_input',
      actorId: 'actor-1',
      graph_id: 'default',
      embedding: [0.78, 0.22, 0.12]
    };

    await storage.addFact(fact1);
    await storage.addFact(fact2);
    await storage.addFact(fact3);

    // Search for "Alice" + food-related embedding
    const results = await storage.searchFacts({
      actorId: 'actor-1',
      graph_id: 'default',
      text: 'Alice',
      embedding: [0.8, 0.2, 0.1]
    });

    // Should only return Alice's facts, sorted by embedding similarity
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('f1'); // Alice + exact embedding match
    expect(results[1].id).toBe('f2'); // Alice + similar embedding
  });
});
