/**
 * Memory Layer Usage Examples
 * Demonstrates core functionality with minimal code
 */

import { SemanticMemoryService } from '../src/memory'
import type { MemoryServiceConfig } from '../src/config/types'
import { DefaultAzureCredential } from '@azure/identity'

// Example 1: Basic Setup
async function setupMemoryService(): Promise<SemanticMemoryService> {
  const config: MemoryServiceConfig = {
    cosmos: {
      endpoint: process.env.COSMOS_ENDPOINT!,
      databaseId: 'loom',
      containerId: 'memories',
      credential: new DefaultAzureCredential(),
    },
    embedding: {
      provider: 'openai',
      openai: {
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'text-embedding-3-small',
      },
      dimensions: 1536,
    },
    deduplicationEnabled: true,
    deduplicationThreshold: 0.95,
    semanticCacheEnabled: true,
    semanticCacheThreshold: 0.98,
    semanticCacheTTL: 3600,
  }

  const service = new SemanticMemoryService(config)
  await service.initialize()
  return service
}

// Example 2: Store and Retrieve Memory
async function storeAndRetrieve() {
  const service = await setupMemoryService()

  // Store memory
  const memoryId = await service.add({
    tenantId: 'wells-fargo',
    threadId: 'appraisal-001',
    turnIndex: 0,
    memory: 'Property foundation is in excellent condition',
    content: 'Foundation inspection revealed no cracks or structural issues',
    memoryType: 'long-term',
    category: 'foundation-evaluation',
  })

  console.log('✅ Stored memory:', memoryId)

  // Retrieve by ID
  const retrieved = await service.get(memoryId, 'wells-fargo', 'appraisal-001')
  console.log('📄 Retrieved:', retrieved?.memory)
}

// Example 3: Semantic Search
async function semanticSearch() {
  const service = await setupMemoryService()

  // Add some memories
  await service.add({
    tenantId: 'wells-fargo',
    threadId: 'appraisal-002',
    turnIndex: 0,
    memory: 'Roof has minor wear but structurally sound',
    category: 'roof-evaluation',
  })

  await service.add({
    tenantId: 'wells-fargo',
    threadId: 'appraisal-002',
    turnIndex: 1,
    memory: 'Foundation shows excellent structural integrity',
    category: 'foundation-evaluation',
  })

  // Search semantically
  const results = await service.search('structural condition', {
    tenantId: 'wells-fargo',
    limit: 5,
  })

  console.log(`🔍 Found ${results.length} relevant memories:`)
  results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.memory}`)
  })
}

// Example 4: Automatic Deduplication
async function deduplicationExample() {
  const service = await setupMemoryService()

  // Add first memory
  const id1 = await service.add({
    tenantId: 'wells-fargo',
    threadId: 'appraisal-003',
    turnIndex: 0,
    memory: 'Property has excellent foundation',
    category: 'evaluation',
  })

  // Add very similar memory - will be merged
  const id2 = await service.add({
    tenantId: 'wells-fargo',
    threadId: 'appraisal-003',
    turnIndex: 1,
    memory: 'Property has great foundation',
    category: 'evaluation',
  })

  if (id1 === id2) {
    console.log('✅ Duplicate detected and merged!')
    const merged = await service.get(id1, 'wells-fargo', 'appraisal-003')
    console.log('📊 Occurrences:', merged?.metadata?.occurrences)
  }
}

// Example 5: Semantic Caching (Save LLM Costs!)
async function semanticCacheExample() {
  const service = await setupMemoryService()

  const query = 'What is the foundation condition?'
  const tenantId = 'wells-fargo'

  // Check cache first
  let cached = await service.checkSemanticCache(query, tenantId)
  
  if (cached) {
    console.log('✅ Cache hit! Age:', cached.age, 'seconds')
    console.log('📦 Cached response:', cached.response)
    return cached.response
  }

  console.log('⚠️ Cache miss - calling LLM...')
  
  // Simulate LLM call
  const llmResponse = {
    evaluation: 'pass',
    confidence: 0.95,
    reasoning: 'Foundation is structurally sound',
  }

  // Store in cache
  await service.addToCache(query, llmResponse, tenantId, {
    ttl: 3600, // 1 hour
    metadata: { model: 'gpt-4', cost: 0.002 },
  })

  console.log('💾 Cached for future use')
  
  // Next similar query hits cache
  const similar = await service.checkSemanticCache(
    'How is the foundation?', // Different words, same meaning
    tenantId
  )
  
  if (similar) {
    console.log('✅ Semantic match found! (>98% similar)')
    console.log('💰 Saved LLM call cost: $0.002')
  }

  return llmResponse
}

// Example 6: Recent Memories by Thread
async function recentMemoriesExample() {
  const service = await setupMemoryService()

  // Get last 5 memories for a thread
  const recent = await service.getRecentMemories(
    'wells-fargo',
    'appraisal-001',
    5
  )

  console.log(`📋 Last ${recent.length} memories:`)
  recent.forEach((m) => {
    console.log(`  Turn ${m.turnIndex}: ${m.memory}`)
  })
}

// Run examples
if (require.main === module) {
  (async () => {
    try {
      console.log('=== Example 1: Store and Retrieve ===')
      await storeAndRetrieve()

      console.log('\n=== Example 2: Semantic Search ===')
      await semanticSearch()

      console.log('\n=== Example 3: Deduplication ===')
      await deduplicationExample()

      console.log('\n=== Example 4: Semantic Caching ===')
      await semanticCacheExample()

      console.log('\n=== Example 5: Recent Memories ===')
      await recentMemoriesExample()

      console.log('\n✅ All examples completed!')
    } catch (error) {
      console.error('❌ Error:', error)
      process.exit(1)
    }
  })()
}

export {
  setupMemoryService,
  storeAndRetrieve,
  semanticSearch,
  deduplicationExample,
  semanticCacheExample,
  recentMemoriesExample,
}
