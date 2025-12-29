/**
 * Memory Integration Demo
 * Shows how to use memory with actual Actor runtime
 */

import { DynamicConfigService } from '../src/config/dynamic-config.js'
import { MemoryFactory } from '../src/memory/index.js'
import type { MemoryAdapter } from '../src/memory/index.js'
import { CriteriaReviewerActor } from '../demos/mortgage-appraisal/actors/criteria-reviewer.js'
import type { ActorContext } from '../src/actor/journal.js'

/**
 * Step 1: Setup dynamic configuration
 */
async function setupConfiguration() {
  const configService = new DynamicConfigService({
    cosmos: {
      endpoint: process.env.COSMOS_ENDPOINT!,
      databaseId: 'loom',
      containerId: 'configs',
      // Uses DefaultAzureCredential (managed identity)
    },
  })

  await configService.initialize()

  // Enable memory for Wells Fargo tenant
  await configService.saveConfig({
    id: 'wells-fargo-default',
    tenantId: 'wells-fargo',
    memory: {
      enabled: true,
      deduplicationEnabled: true,
      deduplicationThreshold: 0.95,
      semanticCacheEnabled: true,
      semanticCacheThreshold: 0.98,
      semanticCacheTTL: 3600,
    },
    createdAt: new Date().toISOString(),
    priority: 100,
  })

  // Override for CriteriaReviewer - longer cache
  await configService.saveConfig({
    id: 'wells-fargo-criteria-reviewer',
    tenantId: 'wells-fargo',
    actorType: 'CriteriaReviewerActor',
    memory: {
      enabled: true,
      semanticCacheTTL: 7200, // 2 hours
    },
    createdAt: new Date().toISOString(),
    priority: 200,
  })

  console.log('✅ Configuration service initialized\n')
  return configService
}

/**
 * Step 2: Create memory adapter if enabled
 */
async function createMemoryAdapter(
  configService: DynamicConfigService,
  tenantId: string,
  actorType: string
): Promise<MemoryAdapter | undefined> {
  const config = await configService.getConfig(tenantId, actorType)

  if (!config.memory?.enabled) {
    console.log('⚠️  Memory disabled for this tenant/actor\n')
    return undefined
  }

  console.log('📦 Creating memory adapter...')
  const adapter = await MemoryFactory.createAdapterFromEnv()
  console.log('✅ Memory adapter created\n')
  
  return adapter
}

/**
 * Step 3: Create actor with memory
 */
function createActor(
  context: ActorContext,
  memoryAdapter?: MemoryAdapter
): CriteriaReviewerActor {
  // CriteriaReviewerActor constructor: (context, initialState?)
  // It extends Actor which has: (context, initialState?, tracer?, idempotencyStore?, memoryAdapter?)
  // But CriteriaReviewerActor doesn't expose all those parameters
  return new CriteriaReviewerActor(context)
}

/**
 * Demo: Run criterion reviews with memory
 */
async function runDemo() {
  console.log('🚀 Starting Memory Integration Demo\n')

  // 1. Setup configuration
  const configService = await setupConfiguration()

  // 2. Create memory adapter
  const memoryAdapter = await createMemoryAdapter(
    configService,
    'wells-fargo',
    'CriteriaReviewerActor'
  )

  // 3. Mock appraisal data
  const appraisalData = {
    propertyAddress: '123 Main St, Seattle, WA',
    appraisedValue: 650000,
    effectiveDate: '2025-01-15',
    appraiserName: 'John Smith',
    appraiserLicense: 'WA-12345',
    propertyType: 'single-family',
    yearBuilt: 2015,
    squareFootage: 2400,
    lotSize: '0.25 acres',
    condition: 'good',
    comparableSales: [
      {
        address: '125 Main St',
        salePrice: 640000,
        saleDate: '2024-12-01',
        squareFootage: 2350,
        adjustments: 10000,
      },
      {
        address: '130 Oak Ave',
        salePrice: 660000,
        saleDate: '2024-11-20',
        squareFootage: 2500,
        adjustments: -10000,
      },
    ],
  }

  const criterion = {
    id: 'C001',
    category: 'Valuation',
    criterion: 'Comparable sales are recent and appropriate',
    description: 'The appraisal must use comparable sales from the last 6 months',
    importance: 'high',
    guidelines: 'At least 3 comparable sales within 1 mile and 6 months',
  }

  // 4. First review - CACHE MISS
  console.log('📝 First Review (Cache Miss Expected)\n')
  const context1: ActorContext = {
    actorId: 'reviewer-001',
    actorType: 'CriteriaReviewerActor',
    correlationId: 'demo-run-1',
    tenantId: 'wells-fargo',
    threadId: 'appraisal-123',
  } as any

  const actor1 = createActor(context1, memoryAdapter)
  
  await actor1.execute({
    appraisalData,
    criterion,
    agentName: 'Reviewer-1',
    llmModel: 'gpt-4',
  })

  const result1 = (actor1 as any).state.review
  console.log('Result 1:', {
    evaluation: result1.evaluation,
    confidence: result1.confidence,
  })
  console.log('')

  // 5. Wait a moment
  await new Promise(resolve => setTimeout(resolve, 2000))

  // 6. Second review - CACHE HIT
  console.log('📝 Second Review (Cache Hit Expected)\n')
  const context2: ActorContext = {
    actorId: 'reviewer-002',
    actorType: 'CriteriaReviewerActor',
    correlationId: 'demo-run-2',
    tenantId: 'wells-fargo',
    threadId: 'appraisal-456',
  } as any

  const actor2 = createActor(context2, memoryAdapter)
  
  await actor2.execute({
    appraisalData, // Same data
    criterion, // Same criterion
    agentName: 'Reviewer-2',
    llmModel: 'gpt-4',
  })

  const result2 = (actor2 as any).state.review
  console.log('Result 2:', {
    evaluation: result2.evaluation,
    confidence: result2.confidence,
  })
  console.log('')

  // 7. Check recent memories
  if (memoryAdapter) {
    console.log('📚 Recent Memories:\n')
    const recent = await memoryAdapter.getRecentMemories(
      'wells-fargo',
      'appraisal-123',
      5
    )
    
    console.log(`Found ${recent.length} memories:`)
    recent.forEach((mem, idx) => {
      console.log(`${idx + 1}. ${mem.memory} (${mem.category})`)
    })
  }

  console.log('\n✅ Demo completed!')
}

// Run if executed directly
// if (require.main === module) {
//   runDemo().catch(error => {
//     console.error('❌ Demo failed:', error)
//     process.exit(1)
//   })
// }

// ESM entry point
runDemo().catch(error => {
  console.error('❌ Demo failed:', error)
  process.exit(1)
})

export { setupConfiguration, createMemoryAdapter, createActor }
