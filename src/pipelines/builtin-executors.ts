/**
 * Built-in Stage Executors
 * 
 * Standard orchestration patterns: scatter, gather, single, map-reduce, broadcast, etc.
 */

import { pipelineExpressionEvaluator } from './expression-evaluator'
import {
  StageExecutor,
  BaseStageExecutor,
  ExecutionContext,
  ExecutionResult
} from './stage-executor'
import { StageDefinition } from './pipeline-dsl'

// ============================================================================
// Single Executor - Execute one actor
// ============================================================================

export class SingleExecutor extends BaseStageExecutor {
  getName() { return 'single' }
  
  validate(stage: StageDefinition): boolean {
    return !!stage.actor && !!stage.input
  }
  
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { stage, pipelineContext } = context
    
    const input = this.resolveInput(stage.input, pipelineContext)
    const actorType = this.resolveActor(stage, pipelineContext)
    
    await this.enqueueActorTask(context, actorType, 0, input)
    
    console.log(`   🎯 Single actor: ${actorType}`)
    console.log(`   ✅ Message enqueued to: actor-${actorType}`)
    
    return { expectedTasks: 1 }
  }
}

// ============================================================================
// Scatter Executor - Fan-out over array (parallel)
// ============================================================================

export interface ScatterConfig {
  maxParallel?: number  // Limit concurrent tasks (default: unlimited)
  batchSize?: number    // Process in batches
}

export class ScatterExecutor extends BaseStageExecutor {
  getName() { return 'scatter' }
  
  validate(stage: StageDefinition): boolean {
    return !!stage.scatter && !!stage.scatter.input && !!stage.scatter.as
  }
  
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { stage, pipelineContext } = context
    
    if (!stage.scatter) {
      throw new Error(`Stage ${stage.name} missing scatter config`)
    }
    
    const config = this.getConfig<ScatterConfig>(stage)
    
    // Extract items using JMESPath
    console.log(`   📍 JMESPath query: ${stage.scatter.input}`)
    console.log(`   📦 Available stages: ${Object.keys(pipelineContext.stages || {}).join(', ')}`)
    
    const result = pipelineExpressionEvaluator.evaluate<any[]>(stage.scatter.input, pipelineContext)
    let items = result.success ? result.value : []
    
    if (!items || items.length === 0) {
      console.warn(`   ⚠️  JMESPath returned 0 items!`)
      console.warn(`   💡 Suggestions:`)
      console.warn(`      - Expression: ${stage.scatter.input}`)
      console.warn(`      - Check stage has completed and stored results`)
      console.warn(`      - Verify stage name matches exactly (case-sensitive)`)
      
      // Log stage contents for debugging
      if (pipelineContext.stages) {
        const stageKeys = Object.keys(pipelineContext.stages)
        stageKeys.forEach(key => {
          const stageData = pipelineContext.stages[key]
          console.warn(`      - stages.${key}: ${Array.isArray(stageData) ? `${stageData.length} items` : typeof stageData}`)
        })
      }
    }
    
    if (items && items.length > 0 && Array.isArray(items[0])) {
      items = items.flat()
    }
    
    // Apply condition filter if specified
    if (stage.scatter?.condition && items) {
      const originalCount = items.length
      items = items.filter(item => {
        const scopedContext = {
          ...pipelineContext,
          [stage.scatter!.as]: item
        }
        return this.evaluateCondition(stage.scatter!.condition!, scopedContext)
      })
      console.log(`   🔍 FILTER: ${originalCount} items → ${items.length} items (condition: ${stage.scatter!.condition})`)
    }
    
    const itemCount = items?.length ?? 0
    console.log(`   🔀 SCATTER: Fan-out over ${itemCount} items`)
    if (config.maxParallel) {
      console.log(`      Max parallel: ${config.maxParallel}`)
    }
    
    // Enqueue messages for each item
    for (let i = 0; i < itemCount; i++) {
      const item = items![i]
      
      // Create scoped context with scatter variable
      const scopedContext = {
        ...pipelineContext,
        [stage.scatter.as]: item
      }
      
      const input = this.resolveInput(stage.input, scopedContext)
      const actorType = this.resolveActor(stage, scopedContext)
      
      await this.enqueueActorTask(context, actorType, i, input)
    }
    
