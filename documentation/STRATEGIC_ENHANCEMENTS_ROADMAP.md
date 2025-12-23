# Loom Strategic Enhancements Roadmap

**Date**: December 18, 2025  
**Philosophy**: Minimal Code, Maximum Functionality  
**Goal**: Add 5 transformative features while staying under 2,000 total additional lines

---

## Executive Summary

This roadmap adds five **high-impact**, **minimal-code** features to Loom:

1. **Unified LLM API** (~300 lines) - Provider-agnostic AI integration
2. **SupervisorActor Pattern** (~200 lines) - Hierarchical agent coordination
3. **Event-Driven Triggers** (~800 lines) - External event integration via Azure Web PubSub
4. **Enhanced Distributed Locks** (~150 lines) - Prevent race conditions & loops
5. **TLS Notary Integration** (~400 lines) - Cryptographic provenance for external data

**Total New Code**: ~1,850 lines  
**Implementation Time**: 3-4 weeks  
**Architecture**: All features leverage existing Loom infrastructure

---

## Feature 1: Unified LLM API

### **Problem**
Every AI agent manually integrates with LLM providers (OpenAI, Anthropic, Azure OpenAI). No consistency, lots of boilerplate.

### **Solution: Minimal LLM Abstraction** (~300 lines)

```typescript
// src/ai/llm-provider.ts (~150 lines)

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'azure-openai' | 'gemini';
  apiKey: string;
  model: string;
  endpoint?: string; // For Azure
  temperature?: number;
  maxTokens?: number;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

export interface LLMProvider {
  chat(messages: LLMMessage[], options?: Partial<LLMConfig>): Promise<LLMResponse>;
  stream(messages: LLMMessage[], onChunk: (chunk: string) => void): Promise<LLMResponse>;
}

// Unified API
export class UnifiedLLM {
  private provider: LLMProvider;
  
  constructor(config: LLMConfig) {
    switch (config.provider) {
      case 'openai':
        this.provider = new OpenAIProvider(config);
        break;
      case 'anthropic':
        this.provider = new AnthropicProvider(config);
        break;
      case 'azure-openai':
        this.provider = new AzureOpenAIProvider(config);
        break;
      case 'gemini':
        this.provider = new GeminiProvider(config);
        break;
    }
  }
  
  async chat(messages: LLMMessage[], options?: Partial<LLMConfig>): Promise<LLMResponse> {
    return this.provider.chat(messages, options);
  }
  
  async stream(messages: LLMMessage[], onChunk: (chunk: string) => void): Promise<LLMResponse> {
    return this.provider.stream(messages, onChunk);
  }
}
```

```typescript
// src/ai/providers/openai.ts (~50 lines per provider)

import OpenAI from 'openai';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private config: LLMConfig;
  
  constructor(config: LLMConfig) {
    this.config = config;
    this.client = new OpenAI({ apiKey: config.apiKey });
  }
  
  async chat(messages: LLMMessage[], options?: Partial<LLMConfig>): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: options?.model || this.config.model,
      messages,
      temperature: options?.temperature || this.config.temperature,
      max_tokens: options?.maxTokens || this.config.maxTokens,
    });
    
    return {
      content: response.choices[0].message.content || '',
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      model: response.model,
    };
  }
  
  async stream(messages: LLMMessage[], onChunk: (chunk: string) => void): Promise<LLMResponse> {
    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages,
      stream: true,
    });
    
    let content = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      content += delta;
      onChunk(delta);
    }
    
    return { content, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: this.config.model };
  }
}
```

```typescript
// src/ai/ai-actor.ts (~100 lines)

export abstract class AIActor extends Actor {
  protected llm?: UnifiedLLM;
  
  protected initializeLLM(config: LLMConfig) {
    this.llm = new UnifiedLLM(config);
  }
  
  protected async chat(messages: LLMMessage[], options?: Partial<LLMConfig>): Promise<string> {
    if (!this.llm) {
      throw new Error('LLM not initialized. Call initializeLLM() first.');
    }
    
    const response = await this.llm.chat(messages, options);
    
    // Journal the LLM call
    await this.appendEvent({
      eventType: 'llm_call_completed',
      data: {
        messages,
        response: response.content,
        usage: response.usage,
        model: response.model,
      },
      timestamp: new Date().toISOString(),
      sequence: this.state._eventSequence + 1,
      correlationId: this.correlationId,
    });
    
    return response.content;
  }
  
  protected async streamChat(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void
  ): Promise<string> {
    if (!this.llm) {
      throw new Error('LLM not initialized. Call initializeLLM() first.');
    }
    
    const response = await this.llm.stream(messages, onChunk);
    
    // Journal the streamed response
    await this.appendEvent({
      eventType: 'llm_stream_completed',
      data: {
        messages,
        response: response.content,
        usage: response.usage,
        model: response.model,
      },
      timestamp: new Date().toISOString(),
      sequence: this.state._eventSequence + 1,
      correlationId: this.correlationId,
    });
    
    return response.content;
  }
}
```

**Usage Example:**
```typescript
class CustomerSupportAgent extends AIActor {
  constructor(context: ActorContext) {
    super(context);
    this.initializeLLM({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o-mini',
      temperature: 0.7,
    });
  }
  
  async handleMessage(userMessage: string): Promise<string> {
    const response = await this.chat([
      { role: 'system', content: 'You are a helpful customer support agent.' },
      { role: 'user', content: userMessage },
    ]);
    
    return response;
  }
}
```

**Benefits:**
- ✅ **90% less boilerplate** - No manual API integration per agent
- ✅ **Provider-agnostic** - Switch between OpenAI/Anthropic/Azure with config change
- ✅ **Journaled** - All LLM calls automatically persisted for replay
- ✅ **Type-safe** - Full TypeScript support
- ✅ **Streaming support** - Built-in for real-time UX

**Effort:** 2-3 days

---

## Feature 2: SupervisorActor Pattern

### **Problem**
Complex multi-agent systems need hierarchical coordination, but current approach requires manual routing logic.

### **Solution: Built-in Supervisor Pattern** (~200 lines)

```typescript
// src/actor/supervisor-actor.ts (~200 lines)

export interface TeamMember {
  name: string;
  actorId: string;
  description: string;
  capabilities: string[];
}

export interface SupervisorConfig {
  name: string;
  description: string;
  team: TeamMember[];
  llmConfig?: LLMConfig; // Optional AI-powered routing
}

export abstract class SupervisorActor extends AIActor {
  protected team: Map<string, TeamMember>;
  protected config: SupervisorConfig;
  
  constructor(context: ActorContext, config: SupervisorConfig) {
    super(context);
    this.config = config;
    this.team = new Map(config.team.map(m => [m.name, m]));
    
    if (config.llmConfig) {
      this.initializeLLM(config.llmConfig);
    }
  }
  
  /**
   * Override this to implement custom routing logic
   */
  protected abstract routeTask(task: any): Promise<string>; // Returns team member name
  
  /**
   * Route with AI if LLM is configured
   */
  protected async routeWithAI(task: any): Promise<string> {
    if (!this.llm) {
      throw new Error('LLM not configured for AI routing');
    }
    
    const teamDescription = Array.from(this.team.values())
      .map(m => `- ${m.name}: ${m.description} (capabilities: ${m.capabilities.join(', ')})`)
      .join('\n');
    
    const prompt = `You are a supervisor managing a team. Route this task to the best team member.
    
Team:
${teamDescription}

Task: ${JSON.stringify(task)}

Respond with ONLY the team member name.`;
    
    const response = await this.chat([
      { role: 'system', content: 'You are a task routing supervisor.' },
      { role: 'user', content: prompt },
    ]);
    
    const memberName = response.trim();
    
    if (!this.team.has(memberName)) {
      throw new Error(`Invalid routing: ${memberName} not in team`);
    }
    
    return memberName;
  }
  
  /**
   * Delegate task to team member
   */
  protected async delegateTask(memberName: string, task: any): Promise<any> {
    const member = this.team.get(memberName);
    if (!member) {
      throw new Error(`Team member ${memberName} not found`);
    }
    
    // Journal the delegation
    await this.appendEvent({
      eventType: 'task_delegated',
      data: {
        memberName,
        actorId: member.actorId,
        task,
      },
      timestamp: new Date().toISOString(),
      sequence: this.state._eventSequence + 1,
      correlationId: this.correlationId,
    });
    
    // Send message to team member actor
    await this.messageQueue.enqueue(member.actorId, {
      messageId: crypto.randomUUID(),
      actorId: member.actorId,
      messageType: 'event',
      correlationId: this.correlationId,
      payload: {
        eventType: 'task_received',
        data: task,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        sender: this.actorId,
        priority: 0,
      },
    });
    
    // Wait for response (using existing event suspension mechanism)
    return this.waitForEvent(`task_completed_${member.actorId}`);
  }
  
  /**
   * Main execution: route and delegate
   */
  async execute(task: any): Promise<any> {
    // Determine which team member should handle this
    const memberName = await this.routeTask(task);
    
    // Delegate to that team member
    const result = await this.delegateTask(memberName, task);
    
    // Journal the completion
    await this.appendEvent({
      eventType: 'supervisor_task_completed',
      data: {
        memberName,
        task,
        result,
      },
      timestamp: new Date().toISOString(),
      sequence: this.state._eventSequence + 1,
      correlationId: this.correlationId,
    });
    
    return result;
  }
}
```

