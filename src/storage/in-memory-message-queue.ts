import type { Message } from '../types'
import type { MessageQueue } from './message-queue'

interface QueuedMessage {
  message: Message
  priority: number
  visibleAt: number
  attempts: number
  queueName: string
}

/**
 * InMemoryMessageQueue - Simple in-memory implementation for testing
 */
export class InMemoryMessageQueue implements MessageQueue {
  private queues = new Map<string, QueuedMessage[]>()
  private deadLetters = new Map<string, QueuedMessage[]>()
  private processing = new Map<string, QueuedMessage>()

  async enqueue(queueName: string, message: Message, priority = 0): Promise<void> {
    if (!this.queues.has(queueName)) {
      this.queues.set(queueName, [])
    }

    const queue = this.queues.get(queueName)!
    queue.push({
      message,
      priority,
      visibleAt: Date.now(),
      attempts: 0,
      queueName,
    })

    // Sort by priority (higher first), then FIFO
    queue.sort((a, b) => b.priority - a.priority)
  }

  async dequeue(queueName: string, timeoutMs: number): Promise<Message | null> {
    const queue = this.queues.get(queueName)
    if (!queue || queue.length === 0) return null

    const now = Date.now()
    const available = queue.find(item => item.visibleAt <= now)
    
    if (!available) return null

    // Remove from queue and mark as processing
    const index = queue.indexOf(available)
    queue.splice(index, 1)
    
    available.visibleAt = now + timeoutMs
    available.attempts++
    this.processing.set(available.message.messageId, available)

    return available.message
  }

  async ack(message: Message): Promise<void> {
    this.processing.delete(message.messageId)
  }

  async nack(message: Message, delayMs = 0): Promise<void> {
    const item = this.processing.get(message.messageId)
    if (!item) return

    this.processing.delete(message.messageId)
    
    // Return to queue with delay
    item.visibleAt = Date.now() + delayMs
    
    if (!this.queues.has(item.queueName)) {
      this.queues.set(item.queueName, [])
    }
    this.queues.get(item.queueName)!.push(item)
  }

  async deadLetter(message: Message): Promise<void> {
    const item = this.processing.get(message.messageId)
    if (!item) return

    this.processing.delete(message.messageId)

    const dlqName = 'dead-letter'
    if (!this.deadLetters.has(dlqName)) {
      this.deadLetters.set(dlqName, [])
    }
    this.deadLetters.get(dlqName)!.push(item)
  }

  // Helper for testing
  clear(): void {
    this.queues.clear()
    this.deadLetters.clear()
    this.processing.clear()
  }
}
