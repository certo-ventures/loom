/**
 * Saga Pattern Implementation
 * 
 * Provides compensating transactions for distributed workflow rollback.
 * When a pipeline fails, executes compensation actions in reverse order
 * to undo completed stages.
 * 
 * Example:
 * - Stage 1: Upload file → Compensation: Delete file
 * - Stage 2: Process file → Compensation: Delete processed results
 * - Stage 3 FAILS → Execute compensations 2, then 1 (reverse order)
 * 
 * Uses BullMQ job metadata to store compensation actions
 */

import { Redis } from 'ioredis'
import { BullMQMessageQueue } from '../storage/bullmq-message-queue'
import { pipelineExpressionEvaluator } from './expression-evaluator'
import type { StageDefinition } from './pipeline-dsl'
import type { PipelineMessage } from './stage-executor'
import { v4 as uuidv4 } from 'uuid'

export interface CompensationAction {
  pipelineId: string
  stageName: string
  actor: string
  input: any
  timestamp: number
  stageOutput?: any  // Output from the original stage
}

/**
 * Saga Coordinator
 * Tracks compensation actions and executes them on failure
 */
export class SagaCoordinator {
  private redis: Redis
  private messageQueue: BullMQMessageQueue

  constructor(redis: Redis, messageQueue: BullMQMessageQueue) {
    this.redis = redis
    this.messageQueue = messageQueue
  }

  /**
   * Record a compensation action for a completed stage
   * Stores in Redis as a stack (LIFO)
   */
  async recordCompensation(
    pipelineId: string,
    stage: StageDefinition,
    stageOutput: any
  ): Promise<void> {
    if (!stage.compensation) {
      return // No compensation configured
    }
    
    // Resolve compensation input using stage output
    const compensationInput = this.resolveCompensationInput(
      stage.compensation.input,
      stageOutput
    )
    
    const action: CompensationAction = {
      pipelineId,
      stageName: stage.name,
      actor: stage.compensation.actor,
      input: compensationInput,
      timestamp: Date.now(),
      stageOutput
    }
    
    // Push to stack (LPUSH for LIFO ordering)
    await this.redis.lpush(
      `saga:${pipelineId}:compensations`,
      JSON.stringify(action)
    )
    
    console.log(`   📝 Saga: Recorded compensation for ${stage.name} → ${stage.compensation.actor}`)
  }

  /**
   * Execute all compensations for a failed pipeline
   * Processes in reverse order (LIFO)
   */
  async executeCompensations(pipelineId: string): Promise<void> {
    console.log(`\n🔄 Saga: Rolling back pipeline ${pipelineId}`)
    
    let compensationCount = 0
    let action: string | null
    
    // Pop from stack (LPOP for LIFO with LPUSH)
    while ((action = await this.redis.lpop(`saga:${pipelineId}:compensations`))) {
      const compensation: CompensationAction = JSON.parse(action)
      
      try {
        console.log(`   ↩️  Executing compensation: ${compensation.stageName} → ${compensation.actor}`)
        
        // Enqueue compensation as a regular actor message
        const message: PipelineMessage = {
          messageId: uuidv4(),
          from: `saga:${pipelineId}`,
          to: compensation.actor,
          type: 'execute',  // Use 'execute' type with special payload
          payload: {
            pipelineId,
            stageName: compensation.stageName,
            taskType: 'compensation',  // Indicate this is a compensation
            compensationInput: compensation.input,
            originalOutput: compensation.stageOutput
          },
          timestamp: new Date().toISOString()
        }
        
        await this.messageQueue.enqueue(`actor-${compensation.actor}`, message, {
          jobId: `compensation-${pipelineId.replace(/:/g, '-')}-${compensation.stageName}`,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000
          }
        })
        
        compensationCount++
        
        // Wait a bit to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100))
        
      } catch (error) {
        console.error(`   ❌ Compensation failed for ${compensation.stageName}:`, error)
        // Continue with other compensations
      }
    }
    
    console.log(`\n✅ Saga: Executed ${compensationCount} compensations\n`)
    
    // Mark saga as complete
    await this.redis.set(`saga:${pipelineId}:status`, 'compensated')
  }

  /**
   * Check if pipeline has pending compensations
   */
  async hasPendingCompensations(pipelineId: string): Promise<boolean> {
    const count = await this.redis.llen(`saga:${pipelineId}:compensations`)
    return count > 0
  }

  /**
   * Clear compensations (on successful pipeline completion)
   */
  async clearCompensations(pipelineId: string): Promise<void> {
    await this.redis.del(`saga:${pipelineId}:compensations`)
    await this.redis.set(`saga:${pipelineId}:status`, 'completed')
    console.log(`   🗑️  Saga: Cleared compensations for successful pipeline`)
  }

  /**
   * Resolve compensation input from stage output
   * Supports JMESPath expressions or static values
   */
  private resolveCompensationInput(input: any, stageOutput: any): any {
    if (typeof input === 'string') {
      // JMESPath expression - evaluate against stage output
      const result = pipelineExpressionEvaluator.evaluate(input, stageOutput)
      return result.success ? result.value : input
    } else if (typeof input === 'object') {
      // Object with potential JMESPath values
      const resolved: any = {}
      for (const [key, value] of Object.entries(input)) {
        if (typeof value === 'string') {
          const result = pipelineExpressionEvaluator.evaluate(value as string, stageOutput)
          resolved[key] = result.success ? result.value : value
        } else {
          resolved[key] = value
        }
      }
      return resolved
    } else {
      // Static value
      return input
    }
  }

  /**
   * Get saga status for monitoring
   */
  async getStatus(pipelineId: string): Promise<{
    status: string
    pendingCompensations: number
  }> {
    const [status, count] = await Promise.all([
      this.redis.get(`saga:${pipelineId}:status`),
      this.redis.llen(`saga:${pipelineId}:compensations`)
    ])
    
    return {
      status: status || 'active',
      pendingCompensations: count
    }
  }

  /**
   * Manually trigger compensations (for debugging/ops)
   */
  async manualRollback(pipelineId: string): Promise<void> {
    console.log(`\n⚠️  Manual rollback triggered for ${pipelineId}`)
    await this.executeCompensations(pipelineId)
  }
}