**Usage Example:**
```typescript
class CustomerSupportSupervisor extends SupervisorActor {
  constructor(context: ActorContext) {
    super(context, {
      name: 'customer-support-supervisor',
      description: 'Routes customer support queries to specialized agents',
      team: [
        {
          name: 'tech-support',
          actorId: 'tech-support-agent',
          description: 'Handles technical issues and troubleshooting',
          capabilities: ['debugging', 'system-issues', 'integration-help'],
        },
        {
          name: 'billing',
          actorId: 'billing-agent',
          description: 'Handles billing questions and account issues',
          capabilities: ['invoices', 'payments', 'subscriptions'],
        },
        {
          name: 'sales',
          actorId: 'sales-agent',
          description: 'Handles product questions and upsells',
          capabilities: ['pricing', 'features', 'demos'],
        },
      ],
      llmConfig: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'gpt-4o-mini',
      },
    });
  }
  
  // Use AI-powered routing
  protected async routeTask(task: any): Promise<string> {
    return this.routeWithAI(task);
  }
}

// Usage
const supervisor = new CustomerSupportSupervisor(context);
const result = await supervisor.execute({
  type: 'customer_query',
  query: 'Why was I charged twice this month?',
});
// Automatically routes to 'billing' agent
```

**Benefits:**
- ✅ **Hierarchical coordination** - Built-in pattern for multi-agent systems
- ✅ **AI-powered routing** - Optional LLM-based task delegation
- ✅ **Journaled** - All routing decisions persisted
- ✅ **Extensible** - Override `routeTask` for custom logic
- ✅ **Type-safe** - Full TypeScript support

**Effort:** 1-2 days

---

## Feature 3: Event-Driven Triggers (Azure Web PubSub)

### **Problem**
Actors can only communicate with each other. No way to receive events from external systems (Slack, GitHub, HTTP webhooks).

### **Solution: Azure Web PubSub for Real-time Events** (~800 lines)

**Why Azure Web PubSub > Polling:**
- ✅ **Real-time** - Sub-second latency (vs 10-60s polling intervals)
- ✅ **Scalable** - Handles millions of connections
- ✅ **Cost-effective** - ~$0.05/unit/day (vs continuous polling compute)
- ✅ **Built-in reliability** - Automatic reconnection, message buffering
- ✅ **WebSocket + REST** - Supports both push and pull patterns
- ✅ **Azure-native** - Integrates with existing Azure infrastructure

**Architecture:**

```
External Systems                 Azure Web PubSub              Loom Actors
┌──────────────┐                ┌────────────────┐           ┌─────────────┐
│ Slack API    │───webhook────▶│                │           │             │
│ GitHub API   │                │  Hub: "loom"   │◀──────────│ Trigger     │
│ HTTP Client  │                │                │           │ Registry    │
│ Cron Service │                │  Group: "all"  │           │             │
└──────────────┘                └────────────────┘           └─────────────┘
                                        │                            │
                                        │ WebSocket                  │
                                        │ connection                 │
                                        ▼                            ▼
                                ┌────────────────┐           ┌─────────────┐
                                │ Event Handler  │──────────▶│ Actor       │
                                │ (Loom Server)  │           │ Execution   │
                                └────────────────┘           └─────────────┘
```

**Implementation:**

```typescript
// src/triggers/types.ts (~100 lines)

export interface TriggerEvent {
  provider: string; // 'slack', 'github', 'http', 'cron'
  eventType: string; // 'message_posted', 'pull_request_opened', etc.
  payload: any;
  metadata: {
    deliveryId: string;
    timestamp: string;
    source?: string;
  };
}

export interface TriggerHandler {
  (event: TriggerEvent, context: TriggerContext): Promise<void>;
}

export interface TriggerContext {
  actorRuntime: ActorRuntime;
  logger: Logger;
}

export interface TriggerConfig {
  [eventKey: string]: TriggerHandler;
}
```

```typescript
// src/triggers/web-pubsub-adapter.ts (~300 lines)

import { WebPubSubServiceClient } from '@azure/web-pubsub';
import { WebSocket } from 'ws';

export class WebPubSubTriggerAdapter {
  private client: WebPubSubServiceClient;
  private ws?: WebSocket;
  private handlers = new Map<string, TriggerHandler[]>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  
  constructor(
    private connectionString: string,
    private hubName: string = 'loom-triggers'
  ) {
    this.client = new WebPubSubServiceClient(connectionString, hubName);
  }
  
  /**
   * Register a trigger handler
   */
  register(eventKey: string, handler: TriggerHandler): void {
    if (!this.handlers.has(eventKey)) {
      this.handlers.set(eventKey, []);
    }
    this.handlers.get(eventKey)!.push(handler);
  }
  
  /**
   * Start listening for events
   */
  async start(context: TriggerContext): Promise<void> {
    // Get WebSocket URL from Azure Web PubSub
    const token = await this.client.getClientAccessToken({
      userId: `loom-${process.pid}`,
      roles: ['webpubsub.receiveMessage', 'webpubsub.joinLeaveGroup'],
    });
    
    this.ws = new WebSocket(token.url);
    
    this.ws.on('open', () => {
      console.log('✅ Connected to Azure Web PubSub');
      this.reconnectAttempts = 0;
      
      // Join group for all events
      this.ws?.send(JSON.stringify({
        type: 'joinGroup',
        group: 'all',
      }));
    });
    
    this.ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'message' && message.dataType === 'json') {
          const event: TriggerEvent = message.data;
          await this.handleEvent(event, context);
        }
      } catch (error) {
        console.error('Error processing Web PubSub message:', error);
      }
    });
    
    this.ws.on('close', () => {
      console.warn('❌ Web PubSub connection closed');
      this.attemptReconnect(context);
    });
    
    this.ws.on('error', (error) => {
      console.error('Web PubSub error:', error);
    });
  }
  
  /**
   * Handle incoming event
   */
  private async handleEvent(event: TriggerEvent, context: TriggerContext): Promise<void> {
    const eventKey = `${event.provider}.${event.eventType}`;
    const handlers = this.handlers.get(eventKey);
    
    if (!handlers || handlers.length === 0) {
      console.warn(`No handlers registered for ${eventKey}`);
      return;
    }
    
    // Execute all handlers in parallel
    await Promise.all(
      handlers.map(handler => handler(event, context).catch(error => {
        console.error(`Handler error for ${eventKey}:`, error);
      }))
    );
  }
  
  /**
   * Attempt to reconnect after connection loss
   */
  private async attemptReconnect(context: TriggerContext): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached. Giving up.');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.start(context).catch(error => {
        console.error('Reconnect failed:', error);
      });
    }, delay);
  }
  
  /**
   * Publish event to Web PubSub (for testing/simulation)
   */
  async publish(event: TriggerEvent): Promise<void> {
    await this.client.sendToAll({
      dataType: 'json',
      data: event,
    });
  }
  
  /**
   * Stop listening
   */
  async stop(): Promise<void> {
    this.ws?.close();
  }
}
```

```typescript
// src/triggers/dsl.ts (~200 lines)

export function createTriggers(builder: (on: TriggerDsl) => void): TriggerConfig {
  const registry: TriggerConfig = {};
  
  const dsl = new Proxy({}, {
    get(_, provider: string) {
      return new Proxy({}, {
        get(_, eventType: string) {
          return (handler: TriggerHandler) => {
            const eventKey = `${provider}.${eventType}`;
            registry[eventKey] = handler;
          };
        }
      });
    }
  }) as TriggerDsl;
  
  builder(dsl);
  return registry;
}

export interface TriggerDsl {
  slack: {
    messagePosted: (handler: TriggerHandler) => void;
    appMention: (handler: TriggerHandler) => void;
  };
  github: {
    star: (handler: TriggerHandler) => void;
    pullRequest: (handler: TriggerHandler) => void;
    issueOpened: (handler: TriggerHandler) => void;
  };
  http: {
    webhook: (handler: TriggerHandler) => void;
  };
  cron: {
    schedule: (handler: TriggerHandler) => void;
  };
}
```

