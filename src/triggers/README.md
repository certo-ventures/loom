# Event-Driven Triggers

Zero-polling, real-time actor invocation via webhooks, Azure Web PubSub, and message queues.

## Philosophy

- **No Polling**: Pure push-based events
- **Generic**: Works with any event source
- **Verified**: Built-in signature verification
- **Fast**: <1ms actor invocation overhead
- **~400 lines total**

## Quick Start

```typescript
import { WebhookAdapter, TriggeredActorRuntime } from '@loom/triggers'
import { MyActor } from './actors'

// Create runtime
const runtime = new TriggeredActorRuntime({
  actorRegistry: new Map([['my-actor', MyActor]]),
  configResolver: config,
})

// Register webhook trigger
const webhook = new WebhookAdapter({
  port: 3000,
  path: '/webhooks/events',
  secret: 'webhook-secret',
})

runtime.registerTrigger('my-trigger', {
  adapter: webhook,
  actorType: 'my-actor',
  filter: (event) => event.type === 'important',
})

// Start listening
await runtime.start()
```

## Supported Adapters

### HTTP Webhooks
```typescript
const webhook = new WebhookAdapter({
  port: 3000,
  path: '/webhooks/github',
  secret: process.env.GITHUB_WEBHOOK_SECRET,
})
```

### GitHub Webhooks
```typescript
import { createGitHubWebhook } from '@loom/triggers/webhook'

const github = createGitHubWebhook({
  port: 3000,
  path: '/webhooks/github',
  secret: process.env.GITHUB_WEBHOOK_SECRET,
})
```

### Slack Events
```typescript
import { createSlackWebhook } from '@loom/triggers/webhook'

const slack = createSlackWebhook({
  port: 3000,
  path: '/slack/events',
  secret: process.env.SLACK_SIGNING_SECRET,
})
```

### Azure Web PubSub
```typescript
import { AzureWebPubSubAdapter } from '@loom/triggers/azure-webpubsub'

const pubsub = new AzureWebPubSubAdapter({
  endpoint: process.env.AZURE_WEBPUBSUB_ENDPOINT!,
  accessKey: process.env.AZURE_WEBPUBSUB_KEY!,
  hub: 'actor-events',
  port: 8080,
})
```

## Event Filtering

```typescript
runtime.registerTrigger('github-prs', {
  adapter: githubWebhook,
  actorType: 'pr-reviewer',
  
  // Only trigger for opened PRs
  filter: (event) => 
    event.type === 'pull_request' && 
    event.metadata?.action === 'opened',
})
```

## Event Transformation

```typescript
runtime.registerTrigger('slack-commands', {
  adapter: slackWebhook,
  actorType: 'command-handler',
  
  // Transform event data before actor invocation
  transform: (event) => ({
    command: event.data.text.split(' ')[0],
    args: event.data.text.split(' ').slice(1),
    userId: event.data.user,
  }),
})
```

## Signature Verification

### Automatic (HMAC-SHA256)
```typescript
const webhook = new WebhookAdapter({
  port: 3000,
  path: '/webhooks',
  secret: 'my-secret',  // Automatic verification
})
```

### Custom Verification
```typescript
const webhook = new WebhookAdapter({
  port: 3000,
  path: '/webhooks',
  secret: 'my-secret',
  verifySignature: (payload, signature, secret) => {
    // Custom verification logic
    return myCustomVerify(payload, signature, secret)
  },
})
```

### Disable Verification (testing only)
```typescript
runtime.registerTrigger('test', {
  adapter: webhook,
  actorType: 'test-actor',
  requireVerification: false,  // ⚠️ NOT for production!
})
```

## Trigger Context

Actors receive trigger context via `this.context.triggerContext`:

```typescript
class MyActor extends Actor {
  async execute(data: any): Promise<void> {
    const trigger = (this.context as any).triggerContext
    
    console.log('Event ID:', trigger.eventId)
    console.log('Event Type:', trigger.eventType)
    console.log('Source:', trigger.source)
    console.log('Verified:', trigger.verified)
    console.log('Received at:', trigger.receivedAt)
  }
}
```

## Multiple Triggers per Actor

```typescript
// Same actor, different triggers
runtime.registerTrigger('github-trigger', {
  adapter: githubWebhook,
  actorType: 'notification-actor',
})

runtime.registerTrigger('slack-trigger', {
  adapter: slackWebhook,
  actorType: 'notification-actor',
})
```

## Error Handling

Actors automatically handle errors:

```typescript
class ResilientActor extends Actor {
  async execute(data: any): Promise<void> {
    try {
      // Process event
      await this.processEvent(data)
    } catch (error) {
      // Error automatically captured in TriggerResult
      this.updateState({ error: error.message })
      throw error  // Propagates to trigger system
    }
  }
}
```

## Performance

Based on test results:

