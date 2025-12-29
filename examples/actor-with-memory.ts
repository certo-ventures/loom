/**
 * Example: Actor with Opt-In Memory
 * Demonstrates composable memory integration
 */

import { MemoryFactory } from '../src/memory'
import { createMemoryHelpers, type MemoryHelpers } from '../src/actor/memory-helpers'
import { DynamicConfigService } from '../src/config/dynamic-config'

// Base Actor interface (simplified)
interface ActorContext {
  tenantId: string
  userId?: string
  actorType: string
  actorId: string
  threadId: string
  runId?: string
  metadata?: Record<string, any>
}

/**
 * Example Actor WITH Memory (opt-in)
 */
class CriteriaReviewerActor {
  private memory: MemoryHelpers
  
  constructor(
    private context: ActorContext,
    private configService: DynamicConfigService
  ) {
    // Initialize memory helpers (will be no-op if memory not configured)
    this.memory = createMemoryHelpers(undefined, context)
  }

  async initialize(): Promise<void> {
    // Load dynamic config for this tenant/actor
    const config = await this.configService.getConfig(
      this.context.tenantId,
      this.context.actorType
    )

    // If memory enabled, create adapter
    if (config.memory?.enabled) {
      const adapter = await MemoryFactory.createAdapterFromEnv()
      
      this.memory = createMemoryHelpers(adapter, this.context, {
        storageEnabled: config.memory.enabled,
        recallEnabled: config.memory.enabled,
        cacheEnabled: config.memory.semanticCacheEnabled,
      })
      
      console.log('✅ Memory enabled for', this.context.actorType)
    } else {
      console.log('⚠️ Memory disabled for', this.context.actorType)
    }
  }

  async evaluateCriterion(criterion: any, appraisalData: any): Promise<any> {
    const query = `${criterion.name} for ${appraisalData.propertyType}`

    // 1. Check cache (saves LLM call if hit)
    const cached = await this.memory.checkCache(query)
    if (cached) {
      console.log('💾 Cache hit! Saved LLM call')
      return cached
    }

    // 2. Recall similar past evaluations (adds context)
    const similar = await this.memory.recall(query, {
      category: 'criterion-evaluation',
      limit: 3,
    })
    
    if (similar.length > 0) {
      console.log(`📚 Found ${similar.length} similar evaluations`)
    }

    // 3. Call LLM with enhanced context
    const result = await this.callLLM(criterion, appraisalData, similar)

    // 4. Store result in memory
    await this.memory.remember({
      memory: `Criterion ${criterion.id}: ${result.evaluation}`,
      content: JSON.stringify(result),
    }, {
      importance: result.evaluation === 'fail' ? 'high' : 'medium',
      category: 'criterion-evaluation',
    })

    // 5. Cache for future similar queries
    await this.memory.cache(query, result, { ttl: 3600 })

    return result
  }

  private async callLLM(criterion: any, data: any, context: any[]): Promise<any> {
    // Simulate LLM call
    return {
      evaluation: 'pass',
      confidence: 0.95,
      reasoning: 'Meets all requirements',
    }
  }
}

/**
 * Example Actor WITHOUT Memory (default behavior)
 */
class SimpleActor {
  constructor(private context: ActorContext) {
    // No memory - just regular actor
  }

  async execute(input: any): Promise<any> {
    console.log('Executing without memory...')
    return { success: true }
  }
}

/**
 * Example: Dynamic Configuration Setup
 */
async function setupDynamicConfig() {
  const configService = new DynamicConfigService({
    cosmos: {
      endpoint: process.env.COSMOS_ENDPOINT!,
      databaseId: 'loom',
      containerId: 'configs',
      // Uses DefaultAzureCredential (managed identity)
    },
    cacheTTL: 300000, // 5 minutes
  })

  await configService.initialize()

  // Set memory config for specific tenant
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

  // Override for specific actor type
  await configService.saveConfig({
    id: 'wells-fargo-criteria-reviewer',
    tenantId: 'wells-fargo',
    actorType: 'CriteriaReviewer',
    memory: {
      enabled: true,
      semanticCacheEnabled: true,
      semanticCacheTTL: 7200, // 2 hours for criteria
    },
    createdAt: new Date().toISOString(),
    priority: 200, // Higher priority
  })

  return configService
}

/**
 * Usage Example
 */
async function main() {
  const configService = await setupDynamicConfig()

  const context: ActorContext = {
    tenantId: 'wells-fargo',
    actorType: 'CriteriaReviewer',
    actorId: 'reviewer-001',
    threadId: 'appraisal-123',
  }

  // Create actor with memory
  const actor = new CriteriaReviewerActor(context, configService)
  await actor.initialize()

  // Execute - will use memory if enabled
  const result = await actor.evaluateCriterion(
    { id: 'C001', name: 'Foundation Inspection' },
    { propertyType: 'single-family' }
  )

  console.log('Result:', result)

  // Second call - should hit cache
  const result2 = await actor.evaluateCriterion(
    { id: 'C001', name: 'Foundation Inspection' },
    { propertyType: 'single-family' }
  )

  console.log('Result2 (cached):', result2)
}

if (require.main === module) {
  main().catch(console.error)
}

export { CriteriaReviewerActor, SimpleActor, setupDynamicConfig }
