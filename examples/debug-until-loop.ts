/**
 * Debug Until loop
 */

import { InMemoryWorkflowExecutor, WorkflowDefinition } from '../src/workflow'

const workflow: WorkflowDefinition = {
  $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
  contentVersion: '1.0.0',
  triggers: {
    manual: { type: 'manual' }
  },
  actions: {
    countToFive: {
      type: 'Until',
      inputs: {
        condition: '@greaterOrEquals(@variables(\'loopIndex\'), 4)',
        actions: {
          increment: {
            type: 'Compose',
            inputs: '@variables(\'loopIndex\')'
          }
        },
        limit: {
          count: 10,
          timeout: 'PT1M'
        }
      }
    }
  }
}

const executor = new InMemoryWorkflowExecutor({})

executor.execute(workflow, {}).then(async (instanceId:string) => {
  console.log('Instance ID:', instanceId)
  
  const result = await executor.waitForCompletion(instanceId)
  console.log('Result:', JSON.stringify(result, null, 2))
}).catch(console.error)
