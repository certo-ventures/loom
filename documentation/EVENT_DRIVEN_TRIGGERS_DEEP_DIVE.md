# Event-Driven Triggers: Deep Dive Analysis

**VoltAgent vs Loom Implementation Strategy**

---

## Executive Summary

VoltAgent's **Event-Driven Triggers** system is a production-ready abstraction that connects external events (Slack, GitHub, Gmail, webhooks, etc.) to AI agents with minimal code. This analysis provides a comprehensive breakdown of the architecture, implementation details, and a concrete roadmap for adding this capability to Loom.

---

## 1. What VoltAgent's Triggers System Does

### **Core Concept**
VoltAgent's triggers create a **clean separation** between:
1. **External Event Sources** (Slack, Gmail, HTTP webhooks, GitHub, Airtable, Cron)
2. **Event Detection & Validation** (managed by VoltOps platform)
3. **Agent Execution** (your code runs when events occur)

### **The DSL (Domain-Specific Language)**

The most impressive part is the **clean, type-safe DSL**:

```typescript
import { VoltAgent, createTriggers } from "@voltagent/core";

new VoltAgent({
  agents: { myAgent },
  triggers: createTriggers((on) => {
    // Slack triggers
    on.slack.messagePosted(async ({ payload, agents }) => {
      const { channel, text, user } = payload;
      await agents.myAgent.handleMessage(text);
    });

    // GitHub triggers
    on.github.pullRequestOpened(async ({ payload, agents }) => {
      const { pull_request } = payload;
      await agents.codeReviewAgent.review(pull_request);
    });

    // Gmail triggers (polling-based)
    on.gmail.emailReceived(async ({ payload, agents }) => {
      const { subject, from, body } = payload;
      await agents.emailAgent.process({ subject, from, body });
    });

    // Cron/schedule triggers
    on.cron.schedule(async ({ agents }) => {
      await agents.reportAgent.generateDailyReport();
    });

    // HTTP webhook triggers
    on.webhook.received(async ({ payload, agents }) => {
      await agents.webhookHandler.process(payload);
    });
  }),
});
```

### **Key Features**

1. **Type-Safe Event Names** - `on.slack.messagePosted` is type-checked at compile time
2. **Automatic Routing** - Events automatically route to registered handlers
3. **Managed Credentials** - No need to handle OAuth, API tokens, etc.
4. **Auto-Generated Endpoints** - HTTP endpoints created automatically (e.g., `/triggers/slack/messagePosted`)
5. **Payload Normalization** - Consistent payload structure regardless of source
6. **Delivery Modes** - Webhook (push), Polling (pull), Schedule (time-based)

---

## 2. Architecture Breakdown

### **2.1 Trigger Registry System**

VoltAgent maintains a **catalog** of available triggers with metadata:

```typescript
// From: packages/core/src/triggers/catalog-data/default-trigger-catalog.ts
export const DEFAULT_TRIGGER_CATALOG = [
  {
    triggerId: "slack",
    displayName: "Slack",
    service: "Slack",
    category: "Email & Messaging",
    authType: "token",
    deliveryModes: ["webhook"],
    events: [
      {
        key: "slack.messagePosted",
        displayName: "Message posted to channel",
        description: "Trigger when a new message is posted...",
        deliveryMode: "webhook",
        defaultConfig: {
          provider: {
            type: "slack",
            watchWorkspace: false,
            channelId: null,
            includeBotMessages: false,
          },
        },
      },
      {
        key: "slack.appMention",
        displayName: "Bot or app mention",
        description: "Trigger when your bot is mentioned...",
        deliveryMode: "webhook",
      },
      // ... more Slack events
    ],
  },
  {
    triggerId: "github",
    displayName: "GitHub",
    events: [
      { key: "github.star", displayName: "Star", deliveryMode: "webhook" },
      { key: "github.pullRequest", displayName: "Pull request", deliveryMode: "webhook" },
      { key: "github.issueOpened", displayName: "Issue opened", deliveryMode: "webhook" },
      // ... 30+ GitHub events
    ],
  },
  {
    triggerId: "cron",
    displayName: "Cron Trigger",
    events: [
      {
        key: "cron.schedule",
        displayName: "Scheduled run",
        deliveryMode: "schedule",
        defaultConfig: {
          schedule: {
            type: "cron",
            expression: "*/5 * * * *", // Every 5 minutes
            timezone: "UTC",
          },
        },
      },
    ],
  },
];
```

