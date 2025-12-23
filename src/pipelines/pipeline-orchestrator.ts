/**
 * Pipeline Orchestrator - REAL implementation using existing Loom infrastructure
 * 
 * Uses:
 * - BullMQMessageQueue for Redis message passing
 * - ActorRegistry for actor discovery
 * - Pipeline DSL for definitions
 */

import { BullMQMessageQueue } from '../storage/bullmq-message-queue'
import { ActorRegistry } from '../discovery'
import { PipelineDefinition, StageDefinition } from './pipeline-dsl'
import type { PipelineMessage } from './stage-executor'
import { Redis } from 'ioredis'
import * as jp from 'jsonpath'
import { v4 as uuidv4 } from 'uuid'
import { StageExecutor, ExecutionContext } from './stage-executor'
import {
  SingleExecutor,
  ScatterExecutor,
  GatherExecutor,
  BroadcastExecutor,
  ForkJoinExecutor
} from './builtin-executors'
import { OutboxRelay, StateUpdate } from './outbox'
import { CircuitBreakerManager } from './circuit-breaker'
import { SagaCoordinator } from './saga-coordinator'
import { HumanApprovalExecutor, ApprovalTimeoutHandler, ApprovalDecision } from './human-approval-executor'

interface PipelineExecutionState {
  pipelineId: string
  definition: PipelineDefinition
  context: Record<string, any>
  currentStageIndex: number
  stageStates: Map<string, StageState>
}

interface StageState {
  stageName: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  expectedTasks: number
  completedTasks: number
  outputs: any[]
}

/**
 * Real Pipeline Orchestrator using BullMQ
 */
export class PipelineOrchestrator {
  private messageQueue: BullMQMessageQueue
  private actorRegistry: ActorRegistry
  private redis: Redis
  private pipelines = new Map<string, PipelineExecutionState>()
  private executors = new Map<string, StageExecutor>()
  private outboxRelay: OutboxRelay
  private circuitBreaker: CircuitBreakerManager
  private sagaCoordinator: SagaCoordinator
  private approvalTimeoutHandler: ApprovalTimeoutHandler

  constructor(
    messageQueue: BullMQMessageQueue,
    actorRegistry: ActorRegistry,
    redis: Redis
  ) {
    this.messageQueue = messageQueue
    this.actorRegistry = actorRegistry
    this.redis = redis
    this.outboxRelay = new OutboxRelay(redis, messageQueue)
    this.circuitBreaker = new CircuitBreakerManager(redis, messageQueue)
    this.sagaCoordinator = new SagaCoordinator(redis, messageQueue)
    this.approvalTimeoutHandler = new ApprovalTimeoutHandler(redis, messageQueue)
    
    // Register timeout handler for human approvals
    this.approvalTimeoutHandler.register()
    
    // Register built-in executors
    this.registerBuiltinExecutors()
    
    // Register worker for stage completion messages
    this.messageQueue.registerWorker<PipelineMessage>(
      'pipeline-stage-results',
      (msg) => this.handleStageResult(msg),
      10
    )
  }

  /**
   * Register built-in stage executors
   */
  private registerBuiltinExecutors(): void {
    this.registerExecutor(new SingleExecutor())
    this.registerExecutor(new ScatterExecutor())
    this.registerExecutor(new GatherExecutor())
    this.registerExecutor(new BroadcastExecutor())
    this.registerExecutor(new ForkJoinExecutor())
    this.registerExecutor(new HumanApprovalExecutor())
    
    console.log('📦 Registered built-in executors: single, scatter, gather, broadcast, fork-join, human-approval')
  }

  /**
   * Register a custom stage executor
   */
  registerExecutor(executor: StageExecutor): void {
    this.executors.set(executor.getName(), executor)
    console.log(`📦 Registered executor: ${executor.getName()}`)
  }

  /**
   * Get executor by name
   */
  private getExecutor(mode: string): StageExecutor {
    const executor = this.executors.get(mode)
    if (!executor) {
      throw new Error(`Unknown executor mode: ${mode}. Available: ${Array.from(this.executors.keys()).join(', ')}`)
    }
    return executor
  }

