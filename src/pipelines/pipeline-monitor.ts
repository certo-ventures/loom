/**
 * Pipeline Monitor - Real-time monitoring of Redis messages
 * 
 * Shows actual messages flowing through BullMQ queues
 */

import { Redis } from 'ioredis'
import { Queue } from 'bullmq'

export class PipelineMonitor {
  private redis: Redis
  private redisSub: Redis
  private queues: Queue[] = []

  constructor(redisUrl: string = 'redis://localhost:6379') {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    })
    this.redisSub = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    })
  }

  /**
   * Monitor a queue for job additions
   */
  monitorQueue(queueName: string): void {
    const queue = new Queue(queueName, { connection: this.redis })
    this.queues.push(queue)

    queue.on('waiting', (job: any) => {
      console.log(`📥 [${queueName}] Job added: ${job.id}`)
    })

    // @ts-ignore - BullMQ event listener type mismatch
    queue.on('active', (job: any) => {
      console.log(`⚙️  [${queueName}] Job started: ${job.id}`)
    })

    // @ts-ignore - BullMQ event listener type mismatch
    queue.on('completed', (job: any) => {
      console.log(`✅ [${queueName}] Job completed: ${job.id}`)
    })

    // @ts-ignore - BullMQ event listener type mismatch
    queue.on('failed', (job: any, err: any) => {
      console.log(`❌ [${queueName}] Job failed: ${job?.id} - ${err.message}`)
    })
  }

  /**
   * Monitor Redis pub/sub channels
   */
  async monitorPubSub(pattern: string): Promise<void> {
    await this.redisSub.psubscribe(pattern)
    
    this.redisSub.on('pmessage', (pattern, channel, message) => {
      console.log(`📡 [PubSub] ${channel}`)
      try {
        const data = JSON.parse(message)
        console.log(`   Data: ${JSON.stringify(data, null, 2)}`)
      } catch {
        console.log(`   Raw: ${message}`)
      }
    })
  }

  /**
   * Show queue stats
   */
  async showQueueStats(queueName: string): Promise<void> {
    const queue = new Queue(queueName, { connection: this.redis })
    
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount()
    ])

    console.log(`\n📊 Queue Stats: ${queueName}`)
    console.log(`   Waiting: ${waiting}`)
    console.log(`   Active: ${active}`)
    console.log(`   Completed: ${completed}`)
    console.log(`   Failed: ${failed}`)

    await queue.close()
  }

  /**
   * Show all Redis keys matching pattern
   */
  async showRedisKeys(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern)
    console.log(`\n🔑 Redis Keys (${pattern}): ${keys.length} found`)
    keys.slice(0, 20).forEach(key => console.log(`   ${key}`))
    if (keys.length > 20) {
      console.log(`   ... and ${keys.length - 20} more`)
    }
  }

  /**
   * Monitor pipeline state changes
   */
  async monitorPipelineState(pipelineId: string): Promise<void> {
    console.log(`\n👁️  Monitoring pipeline: ${pipelineId}`)
    
    // Poll pipeline state
    const interval = setInterval(async () => {
      const stateKey = `pipeline:${pipelineId}:state`
      const state = await this.redis.get(stateKey)
      
      if (state) {
        const data = JSON.parse(state)
        console.log(`\n📊 Pipeline State Update:`)
        console.log(`   Current Stage: ${data.currentStageIndex}`)
        console.log(`   Context Keys: ${Object.keys(data.context.stages || {}).join(', ')}`)
      }
    }, 2000)

    // Stop after 30 seconds
    setTimeout(() => clearInterval(interval), 30000)
  }

  /**
   * Watch Redis commands in real-time
   */
  async watchRedisCommands(): Promise<void> {
    const monitor = await this.redis.monitor()
    
    console.log('\n🔍 Redis MONITOR (showing BullMQ operations):')
    
    monitor.on('monitor', (time, args, source, database) => {
      const command = args.join(' ')
      
      // Filter to show only relevant commands
      if (
        command.includes('bull:') ||
        command.includes('pipeline:') ||
        command.includes('LPUSH') ||
        command.includes('BRPOP') ||
        command.includes('PUBLISH')
      ) {
        console.log(`   ${new Date(time * 1000).toISOString().substr(11, 12)} [${args[0]}] ${args.slice(1).join(' ').substring(0, 100)}`)
      }
    })
  }

  async close(): Promise<void> {
    await Promise.all(this.queues.map(q => q.close()))
    await this.redis.quit()
    await this.redisSub.quit()
  }
}