### **2.2 DSL Implementation**

The `createTriggers` function uses **Proxy objects** for type-safe dot notation:

```typescript
// From: packages/core/src/triggers/dsl.ts
export function createTriggers(builder: (on: TriggerDsl) => void): VoltAgentTriggersConfig {
  const registry: VoltAgentTriggersConfig = {};
  
  // Create proxy that captures "on.slack.messagePosted(...)"
  const createProviderProxy = (providerKey: string) => {
    return new Proxy({}, {
      get(_target, eventName) {
        // Lookup "slack.messagePosted" in catalog
        const eventKey = VoltOpsTriggerGroups[providerKey][eventName];
        if (!eventKey) {
          throw new Error(`Unknown event: ${providerKey}.${eventName}`);
        }
        
        // Return function that registers handler
        return (config: VoltAgentTriggerConfig) => {
          registry[eventKey] = config;
        };
      }
    });
  };
  
  const dsl = new Proxy({}, {
    get(_target, providerKey) {
      // Returns provider proxy (e.g., "slack", "github")
      return createProviderProxy(providerKey);
    }
  });
  
  // Call user's builder function with DSL
  builder(dsl as TriggerDsl);
  
  return registry;
}
```

**Type Safety:**
```typescript
type VoltOpsTriggerGroupMap = {
  slack: {
    messagePosted: "slack.messagePosted";
    appMention: "slack.appMention";
    reactionAdded: "slack.reactionAdded";
    // ...
  };
  github: {
    star: "github.star";
    pullRequest: "github.pullRequest";
    issueOpened: "github.issueOpened";
    // ...
  };
  // ...
};
```

### **2.3 HTTP Route Generation**

When you register triggers, VoltAgent **automatically creates HTTP endpoints**:

```typescript
// From: packages/server-hono/src/routes/trigger.routes.ts
export function registerTriggerRoutes(
  app: OpenAPIHonoType,
  deps: ServerProviderDeps,
  logger: Logger,
): void {
  const triggers = deps.triggerRegistry.list();
  
  triggers.forEach((trigger) => {
    const method = trigger.method ?? "post";
    const path = trigger.path; // e.g., "/triggers/slack/messagePosted"
    
    const handler = async (c: any) => {
      const body = await c.req.json().catch(() => undefined);
      const context: TriggerHttpRequestContext = {
        body,
        headers: extractHeaders(c.req.raw?.headers),
        query: extractQuery(c.req.queries()),
        raw: c.req.raw,
      };
      
      const response = await executeTriggerHandler(trigger, context, deps, logger);
      return c.json(response.body ?? { success: true }, response.status, response.headers);
    };

    app[method](path, handler);
  });
}
```

**Generated Routes:**
- `POST /triggers/slack/messagePosted`
- `POST /triggers/github/star`
- `POST /triggers/airtable/recordCreated`
- `POST /triggers/webhook/received`

### **2.4 Trigger Handler Context**

Each trigger handler receives a **rich context object**:

```typescript
// From: packages/core/src/triggers/types.ts
export interface TriggerHandlerContext<TPayload = unknown> {
  // The actual event data
  payload: TPayload;
  
  // VoltOps envelope with metadata
  event: VoltOpsTriggerEnvelope<TPayload>;
  
  // Trigger definition
  trigger: RegisteredTrigger<TPayload>;
  
  // Logger instance
  logger: Logger;
  
  // HTTP headers
  headers: Record<string, string>;
  
  // Access to all registered agents and workflows
  agentRegistry: ServerProviderDeps["agentRegistry"];
  workflowRegistry: ServerProviderDeps["workflowRegistry"];
  agents: Record<string, Agent>;
  
  // VoltOps client for calling Actions
  voltOpsClient?: VoltOpsClient;
  
  // Raw HTTP request (for advanced use cases)
  rawRequest?: unknown;
}
```

