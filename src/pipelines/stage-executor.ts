/**
 * Stage Executor Interface - Pluggable Orchestration Patterns
 * 
 * Allows dynamic registration of execution patterns (scatter, gather, map-reduce, etc.)
 * just like actors are dynamically registered.
 */

import jp from 'jsonpath'
import { v4 as uuidv4 } from 'uuid'
import { BullMQMessageQueue } from '../storage/bullmq-message-queue'
import { StageDefinition, ActorStrategy } from './pipeline-dsl'
import { ExpressionEvaluator } from './expression-evaluator'

/**
 * Pipeline-specific message format
 */
export interface PipelineMessage {
  messageId: string
  from: string  // sender pipeline or actor
  to: string  // target actor type
  type: 'execute' | 'result'
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
  protected resolveInput(inputDef: Record<string, string>, context: any): any {
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
    return ExpressionEvaluator.evaluate(condition, context)
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
    const ternaryMatch = expression.match(/(.+?)\s*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/)
    
    if (!ternaryMatch) {
      throw new Error(`Invalid ternary expression: ${expression}`)
    }
    
    const [, condition, trueValue, falseValue] = ternaryMatch
    const result = this.evaluateCondition(condition.trim(), context)
    
    return result ? trueValue : falseValue
  }
}
