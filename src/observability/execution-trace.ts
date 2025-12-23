/**
 * Execution Trace System
 * 
 * Comprehensive observability for AI agent workflows including:
 * - Full execution paths (including non-deterministic AI decisions)
 * - Saga compensation traces
 * - Human-in-the-loop interactions
 * - All pipeline primitives (scatter, gather, conditional, etc.)
 * - Performance metrics and resource usage
 * - Error traces with full context
 * 
 * Storage: CosmosDB with optimized querying
 * Query patterns: By pipeline, actor, user, timeframe, outcome
 */

import { CosmosClient, Container } from '@azure/cosmos'

/**
 * Span represents a single unit of work in the execution
 */
export interface ExecutionSpan {
  // Identity
  spanId: string                    // Unique span ID
  traceId: string                   // Pipeline execution ID (groups all spans)
  parentSpanId?: string             // Parent span for nesting
  
  // Context
  pipelineId: string
  stageId?: string
  actorType?: string
  actorId?: string
  
  // Timing
  startTime: string                 // ISO 8601
  endTime?: string                  // ISO 8601
  durationMs?: number
  
  // Type and status
  spanType: SpanType
  status: 'in-progress' | 'success' | 'failed' | 'cancelled' | 'timeout'
  
  // Execution details
  input?: any
  output?: any
  error?: {
    code: string
    message: string
    stack?: string
    retryable: boolean
  }
  
  // AI-specific
  aiContext?: {
    model?: string
    promptTokens?: number
    completionTokens?: number
    temperature?: number
    reasoning?: string              // AI's reasoning for decisions
    confidence?: number
    alternatives?: any[]            // Alternative choices considered
  }
  
  // Saga/compensation
  compensationInfo?: {
    compensationType: 'forward' | 'backward'
    originalSpanId?: string         // Span being compensated
    compensationReason?: string
    compensationSteps?: number
  }
  
  // Human approval
  approvalInfo?: {
    approvalId: string
    assignedTo: string[]
    decidedBy?: string
    decision?: 'approved' | 'rejected'
    decisionReason?: string
    waitTimeMs?: number
    timedOut?: boolean
  }
  
  // Scatter/Gather
  parallelInfo?: {
    totalTasks: number
    completedTasks: number
    failedTasks: number
    taskSpanIds: string[]           // Child span IDs
    gatherStrategy?: 'all' | 'any' | 'majority'
  }
  
  // Conditional execution
  conditionalInfo?: {
    condition: string
    evaluated: boolean
    evaluationContext?: any
  }
  
  // Circuit breaker
  circuitBreakerInfo?: {
    state: 'closed' | 'open' | 'half-open'
    failureCount: number
    shouldExecute: boolean
    reason?: string
  }
  
  // Retry information
  retryInfo?: {
    attempt: number
    maxAttempts: number
    backoffMs: number
    isRetry: boolean
    previousSpanIds?: string[]
  }
  
  // Resource usage
  resources?: {
    cpuMs?: number
    memoryMb?: number
    networkBytes?: number
    storageBytes?: number
    cost?: {
      amount: number
      currency: string
    }
  }
  
  // Metadata
  tags?: Record<string, string>
  annotations?: {
    timestamp: string
    key: string
    value: any
  }[]
  
  // Correlation
  correlationId?: string            // Business correlation ID
  sessionId?: string                // User session ID
  userId?: string                   // User who triggered
  
  // Tracing standards (W3C Trace Context)
  w3cTraceParent?: string
  w3cTraceState?: string
}

export type SpanType = 
  | 'pipeline'                      // Entire pipeline execution
  | 'stage'                         // Single stage
  | 'actor-execution'               // Actor invocation
  | 'compensation'                  // Saga compensation
  | 'human-approval'                // Human review
  | 'scatter'                       // Parallel execution start
  | 'gather'                        // Parallel execution end
  | 'conditional'                   // Conditional evaluation
  | 'circuit-breaker-check'         // Circuit breaker decision
  | 'retry'                         // Retry attempt
  | 'message-queue'                 // Queue operation
  | 'storage'                       // Storage operation
  | 'external-api'                  // External API call
  | 'ai-decision'                   // AI agent decision point
  | 'custom'                        // Custom span

/**
 * Execution summary for quick queries
 */
export interface ExecutionSummary {
  traceId: string                   // Partition key
  pipelineId: string
  
  // Timeline
  startTime: string
  endTime?: string
  durationMs?: number
  