  /**
   * Execute a pipeline
   */
  async execute(
    definition: PipelineDefinition, 
    triggerData: any,
    options?: { idempotencyKey?: string }
  ): Promise<string> {
    // Use idempotency key if provided, otherwise generate new ID
    const pipelineId = options?.idempotencyKey 
      ? `pipeline:idempotent:${options.idempotencyKey}`
      : `pipeline:${uuidv4()}`
    
    // Check if pipeline already exists (idempotency)
    if (options?.idempotencyKey) {
      const existing = await this.redis.get(`${pipelineId}:state`)
      if (existing) {
        const state = JSON.parse(existing)
        console.log(`\n♻️  Pipeline already exists (idempotent): ${definition.name}`)
        console.log(`   Pipeline ID: ${pipelineId}`)
        console.log(`   Status: ${state.status || 'running'}`)
        return pipelineId
      }
    }
    
    console.log(`\n🚀 Starting pipeline: ${definition.name}`)
    console.log(`   Pipeline ID: ${pipelineId}`)
    if (options?.idempotencyKey) {
      console.log(`   Idempotency Key: ${options.idempotencyKey}`)
    }
    
    // Initialize pipeline state
    const state: PipelineExecutionState = {
      pipelineId,
      definition,
      context: {
        trigger: triggerData,
        stages: {}
      },
      currentStageIndex: 0,
      stageStates: new Map()
    }
    
    // Initialize stage states
    for (const stage of definition.stages) {
      state.stageStates.set(stage.name, {
        stageName: stage.name,
        status: 'pending',
        expectedTasks: 0,
        completedTasks: 0,
        outputs: []
      })
    }
    
    this.pipelines.set(pipelineId, state)
    
    // Store in Redis
    await this.redis.set(
      `pipeline:${pipelineId}:state`,
      JSON.stringify({
        definition,
        context: state.context,
        currentStageIndex: 0
      })
    )
    
    // Start first stage
    await this.executeStage(pipelineId, definition.stages[0])
    
    return pipelineId
  }

  /**
   * Execute a pipeline stage using pluggable executors
   */
  private async executeStage(pipelineId: string, stage: StageDefinition): Promise<void> {
    const state = this.pipelines.get(pipelineId)!
    const stageState = state.stageStates.get(stage.name)!
    
    console.log(`\n📍 Executing stage: ${stage.name} (${stage.mode})`)
    
    // Check circuit breaker if configured
    if (stage.circuitBreaker) {
      await this.circuitBreaker.setConfig(stage.actor, stage.circuitBreaker)
      
      const allowed = await this.circuitBreaker.shouldAllow(stage.actor)
      if (!allowed) {
        throw new Error(`Circuit breaker OPEN for actor: ${stage.actor}`)
      }
      console.log(`   ⚡ Circuit breaker: CLOSED (allowing execution)`)
    }
    
    stageState.status = 'running'
    
    // Get executor for this mode
    const executor = this.getExecutor(stage.mode)
    
    // Validate stage configuration
    if (!executor.validate(stage)) {
      throw new Error(`Invalid configuration for ${stage.mode} executor in stage ${stage.name}`)
    }
    
    // Execute using pluggable executor
    const context: ExecutionContext = {
      pipelineId,
      stage,
      pipelineContext: state.context,
      messageQueue: this.messageQueue,
      redis: this.redis
    }
    
    const result = await executor.execute(context)
    
    // Update barrier count
    stageState.expectedTasks = result.expectedTasks
    
    // Handle synchronous results (e.g., human-approval)
    if (result.expectedTasks === 0 && result.metadata?.synchronousResult) {
      console.log(`   ⚡ Synchronous stage completed immediately`)
      
      // Store result and complete stage immediately
      stageState.outputs.push(result.metadata.synchronousResult)
      stageState.completedTasks = 1
      stageState.status = 'completed'
      state.context.stages[stage.name] = stageState.outputs
      
      // Record compensation if configured (saga pattern)
      if (stage.compensation) {
        await this.sagaCoordinator.recordCompensation(
          pipelineId,
          stage,
          stageState.outputs
        )
      }
      
      // Move to next stage immediately
      const currentIndex = state.definition.stages.findIndex(s => s.name === stage.name)
      if (currentIndex < state.definition.stages.length - 1) {
        const nextStage = state.definition.stages[currentIndex + 1]
        
        try {
          await this.executeStage(pipelineId, nextStage)
        } catch (error) {
          console.error(`\n❌ Stage ${nextStage.name} failed:`, error)
          await this.handlePipelineFailure(pipelineId, error)
        }
      } else {
        console.log(`\n🎉 Pipeline ${pipelineId} COMPLETED`)
        await this.sagaCoordinator.clearCompensations(pipelineId)
        this.pipelines.delete(pipelineId)
      }
    }
    
    await this.redis.set(`${pipelineId}:stage:${stage.name}`, JSON.stringify(stageState))
  }

