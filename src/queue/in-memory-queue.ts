/**
 * In-Memory Message Queue - Simple BullMQ replacement for testing
 * 
 * Enqueue, dequeue, ack, nack with retries
 * REAL enough to test the system!
 */

export interface QueueMessage<T = any> {
  id: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  enqueuedAt: Date;
  processedAt?: Date;
}

export interface QueueOptions {
  maxAttempts?: number;
  retryDelay?: number; // milliseconds
}

export type MessageHandler<T = any> = (message: QueueMessage<T>) => Promise<void>;

/**
 * Simple in-memory message queue
 * Like BullMQ but in-memory for testing
 */
export class InMemoryQueue<T = any> {
  private queue: QueueMessage<T>[] = [];
  private processing = new Map<string, QueueMessage<T>>();
  private deadLetters: QueueMessage<T>[] = [];
  private nextId = 1;
  private handlers: MessageHandler<T>[] = [];
  private isProcessing = false;
  private options: QueueOptions;

  constructor(options: QueueOptions = {}) {
    this.options = {
      maxAttempts: options.maxAttempts || 3,
      retryDelay: options.retryDelay || 1000,
    };
  }

  /**
   * Add message to queue
   */
  async enqueue(data: T): Promise<string> {
    const message: QueueMessage<T> = {
      id: `msg-${this.nextId++}`,
      data,
      attempts: 0,
      maxAttempts: this.options.maxAttempts!,
      enqueuedAt: new Date(),
    };

    this.queue.push(message);
    
    // Trigger processing
    this.processQueue().catch(console.error);

    return message.id;
  }

  /**
   * Register message handler
   */
  process(handler: MessageHandler<T>): void {
    this.handlers.push(handler);
    this.processQueue().catch(console.error);
  }

  /**
   * Acknowledge message (remove from queue)
   */
  async ack(messageId: string): Promise<void> {
    this.processing.delete(messageId);
  }

  /**
   * Negative acknowledge (requeue with retry)
   */
  async nack(messageId: string): Promise<void> {
    const message = this.processing.get(messageId);
    if (!message) return;

    this.processing.delete(messageId);
    message.attempts++;

    if (message.attempts >= message.maxAttempts) {
      // Move to dead letter queue
      this.deadLetters.push(message);
    } else {
      // Requeue after delay
      setTimeout(() => {
        this.queue.push(message);
        this.processQueue().catch(console.error);
      }, this.options.retryDelay);
    }
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.length + this.processing.size;
  }

  /**
   * Get dead letter count
   */
  deadLetterCount(): number {
    return this.deadLetters.length;
  }

  /**
   * Clear all messages (for testing)
   */
  async clear(): Promise<void> {
    this.queue = [];
    this.processing.clear();
    this.deadLetters = [];
  }

  /**
   * Process queue (internal)
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.handlers.length === 0 || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (!message) break;

      message.attempts++;
      message.processedAt = new Date();
      this.processing.set(message.id, message);

      // Process with all handlers
      try {
        for (const handler of this.handlers) {
          await handler(message);
        }
        // Auto-ack if no error
        await this.ack(message.id);
      } catch (error) {
        console.error('Message processing failed:', error);
        await this.nack(message.id);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Wait for queue to be empty (for testing)
   */
  async waitUntilEmpty(timeout = 5000): Promise<void> {
    const start = Date.now();
    while (this.size() > 0) {
      if (Date.now() - start > timeout) {
        throw new Error('Queue did not empty within timeout');
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}
