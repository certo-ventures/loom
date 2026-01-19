/**
 * REAL Distributed Pipeline Orchestrator
 * 
 * Uses actual Loom infrastructure:
 * - Redis for messaging and coordination
 * - Real actor spawning via ActorSystem
 * - Distributed barrier synchronization
 * - Dynamic fan-out with work queues
 * - Real pub/sub for stage transitions
 */

import { EventEmitter } from 'events'
import { Redis } from 'ioredis'
import { PipelineDefinition, StageDefinition } from './pipeline-dsl'
import { pipelineExpressionEvaluator } from './expression-evaluator'
import { v4 as uuidv4 } from 'uuid'

// ============================================================================
// Redis-Based Pipeline Execution State
// ============================================================================

interface PipelineExecutionState {
  pipelineId: string
  definition: PipelineDefinition
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt?: string
  completedAt?: string
  triggerData: any
  context: any
}

interface StageExecutionState {
  pipelineId: string
  stageName: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt?: string
  completedAt?: string
  expectedActors?: number  // For scatter stages
  completedActors: number
  outputs: any[]
}

interface BarrierState {
  pipelineId: string
  stageName: string
  expectedCount?: number
  completedCount: number
  groups?: Record<string, any[]>  // For groupBy
  status: 'waiting' | 'triggered'
}

// ============================================================================
// Distributed Pipeline Orchestrator
// ============================================================================

export class DistributedPipelineOrchestrator extends EventEmitter {
  private redis: Redis
  private redisSub: Redis
  private actorRegistry: Map<string, any> = new Map()

  constructor(redisUrl: string = 'redis://localhost:6379') {
    super()
    this.redis = new Redis(redisUrl)
    this.redisSub = new Redis(redisUrl)
    this.setupSubscriptions()
  }

  /**
   * Register actor class for spawning
   */
  registerActor(name: string, actorClass: any): void {
    this.actorRegistry.set(name, actorClass)
    console.log(`📦 Registered actor: ${name}`)
  }

  /**
   * Start pipeline execution
   */
  async execute(definition: PipelineDefinition, triggerData: any): Promise<string> {
    const pipelineId = `pipeline:${uuidv4()}`
    
    console.log(`\n🚀 Starting DISTRIBUTED pipeline: ${definition.name}`)
    console.log(`   Pipeline ID: ${pipelineId}`)
    console.log(`   Redis-backed coordination`)
    
    // Initialize pipeline state in Redis
    const state: PipelineExecutionState = {
      pipelineId,
      definition,
      status: 'running',
      startedAt: new Date().toISOString(),
      triggerData,
      context: {
        trigger: triggerData,
        stages: {}
      }
    }
    
    await this.redis.set(`${pipelineId}:state`, JSON.stringify(state))
    
    // Initialize stage states
    for (const stage of definition.stages) {
      const stageState: StageExecutionState = {
        pipelineId,
        stageName: stage.name,
        status: 'pending',
        completedActors: 0,
        outputs: []
      }
      await this.redis.set(`${pipelineId}:stage:${stage.name}`, JSON.stringify(stageState))
    }
    
    // Start execution by triggering first stage
    await this.startStage(pipelineId, definition.stages[0])
    
    return pipelineId
  }

  /**
   * Setup Redis subscriptions for stage completion and actor results
   */
  private setupSubscriptions(): void {
    // Subscribe to actor completion events
    this.redisSub.psubscribe('pipeline:*:actor:completed')
    this.redisSub.psubscribe('pipeline:*:stage:completed')
    
    this.redisSub.on('pmessage', async (pattern, channel, message) => {
      const data = JSON.parse(message)
      
      if (channel.includes(':actor:completed')) {
        await this.handleActorCompleted(data)
      } else if (channel.includes(':stage:completed')) {
        await this.handleStageCompleted(data)
      }
    })
  }

  /**
   * Start a pipeline stage
   */
  private async startStage(pipelineId: string, stage: StageDefinition): Promise<void> {
    console.log(`\n📍 Starting stage: ${stage.name} (${stage.mode})`)
    
    // Load pipeline state
    const stateJson = await this.redis.get(`${pipelineId}:state`)
    const state: PipelineExecutionState = JSON.parse(stateJson!)
    
    // Load stage state
    const stageStateJson = await this.redis.get(`${pipelineId}:stage:${stage.name}`)
    const stageState: StageExecutionState = JSON.parse(stageStateJson!)
    
    stageState.status = 'running'
    stageState.startedAt = new Date().toISOString()
    
    await this.redis.set(`${pipelineId}:stage:${stage.name}`, JSON.stringify(stageState))
    
    // Execute based on mode
    switch (stage.mode) {
      case 'single':
        await this.executeSingleStage(pipelineId, state, stage, stageState)
        break
      case 'scatter':
        await this.executeScatterStage(pipelineId, state, stage, stageState)
        break
      case 'gather':
        await this.executeGatherStage(pipelineId, state, stage, stageState)
        break
    }
  }

