/**
 * Production-Ready Example: Document Processing with All Patterns
 * 
 * Demonstrates:
 * 1. Structured actor metadata with AI context
 * 2. Config file loading
 * 3. All 5 world-class patterns:
 *    - Idempotency
 *    - Retry with backoff
 *    - Circuit breaker
 *    - Saga compensation
 *    - Human approval
 */

import { PipelineOrchestrator } from '../src/pipelines/pipeline-orchestrator'
import { BullMQMessageQueue } from '../src/storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../src/discovery'
import { loadActorConfig, ActorMetadata } from '../src/discovery'
import type { PipelineDefinition } from '../src/pipelines/pipeline-dsl'
import Redis from 'ioredis'

/**
 * Step 1: Load actor metadata from config
 */
async function loadActors(): Promise<ActorMetadata[]> {
  console.log('📋 Loading actor metadata from config...')
  
  const result = await loadActorConfig({
    configPath: './actors.config.example.yaml',
    validate: true,
    strict: true,
    envSubstitution: true
  })

  if (result.errors.length > 0) {
    console.error('❌ Validation errors:')
    result.errors.forEach(({ actorName, errors }) => {
      console.error(`  ${actorName}:`, errors)
    })
  }

  if (result.warnings.length > 0) {
    console.warn('⚠️  Warnings:')
    result.warnings.forEach(warning => console.warn(`  ${warning}`))
  }

  console.log(`✅ Loaded ${result.actors.length} actors with full metadata`)
  
  // Display AI context for each actor
  result.actors.forEach(actor => {
    console.log(`\n📦 ${actor.name} v${actor.version}`)
    console.log(`   Description: ${actor.description}`)
    console.log(`   Type: ${actor.type}`)
    console.log(`   Author: ${actor.author}`)
    
    if (actor.aiContext) {
      console.log(`   AI Purpose: ${actor.aiContext.purpose}`)
      console.log(`   Capabilities: ${actor.aiContext.capabilities?.length || 0}`)
    }
    
    if (actor.tags) {
      console.log(`   Tags: ${actor.tags.join(', ')}`)
    }
    
    if (actor.lifecycle) {
      console.log(`   Stage: ${actor.lifecycle.stage}`)
    }
  })

  return result.actors
}

/**
 * Step 2: Define pipeline with ALL patterns
 */
function createProductionPipeline(): PipelineDefinition {
  return {
    stages: [
      // Stage 1: Classify document (with retry and circuit breaker)
      {
        id: 'classify',
        actor: 'document-classifier',
        mode: 'execute',
        input: {
          documentUrl: '$.input.documentUrl'
        },
        // RETRY PATTERN: Exponential backoff
        retry: {
          maxAttempts: 3,
          backoff: 'exponential',
          backoffDelay: 1000
        },
        // CIRCUIT BREAKER: Protect against cascading failures
        circuitBreaker: {
          failureThreshold: 5,
          timeout: 30000,
          halfOpenRequests: 2
        }
      },

      // Stage 2: Conditional - extract if confidence is low
      {
        id: 'check-confidence',
        actor: 'confidence-checker',
        mode: 'conditional',
        input: {
          confidence: '$.classify.confidence'
        },
        when: '$.classify.confidence < 0.85'
      },

      // Stage 3: HUMAN APPROVAL if confidence is low
      {
        id: 'human-review',
        actor: 'human-approval',
        mode: 'human-approval',
        input: {
          document: '$.input.documentUrl',
          classification: '$.classify.result',
          confidence: '$.classify.confidence'
        },
        // Human approval configuration
        humanApproval: {
          assignTo: ['supervisor@example.com', 'qa-team@example.com'],
          timeout: 3600000, // 1 hour
          fallback: 'auto-approve', // or 'reject' or 'escalate'
          webhookUrl: 'https://notifications.example.com/approval'
        },
        // Only run if confidence check failed
        when: '$.check-confidence.result == false'
      },

      // Stage 4: Extract data (with compensation for saga)
      {
        name: 'extract',
        actor: 'pdf-extractor',
        mode: 'execute',
        input: {
          documentUrl: '$.input.documentUrl',
          extractText: true,
          extractTables: true,
          ocrLanguage: 'eng'
        },
        // RETRY with backoff
        retry: {
          maxAttempts: 3,
          backoff: 'exponential',
          backoffDelay: 2000
        },
        // SAGA COMPENSATION: Undo extraction if pipeline fails
        compensation: {
          actor: 'extraction-cleanup',
          input: {
            extractionId: '$.extract.extractionId'
          }
        }
      },

      // Stage 5: Parse extracted data (with compensation)
      {
        id: 'parse',
        actor: 'data-parser',
        mode: 'execute',
        input: {
          text: '$.extract.text',
          tables: '$.extract.tables'
        },
        // SAGA COMPENSATION
        compensation: {
          actor: 'parser-cleanup',
          input: {
            parseId: '$.parse.parseId'
          }
        }
      },

      // Stage 6: Validate parsed data
      {
        id: 'validate',
        actor: 'data-validator',
        mode: 'execute',
        input: {
          data: '$.parse.result'
        },
        // RETRY: Simple retry without backoff
        retry: {
          maxAttempts: 2,
          backoff: 'fixed',
          backoffDelay: 1000
        }
      },

      // Stage 7: SCATTER - Save to multiple destinations in parallel
      {
        id: 'save',
        actor: 'data-saver',
        mode: 'scatter',
        input: [
          {
            destination: 'database',
            data: '$.validate.result'
          },
          {
            destination: 's3',
            data: '$.validate.result',
            bucket: 'processed-documents'
          },
          {
            destination: 'elasticsearch',
            data: '$.validate.result',
            index: 'documents'
          }
        ],
        // SAGA COMPENSATION: Rollback all saves
        compensation: {
          actor: 'save-rollback',
          input: {
            saveIds: '$.save.*.saveId'
          }
        }
      },

      // Stage 8: GATHER - Collect save results
      {
        id: 'gather-results',
        actor: 'result-aggregator',
        mode: 'gather',
        input: {
          taskResults: '$.save'
        }
      },

      // Stage 9: Send notification
      {
        id: 'notify',
        actor: 'notification-sender',
        mode: 'execute',
        input: {
          status: 'success',
          documentId: '$.input.documentId',
          results: '$.gather-results.summary'
        },
        // RETRY with circuit breaker
        retry: {
          maxAttempts: 3,
          backoff: 'exponential',
          backoffDelay: 1000
        },
        circuitBreaker: {
          failureThreshold: 10,
          timeout: 10000,
          halfOpenRequests: 1
        }
      }
    ]
  }
}

