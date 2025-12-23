/**
 * Loom Server - Enterprise Actor Execution Platform
 * 
 * Powered by Loom Core, built with Fastify.
 */

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import Redis from 'ioredis';
import { config } from 'dotenv';
import { HealthChecker } from './resilience/health';
import { GracefulShutdown } from './resilience/graceful-shutdown';
import { InMemoryDataStore } from './registry/in-memory-store';
import { registerRegistryRoutes } from './api/registry-routes';
import { WasmExecutor } from './execution/wasm-executor';
import { NativeWasmExecutor } from './execution/native-wasm-executor';
import { registerExecuteRoutes } from './api/execute-routes';
import { WdlWorkflowExecutor } from './workflow/wdl-executor';
import { registerWorkflowRoutes } from './api/workflow-routes';
import { MetricsCollector } from './observability/metrics-collector';
import { registerMetricsRoutes } from './api/metrics-routes';

// Load environment variables
config();

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// Create Fastify instance
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    ...(process.env.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    }),
  },
  trustProxy: true,
  ajv: {
    customOptions: {
      removeAdditional: 'all',
      coerceTypes: true,
      useDefaults: true,
      allErrors: true,
    },
  },
});

// Redis client
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

// Data store (in-memory for now, can switch to Cosmos)
const dataStore = new InMemoryDataStore();

// Metrics collector
const metricsCollector = new MetricsCollector();

// Native WASM executor
const executor = new NativeWasmExecutor(
  {
    maxMemoryMB: 512,
    timeoutMs: 30000,
  },
  dataStore,
  metricsCollector
);

// Workflow executor
const workflowExecutor = new WdlWorkflowExecutor(executor as any);

// Health checker
const healthChecker = new HealthChecker(redis);

// Register plugins
await server.register(fastifyCors, {
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
});

await server.register(fastifyJwt, {
  secret: JWT_SECRET,
});

await server.register(fastifyRateLimit, {
  max: 1000,
  timeWindow: '1 minute',
  redis,
});

await server.register(import('@fastify/multipart'), {
  limits: {
    fileSize: 50 * 1024 * 1024,  // 50MB max WASM file
  },
});

await server.register(fastifyWebsocket);

// Health check endpoint
server.get('/health', async (request, reply) => {
  const health = await healthChecker.check();
  
  if (health.status === 'unhealthy') {
    return reply.code(503).send(health);
  }
  
  return health;
});

// Ready check (for K8s readiness probe)
server.get('/ready', async (request, reply) => {
  const health = await healthChecker.check();
  
  if (health.status === 'unhealthy') {
    return reply.code(503).send({ ready: false });
  }
  
  return { ready: true };
});

// Root endpoint
server.get('/', async (request, reply) => {
  return {
    name: 'Loom Server',
    version: '0.1.0',
    status: 'running',
    docs: '/docs',
    health: '/health',
  };
});

// Register API routes
await registerRegistryRoutes(server.withTypeProvider(), dataStore);
server.log.info('✅ Registry API routes registered');

await registerExecuteRoutes(server.withTypeProvider(), executor as any);
server.log.info('✅ Execute API routes registered');

await registerWorkflowRoutes(server.withTypeProvider(), workflowExecutor);
server.log.info('✅ Workflow API routes registered');

await registerMetricsRoutes(server.withTypeProvider(), metricsCollector);
server.log.info('✅ Metrics API routes registered');

// Start server
try {
  await server.listen({ port: PORT, host: HOST });
  
  server.log.info('🚀 Loom Server started successfully!');
  server.log.info(`📡 HTTP API: http://${HOST}:${PORT}`);
  server.log.info(`🏥 Health: http://${HOST}:${PORT}/health`);
  server.log.info(`📊 Studio: http://${HOST}:${PORT}/studio`);
  server.log.info('');
  server.log.info('🎯 Event-driven architecture - NO POLLING!');
  server.log.info('🔥 Powered by Loom Core + Fastify + Extism');
  
  // Setup graceful shutdown
  new GracefulShutdown(server, redis, server.log);
  
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
