/**
 * Example: Accessing Pipeline and Journal Information in a Running Loom Application
 * 
 * This demonstrates how to query pipeline state, journal entries, and recovery
 * information from within a Loom-based application.
 */

import { Redis } from 'ioredis'
import { PipelineOrchestrator } from '../src/pipelines/pipeline-orchestrator'
import { RedisPipelineStateStore } from '../src/pipelines/pipeline-state-store'
import { RedisJournalStore } from '../src/storage/redis-journal-store'
import { BullMQMessageQueue } from '../src/messaging/bullmq-message-queue'
import { ActorRuntime } from '../src/actor/actor-runtime'

// ---------------------------------------------------------------------------
// 1. Access Pipeline State (Running, Completed, Failed pipelines)
// ---------------------------------------------------------------------------

async function queryPipelineState() {
  const redis = new Redis()
  const stateStore = new RedisPipelineStateStore(redis)

  // List all currently running pipelines
  const runningPipelines = await stateStore.listRunningPipelines(100)
  console.log('Running pipelines:', runningPipelines)

  // Get detailed information about a specific pipeline
  const pipelineId = 'pipeline-123'
  const pipelineRecord = await stateStore.getPipeline(pipelineId)
  
  if (pipelineRecord) {
    console.log('Pipeline Status:', {
      id: pipelineRecord.pipelineId,
      status: pipelineRecord.status, // 'running' | 'completed' | 'failed' | 'paused'
      createdAt: new Date(pipelineRecord.createdAt),
      startedAt: new Date(pipelineRecord.startedAt),
      completedAt: pipelineRecord.completedAt ? new Date(pipelineRecord.completedAt) : null,
      activeStages: pipelineRecord.activeStages,
      stageOrder: pipelineRecord.stageOrder,
      definition: pipelineRecord.definition,
      metadata: pipelineRecord.metadata
    })
  }

  // Get the current pipeline context (shared data between stages)
  const context = await stateStore.getLatestContext(pipelineId)
  if (context) {
    console.log('Pipeline Context:', {
      version: context.version,
      timestamp: new Date(context.timestamp),
      data: context.data
    })
  }

  await redis.quit()
}

// ---------------------------------------------------------------------------
// 2. Access Stage-Level State
// ---------------------------------------------------------------------------

async function queryStageState() {
  const redis = new Redis()
  const stateStore = new RedisPipelineStateStore(redis)

  const pipelineId = 'pipeline-123'
  const stageName = 'extract-data'

  // Get detailed stage information
  const stageRecord = await stateStore.getStage(pipelineId, stageName)
  
  if (stageRecord) {
    console.log('Stage Status:', {
      name: stageRecord.stageName,
      status: stageRecord.status, // 'pending' | 'running' | 'completed' | 'failed' | 'paused'
      startedAt: stageRecord.startedAt ? new Date(stageRecord.startedAt) : null,
      completedAt: stageRecord.completedAt ? new Date(stageRecord.completedAt) : null,
      attempt: stageRecord.attempt,
      expectedTasks: stageRecord.expectedTasks,
      completedTasks: stageRecord.completedTasks,
      error: stageRecord.error,
      pendingApprovalId: stageRecord.pendingApprovalId // For human-approval stages
    })

    // Get outputs from this stage
    const outputs = await stateStore.getStageOutputs(pipelineId, stageName, stageRecord.attempt)
    console.log('Stage Outputs:', outputs)

    // Get pending tasks for parallel execution stages (scatter, broadcast)
    const pendingTasks = await stateStore.getPendingTasks(pipelineId, stageName)
    console.log('Pending Tasks:', pendingTasks.map(task => ({
      index: task.taskIndex,
      status: task.status,
      actor: task.actor,
      retries: task.retryCount,
      lastError: task.lastError
    })))

    // Get task status map (for scatter/broadcast patterns)
    const taskStatusMap = await stateStore.getTaskStatusMap(pipelineId, stageName)
    console.log('Task Status Map:', taskStatusMap)
  }

  await redis.quit()
}

// ---------------------------------------------------------------------------
// 3. Access Actor Journal (Event Sourcing Data)
// ---------------------------------------------------------------------------

async function queryActorJournal() {
  const redis = new Redis()
  const journalStore = new RedisJournalStore(redis)

  const actorId = 'user-123-calculator'

  // Read all journal entries for an actor
  const entries = await journalStore.readEntries(actorId)
  console.log(`Actor ${actorId} has ${entries.length} journal entries`)

  // Examine recent entries
  entries.slice(-10).forEach(entry => {
    console.log('Journal Entry:', {
      sequence: entry.sequence,
      type: entry.type, // 'invocation' | 'decision' | 'state-changed' | 'emit' | etc.
      timestamp: new Date(entry.timestamp),
      entry
    })
  })

  // Get latest snapshot (for fast recovery)
  const snapshot = await journalStore.getLatestSnapshot(actorId)
  if (snapshot) {
    console.log('Latest Snapshot:', {
      sequence: snapshot.sequence,
      timestamp: new Date(snapshot.timestamp),
      state: snapshot.state,
      entriesAfterSnapshot: entries.filter(e => e.sequence > snapshot.sequence).length
    })
  }

  // Get journal statistics
  const stats = await journalStore.getStats(actorId)
  console.log('Journal Stats:', {
    entryCount: stats.entryCount,
    snapshotCount: stats.snapshotCount,
    lastEntryTimestamp: stats.lastEntryTimestamp ? new Date(stats.lastEntryTimestamp) : null
  })

  await redis.quit()
}

// ---------------------------------------------------------------------------
// 4. Monitor Pipeline Progress in Real-Time
// ---------------------------------------------------------------------------

