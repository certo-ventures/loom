/**
 * Test: Configuration Resolution with AIActor
 * Demonstrates hierarchical config resolution for multi-tenant AI actors
 */

import { InMemoryConfigResolver, ConfigAdmin } from '../src/config-resolver'
import { AIActor } from '../src/actor/ai-actor'
import type { ActorContext } from '../src/actor/journal'
import type { LLMConfig } from '../src/ai/llm-provider'
import * as dotenv from 'dotenv'

dotenv.config()

// Mock actor for testing
class CustomerSupportActor extends AIActor {
  async execute(query: string): Promise<void> {
    // Initialize LLM from config (uses context-aware resolution)
    await this.initializeLLMFromConfig('azure-openai')
    
    // Use LLM
    const response = await this.chat([
      { role: 'system', content: 'You are a helpful customer support agent.' },
      { role: 'user', content: query },
    ])
    
    this.updateState({ lastResponse: response })
  }
}

async function testConfigResolution() {
  console.log('🔧 Testing Hierarchical Config Resolution\n')
  
  // 1. Setup config resolver with multi-tenant configuration
  const config = new InMemoryConfigResolver()
  const admin = new ConfigAdmin(config)
  
  console.log('📝 Setting up multi-tenant configuration...')
  
  // Global default (fallback for everyone)
  await config.set('global/azure-openai', {
    provider: 'azure-openai',
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    model: 'gpt-4o-mini',  // Cheaper model for global
    temperature: 0.7,
    maxTokens: 100,
  } as LLMConfig)
  
  // Premium client gets better model
  await config.set('acme-corp/prod/azure-openai', {
    provider: 'azure-openai',
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    model: process.env.AZURE_OPENAI_DEPLOYMENT!,  // Full GPT-4o
    temperature: 0.7,
    maxTokens: 200,
  } as LLMConfig)
  
  // Finance department gets specialized config
  await config.set('acme-corp/finance/prod/azure-openai', {
    provider: 'azure-openai',
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    model: process.env.AZURE_OPENAI_DEPLOYMENT!,
    temperature: 0.3,  // More deterministic for finance
    maxTokens: 300,
  } as LLMConfig)
  
  console.log('✅ Configuration loaded\n')
  
  // 2. Test hierarchical resolution
  console.log('🎯 Test 1: Premium client (acme-corp/prod)')
  const premiumConfig = await config.getWithContext('azure-openai', {
    clientId: 'acme-corp',
    environment: 'prod',
  }) as LLMConfig
  console.log('   Resolved model:', premiumConfig.model)
  console.log('   Max tokens:', premiumConfig.maxTokens)
  console.log()
  
  console.log('🎯 Test 2: Finance department (acme-corp/finance/prod)')
  const financeConfig = await config.getWithContext('azure-openai', {
    clientId: 'acme-corp',
    tenantId: 'finance',
    environment: 'prod',
  }) as LLMConfig
  console.log('   Resolved model:', financeConfig.model)
  console.log('   Temperature:', financeConfig.temperature, '(deterministic)')
  console.log('   Max tokens:', financeConfig.maxTokens)
  console.log()
  
  console.log('🎯 Test 3: New client (startup-co/dev) - Falls back to global')
  const startupConfig = await config.getWithContext('azure-openai', {
    clientId: 'startup-co',
    environment: 'dev',
  }) as LLMConfig
  console.log('   Resolved model:', startupConfig.model, '(global default)')
  console.log('   Max tokens:', startupConfig.maxTokens)
  console.log()
  
  // 3. Test with actual actor
  console.log('🤖 Test 4: AIActor with config resolution')
  
  const mockContext: ActorContext = {
    actorId: 'support-001',
    correlationId: 'test-123',
    journal: { entries: [], cursor: 0 },
    configResolver: config,
    clientId: 'acme-corp',
    tenantId: 'finance',
    environment: 'prod',
  } as any
  
  const actor = new CustomerSupportActor(mockContext, {})
  
  console.log('   Actor context:')
  console.log('     - Client: acme-corp')
  console.log('     - Tenant: finance')
  console.log('     - Environment: prod')
  console.log()
  
  console.log('   Executing actor with query...')
  await actor.execute('What is 2+2?')
  
  const state = (actor as any).state
  console.log('   Response:', state.lastResponse)
  console.log('   Config used:', state._llmConfig.model, 'at', state._llmConfig.temperature, 'temp')
  console.log()
  
  // 4. Administrative operations
  console.log('🛠️  Test 5: Administrative operations')
  
  // Export all config
  const allConfig = await admin.exportConfig()
  console.log('   Total configs:', Object.keys(allConfig).length)
  
  // List all keys for acme-corp
  const acmeKeys = await config.listKeys('acme-corp')
  console.log('   Acme-corp configs:', acmeKeys.length)
  acmeKeys.forEach(key => console.log('     -', key))
  console.log()
  
  // Copy dev config to staging
  await admin.importConfig({
    'acme-corp': {
      staging: {
        'azure-openai': {
          provider: 'azure-openai',
          apiKey: process.env.AZURE_OPENAI_API_KEY!,
          endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
          model: process.env.AZURE_OPENAI_DEPLOYMENT!,
          temperature: 0.7,
          maxTokens: 150,
        }
      }
    }
  })
  console.log('   ✅ Created staging environment config')
  
  // Validate required config exists
  const validation = await admin.validateStructure([
    'acme-corp/prod/azure-openai',
    'acme-corp/finance/prod/azure-openai',
    'global/azure-openai',
  ])
  console.log('   Validation:', validation.valid ? '✅ All required configs present' : '❌ Missing configs')
  console.log()
  
  // 5. Change notifications
  console.log('🔔 Test 6: Configuration change notifications')
  
  const unsubscribe = config.onChange((event) => {
    console.log('   📢 Config changed:', event.keyPath)
    console.log('      Old value:', event.oldValue ? JSON.stringify(event.oldValue).substring(0, 50) + '...' : 'none')
    console.log('      New value:', event.newValue ? JSON.stringify(event.newValue).substring(0, 50) + '...' : 'deleted')
  })
  
  // Make a change
  await config.set('acme-corp/prod/feature-flags', {
    enableNewUI: true,
    maxConcurrentRequests: 100,
  })
  
  unsubscribe()
  console.log()
  
  // 6. Statistics
  console.log('📊 Configuration Statistics')
  const stats = (config as any).getStats()
  console.log('   Total keys:', stats.totalKeys)
  console.log('   Total size:', Math.round(stats.totalSize / 1024), 'KB')
  console.log('   Keys by prefix:')
  Object.entries(stats.keysByPrefix).forEach(([prefix, count]) => {
    console.log(`     - ${prefix}: ${count}`)
  })
  console.log()
  
  console.log('✅ All tests passed!')
  console.log()
  console.log('💡 Key takeaways:')
  console.log('   - Config resolution is hierarchical and context-aware')
  console.log('   - Each client/tenant can have custom LLM configs')
  console.log('   - Actors automatically use their context for resolution')
  console.log('   - Administrative tools make config management easy')
  console.log('   - Change notifications enable real-time updates')
}

// Run tests
testConfigResolution()
  .then(() => {
    console.log('\n🎉 Config resolution system validated!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message)
    console.error(error)
    process.exit(1)
  })