  // Status
  status: 'in-progress' | 'success' | 'failed' | 'cancelled' | 'partial-success'
  
  // Execution path
  totalSpans: number
  stagesExecuted: number
  stagesSkipped: number
  stagesFailed: number
  
  // Patterns used
  hadCompensations: boolean
  compensationsExecuted: number
  hadHumanApproval: boolean
  approvalsRequested: number
  hadRetries: boolean
  totalRetries: number
  hadCircuitBreaker: boolean
  
  // AI activity
  aiDecisions: number
  totalTokens?: number
  
  // Performance
  avgStageLatencyMs?: number
  slowestStageId?: string
  slowestStageMs?: number
  
  // Resources
  totalCost?: {
    amount: number
    currency: string
  }
  
  // Outcomes
  finalOutput?: any
  error?: {
    stage: string
    message: string
  }
  
  // Metadata
  userId?: string
  correlationId?: string
  tags?: Record<string, string>
}

/**
 * Query filters for execution traces
 */
export interface TraceQueryFilter {
  // Identity
  traceId?: string
  pipelineId?: string
  stageId?: string
  actorType?: string
  
  // Time range
  startTimeAfter?: string
  startTimeBefore?: string
  
  // Status
  status?: ExecutionSummary['status']
  hasErrors?: boolean
  
  // Patterns
  hasCompensations?: boolean
  hasHumanApproval?: boolean
  hasAIDecisions?: boolean
  
  // Performance
  minDurationMs?: number
  maxDurationMs?: number
  
  // User/correlation
  userId?: string
  correlationId?: string
  
  // Tags
  tags?: Record<string, string>
  
  // Pagination
  limit?: number
  offset?: number
}

/**
 * Execution trace recorder - stores spans and summaries in CosmosDB
 */
export class ExecutionTraceRecorder {
  private spansContainer: Container
  private summariesContainer: Container
  
  constructor(
    private cosmosClient: CosmosClient,
    private databaseId: string = 'loom',
    private spansContainerId: string = 'execution-spans',
    private summariesContainerId: string = 'execution-summaries'
  ) {
    const database = cosmosClient.database(databaseId)
    this.spansContainer = database.container(spansContainerId)
    this.summariesContainer = database.container(summariesContainerId)
  }

  /**
   * Initialize containers with optimized indexing
   */
  async initialize(): Promise<void> {
    const database = this.cosmosClient.database(this.databaseId)
    
    // Database is already created, just get reference
    // await this.client.databases.createIfNotExists({ id: this.databaseId })

    // Spans container - partition by traceId
    await database.containers.createIfNotExists({
      id: this.spansContainerId,
      partitionKey: { paths: ['/traceId'] },
      indexingPolicy: {
        automatic: true,
        indexingMode: 'consistent',
        includedPaths: [{ path: '/*' }],
        excludedPaths: [
          { path: '/input/*' },
          { path: '/output/*' },
          { path: '/error/stack/*' }
        ],
        compositeIndexes: [
          [
            { path: '/traceId', order: 'ascending' },
            { path: '/startTime', order: 'ascending' }
          ],
          [
            { path: '/spanType', order: 'ascending' },
            { path: '/status', order: 'ascending' }
          ],
          [
            { path: '/actorType', order: 'ascending' },
            { path: '/durationMs', order: 'descending' }
          ]
        ]
      },
      defaultTtl: 7776000 // 90 days retention
    })

    // Summaries container - partition by traceId
    await database.containers.createIfNotExists({
      id: this.summariesContainerId,
      partitionKey: { paths: ['/traceId'] },
      indexingPolicy: {
        automatic: true,
        indexingMode: 'consistent',
        compositeIndexes: [
          [
            { path: '/status', order: 'ascending' },
            { path: '/startTime', order: 'descending' }
          ],
          [
            { path: '/userId', order: 'ascending' },
            { path: '/startTime', order: 'descending' }
          ],
          [
            { path: '/hadCompensations', order: 'ascending' },
            { path: '/startTime', order: 'descending' }
          ]
        ]
      },
      defaultTtl: 7776000 // 90 days retention
    })
  }

  /**
   * Record a span
   */
  async recordSpan(span: ExecutionSpan): Promise<void> {
    await this.spansContainer.items.create(span)
  }