### **2.5 Event Payload Structure**

VoltAgent normalizes payloads with **consistent metadata**:

```json
{
  "triggerMetadata": {
    "provider": "slack",
    "triggerKey": "slack.messagePosted",
    "eventType": "message",
    "channelId": "C0123456",
    "userId": "U0123456",
    "deliveryId": "unique-event-id"
  },
  "input": {
    "type": "message",
    "channel": "C0123456",
    "text": "Hello from Slack!",
    "user": "U0123456",
    "ts": "1731000000.000200",
    "thread_ts": "1731000000.000100"
  }
}
```

---

## 3. Delivery Modes

VoltAgent supports **3 delivery mechanisms**:

### **3.1 Webhook (Push)**
External service **pushes events** to your endpoint.

**Examples:** Slack, GitHub, Stripe

**Flow:**
1. User configures webhook URL in external service (e.g., Slack Event Subscriptions)
2. Slack sends POST request to `https://your-app.com/triggers/slack/messagePosted`
3. VoltAgent validates request (signature verification)
4. Trigger handler executes

**Verification:**
```typescript
// Slack signature verification example
const slackSignature = headers['x-slack-signature'];
const timestamp = headers['x-slack-request-timestamp'];
const body = JSON.stringify(payload);

const baseString = `v0:${timestamp}:${body}`;
const expectedSignature = `v0=${crypto.createHmac('sha256', signingSecret)
  .update(baseString)
  .digest('hex')}`;

if (slackSignature !== expectedSignature) {
  throw new Error('Invalid Slack signature');
}
```

### **3.2 Polling (Pull)**
VoltOps **periodically checks** external service for new events.

**Examples:** Gmail, Airtable, Google Drive

**Flow:**
1. VoltOps polls Gmail API every N seconds
2. Checks for new emails with specific label
3. If new emails found, sends them to your trigger handler
4. Marks emails as "processed" to avoid duplicates

**Configuration:**
```typescript
on.gmail.emailReceived(async ({ payload, agents }) => {
  // Handler code
}, {
  pollInterval: 60000, // Check every 60 seconds
  label: "important", // Only emails with this label
});
```

### **3.3 Schedule (Time-based)**
Triggers execute on **cron schedule**.

**Examples:** Daily reports, cleanup tasks

**Flow:**
1. VoltOps scheduler evaluates cron expression
2. When time matches, executes trigger handler
3. No external event needed

**Configuration:**
```typescript
on.cron.schedule(async ({ agents }) => {
  await agents.reportAgent.generateDailyReport();
}, {
  expression: "0 9 * * *", // Every day at 9 AM
  timezone: "America/New_York",
});
```

---

## 4. Real-World Example: Slack Agent

Here's VoltAgent's complete Slack integration example:

```typescript
import { openai } from "@ai-sdk/openai";
import { Agent, VoltAgent, createTool, createTriggers } from "@voltagent/core";
import { VoltOpsClient } from "@voltagent/sdk";
import { honoServer } from "@voltagent/server-hono";
import { z } from "zod";

// Define Slack message structure
type SlackMessagePayload = {
  channel?: string;
  thread_ts?: string;
  ts?: string;
  text?: string;
  user?: string;
};

// VoltOps client for calling Actions
const voltOps = new VoltOpsClient({
  publicKey: process.env.VOLTAGENT_PUBLIC_KEY!,
  secretKey: process.env.VOLTAGENT_SECRET_KEY!,
});

// Tool: Send Slack message (Action)
const sendSlackMessage = createTool({
  name: "sendSlackMessage",
  description: "Send a message to a Slack channel or thread.",
  parameters: z.object({
    channelId: z.string(),
    text: z.string(),
    threadTs: z.string().optional(),
  }),
  execute: async ({ channelId, text, threadTs }) => {
    return await voltOps.actions.slack.postMessage({
      credential: { credentialId: process.env.SLACK_CREDENTIAL_ID! },
      channelId,
      text,
      threadTs,
    });
  },
});

// Define agent
const slackAgent = new Agent({
  name: "slack-agent",
  instructions: "You are a Slack assistant. Reply to messages and answer questions.",
  tools: [sendSlackMessage],
  model: openai("gpt-4o-mini"),
});

// Wire everything together
new VoltAgent({
  agents: { slackAgent },
  server: honoServer(),
  
  // Register triggers
  triggers: createTriggers((on) => {
    on.slack.messagePosted(async ({ payload, agents }) => {
      const event = (payload as SlackMessagePayload | undefined) ?? {};
      const { channel, thread_ts, ts, text, user } = event;

      if (!channel || !text) {
        return; // Skip invalid events
      }

      // Generate response
      await agents.slackAgent.generateText(
        `Slack channel: ${channel}\n` +
        `Thread: ${thread_ts ?? ts}\n` +
        `User: <@${user}>\n` +
        `Message: ${text}\n` +
        `Respond in Slack via sendSlackMessage.`
      );
    });
  }),
});
```