```typescript
// src/triggers/webhook-server.ts (~200 lines)

import { WebPubSubServiceClient } from '@azure/web-pubsub';
import express from 'express';

/**
 * HTTP server that receives webhooks and publishes to Web PubSub
 */
export class WebhookServer {
  private app = express();
  private client: WebPubSubServiceClient;
  
  constructor(
    private connectionString: string,
    private hubName: string = 'loom-triggers'
  ) {
    this.client = new WebPubSubServiceClient(connectionString, hubName);
    this.setupRoutes();
  }
  
  private setupRoutes(): void {
    this.app.use(express.json());
    
    // Slack webhook
    this.app.post('/webhooks/slack', async (req, res) => {
      // Verify Slack signature (simplified)
      const event: TriggerEvent = {
        provider: 'slack',
        eventType: req.body.event?.type || 'message',
        payload: req.body.event,
        metadata: {
          deliveryId: req.headers['x-slack-request-timestamp'] as string,
          timestamp: new Date().toISOString(),
          source: 'slack',
        },
      };
      
      await this.client.sendToAll({
        dataType: 'json',
        data: event,
      });
      
      res.json({ ok: true });
    });
    
    // GitHub webhook
    this.app.post('/webhooks/github', async (req, res) => {
      const event: TriggerEvent = {
        provider: 'github',
        eventType: req.headers['x-github-event'] as string,
        payload: req.body,
        metadata: {
          deliveryId: req.headers['x-github-delivery'] as string,
          timestamp: new Date().toISOString(),
          source: 'github',
        },
      };
      
      await this.client.sendToAll({
        dataType: 'json',
        data: event,
      });
      
      res.json({ ok: true });
    });
    
    // Generic HTTP webhook
    this.app.post('/webhooks/generic', async (req, res) => {
      const event: TriggerEvent = {
        provider: 'http',
        eventType: 'webhook',
        payload: req.body,
        metadata: {
          deliveryId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          source: req.get('User-Agent') || 'unknown',
        },
      };
      
      await this.client.sendToAll({
        dataType: 'json',
        data: event,
      });
      
      res.json({ ok: true });
    });
  }
  
  listen(port: number): void {
    this.app.listen(port, () => {
      console.log(`Webhook server listening on port ${port}`);
    });
  }
}
```

**Usage Example:**

```typescript
import { createTriggers } from '@loom/triggers';
import { WebPubSubTriggerAdapter } from '@loom/triggers/web-pubsub';
import { WebhookServer } from '@loom/triggers/webhook-server';

// Setup Web PubSub adapter
const adapter = new WebPubSubTriggerAdapter(
  process.env.AZURE_WEB_PUBSUB_CONNECTION_STRING!
);

// Define triggers
const triggers = createTriggers((on) => {
  // Slack events
  on.slack.messagePosted(async (event, context) => {
    const { channel, text, user } = event.payload;
    
    // Execute actor to handle message
    await context.actorRuntime.execute('slack-agent-1', async (actor) => {
      await actor.handleMessage(text, { channel, user });
    });
  });
  
  // GitHub events
  on.github.star(async (event, context) => {
    const { sender, repository } = event.payload;
    console.log(`${sender.login} starred ${repository.name}`);
  });
  
  // HTTP webhooks
  on.http.webhook(async (event, context) => {
    await context.actorRuntime.execute('webhook-handler', async (actor) => {
      await actor.process(event.payload);
    });
  });
});

// Register handlers
Object.entries(triggers).forEach(([eventKey, handler]) => {
  adapter.register(eventKey, handler);
});

// Start listening
await adapter.start({ actorRuntime, logger: console });

// Start webhook server (receives external webhooks, publishes to Web PubSub)
const webhookServer = new WebhookServer(
  process.env.AZURE_WEB_PUBSUB_CONNECTION_STRING!
);
webhookServer.listen(3000);
```

**Benefits:**
- ✅ **Real-time** - Sub-second latency for external events
- ✅ **No polling** - Event-driven architecture
- ✅ **Scalable** - Azure Web PubSub handles millions of connections
- ✅ **Reliable** - Automatic reconnection and message buffering
- ✅ **Clean DSL** - Type-safe trigger registration
- ✅ **Cost-effective** - ~$1.50/month for 1M messages

**Effort:** 3-4 days

---

## Feature 4: Enhanced Distributed Locks

### **Problem**
Current lock system is basic. Need to prevent:
- **Race conditions** - Two instances activating same actor
- **Infinite loops** - Actor stuck in loop consumes all resources
- **Deadlocks** - Actor A waits for Actor B, B waits for A

### **Solution: Enhanced Lock Manager** (~150 lines)

```typescript
// src/storage/enhanced-lock-manager.ts (~150 lines)

export interface LockOptions {
  ttlMs: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  detectDeadlock?: boolean;
}

export interface LockInfo {
  actorId: string;
  lockId: string;
  ownerId: string; // Process ID
  acquiredAt: number;
  expiresAt: number;
  waitingFor?: string[]; // For deadlock detection
}

export class EnhancedLockManager {
  private locks = new Map<string, LockInfo>();
  private lockWaiters = new Map<string, Set<string>>(); // actorId -> Set<ownerId>
  private ownerId: string;
  
  constructor(
    private baseManager: CoordinationAdapter,
    private maxLoopIterations: number = 1000 // Prevent infinite loops
  ) {
    this.ownerId = `${process.pid}-${crypto.randomUUID()}`;
  }
  
  /**
   * Acquire lock with retry and deadlock detection
   */
  async acquireLock(actorId: string, options: LockOptions): Promise<ActorLock | null> {
    const attempts = options.retryAttempts || 1;
    
    for (let i = 0; i < attempts; i++) {
      // Check for deadlock before attempting
      if (options.detectDeadlock && this.isDeadlocked(actorId)) {
        throw new Error(`Deadlock detected for actor ${actorId}`);
      }
      
      // Attempt to acquire lock
      const lock = await this.baseManager.acquireLock(actorId, options.ttlMs);
      
      if (lock) {
        // Success - store lock info
        this.locks.set(actorId, {
          actorId,
          lockId: lock.lockId,
          ownerId: this.ownerId,
          acquiredAt: Date.now(),
          expiresAt: lock.expiresAt,
        });
        
        // Remove from waiters
        this.lockWaiters.delete(actorId);
        
        return lock;
      }
      
      // Failed - add to waiters for deadlock detection
      if (!this.lockWaiters.has(actorId)) {
        this.lockWaiters.set(actorId, new Set());
      }
      this.lockWaiters.get(actorId)!.add(this.ownerId);
      
      // Retry with backoff
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, options.retryDelayMs || 100));
      }
    }
    
    return null; // Failed after all attempts
  }
  
  /**
   * Detect deadlock using cycle detection in wait-for graph
   */
  private isDeadlocked(actorId: string): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const hasCycle = (currentActorId: string): boolean => {
      visited.add(currentActorId);
      recursionStack.add(currentActorId);
      
      // Check all actors this one is waiting for
      const waitingFor = this.lockWaiters.get(currentActorId);
      if (waitingFor) {
        for (const waitingActorId of waitingFor) {
          if (!visited.has(waitingActorId)) {
            if (hasCycle(waitingActorId)) {
              return true;
            }
          } else if (recursionStack.has(waitingActorId)) {
            return true; // Cycle detected
          }
        }
      }
      
      recursionStack.delete(currentActorId);
      return false;
    };
    
    return hasCycle(actorId);
  }
  
  /**
   * Release lock
   */
  async releaseLock(lock: ActorLock): Promise<void> {
    await this.baseManager.releaseLock(lock);
    this.locks.delete(lock.actorId);
  }
  
  /**
   * Prevent infinite loops by tracking iterations
   */
  async executeWithLoopProtection<T>(
    actorId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    let iterations = 0;
    
    const wrappedFn = async (): Promise<T> => {
      iterations++;
      
      if (iterations > this.maxLoopIterations) {
        throw new Error(`Actor ${actorId} exceeded max loop iterations (${this.maxLoopIterations})`);
      }
      
      return fn();
    };
    
    return wrappedFn();
  }
  
  /**
   * Get all locks owned by this process
   */
  getOwnedLocks(): LockInfo[] {
    return Array.from(this.locks.values()).filter(
      lock => lock.ownerId === this.ownerId
    );
  }
  
  /**
   * Clean up stale locks (called periodically)
   */
  async cleanupStaleLocks(): Promise<void> {
    const now = Date.now();
    
    for (const [actorId, lock] of this.locks.entries()) {
      if (lock.expiresAt < now) {
        await this.baseManager.releaseLock({
          actorId,
          lockId: lock.lockId,
          expiresAt: lock.expiresAt,
        });
        this.locks.delete(actorId);
      }
    }
  }
}
```

**Integration with Actor Runtime:**

