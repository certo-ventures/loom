/**
 * Simple test to debug workflow loops
 */

import { InMemoryWorkflowExecutor, WorkflowDefinition } from '../src/workflow'

const workflow: WorkflowDefinition = {
  $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
  contentVersion: '1.0.0',
  triggers: {
    manual: { type: 'manual' }
  },
  actions: {
    testAction: {
      type: 'Compose',
      inputs: 'hello world'
    }
  }
}

const executor = new InMemoryWorkflowExecutor({})

executor.execute(workflow, {}).then(async (instanceId) => {
  console.log('Instance ID:', instanceId)
  
  const result = await executor.waitForCompletion(instanceId)
  console.log('Result:', JSON.stringify(result, null, 2))
}).catch(console.error)
