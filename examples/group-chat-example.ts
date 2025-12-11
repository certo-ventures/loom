/**
 * Group Chat Example - Software Development Team Collaboration
 * 
 * Demonstrates multi-agent collaboration through group chat:
 * - Architect designs system architecture
 * - Developer implements the code
 * - Tester validates quality
 * - AI coordinator selects speakers dynamically
 */

import { GroupChatActor, type AgentParticipant } from '../src/actor/group-chat-actor'
import type { ActorContext } from '../src/actor/journal'
import { RedisSharedMemory } from '../src/shared-memory/redis-shared-memory'
import Redis from 'ioredis'

async function main() {
  console.log('🎭 Group Chat Example - Software Development Team\n')

  // Setup Redis and shared memory
  const redis = new Redis({
    host: 'localhost',
    port: 6379
  })

  const sharedMemory = new RedisSharedMemory(redis)

  // Create group chat actor
  const context: ActorContext = {
    actorId: 'dev-team-chat',
    actorType: 'group-chat-actor',
    correlationId: 'example-1',
    sharedMemory
  }

  const groupChat = new GroupChatActor(context)

  // Define team members
  const team: AgentParticipant[] = [
    {
      name: 'Sarah',
      role: 'Architect',
      description: 'System architect who designs scalable solutions and defines technical requirements'
    },
    {
      name: 'Michael',
      role: 'Developer',
      description: 'Full-stack developer who implements features and writes clean, tested code'
    },
    {
      name: 'Jessica',
      role: 'Tester',
      description: 'QA engineer who validates functionality, finds bugs, and ensures quality'
    }
  ]

  console.log('Team Members:')
  team.forEach(member => {
    console.log(`  👤 ${member.name} (${member.role})`)
    console.log(`     ${member.description}`)
  })
  console.log()

  // Example 1: Build a user authentication feature
  console.log('=' .repeat(80))
  console.log('Example 1: Building User Authentication Feature')
  console.log('=' .repeat(80))
  console.log()

  console.log('💬 User: Build a secure user authentication feature with JWT tokens\n')

  let roundCount = 0
  for await (const chunk of groupChat.stream({
    participants: team,
    initialMessage: 'Build a secure user authentication feature with JWT tokens',
    maxRounds: 6
  })) {
    if (chunk.type === 'progress') {
      console.log(`📊 ${chunk.progress?.message}`)
    } else if (chunk.data?.event === 'speaker-selected') {
      const speaker = team.find(m => m.name === chunk.data.speaker)
      if (speaker) {
        console.log(`\n🎤 ${speaker.name} (${speaker.role}) is speaking...`)
      } else if (chunk.data.speaker === 'TERMINATE') {
        console.log(`\n✅ Task completed!`)
      }
    } else if (chunk.data?.event === 'message') {
      const msg = chunk.data.message
      if (msg.role === 'agent') {
        console.log(`   ${msg.name}: ${msg.content}`)
      }
    } else if (chunk.type === 'complete') {
      roundCount = chunk.data?.rounds || 0
      console.log(`\n✨ Conversation completed after ${roundCount} rounds`)
      console.log(`   Status: ${chunk.data?.status}`)
    }
  }

  // Example 2: Non-streaming mode
  console.log('\n\n' + '='.repeat(80))
  console.log('Example 2: API Rate Limiting (Non-streaming)')
  console.log('=' .repeat(80))
  console.log()

  console.log('💬 User: Implement API rate limiting to prevent abuse\n')

  await groupChat.execute({
    participants: team,
    initialMessage: 'Implement API rate limiting to prevent abuse',
    maxRounds: 4
  })

  const state = groupChat.getState()
  const result = state.result as any

  console.log('Conversation Summary:')
  console.log(`  Rounds: ${result.rounds}`)
  console.log(`  Status: ${result.status}`)
  console.log(`  Messages: ${result.history.length}`)
  console.log()

  console.log('Conversation History:')
  result.history.forEach((msg: any, idx: number) => {
    const speaker = msg.role === 'agent' ? `${msg.name} (${msg.role})` : msg.role.toUpperCase()
    const time = new Date(msg.timestamp).toLocaleTimeString()
    console.log(`  ${idx + 1}. [${time}] ${speaker}:`)
    console.log(`     ${msg.content}`)
  })

  // Example 3: Retrieve conversation from shared memory
  console.log('\n\n' + '='.repeat(80))
  console.log('Example 3: Retrieving Conversation from Shared Memory')
  console.log('=' .repeat(80))
  console.log()

  // Get conversation ID from the streaming example
  const conversationId = result.conversationId

  console.log(`Fetching conversation: ${conversationId}`)

  const storedHistory = await sharedMemory.readList<any>(
    `chat:${conversationId}:history`
  )

  console.log(`\nRetrieved ${storedHistory.length} messages from shared memory:`)
  storedHistory.slice(0, 3).forEach((msg, idx) => {
    const speaker = msg.role === 'agent' ? msg.name : msg.role.toUpperCase()
    console.log(`  ${idx + 1}. ${speaker}: ${msg.content}`)
  })

  if (storedHistory.length > 3) {
    console.log(`  ... and ${storedHistory.length - 3} more messages`)
  }

  // Example 4: Demonstrate termination detection
  console.log('\n\n' + '='.repeat(80))
  console.log('Example 4: Early Termination Detection')
  console.log('=' .repeat(80))
  console.log()

  console.log('💬 User: Say "complete" to finish quickly\n')

  for await (const chunk of groupChat.stream({
    participants: [team[0]], // Just one participant
    initialMessage: 'Say complete to finish',
    maxRounds: 10
  })) {
    if (chunk.data?.event === 'speaker-selected') {
      if (chunk.data.speaker === 'TERMINATE') {
        console.log('✅ Detected termination keyword - ending early')
      }
    } else if (chunk.type === 'complete') {
      console.log(`   Completed in ${chunk.data?.rounds} rounds (max was 10)`)
      console.log(`   Status: ${chunk.data?.status}`)
    }
  }

  // Cleanup
  console.log('\n\n🧹 Cleaning up...')
  const keys = await redis.keys('chat:conv-*')
  if (keys.length > 0) {
    await redis.del(...keys)
    console.log(`   Deleted ${keys.length} conversation keys from Redis`)
  }

  await redis.quit()
  console.log('✅ Example complete!\n')

  console.log('Key Features Demonstrated:')
  console.log('  ✅ Multi-agent collaboration with dynamic speaker selection')
  console.log('  ✅ Real-time streaming of conversation updates')
  console.log('  ✅ Conversation history stored in shared memory (Redis)')
  console.log('  ✅ Round-robin participant selection')
  console.log('  ✅ Early termination detection')
  console.log('  ✅ Both streaming and non-streaming modes')
  console.log('  ✅ Message timestamping and unique IDs')
}

main().catch(console.error)