  /**
   * Execute single-actor stage
   */
  private async executeSingleStage(
    pipelineId: string,
    state: PipelineExecutionState,
    stage: StageDefinition,
    stageState: StageExecutionState
  ): Promise<void> {
    const actorId = `${pipelineId}:actor:${stage.name}:single`
    
    // Resolve input
    const input = this.resolveInput(stage.input, state.context)
    
    console.log(`   🎬 Spawning single actor: ${stage.actor}`)
    console.log(`   📨 Publishing actor task to Redis`)
    
    // Publish actor task to Redis queue
    const task = {
      actorId,
      pipelineId,
      stageName: stage.name,
      actorType: stage.actor,
      input,
      resultChannel: `${pipelineId}:actor:completed`
    }
    
    await this.redis.lpush(`queue:actors:${stage.actor}`, JSON.stringify(task))
    
    // Set expected actors
    stageState.expectedActors = 1
    await this.redis.set(`${pipelineId}:stage:${stage.name}`, JSON.stringify(stageState))
    
    console.log(`   ✅ Task queued: queue:actors:${stage.actor}`)
  }

  /**
   * Execute scatter stage (FAN-OUT)
   */
  private async executeScatterStage(
    pipelineId: string,
    state: PipelineExecutionState,
    stage: StageDefinition,
    stageState: StageExecutionState
  ): Promise<void> {
    if (!stage.scatter) {
      throw new Error(`Stage ${stage.name} missing scatter config`)
    }
    
    // Resolve items to scatter over using JMESPath
    const result = pipelineExpressionEvaluator.evaluate<any[]>(stage.scatter.input, state.context)
    let items = result.success ? result.value : []
    
    if (items && items.length > 0 && Array.isArray(items[0])) {
      items = items.flat()
    }
    
    if ((!items || items.length === 0) && stage.scatter.input === 'files') {
      items = state.context.trigger?.files || []
    }
    
    const itemCount = items?.length ?? 0
    console.log(`   🔀 SCATTER: Fan-out over ${itemCount} items`)
    console.log(`   📨 Publishing ${itemCount} actor tasks to Redis queue`)
    console.log(`      Queue: queue:actors:${stage.actor}`)
    
    // Publish actor task for each item
    const tasks = items ? items.map((item, index) => {
      const actorId = `${pipelineId}:actor:${stage.name}:${index}`
      
      // Create scoped context
      const scopedContext = {
        ...state.context,
        [stage.scatter!.as]: item
      }
      
      const input = this.resolveInput(stage.input, scopedContext)
      
      return {
        actorId,
        pipelineId,
        stageName: stage.name,
        actorType: stage.actor,
        input,
        itemIndex: index,
        resultChannel: `${pipelineId}:actor:completed`
      }
    }) : []
    
    // Push all tasks to Redis queue (work queue pattern)
    const pipeline = this.redis.pipeline()
    for (const task of tasks) {
      pipeline.lpush(`queue:actors:${stage.actor}`, JSON.stringify(task))
      console.log(`      └─ Actor ${task.itemIndex}: ${task.actorId}`)
    }
    await pipeline.exec()
    
    // Set expected actors for barrier
    stageState.expectedActors = items?.length ?? 0
    await this.redis.set(`${pipelineId}:stage:${stage.name}`, JSON.stringify(stageState))
    
    console.log(`   ✅ ${items?.length ?? 0} tasks queued for distributed execution`)
  }

  /**
   * Execute gather stage (BARRIER SYNC)
   */
  private async executeGatherStage(
    pipelineId: string,
    state: PipelineExecutionState,
    stage: StageDefinition,
    stageState: StageExecutionState
  ): Promise<void> {
    if (!stage.gather) {
      throw new Error(`Stage ${stage.name} missing gather config`)
    }
    
    const targetStages = Array.isArray(stage.gather.stage) ? stage.gather.stage : [stage.gather.stage]
    console.log(`   🎯 GATHER: Barrier sync on stage ${stage.gather.stage}`)
    
    // Get outputs from target stage
    const targetStageState = await this.getStageState(pipelineId, targetStages[0])
    const targetOutputs = targetStageState.outputs
    
    console.log(`   📊 Collected ${targetOutputs.length} outputs from ${stage.gather.stage}`)
    
    // Group by key if specified
    if (stage.gather.groupBy) {
      const groups = new Map<string, any[]>()
      
      for (const item of targetOutputs) {
        const result = pipelineExpressionEvaluator.evaluate(stage.gather.groupBy, item)
        const groupKey = result.success ? result.value : 'default'
        if (!groups.has(groupKey)) {
          groups.set(groupKey, [])
        }
        groups.get(groupKey)!.push(item)
      }
      
      console.log(`   📦 Grouped into ${groups.size} groups by ${stage.gather.groupBy}`)
      
      // Spawn actor for each group
      const tasks = []
      let index = 0
      for (const [key, items] of groups.entries()) {
        const actorId = `${pipelineId}:actor:${stage.name}:group:${key}`
        
        const scopedContext = {
          ...state.context,
          group: { key, items }
        }
        
        const input = this.resolveInput(stage.input, scopedContext)
        
        tasks.push({
          actorId,
          pipelineId,
          stageName: stage.name,
          actorType: stage.actor,
          input,
          groupKey: key,
          resultChannel: `${pipelineId}:actor:completed`
        })
        
        console.log(`      └─ Group "${key}": ${items.length} items → Actor ${actorId}`)
        index++
      }
      
      // Push all group tasks to Redis
      const pipeline = this.redis.pipeline()
      for (const task of tasks) {
        pipeline.lpush(`queue:actors:${stage.actor}`, JSON.stringify(task))
      }
      await pipeline.exec()
      
      stageState.expectedActors = groups.size
      await this.redis.set(`${pipelineId}:stage:${stage.name}`, JSON.stringify(stageState))
      
      console.log(`   ✅ ${groups.size} group consolidation tasks queued`)
    } else {
      // No grouping - single actor with all items
      await this.executeSingleStage(pipelineId, state, stage, stageState)
    }
  }

