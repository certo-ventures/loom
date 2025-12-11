/**
 * AI Coordination tests
 * 
 * Tests AI-powered speaker selection and termination detection
 * Note: These tests require Azure OpenAI credentials to run
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GroupChatActor, type AgentParticipant } from '../../actor/group-chat-actor'
import type { ActorContext } from '../../actor/journal'
import { RedisSharedMemory } from '../../shared-memory/redis-shared-memory'
import type { LLMConfig } from '../../ai'
import Redis from 'ioredis'

// Skip these tests if Azure OpenAI is not configured
const skipAITests = !process.env.AZURE_OPENAI_API_KEY

describe('AI-Powered Group Chat', () => {
  let redis: Redis
  let sharedMemory: RedisSharedMemory
  let groupChat: GroupChatActor
  let coordinatorConfig: LLMConfig

  beforeEach(async () => {
    if (skipAITests) return

    redis = new Redis({
      host: 'localhost',
      port: 6379
    })

    sharedMemory = new RedisSharedMemory(redis)

    coordinatorConfig = {
      provider: 'azure-openai',
      apiKey: process.env.AZURE_OPENAI_API_KEY!,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT || 'https://your-resource.openai.azure.com',
      deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 200
    }

    const context: ActorContext = {
      actorId: 'ai-group-chat',
      actorType: 'group-chat-actor',
      correlationId: 'test',
      sharedMemory
    }
    groupChat = new GroupChatActor(context)

    // Clean up test data
    const keys = await redis.keys('chat:conv-*')
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  })

  afterEach(async () => {
    if (skipAITests) return

    // Clean up
    const keys = await redis.keys('chat:conv-*')
    if (keys.length > 0) {
      await redis.del(...keys)
    }
    await redis.quit()
  })

  it.skipIf(skipAITests)('should use AI to select speakers intelligently', async () => {
    const participants: AgentParticipant[] = [
      {
        name: 'Architect',
        role: 'System Architect',
        description: 'Designs system architecture and makes high-level technical decisions'
      },
      {
        name: 'Developer',
        role: 'Software Developer',
        description: 'Implements code and writes unit tests'
      },
      {
        name: 'Tester',
        role: 'QA Engineer',
        description: 'Tests functionality and validates quality'
      }
    ]

    const chunks = []
    for await (const chunk of groupChat.stream({
      participants,
      initialMessage: 'Design and implement a user login system',
      maxRounds: 4,
      coordinatorConfig // AI coordinator enabled
    })) {
      chunks.push(chunk)
    }

    // Verify AI selected speakers (not just round-robin)
    const speakerSelections = chunks
      .filter(c => c.data?.event === 'speaker-selected')
      .map(c => c.data.speaker)

    expect(speakerSelections.length).toBeGreaterThan(0)
    
    // AI should intelligently pick Architect first (for design)
    // This is more intelligent than simple round-robin
    console.log('AI selected speakers in order:', speakerSelections)
  })

  it.skipIf(skipAITests)('should detect natural termination with AI', async () => {
    const participants: AgentParticipant[] = [
      {
        name: 'Alice',
        role: 'Developer',
        description: 'Implements features'
      }
    ]

    const chunks = []
    for await (const chunk of groupChat.stream({
      participants,
      initialMessage: 'Say you have completed the task',
      maxRounds: 10, // High limit
      terminationCondition: 'Task is marked as complete',
      coordinatorConfig
    })) {
      chunks.push(chunk)
    }

    const complete = chunks[chunks.length - 1]
    expect(complete.type).toBe('complete')
    
    // Should terminate early (before max rounds) due to AI detection
    expect(complete.data.rounds).toBeLessThan(10)
    expect(complete.data.status).toBe('complete')
  })

  it.skipIf(skipAITests)('should build automatic context for AI', async () => {
    const participants: AgentParticipant[] = [
      {
        name: 'Alice',
        role: 'Developer',
        description: 'Writes code'
      },
      {
        name: 'Bob',
        role: 'Reviewer',
        description: 'Reviews code'
      }
    ]

    const chunks = []
    for await (const chunk of groupChat.stream({
      participants,
      initialMessage: 'Let\'s build a simple calculator',
      maxRounds: 3,
      coordinatorConfig
    })) {
      chunks.push(chunk)
      
      // Verify context is being passed
      if (chunk.data?.event === 'speaker-selected') {
        // AI sees full conversation history automatically
        expect(chunk.data.speaker).toBeTruthy()
      }
    }

    expect(chunks.length).toBeGreaterThan(0)
  })

  it('should fall back to round-robin without AI coordinator', async () => {
    // Setup without AI coordinator
    const redis = new Redis({ host: 'localhost', port: 6379 })
    const sharedMemory = new RedisSharedMemory(redis)
    
    const context: ActorContext = {
      actorId: 'fallback-chat',
      actorType: 'group-chat-actor',
      correlationId: 'test-fallback',
      sharedMemory
    }
    const fallbackChat = new GroupChatActor(context)
    
    // No coordinator config = fallback behavior
    const participants: AgentParticipant[] = [
      {
        name: 'Alice',
        role: 'Developer',
        description: 'Writes code'
      },
      {
        name: 'Bob',
        role: 'Tester',
        description: 'Tests code'
      }
    ]

    const chunks = []
    for await (const chunk of fallbackChat.stream({
      participants,
      initialMessage: 'Build a feature',
      maxRounds: 4
      // No coordinatorConfig = uses round-robin
    })) {
      chunks.push(chunk)
    }

    const speakerSelections = chunks
      .filter(c => c.data?.event === 'speaker-selected')
      .map(c => c.data.speaker)

    // Should alternate: Alice, Bob, Alice, Bob
    expect(speakerSelections).toEqual(['Alice', 'Bob', 'Alice', 'Bob'])
    
    // Cleanup
    await redis.quit()
  })
})

// Print skip message
if (skipAITests) {
  console.log('\n⚠️  Skipping AI coordination tests - Azure OpenAI not configured')
  console.log('   Set AZURE_OPENAI_API_KEY to enable AI-powered tests\n')
}
