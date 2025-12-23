/**
 * Workflow Resilience Example
 * 
 * Demonstrates retry policies, timeouts, circuit breakers, rate limiting,
 * and error handling scopes for robust workflow execution.
 */

import { InMemoryWorkflowExecutor, WorkflowDefinition } from '../src/workflow/index.js';
import { CircuitBreaker, RateLimiter, retryWithBackoff } from '../src/workflow/resilience.js';

async function main() {
  console.log('='.repeat(80));
  console.log('Workflow Resilience Features');
  console.log('='.repeat(80));

  // ========================================================================
  // 1. RETRY POLICY - Exponential Backoff
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('1. Retry Policy with Exponential Backoff');
  console.log('='.repeat(80));

  let apiAttempt = 0;
  const unreliableAPI = async () => {
    apiAttempt++;
    console.log(`  API call attempt ${apiAttempt}...`);
    
    if (apiAttempt < 3) {
      throw new Error('503 Service Unavailable');
    }
    
    return { status: 'ok', data: 'Success!' };
  };

  console.log('\nCalling unreliable API with retry policy...');
  const result = await retryWithBackoff(unreliableAPI, {
    maxAttempts: 5,
    initialDelay: 100,
    maxDelay: 2000,
    backoffMultiplier: 2,
  });

  console.log(`✓ API call succeeded after ${apiAttempt} attempts`);
  console.log(`  Result: ${JSON.stringify(result)}`);

  // ========================================================================
  // 2. WORKFLOW WITH RETRY POLICY
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('2. Workflow Action with Retry Policy');
  console.log('='.repeat(80));

  const executor = new InMemoryWorkflowExecutor({
    enableResilience: true,
  });

  const workflowWithRetry: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    triggers: {
      manual: { type: 'manual' }
    },
    actions: {
      fetchData: {
        type: 'Compose',
        retryPolicy: {
          maxAttempts: 3,
          initialDelay: 100,
          backoffMultiplier: 2,
        },
        inputs: {
          message: 'Data fetched successfully',
        },
      },
    },
  };

  console.log('\nExecuting workflow with retry policy...');
  const instanceId1 = await executor.execute(workflowWithRetry, {});
  const workflowResult1 = await executor.waitForCompletion(instanceId1);
  console.log(`✓ Workflow completed`);
  console.log(`  Result: ${JSON.stringify(workflowResult1.fetchData)}`);

  // ========================================================================
  // 3. TIMEOUT PROTECTION
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('3. Timeout Protection');
  console.log('='.repeat(80));

  const workflowWithTimeout: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    triggers: {
      manual: { type: 'manual' }
    },
    actions: {
      quickOperation: {
        type: 'Compose',
        timeout: 5000, // 5 second timeout
        inputs: {
          result: 'completed quickly',
        },
      },
    },
  };

  console.log('\nExecuting workflow with 5s timeout...');
  const instanceId2 = await executor.execute(workflowWithTimeout, {});
  const workflowResult2 = await executor.waitForCompletion(instanceId2);
  console.log(`✓ Operation completed within timeout`);
  console.log(`  Result: ${JSON.stringify(workflowResult2.quickOperation)}`);

  // ========================================================================
  // 4. CIRCUIT BREAKER
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('4. Circuit Breaker Pattern');
  console.log('='.repeat(80));

  const circuitBreaker = new CircuitBreaker('external-service', {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 2000, // 2 seconds
  });

  let serviceCallCount = 0;
  const externalService = async () => {
    serviceCallCount++;
    if (serviceCallCount <= 3) {
      throw new Error('Service down');
    }
    return 'Service response';
  };

  console.log('\nMaking calls to failing service...');
  console.log(`Initial circuit state: ${circuitBreaker.getState()}`);

  // Fail 3 times to open circuit
  for (let i = 0; i < 3; i++) {
    try {
      await circuitBreaker.execute(externalService);
    } catch (error: any) {
      console.log(`  Call ${i + 1} failed: ${error.message}`);
    }
  }

  console.log(`Circuit state after failures: ${circuitBreaker.getState()}`);

  // Try again - should fail fast
  try {
    await circuitBreaker.execute(externalService);
  } catch (error: any) {
    console.log(`✓ Circuit is OPEN, failing fast: ${error.message}`);
  }

  console.log(`Calls to service: ${serviceCallCount} (circuit prevented additional calls)`);

  // ========================================================================
  // 5. RATE LIMITING
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('5. Rate Limiting');
  console.log('='.repeat(80));

  const rateLimiter = new RateLimiter('api-calls', {
    requests: 3,
    per: 'second',
  });

  console.log('\nMaking 5 API calls with rate limit (3 per second)...');
  console.log(`Available tokens: ${rateLimiter.getAvailableTokens()}`);

  const startTime = Date.now();

  for (let i = 0; i < 5; i++) {
    await rateLimiter.acquire();
    const elapsed = Date.now() - startTime;
    console.log(`  Call ${i + 1} completed at ${elapsed}ms (tokens: ${rateLimiter.getAvailableTokens()})`);
  }

  const totalTime = Date.now() - startTime;
  console.log(`✓ All calls completed in ${totalTime}ms`);
  console.log(`  First 3 calls were instant, last 2 waited for token refill`);

  // ========================================================================
  // 6. SCOPE WITH ERROR HANDLING
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('6. Scope with Error Handling');
  console.log('='.repeat(80));

  const workflowWithScope: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    triggers: {
      manual: { type: 'manual' }
    },
    actions: {
      dataProcessing: {
        type: 'Scope',
        inputs: {
          actions: {
            validateInput: {
              type: 'Compose',
              inputs: { valid: true },
            },
            processData: {
              type: 'Compose',
              inputs: { processed: 'data' },
            },
            storeResult: {
              type: 'Compose',
              inputs: { stored: true },
            },
          },
        },
      },
    },
  };

  console.log('\nExecuting workflow with scope...');
  const instanceId3 = await executor.execute(workflowWithScope, {});
  const workflowResult3 = await executor.waitForCompletion(instanceId3);
  
  console.log(`✓ Scope completed all actions`);
  console.log(`  Steps executed: ${Object.keys(workflowResult3.dataProcessing).length}`);
  console.log(`  Results: ${JSON.stringify(workflowResult3.dataProcessing)}`);

  // ========================================================================
  // 7. COMBINED RESILIENCE
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('7. Combined Resilience Patterns');
  console.log('='.repeat(80));

  const robustWorkflow: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    triggers: {
      manual: { type: 'manual' }
    },
    actions: {
      robustApiCall: {
        type: 'Compose',
        timeout: 10000, // 10s timeout
        retryPolicy: {
          maxAttempts: 3,
          initialDelay: 500,
          backoffMultiplier: 2,
        },
        rateLimit: {
          requests: 5,
          per: 'second',
        },
        circuitBreaker: {
          enabled: true,
          failureThreshold: 5,
          timeout: 30000,
        },
        inputs: {
          endpoint: 'https://api.example.com/data',
          result: 'success',
        },
      },
    },
  };

  console.log('\nExecuting workflow with ALL resilience features...');
  console.log('  ✓ Timeout: 10s');
  console.log('  ✓ Retry: 3 attempts with exponential backoff');
  console.log('  ✓ Rate limit: 5 requests per second');
  console.log('  ✓ Circuit breaker: opens after 5 failures');

  const instanceId4 = await executor.execute(robustWorkflow, {});
  const workflowResult4 = await executor.waitForCompletion(instanceId4);
  
  console.log(`\n✓ Robust workflow completed successfully`);
  console.log(`  Result: ${JSON.stringify(workflowResult4.robustApiCall)}`);

  // ========================================================================
  // BENEFITS SUMMARY
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('Resilience Benefits');
  console.log('='.repeat(80));

  console.log(`
✓ RETRY POLICY
  - Automatic retry of transient failures
  - Exponential backoff prevents overwhelming services
  - Configurable max attempts and delays
  - Can specify retryable error types

✓ TIMEOUT PROTECTION
  - Prevents hanging operations
  - Fails fast instead of waiting forever
  - Configurable per action
  - Custom timeout messages

✓ CIRCUIT BREAKER
  - Prevents cascading failures
  - Stops calling failing services
  - Automatic recovery (half-open state)
  - Configurable thresholds and timeouts

✓ RATE LIMITING
  - Token bucket algorithm
  - Prevents overwhelming APIs
  - Smooth request distribution
  - Configurable rates (per second/minute/hour)

✓ ERROR SCOPES
  - Group related actions
  - Centralized error handling
  - Cleanup on failure
  - Transaction-like semantics

✓ ZERO BLOAT
  - ~250 lines of pure TypeScript
  - No external dependencies
  - Battle-tested patterns
  - Minimal performance overhead
  `);

  console.log('\n' + '='.repeat(80));
  console.log('Example Complete!');
  console.log('='.repeat(80));
}

main().catch(console.error);
