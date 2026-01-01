import type { Message, RetryPolicy } from '../types'
import type { MessageQueue } from '../storage'
import type { MetricsCollector } from '../observability/types'

/**
 * RetryHandler - Manages retry logic for failed operations
 * 
 * Features:
 * - Exponential backoff with jitter
 * - Configurable retry policies
 * - Dead letter queue for exhausted retries
 * - Retry tracking and metrics
 */
export class RetryHandler {
  constructor(
    private messageQueue: MessageQueue,
    private defaultPolicy: RetryPolicy,
    private metricsCollector?: MetricsCollector
  ) {}

  /**
   * Calculate delay for next retry using exponential backoff
   */
  private calculateDelay(retryCount: number, policy: RetryPolicy): number {
    const baseDelay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, retryCount)
    const cappedDelay = Math.min(baseDelay, policy.maxDelayMs)
    
    // Add jitter (±25%) to prevent thundering herd
    const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1)
    
    return Math.floor(cappedDelay + jitter)
  }

  /**
   * Check if error is retryable based on policy
   */
  private isRetryable(error: Error, policy: RetryPolicy): boolean {
    // If no specific retryable errors defined, retry all
    if (!policy.retryableErrors || policy.retryableErrors.length === 0) {
      return true
    }

    // Check if error message contains any retryable error pattern
    const errorMessage = error.message.toLowerCase()
    return policy.retryableErrors.some(pattern => 
      errorMessage.includes(pattern.toLowerCase())
    )
  }

  /**
   * Handle a failed message - either retry or dead letter
   */
  async handleFailure(
    message: Message,
    error: Error,
    queue: string,
    policy?: RetryPolicy
  ): Promise<void> {
    const effectivePolicy = policy || this.defaultPolicy
    const retryCount = message.metadata.retryCount || 0
    const maxRetries = message.metadata.maxRetries ?? effectivePolicy.maxRetries

    // Record failure metric
    this.metricsCollector?.recordMessageEvent?.('retry_evaluation')

    // Check if we should retry
    if (retryCount < maxRetries && this.isRetryable(error, effectivePolicy)) {
      this.metricsCollector?.recordMessageEvent?.('retry_scheduled')
      await this.scheduleRetry(message, queue, retryCount, effectivePolicy)
    } else {
      this.metricsCollector?.recordMessageEvent?.('moved_to_dlq')
      await this.sendToDeadLetter(message, error, queue)
    }
  }

  /**
   * Schedule a retry with exponential backoff
   */
  private async scheduleRetry(
    message: Message,
    queue: string,
    retryCount: number,
    policy: RetryPolicy
  ): Promise<void> {
    const delay = this.calculateDelay(retryCount, policy)
    
    // Create retry message with updated metadata
    const retryMessage: Message = {
      ...message,
      messageId: `${message.messageId}-retry-${retryCount + 1}`,
      messageType: 'retry',
      metadata: {
        ...message.metadata,
        retryCount: retryCount + 1,
        originalMessageId: message.metadata.originalMessageId || message.messageId,
        timestamp: new Date(Date.now() + delay).toISOString(),
      },
    }

    // Enqueue with delay
    // In production, this would use BullMQ's delayed job feature
    // For now, we'll just enqueue immediately and rely on the timestamp
    await this.messageQueue.enqueue(queue, retryMessage)
  }

  /**
   * Send message to dead letter queue after exhausted retries
   */
  private async sendToDeadLetter(
    message: Message,
    error: Error,
    queue: string
  ): Promise<void> {
    const deadLetterMessage: Message = {
      ...message,
      messageId: `dlq-${message.messageId}`,
      metadata: {
        ...message.metadata,
        timestamp: new Date().toISOString(),
      },
      payload: {
        originalPayload: message.payload,
        error: {
          message: error.message,
          stack: error.stack,
        },
        queue,
      },
    }

    await this.messageQueue.deadLetter(deadLetterMessage)
  }

  /**
   * Wrap an async operation with retry logic
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    policy?: RetryPolicy
  ): Promise<T> {
    const effectivePolicy = policy || this.defaultPolicy
    let lastError: Error = new Error('Unknown error')
    
    for (let attempt = 0; attempt <= effectivePolicy.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.metricsCollector?.recordMessageEvent?.('retry_attempt')
        }
        const result = await operation()
        if (attempt > 0) {
          this.metricsCollector?.recordMessageEvent?.('retry_success')
        }
        return result
      } catch (error) {
        lastError = error as Error
        
        if (attempt === effectivePolicy.maxRetries || !this.isRetryable(lastError, effectivePolicy)) {
          this.metricsCollector?.recordMessageEvent?.('retry_exhausted')
          throw lastError
        }

        // Wait before retry
        const delay = this.calculateDelay(attempt, effectivePolicy)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    throw lastError
  }
}
