/**
 * REAL End-to-End Integration Tests
 * 
 * Tests the ACTUAL system with:
 * - REAL BullMQ/Redis (from Docker)
 * - REAL actor-to-actor communication
 * - REAL workflow execution
 * - REAL durable messaging
 * 
 * Prerequisites:
 * - Docker running with Redis: docker run -d -p 6379:6379 redis:alpine
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Redis from 'ioredis';
import { Actor, ActorContext } from '../../actor';
import { BullMQMessageQueue } from '../../storage/bullmq-message-queue';
import { InMemoryActorRegistry, DiscoveryService } from '../../discovery';
import { InMemoryCosmos } from '../../storage/in-memory-cosmos';
import { InMemoryBlobStorage } from '../../storage/in-memory-blob';
import { ActorWorker } from '../../runtime/actor-worker';

// ============================================================================
// TEST ACTORS
// ============================================================================

class CounterActor extends Actor {
  protected getDefaultState() {
    return { count: 0 };
  }

  async execute(input: any): Promise<void> {
    const { action, amount } = input;

    switch (action) {
      case 'increment':
        this.updateState({ count: (this.state.count as number) + (amount || 1) });
        break;
      case 'decrement':
        this.updateState({ count: (this.state.count as number) - (amount || 1) });
        break;
      case 'reset':
        this.updateState({ count: 0 });
        break;
    }
  }

  getCount(): number {
    return this.state.count as number;
  }
}

class MessengerActor extends Actor {
  protected getDefaultState() {
    return { messages: [] };
  }

  async execute(input: any): Promise<void> {
    const { action, message, targetActorId } = input;

    switch (action) {
      case 'send':
        // Store message locally
        const messages = this.state.messages as any[];
        this.updateState({ messages: [...messages, { to: targetActorId, text: message }] });
        
        // Send to another actor via message queue
        if (targetActorId) {
          await this.context.messageQueue.enqueue(`actor:${targetActorId}`, {
            messageId: `msg-${Date.now()}`,
            actorId: targetActorId,
            method: 'execute',
            args: { action: 'receive', message, from: this.context.actorId },
          });
        }
        break;

      case 'receive':
        const msgs = this.state.messages as any[];
        this.updateState({ messages: [...msgs, { from: input.from, text: message }] });
        break;
    }
  }

  getMessages(): any[] {
    return this.state.messages as any[];
  }
}

class CalculatorActor extends Actor {
  protected getDefaultState() {
    return { result: 0, history: [] };
  }

  async execute(input: any): Promise<void> {
    const { operation, a, b } = input;
    let result: number;

    switch (operation) {
      case 'add':
        result = a + b;
        break;
      case 'subtract':
        result = a - b;
        break;
      case 'multiply':
        result = a * b;
        break;
      case 'divide':
        if (b === 0) throw new Error('Division by zero');
        result = a / b;
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    const history = this.state.history as any[];
    this.updateState({
      result,
      history: [...history, { operation, a, b, result }],
    });
  }

  getResult(): number {
    return this.state.result as number;
  }

  getHistory(): any[] {
    return this.state.history as any[];
  }
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe.skip('End-to-End Integration Tests (REAL Redis/BullMQ)', () => {
  let redis: Redis;
  let messageQueue: BullMQMessageQueue;
  let registry: InMemoryActorRegistry;
  let discovery: DiscoveryService;
  let cosmos: InMemoryCosmos;
  let blob: InMemoryBlobStorage;
  let workers: ActorWorker[] = [];

  beforeAll(async () => {
    // Connect to REAL Redis (Docker)
    redis = new Redis({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    });

    // Test Redis connection
    try {
      await redis.ping();
      console.log('✅ Connected to Redis');
    } catch (error) {
      console.error('❌ Redis not available - is Docker running?');
      throw error;
    }

    // Setup REAL infrastructure
    messageQueue = new BullMQMessageQueue(redis);
    registry = new InMemoryActorRegistry();
    discovery = new DiscoveryService(registry);
    cosmos = new InMemoryCosmos();
    blob = new InMemoryBlobStorage();
  });

  afterAll(async () => {
    // Cleanup workers
    for (const worker of workers) {
      await worker.stop();
    }

    // Close Redis connection
    await redis.quit();
  });

  beforeEach(async () => {
    // Clean slate for each test
    await cosmos.clear();
    await blob.clear();
    // registry doesn't have a clear method - actors are registered per test
  });

  it('sends messages through REAL BullMQ between actors', async () => {
    // Create and register counter actor
    const counter = new CounterActor({
      actorId: 'counter-1',
      actorType: 'Counter',
      messageQueue,
    } as ActorContext);

    await registry.register({
      actorId: 'counter-1',
      actorType: 'Counter',
      workerId: 'worker-1',
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      messageCount: 0,
    });

    // Enqueue message via REAL BullMQ
    await messageQueue.enqueue('actor:counter-1', {
      messageId: 'msg-1',
      actorId: 'counter-1',
      method: 'execute',
      args: { action: 'increment', amount: 5 },
    });

    // Create worker to process the message
    const worker = new ActorWorker({
      workerId: 'worker-1',
      messageQueue,
      stateStore: cosmos as any,
      discoveryService: discovery,
      actorFactory: (ctx) => {
        if (ctx.actorType === 'Counter') {
          return new CounterActor(ctx);
        }
        throw new Error('Unknown actor type');
      },
    });

    workers.push(worker);
    await worker.start();

    // Wait for message to be processed
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify actor state was updated
    expect(counter.getCount()).toBe(5);
  });

  it('performs actor-to-actor communication via REAL message queue', async () => {
    const messenger1 = new MessengerActor({
      actorId: 'messenger-1',
      actorType: 'Messenger',
      messageQueue,
    } as ActorContext);

    const messenger2 = new MessengerActor({
      actorId: 'messenger-2',
      actorType: 'Messenger',
      messageQueue,
    } as ActorContext);

    await registry.register({
      actorId: 'messenger-1',
      actorType: 'Messenger',
      workerId: 'worker-1',
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      messageCount: 0,
    });

    await registry.register({
      actorId: 'messenger-2',
      actorType: 'Messenger',
      workerId: 'worker-1',
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      messageCount: 0,
    });

    // Messenger 1 sends message to Messenger 2
    await messageQueue.enqueue('actor:messenger-1', {
      messageId: 'msg-1',
      actorId: 'messenger-1',
      method: 'execute',
      args: {
        action: 'send',
        message: 'Hello from Messenger 1!',
        targetActorId: 'messenger-2',
      },
    });

    // Create worker
    const actorInstances = new Map<string, Actor>([
      ['messenger-1', messenger1],
      ['messenger-2', messenger2],
    ]);

    const worker = new ActorWorker({
      workerId: 'worker-1',
      messageQueue,
      stateStore: cosmos as any,
      discoveryService: discovery,
      actorFactory: (ctx) => {
        const actor = actorInstances.get(ctx.actorId);
        if (actor) return actor;
        throw new Error('Unknown actor');
      },
    });

    workers.push(worker);
    await worker.start();

    // Wait for messages to propagate
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify both actors have messages
    expect(messenger1.getMessages()).toHaveLength(1);
    expect(messenger1.getMessages()[0]).toMatchObject({
      to: 'messenger-2',
      text: 'Hello from Messenger 1!',
    });

    expect(messenger2.getMessages()).toHaveLength(1);
    expect(messenger2.getMessages()[0]).toMatchObject({
      from: 'messenger-1',
      text: 'Hello from Messenger 1!',
    });
  });

  it('processes multiple actors concurrently', async () => {
    const calc1 = new CalculatorActor({
      actorId: 'calc-1',
      actorType: 'Calculator',
      messageQueue,
    } as ActorContext);

    const calc2 = new CalculatorActor({
      actorId: 'calc-2',
      actorType: 'Calculator',
      messageQueue,
    } as ActorContext);

    await registry.register({
      actorId: 'calc-1',
      actorType: 'Calculator',
      workerId: 'worker-1',
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      messageCount: 0,
    });

    await registry.register({
      actorId: 'calc-2',
      actorType: 'Calculator',
      workerId: 'worker-1',
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      messageCount: 0,
    });

    // Enqueue operations for both calculators
    await messageQueue.enqueue('actor:calc-1', {
      messageId: 'msg-1',
      actorId: 'calc-1',
      method: 'execute',
      args: { operation: 'add', a: 10, b: 5 },
    });

    await messageQueue.enqueue('actor:calc-2', {
      messageId: 'msg-2',
      actorId: 'calc-2',
      method: 'execute',
      args: { operation: 'multiply', a: 7, b: 6 },
    });

    await messageQueue.enqueue('actor:calc-1', {
      messageId: 'msg-3',
      actorId: 'calc-1',
      method: 'execute',
      args: { operation: 'multiply', a: 15, b: 2 },
    });

    const actorInstances = new Map<string, Actor>([
      ['calc-1', calc1],
      ['calc-2', calc2],
    ]);

    const worker = new ActorWorker({
      workerId: 'worker-1',
      messageQueue,
      stateStore: cosmos as any,
      discoveryService: discovery,
      actorFactory: (ctx) => {
        const actor = actorInstances.get(ctx.actorId);
        if (actor) return actor;
        throw new Error('Unknown actor');
      },
    });

    workers.push(worker);
    await worker.start();

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify results
    expect(calc1.getResult()).toBe(30); // 10 + 5, then * 2
    expect(calc1.getHistory()).toHaveLength(2);

    expect(calc2.getResult()).toBe(42); // 7 * 6
    expect(calc2.getHistory()).toHaveLength(1);
  });

  it('handles message retries on failure', async () => {
    let attemptCount = 0;

    const failingActor = new class extends Actor {
      async execute(input: any): Promise<void> {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Simulated failure');
        }
        this.updateState({ success: true, attempts: attemptCount });
      }
    }({
      actorId: 'failing-1',
      actorType: 'Failing',
      messageQueue,
    } as ActorContext);

    await registry.register({
      actorId: 'failing-1',
      actorType: 'Failing',
      workerId: 'worker-1',
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      messageCount: 0,
    });

    await messageQueue.enqueue('actor:failing-1', {
      messageId: 'msg-1',
      actorId: 'failing-1',
      method: 'execute',
      args: {},
    });

    const worker = new ActorWorker({
      workerId: 'worker-1',
      messageQueue,
      stateStore: cosmos as any,
      discoveryService: discovery,
      actorFactory: (ctx) => {
        if (ctx.actorId === 'failing-1') return failingActor;
        throw new Error('Unknown actor');
      },
    });

    workers.push(worker);
    await worker.start();

    // Wait for retries
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify it eventually succeeded
    expect(attemptCount).toBe(3);
    expect(failingActor.state.success).toBe(true);
  });
});