```typescript
// In ActorRuntime.execute()

async execute<T>(
  actorId: string,
  fn: (actor: Actor) => Promise<T>,
  options?: ExecuteOptions
): Promise<T> {
  // Try to acquire lock with retry and deadlock detection
  const lock = await this.lockManager.acquireLock(actorId, {
    ttlMs: 30000,
    retryAttempts: 3,
    retryDelayMs: 100,
    detectDeadlock: true,
  });
  
  if (!lock) {
    throw new Error(`Failed to acquire lock for actor ${actorId} after retries`);
  }
  
  try {
    const actor = await this.getOrCreateActor(actorId);
    
    // Execute with loop protection
    return await this.lockManager.executeWithLoopProtection(actorId, async () => {
      return await fn(actor);
    });
  } finally {
    await this.lockManager.releaseLock(lock);
  }
}
```

**Benefits:**
- ✅ **Deadlock detection** - Prevents Actor A waiting for Actor B waiting for Actor A
- ✅ **Loop protection** - Prevents infinite loops consuming resources
- ✅ **Retry with backoff** - Automatic retry on lock contention
- ✅ **Stale lock cleanup** - Automatic cleanup of expired locks
- ✅ **Observability** - Track all locks owned by process

**Effort:** 1 day

---

## Feature 5: TLS Notary Integration

### **Problem**
Agents receive data from external sources (bank APIs, email providers, etc.) but **cannot prove provenance**. Could be spoofed, tampered, or fabricated.

### **Solution: TLS Notary for Cryptographic Provenance** (~400 lines)

**What is TLS Notary:**
- Uses **Multi-Party Computation (MPC)** to split TLS session keys
- Generates **cryptographic proof** that data came from specific HTTPS endpoint
- Proof is **verifiable** by anyone without trusting the prover
- Essential for **regulatory compliance**, **auditing**, **financial applications**

**Architecture:**

```
External API (e.g., Chase.com)    TLS Notary Server         Loom Actor
┌────────────────────┐          ┌──────────────┐          ┌────────────┐
│                    │          │              │          │            │
│  1. TLS handshake  │◀────────▶│  2. MPC key  │          │            │
│     with MPC       │          │     sharing  │          │            │
│                    │          │              │          │            │
│  3. Encrypted data │──────────▶│  4. Generate │          │            │
│     transfer       │          │     proof    │──────────▶│  5. Verify │
│                    │          │              │          │     proof  │
└────────────────────┘          └──────────────┘          └────────────┘
                                                                  │
                                                                  ▼
                                                           ┌────────────┐
                                                           │  Journal   │
                                                           │  + Proof   │
                                                           └────────────┘
```

**Implementation:**

```typescript
// src/tls-notary/types.ts (~50 lines)

export interface TLSNotaryProof {
  sessionId: string;
  serverName: string; // e.g., "api.chase.com"
  timestamp: string;
  transcript: {
    sent: string; // HTTP request
    received: string; // HTTP response
  };
  signature: string; // Cryptographic signature
  notaryUrl: string;
}

export interface VerifiedData<T = any> {
  data: T;
  proof: TLSNotaryProof;
  verified: boolean;
  verifiedAt: string;
}
```

```typescript
// src/tls-notary/verifier.ts (~200 lines)

import { createPlugin, CallContext } from '@extism/extism';
import { readFile } from 'fs/promises';
import { BlobStore } from '../storage';

/**
 * TLS Notary proof verifier using WASM module
 */
export class TLSNotaryVerifier {
  private wasmPlugin?: any;
  
  constructor(private blobStore: BlobStore) {}
  
  /**
   * Load TLS Notary WASM verifier from blob storage
   */
  async initialize(): Promise<void> {
    // Load pre-compiled Rust WASM module
    const wasmBytes = await this.blobStore.download('tlsn-verifier.wasm');
    
    this.wasmPlugin = await createPlugin(wasmBytes, {
      useWasi: true,
      functions: {
        // Host functions for logging
        'loom_log': (context: CallContext, offset: bigint) => {
          const msg = context.read(offset)?.string();
          console.log(`[TLS Notary] ${msg}`);
        },
      },
    });
  }
  
  /**
   * Verify TLS Notary proof
   */
  async verify(proof: TLSNotaryProof): Promise<VerifiedData> {
    if (!this.wasmPlugin) {
      await this.initialize();
    }
    
    // Call WASM verifier
    const result = await this.wasmPlugin.call('verify_proof', JSON.stringify(proof));
    const verificationResult = JSON.parse(result.string());
    
    if (!verificationResult.valid) {
      throw new Error(`TLS Notary proof verification failed: ${verificationResult.error}`);
    }
    
    // Extract verified data from transcript
    const data = this.extractDataFromTranscript(proof.transcript.received);
    
    return {
      data,
      proof,
      verified: true,
      verifiedAt: new Date().toISOString(),
    };
  }
  
  /**
   * Extract JSON data from HTTP response
   */
  private extractDataFromTranscript(httpResponse: string): any {
    // Parse HTTP response
    const lines = httpResponse.split('\r\n');
    const bodyStartIndex = lines.findIndex(line => line === '');
    
    if (bodyStartIndex === -1) {
      throw new Error('Invalid HTTP response format');
    }
    
    const body = lines.slice(bodyStartIndex + 1).join('\r\n');
    
    try {
      return JSON.parse(body);
    } catch {
      return body; // Return raw body if not JSON
    }
  }
  
  /**
   * Verify proof is from expected server
   */
  verifyServerName(proof: TLSNotaryProof, expectedServer: string): void {
    if (proof.serverName !== expectedServer) {
      throw new Error(
        `Server name mismatch: expected ${expectedServer}, got ${proof.serverName}`
      );
    }
  }
  
  /**
   * Verify proof is recent (prevent replay attacks)
   */
  verifyTimestamp(proof: TLSNotaryProof, maxAgeMs: number = 300000): void {
    const proofTimestamp = new Date(proof.timestamp).getTime();
    const now = Date.now();
    
    if (now - proofTimestamp > maxAgeMs) {
      throw new Error(`Proof is too old: ${(now - proofTimestamp) / 1000}s`);
    }
  }
}
```

```typescript
// src/tls-notary/actor.ts (~150 lines)

export abstract class TLSNotaryActor extends Actor {
  protected verifier: TLSNotaryVerifier;
  
  constructor(context: ActorContext, blobStore: BlobStore) {
    super(context);
    this.verifier = new TLSNotaryVerifier(blobStore);
  }
  
  /**
   * Fetch data with TLS Notary proof
   */
  protected async fetchWithProof<T = any>(
    url: string,
    options?: {
      method?: string;
      body?: any;
      maxAgeMs?: number;
    }
  ): Promise<VerifiedData<T>> {
    // In real implementation, this would call TLS Notary service
    // For now, we assume proof is provided externally (e.g., from browser extension)
    throw new Error('Not implemented: Use TLS Notary browser extension to generate proofs');
  }
  
  /**
   * Verify externally-provided TLS Notary proof
   */
  protected async verifyProof<T = any>(
    proof: TLSNotaryProof,
    expectedServer: string,
    maxAgeMs?: number
  ): Promise<VerifiedData<T>> {
    // Verify server name
    this.verifier.verifyServerName(proof, expectedServer);
    
    // Verify timestamp (prevent replay)
    this.verifier.verifyTimestamp(proof, maxAgeMs);
    
    // Verify cryptographic proof
    const verified = await this.verifier.verify(proof);
    
    // Journal the verification
    await this.appendEvent({
      eventType: 'tls_notary_verified',
      data: {
        serverName: proof.serverName,
        sessionId: proof.sessionId,
        timestamp: proof.timestamp,
        verified: true,
        dataSize: JSON.stringify(verified.data).length,
      },
      timestamp: new Date().toISOString(),
      sequence: this.state._eventSequence + 1,
      correlationId: this.correlationId,
    });
    
    return verified;
  }
  
  /**
   * Store verified data in state
   */
  protected async storeVerifiedData<T>(
    key: string,
    verifiedData: VerifiedData<T>
  ): Promise<void> {
    this.updateState(state => {
      state[key] = verifiedData;
    });
    
    await this.appendEvent({
      eventType: 'verified_data_stored',
      data: {
        key,
        serverName: verifiedData.proof.serverName,
        verifiedAt: verifiedData.verifiedAt,
      },
      timestamp: new Date().toISOString(),
      sequence: this.state._eventSequence + 1,
      correlationId: this.correlationId,
    });
  }
}
```

**Usage Example:**

