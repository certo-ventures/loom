/**
 * Updated Memory Integration Demo
 * Shows how platforms inject configuration into library services
 */

import { DefaultAzureCredential } from '@azure/identity'
import { DynamicConfigService } from '../src/config/dynamic-config.js'
import { SemanticMemoryService } from '../src/memory/semantic-memory-service.js'
import { CosmosMemoryAdapter } from '../src/memory/memory-adapter.js'
import { createMemoryHelpers } from '../src/actor/memory-helpers.js'
import type { DynamicConfigServiceConfig, MemoryServiceConfig } from '../src/config/types.js'
import type { MemoryAdapter } from '../src/memory/memory-adapter.js'

/**
 * Platform Configuration
 * In production, this would come from environment, Key Vault, config files, etc.
 */
function getPlatformConfiguration() {
  // Validate required configuration
  if (!process.env.COSMOS_ENDPOINT) {
    throw new Error('COSMOS_ENDPOINT environment variable required')
  }
  if (!process.env.AZURE_OPENAI_ENDPOINT) {
    throw new Error('AZURE_OPENAI_ENDPOINT environment variable required')
  }
  if (!process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT) {
    throw new Error('AZURE_OPENAI_EMBEDDING_DEPLOYMENT environment variable required')
  }

  return {
    cosmosEndpoint: process.env.COSMOS_ENDPOINT,
    cosmosDatabaseId: process.env.COSMOS_DATABASE_ID || 'loom',
    openaiEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
    openaiEmbeddingDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    credential: new DefaultAzureCredential(),
  }
}

/**
 * Step 1: Initialize configuration service with injected config
 */
async function setupConfigurationService(): Promise<DynamicConfigService> {
  const platformConfig = getPlatformConfiguration()

  const configServiceConfig: DynamicConfigServiceConfig = {
    cosmos: {
      endpoint: platformConfig.cosmosEndpoint,
      databaseId: platformConfig.cosmosDatabaseId,
      containerId: 'configs',
      credential: platformConfig.credential,
    },
    cacheTTL: 300000, // 5 minutes
  }

  const configService = new DynamicConfigService(configServiceConfig)
  await configService.initialize()

  // Seed some example configurations
  await configService.saveConfig({
    id: 'tenant-123-default',
    tenantId: 'tenant-123',
    memory: {
      enabled: true,
      deduplicationEnabled: true,
      deduplicationThreshold: 0.95,
      semanticCacheEnabled: true,
      semanticCacheThreshold: 0.95,
      semanticCacheTTL: 3600,
    },
    createdAt: new Date().toISOString(),
    priority: 100,
  })

  await configService.saveConfig({
    id: 'tenant-123-criteria-reviewer',
    tenantId: 'tenant-123',
    actorType: 'CriteriaReviewerActor',
    memory: {
      enabled: true,
      semanticCacheEnabled: true,
      semanticCacheThreshold: 0.98, // Higher threshold for this actor
    },
    createdAt: new Date().toISOString(),
    priority: 200, // Overrides tenant default
  })

  console.log('✓ Configuration service initialized')
  return configService
}

/**
 * Step 2: Initialize memory service with injected config
 */
async function setupMemoryService(): Promise<MemoryAdapter> {
  const platformConfig = getPlatformConfiguration()

  const memoryServiceConfig: MemoryServiceConfig = {
    cosmos: {
      endpoint: platformConfig.cosmosEndpoint,
      databaseId: platformConfig.cosmosDatabaseId,
      containerId: 'memories',
      credential: platformConfig.credential,
    },
    embedding: {
      provider: 'azure-openai',
      azure: {
        endpoint: platformConfig.openaiEndpoint,
        deploymentName: platformConfig.openaiEmbeddingDeployment,
        credential: platformConfig.credential, // Reuse same credential
        apiVersion: '2023-05-15',
      },
      dimensions: 1536,
    },
    deduplicationEnabled: true,
    deduplicationThreshold: 0.95,
    semanticCacheEnabled: true,
    semanticCacheThreshold: 0.95,
    semanticCacheTTL: 3600,
  }

  const memoryService = new SemanticMemoryService(memoryServiceConfig)
  await memoryService.initialize()

  const adapter = new CosmosMemoryAdapter(memoryService)
  console.log('✓ Memory service initialized')
  
  return adapter
}

/**
 * Step 3: Demonstrate memory helpers directly
 */
function demonstrateMemoryHelpers(memoryAdapter?: MemoryAdapter) {
  const context = {
    tenantId: 'tenant-123',
    actorId: 'actor-001',
    actorType: 'CriteriaReviewerActor',
    threadId: 'thread-001',
    runId: 'run-001',
    turnIndex: 0,
  }

  // Create memory helpers directly (same as Actor would internally)
  const memoryHelpers = createMemoryHelpers(memoryAdapter, context)
  
  console.log('✓ Memory helpers created')
  return memoryHelpers
}

/**
 * Demo: Run the same evaluation twice to show cache hit
 */
async function runDemo() {
  try {
    console.log('🚀 Memory Integration Demo\n')
    console.log('Platform injects configuration into library services\n')

    // Platform initializes services with injected configuration
    const configService = await setupConfigurationService()
    const memoryAdapter = await setupMemoryService()

    // Check if memory is enabled for this tenant/actor
    const config = await configService.getConfig('tenant-123', 'CriteriaReviewerActor')
    console.log('\nTenant configuration:', JSON.stringify(config.memory, null, 2))

    let actorMemoryAdapter: MemoryAdapter | undefined
    if (config.memory?.enabled) {
      actorMemoryAdapter = memoryAdapter
      console.log('✓ Memory enabled for tenant-123/CriteriaReviewerActor\n')
    }

    // Create memory helpers (same as Actor would use internally)
    const memoryHelpers = demonstrateMemoryHelpers(actorMemoryAdapter)

    // Demonstrate memory helpers
    console.log('\n📝 Testing memory operations...\n')

    // Store a memory
    const memoryId = await memoryHelpers.remember({
      content: 'Property valuation completed for 123 Main St',
      category: 'appraisal',
    })
    console.log('✓ Memory stored:', memoryId)

    // Recall similar memories
    const recalled = await memoryHelpers.recall(
      'valuation for Main Street property',
      { category: 'appraisal', limit: 3 }
    )
    console.log('✓ Recalled memories:', recalled.length)

    // Check cache
    const cacheKey = 'appraisal-criteria-review-123'
    const cached = await memoryHelpers.checkCache(cacheKey)
    console.log('✓ Cache check:', cached ? 'HIT' : 'MISS')

    // Store in cache
    if (!cached) {
      await memoryHelpers.cache(cacheKey, {
        result: 'Property meets all criteria',
        score: 95,
      })
      console.log('✓ Result cached')
    }

    // Second check - should hit cache
    const cached2 = await memoryHelpers.checkCache(cacheKey)
    console.log('✓ Second cache check:', cached2 ? 'HIT ✓' : 'MISS')

    console.log('\n✅ Demo complete!')
    console.log('\nKey benefits:')
    console.log('  • Library is environment-agnostic')
    console.log('  • Platform controls configuration source')
    console.log('  • Easy to test with mock configurations')
    console.log('  • No direct dependency on process.env')
    console.log('  • Flexible authentication (credential or API key)')
  } catch (error) {
    console.error('❌ Demo failed:', error)
    process.exit(1)
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo().catch(console.error)
}

export { getPlatformConfiguration, setupConfigurationService, setupMemoryService }
