/**
 * Loom Studio Server - Event-Driven Observability
 * Subscribes to actor lifecycle events. NO POLLING!
 */

import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
app.use(cors());
app.use(express.json());

interface ActorState {
  id: string;
  type: string;
  status: 'active' | 'idle' | 'busy';
  workerId: string;
  messageCount: number;
  lastHeartbeat: string;
  metadata?: Record<string, any>;
}

const actors = new Map<string, ActorState>();
const clients = new Set<WebSocket>();

export function handleActorLifecycleEvent(event: any): void {
  const { type, actorId, actorType, workerId, timestamp, data } = event;

  switch (type) {
    case 'actor:registered':
      actors.set(actorId, {
        id: actorId,
        type: actorType,
        status: 'idle',
        workerId,
        messageCount: 0,
        lastHeartbeat: timestamp,
        metadata: data,
      });
      broadcast('actor:update', actors.get(actorId));
      break;

    case 'actor:unregistered':
      actors.delete(actorId);
      broadcast('actor:removed', { id: actorId });
      break;

    case 'actor:message-processed':
      const msgActor = actors.get(actorId);
      if (msgActor) {
        msgActor.messageCount++;
        msgActor.lastHeartbeat = timestamp;
        broadcast('actor:update', msgActor);
      }
      break;
  }
}

app.post('/api/events', (req, res) => {
  handleActorLifecycleEvent(req.body);
  res.json({ ok: true });
});

app.get('/api/actors', (req, res) => {
  res.json(Array.from(actors.values()));
});

app.get('/api/metrics', (req, res) => {
  const allActors = Array.from(actors.values());
  res.json({
    timestamp: new Date().toISOString(),
    actorPools: {
      totalActors: allActors.length,
      activeActors: allActors.filter(a => a.status === 'active').length,
    },
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const server = app.listen(9090, () => {
  console.log('🚀 Studio Server: http://localhost:9090');
  console.log('🎯 Event-driven - NO POLLING!');
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'actors', data: Array.from(actors.values()) }));
  ws.on('close', () => clients.delete(ws));
});

function broadcast(type: string, data: any) {
  const message = JSON.stringify({ type, data });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
