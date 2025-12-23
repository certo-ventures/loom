/**
 * Human-in-the-Loop Approval Executor
 * 
 * Pauses pipeline execution for human review and decision-making.
 * Critical for:
 * - Low-confidence AI classifications
 * - Legal document approvals
 * - High-stakes business decisions
 * - Compliance checkpoints
 * 
 * Features:
 * - Multi-channel notification (Redis pub/sub, webhooks, polling API)
 * - Configurable timeout with fallback behavior
 * - Approval metadata/comments
 * - Escalation on timeout
 * 
 * Notification Flow:
 * 1. Create approval request in Redis
 * 2. Publish to Redis pub/sub → External listeners (UI, Slack, etc.)
 * 3. Optional webhook → POST to external URL
 * 4. BullMQ delayed job → Timeout handler
 * 5. Await decision via submitApproval() API call
 */

import { BaseStageExecutor, ExecutionContext, ExecutionResult } from './stage-executor'
import type { StageDefinition } from './pipeline-dsl'
import { Redis } from 'ioredis'
import { BullMQMessageQueue } from '../storage/bullmq-message-queue'
import { v4 as uuidv4 } from 'uuid'

export interface ApprovalRequest {
  approvalId: string
  pipelineId: string
  stageName: string
  assignTo: string | string[]
  data: any                    // Data to review
  webhookUrl?: string
  timeout: number
  fallback: 'auto-approve' | 'auto-reject' | 'escalate'
  createdAt: number
  expiresAt: number
  status: 'pending' | 'approved' | 'rejected' | 'expired'
}

export interface ApprovalDecision {
  decision: 'approve' | 'reject'
  decidedBy: string
  decidedAt: number
  comment?: string
  metadata?: any
}

/**
 * Human Approval Executor
 * Pauses pipeline for human decision
 */
export class HumanApprovalExecutor extends BaseStageExecutor {
  getName(): string {
    return 'human-approval'
  }

  validate(stage: StageDefinition): boolean {
    return !!stage.humanApproval && 
           !!stage.humanApproval.assignTo &&
           !!stage.humanApproval.timeout
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const config = context.stage.humanApproval!
    const approvalId = uuidv4()
    
    console.log(`\n👤 Human approval required: ${context.stage.name}`)
    console.log(`   Approval ID: ${approvalId}`)
    console.log(`   Assigned to: ${Array.isArray(config.assignTo) ? config.assignTo.join(', ') : config.assignTo}`)
    console.log(`   Timeout: ${config.timeout}ms (${Math.floor(config.timeout / 1000)}s)`)
    
    // Resolve input data for approval
    const input = this.resolveInput(context.stage.input, context.pipelineContext)
    
    // Create approval request
    const request: ApprovalRequest = {
      approvalId,
      pipelineId: context.pipelineId,
      stageName: context.stage.name,
      assignTo: config.assignTo,
      data: input,
      webhookUrl: config.webhookUrl,
      timeout: config.timeout,
      fallback: config.fallback,
      createdAt: Date.now(),
      expiresAt: Date.now() + config.timeout,
      status: 'pending'
    }
    
    // Store in Redis with TTL
    const ttlSeconds = Math.ceil(config.timeout / 1000) + 60 // Add 60s buffer
    await context.redis.setex(
      `approval:${approvalId}`,
      ttlSeconds,
      JSON.stringify(request)
    )
    
    // Add to pending approvals list (for polling API)
    await context.redis.zadd(
      'approvals:pending',
      Date.now(),
      approvalId
    )
    
    // Publish notification to Redis pub/sub
    await context.redis.publish(
      `approval:notification`,
      JSON.stringify({
        approvalId,
        pipelineId: context.pipelineId,
        stageName: context.stage.name,
        assignTo: config.assignTo,
        data: input,
        timeout: config.timeout
      })
    )
    
    console.log(`   📢 Notification published to Redis pub/sub: approval:notification`)
    
    // Optional: Send webhook notification
    if (config.webhookUrl) {
      await this.sendWebhookNotification(config.webhookUrl, request)
    }
    
    // Schedule timeout handler using BullMQ delayed job
    await context.messageQueue.enqueue('approval-timeout-handler', {
      approvalId,
      pipelineId: context.pipelineId,
      stageName: context.stage.name,
      fallback: config.fallback
    }, {
      jobId: `approval-timeout:${approvalId}`,
      delay: config.timeout
    })
    
    console.log(`   ⏰ Timeout scheduled: ${Math.floor(config.timeout / 1000)}s`)
    
    // Wait for decision (blocks until approved/rejected or timeout)
    const decision = await this.waitForDecision(context.redis, approvalId, config.timeout)
    
    if (decision.decision === 'approve') {
      console.log(`   ✅ Approved by: ${decision.decidedBy}`)
      if (decision.comment) {
        console.log(`      Comment: ${decision.comment}`)
      }
      
      // Human approval doesn't spawn async tasks like scatter/gather
      // Instead, we directly add output to stage state since we have the result
      // The executor returns expectedTasks: 0 to indicate synchronous completion
      
      // Store result directly in context for next stage
      // This will be handled specially by the orchestrator
      return {
        expectedTasks: 0,  // No async tasks - handled synchronously
        metadata: {
          synchronousResult: {
            ...input,
            __approval: decision
          }
        }
      }
    } else {
      console.log(`   ❌ Rejected by: ${decision.decidedBy}`)
      if (decision.comment) {
        console.log(`      Reason: ${decision.comment}`)
      }
      
      throw new Error(`Human approval rejected: ${decision.comment || 'No reason provided'}`)
    }
  }