async function monitorPipelineProgress(pipelineId: string) {
  const redis = new Redis()
  const stateStore = new RedisPipelineStateStore(redis)

  console.log(`\n📊 Monitoring pipeline: ${pipelineId}`)
  
  const pipeline = await stateStore.getPipeline(pipelineId)
  if (!pipeline) {
    console.log('Pipeline not found')
    await redis.quit()
    return
  }

  console.log(`Status: ${pipeline.status}`)
  console.log(`Stages: ${pipeline.stageOrder.join(' → ')}`)
  console.log(`Active: [${pipeline.activeStages.join(', ')}]`)

  // Check progress of each stage
  for (const stageName of pipeline.stageOrder) {
    const stage = await stateStore.getStage(pipelineId, stageName)
    if (!stage) continue

    const progress = stage.expectedTasks > 0
      ? `${stage.completedTasks}/${stage.expectedTasks} tasks`
      : 'single task'

    console.log(`  ${stageName}: ${stage.status} (${progress})`)

    if (stage.status === 'failed' && stage.error) {
      console.log(`    ❌ Error: ${stage.error.message}`)
    }

    if (stage.pendingApprovalId) {
      console.log(`    ⏸️  Waiting for approval: ${stage.pendingApprovalId}`)
    }
  }

  await redis.quit()
}

// ---------------------------------------------------------------------------
// 5. Resume Failed/Interrupted Pipelines
// ---------------------------------------------------------------------------

async function resumePipelines() {
  const redis = new Redis()
  const stateStore = new RedisPipelineStateStore(redis)
  const messageQueue = new BullMQMessageQueue('loom', { redis })
  
  // Create orchestrator (will automatically resume in-flight pipelines)
  const orchestrator = new PipelineOrchestrator({
    stateStore,
    messageQueue
  })

  console.log('🔄 Orchestrator initialized - will resume any in-flight pipelines...')
  
  // The orchestrator automatically calls resumeInFlightPipelines() on startup
  // You can also manually trigger resume for specific pipelines:
  
  const runningPipelines = await stateStore.listRunningPipelines()
  console.log(`Found ${runningPipelines.length} pipelines to potentially resume`)

  // Clean up
  await orchestrator.close()
  await messageQueue.close()
  await redis.quit()
}

// ---------------------------------------------------------------------------
// 6. Check Circuit Breaker Status
// ---------------------------------------------------------------------------

async function checkCircuitBreakers() {
  const redis = new Redis()
  
  // Circuit breaker state is stored in Redis with keys like:
  // circuit-breaker:<actorType>:<operation>
  const keys = await redis.keys('circuit-breaker:*')
  
  for (const key of keys) {
    const state = await redis.get(key)
    if (state) {
      const data = JSON.parse(state)
      console.log('Circuit Breaker:', {
        key,
        state: data.state, // 'closed' | 'open' | 'half-open'
        failures: data.failures,
        lastFailureAt: data.lastFailureAt ? new Date(data.lastFailureAt) : null
      })
    }
  }

  await redis.quit()
}

// ---------------------------------------------------------------------------
// 7. Complete Example: Build a Pipeline Status Dashboard
// ---------------------------------------------------------------------------

async function pipelineDashboard() {
  const redis = new Redis()
  const stateStore = new RedisPipelineStateStore(redis)

  console.log('\n' + '='.repeat(60))
  console.log('LOOM PIPELINE DASHBOARD')
  console.log('='.repeat(60))

  // Get all running pipelines
  const runningPipelines = await stateStore.listRunningPipelines(50)
  
  console.log(`\n📈 Running Pipelines: ${runningPipelines.length}`)
  
  for (const pipelineId of runningPipelines.slice(0, 10)) {
    const pipeline = await stateStore.getPipeline(pipelineId)
    if (!pipeline) continue

    const elapsed = Date.now() - pipeline.startedAt
    const elapsedMin = Math.floor(elapsed / 60000)
    
    console.log(`\n  🔹 ${pipelineId}`)
    console.log(`     Status: ${pipeline.status}`)
    console.log(`     Runtime: ${elapsedMin} min`)
    console.log(`     Active: [${pipeline.activeStages.join(', ')}]`)

    // Show progress for active stages
    for (const stageName of pipeline.activeStages) {
      const stage = await stateStore.getStage(pipelineId, stageName)
      if (!stage) continue

      if (stage.expectedTasks > 0) {
        const percent = Math.round((stage.completedTasks / stage.expectedTasks) * 100)
        console.log(`       └─ ${stageName}: ${percent}% (${stage.completedTasks}/${stage.expectedTasks})`)
      } else {
        console.log(`       └─ ${stageName}: ${stage.status}`)
      }
    }
  }

  console.log('\n' + '='.repeat(60) + '\n')

  await redis.quit()
}

// ---------------------------------------------------------------------------
// 8. Usage Examples
// ---------------------------------------------------------------------------

async function main() {
  try {
    // Query pipeline state
    await queryPipelineState()

    // Query stage-level details
    await queryStageState()

    // Access actor journal
    await queryActorJournal()

    // Monitor specific pipeline
    await monitorPipelineProgress('pipeline-123')

    // Resume interrupted pipelines
    await resumePipelines()

    // Check circuit breakers
    await checkCircuitBreakers()

    // Show dashboard
    await pipelineDashboard()

  } catch (error) {
    console.error('Error:', error)
  }
}

// Run examples (uncomment to execute)
// main()

export {
  queryPipelineState,
  queryStageState,
  queryActorJournal,
  monitorPipelineProgress,
  resumePipelines,
  checkCircuitBreakers,
  pipelineDashboard
}
