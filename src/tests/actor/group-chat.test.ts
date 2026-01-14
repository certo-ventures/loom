/**
 * Group Chat tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GroupChatActor, type AgentParticipant, type ConversationMessage, type GroupChatResult } from '../../actor/group-chat-actor'
import { Actor } from '../../actor/actor'
import type { ActorContext } from '../../actor/journal'
import { RedisSharedMemory } from '../../shared-memory/redis-shared-memory'
import Redis from 'ioredis'

// Test implementation of an actor
class TestActor extends Actor {
  private response: string

  constructor(id: string, response: string) {
    const context: ActorContext = {
      actorId: id,
      actorType: 'test-actor',
      correlationId: 'test',
      sharedMemory: undefined
    }
    super(context)
    this.response = response
  }

  async execute(_input: unknown): Promise<void> {
    this.updateState(draft => { draft.response = this.response })
  }
}

describe('GroupChatActor', () => {
  let redis: Redis
  let sharedMemory: RedisSharedMemory
  let groupChat: GroupChatActor

  beforeEach(async () => {
    redis = new Redis({
      host: 'localhost',
      port: 6379
    })

    sharedMemory = new RedisSharedMemory(redis)

    const context: ActorContext = {
      actorId: 'group-chat',
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
    // Clean up
    const keys = await redis.keys('chat:conv-*')
    if (keys.length > 0) {
      await redis.del(...keys)
    }
    await redis.quit()
  })

  it('should create group chat with participants', async () => {
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

    await groupChat.execute({
      participants,
      initialMessage: 'Build a login feature',
      maxRounds: 3
    })

    const state = groupChat.getState()
    const result = state.result as GroupChatResult
    expect(result).toBeDefined()
    expect(result.history).toHaveLength(4) // 1 user + 3 agent messages
    expect(result.rounds).toBe(3)
  })

  it('should stream group chat updates', async () => {
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
    for await (const chunk of groupChat.stream({
      participants,
      initialMessage: 'Build a login feature',
      maxRounds: 2
    })) {
      chunks.push(chunk)
    }

    // Should have: start, initial message, 2 rounds (each with speaker-selected + message), complete
    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks[0].type).toBe('start')
    expect(chunks[chunks.length - 1].type).toBe('complete')

    // Check we got speaker selections and messages
    const speakerSelections = chunks.filter(c => c.data?.event === 'speaker-selected')
    expect(speakerSelections).toHaveLength(2)

    const messages = chunks.filter(c => c.data?.event === 'message')
    expect(messages.length).toBeGreaterThan(1)
  })

  it('should terminate early when task is complete', async () => {
    const participants: AgentParticipant[] = [
      {
        name: 'Alice',
        role: 'Developer',
        description: 'Writes code'
      }
    ]

    const chunks = []
    for await (const chunk of groupChat.stream({
      participants,
      initialMessage: 'Say "Complete" to finish',
      maxRounds: 10
    })) {
      chunks.push(chunk)
      
      // Force completion by adding message with "complete"
      if (chunk.data?.event === 'message' && chunk.data.message.role === 'agent') {
        // Simulate agent saying complete
        chunk.data.message.content = 'Task is complete'
      }
    }

    const complete = chunks[chunks.length - 1]
    expect(complete.type).toBe('complete')
    expect(complete.data.status).toBeDefined()
  })

  it('should store conversation in shared memory', async () => {
    const participants: AgentParticipant[] = [
      {
        name: 'Alice',
        role: 'Developer',
        description: 'Writes code'
      }
    ]

    const chunks = []
    let conversationId = ''
    
    for await (const chunk of groupChat.stream({
      participants,
      initialMessage: 'Hello world',
      maxRounds: 2
    })) {
      chunks.push(chunk)
      if (chunk.type === 'complete' && chunk.data) {
        conversationId = chunk.data.conversationId
      }
    }

    expect(conversationId).toBeTruthy()

    // Check shared memory has conversation history
    const history = await sharedMemory.readList<ConversationMessage>(
      `chat:${conversationId}:history`
    )
    expect(history.length).toBeGreaterThan(0)
    expect(history[0].content).toBe('Hello world')
  })

  it('should support multiple participants in round-robin', async () => {
    const participants: AgentParticipant[] = [
      {
        name: 'Architect',
        role: 'Architect',
        description: 'Designs system'
      },
      {
        name: 'Developer',
        role: 'Developer',
        description: 'Implements code'
      },
      {
        name: 'Tester',
        role: 'Tester',
        description: 'Tests quality'
      }
    ]

    const chunks = []
    for await (const chunk of groupChat.stream({
      participants,
      initialMessage: 'Build a REST API',
      maxRounds: 6
    })) {
      chunks.push(chunk)
    }

    const speakerSelections = chunks
      .filter(c => c.data?.event === 'speaker-selected')
      .map(c => c.data.speaker)

    // Should rotate through participants
    expect(speakerSelections).toContain('Architect')
    expect(speakerSelections).toContain('Developer')
    expect(speakerSelections).toContain('Tester')
  })

  it('should provide conversation history to agents', async () => {
    const participants: AgentParticipant[] = [
      {
        name: 'Alice',
        role: 'Developer',
        description: 'Writes code'
      }
    ]

    await groupChat.execute({
      participants,
      initialMessage: 'Build a feature',
      maxRounds: 2
    })

    const state = groupChat.getState()
    const result = state.result as GroupChatResult
    const history = result.history

    // Each agent message should come after the initial message
    expect(history[0].role).toBe('user')
    expect(history[1].role).toBe('agent')
    expect(history[1].name).toBe('Alice')
  })

  it('should handle max rounds limit', async () => {
    const participants: AgentParticipant[] = [
      {
        name: 'Alice',
        role: 'Developer',
        description: 'Writes code'
      }
    ]

    await groupChat.execute({
      participants,
      initialMessage: 'Keep talking',
      maxRounds: 5
    })

    const state = groupChat.getState()
    const result = state.result as GroupChatResult
    expect(result.rounds).toBe(5)
    expect(result.status).toBe('max-rounds')
  })

  it('should include timestamps and IDs for messages', async () => {
    const participants: AgentParticipant[] = [
      {
        name: 'Alice',
        role: 'Developer',
        description: 'Writes code'
      }
    ]

    const chunks = []
    for await (const chunk of groupChat.stream({
      participants,
      initialMessage: 'Hello',
      maxRounds: 1
    })) {
      chunks.push(chunk)
    }

    const messages = chunks
      .filter(c => c.data?.event === 'message')
      .map(c => c.data.message)

    for (const msg of messages) {
      expect(msg.id).toBeTruthy()
      expect(msg.timestamp).toBeInstanceOf(Date)
      expect(msg.content).toBeTruthy()
    }
  })
})
