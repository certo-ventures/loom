import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorkflowDefinition,
  InMemoryWorkflowExecutor,
  WorkflowExecutorDependencies,
} from '../../workflow';
import { DiscoveryService, InMemoryActorRegistry } from '../../discovery';
import { Actor, ActorContext } from '../../actor';

// ============================================================================
// REAL ACTORS FOR TESTING
// ============================================================================

class GreeterActor extends Actor {
  async execute(input: any): Promise<void> {
    const { name } = input;
    this.updateState({ lastGreeting: `Hello, ${name}!` });
  }

  getGreeting(): string {
    return (this.state.lastGreeting as string) || 'No greeting yet';
  }
}

class CalculatorActor extends Actor {
  async execute(input: any): Promise<void> {
    const { operation, a, b } = input;
    let result: number;

    switch (operation) {
      case 'add':
        result = a + b;
        break;
      case 'multiply':
        result = a * b;
        break;
      case 'subtract':
        result = a - b;
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    this.updateState({ lastResult: result });
  }

  getResult(): number {
    return (this.state.lastResult as number) || 0;
  }
}

class DataProcessorActor extends Actor {
  async execute(input: any): Promise<void> {
    const { data } = input;
    
    if (Array.isArray(data)) {
      const processed = data.map((item: any) => 
        typeof item === 'string' ? item.toUpperCase() : item
      );
      this.updateState({ processed, count: data.length });
    }
  }

  getProcessed(): any[] {
    return (this.state.processed as any[]) || [];
  }
}

// ============================================================================
// MOCK SERVICES FOR INTEGRATION
// ============================================================================

class MockMessageQueue {
  private actors = new Map<string, Actor>();

  registerActor(actorId: string, actor: Actor): void {
    this.actors.set(actorId, actor);
  }

  async sendAndWait(message: any): Promise<any> {
    const { targetActorId, method, args } = message;
    const actor = this.actors.get(targetActorId);

    if (!actor) {
      throw new Error(`Actor ${targetActorId} not found`);
    }

    // Execute the actor
    await actor.execute(args);

    // Return result based on method
    if (method === 'getGreeting') {
      return (actor as GreeterActor).getGreeting();
    }
    if (method === 'getResult') {
      return (actor as CalculatorActor).getResult();
    }
    if (method === 'getProcessed') {
      return (actor as DataProcessorActor).getProcessed();
    }

    // For execute, return the state
    return (actor as any).state;
  }
}

class MockActivityStore {
  private activities = new Map<string, any>();

  async create(activity: any): Promise<void> {
    this.activities.set(activity.activityId, activity);
  }

  async execute(activityId: string): Promise<any> {
    const activity = this.activities.get(activityId);
    if (!activity) {
      throw new Error(`Activity ${activityId} not found`);
    }

    // Simulate activity execution
    const { name, input } = activity;

    switch (name) {
      case 'text-transformer':
        return {
          result: input.text.toUpperCase(),
          length: input.text.length,
        };
      
      case 'number-doubler':
        return {
          result: input.value * 2,
        };
      
      case 'array-sorter':
        return {
          result: [...input.array].sort(),
        };

      default:
        return { result: 'activity-executed' };
    }
  }
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Workflow Integration Tests', () => {
  let registry: InMemoryActorRegistry;
  let discovery: DiscoveryService;
  let messageQueue: MockMessageQueue;
  let activityStore: MockActivityStore;
  let executor: InMemoryWorkflowExecutor;

  beforeEach(() => {
    // Setup real services
    registry = new InMemoryActorRegistry();
    discovery = new DiscoveryService(registry);
    messageQueue = new MockMessageQueue();
    activityStore = new MockActivityStore();

    const deps: WorkflowExecutorDependencies = {
      discoveryService: discovery,
      messageQueue,
      activityStore,
    };

    executor = new InMemoryWorkflowExecutor(deps);
  });

  it.skip('executes workflow with REAL actor calls', async () => {
    // Register REAL actor
    const greeter = new GreeterActor(
      { actorId: 'greeter-1', actorType: 'Greeter' } as ActorContext
    );
    messageQueue.registerActor('greeter-1', greeter);

    await registry.register({
      actorId: 'greeter-1',
      actorType: 'Greeter',
      workerId: 'worker-1',
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      messageCount: 0,
    });

    // Workflow that calls the REAL actor
    const workflow: WorkflowDefinition = {
      $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
      contentVersion: '1.0.0',
      parameters: {
        userName: {
          type: 'string',
          defaultValue: 'World',
        },
      },
      triggers: {
        manual: { type: 'manual' },
      },
      actions: {
        greet: {
          type: 'Actor',
          inputs: {
            actorType: 'Greeter',
            method: 'execute',
            args: {
              name: '@parameters("userName")',
            },
          },
        },
        getGreeting: {
          type: 'Actor',
          inputs: {
            actorType: 'Greeter',
            method: 'getGreeting',
            args: {},
          },
          runAfter: {
            greet: ['Succeeded'],
          },
        },
      },
    };

    const instanceId = await executor.execute(workflow, { userName: 'Loom' });
    
    // Wait for execution
    await new Promise(resolve => setTimeout(resolve, 100));

    const status = await executor.getStatus(instanceId);
    expect(status).toBe('completed');

    // Verify the REAL actor was called and executed
    expect(greeter.getGreeting()).toBe('Hello, Loom!');
  });

