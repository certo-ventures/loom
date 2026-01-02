/**
 * Execute API Routes - Run actors
 */

import type { FastifyInstance } from 'fastify';
import type { WasmExecutor } from '../execution/wasm-executor';
import type { ExecuteRequest } from '../types';

/**
 * Send result as Server-Sent Events (for streaming)
 */
function sendAsSSE(reply: any, data: any, event = 'message'): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Send result as newline-delimited JSON
 */
function sendAsNDJSON(reply: any, data: any): void {
  reply.raw.write(JSON.stringify(data) + '\n');
}

export async function registerExecuteRoutes(
  server: FastifyInstance,
  executor: WasmExecutor
) {
  // Execute an actor
  server.post('/execute', {
    schema: {
      description: 'Execute an actor (supports JSON, SSE, NDJSON formats)',
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
          stream: { type: 'boolean', description: 'Enable streaming mode' },
        },
      },
    },
  }, async (request, reply) => {
    const executeRequest = request.body as ExecuteRequest & { stream?: boolean };
    const acceptHeader = request.headers.accept || 'application/json';

    // Determine response format
    const isSSE = acceptHeader.includes('text/event-stream');
    const isNDJSON = acceptHeader.includes('application/x-ndjson');
    const isStreaming = executeRequest.stream || isSSE || isNDJSON;

    // Set appropriate headers for streaming
    if (isSSE) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
    } else if (isNDJSON) {
      reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
      });
    }

    try {
      // Execute actor
      const result = await executor.execute(executeRequest);

      // If callback URL, send result there (TODO)
      if (executeRequest.callbackUrl) {
        server.log.info(
          { callbackUrl: executeRequest.callbackUrl, executionId: result.executionId },
          'Would send result to callback URL'
        );
      }

      // Send response in requested format
      if (isSSE) {
        sendAsSSE(reply, { type: 'start', executionId: result.executionId }, 'start');
        sendAsSSE(reply, { type: 'result', ...result }, 'result');
        sendAsSSE(reply, { type: 'complete' }, 'complete');
        reply.raw.end();
      } else if (isNDJSON) {
        sendAsNDJSON(reply, { type: 'start', executionId: result.executionId });
        sendAsNDJSON(reply, { type: 'result', ...result });
        sendAsNDJSON(reply, { type: 'complete' });
        reply.raw.end();
      } else {
        // Default JSON response
        return result;
      }
    } catch (error: any) {
      if (isSSE) {
        sendAsSSE(reply, { 
          type: 'error', 
          message: error.message,
          code: error.code || 'EXECUTION_ERROR',
        }, 'error');
        reply.raw.end();
      } else if (isNDJSON) {
        sendAsNDJSON(reply, { 
          type: 'error', 
          message: error.message,
          code: error.code || 'EXECUTION_ERROR',
        });
        reply.raw.end();
      } else {
        throw error;
      }
    }
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