    const actorDisplay = typeof stage.actor === 'string' ? stage.actor : '[strategy]'
    console.log(`   ✅ ${itemCount} messages enqueued to: actor-${actorDisplay}`)
    
    return { expectedTasks: itemCount }
  }
}

// ============================================================================
// Gather Executor - Barrier sync + optional grouping
// ============================================================================

export interface GatherConfig {
  timeout?: number      // Max wait time (ms)
  minResults?: number   // Minimum results required
}

export class GatherExecutor extends BaseStageExecutor {
  getName() { return 'gather' }
  
  validate(stage: StageDefinition): boolean {
    return !!stage.gather && !!stage.gather.stage
  }
  
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { stage, pipelineContext } = context
    
    if (!stage.gather) {
      throw new Error(`Stage ${stage.name} missing gather config`)
    }
    
    const config = this.getConfig<GatherConfig>(stage)
    const stages = Array.isArray(stage.gather.stage) ? stage.gather.stage : [stage.gather.stage]
    const combineMode = stage.gather.combine || 'concat'
    
    console.log(`   🎯 GATHER (BARRIER): Collecting from ${stages.length} stage(s): ${stages.join(', ')}`)
    
    // Collect outputs from all target stages
    let allOutputs: any[] = []
    const stageOutputsMap: Record<string, any[]> = {}
    
    for (const stageName of stages) {
      const outputs = pipelineContext.stages[stageName] || []
      stageOutputsMap[stageName] = outputs
      
      if (combineMode === 'concat') {
        allOutputs = allOutputs.concat(outputs)
      }
    }
    
    // For 'object' mode, create object with stage names as keys
    const combinedData = combineMode === 'object' ? stageOutputsMap : allOutputs
    
    console.log(`   📊 Collected ${allOutputs.length} total outputs (combine: ${combineMode})`)
    
    // Group if specified
    if (stage.gather.groupBy) {
      const groups = new Map<string, any[]>()
      
      for (const item of allOutputs) {
        const result = pipelineExpressionEvaluator.evaluate<string>(stage.gather.groupBy, {
          ...pipelineContext,
          item
        })
        const groupKey = result.success && result.value ? String(result.value) : 'unknown'
        if (!groups.has(groupKey)) {
          groups.set(groupKey, [])
        }
        groups.get(groupKey)!.push(item)
      }
      
      console.log(`   📦 Grouped into ${groups.size} groups by ${stage.gather.groupBy}`)
      
      // Enqueue one message per group
      let groupIndex = 0
      for (const [key, items] of groups.entries()) {
        const scopedContext = {
          ...pipelineContext,
          group: { key, items }
        }
        
        const input = this.resolveInput(stage.input, scopedContext)
        const actorType = this.resolveActor(stage, scopedContext)
        
        await this.enqueueActorTask(context, actorType, groupIndex, input, { groupKey: key })
        console.log(`      └─ Group "${key}": ${items.length} items`)
        groupIndex++
      }
      
      console.log(`   ✅ ${groups.size} group messages enqueued to: actor-${stage.actor}`)
      
      return { expectedTasks: groups.size }
    } else {
      // No grouping - single consolidation with all items
      const input = this.resolveInput(stage.input, {
        ...pipelineContext,
        gathered: combinedData  // Provide combined data for multi-stage gather
      })
      
      const actorType = this.resolveActor(stage, pipelineContext)
      
      await this.enqueueActorTask(context, actorType, 0, input)
      
      console.log(`   ✅ Single consolidation message enqueued`)
      
      return { expectedTasks: 1 }
    }
  }
}

// ============================================================================
// Broadcast Executor - Send same input to multiple actors
// ============================================================================

export interface BroadcastConfig {
  actors: string[]      // List of actor types to broadcast to
  waitForAll?: boolean  // Wait for all to complete (default: true)
}

export class BroadcastExecutor extends BaseStageExecutor {
  getName() { return 'broadcast' }
  