```typescript
interface BankAccountData {
  accountNumber: string;
  balance: number;
  transactions: Array<{
    date: string;
    amount: number;
    description: string;
  }>;
}

class LoanUnderwritingActor extends TLSNotaryActor {
  async verifyBankAccount(proof: TLSNotaryProof): Promise<boolean> {
    // Verify proof is from Chase Bank API
    const verifiedData = await this.verifyProof<BankAccountData>(
      proof,
      'api.chase.com', // Expected server
      300000 // Max age 5 minutes
    );
    
    // Store verified data
    await this.storeVerifiedData('bankAccount', verifiedData);
    
    // Use verified data for underwriting decision
    const avgBalance = this.calculateAvgBalance(verifiedData.data.transactions);
    
    return avgBalance > 50000; // Simplified underwriting logic
  }
  
  private calculateAvgBalance(transactions: BankAccountData['transactions']): number {
    if (transactions.length === 0) return 0;
    
    const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
    return total / transactions.length;
  }
}

// Usage
const actor = new LoanUnderwritingActor(context, blobStore);

// User provides TLS Notary proof (from browser extension)
const proof: TLSNotaryProof = {
  sessionId: 'session-abc123',
  serverName: 'api.chase.com',
  timestamp: '2025-12-18T10:30:00Z',
  transcript: {
    sent: 'GET /accounts/123 HTTP/1.1\r\nHost: api.chase.com\r\n...',
    received: 'HTTP/1.1 200 OK\r\n...\r\n{"accountNumber":"123","balance":75000,...}',
  },
  signature: 'crypto-signature-here',
  notaryUrl: 'https://notary.tlsnotary.org',
};

const approved = await actor.verifyBankAccount(proof);
console.log(`Loan application: ${approved ? 'APPROVED' : 'DENIED'}`);
```

**Benefits:**
- ✅ **Cryptographic provenance** - Prove data came from specific source
- ✅ **Tamper-proof** - Data cannot be modified without detection
- ✅ **Auditable** - All verifications journaled
- ✅ **Regulatory compliance** - Meets KYC/AML requirements
- ✅ **No trust required** - MPC eliminates single point of trust

**Effort:** 2-3 days (WASM module already exists, just need integration)

---

## Feature 6: RISC Zero zkVM Integration

### **Problem**
Actors make critical decisions but there's no cryptographic proof they executed correctly. AI agents operate as "black boxes" with no verifiability.

### **Solution: Zero-Knowledge Proofs for Actor Execution** (~400 lines)

**What is RISC Zero:**
- **zkVM (Zero-Knowledge Virtual Machine)** - Prove arbitrary code executed correctly
- Write proofs in **Rust** (70% of top 1000 crates work out-of-box)
- **Sub-12 second** real-time proving with GPU acceleration
- Generates **cryptographic receipts** verifiable by anyone
- **Privacy-preserving** - Don't need to reveal inputs or intermediate state

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                     Loom Actor                              │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Journal      │  │ Business     │  │ RISC Zero zkVM  │  │
│  │ (Durability) │  │ Logic        │  │ (Verification)  │  │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
│         │                  │                    │           │
│         └──────────────────┴────────────────────┘           │
│                            │                                │
│                   ┌────────▼────────┐                       │
│                   │ ZK Receipt      │                       │
│                   │ - Computation   │                       │
│                   │ - Inputs hash   │                       │
│                   │ - Output        │                       │
│                   │ - Proof         │                       │
│                   └─────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
// src/zkvm/risc-zero-executor.ts (~200 lines)

import { RiscZeroProver } from '@risc0/zkvm';

export interface ZKReceipt {
  journal: Buffer;        // Public outputs
  seal: Buffer;           // Cryptographic proof
  imageId: string;        // Guest program identifier
  verifiedAt?: string;
}

export class RiscZeroExecutor {
  private prover: RiscZeroProver;
  
  constructor(config: { gpuAcceleration?: boolean }) {
    this.prover = new RiscZeroProver(config);
  }
  
  /**
   * Execute Rust guest program in zkVM
   */
  async executeInZkVM<T>(
    guestProgram: Buffer,  // Compiled RISC-V binary
    input: any
  ): Promise<{ result: T; receipt: ZKReceipt }> {
    // Serialize input
    const inputBytes = Buffer.from(JSON.stringify(input));
    
    // Execute in zkVM (generates proof)
    const receipt = await this.prover.prove(guestProgram, inputBytes);
    
    // Extract result from journal
    const result = JSON.parse(receipt.journal.toString()) as T;
    
    return {
      result,
      receipt: {
        journal: receipt.journal,
        seal: receipt.seal,
        imageId: receipt.imageId,
        verifiedAt: new Date().toISOString()
      }
    };
  }
  
  /**
   * Verify ZK receipt
   */
  async verify(receipt: ZKReceipt): Promise<boolean> {
    return await this.prover.verify(receipt);
  }
}
```

```typescript
// src/actor/verifiable-actor.ts (~200 lines)

export abstract class VerifiableActor extends Actor {
  protected zkvm: RiscZeroExecutor;
  
  constructor(context: ActorContext) {
    super(context);
    this.zkvm = new RiscZeroExecutor({ gpuAcceleration: true });
  }
  
  /**
   * Execute function with ZK proof generation
   */
  protected async executeInZkVM<T>(
    guestProgram: Buffer,
    input: any
  ): Promise<{ result: T; receipt: ZKReceipt }> {
    const { result, receipt } = await this.zkvm.executeInZkVM<T>(
      guestProgram,
      input
    );
    
    // Journal the verified execution
    await this.appendEvent({
      eventType: 'zkvm_execution_completed',
      data: {
        input: input,
        result: result,
        imageId: receipt.imageId
      },
      zkReceipt: receipt,
      timestamp: new Date().toISOString(),
      sequence: this.state._eventSequence + 1,
      correlationId: this.correlationId,
    });
    
    return { result, receipt };
  }
}
```

**Usage Examples:**

```typescript
// Example 1: Verifiable AI Decision
class LoanUnderwriterActor extends VerifiableActor {
  async makeDecision(application: LoanApplication): Promise<Receipt> {
    const { result, receipt } = await this.executeInZkVM(
      this.underwritingGuestProgram,
      application
    );
    
    // Receipt proves: "Decision made following exact underwriting rules"
    return receipt;
  }
}

// Example 2: Verifiable Multi-Party Computation
class AuctionActor extends VerifiableActor {
  async determineBidWinner(bids: EncryptedBid[]): Promise<Receipt> {
    const { result, receipt } = await this.executeInZkVM(
      this.auctionGuestProgram,
      { bids }
    );
    
    // Receipt proves: "Winner determined correctly without revealing losing bids"
    return receipt;
  }
}
```

**Benefits:**
- ✅ **Cryptographic verification** - Prove actor executed correctly
- ✅ **Privacy-preserving** - Don't reveal sensitive inputs
- ✅ **Compliance** - Satisfy regulatory audit requirements
- ✅ **Trust** - Third parties can verify without re-execution
- ✅ **Non-repudiation** - Cannot deny what actor computed

**Use Cases:**
- AI-powered credit decisions (prove fair lending)
- Healthcare diagnosis AI (prove decision process)
- Financial trading (prove execution at claimed price/time)
- Hiring AI (prove non-discriminatory)
- Supply chain verification

**Effort:** 2-3 days

---

## Feature 7: Verifiable State Machines (TLS Notary + RISC Zero)

### **Problem**
Actors maintain state but cannot prove:
1. Where initial state came from (provenance)
2. Each state transformation was correct
3. Current state is result of verified history

### **Solution: Cryptographically Verifiable State History** (~650 lines)

**The Core Innovation:**

```
Proven Initial State (TLS Notary)
         │
         ▼
    ┌─────────────────┐
    │ State₀ = $10,000│  ← Proven from Chase.com API
    └─────────────────┘
         │
         │ Transaction₁: -$500
         │ ZK Proof: "Transformation applied correctly"
         ▼
    ┌─────────────────┐
    │ State₁ = $9,500 │  ← Cryptographically proven
    └─────────────────┘
         │
         │ Transaction₂: +$3,000
         │ ZK Proof: "Transformation applied correctly"
         ▼
    ┌─────────────────┐
    │ State₂ = $12,500│  ← Cryptographically proven
    └─────────────────┘
         │
         │ Transaction₃...N
         ▼
    ┌─────────────────┐
    │ StateN = Result │  ← Mathematically certain!
    └─────────────────┘
```

**If you can prove:**
1. Initial state is authentic (TLS Notary)
2. Each transformation is correct (RISC Zero)
3. **Then final state is mathematically certain!**

**Perfect Match with Loom's Journal:**
Loom's journal is already a sequence of state transformations - we just add cryptographic proofs!

**Architecture:**

```typescript
// src/actor/verifiable-state-actor.ts (~300 lines)

interface ProvenStateTransition {
  fromState: any;
  toState: any;
  event: JournalEntry;
  zkReceipt: ZKReceipt;  // Proves: toState = transform(fromState, event)
}

interface StateProvenance {
  initialState: any;
  initialProof: TLSNotaryProof;  // Proves where initial state came from
  transitions: ProvenStateTransition[];  // Chain of verified transformations
  currentState: any;
  compositeReceipt: ZKReceipt;  // Proves entire history is valid
}

export class VerifiableStateActor extends Actor {
  private stateProvenance: StateProvenance;
  private zkvm: RiscZeroExecutor;
  private tlsVerifier: TLSNotaryVerifier;
  