**What Happens:**
1. User sends message in Slack → Slack API → VoltAgent endpoint
2. Trigger handler extracts channel, text, user
3. Agent processes message with GPT-4
4. Agent calls `sendSlackMessage` tool
5. VoltOps sends reply via Slack API

---

## 5. Comparison: Loom's Current State

### **What Loom Has**

1. **BullMQ Message Queue** - For actor-to-actor messaging
2. **HTTP Server** (via `packages/loom-server`) - Basic REST API
3. **WASM Activities** - Sandboxed execution
4. **Journal-Based Durability** - Replay capability

### **What Loom is Missing**

1. ❌ **No external event integration** - Actors can only message each other
2. ❌ **No webhook handling** - No way to receive HTTP events
3. ❌ **No OAuth/credential management** - Every integration is manual
4. ❌ **No pre-built connectors** - No Slack, GitHub, Gmail helpers
5. ❌ **No polling system** - Can't check external services periodically
6. ❌ **No cron/scheduling** - No time-based triggers

### **Current Workaround (Manual)**

Today, to integrate Slack with Loom, you'd need to:

```typescript
// 1. Manually set up Express server
import express from 'express';
import { createHmac } from 'crypto';

const app = express();

// 2. Manually handle Slack webhook
app.post('/slack/events', async (req, res) => {
  // 3. Manually verify Slack signature
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  // ... 20 lines of verification code ...
  
  // 4. Manually parse event
  const { event } = req.body;
  
  // 5. Manually trigger actor
  const runtime = new LongLivedActorRuntime({ ... });
  await runtime.execute('slack-agent-1', async (actor) => {
    await actor.handleMessage(event.text);
  });
  
  res.send({ ok: true });
});

app.listen(3000);
```

**Problems:**
- 100+ lines of boilerplate per integration
- No type safety
- Manual OAuth handling
- No retry logic
- No credential management
- Reinvent the wheel for every new integration

---

## 6. Proposed Loom Implementation

### **6.1 Architecture Overview**

```
┌─────────────────────────────────────────────────────────────┐
│                      Loom Application                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Trigger DSL (createTriggers)               │    │
│  │  on.slack.messagePosted(...)                       │    │
│  │  on.github.star(...)                               │    │
│  │  on.http.webhook(...)                              │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                         │
│                   ▼                                         │
│  ┌────────────────────────────────────────────────────┐    │
│  │        Trigger Registry & Router                   │    │
│  │  - Maps event types to handlers                    │    │
│  │  - Validates payloads                              │    │
│  │  - Generates HTTP routes                           │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                         │
│                   ▼                                         │
│  ┌────────────────────────────────────────────────────┐    │
│  │        HTTP Server (Hono/Express)                  │    │
│  │  POST /triggers/slack/messagePosted                │    │
│  │  POST /triggers/github/star                        │    │
│  │  POST /triggers/http/webhook/:id                   │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                         │
└───────────────────┼─────────────────────────────────────────┘
                    │
                    │ External Events
                    ▼
┌──────────────────────────────────────────────────────────────┐
│              External Event Sources                          │
├──────────────────────────────────────────────────────────────┤
│  📨 Slack Events API    🐙 GitHub Webhooks                   │
│  📧 Gmail (polling)     🗓️ Cron Scheduler                     │
│  📊 Airtable (polling)  🌐 HTTP Webhooks                     │
└──────────────────────────────────────────────────────────────┘
```

