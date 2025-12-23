/**
 * Registry API Routes - Actor metadata management
 */

import type { FastifyInstance } from 'fastify';
import type { DataStore } from './data-store';
import type { ActorMetadata } from '../types';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// JSON Schema for actor metadata
const actorMetadataSchema = {
  type: 'object',
  required: ['actorId', 'version', 'displayName', 'inputSchema', 'outputSchema'],
  properties: {
    actorId: { type: 'string', pattern: '^[a-z0-9-]+$' },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    displayName: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    policy: { type: 'string', format: 'uri' },
    ttl: { type: 'number', minimum: 0 },
    maxExecutionTime: { type: 'number', minimum: 1 },
    tags: { type: 'array', items: { type: 'string' } },
    author: { type: 'string' },
    tenantId: { type: 'string' },
    public: { type: 'boolean' },
  },
};

const validateActorMetadata = ajv.compile(actorMetadataSchema);

export async function registerRegistryRoutes(
  server: FastifyInstance,
  dataStore: DataStore
) {
  // Register actor with WASM module
  server.post('/actors', {
    schema: {
      description: 'Register a new actor with WASM module',
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            actorId: { type: 'string' },
            version: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    // Parse multipart form data
    const parts = request.parts();
    let metadata: ActorMetadata | null = null;
    let wasmBuffer: Buffer | null = null;

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'metadata') {
        try {
          metadata = JSON.parse(part.value as string);
        } catch {
          return reply.code(400).send({ error: 'Invalid JSON in metadata field' });
        }
      } else if (part.type === 'file' && part.fieldname === 'file') {
        wasmBuffer = await part.toBuffer();
      }
    }

    if (!metadata) {
      return reply.code(400).send({ error: 'Missing metadata field' });
    }

    if (!wasmBuffer) {
      return reply.code(400).send({ error: 'Missing WASM file' });
    }

    // Validate metadata
    if (!validateActorMetadata(metadata)) {
      return reply.code(400).send({
        error: 'Invalid actor metadata',
        details: validateActorMetadata.errors,
      });
    }

    // Add timestamps
    const now = new Date().toISOString();
    metadata.createdAt = now;
    metadata.updatedAt = now;

    // Save to data store
    await dataStore.saveActorMetadata(metadata);
    await dataStore.saveWasmModule(metadata.actorId, metadata.version, wasmBuffer!);

    server.log.info({ actorId: metadata.actorId, version: metadata.version }, 'Actor registered');

    return {
      actorId: metadata.actorId,
      version: metadata.version,
      message: 'Actor registered successfully',
    };
  });

  // List actors
  server.get('/actors', {
    schema: {
      description: 'List all actors',
      querystring: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          tags: { type: 'string' },  // Comma-separated
          public: { type: 'boolean' },
          search: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as any;
    
    const filter = {
      tenantId: query.tenantId,
      tags: query.tags ? query.tags.split(',') : undefined,
      public: query.public,
      search: query.search,
    };

    const actors = await dataStore.listActors(filter);
    return actors;
  });

  // Get specific actor
  server.get('/actors/:actorId', {
    schema: {
      description: 'Get actor metadata',
      params: {
        type: 'object',
        required: ['actorId'],
        properties: {
          actorId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          version: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { actorId } = request.params as any;
    const { version } = request.query as any;

    const actor = await dataStore.getActorMetadata(actorId, version);
    
    if (!actor) {
      return reply.code(404).send({ error: 'Actor not found' });
    }

    return actor;
  });

  // Delete actor
  server.delete('/actors/:actorId/:version', {
    schema: {
      description: 'Delete an actor version',
      params: {
        type: 'object',
        required: ['actorId', 'version'],
        properties: {
          actorId: { type: 'string' },
          version: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { actorId, version } = request.params as any;

    await dataStore.deleteActorMetadata(actorId, version);

    return { message: 'Actor deleted successfully' };
  });
}
