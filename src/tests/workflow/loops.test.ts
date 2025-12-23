/**
 * Tests for Workflow Loops
 * 
 * Tests Until, While, DoUntil, and Retry loop types
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { 
  InMemoryWorkflowExecutor, 
  WorkflowDefinition,
  InMemoryWorkflowStore 
} from '../../workflow'

describe('Workflow Loops', () => {
  let executor: InMemoryWorkflowExecutor

  beforeEach(() => {
    executor = new InMemoryWorkflowExecutor({})
  })

  describe('Until Loop', () => {
    it('should loop until condition is true', async () => {
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

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.countToFive.status).toBe('completed')
      expect(result.countToFive.iterations).toBe(4) // Execute 0-3, then loopIndex=4 stops
      expect(result.countToFive.conditionMet).toBe(true)
      expect(result.countToFive.results).toHaveLength(4)
    })

    it('should timeout if condition never met', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          infiniteLoop: {
            type: 'Until',
            inputs: {
              condition: 'false', // Never true
              actions: {
                noop: {
                  type: 'Compose',
                  inputs: 'iteration'
                }
              },
              limit: {
                count: 1000,
                timeout: 'PT1S' // 1 second timeout
              },
              delay: {
                interval: { count: 1, unit: 'second' } // 1 second delay will cause timeout after first iteration
              }
            }
          }
        }
      }

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId, 5000) // 5 sec wait

      expect(result.infiniteLoop.status).toBe('timeout')
      expect(result.infiniteLoop.error).toContain('timeout')
    }, 6000) // Test timeout 6 seconds

    it('should stop at max iterations', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          limitedLoop: {
            type: 'Until',
            inputs: {
              condition: 'false', // Never true
              actions: {
                count: {
                  type: 'Compose',
                  inputs: '@variables(\'loopIndex\')'
                }
              },
              limit: {
                count: 3, // Max 3 iterations
                timeout: 'PT1M'
              }
            }
          }
        }
      }

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.limitedLoop.status).toBe('max-iterations')
      expect(result.limitedLoop.iterations).toBe(3)
      expect(result.limitedLoop.results).toHaveLength(3)
    })

    it('should provide loop context variables', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          loopWithContext: {
            type: 'Until',
            inputs: {
              condition: '@greaterOrEquals(@variables(\'loopIndex\'), 2)',
              actions: {
                captureContext: {
                  type: 'Compose',
                  inputs: {
                    index: '@variables(\'loopIndex\')',
                    count: '@variables(\'loopCount\')'
                  }
                }
              },
              limit: {
                count: 10
              }
            }
          }
        }
      }

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.loopWithContext.status).toBe('completed')
      expect(result.loopWithContext.results[0].captureContext).toEqual({ index: 0, count: 1 })
      expect(result.loopWithContext.results[1].captureContext).toEqual({ index: 1, count: 2 })
      // Only 2 iterations - execute 0 and 1, then loopIndex=2 stops
    })
  })

  describe('While Loop', () => {
    it('should loop while condition is true', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          whileLoop: {
            type: 'While',
            inputs: {
              condition: '@less(@variables(\'loopIndex\'), 3)',
              actions: {
                action: {
                  type: 'Compose',
                  inputs: '@variables(\'loopIndex\')'
                }
              },
              limit: {
                count: 10
              }
            }
          }
        }
      }

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.whileLoop.status).toBe('completed')
      expect(result.whileLoop.iterations).toBe(3) // While index < 3: 0, 1, 2
      expect(result.whileLoop.results).toHaveLength(3)
    })
  })

  describe('DoUntil Loop', () => {
    it('should execute at least once', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          doUntilLoop: {
            type: 'DoUntil',
            inputs: {
              condition: 'true', // Immediately true
              actions: {
                firstRun: {
                  type: 'Compose',
                  inputs: 'executed'
                }
              },
              limit: {
                count: 10
              }
            }
          }
        }
      }

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.doUntilLoop.status).toBe('completed')
      expect(result.doUntilLoop.iterations).toBe(2) // DoUntil executes first, then checks (stops immediately)
      expect(result.doUntilLoop.results).toHaveLength(2)
      expect(result.doUntilLoop.results[0].firstRun).toBe('executed')
    })

    it('should continue looping until condition met', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          doUntilLoop: {
            type: 'DoUntil',
            inputs: {
              condition: '@greaterOrEquals(@variables(\'loopIndex\'), 3)',
              actions: {
                action: {
                  type: 'Compose',
                  inputs: '@variables(\'loopIndex\')'
                }
              },
              limit: {
                count: 10
              }
            }
          }
        }
      }

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.doUntilLoop.status).toBe('completed')
      expect(result.doUntilLoop.iterations).toBe(3) // Execute 0-2, then loopIndex=3 stops
      expect(result.doUntilLoop.results).toHaveLength(3)
    })
  })

  describe('Retry Action', () => {
    it('should succeed on first attempt', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          retryAction: {
            type: 'Retry',
            inputs: {
              action: {
                type: 'Compose',
                inputs: 'success'
              },
              retryPolicy: {
                type: 'fixed',
                count: 3,
                interval: 'PT1S'
              }
            }
          }
        }
      }

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.retryAction.status).toBe('success')
      expect(result.retryAction.attempts).toBe(1)
      expect(result.retryAction.result).toBe('success')
    })

    it('should use exponential backoff by default', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          retryCompose: {
            type: 'Retry',
            inputs: {
              action: {
                type: 'Compose',
                inputs: 'success'
              }
              // Uses default exponential backoff
            }
          }
        }
      }

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.retryCompose.status).toBe('success')
      expect(result.retryCompose.attempts).toBe(1)
    })
  })

  describe('Nested Loops', () => {
    it('should support nested Until loops', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
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
                      action: {
                        type: 'Compose',
                        inputs: 'nested'
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

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.outerLoop.status).toBe('completed')
      expect(result.outerLoop.iterations).toBe(2) // Execute 0-1, then loopIndex=2 stops
      expect(result.outerLoop.results).toHaveLength(2)
      
      // Each outer iteration runs inner loop
      expect(result.outerLoop.results[0].innerLoop.status).toBe('completed')
      expect(result.outerLoop.results[0].innerLoop.iterations).toBe(2) // Execute 0-1, then loopIndex=2 stops
    })
  })

  describe('Loop with Delay', () => {
    it('should delay between iterations', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          delayedLoop: {
            type: 'Until',
            inputs: {
              condition: '@greaterOrEquals(@variables(\'loopIndex\'), 2)',
              actions: {
                action: {
                  type: 'Compose',
                  inputs: '@variables(\'loopIndex\')'
                }
              },
              delay: {
                interval: { count: 1, unit: 'second' }
              },
              limit: { count: 5 }
            }
          }
        }
      }

      const startTime = Date.now()
      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)
      const elapsed = Date.now() - startTime

      expect(result.delayedLoop.status).toBe('completed')
      expect(result.delayedLoop.iterations).toBe(2)
      // Should take at least 1 second (1 delay between 2 iterations)
      expect(elapsed).toBeGreaterThanOrEqual(1000)
    }, 10000) // Increase timeout for this test
  })

  describe('Expression Evaluation', () => {
    it('should evaluate @not() function', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          testNot: {
            type: 'Until',
            inputs: {
              condition: '@not(@less(@variables(\'loopIndex\'), 2))',
              actions: {
                action: {
                  type: 'Compose',
                  inputs: 'running'
                }
              },
              limit: { count: 10 }
            }
          }
        }
      }

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.testNot.status).toBe('completed')
      expect(result.testNot.iterations).toBe(2) // Loop while index < 2: 0, 1
    })

    it('should evaluate @equals() function', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          testEquals: {
            type: 'Until',
            inputs: {
              condition: '@equals(@variables(\'loopIndex\'), 3)',
              actions: {
                action: {
                  type: 'Compose',
                  inputs: '@variables(\'loopIndex\')'
                }
              },
              limit: { count: 10 }
            }
          }
        }
      }

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.testEquals.status).toBe('completed')
      expect(result.testEquals.iterations).toBe(3) // Execute 0-2, check after each, stop when index=3
      expect(result.testEquals.conditionMet).toBe(true)
    })
  })

  describe('Real-World Use Cases', () => {
    it('should implement polling pattern', async () => {
      // Simulate polling until status is "complete"
      let pollCount = 0
      
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          pollStatus: {
            type: 'Until',
            inputs: {
              condition: '@greaterOrEquals(@variables(\'loopIndex\'), 3)', // Simulate: status === 'complete' after 3 polls
              actions: {
                checkStatus: {
                  type: 'Compose',
                  inputs: {
                    pollNumber: '@variables(\'loopCount\')',
                    status: 'pending'
                  }
                }
              },
              delay: {
                interval: { count: 1, unit: 'second' }
              },
              limit: {
                count: 10,
                timeout: 'PT30S'
              }
            }
          }
        }
      }

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.pollStatus.status).toBe('completed')
      expect(result.pollStatus.iterations).toBe(3) // Execute 0-2, then loopIndex=3 stops
      expect(result.pollStatus.results).toHaveLength(3)
    }, 10000)

    it('should implement retry with exponential backoff', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          apiCallWithRetry: {
            type: 'Retry',
            inputs: {
              action: {
                type: 'Compose',
                inputs: { result: 'api-success' }
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

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.apiCallWithRetry.status).toBe('success')
      expect(result.apiCallWithRetry.result).toEqual({ result: 'api-success' })
    })

    it('should process queue until empty', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          processQueue: {
            type: 'Until',
            inputs: {
              condition: '@greaterOrEquals(@variables(\'loopIndex\'), 5)', // Simulate 5 items in queue
              actions: {
                processItem: {
                  type: 'Compose',
                  inputs: {
                    itemNumber: '@variables(\'loopCount\')',
                    processed: true
                  }
                }
              },
              limit: {
                count: 20
              }
            }
          }
        }
      }

      const instanceId = await executor.execute(workflow, {})
      const result = await executor.waitForCompletion(instanceId)

      expect(result.processQueue.status).toBe('completed')
      expect(result.processQueue.iterations).toBe(5) // Execute 0-4, then loopIndex=5 stops
      expect(result.processQueue.results.every((r: any) => r.processItem.processed)).toBe(true)
    })
  })
})
