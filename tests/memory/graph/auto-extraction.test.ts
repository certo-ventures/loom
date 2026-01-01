import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActorMemory } from '../../../src/memory/graph/actor-memory';
import { InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage';
import { LamportClock } from '../../../src/timing/lamport-clock';
import { MemoryExtractor } from '../../../src/memory/graph/extractor';

describe('ActorMemory - Auto-Extraction', () => {
  let storage: InMemoryGraphStorage;
  let clock: LamportClock;
  let extractor: MemoryExtractor;
  let mockFetch: any;

  beforeEach(() => {
    storage = new InMemoryGraphStorage();
    clock = new LamportClock();
    
    // Mock fetch for LLM calls
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    extractor = new MemoryExtractor({
      endpoint: 'https://api.openai.com',
      apiKey: 'test-key',
      model: 'gpt-4'
    });
  });

  it('should auto-extract entities and facts from episodes', async () => {
    const memory = new ActorMemory('actor-1', storage, clock, { extractor });

    // Mock LLM response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [
                { name: 'Alice', type: 'person' },
                { name: 'TechStart', type: 'company' }
              ],
              facts: [
                {
                  sourceEntity: 'Alice',
                  relation: 'works_at',
                  targetEntity: 'TechStart',
                  text: 'Alice works at TechStart',
                  confidence: 0.95
                }
              ]
            })
          }
        }]
      })
    });

    // Add episode - should trigger auto-extraction
    await memory.addEpisode('Alice works at TechStart');

    // Verify entities were created
    const entities = await memory.getEntities();
    expect(entities).toHaveLength(2);
    expect(entities.find(e => e.name === 'Alice')).toBeTruthy();
    expect(entities.find(e => e.name === 'TechStart')).toBeTruthy();

    // Verify fact was created
    const facts = await memory.getCurrentFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].relation).toBe('works_at');
    expect(facts[0].text).toBe('Alice works at TechStart');
    expect(facts[0].source).toBe('auto_extracted');
    expect(facts[0].confidence).toBe(0.95);
  });

  it('should handle multiple facts from one episode', async () => {
    const memory = new ActorMemory('actor-1', storage, clock, { extractor });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [
                { name: 'Alice', type: 'person' },
                { name: 'Bob', type: 'person' },
                { name: 'pizza', type: 'food' }
              ],
              facts: [
                {
                  sourceEntity: 'Alice',
                  relation: 'likes',
                  targetEntity: 'pizza',
                  text: 'Alice likes pizza',
                  confidence: 0.9
                },
                {
                  sourceEntity: 'Bob',
                  relation: 'likes',
                  targetEntity: 'pizza',
                  text: 'Bob likes pizza',
                  confidence: 0.9
                },
                {
                  sourceEntity: 'Alice',
                  relation: 'knows',
                  targetEntity: 'Bob',
                  text: 'Alice knows Bob',
                  confidence: 0.85
                }
              ]
            })
          }
        }]
      })
    });

    await memory.addEpisode('Alice and Bob both like pizza. They know each other.');

    const entities = await memory.getEntities();
    expect(entities).toHaveLength(3);

    const facts = await memory.getCurrentFacts();
    expect(facts).toHaveLength(3);
  });

  it('should work without extractor (manual mode)', async () => {
    // No extractor provided
    const memory = new ActorMemory('actor-1', storage, clock);

    await memory.addEpisode('Alice works at TechStart');

    // Episode added but no extraction
    const episodes = await memory.getRecentEpisodes();
    expect(episodes).toHaveLength(1);

    const entities = await memory.getEntities();
    expect(entities).toHaveLength(0);

    const facts = await memory.getCurrentFacts();
    expect(facts).toHaveLength(0);

    // Should not have called LLM
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should reuse existing entities across episodes', async () => {
    const memory = new ActorMemory('actor-1', storage, clock, { extractor });

    // First episode
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [
                { name: 'Alice', type: 'person' },
                { name: 'pizza', type: 'food' }
              ],
              facts: [
                {
                  sourceEntity: 'Alice',
                  relation: 'likes',
                  targetEntity: 'pizza',
                  text: 'Alice likes pizza',
                  confidence: 0.9
                }
              ]
            })
          }
        }]
      })
    });

    await memory.addEpisode('Alice likes pizza');

    // Second episode - Alice mentioned again
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [
                { name: 'Alice', type: 'person' },
                { name: 'pasta', type: 'food' }
              ],
              facts: [
                {
                  sourceEntity: 'Alice',
                  relation: 'likes',
                  targetEntity: 'pasta',
                  text: 'Alice likes pasta',
                  confidence: 0.9
                }
              ]
            })
          }
        }]
      })
    });

    await memory.addEpisode('Alice also likes pasta');

    // Should have 3 entities (Alice, pizza, pasta) not 4
    const entities = await memory.getEntities();
    expect(entities).toHaveLength(3);
    expect(entities.filter(e => e.name === 'Alice')).toHaveLength(1);

    const facts = await memory.getCurrentFacts();
    expect(facts).toHaveLength(2);
  });

  it('should handle extraction errors gracefully', async () => {
    const memory = new ActorMemory('actor-1', storage, clock, { extractor });

    // Mock LLM error
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    });

    // Should not throw - episode still created
    await expect(memory.addEpisode('Some text')).resolves.toBeTruthy();

    // Episode created
    const episodes = await memory.getRecentEpisodes();
    expect(episodes).toHaveLength(1);

    // But no entities/facts
    const entities = await memory.getEntities();
    expect(entities).toHaveLength(0);
  });

  it('should link facts to episode as evidence', async () => {
    const memory = new ActorMemory('actor-1', storage, clock, { extractor });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [
                { name: 'Alice', type: 'person' },
                { name: 'TechStart', type: 'company' }
              ],
              facts: [
                {
                  sourceEntity: 'Alice',
                  relation: 'works_at',
                  targetEntity: 'TechStart',
                  text: 'Alice works at TechStart',
                  confidence: 0.95
                }
              ]
            })
          }
        }]
      })
    });

    const episodeId = await memory.addEpisode('Alice works at TechStart');

    const facts = await memory.getCurrentFacts();
    expect(facts[0].episodeIds).toContain(episodeId);
  });

  it('should handle empty extraction results', async () => {
    const memory = new ActorMemory('actor-1', storage, clock, { extractor });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [],
              facts: []
            })
          }
        }]
      })
    });

    await memory.addEpisode('The weather is nice today');

    const entities = await memory.getEntities();
    expect(entities).toHaveLength(0);

    const facts = await memory.getCurrentFacts();
    expect(facts).toHaveLength(0);
  });

  it('should include entity summaries when provided', async () => {
    const memory = new ActorMemory('actor-1', storage, clock, { extractor });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [
                { 
                  name: 'Alice', 
                  type: 'person',
                  summary: 'Senior software engineer who loves Italian food'
                }
              ],
              facts: []
            })
          }
        }]
      })
    });

    await memory.addEpisode('Meet Alice, a senior software engineer who loves Italian food');

    const entities = await memory.getEntities();
    expect(entities[0].summary).toBe('Senior software engineer who loves Italian food');
  });
});