  /**
   * Update existing span (for completion)
   */
  async updateSpan(spanId: string, traceId: string, updates: Partial<ExecutionSpan>): Promise<void> {
    const { resource: existing } = await this.spansContainer
      .item(spanId, traceId)
      .read<ExecutionSpan>()
    
    if (!existing) {
      throw new Error(`Span not found: ${spanId}`)
    }

    const updated = { ...existing, ...updates }
    
    // Calculate duration if endTime is set
    if (updated.endTime && updated.startTime) {
      updated.durationMs = new Date(updated.endTime).getTime() - new Date(updated.startTime).getTime()
    }

    await this.spansContainer.item(spanId, traceId).replace(updated)
  }

  /**
   * Record or update execution summary
   */
  async recordSummary(summary: ExecutionSummary): Promise<void> {
    const { resource: existing } = await this.summariesContainer
      .item(summary.traceId, summary.traceId)
      .read<ExecutionSummary>()
      .catch(() => ({ resource: undefined }))

    if (existing) {
      await this.summariesContainer.item(summary.traceId, summary.traceId).replace(summary)
    } else {
      await this.summariesContainer.items.create(summary)
    }
  }

  /**
   * Get all spans for a trace
   */
  async getTraceSpans(traceId: string): Promise<ExecutionSpan[]> {
    const query = 'SELECT * FROM c WHERE c.traceId = @traceId ORDER BY c.startTime ASC'
    
    const { resources } = await this.spansContainer.items
      .query<ExecutionSpan>({
        query,
        parameters: [{ name: '@traceId', value: traceId }]
      })
      .fetchAll()

    return resources
  }

  /**
   * Get execution tree (spans organized hierarchically)
   */
  async getExecutionTree(traceId: string): Promise<ExecutionTreeNode> {
    const spans = await this.getTraceSpans(traceId)
    return this.buildTree(spans)
  }

  /**
   * Build hierarchical tree from flat spans
   */
  private buildTree(spans: ExecutionSpan[]): ExecutionTreeNode {
    const spanMap = new Map<string, ExecutionTreeNode>()
    
    // Create nodes
    for (const span of spans) {
      spanMap.set(span.spanId, {
        span,
        children: []
      })
    }

    // Build tree
    let root: ExecutionTreeNode | undefined
    for (const span of spans) {
      const node = spanMap.get(span.spanId)!
      
      if (span.parentSpanId) {
        const parent = spanMap.get(span.parentSpanId)
        if (parent) {
          parent.children.push(node)
        }
      } else {
        root = node
      }
    }

    return root || { span: spans[0], children: [] }
  }

  /**
   * Query executions by filter
   */
  async queryExecutions(filter: TraceQueryFilter): Promise<ExecutionSummary[]> {
    let query = 'SELECT * FROM c WHERE 1=1'
    const parameters: any[] = []

    if (filter.traceId) {
      query += ' AND c.traceId = @traceId'
      parameters.push({ name: '@traceId', value: filter.traceId })
    }

    if (filter.pipelineId) {
      query += ' AND c.pipelineId = @pipelineId'
      parameters.push({ name: '@pipelineId', value: filter.pipelineId })
    }

    if (filter.status) {
      query += ' AND c.status = @status'
      parameters.push({ name: '@status', value: filter.status })
    }

    if (filter.userId) {
      query += ' AND c.userId = @userId'
      parameters.push({ name: '@userId', value: filter.userId })
    }

    if (filter.hasCompensations !== undefined) {
      query += ' AND c.hadCompensations = @hasCompensations'
      parameters.push({ name: '@hasCompensations', value: filter.hasCompensations })
    }

    if (filter.hasHumanApproval !== undefined) {
      query += ' AND c.hadHumanApproval = @hasHumanApproval'
      parameters.push({ name: '@hasHumanApproval', value: filter.hasHumanApproval })
    }

    if (filter.startTimeAfter) {
      query += ' AND c.startTime >= @startTimeAfter'
      parameters.push({ name: '@startTimeAfter', value: filter.startTimeAfter })
    }

    if (filter.startTimeBefore) {
      query += ' AND c.startTime <= @startTimeBefore'
      parameters.push({ name: '@startTimeBefore', value: filter.startTimeBefore })
    }

    query += ' ORDER BY c.startTime DESC'

    if (filter.limit) {
      query += ` OFFSET ${filter.offset || 0} LIMIT ${filter.limit}`
    }

    const { resources } = await this.summariesContainer.items
      .query<ExecutionSummary>({ query, parameters })
      .fetchAll()

    return resources
  }

