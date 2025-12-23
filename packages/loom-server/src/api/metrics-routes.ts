/**
 * Metrics API Routes - Real-time metrics with WebSocket
 */

import type { FastifyInstance } from 'fastify';
import type { MetricsCollector } from '../observability/metrics-collector';

export async function registerMetricsRoutes(
  server: FastifyInstance,
  metricsCollector: MetricsCollector
) {
  // Get current metrics snapshot
  server.get('/metrics', async (request, reply) => {
    const snapshot = metricsCollector.getSnapshot();
    return snapshot;
  });

  // Get metrics for specific actor
  server.get('/metrics/actors/:actorId', async (request, reply) => {
    const { actorId } = request.params as any;
    const metrics = metricsCollector.getActorMetrics(actorId);
    
    if (!metrics) {
      return reply.code(404).send({ error: 'Actor not found' });
    }
    
    return metrics;
  });

  // WebSocket endpoint for real-time metrics
  (server as any).get('/metrics/stream', { websocket: true }, (connection: any, request: any) => {
    const socket = connection.socket;
    server.log.info('Client connected to metrics stream');

    // Send initial snapshot
    const initialSnapshot = metricsCollector.getSnapshot();
    socket.send(JSON.stringify({
      type: 'metrics.snapshot',
      timestamp: Date.now(),
      data: initialSnapshot,
    }));

    // Listen for metric events
    const metricHandler = (event: any) => {
      socket.send(JSON.stringify(event));
    };

    metricsCollector.on('metric', metricHandler);

    // Send periodic snapshots every 5 seconds
    const snapshotInterval = setInterval(() => {
      const snapshot = metricsCollector.getSnapshot();
      socket.send(JSON.stringify({
        type: 'metrics.snapshot',
        timestamp: Date.now(),
        data: snapshot,
      }));
    }, 5000);

    // Cleanup on disconnect
    socket.on('close', () => {
      server.log.info('Client disconnected from metrics stream');
      metricsCollector.off('metric', metricHandler);
      clearInterval(snapshotInterval);
    });

    socket.on('error', (error: Error) => {
      server.log.error({ error }, 'WebSocket error');
      metricsCollector.off('metric', metricHandler);
      clearInterval(snapshotInterval);
    });
  });
}
