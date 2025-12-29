/**
 * Tracing Integration for Pipeline Orchestrator
 * 
 * Automatically instruments pipeline execution with comprehensive tracing.
 * Captures all patterns: saga, human approval, circuit breaker, retry, etc.
 */

import { ExecutionTraceRecorder, ExecutionSpan, ExecutionSummary, SpanType } from './execution-trace'
import type { PipelineDefinition, StageDefinition } from '../pipelines/pipeline-dsl'
import { randomUUID } from 'crypto'

/**
 * Tracer for pipeline orchestrator
 */
export class PipelineTracer {
  private activeSpans = new Map<string, ExecutionSpan>()
  private spanStack: string[] = []  // Track nested spans
  
  constructor(private recorder: ExecutionTraceRecorder) {}

  /**
   * Start pipeline execution trace
   */
  async startPipeline(
    pipelineId: string,
    pipeline: PipelineDefinition,
    input: any,
    options?: {
      userId?: string
      correlationId?: string
      tags?: Record<string, string>
    }
  ): Promise<string> {
    const traceId = pipelineId
    const spanId = this.generateSpanId()

    const span: ExecutionSpan = {
      spanId,
      traceId,
      pipelineId,
      spanType: 'pipeline',
      status: 'in-progress',
      startTime: new Date().toISOString(),
      input,
      userId: options?.userId,
      correlationId: options?.correlationId,
      tags: options?.tags,
      w3cTraceParent: this.generateW3CTraceParent(traceId, spanId)
    }

    await this.recorder.recordSpan(span)
    this.activeSpans.set(spanId, span)
    this.spanStack.push(spanId)

    // Initialize summary
    const summary: ExecutionSummary = {
      traceId,
      pipelineId,
      startTime: span.startTime,
      status: 'in-progress',
      totalSpans: 1,
      stagesExecuted: 0,
      stagesSkipped: 0,
      stagesFailed: 0,
      hadCompensations: false,
      compensationsExecuted: 0,
      hadHumanApproval: false,
      approvalsRequested: 0,
      hadRetries: false,
      totalRetries: 0,
      hadCircuitBreaker: false,
      aiDecisions: 0,
      userId: options?.userId,
      correlationId: options?.correlationId,
      tags: options?.tags
    }

    await this.recorder.recordSummary(summary)

    return traceId
  }

  /**
   * Start stage execution
   */
  async startStage(
    traceId: string,
    stage: StageDefinition,
    input: any
  ): Promise<string> {
    const spanId = this.generateSpanId()
    const parentSpanId = this.getCurrentSpanId()

    const span: ExecutionSpan = {
      spanId,
      traceId,
      parentSpanId,
      pipelineId: traceId,
      stageId: stage.name,
      actorType: typeof stage.actor === 'string' ? stage.actor : undefined,
      spanType: 'stage',
      status: 'in-progress',
      startTime: new Date().toISOString(),
      input,
      tags: {
        mode: stage.mode,
        hasRetry: !!stage.retry ? 'true' : 'false',
        hasCircuitBreaker: !!stage.circuitBreaker ? 'true' : 'false',
        hasCompensation: !!stage.compensation ? 'true' : 'false'
      }
    }

    await this.recorder.recordSpan(span)
    this.activeSpans.set(spanId, span)
    this.spanStack.push(spanId)

    return spanId
  }

  /**
   * Record circuit breaker check
   */
  async recordCircuitBreakerCheck(
    traceId: string,
    actorType: string,
    state: 'closed' | 'open' | 'half-open',
    shouldExecute: boolean,
    failureCount: number
  ): Promise<void> {
    const spanId = this.generateSpanId()
    const parentSpanId = this.getCurrentSpanId()

    const span: ExecutionSpan = {
      spanId,
      traceId,
      parentSpanId,
      pipelineId: traceId,
      actorType,
      spanType: 'circuit-breaker-check',
      status: shouldExecute ? 'success' : 'cancelled',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 0,
      circuitBreakerInfo: {
        state,
        failureCount,
        shouldExecute,
        reason: shouldExecute ? 'Circuit closed, allowing execution' : 'Circuit open, preventing execution'
      }
    }

    await this.recorder.recordSpan(span)

    // Update summary
    await this.updateSummary(traceId, s => {
      s.hadCircuitBreaker = true
      s.totalSpans++
    })
  }

