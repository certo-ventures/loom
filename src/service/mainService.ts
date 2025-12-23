// @ts-nocheck - Legacy file, references deleted Dapr agents and AgentRegistry
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { defaultRegistry } from '../AgentRegistry.js';
import LocalToolExecutor from '../agents/localToolExecutor.js';
import DurableToolWorker from '../agents/durableToolWorker.js';
import AIAgentOrchestrator from '../agents/AIAgentOrchestrator.js';
import { InMemoryStateStore } from '../workflow/state.js';
import ToolStore from '../agents/toolStore.js';
import AiTraceStore from '../agents/aiTraceStore.js';
import { authenticateRequest, authenticateRequestAsync } from '../security/auth.js';
import { authorizeRequestAsync } from '../security/authorize.js';
import { warmupJwks } from '../security/jwt.js';
import { listNodes, nodeRegistry } from '../api/nodeRegistry.js';
import { startRun, getRun, subscribe, unsubscribe } from '../api/runManager.js';
import CodeRegistry from '../agents/codeRegistry.js';
import { CodeArtifactCreateSchema, CodeArtifactUpdateSchema } from '../schemas/codeArtifact.js';
import { listConfiguredTenants } from '../security/auth.js';
import { safeValidate } from '../utils/validators.js';
import { CosmosAdapter } from '../storage/cosmosAdapter.js';
import { translateFilterObligation, buildPredicate } from '../security/filterTranslator.js';
import { ValuationOrdersStore } from '../data/valuationOrdersStore.js';
import { ToolCallCreateSchema, ToolCallChunkPayloadSchema, WorkerControlSchema, AgentRegisterSchema, DeadLetterRestoreSchema } from '../schemas/http.js';
import * as metrics from '../observability/metrics.js';
import { handleComponentApiRequest } from '../api/componentsApi.js';

export type MainServiceConfig = {
  port?: number;
  registerDefaults?: boolean;
  startWorkers?: boolean;
  stateStore?: any;
  orchestrator?: any;
};

export class MainService {
  private server: http.Server | null = null;
  private port: number;
  private stateStore: any;
  private worker?: DurableToolWorker;
  private tenantWorkers: Map<string, DurableToolWorker> = new Map();
  private execInstance?: any;
  private orchestratorInstance?: any;

  constructor(private config: MainServiceConfig = {}) {
    this.port = config.port || 3000;
    // single shared state store for this MainService instance
    this.stateStore = config.stateStore || new InMemoryStateStore();
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url || '/';
    const method = (req.method || 'GET').toUpperCase();
    
    // CORS headers for frontend integration
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-Id, x-copilotkit-runtime-client-gql-version, accept');
    
    // Handle preflight OPTIONS requests
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    // Log all non-OPTIONS requests for debugging
    console.log(`[MainService] ${method} ${url}`);
    
    // ensure a correlation id is present for traceability
    try {
      const hdrs = req.headers as any;
      if (!hdrs['x-correlation-id']) {
        const { newRequestId } = await import('../observability/logger.js');
        hdrs['x-correlation-id'] = newRequestId();
        // also set response header for clients
        res.setHeader('X-Correlation-Id', hdrs['x-correlation-id']);
      }
    } catch (_) { /* noop */ }
    // helper to read request body as a promise so callers can await processing
    const readRequestBody = () => new Promise<string>((resolve) => {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => resolve(body));
    });
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Component Registry API
    // Handle /api/components/* routes for dynamic component loading
    if (url.startsWith('/api/components')) {
      try {
        const handled = await handleComponentApiRequest(req, res);
        if (handled) return;
      } catch (error) {
        console.error('[MainService] Error handling component API request:', error);
        // Continue to other routes if component API fails
      }
    }