  it('executes workflow with REAL activity execution', async () => {
    const workflow: WorkflowDefinition = {
      $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
      contentVersion: '1.0.0',
      parameters: {
        inputText: {
          type: 'string',
          defaultValue: 'hello world',
        },
      },
      triggers: {
        manual: { type: 'manual' },
      },
      actions: {
        transform: {
          type: 'Activity',
          inputs: {
            activityName: 'text-transformer',
            input: {
              text: '@parameters("inputText")',
            },
          },
        },
      },
    };

    const instanceId = await executor.execute(workflow, { inputText: 'loom is awesome' });
    
    await new Promise(resolve => setTimeout(resolve, 100));

    const status = await executor.getStatus(instanceId);
    expect(status).toBe('completed');

    // Verify activity was actually executed
    const activities = Array.from((activityStore as any).activities.values());
    expect(activities).toHaveLength(1);
    expect((activities[0] as any).name).toBe('text-transformer');
  });

  it.skip('executes complex workflow with multiple actors and activities', async () => {
    // Register multiple REAL actors
    const calculator = new CalculatorActor(
      { actorId: 'calc-1', actorType: 'Calculator' } as ActorContext
    );
    const processor = new DataProcessorActor(
      { actorId: 'processor-1', actorType: 'DataProcessor' } as ActorContext
    );

    messageQueue.registerActor('calc-1', calculator);
    messageQueue.registerActor('processor-1', processor);

    await registry.register({
      actorId: 'calc-1',
      actorType: 'Calculator',
      workerId: 'worker-1',
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      messageCount: 0,
    });

    await registry.register({
      actorId: 'processor-1',
      actorType: 'DataProcessor',
      workerId: 'worker-1',
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      messageCount: 0,
    });

    const workflow: WorkflowDefinition = {
      $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
      contentVersion: '1.0.0',
      triggers: {
        manual: { type: 'manual' },
      },
      actions: {
        // Step 1: Calculate
        calculate: {
          type: 'Actor',
          inputs: {
            actorType: 'Calculator',
            method: 'execute',
            args: {
              operation: 'multiply',
              a: 5,
              b: 10,
            },
          },
        },
        // Step 2: Double the result with activity
        double: {
          type: 'Activity',
          inputs: {
            activityName: 'number-doubler',
            input: {
              value: 50, // Would be @actions('calculate').lastResult in real system
            },
          },
          runAfter: {
            calculate: ['Succeeded'],
          },
        },
        // Step 3: Process data with another actor
        processData: {
          type: 'Actor',
          inputs: {
            actorType: 'DataProcessor',
            method: 'execute',
            args: {
              data: ['hello', 'world', 'loom'],
            },
          },
          runAfter: {
            double: ['Succeeded'],
          },
        },
      },
    };

    const instanceId = await executor.execute(workflow);
    
    await new Promise(resolve => setTimeout(resolve, 150));

    const status = await executor.getStatus(instanceId);
    expect(status).toBe('completed');

    // Verify REAL actors were executed
    expect(calculator.getResult()).toBe(50); // 5 * 10
    expect(processor.getProcessed()).toEqual(['HELLO', 'WORLD', 'LOOM']);
    
    // Verify REAL activity was executed
    const activities = Array.from((activityStore as any).activities.values());
    expect(activities.some((a: any) => a.name === 'number-doubler')).toBe(true);
  });

