// @ts-nocheck - Outdated demo
/**
 * Test: Adapter Factory
 * 
 * Demonstrates configuration-based adapter selection
 */

import { AdapterFactory, type AdapterConfig } from '../src/storage'

async function test() {
  console.log('Testing Adapter Factory...\n')
  
  // Test 1: Development config (all in-memory)
  console.log('📦 Development Configuration:')
  const devConfig: AdapterConfig = {
    messageQueue: { type: 'inmemory' },
    stateStore: { type: 'inmemory' },
    coordinationAdapter: { type: 'inmemory' },
    blobStore: { type: 'inmemory' },
  }
  
  const devAdapters = AdapterFactory.createAll(devConfig)
  console.log('  ✅ MessageQueue:', devAdapters.messageQueue.constructor.name)
  console.log('  ✅ StateStore:', devAdapters.stateStore.constructor.name)
  console.log('  ✅ CoordinationAdapter:', devAdapters.coordinationAdapter?.constructor.name)
  console.log('  ✅ BlobStore:', devAdapters.blobStore.constructor.name)
  
  // Test 2: Minimal config (defaults to in-memory)
  console.log('\n📦 Minimal Configuration (defaults):')
  const minimalAdapters = AdapterFactory.createAll({})
  console.log('  ✅ MessageQueue:', minimalAdapters.messageQueue.constructor.name)
  console.log('  ✅ StateStore:', minimalAdapters.stateStore.constructor.name)
  console.log('  ✅ CoordinationAdapter:', minimalAdapters.coordinationAdapter?.constructor.name || 'undefined')
  console.log('  ✅ BlobStore:', minimalAdapters.blobStore.constructor.name)
  
  // Test 3: No coordination adapter (optional)
  console.log('\n📦 Without Coordination (single instance):')
  const singleInstanceConfig: AdapterConfig = {
    messageQueue: { type: 'inmemory' },
    stateStore: { type: 'inmemory' },
    // No coordinationAdapter - optional for single instance
    blobStore: { type: 'inmemory' },
  }
  
  const singleAdapters = AdapterFactory.createAll(singleInstanceConfig)
  console.log('  ✅ MessageQueue:', singleAdapters.messageQueue.constructor.name)
  console.log('  ✅ StateStore:', singleAdapters.stateStore.constructor.name)
  console.log('  ✅ CoordinationAdapter:', singleAdapters.coordinationAdapter || 'undefined (single instance)')
  console.log('  ✅ BlobStore:', singleAdapters.blobStore.constructor.name)
  
  // Test 4: Individual adapter creation
  console.log('\n📦 Individual Adapter Creation:')
  const messageQueue = AdapterFactory.createMessageQueue({ type: 'inmemory' })
  const stateStore = AdapterFactory.createStateStore({ type: 'inmemory' })
  const coordinator = AdapterFactory.createCoordinationAdapter({ type: 'inmemory' })
  const blobStore = AdapterFactory.createBlobStore({ type: 'inmemory' })
  
  console.log('  ✅ Individual MessageQueue:', messageQueue.constructor.name)
  console.log('  ✅ Individual StateStore:', stateStore.constructor.name)
  console.log('  ✅ Individual CoordinationAdapter:', coordinator?.constructor.name)
  console.log('  ✅ Individual BlobStore:', blobStore.constructor.name)
  
  // Test 5: Error handling for unknown types
  console.log('\n📦 Error Handling:')
  try {
    AdapterFactory.createMessageQueue({ type: 'unknown' as any })
    console.log('  ❌ Should have thrown error')
  } catch (error) {
    console.log('  ✅ Throws on unknown type:', (error as Error).message)
  }
  
  console.log('\n✅ All adapter factory tests passed!')
  console.log('\n💡 Usage in production:')
  console.log(`
  const config: AdapterConfig = {
    messageQueue: { type: 'bullmq', redis: { host: 'redis.prod', port: 6379 } },
    stateStore: { type: 'cosmos', cosmos: { endpoint: '...', key: '...', database: 'loom' } },
    coordinationAdapter: { type: 'redis', redis: { host: 'redis.prod', port: 6379 } },
    blobStore: { type: 'azure', azure: { connectionString: '...', container: 'actors' } },
  }
  
  const adapters = AdapterFactory.createAll(config)
  const runtime = new LongLivedActorRuntime(adapters)
  `)
}

test().catch(console.error)
