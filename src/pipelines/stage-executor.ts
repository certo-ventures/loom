/**
 * Stage Executor Interface - Pluggable Orchestration Patterns
 * 
 * Allows dynamic registration of execution patterns (scatter, gather, map-reduce, etc.)
 * just like actors are dynamically registered.
 */

import { v4 as uuidv4 } from 'uuid'
import { BullMQMessageQueue } from '../storage/bullmq-message-queue'
import { StageDefinition, ActorStrategy, StageRetryPolicy } from './pipeline-dsl'
import { PipelineStateStore, DEFAULT_TASK_LEASE_TTL_MS } from './pipeline-state-store'
import { pipelineExpressionEvaluator } from './expression-evaluator'

/**
 * Pipeline-specific message format
 */
export interface PipelineMessage {
  messageId: string
  from: string  // sender pipeline or actor
  to: string  // target actor type
  type: 'execute' | 'result' | 'failure' | 'dead-letter'
  payload: any
  timestamp: string
}

/**
 * Context passed to executor
 */
export interface ExecutionContext {
  pipelineId: string
  stage: StageDefinition
  pipelineContext: any  // Full pipeline context with previous stage outputs
  messageQueue: BullMQMessageQueue
  redis: any  // Redis client for state
  stateStore: PipelineStateStore
  stageAttempt: number
  scheduleTask?: (task: ScheduledTaskRequest) => Promise<void>
}

export interface ScheduledTaskRequest {
  actorType: string
  taskIndex: number
  input: any
  metadata?: Record<string, any>
  retryPolicy?: StageRetryPolicy
  retryAttempt?: number
  delayMs?: number
}

/**
 * Result from executor
 */
export interface ExecutionResult {
  expectedTasks: number  // How many tasks will be spawned (for barrier)
  metadata?: any  // Any additional info
}

/**
 * Stage Executor Interface
 * 
 * Each pattern (scatter, gather, map-reduce, etc.) implements this
 */
export interface StageExecutor {
  /**
   * Execute the stage pattern
   */
  execute(context: ExecutionContext): Promise<ExecutionResult>
  
  /**
   * Validate stage configuration
   */
  validate(stage: StageDefinition): boolean
  
  /**
   * Get executor name/type
   */
  getName(): string
}

/**
 * Base class with common utilities
 */
export abstract class BaseStageExecutor implements StageExecutor {
  abstract execute(context: ExecutionContext): Promise<ExecutionResult>
  abstract validate(stage: StageDefinition): boolean
  abstract getName(): string
  
  /**
   * Resolve input from context using JSONPath
   */
  protected resolveInput(inputDef: Record<string, any>, context: any): any {
    const resolved: any = {}
    
    for (const [key, value] of Object.entries(inputDef)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        // Legacy JSONPath support - convert $.field to field
        const jmesPath = value.substring(2) // Remove '$.'
        const result = pipelineExpressionEvaluator.evaluate(jmesPath, context)
        resolved[key] = result.success ? result.value : value
      } else if (typeof value === 'string') {
        // Try JMESPath evaluation - if it successfully resolves, use it; otherwise treat as literal
        const result = pipelineExpressionEvaluator.evaluate(value, context)
        // Use the evaluated value if successful AND not null/undefined, otherwise use literal
        resolved[key] = (result.success && result.value !== null && result.value !== undefined) ? result.value : value
      } else {
        // Non-string values (objects, arrays, numbers, etc.)
        resolved[key] = value
      }
    }
    