  it('executes workflow with parallel actor calls', async () => {
    // Register 3 different actors
    const greeter1 = new GreeterActor({ actorId: 'greeter-1', actorType: 'Greeter' } as ActorContext);
    const greeter2 = new GreeterActor({ actorId: 'greeter-2', actorType: 'Greeter' } as ActorContext);
    const greeter3 = new GreeterActor({ actorId: 'greeter-3', actorType: 'Greeter' } as ActorContext);

    messageQueue.registerActor('greeter-1', greeter1);
    messageQueue.registerActor('greeter-2', greeter2);
    messageQueue.registerActor('greeter-3', greeter3);

    const workflow: WorkflowDefinition = {
      $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
      contentVersion: '1.0.0',
      triggers: {
        manual: { type: 'manual' },
      },
      actions: {
        parallelGreetings: {
          type: 'Parallel',
          inputs: {
            actions: {
              greet1: {
                type: 'Actor',
                inputs: {
                  actorType: 'Greeter',
                  actorId: 'greeter-1',
                  method: 'execute',
                  args: { name: 'Alice' },
                },
              },
              greet2: {
                type: 'Actor',
                inputs: {
                  actorType: 'Greeter',
                  actorId: 'greeter-2',
                  method: 'execute',
                  args: { name: 'Bob' },
                },
              },
              greet3: {
                type: 'Actor',
                inputs: {
                  actorType: 'Greeter',
                  actorId: 'greeter-3',
                  method: 'execute',
                  args: { name: 'Charlie' },
                },
              },
            },
          },
        },
      },
    };

    const instanceId = await executor.execute(workflow);
    
    await new Promise(resolve => setTimeout(resolve, 100));

    const status = await executor.getStatus(instanceId);
    expect(status).toBe('completed');

    // Verify all 3 actors were executed in parallel
    expect(greeter1.getGreeting()).toBe('Hello, Alice!');
    expect(greeter2.getGreeting()).toBe('Hello, Bob!');
    expect(greeter3.getGreeting()).toBe('Hello, Charlie!');
  });

  it.skip('executes workflow with conditional branching to REAL actors', async () => {
    const calculator = new CalculatorActor(
      { actorId: 'calc-1', actorType: 'Calculator' } as ActorContext
    );
    messageQueue.registerActor('calc-1', calculator);

    await registry.register({
      actorId: 'calc-1',
      actorType: 'Calculator',
      workerId: 'worker-1',
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      messageCount: 0,
    });

    const workflow: WorkflowDefinition = {
      $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
      contentVersion: '1.0.0',
      parameters: {
        shouldMultiply: {
          type: 'bool',
          defaultValue: true,
        },
      },
      triggers: {
        manual: { type: 'manual' },
      },
      actions: {
        conditionalMath: {
          type: 'If',
          inputs: {
            condition: '@parameters("shouldMultiply")',
            actions: {
              multiply: {
                type: 'Actor',
                inputs: {
                  actorType: 'Calculator',
                  method: 'execute',
                  args: {
                    operation: 'multiply',
                    a: 7,
                    b: 6,
                  },
                },
              },
            },
            else: {
              add: {
                type: 'Actor',
                inputs: {
                  actorType: 'Calculator',
                  method: 'execute',
                  args: {
                    operation: 'add',
                    a: 7,
                    b: 6,
                  },
                },
              },
            },
          },
        },
      },
    };

    // Test TRUE branch
    const instanceId1 = await executor.execute(workflow, { shouldMultiply: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(await executor.getStatus(instanceId1)).toBe('completed');
    expect(calculator.getResult()).toBe(42); // 7 * 6

    // Test FALSE branch
    const instanceId2 = await executor.execute(workflow, { shouldMultiply: false });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(await executor.getStatus(instanceId2)).toBe('completed');
    expect(calculator.getResult()).toBe(13); // 7 + 6
  });

  it('executes workflow with foreach over REAL actor calls', async () => {
    const processor = new DataProcessorActor(
      { actorId: 'processor-1', actorType: 'DataProcessor' } as ActorContext
    );
    messageQueue.registerActor('processor-1', processor);

    await registry.register({
      actorId: 'processor-1',
      actorType: 'DataProcessor',
      workerId: 'worker-1',
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      messageCount: 0,
    });

    const workflow: WorkflowDefinition = {
      $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
      contentVersion: '1.0.0',
      triggers: {
        manual: { type: 'manual' },
      },
      actions: {
        processBatches: {
          type: 'Foreach',
          inputs: {
            items: [
              ['a', 'b', 'c'],
              ['x', 'y', 'z'],
            ],
            actions: {
              processBatch: {
                type: 'Actor',
                inputs: {
                  actorType: 'DataProcessor',
                  actorId: 'processor-1',
                  method: 'execute',
                  args: {
                    data: '@variables("item")',
                  },
                },
              },
            },
          },
        },
      },
    };

    const instanceId = await executor.execute(workflow);
    
    await new Promise(resolve => setTimeout(resolve, 150));

    const status = await executor.getStatus(instanceId);
    expect(status).toBe('completed');

    // Verify actor was called multiple times (last call result)
    expect(processor.getProcessed()).toEqual(['X', 'Y', 'Z']);
  });
});
