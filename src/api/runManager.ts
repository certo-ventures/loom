// @ts-nocheck - Legacy file, references deleted WorkflowDefinition and AgentRegistry
import { WorkflowDefinition } from '../Workflow.js';
import { WorkflowRunner } from '../workflow/runner.js';
import { defaultRegistry } from '../AgentRegistry.js';
import { InMemoryStateStore } from '../workflow/state.js';
import { WDL } from '../workflow/wdl.js';

type RunStatus = 'pending' | 'running' | 'finished' | 'failed' | 'cancelled';

interface RunEntry {
  id: string;
  definition: WorkflowDefinition;
  inputs: any;
  status: RunStatus;
  result?: any;
  error?: string;
  clients: Array<(data: string) => void>;
  eventHistory: string[]; // Cache events for replay when clients connect
}

let runs: Record<string, RunEntry> = {};
let stateStore: any = undefined;

/**
 * Convert Azure Logic Apps WDL-style definition to Loom WDL format
 */
function convertWorkflowDefinitionToWDL(def: WorkflowDefinition, inputs: any): WDL {
  const steps: any[] = [];
  
  // Add a step for each action in the WDL definition
  if (def.actions) {
    for (const [actionName, action] of Object.entries(def.actions)) {
      const actionAny = action as any;
      
      if (actionAny.type === 'llm') {
        // LLM/AI step
        steps.push({
          id: actionName,
          type: 'ai',
          inputs: actionAny.inputs || {},
          depends: actionAny.runAfter ? Object.keys(actionAny.runAfter) : []
        });
      } else if (actionAny.type === 'agent' || actionAny.agentType) {
        // Agent step
        const agentType = actionAny.agentType || actionAny.type;
        steps.push({
          id: actionName,
          type: 'agent',
          run: `${agentType}.handle`,
          inputs: actionAny.inputs || {},
          depends: actionAny.runAfter ? Object.keys(actionAny.runAfter) : []
        });
      } else {
        // Generic action - treat as agent
        steps.push({
          id: actionName,
          type: 'agent',
          run: `${actionAny.type || 'echo'}.handle`,
          inputs: actionAny.inputs || {},
          depends: actionAny.runAfter ? Object.keys(actionAny.runAfter) : []
        });
      }
    }
  }
  
  return {
    name: (def as any).contentVersion || 'workflow',
    inputs: inputs || {},
    steps: steps,
    outputs: (def.outputs as any) || {}
  };
}

export function initRunManager(store?: any) {
  stateStore = store;
  // attempt to load persisted runs
  if (stateStore && typeof stateStore.keys === 'function') {
    (async () => {
      try {
        const keys: string[] = await stateStore.keys();
        for (const k of keys) {
          if (!k.startsWith('ui:run:')) continue;
          try {
            const val = await stateStore.get(k);
            if (val && val.id) runs[val.id] = { ...(val as any), clients: [], eventHistory: [] } as RunEntry;
          } catch (_) { /* ignore single load errors */ }
        }
      } catch (_) { /* ignore */ }
    })();
  }
}

async function persistRun(entry: RunEntry) {
  if (!stateStore) return;
  try { await stateStore.set(`ui:run:${entry.id}`, { id: entry.id, definition: entry.definition, inputs: entry.inputs, status: entry.status, result: entry.result, error: entry.error, updatedAt: Date.now() }); } catch (_) { /* noop */ }
}

export function startRun(def: WorkflowDefinition, inputs: any) {
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const entry: RunEntry = { id: runId, definition: def, inputs, status: 'pending', clients: [], eventHistory: [] };
  runs[runId] = entry;
  persistRun(entry);

  // Run asynchronously with a small delay to allow WebSocket to connect first
  (async () => {
    // Wait 100ms for WebSocket client to connect
    await new Promise(resolve => setTimeout(resolve, 100));
    
    entry.status = 'running';
    await persistRun(entry);
    console.log(`[RunManager] Broadcasting run_started for ${runId}, ${entry.clients.length} clients`);
    broadcast(runId, JSON.stringify({ type: 'run_started', runId, timestamp: new Date().toISOString() }));
    try {
      // Convert WDL-style definition to WDL format expected by workflow runner
      const wdl: WDL = convertWorkflowDefinitionToWDL(def, inputs);
      
      // Get LLM client from registry (registered by service.ts)
      const orchestrator = defaultRegistry.getInstance('ai_agent_orchestrator') as any;
      const llmClient = orchestrator?.llmClient || orchestrator?.config?.llmClient;
      
      if (!llmClient && wdl.steps.some((s: any) => s.type === 'ai')) {
        throw new Error('No LLM client available for AI steps. Configure Azure OpenAI in .env file.');
      }
      
      // Use WorkflowRunner to execute WDL workflow
      const runner = new WorkflowRunner(wdl, {
        registry: defaultRegistry,
        llmClient: llmClient,
        stateStore: stateStore
      });
      
      // Execute workflow
      const result = await runner.run();
      
      entry.status = 'finished';
      entry.result = result;
      await persistRun(entry);
      console.log(`[RunManager] Broadcasting run_complete for ${runId}, ${entry.clients.length} clients`);
      broadcast(runId, JSON.stringify({ type: 'run_complete', runId, output: result, timestamp: new Date().toISOString() }));
    } catch (e: any) {
      entry.status = 'failed';
      entry.error = String(e);
      await persistRun(entry);
      console.log(`[RunManager] Broadcasting run_failed for ${runId}, ${entry.clients.length} clients`);
      broadcast(runId, JSON.stringify({ type: 'run_failed', runId, error: entry.error, timestamp: new Date().toISOString() }));
    }
  })();

  return runId;
}

export function getRun(runId: string) {
  return runs[runId];
}

export function subscribe(runId: string, onData: (data: string) => void) {
  const entry = runs[runId];
  if (!entry) return false;
  entry.clients.push(onData);
  
  // Replay all cached events to the new subscriber
  console.log(`[RunManager] Replaying ${entry.eventHistory.length} cached events to new subscriber for ${runId}`);
  for (const event of entry.eventHistory) {
    try { onData(event); } catch (_) { /* ignore */ }
  }
  
  return true;
}

export function unsubscribe(runId: string, onData: (data: string) => void) {
  const entry = runs[runId];
  if (!entry) return false;
  entry.clients = entry.clients.filter(c => c !== onData);
  return true;
}

function broadcast(runId: string, data: string) {
  const entry = runs[runId];
  if (!entry) {
    console.log(`[RunManager] Cannot broadcast - run not found: ${runId}`);
    return;
  }
  
  // Cache event for replay when new clients connect
  entry.eventHistory.push(data);
  
  console.log(`[RunManager] Broadcasting to ${entry.clients.length} clients for ${runId}: ${data.substring(0, 100)}...`);
  for (const c of entry.clients) {
    try { c(data); } catch (_) { /* ignore */ }
  }
}

