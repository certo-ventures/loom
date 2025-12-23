/**
 * Execute API Routes - Run actors
 */

import type { FastifyInstance } from 'fastify';
import type { WasmExecutor } from '../execution/wasm-executor';
import type { ExecuteRequest } from '../types';

export async function registerExecuteRoutes(
  server: FastifyInstance,
  executor: WasmExecutor
) {
  // Execute an actor
  server.post('/execute', {
    schema: {
      description: 'Execute an actor',
      body: {
        type: 'object',
        required: ['actorType', 'input'],
        properties: {
          actorType: { type: 'string' },
          version: { type: 'string' },
          input: { type: 'object' },
          timeout: { type: 'number' },
          callbackUrl: { type: 'string' },
          correlationId: { type: 'string' },
          priority: { type: 'number', minimum: 0, maximum: 10 },
        },
      },
    },
  }, async (request, reply) => {
    const executeRequest = request.body as ExecuteRequest;

    // Execute synchronously
    const result = await executor.execute(executeRequest);

    // If callback URL, send result there (TODO)
    if (executeRequest.callbackUrl) {
      // Queue for async delivery
      server.log.info(
        { callbackUrl: executeRequest.callbackUrl, executionId: result.executionId },
        'Would send result to callback URL'
      );
    }

    return result;
  });

  // Get execution result by ID
  server.get('/executions/:executionId', {
    schema: {
      description: 'Get execution result',
      params: {
        type: 'object',
        required: ['executionId'],
        properties: {
          executionId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { executionId } = request.params as any;

    // TODO: Implement result storage/retrieval
    return reply.code(501).send({
      error: 'Not implemented - result storage coming soon',
    });
  });
}