### **6.2 Implementation Plan**

#### **Phase 1: Core Trigger System** (2-3 days)

**Files to Create:**
- `src/triggers/types.ts` - Type definitions
- `src/triggers/registry.ts` - Trigger registration
- `src/triggers/dsl.ts` - DSL builder
- `src/triggers/catalog.ts` - Event catalog

**Core Types:**
```typescript
// src/triggers/types.ts

export interface TriggerDefinition {
  key: string; // "slack.messagePosted"
  provider: string; // "slack"
  displayName: string;
  description: string;
  deliveryMode: "webhook" | "polling" | "schedule";
}

export interface TriggerHandler<TPayload = unknown> {
  handler: (context: TriggerContext<TPayload>) => Promise<void>;
  definition: TriggerDefinition;
}

export interface TriggerContext<TPayload = unknown> {
  payload: TPayload;
  metadata: {
    provider: string;
    triggerKey: string;
    deliveryId: string;
    timestamp: string;
  };
  headers: Record<string, string>;
  actors: Record<string, any>; // Access to registered actors
  logger: Logger;
}

export type TriggerHandlerFn<TPayload = unknown> = (
  context: TriggerContext<TPayload>
) => Promise<void>;
```

**DSL Implementation:**
```typescript
// src/triggers/dsl.ts

import { TRIGGER_CATALOG } from './catalog';

export type TriggerConfig = {
  [key: string]: TriggerHandlerFn;
};

export function createTriggers(
  builder: (on: TriggerDsl) => void
): TriggerConfig {
  const registry: TriggerConfig = {};
  
  // Create proxy for type-safe DSL
  const dsl = new Proxy({} as TriggerDsl, {
    get(_, providerKey: string) {
      return new Proxy({}, {
        get(_, eventName: string) {
          const eventKey = `${providerKey}.${eventName}`;
          
          // Validate against catalog
          const definition = TRIGGER_CATALOG.find(t => t.key === eventKey);
          if (!definition) {
            throw new Error(`Unknown trigger: ${eventKey}`);
          }
          
          // Return registration function
          return (handler: TriggerHandlerFn) => {
            registry[eventKey] = handler;
          };
        }
      });
    }
  });
  
  builder(dsl);
  return registry;
}
```

**Trigger Catalog:**
```typescript
// src/triggers/catalog.ts

export const TRIGGER_CATALOG: TriggerDefinition[] = [
  // HTTP Webhooks
  {
    key: "http.webhook",
    provider: "http",
    displayName: "HTTP Webhook",
    description: "Receive HTTP POST requests",
    deliveryMode: "webhook",
  },
  
  // Slack (webhook-based)
  {
    key: "slack.messagePosted",
    provider: "slack",
    displayName: "Slack Message Posted",
    description: "Triggered when a message is posted to a channel",
    deliveryMode: "webhook",
  },
  {
    key: "slack.appMention",
    provider: "slack",
    displayName: "Slack App Mention",
    description: "Triggered when your app is mentioned",
    deliveryMode: "webhook",
  },
  
  // GitHub (webhook-based)
  {
    key: "github.star",
    provider: "github",
    displayName: "GitHub Star",
    description: "Triggered when repository is starred",
    deliveryMode: "webhook",
  },
  {
    key: "github.pullRequest",
    provider: "github",
    displayName: "GitHub Pull Request",
    description: "Triggered when pull request is opened/updated",
    deliveryMode: "webhook",
  },
  
  // Cron (schedule-based)
  {
    key: "cron.schedule",
    provider: "cron",
    displayName: "Cron Schedule",
    description: "Triggered on cron schedule",
    deliveryMode: "schedule",
  },
];
```

#### **Phase 2: HTTP Route Integration** (1-2 days)