    return resolved
  }
  
  /**
   * Create message for actor execution
   */
  protected createMessage(
    pipelineId: string,
    stageName: string,
    actorType: string,
    taskIndex: number,
    input: any,
    metadata?: any
  ): PipelineMessage {
    return {
      messageId: uuidv4(),
      from: pipelineId,
      to: actorType,
      type: 'execute',
      payload: {
        pipelineId,
        stageName,
        taskIndex,
        input,
        ...metadata
      },
      timestamp: new Date().toISOString()
    }
  }
  
  /**
   * Get executor config from stage
   */
  protected getConfig<T = any>(stage: StageDefinition): T {
    return (stage.executorConfig || {}) as T
  }
  
  /**
   * Evaluate condition expression using expression evaluator
   */
  protected evaluateCondition(condition: string, context: any): boolean {
    return pipelineExpressionEvaluator.evaluateCondition(condition, context)
  }
  
  /**
   * Resolve actor type from strategy
   */
  protected resolveActor(stage: StageDefinition, context: any): string {
    // Simple string actor
    if (typeof stage.actor === 'string') {
      return stage.actor
    }
    
    const strategy = stage.actor as ActorStrategy
    
    // Strategy with ternary expression
    if (strategy.strategy) {
      return this.evaluateTernary(strategy.strategy, context)
    }
    
    // Strategy with when/condition mappings
    if (strategy.when) {
      for (const mapping of strategy.when) {
        if (this.evaluateCondition(mapping.condition, context)) {
          return mapping.actor
        }
      }
      
      // No match - use default
      if (strategy.default) {
        return strategy.default
      }
      
      throw new Error(`No actor matched strategy conditions and no default provided`)
    }
    
    throw new Error(`Invalid actor strategy: ${JSON.stringify(strategy)}`)
  }
  
  /**
   * Evaluate ternary expression: condition ? trueValue : falseValue
   */
  private evaluateTernary(expression: string, context: any): string {
    // JMESPath: Use && || pattern instead of ternary: condition && "value1" || "value2"
    // Also support legacy ternary syntax: condition ? "value1" : "value2"
    const ternaryMatch = expression.match(/(.+?)\s*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/)
    
    if (ternaryMatch) {
      // Legacy ternary syntax
      const [, condition, trueValue, falseValue] = ternaryMatch
      const result = this.evaluateCondition(condition.trim(), context)
      return result ? trueValue : falseValue
    }
    
    // JMESPath expression evaluation - returns string directly
    const result = pipelineExpressionEvaluator.evaluateActorName(expression, context)
    if (!result) {
      throw new Error(`Actor strategy evaluation returned null: ${expression}`)
    }
    return result
  }

  protected async enqueueActorTask(
    context: ExecutionContext,
    actorType: string,
    taskIndex: number,
    input: any,
    metadata?: Record<string, any>
  ): Promise<void> {
    const { stage } = context
    const retryPolicy = this.resolveRetryPolicy(stage)
    const taskRequest: ScheduledTaskRequest = {
      actorType,
      taskIndex,
      input,
      metadata,
      retryPolicy,
      retryAttempt: 1
    }

    if (context.scheduleTask) {
      await context.scheduleTask(taskRequest)
      return
    }

    await this.dispatchTaskDirect(context, taskRequest)
  }

  protected buildJobId(
    pipelineId: string,
    stageName: string,
    attempt: number,
    taskIndex: number,
    retryAttempt = 1
  ): string {
    const normalizedPipelineId = pipelineId.replace(/:/g, '_')
    return `${normalizedPipelineId}-${stageName}-${attempt}-${taskIndex}-r${retryAttempt}`
  }

  protected resolveRetryPolicy(stage: StageDefinition): StageRetryPolicy | undefined {
    if (stage.retry) {
      return stage.retry
    }
    return stage.config?.retryPolicy
  }

  protected resolveTaskLeaseTtl(stage: StageDefinition): number {
    return stage.config?.leaseTtlMs ?? DEFAULT_TASK_LEASE_TTL_MS
  }

  protected resolveInitialDelay(stage: StageDefinition): number {
    return stage.config?.initialDelayMs ?? 0
  }

  private async dispatchTaskDirect(context: ExecutionContext, task: ScheduledTaskRequest): Promise<void> {
    const { pipelineId, stage, messageQueue, stateStore, stageAttempt } = context
    const queueName = `actor-${task.actorType}`
    const retryAttempt = task.retryAttempt ?? 1
    const payloadMetadata = task.metadata ? { ...task.metadata } : {}
    const leaseTtlMs = this.resolveTaskLeaseTtl(stage)
    const leaseId = uuidv4()
    const delayMs = task.delayMs ?? this.resolveInitialDelay(stage)
    const availableAt = delayMs && delayMs > 0 ? Date.now() + delayMs : undefined

    await stateStore.ensureTaskLease({
      pipelineId,
      stageName: stage.name,
      taskIndex: task.taskIndex,
      leaseId,
      ttlMs: leaseTtlMs
    })

    const message = this.createMessage(
      pipelineId,
      stage.name,
      task.actorType,
      task.taskIndex,
      task.input,
      {
        ...payloadMetadata,
        attempt: stageAttempt,
        retryAttempt,
        retryPolicy: task.retryPolicy,
        leaseId,
        leaseTtlMs
      }
    )

    await messageQueue.enqueue(queueName, message, {
      jobId: this.buildJobId(pipelineId, stage.name, stageAttempt, task.taskIndex, retryAttempt),
      attempts: 1,
      delay: delayMs
    })

    await stateStore.recordTaskAttempt({
      pipelineId,
      stageName: stage.name,
      taskIndex: task.taskIndex,
      attempt: stageAttempt,
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
      leaseId
    })
  }
}
