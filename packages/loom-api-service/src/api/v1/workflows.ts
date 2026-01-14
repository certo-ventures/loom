/**
 * 5. Workflow & Pipelines API
 * 
 * Task orchestration and pipeline execution
 */

import { Router } from 'express'
import type { LoomService } from '../../services/loom-service'
import { ApiError } from '../../middleware/error-handler'

export function createWorkflowRouter(loomService: LoomService) {
  const router = Router()
  const actorService = loomService.actorService!
  const queueService = loomService.queueService!

  // POST /api/v1/workflows - Create workflow
  router.post('/', async (req, res) => {
    const { name, description, stages, config } = req.body
    
    if (!name || !stages || !Array.isArray(stages)) {
      throw new ApiError(400, 'name and stages array are required')
    }
    
    const workflow = {
      id: `workflow-${Date.now()}`,
      name,
      description,
      stages,
      config: config || {},
      status: 'draft',
      createdAt: new Date().toISOString()
    }
    
    res.status(201).json(workflow)
  })

  // GET /api/v1/workflows/:id - Get workflow
  router.get('/:id', async (req, res) => {
    const { id } = req.params
    
    // TODO: Fetch from storage
    res.json({ id, name: 'Example Workflow' })
  })

  // GET /api/v1/workflows - List workflows
  router.get('/', async (req, res) => {
    const { status, limit = 50, offset = 0 } = req.query
    
    res.json({
      workflows: [],
      total: 0,
      limit: Number(limit),
      offset: Number(offset)
    })
  })

  // POST /api/v1/workflows/:id/execute - Execute workflow
  router.post('/:id/execute', async (req, res) => {
    const { id } = req.params
    const { input, config } = req.body
    
    const execution = {
      executionId: `exec-${Date.now()}`,
      workflowId: id,
      status: 'running',
      startedAt: new Date().toISOString(),
      input,
      config
    }
    
    // Publish to workflow execution queue
    await queueService.publishMessage(
      'workflow-executions',
      execution,
      {},
      req.tenantId!
    )
    
    res.status(202).json(execution)
  })

  // GET /api/v1/workflows/:id/executions - List workflow executions
  router.get('/:id/executions', async (req, res) => {
    const { id } = req.params
    const { status, limit = 50 } = req.query
    
    res.json({
      workflowId: id,
      executions: [],
      total: 0
    })
  })

  // GET /api/v1/workflows/:id/executions/:executionId - Get execution details
  router.get('/:id/executions/:executionId', async (req, res) => {
    const { id, executionId } = req.params
    
    res.json({
      executionId,
      workflowId: id,
      status: 'completed',
      stages: []
    })
  })

  // POST /api/v1/workflows/:id/executions/:executionId/cancel - Cancel execution
  router.post('/:id/executions/:executionId/cancel', async (req, res) => {
    const { id, executionId } = req.params
    
    res.json({
      executionId,
      workflowId: id,
      status: 'cancelled',
      cancelledAt: new Date().toISOString()
    })
  })

  // POST /api/v1/workflows/:id/executions/:executionId/retry - Retry execution
  router.post('/:id/executions/:executionId/retry', async (req, res) => {
    const { id, executionId } = req.params
    const { fromStage } = req.body
    
    const newExecution = {
      executionId: `exec-${Date.now()}`,
      workflowId: id,
      originalExecutionId: executionId,
      fromStage,
      status: 'running',
      startedAt: new Date().toISOString()
    }
    
    res.status(202).json(newExecution)
  })

  // ===== Pipeline API =====

  // POST /api/v1/workflows/pipelines - Create pipeline
  router.post('/pipelines', async (req, res) => {
    const { name, stages, config } = req.body
    
    if (!name || !stages) {
      throw new ApiError(400, 'name and stages are required')
    }
    
    const pipeline = {
      id: `pipeline-${Date.now()}`,
      name,
      stages,
      config,
      createdAt: new Date().toISOString()
    }
    
    res.status(201).json(pipeline)
  })

  // POST /api/v1/workflows/pipelines/:id/run - Run pipeline
  router.post('/pipelines/:id/run', async (req, res) => {
    const { id } = req.params
    const { input } = req.body
    
    const run = {
      runId: `run-${Date.now()}`,
      pipelineId: id,
      status: 'running',
      startedAt: new Date().toISOString(),
      input
    }
    
    res.status(202).json(run)
  })

  // ===== Pipeline State Query API =====

  // GET /api/v1/workflows/pipelines/running - List running pipelines
  router.get('/pipelines/running', async (req, res) => {
    const { limit = 100 } = req.query
    
    // Access pipeline state store via stateService
    const stateService = loomService.stateService
    if (!stateService) {
      throw new ApiError(503, 'State service not available')
    }
    
    const runningPipelines = await stateService.redis.smembers('pipelines:running')
    const pipelinesWithDetails = await Promise.all(
      runningPipelines.slice(0, Number(limit)).map(async (pipelineId) => {
        const record = await stateService.redis.get(`pipeline:${pipelineId}`)
        return record ? JSON.parse(record) : null
      })
    )
    
    res.json({
      pipelines: pipelinesWithDetails.filter(Boolean),
      total: runningPipelines.length
    })
  })

  // GET /api/v1/workflows/pipelines/:id/state - Get pipeline state
  router.get('/pipelines/:id/state', async (req, res) => {
    const { id } = req.params
    
    const stateService = loomService.stateService
    if (!stateService) {
      throw new ApiError(503, 'State service not available')
    }
    
    const record = await stateService.redis.get(`pipeline:${id}`)
    if (!record) {
      throw new ApiError(404, `Pipeline ${id} not found`)
    }
    
    const pipeline = JSON.parse(record)
    
    res.json({
      pipelineId: pipeline.pipelineId,
      status: pipeline.status,
      definition: pipeline.definition,
      activeStages: pipeline.activeStages,
      stageOrder: pipeline.stageOrder,
      createdAt: new Date(pipeline.createdAt).toISOString(),
      startedAt: new Date(pipeline.startedAt).toISOString(),
      completedAt: pipeline.completedAt ? new Date(pipeline.completedAt).toISOString() : null,
      updatedAt: new Date(pipeline.updatedAt).toISOString(),
      metadata: pipeline.metadata
    })
  })

  // GET /api/v1/workflows/pipelines/:id/context - Get pipeline context
  router.get('/pipelines/:id/context', async (req, res) => {
    const { id } = req.params
    
    const stateService = loomService.stateService
    if (!stateService) {
      throw new ApiError(503, 'State service not available')
    }
    
    const contextKey = `pipeline:${id}:context:latest`
    const contextData = await stateService.redis.get(contextKey)
    
    if (!contextData) {
      throw new ApiError(404, `No context found for pipeline ${id}`)
    }
    
    const context = JSON.parse(contextData)
    res.json(context)
  })

  // GET /api/v1/workflows/pipelines/:id/stages/:stageName - Get stage state
  router.get('/pipelines/:id/stages/:stageName', async (req, res) => {
    const { id, stageName } = req.params
    
    const stateService = loomService.stateService
    if (!stateService) {
      throw new ApiError(503, 'State service not available')
    }
    
    const stageKey = `pipeline:${id}:stage:${stageName}`
    const stageData = await stateService.redis.get(stageKey)
    
    if (!stageData) {
      throw new ApiError(404, `Stage ${stageName} not found in pipeline ${id}`)
    }
    
    const stage = JSON.parse(stageData)
    res.json({
      stageName: stage.stageName,
      status: stage.status,
      attempt: stage.attempt,
      startedAt: stage.startedAt ? new Date(stage.startedAt).toISOString() : null,
      completedAt: stage.completedAt ? new Date(stage.completedAt).toISOString() : null,
      expectedTasks: stage.expectedTasks,
      completedTasks: stage.completedTasks,
      error: stage.error,
      pendingApprovalId: stage.pendingApprovalId
    })
  })

  // GET /api/v1/workflows/pipelines/:id/stages/:stageName/outputs - Get stage outputs
  router.get('/pipelines/:id/stages/:stageName/outputs', async (req, res) => {
    const { id, stageName } = req.params
    const { attempt = '0' } = req.query
    
    const stateService = loomService.stateService
    if (!stateService) {
      throw new ApiError(503, 'State service not available')
    }
    
    const outputsKey = `pipeline:${id}:stage:${stageName}:outputs:${attempt}`
    const outputsData = await stateService.redis.lrange(outputsKey, 0, -1)
    
    const outputs = outputsData.map(data => JSON.parse(data))
    res.json({ outputs, count: outputs.length })
  })

  // GET /api/v1/workflows/pipelines/:id/stages/:stageName/tasks - Get stage tasks
  router.get('/pipelines/:id/stages/:stageName/tasks', async (req, res) => {
    const { id, stageName } = req.params
    
    const stateService = loomService.stateService
    if (!stateService) {
      throw new ApiError(503, 'State service not available')
    }
    
    const tasksKey = `pipeline:${id}:stage:${stageName}:tasks`
    const taskIds = await stateService.redis.smembers(tasksKey)
    
    const tasks = await Promise.all(
      taskIds.map(async (taskId) => {
        const taskData = await stateService.redis.get(`pipeline:${id}:stage:${stageName}:task:${taskId}`)
        return taskData ? JSON.parse(taskData) : null
      })
    )
    
    res.json({ tasks: tasks.filter(Boolean) })
  })

  // GET /api/v1/workflows/pipelines/:id/progress - Get pipeline progress summary
  router.get('/pipelines/:id/progress', async (req, res) => {
    const { id } = req.params
    
    const stateService = loomService.stateService
    if (!stateService) {
      throw new ApiError(503, 'State service not available')
    }
    
    // Get pipeline record
    const pipelineData = await stateService.redis.get(`pipeline:${id}`)
    if (!pipelineData) {
      throw new ApiError(404, `Pipeline ${id} not found`)
    }
    
    const pipeline = JSON.parse(pipelineData)
    
    // Get all stage states
    const stageProgress = await Promise.all(
      pipeline.stageOrder.map(async (stageName: string) => {
        const stageKey = `pipeline:${id}:stage:${stageName}`
        const stageData = await stateService.redis.get(stageKey)
        
        if (!stageData) {
          return { name: stageName, status: 'pending', progress: 0 }
        }
        
        const stage = JSON.parse(stageData)
        const progress = stage.expectedTasks > 0
          ? Math.round((stage.completedTasks / stage.expectedTasks) * 100)
          : stage.status === 'completed' ? 100 : 0
        
        return {
          name: stageName,
          status: stage.status,
          progress,
          completedTasks: stage.completedTasks,
          expectedTasks: stage.expectedTasks,
          error: stage.error?.message
        }
      })
    )
    
    const totalStages = pipeline.stageOrder.length
    const completedStages = stageProgress.filter((s: any) => s.status === 'completed').length
    const overallProgress = totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0
    
    res.json({
      pipelineId: id,
      status: pipeline.status,
      overallProgress,
      completedStages,
      totalStages,
      stages: stageProgress,
      runtime: pipeline.completedAt
        ? pipeline.completedAt - pipeline.startedAt
        : Date.now() - pipeline.startedAt
    })
  })

  // ===== Actor Journal API =====

  // GET /api/v1/workflows/actors/:actorId/journal - Get actor journal entries
  router.get('/actors/:actorId/journal', async (req, res) => {
    const { actorId } = req.params
    const { limit = 100, since } = req.query
    
    const stateService = loomService.stateService
    if (!stateService) {
      throw new ApiError(503, 'State service not available')
    }
    
    // Read from Redis Streams (journal entries)
    const streamKey = `journal:${actorId}`
    const entries = await stateService.redis.xrevrange(
      streamKey,
      '+',
      since ? String(since) : '-',
      'COUNT',
      Number(limit)
    )
    
    const journalEntries = entries.map(([id, fields]) => {
      const entry: any = { streamId: id }
      for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i]
        const value = fields[i + 1]
        entry[key] = key === 'entry' ? JSON.parse(value) : value
      }
      return entry
    })
    
    res.json({ actorId, entries: journalEntries, count: journalEntries.length })
  })

  // GET /api/v1/workflows/actors/:actorId/journal/stats - Get journal statistics
  router.get('/actors/:actorId/journal/stats', async (req, res) => {
    const { actorId } = req.params
    
    const stateService = loomService.stateService
    if (!stateService) {
      throw new ApiError(503, 'State service not available')
    }
    
    const streamKey = `journal:${actorId}`
    const info = await stateService.redis.xinfo('STREAM', streamKey)
    
    // Parse Redis XINFO response
    const stats: any = { actorId }
    for (let i = 0; i < info.length; i += 2) {
      const key = info[i].toString()
      const value = info[i + 1]
      
      if (key === 'length') stats.entryCount = value
      if (key === 'first-entry') stats.firstEntry = value
      if (key === 'last-entry') stats.lastEntry = value
    }
    
    res.json(stats)
  })

  // GET /api/v1/workflows/actors/:actorId/snapshots - Get actor snapshots
  router.get('/actors/:actorId/snapshots', async (req, res) => {
    const { actorId } = req.params
    const { limit = 10 } = req.query
    
    const stateService = loomService.stateService
    if (!stateService) {
      throw new ApiError(503, 'State service not available')
    }
    
    const snapshotKey = `journal:${actorId}:snapshot`
    const snapshotData = await stateService.redis.get(snapshotKey)
    
    if (!snapshotData) {
      return res.json({ snapshots: [] })
    }
    
    const snapshot = JSON.parse(snapshotData)
    res.json({ snapshots: [snapshot] })
  })

  // ===== Circuit Breaker API =====

  // GET /api/v1/workflows/circuit-breakers - List circuit breakers
  router.get('/circuit-breakers', async (req, res) => {
    const stateService = loomService.stateService
    if (!stateService) {
      throw new ApiError(503, 'State service not available')
    }
    
    const keys = await stateService.redis.keys('circuit-breaker:*')
    
    const breakers = await Promise.all(
      keys.map(async (key) => {
        const data = await stateService.redis.get(key)
        if (!data) return null
        
        const state = JSON.parse(data)
        return {
          key: key.replace('circuit-breaker:', ''),
          state: state.state,
          failures: state.failures,
          lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt).toISOString() : null,
          lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null
        }
      })
    )
    
    res.json({ circuitBreakers: breakers.filter(Boolean) })
  })

  // POST /api/v1/workflows/circuit-breakers/:key/reset - Reset circuit breaker
  router.post('/circuit-breakers/:key/reset', async (req, res) => {
    const { key } = req.params
    
    const stateService = loomService.stateService
    if (!stateService) {
      throw new ApiError(503, 'State service not available')
    }
    
    const circuitKey = `circuit-breaker:${key}`
    await stateService.redis.del(circuitKey)
    
    res.json({ message: 'Circuit breaker reset', key })
  })

  return router
}