  /**
   * Record retry attempt
   */
  async recordRetry(
    traceId: string,
    stageId: string,
    attempt: number,
    maxAttempts: number,
    backoffMs: number,
    previousSpanIds: string[]
  ): Promise<string> {
    const spanId = this.generateSpanId()
    const parentSpanId = this.getCurrentSpanId()

    const span: ExecutionSpan = {
      spanId,
      traceId,
      parentSpanId,
      pipelineId: traceId,
      stageId,
      spanType: 'retry',
      status: 'in-progress',
      startTime: new Date().toISOString(),
      retryInfo: {
        attempt,
        maxAttempts,
        backoffMs,
        isRetry: true,
        previousSpanIds
      }
    }

    await this.recorder.recordSpan(span)
    this.activeSpans.set(spanId, span)

    // Update summary
    await this.updateSummary(traceId, s => {
      s.hadRetries = true
      s.totalRetries++
      s.totalSpans++
    })

    return spanId
  }

  /**
   * Record compensation execution
   */
  async recordCompensation(
    traceId: string,
    compensationAction: any,
    originalSpanId: string,
    reason: string
  ): Promise<string> {
    const spanId = this.generateSpanId()
    const parentSpanId = this.getCurrentSpanId()

    const span: ExecutionSpan = {
      spanId,
      traceId,
      parentSpanId,
      pipelineId: traceId,
      stageId: compensationAction.actor,
      actorType: compensationAction.actor,
      spanType: 'compensation',
      status: 'in-progress',
      startTime: new Date().toISOString(),
      input: compensationAction.input,
      compensationInfo: {
        compensationType: 'backward',
        originalSpanId,
        compensationReason: reason
      }
    }

    await this.recorder.recordSpan(span)
    this.activeSpans.set(spanId, span)
    this.spanStack.push(spanId)

    // Update summary
    await this.updateSummary(traceId, s => {
      s.hadCompensations = true
      s.compensationsExecuted++
      s.totalSpans++
    })

    return spanId
  }

  /**
   * Record human approval request
   */
  async recordHumanApproval(
    traceId: string,
    approvalId: string,
    stageId: string,
    assignedTo: string[],
    input: any
  ): Promise<string> {
    const spanId = this.generateSpanId()
    const parentSpanId = this.getCurrentSpanId()

    const span: ExecutionSpan = {
      spanId,
      traceId,
      parentSpanId,
      pipelineId: traceId,
      stageId,
      spanType: 'human-approval',
      status: 'in-progress',
      startTime: new Date().toISOString(),
      input,
      approvalInfo: {
        approvalId,
        assignedTo
      }
    }

    await this.recorder.recordSpan(span)
    this.activeSpans.set(spanId, span)
    this.spanStack.push(spanId)

    // Update summary
    await this.updateSummary(traceId, s => {
      s.hadHumanApproval = true
      s.approvalsRequested++
      s.totalSpans++
    })

    return spanId
  }

  /**
   * Record approval decision
   */
  async recordApprovalDecision(
    spanId: string,
    traceId: string,
    decision: 'approved' | 'rejected',
    decidedBy: string,
    reason?: string,
    timedOut: boolean = false
  ): Promise<void> {
    const span = this.activeSpans.get(spanId)
    if (!span) return

    const endTime = new Date().toISOString()
    const waitTimeMs = new Date(endTime).getTime() - new Date(span.startTime).getTime()

    await this.recorder.updateSpan(spanId, traceId, {
      status: decision === 'approved' ? 'success' : 'failed',
      endTime,
      durationMs: waitTimeMs,
      approvalInfo: {
        ...span.approvalInfo!,
        decision,
        decidedBy,
        decisionReason: reason,
        waitTimeMs,
        timedOut
      }
    })

    this.finishSpan(spanId)
  }

  /**
   * Record AI decision
   */
  async recordAIDecision(
    traceId: string,
    stageId: string,
    model: string,
    input: any,
    output: any,
    metadata: {
      promptTokens?: number
      completionTokens?: number
      reasoning?: string
      confidence?: number
      alternatives?: any[]
    }
  ): Promise<string> {
    const spanId = this.generateSpanId()
    const parentSpanId = this.getCurrentSpanId()

    const span: ExecutionSpan = {
      spanId,
      traceId,
      parentSpanId,
      pipelineId: traceId,
      stageId,
      spanType: 'ai-decision',
      status: 'success',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      input,
      output,
      aiContext: {
        model,
        ...metadata
      }
    }

    await this.recorder.recordSpan(span)

    // Update summary
    await this.updateSummary(traceId, s => {
      s.aiDecisions++
      s.totalSpans++
      if (metadata.promptTokens || metadata.completionTokens) {
        s.totalTokens = (s.totalTokens || 0) + (metadata.promptTokens || 0) + (metadata.completionTokens || 0)
      }
    })

    return spanId
  }