  /**
   * Execute single actor stage
   */
  private async executeSingleStage(
    pipelineId: string,
    state: PipelineExecutionState,
    stage: StageDefinition,
    stageState: StageState
  ): Promise<void> {
    const input = this.resolveInput(stage.input, state.context)
    
    console.log(`   🎯 Single actor: ${stage.actor}`)
    
    // Create message
    const message: PipelineMessage = {
      messageId: uuidv4(),
      from: pipelineId,
      to: stage.actor,
      type: 'execute',
      payload: {
        pipelineId,
        stageName: stage.name,
        taskIndex: 0,
        input
      },
      timestamp: new Date().toISOString()
    }
    
    stageState.expectedTasks = 1
    
    // Atomically write message + state to outbox
    await this.outboxRelay.writeToOutbox(
      pipelineId,
      [{ queueName: `actor-${stage.actor}`, message, stage }],
      [{ key: `pipeline:${pipelineId}:stage:${stage.name}`, value: JSON.stringify(stageState) }]
    )
    console.log(`   ✅ Message written to outbox for: actor-${stage.actor}`)
  }

  /**
   * Execute scatter stage (FAN-OUT)
   */
  private async executeScatterStage(
    pipelineId: string,
    state: PipelineExecutionState,
    stage: StageDefinition,
    stageState: StageState
  ): Promise<void> {
    if (!stage.scatter) {
      throw new Error(`Stage ${stage.name} missing scatter config`)
    }
    
    // Resolve items to scatter over
    let items = jp.query(state.context, stage.scatter.input)
    
    if (items.length > 0 && Array.isArray(items[0])) {
      items = items.flat()
    }
    
    console.log(`   🔀 SCATTER: Fan-out over ${items.length} items`)
    console.log(`   📨 Enqueuing ${items.length} messages to BullMQ`)
    
    const messages: Array<{ queueName: string; message: PipelineMessage; stage: StageDefinition }> = []
    
    // Create messages for each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      
      // Create scoped context
      const scopedContext = {
        ...state.context,
        [stage.scatter.as]: item
      }
      
      const input = this.resolveInput(stage.input, scopedContext)
      
      const message: PipelineMessage = {
        messageId: uuidv4(),
        from: pipelineId,
        to: stage.actor,
        type: 'execute',
        payload: {
          pipelineId,
          stageName: stage.name,
          taskIndex: i,
          input
        },
        timestamp: new Date().toISOString()
      }
      
      messages.push({ queueName: `actor-${stage.actor}`, message, stage })
    }
    
    stageState.expectedTasks = items.length
    