/**
 * Step 3: Run pipeline with idempotency
 */
async function runProductionPipeline() {
  console.log('\n🚀 Starting production pipeline with all patterns...\n')

  // Setup
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379')
  })

  const messageQueue = new BullMQMessageQueue<any>(
    redis,
    { host: 'localhost', port: 6379 }
  )

  const registry = new InMemoryActorRegistry()
  
  const orchestrator = new PipelineOrchestrator(
    messageQueue,
    registry,
    redis
  )

  // Load pipeline definition
  const pipeline = createProductionPipeline()

  // IDEMPOTENCY: Use idempotency key to prevent duplicate processing
  const idempotencyKey = 'document-12345-2024-12-22'

  try {
    console.log('📝 Executing pipeline with idempotency key:', idempotencyKey)
    
    const pipelineId = await orchestrator.execute(
      pipeline,
      {
        documentUrl: 's3://documents/invoice-2024.pdf',
        documentId: 'doc-12345'
      },
      {
        idempotencyKey,  // Prevents duplicate execution
        priority: 1
      }
    )

    console.log('✅ Pipeline started:', pipelineId)

    // Try to execute again with same idempotency key
    console.log('\n🔄 Attempting duplicate execution...')
    const duplicatePipelineId = await orchestrator.execute(
      pipeline,
      {
        documentUrl: 's3://documents/invoice-2024.pdf',
        documentId: 'doc-12345'
      },
      {
        idempotencyKey,  // Same key - should return existing pipeline
        priority: 1
      }
    )

    console.log('🛡️  Idempotency check:', 
      pipelineId === duplicatePipelineId 
        ? '✅ Duplicate prevented!' 
        : '❌ Duplicate created'
    )

    // Demonstrate approval workflow
    console.log('\n👤 Simulating human approval workflow...')
    
    // Wait a bit for approval to be created
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Get pending approvals
    const pendingApprovals = await orchestrator.getPendingApprovals()
    console.log(`📋 Pending approvals: ${pendingApprovals.length}`)

    if (pendingApprovals.length > 0) {
      const approval = pendingApprovals[0]
      console.log(`   Approval ID: ${approval.approvalId}`)
      console.log(`   Stage: ${approval.stageId}`)
      console.log(`   Assigned to: ${approval.assignedTo?.join(', ')}`)

      // Submit approval
      console.log('✍️  Submitting approval decision...')
      await orchestrator.submitApproval(
        approval.approvalId,
        {
          approved: true,
          comment: 'Document looks good, approved by supervisor',
          metadata: {
            reviewedFields: ['classification', 'confidence'],
            additionalNotes: 'High quality scan'
          }
        },
        'supervisor@example.com'
      )
      console.log('✅ Approval submitted')
    }

    // Subscribe to approval notifications
    console.log('\n📢 Subscribing to approval notifications...')
    orchestrator.subscribeToApprovals((approval) => {
      console.log('🔔 New approval request:', approval.approvalId)
    })

    // Monitor pipeline status
    console.log('\n📊 Monitoring pipeline...')
    const status = await orchestrator.getPipelineStatus(pipelineId)
    console.log('Pipeline status:', status)

    // Show circuit breaker stats
    console.log('\n🔌 Circuit Breaker Stats:')
    const cbStats = await orchestrator['circuitBreaker'].getStats('pdf-extractor')
    console.log('  PDF Extractor:', cbStats)

    // Show saga status
    console.log('\n🔄 Saga Coordinator Status:')
    const sagaStatus = await orchestrator['sagaCoordinator'].getStatus(pipelineId)
    console.log('  Compensations recorded:', sagaStatus.compensations.length)

  } catch (error) {
    console.error('❌ Pipeline failed:', error)
    
    // Saga will automatically rollback compensations on failure
    console.log('🔄 Saga coordinator executing compensations...')
  } finally {
    // Cleanup
    await redis.quit()
  }
}