- **Actor invocation overhead**: <1ms
- **Concurrent events**: 5 events in 0ms average
- **Memory**: Minimal (actors cleaned up after execution)
- **Throughput**: Thousands of events per second

## Production Deployment

### Environment Variables
```bash
# Webhooks
GITHUB_WEBHOOK_SECRET=your-secret-here
SLACK_SIGNING_SECRET=your-secret-here
WEBHOOK_PORT=3000

# Azure Web PubSub
AZURE_WEBPUBSUB_ENDPOINT=https://your-resource.webpubsub.azure.com
AZURE_WEBPUBSUB_KEY=your-access-key
WEBPUBSUB_HUB=actor-events
```

### Docker Compose
```yaml
services:
  loom-triggers:
    image: loom-actor-runtime
    ports:
      - "3000:3000"  # Webhooks
      - "8080:8080"  # Web PubSub
    environment:
      - GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
      - AZURE_WEBPUBSUB_ENDPOINT=${AZURE_WEBPUBSUB_ENDPOINT}
      - REDIS_HOST=redis
    depends_on:
      - redis
```

### Health Checks
```bash
# Webhook health
curl http://localhost:3000/health
# Response: {"status":"healthy","adapter":"http-webhook"}

# Web PubSub health
curl http://localhost:8080/health
# Response: {"status":"healthy","adapter":"azure-web-pubsub"}
```

## Examples

### GitHub PR Review Bot
```typescript
class PRReviewActor extends AIActor {
  async execute(pr: any): Promise<void> {
    await this.initializeLLMFromConfig('azure-openai')
    
    const review = await this.chat([
      { role: 'system', content: 'You are a code reviewer.' },
      { role: 'user', content: `Review: ${pr.title}` },
    ])
    
    // Post review comment via GitHub API
    await this.postGitHubComment(pr.number, review)
  }
}
```

### Slack Bot
```typescript
class SlackBotActor extends AIActor {
  async execute(message: any): Promise<void> {
    await this.initializeLLMFromConfig('azure-openai')
    
    const reply = await this.chat([
      { role: 'system', content: 'You are a helpful Slack bot.' },
      { role: 'user', content: message.text },
    ])
    
    await this.postSlackMessage(message.channel, reply)
  }
}
```

### Real-time Analytics
```typescript
class AnalyticsActor extends Actor {
  async execute(event: any): Promise<void> {
    // Update metrics
    await this.incrementMetric('events_processed')
    
    // Store in time series DB
    await this.recordTimeSeries({
      metric: event.type,
      value: 1,
      timestamp: Date.now(),
    })
  }
}
```

## Testing

```typescript
import { WebhookAdapter, TriggeredActorRuntime } from '@loom/triggers'

describe('Event Triggers', () => {
  let runtime: TriggeredActorRuntime
  
  beforeEach(async () => {
    runtime = new TriggeredActorRuntime({
      actorRegistry: new Map([['test', TestActor]]),
    })
    
    const webhook = new WebhookAdapter({
      port: 3333,
      path: '/test',
    })
    
    runtime.registerTrigger('test', {
      adapter: webhook,
      actorType: 'test',
    })
    
    await runtime.start()
  })
  
  afterEach(async () => {
    await runtime.stop()
  })
  
  it('invokes actor on webhook', async () => {
    const response = await fetch('http://localhost:3333/test', {
      method: 'POST',
      body: JSON.stringify({ data: 'test' }),
    })
    
    const result = await response.json()
    expect(result.success).toBe(true)
  })
})
```

## Monitoring

Track trigger performance:

```typescript
runtime.onTrigger('my-trigger', async (event, context) => {
  const startTime = Date.now()
  
  // Process event
  const result = await runtime.invokeActor(actorType, event, context)
  
  // Log metrics
  console.log({
    eventType: event.type,
    duration: Date.now() - startTime,
    success: result.success,
    actorId: result.actorId,
  })
  
  return result
})
```

## Architecture

```
┌─────────────────┐
│  Event Source   │ (GitHub, Slack, etc.)
└────────┬────────┘
         │ HTTP POST / WebSocket
         ▼
┌─────────────────┐
│ Trigger Adapter │ (Webhook, PubSub)
│  - Verify       │
│  - Parse        │
└────────┬────────┘
         │ TriggerEvent
         ▼
┌─────────────────┐
│ Trigger Manager │
│  - Filter       │
│  - Transform    │
└────────┬────────┘
         │ Filtered Event
         ▼
┌─────────────────┐
│ Actor Runtime   │
│  - Create Actor │
│  - Execute      │
│  - Cleanup      │
└─────────────────┘
```

## Next Steps

1. ✅ **Phase 1**: Unified LLM API + SupervisorActor
2. ✅ **Phase 2**: Event-Driven Triggers
3. ⏳ **Phase 3**: Enhanced Locks + TLS Notary
4. ⏳ **Phase 4**: RISC Zero zkVM Integration

## License

MIT