**Extend Loom Server:**
```typescript
// packages/loom-server/src/trigger-routes.ts

import { Hono } from 'hono';
import type { TriggerConfig } from '@loom/core/triggers';

export function registerTriggerRoutes(
  app: Hono,
  triggers: TriggerConfig,
  actorRuntime: ActorRuntime
) {
  // Generate routes from trigger registry
  Object.entries(triggers).forEach(([eventKey, handler]) => {
    const [provider, event] = eventKey.split('.');
    const path = `/triggers/${provider}/${event}`;
    
    app.post(path, async (c) => {
      const body = await c.req.json();
      const headers = Object.fromEntries(c.req.raw.headers.entries());
      
      const context: TriggerContext = {
        payload: body,
        metadata: {
          provider,
          triggerKey: eventKey,
          deliveryId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        },
        headers,
        actors: actorRuntime.getActors(),
        logger: console, // Use proper logger
      };
      
      try {
        await handler(context);
        return c.json({ success: true });
      } catch (error) {
        console.error('Trigger handler failed:', error);
        return c.json({ success: false, error: error.message }, 500);
      }
    });
    
    console.log(`✓ Registered trigger: POST ${path}`);
  });
}
```

**Update Main Server:**
```typescript
// packages/loom-server/src/index.ts

import { Hono } from 'hono';
import { createTriggers } from '@loom/core/triggers';
import { registerTriggerRoutes } from './trigger-routes';

const app = new Hono();

// User-defined triggers
const triggers = createTriggers((on) => {
  on.slack.messagePosted(async ({ payload, actors }) => {
    const { channel, text } = payload;
    await actors.slackAgent.execute(async (agent) => {
      await agent.handleMessage(text);
    });
  });
  
  on.http.webhook(async ({ payload, actors }) => {
    await actors.webhookHandler.execute(async (handler) => {
      await handler.process(payload);
    });
  });
});

// Register trigger routes
registerTriggerRoutes(app, triggers, actorRuntime);

app.listen(3000);
```

#### **Phase 3: Webhook Verification** (1 day)

**Add provider-specific verification:**
```typescript
// src/triggers/verifiers/slack.ts

import crypto from 'crypto';

export function verifySlackSignature(
  body: string,
  signature: string,
  timestamp: string,
  signingSecret: string
): boolean {
  // Reject old requests (replay attack prevention)
  const requestTimestamp = parseInt(timestamp, 10);
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - (60 * 5);
  
  if (requestTimestamp < fiveMinutesAgo) {
    throw new Error('Request timestamp too old');
  }
  
  // Verify signature
  const baseString = `v0:${timestamp}:${body}`;
  const expectedSignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(baseString)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

```typescript
// src/triggers/verifiers/github.ts

import crypto from 'crypto';

export function verifyGitHubSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

**Integrate verifiers:**
```typescript
// packages/loom-server/src/trigger-routes.ts

import { verifySlackSignature } from '@loom/core/triggers/verifiers/slack';
import { verifyGitHubSignature } from '@loom/core/triggers/verifiers/github';

export function registerTriggerRoutes(app, triggers, actorRuntime) {
  Object.entries(triggers).forEach(([eventKey, handler]) => {
    const [provider, event] = eventKey.split('.');
    const path = `/triggers/${provider}/${event}`;
    
    app.post(path, async (c) => {
      const body = await c.req.text(); // Get raw body for signature verification
      const headers = Object.fromEntries(c.req.raw.headers.entries());
      
      // Verify signatures
      if (provider === 'slack') {
        const isValid = verifySlackSignature(
          body,
          headers['x-slack-signature'],
          headers['x-slack-request-timestamp'],
          process.env.SLACK_SIGNING_SECRET!
        );
        if (!isValid) {
          return c.json({ error: 'Invalid signature' }, 401);
        }
      }
      
      if (provider === 'github') {
        const isValid = verifyGitHubSignature(
          body,
          headers['x-hub-signature-256'],
          process.env.GITHUB_WEBHOOK_SECRET!
        );
        if (!isValid) {
          return c.json({ error: 'Invalid signature' }, 401);
        }
      }
      
      const payload = JSON.parse(body);
      
      // ... rest of handler
    });
  });
}
```