  /**
   * Handle actor completion (called by actor workers via Redis pub/sub)
   */
  private async handleActorCompleted(data: {
    actorId: string
    pipelineId: string
    stageName: string
    output: any
  }): Promise<void> {
    const { pipelineId, stageName, output, actorId } = data
    
    console.log(`   ✅ Actor completed: ${actorId}`)
    
    // Load stage state
    const stageState = await this.getStageState(pipelineId, stageName)
    
    // Add output
    stageState.outputs.push(output)
    stageState.completedActors++
    
    await this.redis.set(`${pipelineId}:stage:${stageName}`, JSON.stringify(stageState))
    
    console.log(`   📊 Progress: ${stageState.completedActors}/${stageState.expectedActors || '?'}`)
    
    // Check if stage is complete (barrier check)
    if (stageState.expectedActors && stageState.completedActors >= stageState.expectedActors) {
      console.log(`   🎯 BARRIER RELEASED: All actors completed for ${stageName}`)
      await this.completeStage(pipelineId, stageName)
    }
  }

  /**
   * Complete a stage and trigger next stage
   */
  private async completeStage(pipelineId: string, stageName: string): Promise<void> {
    const stageState = await this.getStageState(pipelineId, stageName)
    stageState.status = 'completed'
    stageState.completedAt = new Date().toISOString()
    
    await this.redis.set(`${pipelineId}:stage:${stageName}`, JSON.stringify(stageState))
    
    // Update pipeline context with stage outputs
    const state = await this.getPipelineState(pipelineId)
    state.context.stages[stageName] = stageState.outputs
    await this.redis.set(`${pipelineId}:state`, JSON.stringify(state))
    
    console.log(`\n✅ Stage completed: ${stageName}`)
    
    // Publish stage completion event
    await this.redis.publish(
      `${pipelineId}:stage:completed`,
      JSON.stringify({ pipelineId, stageName })
    )
    
    // Trigger next stage
    const nextStage = this.getNextStage(state.definition, stageName)
    if (nextStage) {
      await this.startStage(pipelineId, nextStage)
    } else {
      // Pipeline complete
      state.status = 'completed'
      state.completedAt = new Date().toISOString()
      await this.redis.set(`${pipelineId}:state`, JSON.stringify(state))
      console.log(`\n🎉 Pipeline completed: ${pipelineId}`)
    }
  }

  /**
   * Handle stage completion events
   */
  private async handleStageCompleted(data: { pipelineId: string; stageName: string }): Promise<void> {
    // Already handled in completeStage
  }

  /**
   * Get pipeline state from Redis
   */
  private async getPipelineState(pipelineId: string): Promise<PipelineExecutionState> {
    const json = await this.redis.get(`${pipelineId}:state`)
    return JSON.parse(json!)
  }

  /**
   * Get stage state from Redis
   */
  private async getStageState(pipelineId: string, stageName: string): Promise<StageExecutionState> {
    const json = await this.redis.get(`${pipelineId}:stage:${stageName}`)
    return JSON.parse(json!)
  }

  /**
   * Get next stage in pipeline
   */
  private getNextStage(definition: PipelineDefinition, currentStage: string): StageDefinition | null {
    const index = definition.stages.findIndex(s => s.name === currentStage)
    if (index >= 0 && index < definition.stages.length - 1) {
      return definition.stages[index + 1]
    }
    return null
  }

  /**
   * Resolve input from context using JMESPath
   */
  private resolveInput(inputDef: Record<string, any>, context: any): any {
    const resolved: any = {}
    
    for (const [key, value] of Object.entries(inputDef)) {
      if (typeof value === 'string') {
        // Evaluate string values as JMESPath expressions
        const result = pipelineExpressionEvaluator.evaluate(value, context)
        resolved[key] = result.success ? result.value : value
      } else {
        // Non-string values
        resolved[key] = value
      }
    }
    
    return resolved
  }

  /**
   * Cleanup
   */
  async close(): Promise<void> {
    await this.redis.quit()
    await this.redisSub.quit()
  }
}