    // Atomically write all messages + state to outbox
    await this.outboxRelay.writeToOutbox(
      pipelineId,
      messages,
      [{ key: `pipeline:${pipelineId}:stage:${stage.name}`, value: JSON.stringify(stageState) }]
    )
    console.log(`   ✅ ${items.length} messages written to outbox for: actor-${stage.actor}`)
  }

  /**
   * Execute gather stage (BARRIER + GROUP)
   */
  private async executeGatherStage(
    pipelineId: string,
    state: PipelineExecutionState,
    stage: StageDefinition,
    stageState: StageState
  ): Promise<void> {
    if (!stage.gather) {
      throw new Error(`Stage ${stage.name} missing gather config`)
    }
    
    console.log(`   🎯 GATHER: Collecting from stage ${stage.gather.stage}`)
    
    // Get outputs from target stage
    const targetStageState = state.stageStates.get(stage.gather.stage)!
    const targetOutputs = targetStageState.outputs
    
    console.log(`   📊 Collected ${targetOutputs.length} outputs`)
    
    // Group by key if specified
    if (stage.gather.groupBy) {
      const groups = new Map<string, any[]>()
      
      for (const item of targetOutputs) {
        const groupKey = jp.value(item, stage.gather.groupBy)
        if (!groups.has(groupKey)) {
          groups.set(groupKey, [])
        }
        groups.get(groupKey)!.push(item)
      }
      
      console.log(`   📦 Grouped into ${groups.size} groups by ${stage.gather.groupBy}`)
      
      const groupMessages: Array<{ queueName: string; message: PipelineMessage; stage: StageDefinition }> = []
      
      // Create messages for each group
      let groupIndex = 0
      for (const [key, items] of groups.entries()) {
        const scopedContext = {
          ...state.context,
          group: { key, items }
        }
        
        const input = this.resolveInput(stage.input, scopedContext)
        
        const message: PipelineMessage = {
          messageId: uuidv4(),
          from: pipelineId,
          to: stage.actor,
          type: 'execute',
          payload: {
            pipelineId,
            stageName: stage.name,
            taskIndex: groupIndex,
            groupKey: key,
            input
          },
          timestamp: new Date().toISOString()
        }
        
        groupMessages.push({ queueName: `actor-${stage.actor}`, message, stage })
        console.log(`      └─ Group "${key}": ${items.length} items`)
        groupIndex++
      }
      
      stageState.expectedTasks = groups.size
      
      // Atomically write all group messages + state to outbox
      await this.outboxRelay.writeToOutbox(
        pipelineId,
        groupMessages,
        [{ key: `pipeline:${pipelineId}:stage:${stage.name}`, value: JSON.stringify(stageState) }]
      )
      console.log(`   ✅ ${groups.size} group messages written to outbox for: actor-${stage.actor}`)
    } else {
      // No grouping - single consolidation
      await this.executeSingleStage(pipelineId, state, stage, stageState)
    }
  }

  /**
   * Handle stage result from worker
   */
  private async handleStageResult(message: PipelineMessage): Promise<void> {
    const { pipelineId, stageName, taskIndex, output } = message.payload
    
    console.log(`   ✅ Task ${taskIndex} completed for stage ${stageName}`)
    
    const state = this.pipelines.get(pipelineId)
    if (!state) {
      // Pipeline already completed - this can happen with broadcast (waitForAll: false)
      // where some tasks complete after the pipeline finishes
      return
    }
    
    const stageState = state.stageStates.get(stageName)!
    
    // Add output
    stageState.outputs.push(output)
    stageState.completedTasks++
    
    console.log(`   📊 Progress: ${stageState.completedTasks}/${stageState.expectedTasks}`)
    
    // Check if stage complete (barrier)
    if (stageState.completedTasks >= stageState.expectedTasks) {
      console.log(`   🎯 BARRIER RELEASED: Stage ${stageName} complete`)
      stageState.status = 'completed'
      
      // Store outputs in context
      state.context.stages[stageName] = stageState.outputs
      
      // Record compensation for successful stage (saga pattern)
      const stage = state.definition.stages.find(s => s.name === stageName)
      if (stage?.compensation) {
        await this.sagaCoordinator.recordCompensation(
          pipelineId,
          stage,
          stageState.outputs
        )
      }
      
      // Move to next stage
      const currentIndex = state.definition.stages.findIndex(s => s.name === stageName)
      if (currentIndex < state.definition.stages.length - 1) {
        const nextStage = state.definition.stages[currentIndex + 1]
        
        try {
          await this.executeStage(pipelineId, nextStage)
        } catch (error) {
          // Stage failed - trigger saga rollback
          console.error(`\n❌ Stage ${nextStage.name} failed:`, error)
          await this.handlePipelineFailure(pipelineId, error)
        }
      } else {
        console.log(`\n🎉 Pipeline ${pipelineId} COMPLETED`)
        
        // Clear compensations on successful completion
        await this.sagaCoordinator.clearCompensations(pipelineId)
        
        this.pipelines.delete(pipelineId)
      }
    }
  }
  
  /**
   * Handle pipeline failure - execute saga compensations
   */
  private async handlePipelineFailure(pipelineId: string, error: any): Promise<void> {
    console.error(`\n💥 Pipeline ${pipelineId} FAILED`)
    
    // Execute compensating transactions in reverse order
    if (await this.sagaCoordinator.hasPendingCompensations(pipelineId)) {
      await this.sagaCoordinator.executeCompensations(pipelineId)
    }
    
    // Mark pipeline as failed
    await this.redis.set(
      `pipeline:${pipelineId}:state`,
      JSON.stringify({ status: 'failed', error: error.message })
    )
    
    this.pipelines.delete(pipelineId)
  }

  /**
   * Resolve input from context using JSONPath
   */
  private resolveInput(inputDef: Record<string, string>, context: any): any {
    const resolved: any = {}
    
    for (const [key, path] of Object.entries(inputDef)) {
      if (path.startsWith('$')) {
        const value = jp.value(context, path)
        resolved[key] = value
      } else {
        resolved[key] = path
      }
    }
    
    return resolved
  }

  // ============================================================================
  // Human Approval API
  // ============================================================================

  /**
   * Submit approval decision for a pending approval
   * Called by external systems (UI, API, Slack bot, etc.)
   */
  async submitApproval(
    approvalId: string,
    decision: 'approve' | 'reject',
    decidedBy: string,
    comment?: string,
    metadata?: any
  ): Promise<void> {
    // Check if approval exists
    const requestJson = await this.redis.get(`approval:${approvalId}`)
    if (!requestJson) {
      throw new Error(`Approval not found or expired: ${approvalId}`)
    }

    const request = JSON.parse(requestJson)
    if (request.status !== 'pending') {
      throw new Error(`Approval already decided: ${request.status}`)
    }

    console.log(`\n✅ Approval decision received: ${approvalId}`)
    console.log(`   Decision: ${decision}`)
    console.log(`   Decided by: ${decidedBy}`)
    if (comment) {
      console.log(`   Comment: ${comment}`)
    }

    // Create decision object
    const approvalDecision: ApprovalDecision = {
      decision,
      decidedBy,
      decidedAt: Date.now(),
      comment,
      metadata
    }

    // Cancel timeout job
    await this.messageQueue.removeJob(`approval-timeout:${approvalId}`)

    // Publish decision to Redis pub/sub (executor is waiting for this)
    await this.redis.publish(
      `approval:decision:${approvalId}`,
      JSON.stringify(approvalDecision)
    )

    // Update approval status in Redis
    request.status = decision === 'approve' ? 'approved' : 'rejected'
    request.decision = approvalDecision
    await this.redis.setex(
      `approval:${approvalId}`,
      3600, // Keep for 1 hour for audit
      JSON.stringify(request)
    )

    // Remove from pending list
    await this.redis.zrem('approvals:pending', approvalId)
  }

  /**
   * Get pending approvals (for polling API or UI)
   */
  async getPendingApprovals(filter?: {
    pipelineId?: string
    assignTo?: string
    limit?: number
  }): Promise<any[]> {
    const limit = filter?.limit || 100

    // Get approval IDs from sorted set (ordered by creation time)
    const approvalIds = await this.redis.zrange(
      'approvals:pending',
      0,
      limit - 1
    )

    const approvals = []
    for (const approvalId of approvalIds) {
      const requestJson = await this.redis.get(`approval:${approvalId}`)
      if (requestJson) {
        const request = JSON.parse(requestJson)

        // Apply filters
        if (filter?.pipelineId && request.pipelineId !== filter.pipelineId) {
          continue
        }

        if (filter?.assignTo) {
          const assignees = Array.isArray(request.assignTo) ? request.assignTo : [request.assignTo]
          if (!assignees.includes(filter.assignTo)) {
            continue
          }
        }

        approvals.push(request)
      }
    }

    return approvals
  }

  /**
   * Get approval details by ID
   */
  async getApproval(approvalId: string): Promise<any | null> {
    const requestJson = await this.redis.get(`approval:${approvalId}`)
    return requestJson ? JSON.parse(requestJson) : null
  }

  /**
   * Subscribe to approval notifications (for real-time listeners)
   * Returns cleanup function to unsubscribe
   */
  subscribeToApprovals(
    callback: (approval: any) => void
  ): () => Promise<void> {
    const subscriber = this.redis.duplicate()

    subscriber.on('message', (channel, message) => {
      if (channel === 'approval:notification') {
        callback(JSON.parse(message))
      }
    })

    subscriber.subscribe('approval:notification')

    // Return cleanup function
    return async () => {
      await subscriber.unsubscribe('approval:notification')
      await subscriber.quit()
    }
  }

  /**
   * Cleanup
   */
  async close(): Promise<void> {
    await this.messageQueue.close()
  }
}