  /**
   * Initialize with proven initial state from external source
   */
  async initializeWithProvenance(tlsProof: TLSNotaryProof): Promise<void> {
    // Step 1: Verify TLS Notary proof (proves data source)
    const verifiedData = await this.tlsVerifier.verify(tlsProof);
    
    // Step 2: Generate ZK proof that we correctly parsed initial state
    const { initialState, receipt } = await this.zkvm.executeInZkVM(
      this.parseStateGuestProgram,
      verifiedData.data
    );
    
    this.stateProvenance = {
      initialState,
      initialProof: tlsProof,
      transitions: [],
      currentState: initialState,
      compositeReceipt: receipt
    };
    
    await this.appendEvent({
      eventType: 'state_initialized_with_provenance',
      data: {
        initialState,
        source: tlsProof.serverName,
        timestamp: tlsProof.timestamp
      },
      zkReceipt: receipt
    });
  }
  
  /**
   * Apply state transformation with ZK proof
   */
  protected async applyVerifiedTransformation<T>(
    transformFn: (currentState: any) => T,
    eventData: any
  ): Promise<T> {
    const fromState = this.stateProvenance.currentState;
    
    // Generate ZK proof for this transformation
    const { toState, receipt } = await this.zkvm.executeInZkVM(
      this.transformGuestProgram,
      { state: fromState, transform: transformFn.toString(), data: eventData }
    );
    
    // Record proven transition
    const transition: ProvenStateTransition = {
      fromState,
      toState,
      event: {
        eventType: 'state_transformed',
        data: eventData,
        timestamp: new Date().toISOString(),
        sequence: this.state._eventSequence + 1
      },
      zkReceipt: receipt
    };
    
    this.stateProvenance.transitions.push(transition);
    this.stateProvenance.currentState = toState;
    
    await this.appendEvent(transition.event);
    
    return toState;
  }
  
  /**
   * Generate proof of entire state history
   */
  async proveCurrentState(): Promise<StateProvenance> {
    // Generate composite proof that current state is result of:
    // 1. Proven initial state (TLS Notary)
    // 2. N verified transformations (RISC Zero)
    
    const { compositeReceipt } = await this.zkvm.executeInZkVM(
      this.verifyHistoryGuestProgram,
      {
        initialState: this.stateProvenance.initialState,
        transitions: this.stateProvenance.transitions
      }
    );
    
    return {
      ...this.stateProvenance,
      compositeReceipt
    };
  }
  
  /**
   * Merge two proven state histories
   */
  async mergeProvenStates(
    otherProvenance: StateProvenance
  ): Promise<StateProvenance> {
    const { mergedState, receipt } = await this.zkvm.executeInZkVM(
      this.mergeStatesGuestProgram,
      {
        stateA: this.stateProvenance,
        stateB: otherProvenance
      }
    );
    
    return {
      initialState: { ...this.stateProvenance.initialState, ...otherProvenance.initialState },
      initialProof: await this.mergeProofs([
        this.stateProvenance.initialProof,
        otherProvenance.initialProof
      ]),
      transitions: [
        ...this.stateProvenance.transitions,
        ...otherProvenance.transitions
      ],
      currentState: mergedState,
      compositeReceipt: receipt
    };
  }
}
```

**Incredible Use Cases:**

### **1. Verifiable Financial Ledger** 💰

```typescript
class BankAccountActor extends VerifiableStateActor {
  async initialize(accountNumber: string) {
    // Get initial balance from bank API with TLS Notary proof
    const tlsProof = await this.fetchWithTLSNotary(
      `https://api.chase.com/accounts/${accountNumber}/balance`
    );
    
    await this.initializeWithProvenance(tlsProof);
    // State₀: { balance: $10,000, source: "api.chase.com", verified: true }
  }
  
  async deposit(amount: number) {
    await this.applyVerifiedTransformation(
      (state) => ({
        ...state,
        balance: state.balance + amount
      }),
      { type: 'deposit', amount }
    );
    // ZK Proof: "$10,000 + $500 = $10,500 computed correctly"
  }
  
  async withdraw(amount: number) {
    await this.applyVerifiedTransformation(
      (state) => {
        assert(state.balance >= amount, 'Insufficient funds');
        return { ...state, balance: state.balance - amount };
      },
      { type: 'withdraw', amount }
    );
    // ZK Proof: "$10,500 - $200 = $10,300 computed correctly"
  }
  
  async proveBalance(): Promise<StateProvenance> {
    // Proves: Current balance is result of verified initial state + verified transactions
    return this.proveCurrentState();
  }
}

// Value: Prove account balance WITHOUT revealing transaction history!
```

### **2. Verifiable Healthcare Record** 🏥

```typescript
class MedicalRecordActor extends VerifiableStateActor {
  async initialize(patientId: string) {
    const tlsProof = await this.fetchWithTLSNotary(
      `https://api.hospital.com/patients/${patientId}/records`
    );
    
    await this.initializeWithProvenance(tlsProof);
  }
  
  async addDiagnosis(diagnosis: string, doctorId: string) {
    await this.applyVerifiedTransformation(
      (state) => ({
        ...state,
        diagnoses: [...state.diagnoses, { diagnosis, doctor: doctorId, date: Date.now() }]
      }),
      { type: 'diagnosis', diagnosis, doctorId }
    );
    // ZK Proof: "Diagnosis added by authorized doctor"
  }
  
  async proveMedicalHistory(): Promise<StateProvenance> {
    return this.proveCurrentState();
    // Insurance can verify WITHOUT seeing private medical details!
  }
}
```

### **3. Verifiable Supply Chain** 📦

```typescript
class ProductJourneyActor extends VerifiableStateActor {
  async initialize(productId: string) {
    const tlsProof = await this.fetchWithTLSNotary(
      `https://api.manufacturer.com/products/${productId}`
    );
    
    await this.initializeWithProvenance(tlsProof);
    // State₀: { location: "Factory", quality: "A+", authentic: true }
  }
  
  async recordShipment(from: string, to: string) {
    await this.applyVerifiedTransformation(
      (state) => ({
        ...state,
        location: to,
        journey: [...state.journey, { from, to, timestamp: Date.now() }]
      }),
      { type: 'shipment', from, to }
    );
  }
  
  async proveAuthenticity(): Promise<StateProvenance> {
    return this.proveCurrentState();
    // Buyer verifies: Product from genuine factory + tracked custody chain
  }
}
```

### **4. Verifiable AI Training** 🤖

```typescript
class LearningAIActor extends VerifiableStateActor {
  async initialize(modelId: string) {
    const tlsProof = await this.fetchWithTLSNotary(
      `https://api.openai.com/models/${modelId}/initial-state`
    );
    
    await this.initializeWithProvenance(tlsProof);
  }
  
  async learn(experience: any) {
    await this.applyVerifiedTransformation(
      (state) => ({
        ...state,
        knowledge: this.updateKnowledge(state.knowledge, experience),
        experiences: state.experiences + 1
      }),
      { type: 'learning', experience }
    );
    // ZK Proof: "AI learned from approved data using approved algorithm"
  }
  
  async proveTrainingHistory(): Promise<StateProvenance> {
    return this.proveCurrentState();
    // Regulators verify: Started with approved model + trained ethically
  }
}
```

### **5. Composable Multi-Party State** 🔗

```typescript
// Alice and Bob exchange money with verifiable state
const aliceAccount = new BankAccountActor(contextA);
const bobAccount = new BankAccountActor(contextB);

await aliceAccount.initialize('alice-123');
await bobAccount.initialize('bob-456');

// Transaction
await aliceAccount.withdraw(100);
await bobAccount.deposit(100);

// Prove consistency across both accounts
const mergedProof = await aliceAccount.mergeProvenStates(
  await bobAccount.proveCurrentState()
);

// Cryptographically proves: Money left Alice AND arrived at Bob
// No double-spend! No money creation/destruction!
```

**Benefits:**
- ✅ **End-to-End Provenance** - From data source to current state
- ✅ **Privacy-Preserving** - Prove properties without revealing data
- ✅ **Regulatory Compliance** - Satisfy strictest audit requirements
- ✅ **Tamper-Proof** - Cannot fake or modify state history
- ✅ **Composable** - Merge multiple state proofs
- ✅ **Non-Repudiation** - Cryptographic proof of state transitions

**Implementation Details:**

```typescript
// src/actor/verifiable-state-actor.ts (~300 lines)
// src/zkvm/state-proof-composer.ts (~200 lines)
// src/tls-notary/state-initializer.ts (~150 lines)

