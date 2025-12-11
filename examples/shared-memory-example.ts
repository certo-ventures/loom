/**
 * Shared Memory Example - Multi-Agent Collaboration
 * 
 * Demonstrates how multiple agents use shared memory to coordinate:
 * - Team goal (shared key-value)
 * - Task queue (shared list)
 * - Agent status (shared hash)
 * - Conversation history (append-only list)
 */

import Redis from 'ioredis'
import { RedisSharedMemory } from '../src/shared-memory/redis-shared-memory'

async function main() {
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
  })
  
  const sharedMemory = new RedisSharedMemory(redis)
  
  // Clean up previous run
  await redis.del(
    'demo:team-alpha:goal',
    'demo:team-alpha:tasks',
    'demo:agent:researcher:status',
    'demo:agent:analyst:status',
    'demo:chat:team-alpha:history'
  )
  
  console.log('🚀 Multi-Agent Collaboration Demo\n')
  
  // ============================================================
  // 1. SET TEAM GOAL (Key-Value)
  // ============================================================
  console.log('1️⃣  Setting team goal...')
  await sharedMemory.write('demo:team-alpha:goal', {
    objective: 'Research AI market trends and provide investment recommendation',
    deadline: '2025-12-15',
    status: 'active'
  })
  console.log('   ✅ Goal set\n')
  
  // ============================================================
  // 2. CREATE TASK QUEUE (List)
  // ============================================================
  console.log('2️⃣  Creating task queue...')
  await sharedMemory.append('demo:team-alpha:tasks', {
    id: 'task-1',
    type: 'research',
    description: 'Gather AI market data',
    assignee: 'researcher',
    status: 'pending'
  })
  await sharedMemory.append('demo:team-alpha:tasks', {
    id: 'task-2',
    type: 'analysis',
    description: 'Analyze market trends',
    assignee: 'analyst',
    status: 'pending'
  })
  await sharedMemory.append('demo:team-alpha:tasks', {
    id: 'task-3',
    type: 'report',
    description: 'Write final recommendation',
    assignee: 'writer',
    status: 'pending'
  })
  
  const tasks = await sharedMemory.readList('demo:team-alpha:tasks')
  console.log(`   ✅ ${tasks.length} tasks queued\n`)
  
  // ============================================================
  // 3. AGENTS UPDATE THEIR STATUS (Hash)
  // ============================================================
  console.log('3️⃣  Agents updating status...')
  
  // Researcher agent
  await sharedMemory.hset('demo:agent:researcher:status', 'state', 'working')
  await sharedMemory.hset('demo:agent:researcher:status', 'currentTask', 'task-1')
  await sharedMemory.hset('demo:agent:researcher:status', 'progress', 0)
  console.log('   🔬 Researcher: working on task-1')
  
  // Analyst agent
  await sharedMemory.hset('demo:agent:analyst:status', 'state', 'waiting')
  await sharedMemory.hset('demo:agent:analyst:status', 'currentTask', null)
  await sharedMemory.hset('demo:agent:analyst:status', 'progress', 0)
  console.log('   📊 Analyst: waiting')
  console.log()
  
  // ============================================================
  // 4. CONVERSATION HISTORY (Append-Only List)
  // ============================================================
  console.log('4️⃣  Agents collaborating via chat...\n')
  
  await sharedMemory.append('demo:chat:team-alpha:history', {
    timestamp: new Date().toISOString(),
    role: 'agent',
    name: 'researcher',
    content: 'Starting market research. Will gather data from 3 sources.'
  })
  console.log('   🔬 Researcher: Starting market research...')
  
  // Simulate researcher progress
  await new Promise(resolve => setTimeout(resolve, 500))
  await sharedMemory.hset('demo:agent:researcher:status', 'progress', 50)
  
  await sharedMemory.append('demo:chat:team-alpha:history', {
    timestamp: new Date().toISOString(),
    role: 'agent',
    name: 'researcher',
    content: 'Found key insight: AI market growing 40% YoY. Passing data to analyst.'
  })
  console.log('   🔬 Researcher: Found key insight!')
  
  // Researcher marks task complete
  await sharedMemory.hset('demo:agent:researcher:status', 'state', 'complete')
  await sharedMemory.hset('demo:agent:researcher:status', 'progress', 100)
  
  // Analyst starts work
  await sharedMemory.hset('demo:agent:analyst:status', 'state', 'working')
  await sharedMemory.hset('demo:agent:analyst:status', 'currentTask', 'task-2')
  
  await sharedMemory.append('demo:chat:team-alpha:history', {
    timestamp: new Date().toISOString(),
    role: 'agent',
    name: 'analyst',
    content: 'Analyzing data. Strong growth pattern, but high valuations concern me.'
  })
  console.log('   📊 Analyst: Analyzing data...')
  
  await new Promise(resolve => setTimeout(resolve, 500))
  await sharedMemory.hset('demo:agent:analyst:status', 'progress', 100)
  await sharedMemory.hset('demo:agent:analyst:status', 'state', 'complete')
  
  await sharedMemory.append('demo:chat:team-alpha:history', {
    timestamp: new Date().toISOString(),
    role: 'agent',
    name: 'analyst',
    content: 'Analysis complete. Recommendation: CAUTIOUS BUY - high growth but expensive.'
  })
  console.log('   📊 Analyst: Analysis complete!\n')
  
  // ============================================================
  // 5. READ FINAL STATE
  // ============================================================
  console.log('5️⃣  Final state:\n')
  
  // Check goal
  const goal = await sharedMemory.read('demo:team-alpha:goal')
  console.log('   📋 Goal:', goal)
  
  // Check agent statuses
  const researcherStatus = await sharedMemory.hgetall('demo:agent:researcher:status')
  const analystStatus = await sharedMemory.hgetall('demo:agent:analyst:status')
  console.log('\n   👥 Agent Status:')
  console.log('      Researcher:', researcherStatus)
  console.log('      Analyst:', analystStatus)
  
  // Read full conversation
  const conversation = await sharedMemory.readList('demo:chat:team-alpha:history')
  console.log('\n   💬 Conversation History:')
  for (const message of conversation) {
    console.log(`      [${message.name}]: ${message.content}`)
  }
  
  // ============================================================
  // 6. ATOMIC COUNTER EXAMPLE
  // ============================================================
  console.log('\n6️⃣  Atomic counter (tasks completed)...')
  await sharedMemory.incr('demo:team-alpha:completed-tasks')
  await sharedMemory.incr('demo:team-alpha:completed-tasks')
  const completed = await sharedMemory.read<string>('demo:team-alpha:completed-tasks')
  console.log(`   ✅ Tasks completed: ${completed}`)
  
  console.log('\n✨ Demo complete!')
  console.log('\n💡 Key Takeaways:')
  console.log('   • Key-Value: Shared team goal (overwrite semantics)')
  console.log('   • Lists: Task queue and conversation history (append-only)')
  console.log('   • Hashes: Agent status with partial updates')
  console.log('   • Atomic ops: Thread-safe counters')
  console.log('   • Namespaces: team-alpha, agent:*, chat:* for isolation')
  
  await redis.quit()
}

main().catch(console.error)
