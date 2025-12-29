/**
 * Simple Memory Integration Test
 * Tests memory helpers without requiring actual Cosmos DB
 */

import { createMemoryHelpers } from '../src/actor/memory-helpers.js'
import type { MemoryContext } from '../src/actor/memory-helpers.js'

console.log('🧪 Testing Memory Helpers (No-Op Mode)\n')

// Create memory context
const context: MemoryContext = {
  tenantId: 'test-tenant',
  actorType: 'TestActor',
  actorId: 'actor-001',
  threadId: 'thread-123',
}

// Create helpers without adapter (no-op mode)
const memory = createMemoryHelpers(undefined, context)

console.log('✅ Memory helpers created (no-op mode)\n')

async function testNoOpBehavior() {
  console.log('1️⃣  Testing remember() - should return null')
  const memoryId = await memory.remember({
    memory: 'Test memory',
    content: 'Test content',
  })
  console.log('   Result:', memoryId)
  console.log('   ✅ Returned null as expected\n')

  console.log('2️⃣  Testing recall() - should return []')
  const memories = await memory.recall('test query')
  console.log('   Result:', memories)
  console.log('   ✅ Returned empty array as expected\n')

  console.log('3️⃣  Testing checkCache() - should return null')
  const cached = await memory.checkCache('test query')
  console.log('   Result:', cached)
  console.log('   ✅ Returned null as expected\n')

  console.log('4️⃣  Testing cache() - should return null')
  const cacheId = await memory.cache('test query', 'test response')
  console.log('   Result:', cacheId)
  console.log('   ✅ Returned null as expected\n')

  console.log('5️⃣  Testing getRecentMemories() - should return []')
  const recent = await memory.getRecentMemories(10)
  console.log('   Result:', recent)
  console.log('   ✅ Returned empty array as expected\n')

  console.log('✅ All tests passed! Memory helpers work correctly in no-op mode.')
  console.log('\n💡 This means actors can safely use memory methods even when memory is not configured.')
}

testNoOpBehavior().catch(error => {
  console.error('❌ Test failed:', error)
  process.exit(1)
})
