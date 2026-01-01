/**
 * Tests for Actor integration with graph memory
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Actor } from '../../src/actor/actor';
import { ActorMemory } from '../../src/memory/graph/actor-memory';
import { InMemoryGraphStorage } from '../../src/memory/graph/in-memory-storage';
import { LamportClock } from '../../src/timing/lamport-clock';

class TestActor extends Actor {
  async execute(input: any): Promise<any> {
    return { processed: input };
  }

  // Expose protected methods for testing
  public async testRememberFact(...args: Parameters<typeof this.rememberFact>) {
    return this.rememberFact(...args);
  }

  public async testRememberEpisode(...args: Parameters<typeof this.rememberEpisode>) {
    return this.rememberEpisode(...args);
  }

  public async testRecallFacts(...args: Parameters<typeof this.recallFacts>) {
    return this.recallFacts(...args);
  }
}

describe('Actor - Graph Memory Integration', () => {
  let actor: TestActor;
  let graphMemory: ActorMemory;
  let storage: InMemoryGraphStorage;
  let clock: LamportClock;

  beforeEach(() => {
    storage = new InMemoryGraphStorage();
    clock = new LamportClock();
    graphMemory = new ActorMemory('test-actor', storage, clock, 'test-graph');

    actor = new TestActor(
      {
        actorId: 'test-actor',
        tenantId: 'test-tenant',
        actorType: 'test-type',
        threadId: 'test-thread',
      },
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      clock,
      graphMemory
    );
  });

  describe('rememberFact', () => {
    it('should store a fact in graph memory', async () => {
      const entityId1 = await graphMemory.addEntity('Alice', 'person');
      const entityId2 = await graphMemory.addEntity('Seattle', 'city');

      const factId = await actor.testRememberFact(
        entityId1,
        'lives_in',
        entityId2,
        'Alice lives in Seattle',
        { confidence: 0.95 }
      );

      expect(factId).toBeDefined();

      const facts = await graphMemory.search({ source_entity_ids: [entityId1] });
      expect(facts).toHaveLength(1);
      expect(facts[0].relation).toBe('lives_in');
      expect(facts[0].confidence).toBe(0.95);
    });

    it('should warn if graphMemory not configured', async () => {
      const actorWithoutMemory = new TestActor(
        {
          actorId: 'test-actor-2',
          tenantId: 'test-tenant',
          actorType: 'test-type',
          threadId: 'test-thread',
        }
      );

      const consoleWarn = console.warn;
      let warnCalled = false;
      console.warn = () => { warnCalled = true; };

      const result = await actorWithoutMemory.testRememberFact(
        'e1',
        'rel',
        'e2',
        'test'
      );

      console.warn = consoleWarn;

      expect(result).toBeUndefined();
      expect(warnCalled).toBe(true);
    });
  });

  describe('rememberEpisode', () => {
    it('should store an episode in memory', async () => {
      const episodeId = await actor.testRememberEpisode(
        'User asked about weather',
        'message'
      );

      expect(episodeId).toBeDefined();

      const episodes = await graphMemory.getRecentEpisodes(10);
      expect(episodes).toHaveLength(1);
      expect(episodes[0].content).toBe('User asked about weather');
      expect(episodes[0].source).toBe('message');
    });

    it('should store JSON episodes', async () => {
      const jsonContent = JSON.stringify({
        type: 'query',
        user: 'alice',
        text: 'What is the weather?',
      });

      const episodeId = await actor.testRememberEpisode(jsonContent, 'json');

      expect(episodeId).toBeDefined();

      const episodes = await graphMemory.getRecentEpisodes(10);
      expect(episodes[0].source).toBe('json');
      expect(episodes[0].content).toContain('alice');
    });
  });

  describe('recallFacts', () => {
    it('should retrieve facts by entity', async () => {
      // Use fresh storage for this test
      const testStorage = new InMemoryGraphStorage();
      const testClock = new LamportClock();
      const testMemory = new ActorMemory('test-actor-1', testStorage, testClock, 'test-graph-1');
      const testActor = new TestActor(
        { actorId: 'test-actor-1', tenantId: 'test', actorType: 'test', threadId: 'test' },
        {}, undefined, undefined, undefined, undefined, testClock, testMemory
      );

      const aliceId = await testMemory.addEntity('Alice', 'person');
      const seattleId = await testMemory.addEntity('Seattle', 'city');
      const coffeId = await testMemory.addEntity('coffee', 'beverage');

      await testActor.testRememberFact(aliceId, 'lives_in', seattleId, 'Alice lives in Seattle');
      await testActor.testRememberFact(aliceId, 'likes', coffeId, 'Alice likes coffee');

      const facts = await testActor.testRecallFacts({
        source_entity_ids: [aliceId],
      });

      expect(facts).toHaveLength(2);
      expect(facts.map(f => f.relation).sort()).toEqual(['likes', 'lives_in']);
    });

    it('should retrieve facts by relation', async () => {
      // Use fresh storage for this test
      const testStorage = new InMemoryGraphStorage();
      const testClock = new LamportClock();
      const testMemory = new ActorMemory('test-actor-2', testStorage, testClock, 'test-graph-2');
      const testActor = new TestActor(
        { actorId: 'test-actor-2', tenantId: 'test', actorType: 'test', threadId: 'test' },
        {}, undefined, undefined, undefined, undefined, testClock, testMemory
      );

      const aliceId = await testMemory.addEntity('Alice', 'person');
      const bobId = await testMemory.addEntity('Bob', 'person');
      const seattleId = await testMemory.addEntity('Seattle', 'city');

      await testActor.testRememberFact(aliceId, 'lives_in', seattleId, 'Alice lives in Seattle');
      await testActor.testRememberFact(bobId, 'lives_in', seattleId, 'Bob lives in Seattle');
      await testActor.testRememberFact(aliceId, 'knows', bobId, 'Alice knows Bob');

      const facts = await testActor.testRecallFacts({
        relations: ['lives_in'],
      });

      expect(facts).toHaveLength(2);
      expect(facts.every(f => f.relation === 'lives_in')).toBe(true);
    });

    it('should retrieve facts with temporal constraints', async () => {
      // Use fresh storage for this test
      const testStorage = new InMemoryGraphStorage();
      const testClock = new LamportClock();
      const testMemory = new ActorMemory('test-actor-3', testStorage, testClock, 'test-graph-3');
      const testActor = new TestActor(
        { actorId: 'test-actor-3', tenantId: 'test', actorType: 'test', threadId: 'test' },
        {}, undefined, undefined, undefined, undefined, testClock, testMemory
      );

      const orderId = await testMemory.addEntity('ORD-123', 'order');
      const statusPending = await testMemory.addEntity('pending', 'status');
      const statusShipped = await testMemory.addEntity('shipped', 'status');

      // Order was pending
      await testActor.testRememberFact(
        orderId,
        'has_status',
        statusPending,
        'Order is pending',
        { validFrom: new Date('2024-12-01') }
      );

      // Then it shipped
      await testActor.testRememberFact(
        orderId,
        'has_status',
        statusShipped,
        'Order is shipped',
        { validFrom: new Date('2024-12-15') }
      );

      // Query as of Dec 10 (should see pending)
      const factsBeforeShipping = await testActor.testRecallFacts({
        source_entity_ids: [orderId],
        asOf: new Date('2024-12-10'),
      });

      expect(factsBeforeShipping).toHaveLength(1);
      expect(factsBeforeShipping[0].targetEntityId).toBe(statusPending);

      // Query as of Dec 20 (should see both, no validUntil set)
      const factsAfterShipping = await testActor.testRecallFacts({
        source_entity_ids: [orderId],
        asOf: new Date('2024-12-20'),
      });

      expect(factsAfterShipping).toHaveLength(2);
    });

    it('should return empty array if graphMemory not configured', async () => {
      const actorWithoutMemory = new TestActor(
        {
          actorId: 'test-actor-2',
          tenantId: 'test-tenant',
          actorType: 'test-type',
          threadId: 'test-thread',
        }
      );

      const facts = await actorWithoutMemory.testRecallFacts({});
      expect(facts).toEqual([]);
    });
  });

  describe('Lamport Clock Integration', () => {
    it('should use shared Lamport clock for memory operations', async () => {
      // Tick the actor's clock manually
      actor.tickLogicalTime();
      actor.tickLogicalTime();
      expect(actor.getCurrentLogicalTime()).toBe(2);

      // Add a fact (should increment clock)
      const e1 = await graphMemory.addEntity('Entity1', 'test');
      const e2 = await graphMemory.addEntity('Entity2', 'test');
      await actor.testRememberFact(e1, 'relates_to', e2, 'Test relation');

      // Clock should have advanced
      expect(actor.getCurrentLogicalTime()).toBeGreaterThan(2);

      // Verify the fact has the Lamport timestamp
      const facts = await graphMemory.search({});
      expect(facts[0].lamport_ts).toBe(actor.getCurrentLogicalTime());
    });
  });

  describe('Coexistence with flat memory', () => {
    it('should work alongside MemoryAdapter helpers', async () => {
      // This test verifies that graph memory doesn't interfere with
      // the existing MemoryAdapter system
      
      // Both can be undefined
      const actor1 = new TestActor({
        actorId: 'test-1',
        tenantId: 'test',
        actorType: 'test',
        threadId: 'test',
      });
      expect(actor1['memoryAdapter']).toBeUndefined();
      expect(actor1['graphMemory']).toBeUndefined();

      // Graph memory can be added independently
      const storage2 = new InMemoryGraphStorage();
      const clock2 = new LamportClock();
      const graphMem2 = new ActorMemory('test-2', storage2, clock2, 'graph-2');
      
      const actor2 = new TestActor(
        {
          actorId: 'test-2',
          tenantId: 'test',
          actorType: 'test',
          threadId: 'test',
        },
        {},
        undefined,
        undefined,
        undefined, // no MemoryAdapter
        undefined,
        clock2,
        graphMem2  // but has graphMemory
      );

      expect(actor2['memoryAdapter']).toBeUndefined();
      expect(actor2['graphMemory']).toBeDefined();

      // Should work correctly
      const e1 = await graphMem2.addEntity('Test', 'entity');
      const e2 = await graphMem2.addEntity('Test2', 'entity');
      const factId = await actor2.testRememberFact(e1, 'test', e2, 'test fact');
      expect(factId).toBeDefined();
    });
  });
});