/**
 * Step 4: Query actors by metadata
 */
async function discoverActors() {
  console.log('\n🔍 Discovering actors by metadata...\n')

  const result = await loadActorConfig({
    configPath: './actors.config.example.yaml'
  })

  // Find all document processing actors
  const docProcessingActors = result.actors.filter(actor =>
    actor.tags?.includes('document-processing')
  )
  console.log(`📄 Document Processing Actors: ${docProcessingActors.length}`)
  docProcessingActors.forEach(actor => {
    console.log(`  - ${actor.name} (${actor.type})`)
  })

  // Find all AI agents
  const aiAgents = result.actors.filter(actor =>
    actor.category === 'ai-agent'
  )
  console.log(`\n🤖 AI Agents: ${aiAgents.length}`)
  aiAgents.forEach(actor => {
    console.log(`  - ${actor.name}`)
    if (actor.aiContext) {
      console.log(`    Purpose: ${actor.aiContext.purpose}`)
      console.log(`    Estimated cost: ${actor.aiContext.estimatedCost?.approximate} ${actor.aiContext.estimatedCost?.unit}`)
    }
  })

  // Find actors requiring specific permissions
  const actorsNeedingS3 = result.actors.filter(actor =>
    actor.permissions?.storage?.some(s => s.type === 's3')
  )
  console.log(`\n☁️  Actors needing S3 access: ${actorsNeedingS3.length}`)
  actorsNeedingS3.forEach(actor => {
    console.log(`  - ${actor.name}`)
  })

  // Find actors with PII handling
  const piiActors = result.actors.filter(actor =>
    actor.policies?.piiHandling === true
  )
  console.log(`\n🔒 Actors handling PII: ${piiActors.length}`)
  piiActors.forEach(actor => {
    console.log(`  - ${actor.name}`)
    console.log(`    Data classification: ${actor.policies?.dataClassification}`)
    console.log(`    Retention: ${actor.policies?.dataRetention}`)
  })

  // Find stable production-ready actors
  const stableActors = result.actors.filter(actor =>
    actor.lifecycle?.stage === 'stable'
  )
  console.log(`\n✅ Production-ready (stable) actors: ${stableActors.length}`)
  stableActors.forEach(actor => {
    console.log(`  - ${actor.name} v${actor.version}`)
  })
}

/**
 * Main execution
 */
async function main() {
  try {
    // Step 1: Discover actors
    await loadActors()

    // Step 2: Query by metadata
    await discoverActors()

    // Step 3: Run production pipeline
    await runProductionPipeline()

    console.log('\n✅ All patterns demonstrated successfully!')
    console.log('\nPatterns used:')
    console.log('  ✓ Idempotency (pipeline-level deduplication)')
    console.log('  ✓ Retry (exponential and fixed backoff)')
    console.log('  ✓ Circuit Breaker (fail-fast protection)')
    console.log('  ✓ Saga (compensating transactions)')
    console.log('  ✓ Human Approval (multi-channel notifications)')
    console.log('\nActor Metadata:')
    console.log('  ✓ Structured metadata with JSON schemas')
    console.log('  ✓ AI context and capabilities')
    console.log('  ✓ Security policies and permissions')
    console.log('  ✓ Config file loading with validation')
    console.log('  ✓ Environment variable substitution')

  } catch (error) {
    console.error('Fatal error:', error)
    process.exit(1)
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error)
}

export { loadActors, createProductionPipeline, runProductionPipeline, discoverActors }