#### **Phase 4: Polling System** (2-3 days)

For services without webhooks (Gmail, Airtable), implement polling:

```typescript
// src/triggers/poller.ts

export interface PollingConfig {
  interval: number; // milliseconds
  handler: TriggerHandlerFn;
  fetcher: () => Promise<any[]>; // Function to fetch new events
  getEventId: (event: any) => string; // Extract unique ID
}

export class TriggerPoller {
  private intervals = new Map<string, NodeJS.Timeout>();
  private processedEvents = new Set<string>();
  
  register(triggerKey: string, config: PollingConfig) {
    // Clear existing interval if any
    this.stop(triggerKey);
    
    const interval = setInterval(async () => {
      try {
        const events = await config.fetcher();
        
        for (const event of events) {
          const eventId = config.getEventId(event);
          
          // Skip already processed events
          if (this.processedEvents.has(eventId)) {
            continue;
          }
          
          // Process new event
          await config.handler({
            payload: event,
            metadata: {
              provider: triggerKey.split('.')[0],
              triggerKey,
              deliveryId: eventId,
              timestamp: new Date().toISOString(),
            },
            headers: {},
            actors: {},
            logger: console,
          });
          
          // Mark as processed
          this.processedEvents.add(eventId);
          
          // Clean up old IDs (keep last 1000)
          if (this.processedEvents.size > 1000) {
            const first = this.processedEvents.values().next().value;
            this.processedEvents.delete(first);
          }
        }
      } catch (error) {
        console.error(`Polling error for ${triggerKey}:`, error);
      }
    }, config.interval);
    
    this.intervals.set(triggerKey, interval);
  }
  
  stop(triggerKey: string) {
    const interval = this.intervals.get(triggerKey);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(triggerKey);
    }
  }
  
  stopAll() {
    this.intervals.forEach((interval) => clearInterval(interval));
    this.intervals.clear();
  }
}
```

**Example: Gmail Polling:**
```typescript
// src/triggers/pollers/gmail.ts

import { google } from 'googleapis';

export function createGmailPoller(config: {
  credentials: any;
  label: string;
  interval: number;
}) {
  const gmail = google.gmail({ version: 'v1', auth: config.credentials });
  
  return {
    interval: config.interval,
    fetcher: async () => {
      const response = await gmail.users.messages.list({
        userId: 'me',
        labelIds: [config.label],
        maxResults: 10,
      });
      
      const messages = response.data.messages || [];
      const fullMessages = await Promise.all(
        messages.map(m => 
          gmail.users.messages.get({ userId: 'me', id: m.id! })
        )
      );
      
      return fullMessages.map(m => m.data);
    },
    getEventId: (message: any) => message.id,
  };
}
```

#### **Phase 5: Cron/Schedule Support** (1-2 days)

```typescript
// src/triggers/scheduler.ts

import cron from 'node-cron';

export class TriggerScheduler {
  private tasks = new Map<string, cron.ScheduledTask>();
  
  register(triggerKey: string, expression: string, handler: TriggerHandlerFn) {
    // Validate cron expression
    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression: ${expression}`);
    }
    
    // Stop existing task if any
    this.stop(triggerKey);
    
    const task = cron.schedule(expression, async () => {
      try {
        await handler({
          payload: {},
          metadata: {
            provider: 'cron',
            triggerKey,
            deliveryId: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
          },
          headers: {},
          actors: {},
          logger: console,
        });
      } catch (error) {
        console.error(`Cron error for ${triggerKey}:`, error);
      }
    });
    
    this.tasks.set(triggerKey, task);
  }
  
  stop(triggerKey: string) {
    const task = this.tasks.get(triggerKey);
    if (task) {
      task.stop();
      this.tasks.delete(triggerKey);
    }
  }
  
  stopAll() {
    this.tasks.forEach(task => task.stop());
    this.tasks.clear();
  }
}
```

---

## 7. Final API Design for Loom

```typescript
import { createLoomRuntime } from '@loom/core';
import { createTriggers } from '@loom/triggers';