  /**
   * Get execution path for a trace (simplified view)
   */
  async getExecutionPath(traceId: string): Promise<ExecutionPathStep[]> {
    const spans = await this.getTraceSpans(traceId)
    
    return spans
      .filter(s => ['stage', 'human-approval', 'compensation'].includes(s.spanType))
      .map(span => ({
        stageId: span.stageId!,
        actorType: span.actorType,
        spanType: span.spanType,
        status: span.status,
        startTime: span.startTime,
        durationMs: span.durationMs,
        isCompensation: span.spanType === 'compensation',
        hadHumanApproval: span.spanType === 'human-approval',
        approvalDecision: span.approvalInfo?.decision,
        error: span.error?.message
      }))
  }

  /**
   * Get compensation trail (all compensations executed)
   */
  async getCompensationTrail(traceId: string): Promise<ExecutionSpan[]> {
    const query = `
      SELECT * FROM c 
      WHERE c.traceId = @traceId 
        AND c.spanType = 'compensation'
      ORDER BY c.startTime ASC
    `
    
    const { resources } = await this.spansContainer.items
      .query<ExecutionSpan>({
        query,
        parameters: [{ name: '@traceId', value: traceId }]
      })
      .fetchAll()

    return resources
  }

  /**
   * Get AI decision points
   */
  async getAIDecisions(traceId: string): Promise<ExecutionSpan[]> {
    const query = `
      SELECT * FROM c 
      WHERE c.traceId = @traceId 
        AND c.spanType = 'ai-decision'
      ORDER BY c.startTime ASC
    `
    
    const { resources } = await this.spansContainer.items
      .query<ExecutionSpan>({
        query,
        parameters: [{ name: '@traceId', value: traceId }]
      })
      .fetchAll()

    return resources
  }

  /**
   * Get performance analytics
   */
  async getPerformanceAnalytics(pipelineId: string, days: number = 7): Promise<{
    avgDurationMs: number
    p50DurationMs: number
    p95DurationMs: number
    p99DurationMs: number
    successRate: number
    totalExecutions: number
    slowestStages: { stageId: string; avgMs: number }[]
  }> {
    const startTime = new Date()
    startTime.setDate(startTime.getDate() - days)

    const summaries = await this.queryExecutions({
      pipelineId,
      startTimeAfter: startTime.toISOString()
    })

    if (summaries.length === 0) {
      return {
        avgDurationMs: 0,
        p50DurationMs: 0,
        p95DurationMs: 0,
        p99DurationMs: 0,
        successRate: 0,
        totalExecutions: 0,
        slowestStages: []
      }
    }

    const durations = summaries
      .filter(s => s.durationMs)
      .map(s => s.durationMs!)
      .sort((a, b) => a - b)

    const successCount = summaries.filter(s => s.status === 'success').length

    // Calculate percentiles
    const p50Index = Math.floor(durations.length * 0.5)
    const p95Index = Math.floor(durations.length * 0.95)
    const p99Index = Math.floor(durations.length * 0.99)

    // Get slowest stages
    const stageMap = new Map<string, { total: number; count: number }>()
    for (const summary of summaries) {
      if (summary.slowestStageId && summary.slowestStageMs) {
        const existing = stageMap.get(summary.slowestStageId) || { total: 0, count: 0 }
        existing.total += summary.slowestStageMs
        existing.count++
        stageMap.set(summary.slowestStageId, existing)
      }
    }

    const slowestStages = Array.from(stageMap.entries())
      .map(([stageId, stats]) => ({
        stageId,
        avgMs: stats.total / stats.count
      }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 5)

    return {
      avgDurationMs: durations.reduce((a, b) => a + b, 0) / durations.length,
      p50DurationMs: durations[p50Index],
      p95DurationMs: durations[p95Index],
      p99DurationMs: durations[p99Index],
      successRate: successCount / summaries.length,
      totalExecutions: summaries.length,
      slowestStages
    }
  }
}

/**
 * Execution tree node
 */
export interface ExecutionTreeNode {
  span: ExecutionSpan
  children: ExecutionTreeNode[]
}

/**
 * Simplified execution path step
 */
export interface ExecutionPathStep {
  stageId: string
  actorType?: string
  spanType: SpanType
  status: ExecutionSpan['status']
  startTime: string
  durationMs?: number
  isCompensation: boolean
  hadHumanApproval: boolean
  approvalDecision?: string
  error?: string
}
