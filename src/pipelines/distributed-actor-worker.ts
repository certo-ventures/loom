/**
 * Distributed Actor Worker
 * 
 * Real worker process that:
 * - Listens on Redis work queues
 * - Spawns actual actors from registry
 * - Executes actor logic
 * - Publishes results back to Redis
 * - Implements true distributed execution
 */

import { Redis } from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

export interface ActorTask {
  actorId: string
  pipelineId: string
  stageName: string
  actorType: string
  input: any
  itemIndex?: number
  groupKey?: string
  resultChannel: string
}

/**
 * Worker that processes actor tasks from Redis queues
 */
export class DistributedActorWorker {
  private redis: Redis
  private workerId: string
  private actorRegistry: Map<string, any> = new Map()
  private isRunning = false
  private queueName: string

  constructor(
    actorType: string,
    redisUrl: string = 'redis://localhost:6379'
  ) {
    this.redis = new Redis(redisUrl)
    this.workerId = `worker:${actorType}:${uuidv4().slice(0, 8)}`
    this.queueName = `queue:actors:${actorType}`
    
    console.log(`🤖 Worker started: ${this.workerId}`)
    console.log(`   Listening on: ${this.queueName}`)
  }

  /**
   * Register actor implementation
   */
  registerActor(actorType: string, actorClass: any): void {
    this.actorRegistry.set(actorType, actorClass)
    console.log(`   📦 Registered actor: ${actorType}`)
  }

  /**
   * Start worker (blocking loop that processes tasks)
   */
  async start(): Promise<void> {
    this.isRunning = true
    console.log(`   ▶️  Worker running...`)
    
    while (this.isRunning) {
      try {
        // Blocking pop from Redis queue
        const result = await this.redis.brpop(this.queueName, 1)
        
        if (result) {
          const [_queue, taskJson] = result
          const task: ActorTask = JSON.parse(taskJson)
          
          await this.processTask(task)
        }
      } catch (error) {
        console.error(`   ❌ Worker error:`, error)
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  }

  /**
   * Process a single task
   */
  private async processTask(task: ActorTask): Promise<void> {
    const startTime = Date.now()
    
    console.log(`\n   🎬 Processing task: ${task.actorId}`)
    console.log(`      Pipeline: ${task.pipelineId}`)
    console.log(`      Stage: ${task.stageName}`)
    console.log(`      Actor type: ${task.actorType}`)
    if (task.itemIndex !== undefined) {
      console.log(`      Item index: ${task.itemIndex}`)
    }
    if (task.groupKey) {
      console.log(`      Group key: ${task.groupKey}`)
    }
    
    try {
      // Get actor class from registry
      const ActorClass = this.actorRegistry.get(task.actorType)
      if (!ActorClass) {
        throw new Error(`Actor type not registered: ${task.actorType}`)
      }
      
      // Spawn actor instance
      const actor = new ActorClass()
      console.log(`      ✓ Actor spawned`)
      
      // Execute actor
      console.log(`      ▶️  Executing actor...`)
      const output = await actor.execute(task.input)
      
      const duration = Date.now() - startTime
      console.log(`      ✅ Actor completed (${duration}ms)`)
      
      // Publish result back to Redis
      await this.redis.publish(
        task.resultChannel,
        JSON.stringify({
          actorId: task.actorId,
          pipelineId: task.pipelineId,
          stageName: task.stageName,
          output,
          workerId: this.workerId,
          duration
        })
      )
      
      console.log(`      📨 Result published to: ${task.resultChannel}`)
    } catch (error) {
      console.error(`      ❌ Actor failed:`, error)
      
      // Publish error
      await this.redis.publish(
        task.resultChannel,
        JSON.stringify({
          actorId: task.actorId,
          pipelineId: task.pipelineId,
          stageName: task.stageName,
          error: error instanceof Error ? error.message : 'Unknown error',
          workerId: this.workerId
        })
      )
    }
  }

  /**
   * Stop worker
   */
  async stop(): Promise<void> {
    console.log(`   ⏹️  Stopping worker: ${this.workerId}`)
    this.isRunning = false
    await this.redis.quit()
  }
}

/**
 * Worker Pool - manages multiple workers
 */
export class DistributedWorkerPool {
  private workers: DistributedActorWorker[] = []
  private actorRegistry: Map<string, any> = new Map()

  /**
   * Register actor type
   */
  registerActor(actorType: string, actorClass: any): void {
    this.actorRegistry.set(actorType, actorClass)
    console.log(`📦 Registered actor type in pool: ${actorType}`)
  }

  /**
   * Spawn workers for an actor type
   */
  spawnWorkers(actorType: string, count: number, redisUrl?: string): void {
    const actorClass = this.actorRegistry.get(actorType)
    if (!actorClass) {
      throw new Error(`Actor type not registered: ${actorType}`)
    }

    console.log(`\n🏭 Spawning ${count} workers for ${actorType}`)
    
    for (let i = 0; i < count; i++) {
      const worker = new DistributedActorWorker(actorType, redisUrl)
      worker.registerActor(actorType, actorClass)
      this.workers.push(worker)
      
      // Start worker in background
      worker.start().catch(error => {
        console.error(`Worker error:`, error)
      })
    }
    
    console.log(`✅ ${count} workers spawned and listening`)
  }

  /**
   * Stop all workers
   */
  async stopAll(): Promise<void> {
    console.log(`\n⏹️  Stopping all workers...`)
    await Promise.all(this.workers.map(w => w.stop()))
    console.log(`✅ All workers stopped`)
  }
}
