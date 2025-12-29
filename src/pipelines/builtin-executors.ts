/**
 * Built-in Stage Executors
 * 
 * Standard orchestration patterns: scatter, gather, single, map-reduce, broadcast, etc.
 */

import jp from 'jsonpath'
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
    const { pipelineId, stage, pipelineContext, messageQueue } = context
    
    const input = this.resolveInput(stage.input, pipelineContext)
    const actorType = this.resolveActor(stage, pipelineContext)
    
    const message = this.createMessage(
      pipelineId,
      stage.name,
      actorType,
      0,
      input
    )
    
    await messageQueue.enqueue(`actor-${actorType}`, message)
    
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
    const { pipelineId, stage, pipelineContext, messageQueue } = context
    
    if (!stage.scatter) {
      throw new Error(`Stage ${stage.name} missing scatter config`)
    }
    
    const config = this.getConfig<ScatterConfig>(stage)
    
    // Extract items using JSONPath
    console.log(`   📍 JSONPath query: ${stage.scatter.input}`)
    console.log(`   📦 Available stages: ${Object.keys(pipelineContext.stages || {}).join(', ')}`)
    
    let items = jp.query(pipelineContext, stage.scatter.input)
    
    if (items.length === 0) {
      const dotNotation = stage.scatter.input.replace(/\["([^"]+)"\]/g, '.$1')
      console.warn(`   ⚠️  JSONPath returned 0 items!`)
      console.warn(`   💡 Suggestions:`)
      console.warn(`      - Try dot notation: ${dotNotation}`)
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
    
    if (items.length > 0 && Array.isArray(items[0])) {
      items = items.flat()
    }
    
    // Apply condition filter if specified
    if (stage.scatter?.condition) {
      const originalCount = items.length
      items = items.filter(item => {
        const scopedContext = {
          ...pipelineContext,
          [stage.scatter!.as]: item
        }
        // Simple expression evaluator for conditions
        return this.evaluateCondition(stage.scatter!.condition!, scopedContext)
      })
      console.log(`   🔍 FILTER: ${originalCount} items → ${items.length} items (condition: ${stage.scatter!.condition})`)
    }
    
    console.log(`   🔀 SCATTER: Fan-out over ${items.length} items`)
    if (config.maxParallel) {
      console.log(`      Max parallel: ${config.maxParallel}`)
    }
    
    // Enqueue messages for each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      
      // Create scoped context with scatter variable
      const scopedContext = {
        ...pipelineContext,
        [stage.scatter.as]: item
      }
      
      const input = this.resolveInput(stage.input, scopedContext)
      const actorType = this.resolveActor(stage, scopedContext)
      
      const message = this.createMessage(
        pipelineId,
        stage.name,
        actorType,
        i,
        input
      )
      
      await messageQueue.enqueue(`actor-${actorType}`, message)
    }
    
    const actorDisplay = typeof stage.actor === 'string' ? stage.actor : '[strategy]'
    console.log(`   ✅ ${items.length} messages enqueued to: actor-${actorDisplay}`)
    
    return { expectedTasks: items.length }
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
    const { pipelineId, stage, pipelineContext, messageQueue } = context
    
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
        const groupKey = jp.value(item, stage.gather.groupBy)
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
        
        const message = this.createMessage(
          pipelineId,
          stage.name,
          actorType,
          groupIndex,
          input,
          { groupKey: key }
        )
        
        await messageQueue.enqueue(`actor-${actorType}`, message)
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
      
      const message = this.createMessage(
        pipelineId,
        stage.name,
        actorType,
        0,
        input
      )
      
      await messageQueue.enqueue(`actor-${actorType}`, message)
      
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
    const { pipelineId, stage, pipelineContext, messageQueue } = context
    const config = this.getConfig<BroadcastConfig>(stage)
    
    const input = this.resolveInput(stage.input, pipelineContext)
    
    console.log(`   📢 BROADCAST: Sending to ${config.actors.length} actors`)
    
    for (let i = 0; i < config.actors.length; i++) {
      const actorType = config.actors[i]
      
      const message = this.createMessage(
        pipelineId,
        stage.name,
        actorType,
        i,
        input
      )
      
      await messageQueue.enqueue(`actor-${actorType}`, message)
      console.log(`      └─ ${actorType}`)
    }
    
    console.log(`   ✅ Broadcast complete`)
    
    return { expectedTasks: config.waitForAll !== false ? config.actors.length : 0 }
  }
}

// ============================================================================
// Map-Reduce Executor - Scatter + Gather in one
// ============================================================================

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
    const { pipelineId, stage, pipelineContext, messageQueue } = context
    const config = this.getConfig<MapReduceConfig>(stage)
    
    // This is a compound executor - would need orchestrator support
    // For now, just demonstrate the concept
    
    console.log(`   🗺️  MAP-REDUCE: Map with ${config.mapActor}, Reduce with ${config.reduceActor}`)
    
    // In real implementation, this would:
    // 1. Execute map phase (scatter over input with mapActor)
    // 2. Wait for all map results (barrier)
    // 3. Group results if combineBy specified
    // 4. Execute reduce phase with grouped results
    
    throw new Error('Map-Reduce executor requires multi-stage support')
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
      
      const message = this.createMessage(
        pipelineId,
        stage.name,
        branch.actor,
        i,
        input,
        { branchName: branch.name }
      )
      
      await messageQueue.enqueue(`actor-${branch.actor}`, message)
      console.log(`      └─ Branch "${branch.name}": ${branch.actor}`)
    }
    
    console.log(`   ✅ All branches forked`)
    
    return { expectedTasks: config.branches.length }
  }
}
