/**
 * Pipeline Orchestrator - REAL implementation using existing Loom infrastructure
 * 
 * Uses:
 */
import { BullMQMessageQueue } from '../storage/bullmq-message-queue'
import { ActorRegistry } from '../discovery'
import type { MetricsCollector } from '../observability/types'
import { PipelineDefinition, StageDefinition, StageRetryPolicy } from './pipeline-dsl'
import type { PipelineMessage, ScheduledTaskRequest } from './stage-executor'
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
import type { PipelineStateStore, PipelineRecord } from './pipeline-state-store'
import { DEFAULT_TASK_LEASE_TTL_MS } from './pipeline-state-store'
import { CircuitBreakerManager } from './circuit-breaker'
import { SagaCoordinator } from './saga-coordinator'
import type { ApprovalDecision } from './human-approval-executor'

interface DeadLetterRecord {
  queueName: string
  archivedAt: number
  message: PipelineMessage
}

export class PipelineOrchestrator {
  private readonly messageQueue: BullMQMessageQueue
  private readonly actorRegistry: ActorRegistry
  private readonly redis: Redis
  private readonly stateStore: PipelineStateStore
  private readonly circuitBreaker: CircuitBreakerManager
  private readonly sagaCoordinator: SagaCoordinator
  private readonly pipelines = new Map<string, PipelineExecutionState>()
  private executors: Map<string, StageExecutor>
  private resumePromise: Promise<void>
  private readonly deadLetterWorkers = new Set<string>()
  private readonly deadLetterArchiveLimit = 100
  private readonly metricsCollector?: MetricsCollector

  constructor(
    messageQueue: BullMQMessageQueue,
    actorRegistry: ActorRegistry,
    redis: Redis,
    stateStore: PipelineStateStore,
    options?: { metricsCollector?: MetricsCollector }
  ) {
    this.messageQueue = messageQueue
    this.actorRegistry = actorRegistry
    this.redis = redis
    this.stateStore = stateStore
    this.metricsCollector = options?.metricsCollector
    this.circuitBreaker = new CircuitBreakerManager(redis, messageQueue)
    this.sagaCoordinator = new SagaCoordinator(redis, messageQueue)
    this.executors = new Map<string, StageExecutor>([
      ['single', new SingleExecutor()],
      ['scatter', new ScatterExecutor()],
      ['gather', new GatherExecutor()],
      ['broadcast', new BroadcastExecutor()],
      ['fork-join', new ForkJoinExecutor()]
    ])

    this.resumePromise = this.resumeInFlightPipelines().catch(error => {
      console.error('Failed to resume in-flight pipelines', error)
    })

    this.messageQueue.registerWorker<PipelineMessage>(
      'pipeline-stage-results',
      async (message) => {
        await this.handlePipelineMessage(message)
      }
    )
  }

  private async handlePipelineMessage(message: PipelineMessage): Promise<void> {
    if (message.type === 'failure') {
      await this.handleTaskFailure(message)
      return
    }

    if (message.type !== 'result') {
      return
    }

    await this.handleStageResult(message)
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
    await this.resumePromise

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
    const stageMap = new Map(definition.stages.map(stage => [stage.name, stage]))
    const stageGraph = this.buildStageGraph(definition)

    const state: PipelineExecutionState = {
      pipelineId,
      definition,
      context: {
        trigger: triggerData,
        stages: {}
      },
      stageStates: new Map(),
      stageMap,
      stageGraph,
      activeStages: new Set()
    }
    
    // Initialize stage states
    for (const stage of definition.stages) {
      state.stageStates.set(stage.name, {
        stageName: stage.name,
        status: 'pending',
        expectedTasks: 0,
        completedTasks: 0,
        outputs: [],
        attempt: 1,
        activeTasks: 0,
        pendingTasks: []
      })
    }
    
    this.pipelines.set(pipelineId, state)

    await this.stateStore.createPipeline({
      pipelineId,
      definition,
      triggerData,
      metadata: options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
      activeStages: []
    })

    await Promise.all(
      definition.stages.map(stage =>
        this.stateStore.upsertStage({
          pipelineId,
          stageName: stage.name,
          status: 'pending',
          attempt: 1,
          expectedTasks: 0,
          completedTasks: 0,
          updatedAt: Date.now()
        })
      )
    )

    await this.stateStore.snapshotContext(pipelineId, state.context)
    
    // Store in Redis
    await this.redis.set(
      `pipeline:${pipelineId}:state`,
      JSON.stringify({
        definition,
        context: state.context,
        activeStages: []
      })
    )
    
    // Start all entry stages in the DAG
    await this.startStages(pipelineId, stageGraph.entryStages)
    
    return pipelineId
  }