  /**
   * Wait for approval decision
   * Uses Redis pub/sub for real-time notification
   */
  private async waitForDecision(
    redis: Redis,
    approvalId: string,
    timeout: number
  ): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      const subscriber = redis.duplicate()
      const channel = `approval:decision:${approvalId}`
      
      // Set overall timeout
      const timeoutHandle = setTimeout(async () => {
        await subscriber.unsubscribe(channel)
        await subscriber.quit()
        reject(new Error('Approval timeout exceeded'))
      }, timeout + 5000) // Add 5s buffer for processing
      
      subscriber.on('message', async (ch, message) => {
        if (ch === channel) {
          clearTimeout(timeoutHandle)
          await subscriber.unsubscribe(channel)
          await subscriber.quit()
          
          const decision: ApprovalDecision = JSON.parse(message)
          resolve(decision)
        }
      })
      
      subscriber.subscribe(channel).catch(reject)
    })
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(
    webhookUrl: string,
    request: ApprovalRequest
  ): Promise<void> {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'approval_required',
          approval: {
            id: request.approvalId,
            pipelineId: request.pipelineId,
            stageName: request.stageName,
            assignTo: request.assignTo,
            data: request.data,
            expiresAt: request.expiresAt
          }
        })
      })
      
      if (response.ok) {
        console.log(`   ✅ Webhook notification sent: ${webhookUrl}`)
      } else {
        console.warn(`   ⚠️  Webhook failed (${response.status}): ${webhookUrl}`)
      }
    } catch (error) {
      console.warn(`   ⚠️  Webhook error: ${error}`)
      // Don't fail the approval - webhook is optional
    }
  }
}

/**
 * Timeout Handler for approvals
 * Executed by BullMQ when timeout is reached
 */
export class ApprovalTimeoutHandler {
  constructor(
    private redis: Redis,
    private messageQueue: BullMQMessageQueue
  ) {}

  /**
   * Register timeout handler worker
   */
  register(): void {
    this.messageQueue.registerWorker<any>(
      'approval-timeout-handler',
      async (job) => {
        const { approvalId, pipelineId, stageName, fallback } = job
        
        // Check if already decided
        const requestJson = await this.redis.get(`approval:${approvalId}`)
        if (!requestJson) {
          return // Already expired or decided
        }
        
        const request: ApprovalRequest = JSON.parse(requestJson)
        if (request.status !== 'pending') {
          return // Already decided
        }
        
        console.log(`\n⏰ Approval timeout reached: ${approvalId}`)
        console.log(`   Pipeline: ${pipelineId}`)
        console.log(`   Stage: ${stageName}`)
        console.log(`   Fallback: ${fallback}`)
        
        // Execute fallback behavior
        const decision: ApprovalDecision = await this.executeFallback(
          approvalId,
          request,
          fallback
        )
        
        // Publish decision
        await this.redis.publish(
          `approval:decision:${approvalId}`,
          JSON.stringify(decision)
        )
        
        // Update request status
        request.status = decision.decision === 'approve' ? 'approved' : 'rejected'
        await this.redis.setex(
          `approval:${approvalId}`,
          3600, // Keep for 1 hour for audit
          JSON.stringify(request)
        )
        
        // Remove from pending list
        await this.redis.zrem('approvals:pending', approvalId)
      },
      1
    )
    
    console.log('⏰ ApprovalTimeoutHandler registered')
  }

  /**
   * Execute fallback behavior on timeout
   */
  private async executeFallback(
    approvalId: string,
    request: ApprovalRequest,
    fallback: 'auto-approve' | 'auto-reject' | 'escalate'
  ): Promise<ApprovalDecision> {
    if (fallback === 'auto-approve') {
      console.log(`   ✅ Auto-approving (timeout fallback)`)
      return {
        decision: 'approve',
        decidedBy: 'system:timeout:auto-approve',
        decidedAt: Date.now(),
        comment: 'Automatically approved due to timeout'
      }
    } else if (fallback === 'auto-reject') {
      console.log(`   ❌ Auto-rejecting (timeout fallback)`)
      return {
        decision: 'reject',
        decidedBy: 'system:timeout:auto-reject',
        decidedAt: Date.now(),
        comment: 'Automatically rejected due to timeout'
      }
    } else {
      // escalate
      console.log(`   🚨 Escalating approval to supervisors`)
      
      // Publish escalation notification
      await this.redis.publish(
        'approval:escalation',
        JSON.stringify({
          approvalId,
          pipelineId: request.pipelineId,
          stageName: request.stageName,
          originalAssignee: request.assignTo,
          escalatedAt: Date.now()
        })
      )
      
      // For now, reject (real system would reassign)
      return {
        decision: 'reject',
        decidedBy: 'system:timeout:escalated',
        decidedAt: Date.now(),
        comment: 'Escalated due to timeout - no supervisor decision received'
      }
    }
  }
}
