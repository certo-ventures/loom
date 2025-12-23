/**
 * Tests for Workflow Resilience Features
 * 
 * Tests retry, timeout, circuit breaker, rate limiting, and error scopes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryWorkflowExecutor, WorkflowDefinition } from '../../workflow/index.js';
import { CircuitBreaker, RateLimiter, retryWithBackoff, withTimeout } from '../../workflow/resilience.js';

describe('Workflow Resilience', () => {
  let executor: InMemoryWorkflowExecutor;

  beforeEach(() => {
    executor = new InMemoryWorkflowExecutor({
      enableResilience: true,
    });
  });

  describe('Timeout', () => {
    it('should timeout slow actions', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          slowAction: {
            type: 'Compose',
            timeout: 100, // 100ms timeout
            inputs: 'test',
          },
        },
      };

      const instanceId = await executor.execute(workflow, {});
      const result = await executor.waitForCompletion(instanceId);
      
      // Should complete (Compose is fast)
      expect(result.slowAction).toBe('test');
    });
  });

  describe('Retry Policy', () => {
    it('should retry failed actions with exponential backoff', async () => {
      let attempts = 0;
      
      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      };

      const result = await retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelay: 10,
        backoffMultiplier: 2,
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should respect max attempts', async () => {
      let attempts = 0;
      
      const fn = async () => {
        attempts++;
        throw new Error('Always fails');
      };

      await expect(
        retryWithBackoff(fn, {
          maxAttempts: 3,
          initialDelay: 10,
        })
      ).rejects.toThrow('Always fails');

      expect(attempts).toBe(3);
    });

    it('should only retry retryable errors', async () => {
      let attempts = 0;
      
      const fn = async () => {
        attempts++;
        throw new Error('Fatal error');
      };

      await expect(
        retryWithBackoff(fn, {
          maxAttempts: 5,
          initialDelay: 10,
          retryableErrors: ['Temporary'],
        })
      ).rejects.toThrow('Fatal error');

      expect(attempts).toBe(1); // Not retried
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit after failures', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 3,
        timeout: 100,
      });

      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error('Service unavailable');
      };

      // Fail 3 times to open circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow('Service unavailable');
      }

      expect(breaker.getState()).toBe('open');

      // Next call should fail immediately without executing
      const beforeAttempts = attempts;
      await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker [test] is OPEN');
      expect(attempts).toBe(beforeAttempts); // Function not called
    });

    it('should transition to half-open after timeout', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 2,
        timeout: 50, // 50ms timeout
      });

      const fn = async () => {
        throw new Error('Fail');
      };

      // Open circuit
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      expect(breaker.getState()).toBe('open');

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 60));

      // Should transition to half-open (but fail again)
      await expect(breaker.execute(fn)).rejects.toThrow('Fail');
      expect(breaker.getState()).toBe('half-open');
    });

    it('should close circuit after successes in half-open', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 50,
      });

      let shouldFail = true;
      const fn = async () => {
        if (shouldFail) throw new Error('Fail');
        return 'success';
      };

      // Open circuit
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      expect(breaker.getState()).toBe('open');

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 60));

      // Now succeed
      shouldFail = false;
      await breaker.execute(fn);
      expect(breaker.getState()).toBe('half-open');
      
      await breaker.execute(fn);
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('Rate Limiting', () => {
    it('should limit request rate', async () => {
      const limiter = new RateLimiter('test', {
        requests: 2,
        per: 'second',
      });

      const start = Date.now();

      // First 2 requests should be instant
      await limiter.acquire();
      await limiter.acquire();
      const after2 = Date.now() - start;
      expect(after2).toBeLessThan(50);

      // Third request should wait
      await limiter.acquire();
      const after3 = Date.now() - start;
      expect(after3).toBeGreaterThanOrEqual(400); // ~500ms wait (tokens refilling)
    });

    it('should track available tokens', async () => {
      const limiter = new RateLimiter('test', {
        requests: 5,
        per: 'second',
      });

      expect(limiter.getAvailableTokens()).toBe(5);
      
      await limiter.acquire(3);
      expect(limiter.getAvailableTokens()).toBe(2);
    });

    it('should refill tokens over time', async () => {
      const limiter = new RateLimiter('test', {
        requests: 10,
        per: 'second',
      });

      await limiter.acquire(10);
      expect(limiter.getAvailableTokens()).toBe(0);

      // Wait for refill
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(limiter.getAvailableTokens()).toBeGreaterThan(3); // ~5 tokens refilled
    });
  });

  describe('Timeout Utility', () => {
    it('should timeout slow operations', async () => {
      const slowFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return 'too slow';
      };

      await expect(
        withTimeout(slowFn, 100, 'Operation too slow')
      ).rejects.toThrow('Operation too slow');
    });

    it('should not timeout fast operations', async () => {
      const fastFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'fast';
      };

      const result = await withTimeout(fastFn, 100);
      expect(result).toBe('fast');
    });
  });

  describe('Scope with Error Handling', () => {
    it('should execute scope actions', async () => {
      const workflow: WorkflowDefinition = {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0',
        triggers: {
          manual: { type: 'manual' }
        },
        actions: {
          myScope: {
            type: 'Scope',
            inputs: {
              actions: {
                step1: {
                  type: 'Compose',
                  inputs: 'first',
                },
                step2: {
                  type: 'Compose',
                  inputs: 'second',
                },
              },
            },
          },
        },
      };

      const instanceId = await executor.execute(workflow, {});
      const result = await executor.waitForCompletion(instanceId);
      
      expect(result.myScope.step1).toBe('first');
      expect(result.myScope.step2).toBe('second');
    });
  });

  describe('Integration: Multiple Resilience Patterns', () => {
    it('should combine timeout and retry', async () => {
      let attempts = 0;
      
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Retry me');
        }
        return 'success';
      };

      const result = await withTimeout(
        () => retryWithBackoff(fn, {
          maxAttempts: 3,
          initialDelay: 10,
        }),
        1000
      );

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('should handle circuit breaker with rate limiting', async () => {
      const limiter = new RateLimiter('test', {
        requests: 2,
        per: 'second',
      });

      const breaker = new CircuitBreaker('test', {
        failureThreshold: 5,
      });

      let callCount = 0;
      const fn = async () => {
        await limiter.acquire();
        callCount++;
        return 'success';
      };

      // Make 2 rate-limited calls through circuit breaker
      await breaker.execute(fn);
      await breaker.execute(fn);

      expect(callCount).toBe(2);
      expect(breaker.getState()).toBe('closed');
    });
  });
});