  /**
   * Execute a pipeline stage using pluggable executors
   */
  private async executeStage(pipelineId: string, stage: StageDefinition): Promise<void> {
    if (await this.abortIfCancelled(pipelineId)) {
      return
    }

    const state = this.pipelines.get(pipelineId)
    if (!state) {
      return
    }

    const stageState = state.stageStates.get(stage.name)
    if (!stageState || stageState.status === 'running' || stageState.status === 'completed') {
      return
    }
    
    console.log(`\n📍 Executing stage: ${stage.name} (${stage.mode})`)
    
    // Check circuit breaker if configured
    const actorType = typeof stage.actor === 'string' ? stage.actor : 'DynamicActor'
    if (stage.circuitBreaker) {
      await this.circuitBreaker.setConfig(actorType, stage.circuitBreaker)
      
      const allowed = await this.circuitBreaker.shouldAllow(actorType)
      if (!allowed) {
        throw new Error(`Circuit breaker OPEN for actor: ${actorType}`)
      }
      console.log(`   ⚡ Circuit breaker: CLOSED (allowing execution)`)
    }
    
    stageState.status = 'running'
    stageState.startedAt = Date.now()
    stageState.outputs = []

    state.activeStages.add(stage.name)

    await this.stateStore.clearStageOutputs(pipelineId, stage.name, stageState.attempt)

    await this.updatePipelineCursor(pipelineId, Array.from(state.activeStages))

    await this.stateStore.updateStageProgress({
      pipelineId,
      stageName: stage.name,
      status: 'running',
      startedAt: stageState.startedAt
    })
    
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
      redis: this.redis,
      stateStore: this.stateStore,
      stageAttempt: stageState.attempt,
      scheduleTask: async (task) => this.scheduleStageTask(pipelineId, stage, stageState, task)
    }
    
    const result = await executor.execute(context)
    
    // Update barrier count
    stageState.expectedTasks = result.expectedTasks

    await this.stateStore.updateStageProgress({
      pipelineId,
      stageName: stage.name,
      expectedTasks: result.expectedTasks
    })
    
    // Handle synchronous results (e.g., human-approval)
    if (result.expectedTasks === 0 && result.metadata?.synchronousResult) {
      console.log(`   ⚡ Synchronous stage completed immediately`)
      
      await this.stateStore.appendStageOutput(pipelineId, stage.name, stageState.attempt, result.metadata.synchronousResult)
      stageState.outputs.push(result.metadata.synchronousResult)
      stageState.completedTasks = 1

      await this.completeStage(pipelineId, stage, stageState, undefined, stageState.completedTasks)
    }
    
