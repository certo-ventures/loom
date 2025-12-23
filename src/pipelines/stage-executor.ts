/**
 * Stage Executor Interface - Pluggable Orchestration Patterns
 * 
 * Allows dynamic registration of execution patterns (scatter, gather, map-reduce, etc.)
 * just like actors are dynamically registered.
 */

import jp from 'jsonpath'
import { v4 as uuidv4 } from 'uuid'
import { BullMQMessageQueue } from '../storage/bullmq-message-queue'
import { StageDefinition } from './pipeline-dsl'

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
}
