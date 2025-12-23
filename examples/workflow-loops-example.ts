/**
 * Workflow Loops Example
 * 
 * Demonstrates all 4 loop types: Until, While, DoUntil, and Retry
 */

import { InMemoryWorkflowExecutor, WorkflowDefinition } from '../src/workflow'

console.log('🔄 Workflow Loops Demo\n')
console.log('=' .repeat(80))

const executor = new InMemoryWorkflowExecutor({})

// Example 1: Until Loop - Poll until status is complete
console.log('\n📋 Example 1: Until Loop - Polling Pattern')
console.log('-'.repeat(80))

const untilWorkflow: WorkflowDefinition = {
  $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
  contentVersion: '1.0.0',
  triggers: { manual: { type: 'manual' } },
  actions: {
    pollUntilComplete: {
      type: 'Until',
      inputs: {
        condition: '@greaterOrEquals(@variables(\'loopIndex\'), 3)',
        actions: {
          checkStatus: {
            type: 'Compose',
            inputs: {
              iteration: '@variables(\'loopIndex\')',
              status: 'processing'
            }
          }
        },
        limit: { count: 10, timeout: 'PT1M' }
      }
    }
  }
}

executor.execute(untilWorkflow, {}).then(async (id) => {
  const result = await executor.waitForCompletion(id)
  console.log(`Status: ${result.pollUntilComplete.status}`)
  console.log(`Iterations: ${result.pollUntilComplete.iterations}`)
  console.log(`Results: ${JSON.stringify(result.pollUntilComplete.results, null, 2)}`)
  
  // Example 2: While Loop - Process while condition is true
  console.log('\n📋 Example 2: While Loop - Process Queue')
  console.log('-'.repeat(80))
  
  const whileWorkflow: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    triggers: { manual: { type: 'manual' } },
    actions: {
      processWhileNotDone: {
        type: 'While',
        inputs: {
          condition: '@less(@variables(\'loopIndex\'), 5)',
          actions: {
            processItem: {
              type: 'Compose',
              inputs: {
                itemNumber: '@variables(\'loopCount\')',
                processed: true
              }
            }
          },
          limit: { count: 20 }
        }
      }
    }
  }
  
  return executor.execute(whileWorkflow, {})
}).then(async (id) => {
  const result = await executor.waitForCompletion(id)
  console.log(`Status: ${result.processWhileNotDone.status}`)
  console.log(`Iterations: ${result.processWhileNotDone.iterations}`)
  console.log(`Processed ${result.processWhileNotDone.results.length} items`)
  
  // Example 3: DoUntil Loop - Execute at least once
  console.log('\n📋 Example 3: DoUntil Loop - Initialization Pattern')
  console.log('-'.repeat(80))
  
  const doUntilWorkflow: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    triggers: { manual: { type: 'manual' } },
    actions: {
      initializeAndCheck: {
        type: 'DoUntil',
        inputs: {
          condition: '@greaterOrEquals(@variables(\'loopIndex\'), 2)',
          actions: {
            initialize: {
              type: 'Compose',
              inputs: {
                step: '@variables(\'loopCount\')',
                action: 'initialize_system'
              }
            }
          },
          limit: { count: 10 }
        }
      }
    }
  }
  
  return executor.execute(doUntilWorkflow, {})
}).then(async (id) => {
  const result = await executor.waitForCompletion(id)
  console.log(`Status: ${result.initializeAndCheck.status}`)
  console.log(`Iterations: ${result.initializeAndCheck.iterations}`)
  console.log(`Always executes at least once!`)
  
  // Example 4: Retry with Exponential Backoff
  console.log('\n📋 Example 4: Retry Action - API Call with Backoff')
  console.log('-'.repeat(80))
  
  const retryWorkflow: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    triggers: { manual: { type: 'manual' } },
    actions: {
      apiCallWithRetry: {
        type: 'Retry',
        inputs: {
          action: {
            type: 'Compose',
            inputs: { result: 'api-success', timestamp: new Date().toISOString() }
          },
          retryPolicy: {
            type: 'exponential',
            count: 5,
            interval: 'PT1S',
            maxInterval: 'PT1M',
            minimumInterval: 'PT1S'
          }
        }
      }
    }
  }
  
  return executor.execute(retryWorkflow, {})
}).then(async (id) => {
  const result = await executor.waitForCompletion(id)
  console.log(`Status: ${result.apiCallWithRetry.status}`)
  console.log(`Attempts: ${result.apiCallWithRetry.attempts}`)
  console.log(`Result: ${JSON.stringify(result.apiCallWithRetry.result, null, 2)}`)
  
  // Example 5: Nested Loops
  console.log('\n📋 Example 5: Nested Loops - Matrix Processing')
  console.log('-'.repeat(80))
  
  const nestedWorkflow: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    triggers: { manual: { type: 'manual' } },
    actions: {
      outerLoop: {
        type: 'Until',
        inputs: {
          condition: '@greaterOrEquals(@variables(\'loopIndex\'), 2)',
          actions: {
            innerLoop: {
              type: 'Until',
              inputs: {
                condition: '@greaterOrEquals(@variables(\'loopIndex\'), 2)',
                actions: {
                  process: {
                    type: 'Compose',
                    inputs: 'nested-cell'
                  }
                },
                limit: { count: 5 }
              }
            }
          },
          limit: { count: 5 }
        }
      }
    }
  }
  
  return executor.execute(nestedWorkflow, {})
}).then(async (id) => {
  const result = await executor.waitForCompletion(id)
  console.log(`Outer Status: ${result.outerLoop.status}`)
  console.log(`Outer Iterations: ${result.outerLoop.iterations}`)
  console.log(`Inner Iterations (first outer): ${result.outerLoop.results[0].innerLoop.iterations}`)
  console.log(`Total cells processed: ${result.outerLoop.iterations * result.outerLoop.results[0].innerLoop.iterations}`)
  
  // Summary
  console.log('\n' + '='.repeat(80))
  console.log('✅ Workflow Loops Implementation Complete!')
  console.log('='.repeat(80))
  console.log()
  console.log('Supported Loop Types:')
  console.log('  1. Until - Loop until condition is TRUE')
  console.log('  2. While - Loop while condition is TRUE (sugar for Until)')
  console.log('  3. DoUntil - Execute at least once, then loop until condition TRUE')
  console.log('  4. Retry - Retry action with exponential backoff')
  console.log()
  console.log('Features:')
  console.log('  ✓ Loop variables (loopIndex, loopCount, loopResult, loopStartTime, loopElapsedMs)')
  console.log('  ✓ Iteration limits and timeouts')
  console.log('  ✓ Delays between iterations')
  console.log('  ✓ Nested loops')
  console.log('  ✓ Expression evaluation (@equals, @greaterOrEquals, @less, @not, @empty)')
  console.log('  ✓ Exponential backoff with jitter')
  console.log()
  console.log('📊 ORIGINAL GOAL STATUS: Workflow Loops ✅ COMPLETE')
  console.log('   Estimated: ~250 lines')
  console.log('   Actual: ~350 lines (more features than planned!)')
  console.log()
  console.log('🎯 REMAINING GOALS:')
  console.log('   2 of 6 original high-priority features remaining:')
  console.log('   - Secrets Management (Azure Key Vault) - ~100 lines')
  console.log('   - Bindings/Connectors (HTTP, Kafka, Service Bus) - ~200 lines')
  console.log()
}).catch(console.error)