  /**
   * Record scatter execution
   */
  async recordScatter(
    traceId: string,
    stageId: string,
    totalTasks: number
  ): Promise<string> {
    const spanId = this.generateSpanId()
    const parentSpanId = this.getCurrentSpanId()

    const span: ExecutionSpan = {
      spanId,
      traceId,
      parentSpanId,
      pipelineId: traceId,
      stageId,
      spanType: 'scatter',
      status: 'in-progress',
      startTime: new Date().toISOString(),
      parallelInfo: {
        totalTasks,
        completedTasks: 0,
        failedTasks: 0,
        taskSpanIds: []
      }
    }

    await this.recorder.recordSpan(span)
    this.activeSpans.set(spanId, span)
    this.spanStack.push(spanId)

    return spanId
  }

  /**
   * Complete span with success
   */
  async completeSpan(
    spanId: string,
    traceId: string,
    output?: any,
    resources?: ExecutionSpan['resources']
  ): Promise<void> {
    const span = this.activeSpans.get(spanId)
    if (!span) return

    await this.recorder.updateSpan(spanId, traceId, {
      status: 'success',
      endTime: new Date().toISOString(),
      output,
      resources
    })

    this.finishSpan(spanId)

    // Update stage counts
    if (span.spanType === 'stage') {
      await this.updateSummary(traceId, s => {
        s.stagesExecuted++
      })
    }
  }

  /**
   * Fail span with error
   */
  async failSpan(
    spanId: string,
    traceId: string,
    error: Error,
    retryable: boolean = true
  ): Promise<void> {
    const span = this.activeSpans.get(spanId)
    if (!span) return

    await this.recorder.updateSpan(spanId, traceId, {
      status: 'failed',
      endTime: new Date().toISOString(),
      error: {
        code: error.name,
        message: error.message,
        stack: error.stack,
        retryable
      }
    })

    this.finishSpan(spanId)

    // Update stage counts
    if (span.spanType === 'stage') {
      await this.updateSummary(traceId, s => {
        s.stagesFailed++
      })
    }
  }

  /**
   * Complete pipeline execution
   */
  async completePipeline(
    traceId: string,
    output: any
  ): Promise<void> {
    const pipelineSpanId = this.spanStack[0]
    if (pipelineSpanId) {
      await this.completeSpan(pipelineSpanId, traceId, output)
    }

    await this.updateSummary(traceId, s => {
      s.status = 'success'
      s.endTime = new Date().toISOString()
      s.finalOutput = output
      if (s.startTime) {
        s.durationMs = new Date(s.endTime).getTime() - new Date(s.startTime).getTime()
      }
    })
  }

  /**
   * Fail pipeline execution
   */
  async failPipeline(
    traceId: string,
    error: Error,
    failedStage?: string
  ): Promise<void> {
    const pipelineSpanId = this.spanStack[0]
    if (pipelineSpanId) {
      await this.failSpan(pipelineSpanId, traceId, error)
    }

    await this.updateSummary(traceId, s => {
      s.status = 'failed'
      s.endTime = new Date().toISOString()
      s.error = {
        stage: failedStage || 'unknown',
        message: error.message
      }
      if (s.startTime) {
        s.durationMs = new Date(s.endTime).getTime() - new Date(s.startTime).getTime()
      }
    })
  }

  /**
   * Update execution summary
   */
  private async updateSummary(
    traceId: string,
    updater: (summary: ExecutionSummary) => void
  ): Promise<void> {
    // In production, use optimistic concurrency with etag
    const summaries = await this.recorder.queryExecutions({ traceId })
    if (summaries.length > 0) {
      const summary = summaries[0]
      updater(summary)
      await this.recorder.recordSummary(summary)
    }
  }

  /**
   * Finish span (remove from active tracking)
   */
  private finishSpan(spanId: string): void {
    this.activeSpans.delete(spanId)
    const index = this.spanStack.indexOf(spanId)
    if (index > -1) {
      this.spanStack.splice(index, 1)
    }
  }

  /**
   * Get current span (for parent tracking)
   */
  private getCurrentSpanId(): string | undefined {
    return this.spanStack[this.spanStack.length - 1]
  }

  /**
   * Generate unique span ID
   */
  private generateSpanId(): string {
    return randomUUID()
  }

  /**
   * Generate W3C Trace Context trace-parent header
   */
  private generateW3CTraceParent(traceId: string, spanId: string): string {
    // Format: version-traceId-spanId-flags
    // version: 00 (current spec)
    // traceId: 32 hex chars
    // spanId: 16 hex chars  
    // flags: 01 (sampled)
    const traceIdHex = Buffer.from(traceId).toString('hex').padEnd(32, '0').substring(0, 32)
    const spanIdHex = Buffer.from(spanId).toString('hex').padEnd(16, '0').substring(0, 16)
    return `00-${traceIdHex}-${spanIdHex}-01`
  }
}