// Total: ~650 lines for complete verifiable state machine
```

**Effort:** 3-4 days

---

## Implementation Roadmap

### **Phase 1: Foundation** (Week 1)
**Goal**: Get basic infrastructure working

1. **Unified LLM API** (2-3 days)
   - Create base interfaces
   - Implement OpenAI provider
   - Implement Anthropic provider
   - Implement Azure OpenAI provider
   - Add AIActor base class

2. **SupervisorActor Pattern** (1-2 days)
   - Create SupervisorActor base class
   - Implement routing logic
   - Add AI-powered routing

**Deliverable**: AI agents can easily call LLMs and coordinate hierarchically

---

### **Phase 2: External Integration** (Week 2)
**Goal**: Connect to external world

3. **Event-Driven Triggers** (3-4 days)
   - Set up Azure Web PubSub
   - Create trigger DSL
   - Implement WebPubSubTriggerAdapter
   - Create WebhookServer
   - Add Slack/GitHub integrations

**Deliverable**: Actors respond to external events in real-time

---

### **Phase 3: Reliability & Provenance** (Week 3)
**Goal**: Bulletproof the system with cryptographic guarantees

4. **Enhanced Distributed Locks** (1 day)
   - Add deadlock detection
   - Add loop protection
   - Add retry with backoff
   - Add stale lock cleanup

5. **TLS Notary Integration** (2-3 days)
   - Create WASM verifier
   - Implement TLSNotaryVerifier
   - Add TLSNotaryActor base class
   - Create proof verification flow

6. **RISC Zero zkVM Integration** (2-3 days)
   - Implement RiscZeroExecutor
   - Create VerifiableActor base class
   - Add ZK receipt journaling
   - Build example guest programs

**Deliverable**: Production-ready reliability and cryptographic provenance

---

### **Phase 4: Advanced Verifiability** (Week 4)
**Goal**: Complete verifiable state machine capabilities

7. **Verifiable State Machines** (3-4 days)
   - Implement VerifiableStateActor
   - Integrate TLS Notary + RISC Zero
   - Build state proof composer
   - Add composable state proofs
   - Create example applications (bank account, healthcare, supply chain)

**Deliverable**: End-to-end verifiable state with provenance

---

### **Phase 5: Polish & Documentation** (Week 5)
**Goal**: Make it production-ready

- Write comprehensive documentation
- Create example applications for all features
- Add unit tests (80%+ coverage)
- Add integration tests
- Performance benchmarks
- Security audit preparation

---

## Architecture Principles (Loom Philosophy)

### **1. Minimal Code**
- Each feature < 650 lines
- No frameworks or heavy dependencies
- TypeScript + Rust (for zkVM guest programs)
- Total: ~2,900 lines for 7 transformative features

### **2. Maximum Functionality**
- LLM abstraction supports 4+ providers
- Supervisor pattern enables complex coordination
- Triggers handle real-time external events
- Locks prevent all race conditions
- TLS Notary provides cryptographic provenance
- zkVM enables verifiable computation
- Verifiable state machines with end-to-end provenance

### **3. Leverage Existing Infrastructure**
- **Azure Web PubSub** - No custom WebSocket server needed
- **Existing Journal** - All features automatically durable
- **Existing Locks** - Enhanced lock builds on RedisCoordinationAdapter
- **Existing WASM** - TLS Notary uses existing WASM executor
- **Existing Actors** - All features extend Actor base class

### **4. Zero Breaking Changes**
- All features are **additive**
- Existing actors continue to work
- No migration required
- Opt-in activation

### **5. Composable, Opt-In Architecture** ⭐

**Critical Design Principle**: Features are **optional layers**, not mandatory overhead.

```typescript
// Base Actor - Always available (~150 lines)
class Actor {
  // Core: State, journal, events, messages
  // NO verification overhead
  // NO TLS Notary overhead
  // NO LLM overhead
}

// Layer 1: AI Capabilities (opt-in)
class AIActor extends Actor {
  // Adds: LLM integration
  // Cost: ~50ms per LLM call
  // Use when: Need AI reasoning
}

// Layer 2: Hierarchical Coordination (opt-in)
class SupervisorActor extends Actor {
  // Adds: Team delegation, routing
  // Cost: Minimal (just message routing)
  // Use when: Multi-agent coordination
}

// Layer 3: Verified Execution (opt-in) - ONLY WHEN NEEDED
class VerifiableActor extends Actor {
  // Adds: zkVM proof generation
  // Cost: ~12 seconds + $0.10-$1.00 per proof
  // Use when: Regulatory compliance, high-stakes decisions
}

// Layer 4: Proven Data Sources (opt-in) - ONLY WHEN NEEDED
class TLSNotaryActor extends Actor {
  // Adds: TLS proof verification
  // Cost: ~200ms per proof verification
  // Use when: Need cryptographic provenance of external data
}

// Layer 5: Full Verifiable State (opt-in) - ONLY FOR CRITICAL ACTORS
class VerifiableStateActor extends Actor {
  // Combines: TLS Notary + zkVM
  // Cost: Expensive (proof per state transition)
  // Use when: Financial ledgers, medical records, critical state
}
```

**Composability Examples:**

```typescript
// Example 1: Simple actor (no overhead)
class LogProcessorActor extends Actor {
  // Just processes logs
  // No AI, no verification, no TLS
  // Fast and cheap
}

// Example 2: AI-powered actor (LLM only)
class ChatbotActor extends AIActor {
  // Uses LLM for responses
  // No verification (chatbot doesn't need cryptographic proof)
  // Still fast, moderate cost
}

// Example 3: Verifiable AI (LLM + zkVM)
class LoanUnderwriterActor extends VerifiableActor {
  protected llm: UnifiedLLM;
  
  async makeDecision(application: any) {
    // Use LLM for analysis
    const analysis = await this.chat([...]);
    
    // Generate proof ONLY for final decision
    const { decision, receipt } = await this.executeInZkVM(
      this.decisionGuestProgram,
      { analysis, application }
    );
    
    return { decision, proof: receipt };
  }
  // Expensive but necessary for compliance
}

// Example 4: Proven data + verified processing
class FinancialAuditorActor extends VerifiableStateActor {
  // Initializes with TLS-proven bank data
  // Every transaction generates zkVM proof
  // Most expensive but provides maximum guarantees
}

// Example 5: Mixed system (composable!)
class MortgageWorkflowActor extends SupervisorActor {
  team = [
    'document-processor',      // Regular Actor (fast, cheap)
    'credit-checker',          // TLSNotaryActor (proven data source)
    'underwriter',             // VerifiableActor (proven decision)
    'notifier'                 // Regular Actor (just sends emails)
  ];
  
  // Only verification where it matters!
  // 3/4 actors are lightweight
  // 1/4 actors provide cryptographic guarantees
}
```

**Performance Characteristics:**

| Actor Type | Overhead per Operation | Cost | When to Use |
|------------|----------------------|------|-------------|
| `Actor` | ~1ms | Free | General purpose, high throughput |
| `AIActor` | ~50-500ms | LLM cost | Need AI reasoning |
| `SupervisorActor` | ~5ms | Free | Multi-agent coordination |
| `VerifiableActor` | ~12 seconds | $0.10-$1.00 | Compliance, high-stakes |
| `TLSNotaryActor` | ~200ms | Free | Proven external data |
| `VerifiableStateActor` | ~12s per transition | $0.10-$1.00 per transition | Critical state (financial, medical) |

**Design Guidelines:**

✅ **DO**: Use regular `Actor` for 90% of your actors  
✅ **DO**: Use `VerifiableActor` for regulatory/compliance scenarios  
✅ **DO**: Use `TLSNotaryActor` when you need to prove data provenance  
✅ **DO**: Use `VerifiableStateActor` for financial ledgers, medical records  
✅ **DO**: Mix actor types freely in same system  

❌ **DON'T**: Make every actor verifiable (massive overhead)  
❌ **DON'T**: Use zkVM for simple operations  
❌ **DON'T**: Generate proofs for internal state (only for external verification)  
❌ **DON'T**: Assume one size fits all  

**Selective Verification Pattern:**

```typescript
class SmartActor extends Actor {
  async processTransaction(tx: Transaction) {
    // Fast path: No verification for small amounts
    if (tx.amount < 1000) {
      return this.processQuickly(tx);
    }
    
    // Slow path: Verification for large amounts
    const verifiable = new VerifiableActor(this.context);
    return verifiable.executeInZkVM(
      this.verificationProgram,
      tx
    );
  }
}
```

**Journal Optimization:**

```typescript
// Option 1: Regular journal (fast, no proofs)
await this.appendEvent({
  eventType: 'transaction_processed',
  data: { amount: 100 }
  // No zkReceipt - just stored for durability
});