const runtime = createLoomRuntime({
  actors: {
    slackAgent,
    webhookHandler,
    emailProcessor,
  },
  
  triggers: createTriggers((on) => {
    // HTTP Webhooks (instant)
    on.http.webhook(async ({ payload, actors }) => {
      await actors.webhookHandler.process(payload);
    });
    
    // Slack Events (webhook)
    on.slack.messagePosted(async ({ payload, actors }) => {
      const { channel, text, user } = payload;
      await actors.slackAgent.handleMessage(text, { channel, user });
    });
    
    // GitHub Events (webhook)
    on.github.star(async ({ payload, actors }) => {
      const { sender, repository } = payload;
      console.log(`${sender.login} starred ${repository.name}`);
    });
    
    // Gmail (polling)
    on.gmail.emailReceived(async ({ payload, actors }) => {
      const { subject, from, body } = payload;
      await actors.emailProcessor.process({ subject, from, body });
    }, {
      pollInterval: 60000, // Check every minute
      label: 'important',
    });
    
    // Cron (schedule)
    on.cron.schedule(async ({ actors }) => {
      await actors.reportGenerator.generateDaily();
    }, {
      expression: '0 9 * * *', // 9 AM daily
      timezone: 'America/New_York',
    });
  }),
});

// Server automatically exposes:
// POST /triggers/http/webhook
// POST /triggers/slack/messagePosted
// POST /triggers/github/star
```

---

## 8. Benefits for Loom

### **Developer Experience**
- ✅ **90% less boilerplate** - No manual webhook setup
- ✅ **Type-safe** - Compile-time validation
- ✅ **Consistent API** - Same pattern for all integrations

### **Production Ready**
- ✅ **Signature verification** - Built-in security
- ✅ **Retry logic** - Automatic failure handling
- ✅ **Dead letter queues** - Failed events preserved
- ✅ **Observability** - All triggers traced

### **Ecosystem**
- ✅ **Pre-built connectors** - Slack, GitHub, Gmail, etc.
- ✅ **Extensible** - Easy to add new triggers
- ✅ **Standards-based** - Use industry-standard webhooks

---

## 9. Estimated Implementation Effort

| Phase | Description | Lines of Code | Time |
|-------|-------------|---------------|------|
| 1 | Core trigger system (types, DSL, catalog) | ~300 | 2-3 days |
| 2 | HTTP route integration | ~200 | 1-2 days |
| 3 | Webhook verification (Slack, GitHub) | ~100 | 1 day |
| 4 | Polling system (Gmail, Airtable) | ~400 | 2-3 days |
| 5 | Cron/scheduler | ~150 | 1-2 days |
| **Total** | **Complete trigger system** | **~1,150** | **7-11 days** |

---

## 10. Next Steps

1. **Review this design** with the team
2. **Prioritize integrations**:
   - Start with HTTP webhooks (simplest)
   - Add Slack (most common)
   - Add GitHub (developer favorite)
   - Add cron (essential utility)
3. **Create `@loom/triggers` package**
4. **Update `@loom/server` to integrate triggers**
5. **Write examples and docs**
6. **Ship v2.0 with triggers** 🚀

---

## Conclusion

VoltAgent's trigger system is a **production-grade abstraction** that eliminates 90% of the boilerplate for integrating external events. By implementing a similar system in Loom, we can:

- **Compete directly** with VoltAgent on ease-of-use
- **Maintain our advantages** (journal-based durability, WASM, distributed coordination)
- **Enable real-world AI agents** that respond to Slack, GitHub, email, etc.
- **Reduce time-to-production** from weeks to hours

The implementation is **straightforward** (~1,150 lines) and can be completed in **1-2 weeks**. The ROI is **massive** - this single feature will unlock entire categories of AI agent use cases that are currently too painful to build with Loom.

**Recommendation**: Make this **Phase 1** of the VoltAgent feature adoption roadmap. It's the foundation that all other features (RAG, Connectors, etc.) will build on.
