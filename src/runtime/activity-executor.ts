import type { ActivityStore } from '../storage/activity-store'
import type { BlobStore } from '../storage/blob-store'
import type { MessageQueue } from '../storage/message-queue'
import { WasmActivityExecutor } from '../activities/wasm-executor'
import type { ActivitySuspendError } from '../actor'
import { RetryHandler } from './retry-handler'
import { DEFAULT_RETRY_POLICIES } from '../types'
import type { RetryPolicy } from '../types'
import { logger, metrics } from '../observability'

/**
 * ActivityExecutor - Executes activities when actors suspend
 * 
 * When an actor suspends for an activity:
 * 1. Resolve activity definition from ActivityStore
 * 2. Execute activity via WasmExecutor (with retries!)
 * 3. Enqueue activity_completed or activity_failed message
 * 4. Actor resumes with result
 * 
 * This completes the suspend/resume cycle!
 */
export class ActivityExecutor {
  private wasmExecutor: WasmActivityExecutor
  private retryHandler: RetryHandler

  constructor(
    private activityStore: ActivityStore,
    private blobStore: BlobStore,
    private messageQueue: MessageQueue,
    private retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICIES.activity
  ) {
    this.wasmExecutor = new WasmActivityExecutor(blobStore)
    this.retryHandler = new RetryHandler(messageQueue, retryPolicy)
  }

  /**
   * Execute an activity that an actor is suspended for
   */
  async execute(
    actorId: string,
    actorType: string,
    error: ActivitySuspendError,
    retryCount: number = 0
  ): Promise<void> {
    const { activityId, activityName, input } = error
    const startTime = Date.now()

    const actLogger = logger.child({
      actorId,
      activityId,
      activityName,
      retryCount,
    })

    actLogger.info('Starting activity execution')
    metrics.increment('activity.started', 1, { activityName })

    try {
      // 1. Resolve activity definition from store
      const definition = await this.activityStore.resolve(activityName)
      actLogger.debug({ version: definition.version }, 'Activity resolved')

      // 2. Execute the activity via WASM executor WITH RETRIES
      const result = await this.retryHandler.withRetry(
        () => this.wasmExecutor.execute(definition, input),
        this.retryPolicy
      )

      const duration = Date.now() - startTime
      actLogger.info({ durationMs: duration }, 'Activity completed successfully')
      metrics.increment('activity.completed', 1, { activityName })
      metrics.timing('activity.duration', duration, {
        activityName,
        status: 'success',
      })

      // 3. Enqueue activity_completed message to resume actor
      await this.messageQueue.enqueue(`actor:${actorType}`, {
        messageId: `activity-result-${activityId}`,
        actorId,
        messageType: 'activity_completed',
        correlationId: actorId,
        payload: {
          activityId,
          result,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          priority: 0,
          retryCount,
        },
      })
    } catch (executionError: any) {
      const duration = Date.now() - startTime
      actLogger.error(
        { err: executionError, durationMs: duration },
        'Activity failed after all retries'
      )
      metrics.increment('activity.failed', 1, { activityName })
      metrics.timing('activity.duration', duration, {
        activityName,
        status: 'failed',
      })

      // Activity failed after all retries - enqueue failure message
      await this.messageQueue.enqueue(`actor:${actorType}`, {
        messageId: `activity-error-${activityId}`,
        actorId,
        messageType: 'activity_failed',
        correlationId: actorId,
        payload: {
          activityId,
          error: executionError.message || String(executionError),
        },
        metadata: {
          timestamp: new Date().toISOString(),
          priority: 0,
          retryCount,
        },
      })
    }
  }
}
