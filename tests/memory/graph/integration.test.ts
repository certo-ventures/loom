import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActorMemory } from '../../../src/memory/graph/actor-memory';
import { InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage';
import { LamportClock } from '../../../src/timing/lamport-clock';
import { MemoryExtractor } from '../../../src/memory/graph/extractor';

describe('Graph Memory Integration', () => {
  it('should handle a realistic conversation flow', async () => {
    const storage = new InMemoryGraphStorage();
    const clock = new LamportClock();
    const memory = new ActorMemory('chatbot-1', storage, clock);

    // === Turn 1: User introduces themselves ===
    const ep1 = await memory.addEpisode('Hi, I\'m Alice and I work at TechStart');
    
    const aliceId = await memory.addEntity('Alice', 'person', 'The user');
    const techStartId = await memory.addEntity('TechStart', 'company', 'A tech startup');
    
    await memory.addFact(
      aliceId,
      'WORKS_AT',
      techStartId,
      'Alice works at TechStart',
      { episodeIds: [ep1] }
    );

    // Verify we captured the fact
    let facts = await memory.getCurrentFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toBe('Alice works at TechStart');

    // === Turn 2: User mentions a preference ===
    const ep2 = await memory.addEpisode('I love working on AI projects');
    const aiProjectsId = await memory.addEntity('AI projects', 'topic');
    
    await memory.addFact(
      aliceId,
      'INTERESTED_IN',
      aiProjectsId,
      'Alice is interested in AI projects',
      { episodeIds: [ep2] }
    );

    // === Turn 3: User changes jobs ===
    const ep3 = await memory.addEpisode('I just got a new job at MegaCorp!');
    const megaCorpId = await memory.addEntity('MegaCorp', 'company');
    
    // Invalidate old fact
    const oldFact = await memory.search('WORKS_AT');
    await memory.invalidateFact(oldFact[0].id);
    
    // Add new fact
    await memory.addFact(
      aliceId,
      'WORKS_AT',
      megaCorpId,
      'Alice works at MegaCorp',
      { episodeIds: [ep3] }
    );

    // === Verify temporal correctness ===
    facts = await memory.getCurrentFacts();
    const currentJobs = facts.filter(f => f.relation === 'WORKS_AT');
    expect(currentJobs).toHaveLength(1);
    expect(currentJobs[0].text).toBe('Alice works at MegaCorp');

    // === Test context assembly ===
    const context = await memory.composeContext('Alice work', { includeHistory: true });
    
    expect(context).toContain('## Current:');
    expect(context).toContain('Alice works at MegaCorp');
    
    expect(context).toContain('## Past:');
    expect(context).toContain('Alice works at TechStart');

    // === Test summary ===
    const summary = await memory.getSummary();
    expect(summary).toContain('Known facts: 2'); // INTERESTED_IN + current WORKS_AT
    expect(summary).toContain('Recent episodes: 3');

    // === Test search ===
    const aiResults = await memory.search('AI');
    expect(aiResults).toHaveLength(1);
    expect(aiResults[0].text).toContain('AI projects');

    // === Get all episodes ===
    const episodes = await memory.getRecentEpisodes();
    expect(episodes).toHaveLength(3);
    
    // Verify all episodes are present (order may vary due to timing)
    const contents = episodes.map(e => e.content);
    expect(contents).toContain('Hi, I\'m Alice and I work at TechStart');
    expect(contents).toContain('I love working on AI projects');
    expect(contents).toContain('I just got a new job at MegaCorp!');
  });

  it('should support shared knowledge graphs', async () => {
    const storage = new InMemoryGraphStorage();
    
    // Two agents working on the same shared graph
    const clock1 = new LamportClock();
    const clock2 = new LamportClock();
    const agent1 = new ActorMemory('agent-1', storage, clock1, { graph_id: 'company-knowledge' });
    const agent2 = new ActorMemory('agent-2', storage, clock2, { graph_id: 'company-knowledge' });

    // Agent 1 learns about employees
    const aliceId = await agent1.addEntity('Alice', 'employee');
    const bobId = await agent1.addEntity('Bob', 'employee');
    
    await agent1.addFact(aliceId, 'MANAGES', bobId, 'Alice manages Bob');

    // Agent 2 can see the same facts
    const facts = await agent2.getCurrentFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toBe('Alice manages Bob');

    // Agent 2 adds more knowledge
    const projectId = await agent2.addEntity('Project X', 'project');
    await agent2.addFact(bobId, 'WORKS_ON', projectId, 'Bob works on Project X');

    // Both agents see the complete graph
    const agent1Facts = await agent1.getCurrentFacts();
    const agent2Facts = await agent2.getCurrentFacts();
    
    expect(agent1Facts).toHaveLength(2);
    expect(agent2Facts).toHaveLength(2);
  });

  it('should handle complex temporal reasoning', async () => {
    const storage = new InMemoryGraphStorage();
    const clock = new LamportClock();
    const memory = new ActorMemory('temporal-test', storage, clock);

    const aliceId = await memory.addEntity('Alice', 'person');
    const comp1Id = await memory.addEntity('StartupCo', 'company');
    const comp2Id = await memory.addEntity('BigCorp', 'company');
    const comp3Id = await memory.addEntity('ScaleUp', 'company');

    // Add employment history with specific dates
    await memory.addFact(
      aliceId,
      'WORKS_AT',
      comp1Id,
      'Alice worked at StartupCo',
      { validFrom: new Date('2020-01-01') }
    );
    const fact1 = await memory.getCurrentFacts();
    await memory.invalidateFact(fact1[0].id, new Date('2022-06-01'));

    await memory.addFact(
      aliceId,
      'WORKS_AT',
      comp2Id,
      'Alice worked at BigCorp',
      { validFrom: new Date('2022-06-01') }
    );
    const fact2 = (await memory.getCurrentFacts()).filter(f => f.targetEntityId === comp2Id);
    await memory.invalidateFact(fact2[0].id, new Date('2024-01-01'));

    await memory.addFact(
      aliceId,
      'WORKS_AT',
      comp3Id,
      'Alice works at ScaleUp',
      { validFrom: new Date('2024-01-01') }
    );

    // Query at different points in time
    const in2021 = await memory.getFactsAt(new Date('2021-06-01'));
    expect(in2021).toHaveLength(1);
    expect(in2021[0].targetEntityId).toBe(comp1Id);

    const in2023 = await memory.getFactsAt(new Date('2023-06-01'));
    expect(in2023).toHaveLength(1);
    expect(in2023[0].targetEntityId).toBe(comp2Id);

    const in2024 = await memory.getFactsAt(new Date('2024-06-01'));
    expect(in2024).toHaveLength(1);
    expect(in2024[0].targetEntityId).toBe(comp3Id);
  });

  it('should demonstrate full workflow with context generation', async () => {
    const storage = new InMemoryGraphStorage();
    const clock = new LamportClock();
    const memory = new ActorMemory('assistant', storage, clock);

    // Simulate a multi-turn conversation
    await memory.addEpisode('User: My name is John and I love pizza');
    const johnId = await memory.addEntity('John', 'person', 'The user');
    const pizzaId = await memory.addEntity('Pizza', 'food');
    await memory.addFact(johnId, 'LIKES', pizzaId, 'John likes pizza');

    await memory.addEpisode('User: I also enjoy hiking on weekends');
    const hikingId = await memory.addEntity('Hiking', 'activity');
    await memory.addFact(johnId, 'ENJOYS', hikingId, 'John enjoys hiking');

    await memory.addEpisode('User: I work as a software engineer');
    const jobId = await memory.addEntity('Software Engineer', 'occupation');
    await memory.addFact(johnId, 'WORKS_AS', jobId, 'John is a software engineer');

    // Generate context for responding to a query about the user
    const context = await memory.composeContext('John');
    
    expect(context).toContain('# Relevant Facts');
    expect(context).toContain('John likes pizza');
    expect(context).toContain('John enjoys hiking');
    expect(context).toContain('John is a software engineer');

    // Get summary
    const summary = await memory.getSummary();
    expect(summary).toContain('Known facts: 3');
    expect(summary).toContain('Recent episodes: 3');

    // Search for specific information
    const hobbies = await memory.search('enjoys');
    expect(hobbies).toHaveLength(1);
    expect(hobbies[0].text).toContain('hiking');

    const food = await memory.search('likes');
    expect(food).toHaveLength(1);
    expect(food[0].text).toContain('pizza');
  });

  it('should demonstrate auto-extraction workflow', async () => {
    const storage = new InMemoryGraphStorage();
    const clock = new LamportClock();
    
    // Mock fetch for LLM
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    const extractor = new MemoryExtractor({
      endpoint: 'https://api.openai.com',
      apiKey: 'test-key',
      model: 'gpt-4'
    });

    const memory = new ActorMemory('assistant', storage, clock, { extractor });

    // First message - LLM extracts entities and relationships
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              entities: [
                { name: 'Sarah', type: 'person', summary: 'User with food preferences' },
                { name: 'TechCorp', type: 'company' },
                { name: 'pizza', type: 'food' }
              ],
              facts: [
                {
                  sourceEntity: 'Sarah',
                  relation: 'works_at',
                  targetEntity: 'TechCorp',
                  text: 'Sarah works at TechCorp',
                  confidence: 0.95
                },
                {
                  sourceEntity: 'Sarah',
                  relation: 'loves',
                  targetEntity: 'pizza',
                  text: 'Sarah loves pizza',
                  confidence: 0.9
                }
              ]
            })
          }
        }]
      })
    });

    await memory.addEpisode('Hi! My name is Sarah. I work at TechCorp and I absolutely love pizza!');

    // Verify auto-extraction worked
    const entities = await memory.getEntities();
    expect(entities.length).toBeGreaterThanOrEqual(3);
    expect(entities.find(e => e.name === 'Sarah')).toBeTruthy();
    expect(entities.find(e => e.name === 'TechCorp')).toBeTruthy();

    const facts = await memory.getCurrentFacts();
    expect(facts.length).toBeGreaterThanOrEqual(2);
    expect(facts.find(f => f.relation === 'works_at')).toBeTruthy();
    expect(facts.find(f => f.relation === 'loves')).toBeTruthy();

    // Second message - LLM adds new information
    mockFetch.mockResolvedValueOnce({
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
                }
              ]
            })
          }
        }]
      })
    });

    await memory.addEpisode('I live in Seattle by the way.');

    // Verify accumulated knowledge
    const allFacts = await memory.getCurrentFacts();
    expect(allFacts.length).toBeGreaterThanOrEqual(3);

    // Generate context using text search
    const context = await memory.composeContext('Sarah');
    expect(context).toContain('Sarah works at TechCorp');
    expect(context).toContain('Sarah loves pizza');
    expect(context).toContain('Sarah lives in Seattle');

    // All facts should be marked as auto-extracted
    allFacts.forEach(fact => {
      expect(fact.source).toBe('auto_extracted');
    });
  });});