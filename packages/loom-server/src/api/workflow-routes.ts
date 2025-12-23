/**
 * Workflow API Routes - WDL execution
 */

import type { FastifyInstance } from 'fastify';
import type { WdlWorkflowExecutor } from '../workflow/wdl-executor';
import type { WorkflowDefinition } from '../workflow/wdl-types';

export async function registerWorkflowRoutes(
  server: FastifyInstance,
  workflowExecutor: WdlWorkflowExecutor
) {
  // Execute a workflow
  server.post('/workflows/execute', {
    schema: {
      description: 'Execute an Azure Logic Apps Workflow Definition Language workflow',
      body: {
        type: 'object',
        required: ['definition'],
        properties: {
          definition: { type: 'object' },
          inputs: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { definition, inputs } = request.body as {
      definition: WorkflowDefinition;
      inputs?: any;
    };

    const result = await workflowExecutor.execute(definition, inputs || {});
    
    return result;
  });

  // Example workflow templates
  server.get('/workflows/examples', async (request, reply) => {
    return {
      examples: [
        {
          name: 'Simple Actor Chain',
          description: 'Execute two actors in sequence',
          definition: {
            contentVersion: '1.0.0',
            parameters: {
              inputData: {
                type: 'string',
                defaultValue: 'test',
              },
            },
            actions: {
              step1: {
                type: 'actor',
                actorType: 'hello-world',
                inputs: {
                  name: '@parameters(\'inputData\')',
                },
              },
              step2: {
                type: 'actor',
                actorType: 'hello-world',
                runAfter: {
                  step1: ['Succeeded'],
                },
                inputs: {
                  name: '@actions(\'step1\').outputs.greeting',
                },
              },
            },
            outputs: {
              finalGreeting: {
                type: 'string',
                value: '@actions(\'step2\').outputs.greeting',
              },
            },
          },
        },
        {
          name: 'Conditional Workflow',
          description: 'Execute different actors based on condition',
          definition: {
            contentVersion: '1.0.0',
            parameters: {
              shouldExecute: {
                type: 'bool',
                defaultValue: true,
              },
            },
            actions: {
              checkCondition: {
                type: 'condition',
                expression: '@parameters(\'shouldExecute\')',
                actions: {
                  trueActor: {
                    type: 'actor',
                    actorType: 'hello-world',
                    inputs: {
                      name: 'Condition was true',
                    },
                  },
                },
                else: {
                  actions: {
                    falseActor: {
                      type: 'actor',
                      actorType: 'hello-world',
                      inputs: {
                        name: 'Condition was false',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        {
          name: 'Parallel Execution',
          description: 'Execute multiple actors in parallel',
          definition: {
            contentVersion: '1.0.0',
            actions: {
              parallel1: {
                type: 'actor',
                actorType: 'hello-world',
                inputs: { name: 'Task 1' },
              },
              parallel2: {
                type: 'actor',
                actorType: 'hello-world',
                inputs: { name: 'Task 2' },
              },
              parallel3: {
                type: 'actor',
                actorType: 'hello-world',
                inputs: { name: 'Task 3' },
              },
              combineResults: {
                type: 'actor',
                actorType: 'hello-world',
                runAfter: {
                  parallel1: ['Succeeded'],
                  parallel2: ['Succeeded'],
                  parallel3: ['Succeeded'],
                },
                inputs: {
                  name: 'All parallel tasks completed',
                },
              },
            },
            outputs: {
              summary: {
                type: 'string',
                value: '@actions(\'combineResults\').outputs.greeting',
              },
            },
          },
        },
      ],
    };
  });
}
