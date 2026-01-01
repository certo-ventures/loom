/**
 * Pipeline Actor Worker - Processes actor messages from BullMQ
 * 
 * Workers listen on actor queues and execute actors, then send results back
 */

import { BullMQMessageQueue } from '../storage/bullmq-message-queue'
import type { MetricsCollector } from '../observability/types'
import type { PipelineMessage } from './stage-executor'
import type {
  PipelineStateStore,
  TaskStatus,
  TaskAttemptRecord
} from './pipeline-state-store'
import { DEFAULT_TASK_LEASE_TTL_MS } from './pipeline-state-store'

export interface ActorImplementation {
  execute(input: any): Promise<any>
}

/**
 * Actor Worker - listens on BullMQ queues
 */
export class PipelineActorWorker {
  private messageQueue: BullMQMessageQueue
  private actors = new Map<string, ActorImplementation | (new () => ActorImplementation)>()
  private stateStore?: PipelineStateStore
  private readonly metricsCollector?: MetricsCollector

  constructor(
    messageQueue: BullMQMessageQueue,
    stateStore?: PipelineStateStore,
    options?: { metricsCollector?: MetricsCollector }
  ) {
    this.messageQueue = messageQueue
    this.stateStore = stateStore
    this.metricsCollector = options?.metricsCollector
  }

  /**
   * Register an actor implementation (supports both classes and instances)
   */
  registerActor(actorType: string, actorClassOrInstance: ActorImplementation | (new () => ActorImplementation)): void {
    this.actors.set(actorType, actorClassOrInstance)
    console.log(`📦 Registered actor: ${actorType}`)
  }

  /**
   * Start worker for an actor type
   */
  startWorker(actorType: string, concurrency: number = 1): void {
    const actorClassOrInstance = this.actors.get(actorType)
    if (!actorClassOrInstance) {
      throw new Error(`Actor ${actorType} not registered`)
    }

    console.log(`🤖 Starting worker for: ${actorType} (concurrency: ${concurrency})`)

    const workerId = `${actorType}-worker-${process.pid}`

    this.messageQueue.registerWorker<PipelineMessage>(
      `actor-${actorType}`,
      async (message: PipelineMessage) => {
        await this.handleMessage(actorType, message, workerId)
      },
      concurrency
    )

    for (let i = 0; i < concurrency; i++) {
      this.metricsCollector?.recordActorEvent('created')
      this.metricsCollector?.recordActorEvent('idle')
    }

    console.log(`   ✅ Worker listening on queue: actor-${actorType}`)
  }

  /**
   * Handle a message
   */
  private async handleMessage(actorType: string, message: PipelineMessage, workerId: string): Promise<void> {
    const { pipelineId, stageName, taskIndex, input, metadata } = message.payload
    const attempt = message.payload.attempt ?? 1
    const retryAttempt = message.payload.retryAttempt ?? 1
    const retryPolicy = message.payload.retryPolicy
    const queueName = `actor-${actorType}`
    const leaseId: string | undefined = message.payload.leaseId
    const leaseTtlMs = typeof message.payload.leaseTtlMs === 'number'
      ? message.payload.leaseTtlMs
      : DEFAULT_TASK_LEASE_TTL_MS

    console.log(`\n   🎬 Processing: ${actorType} [task ${taskIndex}]`)
    console.log(`      Pipeline: ${pipelineId}`)
    console.log(`      Stage: ${stageName}`)

    this.metricsCollector?.recordMessageEvent('received')

    if (leaseId && this.stateStore) {
      const lease = await this.stateStore.acquireTaskLease({
        pipelineId,
        stageName,
        taskIndex,
        leaseId,
        ttlMs: leaseTtlMs,
        owner: workerId
      })
      if (!lease) {
        console.warn(`      ⚠️ Unable to acquire lease ${leaseId} for task ${taskIndex}; skipping.`)
        return
      }
    }

    if (this.stateStore && (await this.stateStore.isPipelineCancelled(pipelineId))) {
      throw new Error(`Pipeline ${pipelineId} cancelled`)
    }

    await this.recordTaskState(pipelineId, stageName, taskIndex, attempt, 'running', {
      workerId,
      queueName,
      actorType,
      startedAt: Date.now(),
      messageId: message.messageId,
      leaseId,
      leaseOwner: workerId
    })

    let recordedActivation = false

    try {
      const actorClassOrInstance = this.actors.get(actorType)!
      
      // Support both classes and instances
      const actor = typeof actorClassOrInstance === 'function'
        ? new (actorClassOrInstance as new () => ActorImplementation)()
        : actorClassOrInstance

      this.metricsCollector?.recordActorEvent('activated')
      recordedActivation = true

      const startTime = Date.now()
      const output = await actor.execute(input)
      const duration = Date.now() - startTime

      console.log(`      ✅ Completed in ${duration}ms`)
      this.metricsCollector?.recordMessageEvent('completed', duration)

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
          output,
          workerId,
          attempt,
          durationMs: duration,
          retryAttempt,
          retryPolicy,
          leaseId
        },
        timestamp: new Date().toISOString()
      }

      await this.messageQueue.enqueue('pipeline-stage-results', resultMessage)
      console.log(`      📨 Result sent to: pipeline-stage-results`)
    } catch (error) {
      this.metricsCollector?.recordMessageEvent('failed')
      await this.recordTaskState(pipelineId, stageName, taskIndex, attempt, 'failed', {
        workerId,
        queueName,
        actorType,
        retryAttempt,
        error: {
          message: (error as Error).message,
          occurredAt: Date.now()
        },
        leaseId,
        leaseOwner: workerId
      })
      console.error(`      ❌ Actor failed:`, error)

      const failureMessage: PipelineMessage = {
        messageId: message.messageId + '-failure',
        from: actorType,
        to: pipelineId,
        type: 'failure',
        payload: {
          pipelineId,
          stageName,
          taskIndex,
          actorType,
          input,
          metadata,
          attempt,
          retryAttempt,
          retryPolicy,
          workerId,
          leaseId,
          error: {
            message: (error as Error).message,
            stack: (error as Error).stack
          }
        },
        timestamp: new Date().toISOString()
      }

      await this.messageQueue.enqueue('pipeline-stage-results', failureMessage)
      console.log(`      📨 Failure sent to: pipeline-stage-results`)

      throw error
    } finally {
      if (recordedActivation) {
        this.metricsCollector?.recordActorEvent('idle')
      }
    }
  }

  private async recordTaskState(
    pipelineId: string,
    stageName: string,
    taskIndex: number,
    attempt: number,
    status: TaskStatus,
    patch: Partial<TaskAttemptRecord>
  ): Promise<void> {
    if (!this.stateStore) {
      return
    }

    await this.stateStore.recordTaskAttempt({
      pipelineId,
      stageName,
      taskIndex,
      attempt,
      status,
      ...patch
    })
  }

  /**
   * Cleanup
   */
  async close(): Promise<void> {
    await this.messageQueue.close()
  }
}