    if (url === '/agents') {
      const list = defaultRegistry.listInstances().map((i: any) => ({ id: i.id, ctor: (i.constructor && (i.constructor as any).name) || 'unknown' }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: list.length, list }));
      return;
    }

    // Dapr subscriptions discovery endpoint
    if (url === '/dapr/subscribe' && method === 'GET') {
      // announce that this app subscribes to ai-trace-chunks on messagepubsub
      const subs = [
        { pubsubname: 'messagepubsub', topic: 'ai-trace-chunks', route: 'pubsub/ai-trace-chunks' },
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(subs));
      return;
    }

    // Temporary debug endpoint to inspect state store keys for a tenant
    // GET /debug/state?tenant=<id>
    // GET /debug/state/key?key=<fullKey>
    if (url.startsWith('/debug/state') && method === 'GET') {
      try {
        const u = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const tenantId = u.searchParams.get('tenant') || undefined;
        const key = u.searchParams.get('key');
        const state = this.stateStore;
        if (!state || typeof state.get !== 'function') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'no state store available' }));
          return;
        }
        if (key) {
          // return the specific key value
          const val = await state.get(key);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ key, value: val }));
          return;
        }
        // otherwise, return tenant-scoped index and a small sample of keys
        const prefix = tenantId ? `tenant:${tenantId}:` : '';
        const indexKey = `${prefix}ai:toolcalls:index`;
        const index = (await state.get(indexKey)) || [];
        // attempt to read up to first 20 indexed keys
        const sample: Record<string, any> = {};
        for (let i = 0; i < Math.min(20, index.length); i++) {
          try { sample[index[i]] = await state.get(index[i]); } catch (_) { sample[index[i]] = null; }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tenantId, indexKey, indexLength: index.length, index, sample }));
        return;
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
        return;
      }
    }

    if (url === '/metrics' && method === 'GET') {
      try {
        const m = (metrics && typeof (metrics as any).getMetrics === 'function') ? (metrics as any).getMetrics() : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(m));
      } catch (e) { res.writeHead(500); res.end(); }
      return;
    }

    // Dead-letter admin endpoints (authenticated)
    // GET /dead-letter?tenant=<tenant>  -> list dead-letter keys for tenant
    // GET /dead-letter/item?key=<fullKey> -> fetch specific dead-letter entry
    // POST /dead-letter/restore  { deadKey, restoreKey? } -> restore dead entry back to restoreKey
    if (url.startsWith('/dead-letter') && (method === 'GET' || method === 'POST')) {
      try {
        // parse URL and body where relevant
        const u = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  // require authentication + authorization
  let authRes;
  try {
    const { decision, principal } = await authorizeRequestAsync(req, { action: method === 'POST' ? 'restore' : 'list', resource: { type: 'deadLetter' } });
  // if principal missing but decision explicitly denies, return forbidden; otherwise unauthenticated
  if ((!principal) && decision && decision.allow === false) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
  if (!principal) { res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
  if (!decision || !decision.allow) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
    authRes = principal || null;
  } catch (ae: any) {
    // fail-closed for admin operations
    res.writeHead(ae.status || 503); res.end(JSON.stringify({ error: ae.message || 'authorization unavailable' })); return;
  }
  const tenantId = authRes.tenantId;
        const state = this.stateStore;
        if (!state || typeof state.get !== 'function') { res.writeHead(500); res.end(JSON.stringify({ error: 'no state store available' })); return; }

        if (method === 'GET') {
          const itemKey = u.searchParams.get('key');
          if (itemKey) {
            // fetch a specific dead-letter key
            // ensure the requested key belongs to the caller's tenant
            if (!itemKey.includes(`tenant:${tenantId}`)) { res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
            const val = await state.get(itemKey);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ key: itemKey, value: val }));
            return;
          }
          // otherwise list dead-letter keys for tenant
          const keysFn = (state as any).keys;
          if (typeof keysFn !== 'function') {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'state store does not support key listing' }));
            return;
          }
          const allKeys: string[] = await (state as any).keys();
          // prefer keys that start with tenant:<tenant>:dead-letter:
          const prefix = `tenant:${tenantId}:dead-letter:`;
          const matches = allKeys.filter((k) => k.startsWith(prefix) || (k.includes(':dead-letter:') && k.includes(`tenant:${tenantId}`)));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ tenant: tenantId, count: matches.length, keys: matches }));
          return;
        }

        // POST /dead-letter/restore
        if (method === 'POST') {
          try {
            const body = await readRequestBody();
            const j = JSON.parse(body || '{}');
              // validate request body
              try {
                const v = safeValidate(DeadLetterRestoreSchema, j);
                if (!v || !v.success) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'invalid payload' }));
                  return;
                }
              } catch (_) { /* continue */ }
              const deadKey = j.deadKey as string | undefined;
              let restoreKey = j.restoreKey as string | undefined;
              if (!deadKey) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'missing deadKey' })); return; }
              if (!deadKey.includes(`tenant:${tenantId}`)) { res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
              // attempt to infer original key if restoreKey not provided
              if (!restoreKey) {
                const marker = 'dead-letter:';
                const idx = deadKey.indexOf(marker);
                if (idx >= 0) {
                  let rem = deadKey.substring(idx + marker.length);
                  // if it ends with :<digits> (timestamp), strip it
                  const lastColon = rem.lastIndexOf(':');
                  const tail = rem.substring(lastColon + 1);
                  if (/^\d{9,}$/.test(tail)) {
                    rem = rem.substring(0, lastColon);
                  }
                  restoreKey = rem;
                }
              }
              if (!restoreKey) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'unable to infer restoreKey; provide restoreKey in request' })); return; }
              if (!restoreKey.includes(`tenant:${tenantId}`)) { res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized restore target' })); return; }
              const val = await state.get(deadKey);
              if (val === undefined) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'deadKey not found' })); return; }
              await state.set(restoreKey, val);
              if (typeof state.delete === 'function') {
                try { await state.delete(deadKey); } catch (_) { /* noop */ }
              }
              try { if ((metrics as any) && typeof (metrics as any).increment === 'function') (metrics as any).increment('dead_letter_restored'); } catch (_) { /* noop */ }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ restored: restoreKey }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid json' }));
          }
          return;
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
        return;
      }
    }

    // create a tool call (POST body: { instanceId, toolCallId, toolName, args })
    if (url === '/tool-call' && method === 'POST') {
      try {
        const body = await readRequestBody();
        // authorize creation of a tool-call (fail-closed)
        try {
          const { decision, principal } = await authorizeRequestAsync(req, { action: 'create', resource: { type: 'toolCall' } });
          if (!principal) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
          if (!decision || !decision.allow) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'forbidden' })); return; }
        } catch (ae: any) { res.writeHead(ae.status || 503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: ae.message || 'authorization unavailable' })); return; }
        const j = JSON.parse(body || '{}');
  try {
    const v = safeValidate(ToolCallCreateSchema, { toolCallId: j.toolCallId, agentId: j.instanceId, toolName: j.toolName, args: j.args });
          if (!v || !v.success) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'payload failed validation', details: (v && (v as any).error ? (v as any).error.format?.() || String((v as any).error) : undefined) }));
            return;
          }
        } catch (ve) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'validation error' }));
          return;
        }
  const state = this.stateStore;
  // principal already validated above; fetch to extract tenant for storage operations
  const { principal: currentPrincipal } = await authorizeRequestAsync(req, { action: 'create', resource: { type: 'toolCall' } }).catch(() => ({ principal: undefined }));
  const tenantId = currentPrincipal?.tenantId || undefined;
        const ts = new ToolStore(state, tenantId);
        await ts.createToolCall({ agentId: j.instanceId, toolCallId: j.toolCallId, toolName: j.toolName, args: j.args } as any);
        // record ai-trace entry for creation
        try {
          const ats = new AiTraceStore(state, tenantId);
          await ats.appendTrace(j.instanceId, { type: 'tool-call-created', toolCallId: j.toolCallId, toolName: j.toolName, args: j.args });
        } catch (_) { /* noop */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ created: j.toolCallId }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
      return;
    }

    // GET /valuation-orders?tenant=<>&ownerId=...  - demo endpoint showing policy-driven filtering
    if (url.startsWith('/valuation-orders') && method === 'GET') {
      try {
    // authorize and request filter obligations
    const { decision, principal } = await authorizeRequestAsync(req, { action: 'list', resource: { type: 'valuationOrder' } });
    // if principal missing but decision explicitly denies, return forbidden; otherwise unauthenticated
    if ((!principal) && decision && decision.allow === false) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
    if (!principal) { res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    if (!decision || !decision.allow) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
        // list store and apply obligation via in-memory evaluator
    const store = new ValuationOrdersStore();
        // get tenant from principal if available
        const tenantId = principal?.tenantId || undefined;
        const items = await store.listByTenant(tenantId);
        const filterOb = (decision.obligations && decision.obligations.find((o: any) => o.type === 'filter')) as any;
        // Pagination args
        const u = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const limit = Number(u.searchParams.get('limit') || '50');
        const next = u.searchParams.get('next') || undefined;

        // If Cosmos configured, attempt to use adapter for efficient query
        if (process.env.COSMOS_ENDPOINT) {
          try {
            const adapter = new CosmosAdapter({ endpoint: process.env.COSMOS_ENDPOINT, key: process.env.COSMOS_KEY, database: process.env.COSMOS_DB });
            let fragment = { where: '1=1', params: [] } as any;
            if (filterOb) fragment = translateFilterObligation(filterOb, principal);
            // execute query against container 'valuationOrders'
            const { items: dbItems, continuationToken } = await adapter.queryWithSql('valuationOrders', tenantId || '', fragment, { limit, continuationToken: next });
            let outItems = dbItems || [];
            // apply masks if present
            const masks = (filterOb && filterOb.value && filterOb.value.masks) || [];
            if (masks && masks.length > 0) {
              outItems = outItems.map((it: any) => {
                const copy = { ...it };
                for (const m of masks) {
                  if (m.mask === 'redact') copy[m.field] = 'REDACTED';
                  else if (m.mask === 'nullify') copy[m.field] = null;
                  else if (m.mask === 'hash') copy[m.field] = '***';
                  else if (m.mask === 'partial' && typeof copy[m.field] === 'string') copy[m.field] = copy[m.field].substring(0, 3) + '...';
                }
                return copy;
              });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ count: outItems.length, items: outItems, nextToken: continuationToken }));
            return;
          } catch (e: any) {
            if (e && e.code === 'QUERY_TOO_LARGE') {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'policy returned too-large membership list; use materialized sets or narrower policies' }));
              return;
            }
            // fallthrough to in-memory fallback
          }
        }

        // fallback: in-memory filtering
        let out = items;
        if (filterOb) {
          const pred = buildPredicate(filterOb, principal);
          out = items.filter(pred as any);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count: out.length, items: out }));
        return;
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); return; }
    }

    // Code Registry CRUD endpoints (tenant-scoped)
    // POST /code  -> create code artifact (body: CodeArtifactCreateSchema)
    // GET /code?id=<id> -> fetch artifact
    // GET /code/list -> list artifacts for tenant
    // DELETE /code?id=<id> -> delete artifact
    if (url === '/code' && method === 'POST') {
      try {
        const body = await readRequestBody();
  // authorization: call authorizeRequestAsync to get decision and obligations
  try {
    const { decision, principal } = await authorizeRequestAsync(req, { action: 'create', resource: { type: 'codeArtifact' } });
    if (!decision || !decision.allow) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden', reason: decision?.reason })); return; }
  } catch (e) {
    // if authorization service fails, fail-closed for mutating operations
    res.writeHead(503); res.end(JSON.stringify({ error: 'authorization unavailable' })); return;
  }
  // use principal provided by authorizeRequestAsync to determine tenant
  const { principal: authPrincipal } = await authorizeRequestAsync(req, { action: 'create', resource: { type: 'codeArtifact' } }).catch(() => ({ principal: undefined }));
  const tenantId = authPrincipal?.tenantId as string | undefined;
  if (!tenantId) { res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
  const j = JSON.parse(body || '{}');
  console.log('POST /code body=', j);
  try {
    const v = safeValidate(CodeArtifactCreateSchema, j);
    console.log('POST /code validation=', v && (v.success ? 'ok' : v.error && v.error.format ? v.error.format() : String(v.error)));
    if (!v || !v.success) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid payload' })); return; }
  } catch (err) { console.error('POST /code validation threw', err); /* ignore */ }
        const cr = new CodeRegistry(this.stateStore, tenantId);
        const created = await cr.create({ ...j, tenantId });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ created }));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid json' })); }
      return;
    }

    if (url.startsWith('/code') && method === 'GET') {
      try {
        const u = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const id = u.searchParams.get('id');
        const list = u.pathname.endsWith('/list') || u.searchParams.get('list') !== null || u.pathname.endsWith('/list');
  // for reads, attempt authorization but allow missing middleware (read-only)
  const { decision: _dec, principal: readPrincipal } = await authorizeRequestAsync(req, { action: 'read', resource: { type: 'codeArtifact' }, allowMissing: true }).catch(() => ({ decision: null, principal: undefined }));
  const tenantId = readPrincipal?.tenantId as string | undefined;
  if (!tenantId) { res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
        const cr = new CodeRegistry(this.stateStore, tenantId);
        if (id) {
          const got = await cr.get(id);
          if (!got) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ artifact: got }));
          return;
        }
        // list
        // perform authorization to obtain any filter obligations
          try {
            const { decision, principal } = await authorizeRequestAsync(req, { action: 'list', resource: { type: 'codeArtifact' } });
            if (!decision || !decision.allow) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
            // if Cosmos configured, use adapter for efficient query
            if (process.env.COSMOS_ENDPOINT) {
              try {
                const adapter = new CosmosAdapter({ endpoint: process.env.COSMOS_ENDPOINT, key: process.env.COSMOS_KEY, database: process.env.COSMOS_DB });
                let fragment = { where: '1=1', params: [] } as any;
                const filterOb = (decision.obligations && decision.obligations.find((o: any) => o.type === 'filter')) as any;
                if (filterOb) fragment = translateFilterObligation(filterOb, principal);
                const { items: dbItems, continuationToken } = await adapter.queryWithSql('codeArtifacts', tenantId || '', fragment, { limit: 100 });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ count: dbItems.length, items: dbItems, nextToken: continuationToken }));
                return;
              } catch (e) {
                // fall back to current behavior
              }
            }
        } catch (e) {
          // if authorization fails, return 401
          res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return;
        }
        const items = await cr.list();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count: items.length, items }));
        return;
  } catch (e) { console.error('DELETE /code handler error', e); res.writeHead(400); res.end(JSON.stringify({ error: String(e) })); return; }
    }

    if (url.startsWith('/code') && method === 'DELETE') {
      try {
        const u = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const id = u.searchParams.get('id');
        if (!id) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing id' })); return; }
  const auth = await authenticateRequestAsync(req);
  if (!auth || !auth.tenantId) { res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
  const tenantId = auth.tenantId;
  const cr = new CodeRegistry(this.stateStore, tenantId);
  const ok = await cr.delete(id);
        if (!ok) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ deleted: id }));
        return;
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: String(e) })); return; }
    }

    // control worker lifecycle
    if (url === '/workers/start' && method === 'POST') {
      try {
        const body = await readRequestBody();
        const j = JSON.parse(body || '{}');
        try {
          const v = safeValidate(WorkerControlSchema, j);
          if (!v || !v.success) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid payload' }));
            return;
          }
        } catch (_) { /* ignore */ }
        const tenantId = j.tenantId || undefined;
        const state = this.stateStore;
        // ensure orchestrator and executor registered
        this.orchestratorInstance = this.config.orchestrator || new AIAgentOrchestrator('ai_agent_orchestrator', undefined, { stateStore: state });
        try { defaultRegistry.registerInstance('ai_agent_orchestrator', this.orchestratorInstance as any); } catch (_) { /* noop */ }
        this.execInstance = new LocalToolExecutor(state as any);
        try { defaultRegistry.registerInstance('tool-executor', this.execInstance as any); } catch (_) { /* noop */ }

        if (tenantId) {
          if (!this.tenantWorkers.has(tenantId)) {
            const w = new DurableToolWorker(state as any, this.orchestratorInstance as any, 200, tenantId);
            await w.start();
            this.tenantWorkers.set(tenantId, w);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ started: true, tenant: tenantId }));
          return;
        }

        // start global worker if none
        if (!this.worker) {
          this.worker = new DurableToolWorker(state as any, this.orchestratorInstance as any, 200);
          await this.worker.start();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ started: true }));
      } catch (e) { res.writeHead(400); res.end(); }
      return;
    }

    if (url === '/workers/stop' && method === 'POST') {
      try {
        const body = await readRequestBody();
        const j = JSON.parse(body || '{}');
        try {
          const v = safeValidate(WorkerControlSchema, j);
          if (!v || !v.success) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid payload' }));
            return;
          }
        } catch (_) { /* ignore */ }
        const tenantId = j.tenantId || undefined;
        if (tenantId) {
          const w = this.tenantWorkers.get(tenantId);
          if (w) { await w.stop(); this.tenantWorkers.delete(tenantId); }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ stopped: true, tenant: tenantId }));
          return;
        }
        if (this.worker) await this.worker.stop();
        this.worker = undefined;
        try { defaultRegistry.unregisterInstance('tool-executor'); } catch (_) { /* noop */ }
        try { defaultRegistry.unregisterInstance('ai_agent_orchestrator'); } catch (_) { /* noop */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ stopped: true }));
      } catch (e) { res.writeHead(400); res.end(); }
      return;
    }

    // get ai-trace for an instance: GET /ai-trace?instanceId=...
    if (url.startsWith('/ai-trace') && method === 'GET') {
      const u = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const instanceId = u.searchParams.get('instanceId');
      const toolCallId = u.searchParams.get('toolCallId');
      const type = u.searchParams.get('type');
      if (!instanceId) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing instanceId' })); return; }
      try {
        // require authorization and tenant for trace reads
        const { decision, principal } = await authorizeRequestAsync(req, { action: 'read', resource: { type: 'aiTrace' } });
        if (!decision || !decision.allow) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
        const tenantId = principal?.tenantId as string | undefined;
        if (!tenantId) { res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
        const state = this.stateStore;
        const ats = new AiTraceStore(state, tenantId);
        let traces = await ats.getTraces(instanceId);
        try { if ((metrics as any) && typeof (metrics as any).increment === 'function') (metrics as any).increment('ai_trace_query'); } catch (_) { /* noop */ }
        // apply filters if provided
        if (toolCallId) traces = traces.filter((t: any) => t.entry && (t.entry.toolCallId === toolCallId || t.entry.toolCall?.toolCallId === toolCallId));
        if (type) traces = traces.filter((t: any) => t.entry && t.entry.type === type);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ instanceId, traces }));
        return;
      } catch (ae: any) { res.writeHead(ae.status || 401); res.end(JSON.stringify({ error: ae.message || 'unauthorized' })); return; }
    }

    // Minimal UI adapter endpoints for the Flow UI prototype
    // GET /api/ui/nodes
    if (url === '/api/ui/nodes' && method === 'GET') {
      try {
        const nodes = listNodes();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ nodes }));
        return;
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); return; }
    }

    // GET /api/ui/nodes/:type/schema
    if (url.startsWith('/api/ui/nodes/') && method === 'GET') {
      try {
        const u = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const parts = u.pathname.split('/').filter(Boolean);
        // expected ['/api','ui','nodes',':type','schema?']
        const type = parts[3];
        if (!type) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing node type' })); return; }
        const node = (nodeRegistry as any)[type];
        if (!node) { res.writeHead(404); res.end(JSON.stringify({ error: 'unknown node type' })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ schema: node.configSchema || {} }));
        return;
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); return; }
    }

    // POST /api/ui/runs - start a run from UI flow JSON or WDL definition (async)
    if (url === '/api/ui/runs' && method === 'POST') {
      try {
        const body = await readRequestBody();
        const j = JSON.parse(body || '{}');
        const flowJson = j.flowJson || j.flow;
        const definition = j.definition; // WDL format
        const inputs = j.inputs || {};
        
        let def: any;
        
        // Support both React Flow format and WDL format
        if (definition) {
          // Already in WDL format, use directly
          def = definition;
        } else if (flowJson && flowJson.nodes) {
          // React Flow format, convert to WDL
          try {
            const { convertFlowToWorkflow } = await import('../api/flowConverter.js');
            def = convertFlowToWorkflow(flowJson);
          } catch (ce) { 
            res.writeHead(500); 
            res.end(JSON.stringify({ error: `Flow conversion error: ${String(ce)}` })); 
            return; 
          }
        } else {
          res.writeHead(400); 
          res.end(JSON.stringify({ error: 'missing definition or flowJson' })); 
          return;
        }

        const runId = startRun(def, inputs);
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ runId, status: 'started' }));
        return;
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); return; }
    }

    // POST /api/copilotkit - CopilotKit GraphQL endpoint (streams events to frontend)
    if (url === '/api/copilotkit' && method === 'POST') {
      console.log('[MainService] Handling CopilotKit request');
      console.log('[MainService] Headers:', JSON.stringify(req.headers, null, 2));
      try {
        const { handleCopilotKitRequest } = await import('../copilotkit/graphqlAdapter.js');
        await handleCopilotKitRequest(req, res);
        return;
      } catch (e) {
        console.error('[MainService] CopilotKit error:', e);
        console.error('[MainService] Error stack:', e instanceof Error ? e.stack : 'No stack trace');
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e), stack: e instanceof Error ? e.stack : undefined }));
        }
        return;
      }
    }

    // SSE stream for a run: GET /api/ui/runs/:runId/stream
    if (url.startsWith('/api/ui/runs/') && url.endsWith('/stream') && method === 'GET') {
      try {
        const u = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const parts = u.pathname.split('/').filter(Boolean);
        const runId = parts[3];
        if (!runId) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing runId' })); return; }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        res.write('\n');

        const send = (data: string) => {
          try { res.write(`data: ${data}\n\n`); } catch (_) { /* ignore */ }
        };

        const ok = subscribe(runId, send);
        if (!ok) { res.writeHead(404); res.end(JSON.stringify({ error: 'run not found' })); return; }

        req.on('close', () => { unsubscribe(runId, send); });
        return;
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); return; }
    }

      // Credential CRUD endpoints (tenant-agnostic simple store)
      if (url === '/api/ui/credentials' && method === 'POST') {
        try {
          const body = await readRequestBody();
          const j = JSON.parse(body || '{}');
          if (!j.name || !j.value) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing fields' })); return; }
          const key = `ui:credential:${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
          const store = this.stateStore;
          await store.set(key, { id: key, name: j.name, value: j.value, createdAt: Date.now() });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: key }));
          return;
        } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid json' })); return; }
      }

      if (url.startsWith('/api/ui/credentials') && method === 'GET') {
        try {
          const u = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
          const id = u.searchParams.get('id');
          const store = this.stateStore;
          if (id) {
            const got = await store.get(id);
            if (!got) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }
            // mask value
            const masked = { ...got, value: '*****' };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ credential: masked }));
            return;
          }
          // list all keys from store if supported
          const keysFn = (store as any).keys;
          const items: any[] = [];
          if (typeof keysFn === 'function') {
            const all = await (store as any).keys();
            for (const k of all) {
              if (k.startsWith('ui:credential:')) {
                const v = await store.get(k);
                if (v) items.push({ id: k, name: v.name, createdAt: v.createdAt });
              }
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ count: items.length, items }));
          return;
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); return; }
      }

      if (url.startsWith('/api/ui/credentials') && method === 'DELETE') {
        try {
          const u = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
          const id = u.searchParams.get('id');
          if (!id) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing id' })); return; }
          const store = this.stateStore;
          if (typeof (store as any).delete === 'function') {
            await (store as any).delete(id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ deleted: id }));
            return;
          }
          res.writeHead(500); res.end(JSON.stringify({ error: 'store does not support delete' })); return;
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); return; }
      }

    if (url === '/agents/register' && method === 'POST') {
      try {
        const body = await readRequestBody();
        const j = JSON.parse(body || '{}');
        try {
          const v = safeValidate(AgentRegisterSchema, j);
          if (!v || !v.success) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid payload' }));
            return;
          }
        } catch (_) { /* ignore */ }
        if (!j.id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing id' }));
          return;
        }
        // For simplicity, register a dumb in-memory agent placeholder with id
        const placeholder = { id: j.id } as any;
        defaultRegistry.registerInstance(j.id, placeholder);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ registered: j.id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
      return;
    }

    if (url === '/agents/unregister' && method === 'POST') {
      try {
        const body = await readRequestBody();
        const j = JSON.parse(body || '{}');
        try {
          const v = safeValidate(AgentRegisterSchema, j);
          if (!v || !v.success) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid payload' }));
            return;
          }
        } catch (_) { /* ignore */ }
        if (!j.id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing id' }));
          return;
        }
        defaultRegistry.unregisterInstance(j.id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ unregistered: j.id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
      return;
    }

    // Dapr pubsub push route for ai-trace chunks (sidecar will POST to this endpoint when subscribed)
    if (url === '/pubsub/ai-trace-chunks' && method === 'POST') {
      try {
        const body = await readRequestBody();
        const j = JSON.parse(body || '{}');
        const instanceId = j.instanceId || j.data?.instanceId;
        const toolCallId = j.toolCallId || j.data?.toolCallId;
        const seq = j.seq || j.data?.seq;
        const chunk = j.chunk || j.data?.chunk || j.data?.chunk?.content || j.data?.chunk;
        if (!instanceId || !toolCallId || chunk === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing fields' }));
          return;
        }
        // authorize and require tenant for incoming pubsub writes
        try {
          const { decision, principal } = await authorizeRequestAsync(req, { action: 'publish', resource: { type: 'aiTraceChunk' } });
          if ((!principal) && decision && decision.allow === false) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          if (!principal) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
          if (!decision || !decision.allow) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          const tenantId = principal?.tenantId;
          if (!tenantId) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
          try { metrics.increment('pubsub_events_received'); } catch (_) { /* noop */ }
            // validate chunk payload using HTTP schema
            try {
              const candidate = { instanceId: instanceId, toolCallId: toolCallId, seq: seq, chunk };
              const chk = safeValidate(ToolCallChunkPayloadSchema, candidate);
              if (!chk || !chk.success) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'invalid chunk payload' }));
                return;
              }
            } catch (_) { /* continue */ }
          // persist the chunk using ToolStore and record ai-trace
          try {
            const store = new ToolStore(this.stateStore, tenantId);
            const contentStr = typeof chunk === 'string' ? chunk : JSON.stringify(chunk);
            await store.appendChunk(instanceId, toolCallId, { content: contentStr, contentType: 'stream' });
          } catch (e) { /* noop */ }
          try {
            const ats = new AiTraceStore(this.stateStore, tenantId);
            const contentStr = typeof chunk === 'string' ? chunk : JSON.stringify(chunk);
            await ats.appendTrace(instanceId, { type: 'tool-call-chunk', toolCallId, seq, chunk: contentStr });
          } catch (_) { /* noop */ }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        } catch (ae: any) { res.writeHead(ae.status || 401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: ae.message || 'unauthorized' })); return; }

      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }

  async start() {
    if (this.config.registerDefaults) {
      // Register common agent types
      const CodeExecutionAgentModule = await import('../agents/CodeExecutionAgent.js') as any;
      const HttpAgentModule = await import('../agents/HttpAgent.js') as any;
      const ChoiceAgentModule = await import('../agents/ChoiceAgent.js') as any;
      const LLMAgentModule = await import('../agents/LLMAgent.js') as any;
      const EchoAgentModule = await import('../agents/EchoAgent.js') as any;
      
      const CodeExecutionAgent = CodeExecutionAgentModule.default || CodeExecutionAgentModule.CodeExecutionAgent;
      const HttpAgent = HttpAgentModule.default || HttpAgentModule.HttpAgent;
      const ChoiceAgent = ChoiceAgentModule.default || ChoiceAgentModule.ChoiceAgent;
      const LLMAgent = LLMAgentModule.default || LLMAgentModule.LLMAgent;
      const EchoAgent = EchoAgentModule.default || EchoAgentModule.EchoAgent;
      
      if (CodeExecutionAgent) defaultRegistry.registerType('code', CodeExecutionAgent as any);
      if (HttpAgent) defaultRegistry.registerType('http', HttpAgent as any);
      if (ChoiceAgent) defaultRegistry.registerType('choice', ChoiceAgent as any);
      if (LLMAgent) defaultRegistry.registerType('llm', LLMAgent as any);
      if (EchoAgent) defaultRegistry.registerType('echo', EchoAgent as any);
      
      console.log('[MainService] Registered default agent types:', defaultRegistry.listTypes());
    }
    // Optionally start local executor and durable worker
    if (this.config.startWorkers) {
  const state = this.stateStore;
      // register or reuse orchestrator
      this.orchestratorInstance = this.config.orchestrator || new AIAgentOrchestrator('ai_agent_orchestrator', undefined, { stateStore: state });
      try { defaultRegistry.registerInstance('ai_agent_orchestrator', this.orchestratorInstance as any); } catch (_) { /* noop */ }

      // register local executor
      this.execInstance = new LocalToolExecutor(state as any);
      try { defaultRegistry.registerInstance('tool-executor', this.execInstance as any); } catch (_) { /* noop */ }

      // start one worker per configured tenant
      const tenants = listConfiguredTenants();
      if (tenants.length === 0) {
        // fallback: start a global worker (no tenant)
        this.worker = new DurableToolWorker(state as any, this.orchestratorInstance as any, 200);
        await this.worker.start();
      } else {
        for (const t of tenants) {
          const w = new DurableToolWorker(state as any, this.orchestratorInstance as any, 200, t);
          await w.start();
          this.tenantWorkers.set(t, w);
        }
      }
    }
    return new Promise<void>((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      // create WebSocket server attached to http server
      const wss = new WebSocketServer({ noServer: true });

      this.server.on('upgrade', (request, socket, head) => {
        // simple routing: expect path /ws/ui/runs/:runId
        const url = request.url || '';
        console.log(`[MainService] WebSocket upgrade request: ${url}`);
        if (!url.startsWith('/ws/ui/runs/')) {
          console.log(`[MainService] Rejecting WebSocket connection - invalid path: ${url}`);
          socket.destroy();
          return;
        }
        console.log(`[MainService] Accepting WebSocket connection: ${url}`);
        wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          wss.emit('connection', ws, request);
        });
      });

  wss.on('connection', (ws: any, request: any) => {
        console.log(`[MainService] WebSocket connected: ${request.url}`);
        try {
          const u = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
          const parts = u.pathname.split('/').filter(Boolean);
          const runId = parts[3];
          console.log(`[MainService] Extracted runId: ${runId}`);
          if (!runId) { 
            console.log(`[MainService] No runId found in path, closing connection`);
            ws.close(); 
            return; 
          }
          const send = (data: string) => { try { ws.send(data); } catch (_) { /* ignore */ } };
          const ok = subscribe(runId, send);
          console.log(`[MainService] Subscribe result for ${runId}: ${ok}`);
          if (!ok) { 
            ws.send(JSON.stringify({ type: 'error', error: 'run not found' })); 
            ws.close(); 
            return; 
          }
          ws.on('close', () => { 
            console.log(`[MainService] WebSocket closed for ${runId}`);
            unsubscribe(runId, send); 
          });
          ws.on('message', (msg: any) => {
            // allow client commands: cancel, pause, resume (not implemented)
            try {
              const j = JSON.parse(String(msg));
              if (j && j.cmd === 'cancel') {
                // not implemented: placeholder
                ws.send(JSON.stringify({ type: 'ack', cmd: 'cancel' }));
              }
            } catch (_) { }
          });
        } catch (e) { 
          console.error(`[MainService] Error in WebSocket connection handler:`, e);
          ws.close(); 
        }
      });

      this.server.listen(this.port, () => {
        console.log(`MainService listening on port ${this.port}`);
        // warm-up JWKS to reduce first-request latency
        try { warmupJwks().catch(() => {/* noop */}); } catch (_) { /* noop */ }
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  async stop() {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
    try {
      if (this.worker) await this.worker.stop();
    } catch (_) { /* noop */ }
    try {
      if (this.execInstance) defaultRegistry.unregisterInstance('tool-executor');
    } catch (_) { /* noop */ }
    try {
      if (this.orchestratorInstance) defaultRegistry.unregisterInstance('ai_agent_orchestrator');
    } catch (_) { /* noop */ }
  }
}

export default MainService;