    await this.redis.set(`${pipelineId}:stage:${stage.name}`, JSON.stringify(stageState))
  }

  private async startStages(pipelineId: string, stageNames: string[]): Promise<void> {
    if (stageNames.length === 0) {
      return
    }

    const state = this.pipelines.get(pipelineId)
    if (!state) {
      return
    }

    for (const stageName of stageNames) {
      const stageDef = state.stageMap.get(stageName)
      const stageState = stageDef ? state.stageStates.get(stageName) : undefined
      if (!stageDef || !stageState || stageState.status !== 'pending') {
        continue
      }

      if (!this.areDependenciesMet(state, stageName)) {
        continue
      }

      try {
        await this.executeStage(pipelineId, stageDef)
      } catch (error) {
        console.error(`\n❌ Stage ${stageName} failed:`, error)
        await this.handlePipelineFailure(pipelineId, error)
        return
      }
    }
  }

  private async scheduleStageTask(
    pipelineId: string,
    stage: StageDefinition,
    stageState: StageState,
    task: ScheduledTaskRequest
  ): Promise<void> {
    if (await this.abortIfCancelled(pipelineId)) {
      return
    }

    const enrichedTask: ScheduledTaskRequest = {
      ...task,
      retryPolicy: task.retryPolicy ?? this.resolveRetryPolicy(stage),
      retryAttempt: task.retryAttempt ?? 1
    }

    if (enrichedTask.delayMs === undefined) {
      const stageDelay = this.getStageInitialDelay(stage)
      if (stageDelay > 0) {
        enrichedTask.delayMs = stageDelay
      }
    }

    stageState.pendingTasks ??= []

    if (this.shouldThrottleStage(stage, stageState)) {
      stageState.pendingTasks.push(enrichedTask)
      return
    }

    await this.dispatchStageTask(pipelineId, stage, stageState, enrichedTask)
  }

  private shouldThrottleStage(stage: StageDefinition, stageState: StageState): boolean {
    const limit = stage.config?.concurrency
    if (!limit || limit <= 0) {
      return false
    }
    return (stageState.activeTasks || 0) >= limit
  }

  private async dispatchStageTask(
    pipelineId: string,
    stage: StageDefinition,
    stageState: StageState,
    task: ScheduledTaskRequest
  ): Promise<void> {
    if (await this.abortIfCancelled(pipelineId)) {
      return
    }

    const lease = await this.createTaskLease(pipelineId, stage, task.taskIndex)
    stageState.activeTasks = (stageState.activeTasks || 0) + 1
    await this.enqueueActorJob(pipelineId, stage, stageState, task, lease)
  }

  private async createTaskLease(
    pipelineId: string,
    stage: StageDefinition,
    taskIndex: number
  ): Promise<TaskLeaseContext> {
    const lease: TaskLeaseContext = {
      leaseId: uuidv4(),
      ttlMs: this.getTaskLeaseTtl(stage)
    }

    await this.stateStore.ensureTaskLease({
      pipelineId,
      stageName: stage.name,
      taskIndex,
      leaseId: lease.leaseId,
      ttlMs: lease.ttlMs
    })

    return lease
  }

  private async enqueueActorJob(
    pipelineId: string,
    stage: StageDefinition,
    stageState: StageState,
    task: ScheduledTaskRequest,
    lease: TaskLeaseContext
  ): Promise<void> {
    const queueName = `actor-${task.actorType}`
    const retryAttempt = task.retryAttempt ?? 1
    const payloadMetadata = task.metadata ? { ...task.metadata } : {}
    const delayMs = task.delayMs ?? 0
    const availableAt = delayMs > 0 ? Date.now() + delayMs : undefined

    const message: PipelineMessage = {
      messageId: uuidv4(),
      from: pipelineId,
      to: task.actorType,
      type: 'execute',
      payload: {
        pipelineId,
        stageName: stage.name,
        taskIndex: task.taskIndex,
        input: task.input,
        metadata: payloadMetadata,
        attempt: stageState.attempt,
        retryAttempt,
        retryPolicy: task.retryPolicy,
        leaseId: lease.leaseId,
        leaseTtlMs: lease.ttlMs
      },
      timestamp: new Date().toISOString()
    }

    await this.messageQueue.enqueue(queueName, message, {
      jobId: this.buildJobId(pipelineId, stage.name, stageState.attempt, task.taskIndex, retryAttempt),
      attempts: 1,
      delay: delayMs
    })

    this.metricsCollector?.recordMessageEvent('sent')

    await this.stateStore.recordTaskAttempt({
      pipelineId,
      stageName: stage.name,
      taskIndex: task.taskIndex,
      attempt: stageState.attempt,
      retryAttempt,
      status: 'queued',
      queuedAt: Date.now(),
      availableAt,
      queueName,
      actorType: task.actorType,
      messageId: message.messageId,
      message,
      input: task.input,
      metadata: task.metadata,
      leaseId: lease.leaseId
    })
  }

  private async releaseThrottledTasks(
    pipelineId: string,
    stage: StageDefinition,
    stageState: StageState
  ): Promise<void> {
    if (!stageState.pendingTasks || stageState.pendingTasks.length === 0) {
      return
    }

    while (!this.shouldThrottleStage(stage, stageState) && stageState.pendingTasks.length > 0) {
      const nextTask = stageState.pendingTasks.shift()
      if (!nextTask) {
        break
      }
      await this.dispatchStageTask(pipelineId, stage, stageState, nextTask)
    }
  }

  private buildJobId(
    pipelineId: string,
    stageName: string,
    attempt: number,
    taskIndex: number,
    retryAttempt = 1
  ): string {
    const normalizedPipelineId = pipelineId.replace(/:/g, '_')
    return `${normalizedPipelineId}-${stageName}-${attempt}-${taskIndex}-r${retryAttempt}`
  }

  private resolveRetryPolicy(stage: StageDefinition): StageRetryPolicy | undefined {
    if (stage.retry) {
      return stage.retry
    }
    return stage.config?.retryPolicy
  }

  private getTaskLeaseTtl(stage: StageDefinition): number {
    return stage.config?.leaseTtlMs ?? DEFAULT_TASK_LEASE_TTL_MS
  }

  private getStageInitialDelay(stage: StageDefinition): number {
    return stage.config?.initialDelayMs ?? 0
  }

  private getDefaultDeadLetterQueueName(message: PipelineMessage, stage: StageDefinition): string | undefined {
    const actorFromPayload: string | undefined = message.payload?.actorType
    const staticActor = typeof stage.actor === 'string' ? stage.actor : undefined
    const actorType = actorFromPayload ?? staticActor
    return actorType ? `actor-${actorType}:dlq` : undefined
  }

  private sanitizeQueueName(queueName: string): string {
    return queueName.replace(/[:\s]+/g, '-')
  }

  private calculateBackoffDelay(policy: StageRetryPolicy | undefined, currentAttempt: number): number {
    if (!policy) {
      return 0
    }

    const base = policy.backoffDelay ?? 0
    if (policy.backoff === 'exponential') {
      const delay = base * Math.pow(2, currentAttempt - 1)
      if (policy.maxBackoffDelay) {
        return Math.min(delay, policy.maxBackoffDelay)
      }
      return delay
    }

    return base
  }

  private async updatePipelineCursor(pipelineId: string, activeStages: string[]): Promise<void> {
    const normalized = activeStages.filter(Boolean)
    const primary = normalized[0]

    await this.stateStore.setPipelineStatus(
      pipelineId,
      'running',
      normalized.length > 0
        ? {
            currentStage: primary,
            resumeCursor: { stageName: primary, stageNames: normalized },
            activeStages: normalized
          }
        : {
            currentStage: undefined,
            resumeCursor: undefined,
            activeStages: []
          }
    )
  }

  async waitForResume(): Promise<void> {
    await this.resumePromise
  }

  async listDeadLetterMessages(queueName: string, limit = 20): Promise<DeadLetterRecord[]> {
    const key = this.getDeadLetterArchiveKey(queueName)
    const entries = await this.redis.lrange(key, 0, limit - 1)
    return entries.map(entry => JSON.parse(entry) as DeadLetterRecord)
  }

  private resumeInFlightPipelines = async (): Promise<void> => {
    const runningPipelines = await this.stateStore.listRunningPipelines()
    if (runningPipelines.length === 0) {
      return
    }

    console.log(`\n♻️  Resuming ${runningPipelines.length} pipeline(s) from durable state`)

    for (const pipelineId of runningPipelines) {
      if (this.pipelines.has(pipelineId)) {
        continue
      }

      if (await this.stateStore.isPipelineCancelled(pipelineId)) {
        await this.handlePipelineCancellation(pipelineId)
        continue
      }

      const record = await this.stateStore.getPipeline(pipelineId)
      if (!record) {
        continue
      }

      const contextSnapshot = await this.stateStore.getLatestContext(pipelineId)
      const context = contextSnapshot?.data ?? {
        trigger: record.triggerData,
        stages: {}
      }

      const stageMap = new Map(record.definition.stages.map(stage => [stage.name, stage]))
      const stageGraph = this.buildStageGraph(record.definition)
      const stageStates = new Map<string, StageState>()
      const runningStages: string[] = []
      const pendingStages: string[] = []

      for (const stageDef of record.definition.stages) {
        const persistedStage = await this.stateStore.getStage(pipelineId, stageDef.name)
        const attempt = persistedStage?.attempt ?? 1
        let outputs: any[] = []
        if (persistedStage?.status === 'completed') {
          outputs = context.stages?.[stageDef.name] || []
        } else if (persistedStage) {
          outputs = await this.stateStore.getStageOutputs(pipelineId, stageDef.name, attempt)
        }
        if (persistedStage?.status === 'running') {
          runningStages.push(stageDef.name)
        } else if ((persistedStage?.status ?? 'pending') === 'pending') {
          pendingStages.push(stageDef.name)
        }
        stageStates.set(stageDef.name, {
          stageName: stageDef.name,
          status: persistedStage?.status ?? 'pending',
          expectedTasks: persistedStage?.expectedTasks ?? 0,
          completedTasks: persistedStage?.completedTasks ?? 0,
          outputs,
          attempt,
          startedAt: persistedStage?.startedAt,
          completedAt: persistedStage?.completedAt,
          activeTasks: 0,
          pendingTasks: []
        })
      }

      const activeStages = new Set(runningStages)

      const pipelineState: PipelineExecutionState = {
        pipelineId,
        definition: record.definition,
        context,
        stageStates,
        stageMap,
        stageGraph,
        activeStages
      }

      this.pipelines.set(pipelineId, pipelineState)

      for (const stageName of runningStages) {
        const stageDef = stageMap.get(stageName)
        if (stageDef) {
          await this.resumeStage(pipelineId, stageDef)
        }
      }

      await this.updatePipelineCursor(pipelineId, Array.from(activeStages))

      const readyPending = pendingStages.filter(stageName => this.areDependenciesMet(pipelineState, stageName))
      if (readyPending.length > 0) {
        await this.startStages(pipelineId, readyPending)
      }
    }
  }

  private async resumeStage(pipelineId: string, stage: StageDefinition): Promise<void> {
    if (await this.abortIfCancelled(pipelineId)) {
      return
    }

    const state = this.pipelines.get(pipelineId)
    if (!state) {
      return
    }

    const stageState = state.stageStates.get(stage.name)
    if (!stageState) {
      return
    }

    if (stageState.status === 'pending') {
      console.log(`   ♻️  Restarting pending stage: ${stage.name}`)
      await this.executeStage(pipelineId, stage)
      return
    }

    if (stageState.status === 'running') {
      if (!state.activeStages.has(stage.name)) {
        state.activeStages.add(stage.name)
        await this.updatePipelineCursor(pipelineId, Array.from(state.activeStages))
      }
      const pendingTasks = await this.stateStore.getPendingTasks(pipelineId, stage.name)
      const failedTasks = pendingTasks.filter(task => task.status === 'failed')
      if (failedTasks.length === 0) {
        return
      }

      console.log(`   ♻️  Replaying ${failedTasks.length} failed task(s) for stage ${stage.name}`)

      for (const task of failedTasks) {
        if (!task.actorType || !task.input) {
          continue
        }

        await this.scheduleStageTask(pipelineId, stage, stageState, {
          actorType: task.actorType,
          taskIndex: task.taskIndex,
          input: task.input,
          metadata: task.metadata,
          retryPolicy: this.resolveRetryPolicy(stage),
          retryAttempt: (task.retryAttempt ?? 0) + 1
        })
      }
    }
  }

  /**
   * Handle stage result from worker
   */
  private async handleStageResult(message: PipelineMessage): Promise<void> {
    await this.resumePromise

    const { pipelineId, stageName, taskIndex, output } = message.payload

    if (message.payload.leaseId) {
      await this.stateStore.releaseTaskLease(
        pipelineId,
        stageName,
        taskIndex,
        message.payload.leaseId
      )
    }

    if (await this.abortIfCancelled(pipelineId)) {
      return
    }
    
    console.log(`   ✅ Task ${taskIndex} completed for stage ${stageName}`)
    
    const state = this.pipelines.get(pipelineId)
    if (!state) {
      // Pipeline already completed - this can happen with broadcast (waitForAll: false)
      // where some tasks complete after the pipeline finishes
      return
    }
    
    const stageState = state.stageStates.get(stageName)
    if (!stageState) {
      return
    }

    const stage = state.definition.stages.find(s => s.name === stageName)
    if (!stage) {
      return
    }

    stageState.activeTasks = Math.max(0, (stageState.activeTasks || 0) - 1)

    const attemptFromMessage = message.payload.attempt
    const attempt = typeof attemptFromMessage === 'number' ? attemptFromMessage : stageState.attempt
    await this.stateStore.recordTaskAttempt({
      pipelineId,
      stageName,
      taskIndex,
      attempt,
      status: 'completed',
      completedAt: Date.now(),
      workerId: message.payload.workerId,
      output,
      messageId: message.messageId,
      retryAttempt: message.payload.retryAttempt
    })

    await this.stateStore.appendStageOutput(pipelineId, stageName, attempt, output)
    
    // Add output
    stageState.outputs.push(output)
    stageState.completedTasks++

    await this.stateStore.updateStageProgress({
      pipelineId,
      stageName,
      completedTasksDelta: 1
    })

    await this.releaseThrottledTasks(pipelineId, stage, stageState)
    
    console.log(`   📊 Progress: ${stageState.completedTasks}/${stageState.expectedTasks}`)
    
    // Check if stage complete (barrier)
    if (stageState.completedTasks >= stageState.expectedTasks) {
      console.log(`   🎯 BARRIER RELEASED: Stage ${stageName} complete`)
      const persistedOutputs = await this.stateStore.getStageOutputs(pipelineId, stageName, stageState.attempt)
      stageState.outputs = persistedOutputs
      await this.completeStage(pipelineId, stage, stageState, persistedOutputs)
    }
  }

  private async handleTaskFailure(message: PipelineMessage): Promise<void> {
    const { pipelineId, stageName, taskIndex } = message.payload
    console.error(`   ❌ Task ${taskIndex} failed for stage ${stageName}`)

    if (message.payload.leaseId) {
      await this.stateStore.releaseTaskLease(
        pipelineId,
        stageName,
        taskIndex,
        message.payload.leaseId
      )
    }

    if (await this.abortIfCancelled(pipelineId)) {
      return
    }

    const state = this.pipelines.get(pipelineId)
    if (!state) {
      return
    }

    const stageState = state.stageStates.get(stageName)
    const stage = state?.definition.stages.find(s => s.name === stageName)
    if (!stageState || !stage) {
      return
    }

    stageState.activeTasks = Math.max(0, (stageState.activeTasks || 0) - 1)

    const attempt = typeof message.payload.attempt === 'number' ? message.payload.attempt : stageState.attempt
    const retryAttempt = message.payload.retryAttempt ?? 1

    await this.stateStore.recordTaskAttempt({
      pipelineId,
      stageName,
      taskIndex,
      attempt,
      retryAttempt,
      status: 'failed',
      error: message.payload.error,
      completedAt: Date.now()
    })

    await this.releaseThrottledTasks(pipelineId, stage, stageState)

    const policy: StageRetryPolicy | undefined = message.payload.retryPolicy ?? this.resolveRetryPolicy(stage)
    if (policy && retryAttempt < policy.maxAttempts) {
      const delay = this.calculateBackoffDelay(policy, retryAttempt)
      await this.scheduleStageTask(pipelineId, stage, stageState, {
        actorType: message.payload.actorType,
        taskIndex,
        input: message.payload.input,
        metadata: message.payload.metadata,
        retryPolicy: policy,
        retryAttempt: retryAttempt + 1,
        delayMs: delay
      })
      return
    }

    await this.sendToDeadLetterQueue(stage, message)
    await this.handlePipelineFailure(pipelineId, new Error(message.payload.error?.message || 'Task failed'))
  }

  private ensureDeadLetterWorker(queueName: string): string {
    const sanitizedQueueName = this.sanitizeQueueName(queueName)
    if (this.deadLetterWorkers.has(sanitizedQueueName)) {
      return sanitizedQueueName
    }

    this.deadLetterWorkers.add(sanitizedQueueName)
    this.messageQueue.registerWorker<PipelineMessage>(
      sanitizedQueueName,
      async (message) => {
        if (message.type !== 'dead-letter') {
          return
        }

        await this.handleDeadLetterMessage(queueName, message)
      }
    )
    return sanitizedQueueName
  }

  private async handleDeadLetterMessage(queueName: string, message: PipelineMessage): Promise<void> {
    const pipelineId = message.payload?.pipelineId ?? 'unknown'
    const stageName = message.payload?.stageName ?? 'unknown'
    const taskIndex = message.payload?.taskIndex ?? 'unknown'
    console.warn(`\n📥 DLQ[${queueName}] captured ${pipelineId}/${stageName}#${taskIndex}`)
    await this.archiveDeadLetterMessage(queueName, message)
  }

  private async archiveDeadLetterMessage(queueName: string, message: PipelineMessage): Promise<void> {
    const record: DeadLetterRecord = {
      queueName,
      archivedAt: Date.now(),
      message
    }

    const key = this.getDeadLetterArchiveKey(queueName)
    await this.redis.lpush(key, JSON.stringify(record))
    await this.redis.ltrim(key, 0, this.deadLetterArchiveLimit - 1)
  }

  private getDeadLetterArchiveKey(queueName: string): string {
    return `pipeline:dead-letter:${queueName}`
  }

  private async sendToDeadLetterQueue(stage: StageDefinition, message: PipelineMessage): Promise<void> {
    const dlqQueue = stage.config?.deadLetterQueue ?? this.getDefaultDeadLetterQueueName(message, stage)
    if (!dlqQueue) {
      return
    }
    const bullMqQueue = this.ensureDeadLetterWorker(dlqQueue)

    try {
      const dlqMessage: PipelineMessage = {
        messageId: `dlq-${message.messageId}`,
        from: 'pipeline-orchestrator',
        to: bullMqQueue,
        type: 'dead-letter',
        payload: {
          pipelineId: message.payload.pipelineId,
          stageName: message.payload.stageName,
          taskIndex: message.payload.taskIndex,
          actorType: message.payload.actorType ?? (typeof stage.actor === 'string' ? stage.actor : undefined),
          attempt: message.payload.attempt,
          retryAttempt: message.payload.retryAttempt,
          error: message.payload.error,
          input: message.payload.input,
          metadata: message.payload.metadata,
          deadLetterQueue: dlqQueue
        },
        timestamp: new Date().toISOString()
      }

      await this.messageQueue.enqueue(bullMqQueue, dlqMessage, {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false
      })
    } catch (error) {
      console.error('Failed to push task to DLQ', error)
    }
  }

  private async completeStage(
          pipelineId: string,
          stage: StageDefinition,
          stageState: StageState,
          persistedOutputs?: any[],
          completedTasksDelta = 0
        ): Promise<void> {
          const state = this.pipelines.get(pipelineId)
          if (!state) {
            return
          }

          const outputs = persistedOutputs ?? await this.stateStore.getStageOutputs(pipelineId, stage.name, stageState.attempt)
          stageState.outputs = outputs
          stageState.status = 'completed'
          stageState.completedAt = Date.now()
          state.context.stages[stage.name] = outputs

          if (stage.compensation) {
            await this.sagaCoordinator.recordCompensation(pipelineId, stage, outputs)
          }

          await this.stateStore.updateStageProgress({
            pipelineId,
            stageName: stage.name,
            status: 'completed',
            completedAt: stageState.completedAt,
            completedTasksDelta
          })

          await this.stateStore.snapshotContext(pipelineId, state.context)

          state.activeStages.delete(stage.name)
          await this.updatePipelineCursor(pipelineId, Array.from(state.activeStages))

          await this.startNextStagesIfReady(pipelineId, stage.name)
        }

        private async startNextStagesIfReady(pipelineId: string, completedStage: string): Promise<void> {
          const state = this.pipelines.get(pipelineId)
          if (!state) {
            return
          }

          const dependents = Array.from(state.stageGraph.dependents.get(completedStage) ?? [])
          const ready = dependents.filter(stageName => this.areDependenciesMet(state, stageName))
          if (ready.length > 0) {
            await this.startStages(pipelineId, ready)
          }

          if (this.allStagesCompleted(state) && state.activeStages.size === 0) {
            await this.finalizePipelineSuccess(pipelineId)
          }
        }

        private areDependenciesMet(state: PipelineExecutionState, stageName: string): boolean {
          const deps = state.stageGraph.dependencies.get(stageName)
          if (!deps || deps.size === 0) {
            return true
          }
          for (const dependency of deps) {
            const dependencyState = state.stageStates.get(dependency)
            if (!dependencyState || dependencyState.status !== 'completed') {
              return false
            }
          }
          return true
        }

        private allStagesCompleted(state: PipelineExecutionState): boolean {
          for (const stageState of state.stageStates.values()) {
            if (stageState.status !== 'completed') {
              return false
            }
          }
          return true
        }

        private async finalizePipelineSuccess(pipelineId: string): Promise<void> {
          console.log(`\n🎉 Pipeline ${pipelineId} COMPLETED`)
          await this.sagaCoordinator.clearCompensations(pipelineId)
          await this.stateStore.setPipelineStatus(pipelineId, 'completed', {
            currentStage: undefined,
            resumeCursor: undefined,
            activeStages: []
          })
          this.pipelines.delete(pipelineId)
        }

        private buildStageGraph(definition: PipelineDefinition): StageGraphMetadata {
          const dependencies = new Map<string, Set<string>>()
          const dependents = new Map<string, Set<string>>()
          const stageNames = new Set<string>()

          definition.stages.forEach((stage, index) => {
            if (stageNames.has(stage.name)) {
              throw new Error(`Duplicate stage name detected: ${stage.name}`)
            }
            stageNames.add(stage.name)
            const resolvedDependencies = this.resolveStageDependencies(stage, index, definition)
            const normalized = new Set(resolvedDependencies.filter(Boolean))
            dependencies.set(stage.name, normalized)
            for (const dependency of normalized) {
              if (!dependents.has(dependency)) {
                dependents.set(dependency, new Set())
              }
              dependents.get(dependency)!.add(stage.name)
            }
          })

          for (const [stageName, deps] of dependencies.entries()) {
            for (const dependency of deps) {
              if (!dependencies.has(dependency)) {
                throw new Error(`Stage ${stageName} depends on unknown stage ${dependency}`)
              }
            }
          }

          const indegree = new Map<string, number>()
          for (const [stageName, deps] of dependencies.entries()) {
            indegree.set(stageName, deps.size)
          }

          const queue: string[] = []
          indegree.forEach((value, key) => {
            if (value === 0) {
              queue.push(key)
            }
          })

          const visited: string[] = []
          while (queue.length > 0) {
            const next = queue.shift()!
            visited.push(next)
            for (const dependent of dependents.get(next) ?? []) {
              const updated = (indegree.get(dependent) ?? 0) - 1
              indegree.set(dependent, updated)
              if (updated === 0) {
                queue.push(dependent)
              }
            }
          }

          if (visited.length !== definition.stages.length) {
            throw new Error('Pipeline definition contains a cycle; DAG execution requires an acyclic graph')
          }

          const entryStages = definition.stages
            .map(stage => stage.name)
            .filter(name => (dependencies.get(name)?.size ?? 0) === 0)

          if (entryStages.length === 0) {
            throw new Error('Pipeline definition must include at least one entry stage')
          }

          return {
            dependencies,
            dependents,
            entryStages
          }
        }

        private resolveStageDependencies(
          stage: StageDefinition,
          index: number,
          definition: PipelineDefinition
        ): string[] {
          if (stage.dependsOn) {
            return Array.isArray(stage.dependsOn) ? stage.dependsOn : [stage.dependsOn]
          }

          if (stage.mode === 'gather' && stage.gather?.stage) {
            const gatherStages = stage.gather.stage
            return Array.isArray(gatherStages) ? gatherStages : [gatherStages]
          }

          if (index === 0) {
            return []
          }

          const previous = definition.stages[index - 1]
          return previous ? [previous.name] : []
        }
  
  private async abortIfCancelled(pipelineId: string): Promise<boolean> {
    const cancelled = await this.stateStore.isPipelineCancelled(pipelineId)
    if (!cancelled) {
      return false
    }

    await this.handlePipelineCancellation(pipelineId)
    return true
  }

  private async handlePipelineCancellation(pipelineId: string, reason?: string): Promise<void> {
    console.warn(`\n⏹️ Pipeline ${pipelineId} CANCELLED${reason ? ` (${reason})` : ''}`)

    await this.stateStore.setPipelineStatus(pipelineId, 'failed', {
      currentStage: undefined,
      resumeCursor: undefined,
      activeStages: []
    })

    try {
      await this.sagaCoordinator.clearCompensations(pipelineId)
    } catch (error) {
      console.error('Failed to clear saga compensations during cancellation', error)
    }

    this.pipelines.delete(pipelineId)
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

    await this.stateStore.setPipelineStatus(pipelineId, 'failed', {
      currentStage: undefined,
      resumeCursor: undefined,
      activeStages: []
    })
    
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

interface PipelineContextState {
  trigger: any
  stages: Record<string, any[]>
}

interface StageState {
  stageName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked'
  expectedTasks: number
  completedTasks: number
  outputs: any[]
  attempt: number
  startedAt?: number
  completedAt?: number
  activeTasks?: number
  pendingTasks?: ScheduledTaskRequest[]
}

interface PipelineExecutionState {
  pipelineId: string
  definition: PipelineDefinition
  context: PipelineContextState
  stageStates: Map<string, StageState>
  stageMap: Map<string, StageDefinition>
  stageGraph: StageGraphMetadata
  activeStages: Set<string>
}

interface TaskLeaseContext {
  leaseId: string
  ttlMs: number
}

interface StageGraphMetadata {
  dependencies: Map<string, Set<string>>
  dependents: Map<string, Set<string>>
  entryStages: string[]
}
