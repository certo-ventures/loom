import type { ActorRuntime, ActorFactory } from './actor-runtime'
import type { MessageQueue } from '../storage'
import type { Message, RetryPolicy } from '../types'
import { ActivitySuspendError, EventSuspendError } from '../actor'
import type { ActivityExecutor } from './activity-executor'
import { RetryHandler } from './retry-handler'
import { DEFAULT_RETRY_POLICIES } from '../types'

/**
 * ActorWorker - The heartbeat of the system!
 * 
 * Continuously processes messages from BullMQ:
 * 1. Dequeues messages for actors
 * 2. Activates target actor
 * 3. Executes actor with message payload
 * 4. Handles suspensions (activities, events)
 * 5. Deactivates actor when done
 * 6. Retries on failures with exponential backoff
 * 
 * This is what makes everything RUN autonomously!
 */
export class ActorWorker {
  private isRunning = false
  private workerPromise: Promise<void> | null = null
  private retryHandler: RetryHandler

  constructor(
    private runtime: ActorRuntime,
    private messageQueue: MessageQueue,
    private actorType: string, // Which type of actors this worker processes
    private activityExecutor?: ActivityExecutor, // Optional - for activity execution
    private retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICIES.message
  ) {
    this.retryHandler = new RetryHandler(messageQueue, retryPolicy)
  }

  /**
   * Start the worker loop
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Worker already running')
    }

    this.isRunning = true
    this.workerPromise = this.run()
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    this.isRunning = false
    if (this.workerPromise) {
      await this.workerPromise
    }
  }

  /**
   * Main worker loop
   */
  private async run(): Promise<void> {
    const queueName = `actor:${this.actorType}`

    while (this.isRunning) {
      try {
        // 1. Dequeue next message (blocks with timeout)
        const message = await this.messageQueue.dequeue(queueName, 5000)

        if (!message) {
          // Timeout - no messages available, loop again
          continue
        }

        // 2. Process the message
        await this.processMessage(message)

        // 3. Acknowledge successful processing
        await this.messageQueue.ack(message)
      } catch (error) {
        console.error('Worker error:', error)
        // Continue processing - don't crash the worker
      }
    }
  }

  /**
   * Process a single message
   */
  private async processMessage(message: Message): Promise<void> {
    const { actorId, messageType, payload } = message

    try {
      // 1. Activate actor (or get if already active)
      const actor = await this.runtime.activateActor(actorId, this.actorType)

      // 2. Execute based on message type
      if (messageType === 'execute') {
        // Initial execution
        await actor.execute(payload)
      } else if (messageType === 'activity_completed') {
        // Resume from activity completion
        const { activityId, result } = payload as any
        await actor.resumeWithActivity(activityId, result)
      } else if (messageType === 'activity_failed') {
        // Resume from activity failure
        const { activityId, error } = payload as any
        await actor.resumeWithActivityError(activityId, error)
      } else if (messageType === 'event') {
        // Resume from external event
        const { eventType, data } = payload as any
        await actor.resume(eventType, data)
      }

      // 3. Deactivate actor (saves state, releases lock)
      await this.runtime.deactivateActor(actorId)
    } catch (error) {
      if (error instanceof ActivitySuspendError) {
        // Actor suspended waiting for activity - this is expected!
        // The activity will be executed separately, then actor resumed
        await this.handleActivitySuspension(actorId, error)
      } else if (error instanceof EventSuspendError) {
        // Actor suspended waiting for event - this is expected!
        // Just deactivate, it will resume when event arrives
        await this.runtime.deactivateActor(actorId)
      } else {
        // Actual error - deactivate and rethrow
        await this.runtime.deactivateActor(actorId)
        throw error
      }
    }
  }

  /**
   * Handle actor suspension for activity execution
   */
  private async handleActivitySuspension(
    actorId: string,
    error: ActivitySuspendError
  ): Promise<void> {
    // Deactivate the suspended actor
    await this.runtime.deactivateActor(actorId)

    // If we have an activity executor, use it!
    if (this.activityExecutor) {
      await this.activityExecutor.execute(actorId, this.actorType, error)
    } else {
      // No executor - just log (for testing/development)
      console.log(
        `Actor ${actorId} suspended for activity: ${error.activityName}`,
        `Activity ID: ${error.activityId}`,
        `Note: No ActivityExecutor configured - activity will not execute`
      )
    }
  }
}
