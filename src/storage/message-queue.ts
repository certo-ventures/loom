import type { Message } from '../types'

/**
 * MessageQueue - Reliable message delivery between actors
 */
export interface MessageQueue {
  /**
   * Enqueue a message to a queue
   */
  enqueue(queueName: string, message: Message, priority?: number): Promise<void>

  /**
   * Dequeue a message from a queue (with visibility timeout)
   */
  dequeue(queueName: string, timeoutMs: number): Promise<Message | null>

  /**
   * Acknowledge successful processing
   */
  ack(message: Message): Promise<void>

  /**
   * Negative acknowledge - return to queue with optional delay
   */
  nack(message: Message, delayMs?: number): Promise<void>

  /**
   * Move message to dead letter queue
   */
  deadLetter(message: Message): Promise<void>
}
