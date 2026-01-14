/**
 * Example: Event-Driven Actor with Webhooks
 * Real-time actor invocation via HTTP webhooks
 */

import { WebhookAdapter } from '../src/triggers/webhook'
import { TriggeredActorRuntime } from '../src/triggers/runtime'
import { AIActor } from '../src/actor/ai-actor'
import type { ActorContext } from '../src/actor/journal'
import { InMemoryConfigResolver } from '../src/config-resolver'
import type { LLMConfig } from '../src/ai/llm-provider'
import * as dotenv from 'dotenv'

dotenv.config()

/**
 * GitHub PR Review Actor
 * Automatically triggered when PR is opened
 */
class GitHubPRReviewActor extends AIActor {
  async execute(prData: any): Promise<void> {
    console.log(`\n🔍 Reviewing PR #${prData.number}: ${prData.title}`)
    
    // Initialize LLM from config
    await this.initializeLLMFromConfig('azure-openai')
    
    // Review the PR with AI
    const review = await this.chat([
      {
        role: 'system',
        content: 'You are a senior software engineer doing code review. Be constructive and brief.',
      },
      {
        role: 'user',
        content: `Review this pull request:
Title: ${prData.title}
Description: ${prData.body || 'No description'}

Provide 2-3 key points for review.`,
      },
    ])
    
    console.log('💬 Review:', review)
    
    this.updateState(draft => {
      draft.prNumber = prData.number
      draft.review = review
      draft.reviewedAt = new Date().toISOString()
    })
  }
}

/**
 * Slack Message Actor
 * Triggered by Slack events
 */
class SlackMessageActor extends AIActor {
  async execute(slackEvent: any): Promise<void> {
    console.log(`\n💬 Processing Slack message: "${slackEvent.text}"`)
    
    await this.initializeLLMFromConfig('azure-openai')
    
    // Generate smart reply
    const reply = await this.chat([
      {
        role: 'system',
        content: 'You are a helpful Slack bot. Reply concisely and friendly.',
      },
      {
        role: 'user',
        content: slackEvent.text,
      },
    ])
    
    console.log('🤖 Reply:', reply)
    
    this.updateState(draft => {
      draft.messageTs = slackEvent.ts
      draft.reply = reply
      draft.repliedAt = new Date().toISOString()
    })
  }
}

async function runExample() {
  console.log('🚀 Event-Driven Actor System\n')
  
  // Setup config
  const config = new InMemoryConfigResolver()
  await config.set('global/azure-openai', {
    provider: 'azure-openai',
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    model: process.env.AZURE_OPENAI_DEPLOYMENT!,
    temperature: 0.7,
    maxTokens: 200,
  } as LLMConfig)
  
  // Create runtime
  const runtime = new TriggeredActorRuntime({
    actorRegistry: new Map([
      ['github-pr-review', GitHubPRReviewActor],
      ['slack-message', SlackMessageActor],
    ]),
    configResolver: config,
    environment: 'dev',
  })
  
  // Register GitHub webhook trigger
  const githubWebhook = new WebhookAdapter({
    port: 3000,
    path: '/webhooks/github',
    secret: 'github-webhook-secret',
    parseEvent: (body, headers) => ({
      id: headers['x-github-delivery'] || crypto.randomUUID(),
      type: headers['x-github-event'] || 'unknown',
      source: 'github',
      timestamp: new Date().toISOString(),
      data: body.pull_request || body,
      metadata: { action: body.action },
    }),
  })
  
  runtime.registerTrigger('github-pr', {
    adapter: githubWebhook,
    actorType: 'github-pr-review',
    filter: (event) => event.type === 'pull_request' && event.metadata?.action === 'opened',
  })
  
  // Register Slack webhook trigger
  const slackWebhook = new WebhookAdapter({
    port: 3001,
    path: '/webhooks/slack',
    secret: 'slack-signing-secret',
    parseEvent: (body) => ({
      id: body.event_id || crypto.randomUUID(),
      type: body.type || 'message',
      source: 'slack',
      timestamp: new Date().toISOString(),
      data: body.event || body,
      metadata: { teamId: body.team_id },
    }),
  })
  
  runtime.registerTrigger('slack-msg', {
    adapter: slackWebhook,
    actorType: 'slack-message',
    filter: (event) => event.type === 'message' && !event.data.bot_id,
  })
  
  // Start runtime
  await runtime.start()
  
  console.log('✅ Runtime started!')
  console.log('📡 GitHub webhook: http://localhost:3000/webhooks/github')
  console.log('📡 Slack webhook: http://localhost:3001/webhooks/slack')
  console.log('\n🧪 Test with curl:\n')
  console.log('# GitHub PR opened:')
  console.log(`curl -X POST http://localhost:3000/webhooks/github \\
  -H "Content-Type: application/json" \\
  -H "X-GitHub-Event: pull_request" \\
  -d '{"action":"opened","pull_request":{"number":42,"title":"Add new feature","body":"Description here"}}'`)
  console.log('\n# Slack message:')
  console.log(`curl -X POST http://localhost:3001/webhooks/slack \\
  -H "Content-Type: application/json" \\
  -d '{"type":"message","event":{"text":"Hello bot!","ts":"1234567890.123456"}}'`)
  
  // Keep running
  console.log('\n⏳ Waiting for events... (Ctrl+C to stop)')
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...')
    await runtime.stop()
    process.exit(0)
  })
}

runExample().catch(console.error)
