// @ts-nocheck - Legacy file, references deleted AgentRegistry and ComponentRegistry
import { defaultRegistry } from '../AgentRegistry.js';
import AzureOpenAIClient from '../llm/azureOpenAIClient.js';
import { AIAgentOrchestrator } from '../agents/AIAgentOrchestrator.js';
import { UIComposerAgent } from '../agents/UIComposerAgent.js';
import { LocalToolExecutor } from '../agents/localToolExecutor.js';
import MainService from '../service/mainService.js';
import DaprStateStore from '../storage/daprStateStore.js';
import DaprManager from './daprManager.js';
import * as auth from '../security/auth.js';
import { ComponentRegistry } from '../registry/index.js';
import { setComponentRegistry } from '../api/componentsApi.js';

let _mainService: MainService | null = null;
let _daprClient: any = null;

export async function startService(options: { azure?: { endpoint: string; apiKey: string; deployment?: string; apiVersion?: string }; registerLocalToolExecutor?: boolean; server?: { port?: number; registerDefaults?: boolean } } = {}) {
  // If Dapr is available in the environment, create a Dapr client and register it.
  // Try to create a Dapr client using the DaprManager (reads env and allows runtime switching)
  try {
    _daprClient = await DaprManager.createFromEnv();
    
    // If no env vars, try default Dapr ports
    if (!_daprClient) {
      console.log('No DAPR_HTTP_PORT env var found, trying default port 3500...');
      _daprClient = await DaprManager.switchToPorts(3500);
    }
    
    if (_daprClient) {
      try { defaultRegistry.registerInstance('dapr.client', _daprClient as any); } catch (_) { /* ignore */ }
      try { defaultRegistry.registerInstance('state.store', new DaprStateStore(_daprClient) as any); } catch (_) { /* ignore */ }
      console.log('Dapr client created and registered via DaprManager');
      
      // Initialize Component Registry with Dapr State Store
      try {
        const componentRegistry = new ComponentRegistry(_daprClient);
        setComponentRegistry(componentRegistry);
        console.log('[ComponentRegistry] Initialized with Dapr State Store');
      } catch (e) {
        console.warn('[ComponentRegistry] Failed to initialize, dynamic components unavailable', e);
      }
    }
  } catch (e) {
    console.warn('DaprManager failed to create client, continuing without dapr', e);
    _daprClient = null;
  }

  // best-effort: load API_KEYS from secret store into runtime auth map
  try {
    if (auth && typeof (auth as any).loadApiKeysFromDaprSecretStore === 'function') {
      try { await (auth as any).loadApiKeysFromDaprSecretStore(); } catch (_) { /* noop */ }
    }
  } catch (_) { /* noop */ }

  // Create ComponentRegistry instance if Dapr client is available
  let componentRegistry: ComponentRegistry | undefined;
  if (_daprClient) {
    componentRegistry = new ComponentRegistry(_daprClient);
    setComponentRegistry(componentRegistry);
    console.log('[ComponentRegistry] Initialized with Dapr client');
  } else {
    console.log('[ComponentRegistry] No Dapr client available, using fallback mode');
  }

  // Register known actors/types and wire explicit clients
  if (options.azure && options.azure.endpoint && options.azure.apiKey) {
    const client = new AzureOpenAIClient({ endpoint: options.azure.endpoint, apiKey: options.azure.apiKey, deploymentName: options.azure.deployment, apiVersion: options.azure.apiVersion });
    
    // Create an orchestrator instance that uses the explicit llm client and (optionally) dapr client
    const orch = new AIAgentOrchestrator('ai_agent_orchestrator', client, { name: 'ai_agent_orchestrator', llmClient: client, daprClient: _daprClient });
    try { defaultRegistry.registerInstance('ai_agent_orchestrator', orch as any); } catch (e) { /* already registered */ }
    
    // Register UI Composer Agent with LLM client and ComponentRegistry
    const uiComposer = new UIComposerAgent('ui_composer', client, componentRegistry, { llmClient: client, daprClient: _daprClient });
    await uiComposer.initialize();
    try { defaultRegistry.registerInstance('ui_composer', uiComposer as any); } catch (e) { /* already registered */ }
    console.log('[UIComposerAgent] Registered with Azure OpenAI client and ComponentRegistry');
  } else {
    // Register a default orchestrator with no LLM client but possibly with dapr wiring
    try { defaultRegistry.registerInstance('ai_agent_orchestrator', new AIAgentOrchestrator('ai_agent_orchestrator', undefined, { daprClient: _daprClient }) as any); } catch (e) { /* already registered */ }
    
    // Register UI Composer Agent without LLM client but with ComponentRegistry
    const uiComposer = new UIComposerAgent('ui_composer', undefined as any, componentRegistry, { daprClient: _daprClient });
    await uiComposer.initialize();
    try { defaultRegistry.registerInstance('ui_composer', uiComposer as any); } catch (e) { /* already registered */ }
    console.log('[UIComposerAgent] Registered with ComponentRegistry (no LLM client)');
  }

  if (options.registerLocalToolExecutor) {
    try { defaultRegistry.registerInstance('tool-executor', new LocalToolExecutor() as any); } catch (e) { /* already registered */ }
  }

  if (options.server) {
    _mainService = new MainService({ port: options.server.port, registerDefaults: options.server.registerDefaults });
    await _mainService.start();
  }

  return { started: true };
}

export async function stopService() {
  // Unregister known instances
  try { defaultRegistry.unregisterInstance('ai_agent_orchestrator'); } catch (_) { /* noop */ }
  try { defaultRegistry.unregisterInstance('ui_composer'); } catch (_) { /* noop */ }
  try { defaultRegistry.unregisterInstance('tool-executor'); } catch (_) { /* noop */ }
  if (_mainService) {
    await _mainService.stop();
    _mainService = null;
  }
  return { stopped: true };
}