  validate(stage: StageDefinition): boolean {
    const config = this.getConfig<BroadcastConfig>(stage)
    return config.actors && config.actors.length > 0
  }
  
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { stage, pipelineContext } = context
    const config = this.getConfig<BroadcastConfig>(stage)
    
    const input = this.resolveInput(stage.input, pipelineContext)
    
    console.log(`   📢 BROADCAST: Sending to ${config.actors.length} actors`)
    
    for (let i = 0; i < config.actors.length; i++) {
      const actorType = config.actors[i]
      
      await this.enqueueActorTask(context, actorType, i, input)
      console.log(`      └─ ${actorType}`)
    }
    
    console.log(`   ✅ Broadcast complete`)
    
    return { expectedTasks: config.waitForAll !== false ? config.actors.length : 0 }
  }
}

// ============================================================================
// Map-Reduce Executor - Scatter + Gather in one
// ============================================================================
// NOTE: Map-Reduce is a COMPOUND pattern that requires orchestrator-level support
// for multi-phase execution. Currently NOT IMPLEMENTED in orchestrator.
// Use separate scatter + gather stages as a workaround:
//   Stage 1: scatter with mapActor
//   Stage 2: gather with reduceActor
// 
// This executor is kept as a placeholder for future implementation.

export interface MapReduceConfig {
  mapActor: string      // Actor for map phase
  reduceActor: string   // Actor for reduce phase
  combineBy?: string    // JSONPath for grouping (optional)
}

export class MapReduceExecutor extends BaseStageExecutor {
  getName() { return 'map-reduce' }
  
  validate(stage: StageDefinition): boolean {
    const config = this.getConfig<MapReduceConfig>(stage)
    return !!config.mapActor && !!config.reduceActor
  }
  
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { stage } = context
    const config = this.getConfig<MapReduceConfig>(stage)
    
    // This is a compound executor - requires orchestrator support for multi-phase
    console.log(`   🗺️  MAP-REDUCE: Map with ${config.mapActor}, Reduce with ${config.reduceActor}`)
    console.error(`   ❌ Map-Reduce executor not yet implemented!`)
    console.error(`   💡 Workaround: Use separate scatter + gather stages`)
    console.error(`      Stage 1: mode: 'scatter', actor: '${config.mapActor}'`)
    console.error(`      Stage 2: mode: 'gather', actor: '${config.reduceActor}'`)
    
    // In real implementation, this would:
    // 1. Execute map phase (scatter over input with mapActor)
    // 2. Wait for all map results (barrier)
    // 3. Group results if combineBy specified
    // 4. Execute reduce phase with grouped results
    
    throw new Error('Map-Reduce executor requires multi-stage orchestrator support (not yet implemented). Use separate scatter + gather stages instead.')
  }
}

// ============================================================================
// Fork-Join Executor - Parallel branches that rejoin
// ============================================================================

export interface ForkJoinConfig {
  branches: Array<{
    name: string
    actor: string
    input?: Record<string, string>
  }>
}

export class ForkJoinExecutor extends BaseStageExecutor {
  getName() { return 'fork-join' }
  
  validate(stage: StageDefinition): boolean {
    const config = this.getConfig<ForkJoinConfig>(stage)
    return config.branches && config.branches.length > 0
  }
  
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { pipelineId, stage, pipelineContext, messageQueue } = context
    const config = this.getConfig<ForkJoinConfig>(stage)
    
    console.log(`   🔀 FORK-JOIN: ${config.branches.length} parallel branches`)
    
    for (let i = 0; i < config.branches.length; i++) {
      const branch = config.branches[i]
      
      const input = branch.input 
        ? this.resolveInput(branch.input, pipelineContext)
        : this.resolveInput(stage.input, pipelineContext)
      
      await this.enqueueActorTask(context, branch.actor, i, input, { branchName: branch.name })
      console.log(`      └─ Branch "${branch.name}": ${branch.actor}`)
    }
    
    console.log(`   ✅ All branches forked`)
    
    return { expectedTasks: config.branches.length }
  }
}