// Option 2: Verifiable journal (slow, with proof)
await this.appendEvent({
  eventType: 'transaction_processed',
  data: { amount: 100000 },
  zkReceipt: receipt  // Only include when verification needed
});
```

**Key Insight**: The journal is **always durable**, but **optionally verifiable**. You only pay the verification cost when you need it.

---

## Cost Analysis

### **Development Cost**
- 4-5 weeks of development time
- ~2,900 lines of production code
- ~800 lines of tests
- ~1,500 lines of documentation

### **Runtime Cost** (Monthly, Azure)

| Feature | Service | Cost |
|---------|---------|------|
| Unified LLM API | N/A (calls external APIs) | Variable (LLM usage) |
| SupervisorActor | N/A (uses existing actors) | $0 |
| Triggers | Azure Web PubSub (Standard) | ~$50/month (1M messages) |
| Enhanced Locks | Redis (existing) | $0 (already have) |
| TLS Notary | WASM execution (existing) | $0 (compute only) |
| RISC Zero zkVM | Proving costs (GPU/cloud) | ~$0.10-$1.00/proof (optional) |
| Verifiable State | zkVM + TLS Notary combined | Variable per proof |
| **Total** | | **~$50/month + proof costs** |

**Notes:**
- LLM costs vary by usage (OpenAI ~$0.50/1M tokens)
- Web PubSub Free tier: 20K messages/day, 20 concurrent connections
- TLS Notary uses existing WASM infrastructure
- zkVM proving is optional - only generate proofs when verification needed
- Proof verification is nearly free (milliseconds, no GPU required)

---

## Risk Assessment

### **Technical Risks**

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Azure Web PubSub complexity | Low | Medium | Use official SDK, simple message format |
| TLS Notary WASM size | Low | Low | Lazy load, only when needed |
| LLM API changes | Medium | Low | Abstract interfaces, easy to update |
| Deadlock detection overhead | Low | Medium | Only run when enabled, minimal graph traversal |
| Lock contention in production | Medium | Medium | Exponential backoff, monitoring |

### **Operational Risks**

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Web PubSub outage | Low | High | Automatic reconnection, message buffering |
| LLM provider outage | Medium | High | Multi-provider fallback |
| TLS Notary service down | Low | Medium | Cache proofs, async verification |
| Lock manager failure | Low | High | Automatic cleanup, health checks |

---

## Success Metrics

### **Code Quality**
- ✅ Total new code < 3,000 lines
- ✅ Each feature < 650 lines
- ✅ Test coverage > 80%
- ✅ Zero breaking changes
- ✅ Backward compatible

### **Performance**
- ✅ LLM call overhead < 50ms
- ✅ Trigger latency < 100ms
- ✅ Lock acquisition < 10ms
- ✅ TLS verification < 200ms
- ✅ zkVM proving < 12 seconds (with GPU)
- ✅ Proof verification < 10ms
- ✅ No memory leaks

### **Developer Experience**
- ✅ Time to first AI agent: < 10 minutes
- ✅ Trigger setup: < 5 minutes
- ✅ TLS Notary integration: < 15 minutes
- ✅ Verifiable actor: < 20 minutes
- ✅ Documentation coverage: 100%

---

## Conclusion

This roadmap adds **7 transformative features** to Loom while maintaining the core philosophy of **minimal code, maximum functionality**:

1. **Unified LLM API** (~300 lines) - Makes AI integration trivial *(opt-in)*
2. **SupervisorActor Pattern** (~200 lines) - Enables complex multi-agent systems *(opt-in)*
3. **Event-Driven Triggers** (~800 lines) - Connects to external world in real-time *(opt-in)*
4. **Enhanced Distributed Locks** (~150 lines) - Prevents race conditions and deadlocks *(automatic)*
5. **TLS Notary Integration** (~400 lines) - Provides cryptographic data provenance *(opt-in)*
6. **RISC Zero zkVM** (~400 lines) - Enables verifiable computation *(opt-in)*
7. **Verifiable State Machines** (~650 lines) - End-to-end verifiable state with provenance *(opt-in)*

**Total Code**: ~2,900 lines  
**Time**: 4-5 weeks  
**Cost**: ~$50/month base + pay-per-use for verification  
**Impact**: Creates the world's first **verifiable AI agent platform** with cryptographic guarantees

### **The Smart Default: Fast by Default, Verifiable When Needed**

```typescript
// 90% of your actors: Fast and simple
class OrderProcessorActor extends Actor {
  // No overhead, no extra cost
  // Just durable, reliable actors
}

// 9% of your actors: AI-powered
class CustomerSupportActor extends AIActor {
  // LLM cost only
  // Still fast (<1 second)
}

// 1% of your actors: Cryptographically verified
class ComplianceAuditorActor extends VerifiableStateActor {
  // Expensive but necessary
  // Only for critical operations
}
```

**This architecture means:**
- ✅ Build fast, cheap actors by default
- ✅ Add verification ONLY where regulation requires it
- ✅ Mix verifiable and non-verifiable actors freely
- ✅ Pay verification costs only for critical operations
- ✅ No performance penalty for 90% of your system

**Example Production System:**

```
E-commerce Platform (100 actors):
├─ 85 actors: Regular Actor (inventory, shipping, notifications)
│  └─ Cost: $0 overhead, just compute
├─ 10 actors: AIActor (customer support, recommendations)
│  └─ Cost: LLM API calls (~$50/month)
├─ 4 actors: TLSNotaryActor (payment verification, bank APIs)
│  └─ Cost: ~$0 (verification is cheap)
└─ 1 actor: VerifiableStateActor (financial ledger)
   └─ Cost: ~$100/month (1000 verified transactions)

Total: ~$200/month for verifiable commerce platform
```

**Key Principle**: **"Optimize for the common case, enable the critical case"**

Regular actors are blazing fast. Verifiable actors are there when you need them. No forced overhead. Perfect composability.

---

## Why This is Revolutionary

### **The Unique Combination:**

```
┌────────────────────────────────────────────────────────────────┐
│                    Loom's Unique Stack                         │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Journal (Durability)  +  TLS Notary (Provenance)             │
│            +                                                   │
│  RISC Zero (Verification)  +  Actor Model (Isolation)          │
│                                                                │
│  = Verifiable AI Agents with Proven State History             │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**No other platform offers:**
1. **Durable AI agents** (journal-based persistence)
2. **Proven data sources** (TLS Notary)
3. **Verifiable computation** (RISC Zero zkVM)
4. **Verifiable state machines** (provable state transformations)
5. **All in <3,000 lines of code**

### **Market Differentiation:**

**vs. Traditional Agent Frameworks (AutoGPT, LangChain):**
- ❌ No durability (crash = lost state)
- ❌ No provenance (can't prove data sources)
- ❌ No verifiability (black box decisions)
- ✅ Loom: All three + minimal code

**vs. Blockchain Smart Contracts:**
- ❌ No AI/LLM integration
- ❌ No external data access (oracle problem)
- ❌ Expensive computation ($100s per complex operation)
- ✅ Loom: Full AI + proven external data + cheap computation

**vs. ZK Platforms (StarkNet, zkSync):**
- ❌ Blockchain-only (can't do general computation)
- ❌ No AI agent support
- ❌ Complex development (custom languages)
- ✅ Loom: General-purpose + AI-native + TypeScript/Rust

### **Killer Use Cases:**

**Financial Services** 💰
- Verifiable loan underwriting (prove fair lending without revealing data)
- Auditable trading bots (prove execution at claimed price/time)
- Privacy-preserving credit scoring

**Healthcare** 🏥
- HIPAA-compliant AI diagnosis (prove process without revealing PHI)
- Verifiable medical records (prove authenticity + custody chain)
- Insurance claim adjudication with proof

**Supply Chain** 📦
- Anti-counterfeiting (cryptographic proof of authenticity)
- Provable custody transfers
- Quality assurance with verification

**AI Governance** 🤖
- Prove AI training was ethical
- Verifiable AI decision-making
- Regulatory compliance for AI systems

### **Business Value:**

**For Developers:**
- Build regulated AI apps in weeks (not months)
- No cryptography expertise required
- Familiar languages (TypeScript + Rust)
- Minimal code = maintainable systems

**For Enterprises:**
- Satisfy regulators (cryptographic audit trails)
- Reduce liability (prove decisions were correct)
- Enable new business models (privacy-preserving collaboration)
- Premium pricing potential (2-5x for verified operations)

**For End Users:**
- Trust AI decisions (cryptographic verification)
- Privacy preservation (prove properties without revealing data)
- Data sovereignty (control your own verified state)

---

## Key Insights

1. **Azure Web PubSub eliminates polling** - Real-time events with zero polling overhead

2. **All features leverage existing infrastructure** - Journal, actors, WASM, Redis locks

3. **Perfect architectural fit** - Loom's journal is naturally a verifiable state machine

4. **Zero breaking changes** - All features are additive, opt-in

5. **Incremental value** - Each feature works standalone, compound value together

6. **Minimal code philosophy** - ~2,900 lines for features that would take 50k+ elsewhere

7. **Revolutionary combination** - First platform with durability + provenance + verifiability + AI

---

## The Vision

**"Build AI agents you can cryptographically trust"**

Loom becomes the platform for **verifiable AI** - where every agent decision comes with mathematical proof of correctness, every data source has cryptographic provenance, and every state transition is auditable.

This isn't just an incremental improvement. This is **redefining what's possible** with AI agents.

---

**Ready to build the future?** Let's start with Phase 1! 🚀
