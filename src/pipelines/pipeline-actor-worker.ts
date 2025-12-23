/**
 * Pipeline Actor Worker - Processes actor messages from BullMQ
 * 
 * Workers listen on actor queues and execute actors, then send results back
 */

import { BullMQMessageQueue } from '../storage/bullmq-message-queue'
import type { PipelineMessage } from './stage-executor'

export interface ActorImplementation {
  execute(input: any): Promise<any>
}

/**
 * Actor Worker - listens on BullMQ queues
 */
export class PipelineActorWorker {
  private messageQueue: BullMQMessageQueue
  private actors = new Map<string, new () => ActorImplementation>()

  constructor(messageQueue: BullMQMessageQueue) {
    this.messageQueue = messageQueue
  }

  /**
   * Register an actor implementation
   */
  registerActor(actorType: string, actorClass: new () => ActorImplementation): void {
    this.actors.set(actorType, actorClass)
    console.log(`📦 Registered actor: ${actorType}`)
  }

  /**
   * Start worker for an actor type
   */
  startWorker(actorType: string, concurrency: number = 1): void {
    const actorClass = this.actors.get(actorType)
    if (!actorClass) {
      throw new Error(`Actor ${actorType} not registered`)
    }

    console.log(`🤖 Starting worker for: ${actorType} (concurrency: ${concurrency})`)

    this.messageQueue.registerWorker<PipelineMessage>(
      `actor-${actorType}`,
      async (message: PipelineMessage) => {
        await this.handleMessage(actorType, message)
      },
      concurrency
    )

    console.log(`   ✅ Worker listening on queue: actor-${actorType}`)
  }

  /**
   * Handle a message
   */
  private async handleMessage(actorType: string, message: PipelineMessage): Promise<void> {
    const { pipelineId, stageName, taskIndex, input } = message.payload

    console.log(`\n   🎬 Processing: ${actorType} [task ${taskIndex}]`)
    console.log(`      Pipeline: ${pipelineId}`)
    console.log(`      Stage: ${stageName}`)

    try {
      const ActorClass = this.actors.get(actorType)!
      const actor = new ActorClass()

      const startTime = Date.now()
      const output = await actor.execute(input)
      const duration = Date.now() - startTime

      console.log(`      ✅ Completed in ${duration}ms`)

      // Send result back via message queue
      const resultMessage: PipelineMessage = {
        messageId: message.messageId + '-result',
        from: actorType,
        to: pipelineId,
        type: 'result',
        payload: {
          pipelineId,
          stageName,
          taskIndex,
          output
        },
        timestamp: new Date().toISOString()
      }

      await this.messageQueue.enqueue('pipeline-stage-results', resultMessage)
      console.log(`      📨 Result sent to: pipeline-stage-results`)
    } catch (error) {
      console.error(`      ❌ Actor failed:`, error)
      throw error
    }
  }

  /**
   * Cleanup
   */
  async close(): Promise<void> {
    await this.messageQueue.close()
  }
}
