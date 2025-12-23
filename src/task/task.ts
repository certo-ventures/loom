/**
 * Task - Lightweight abstraction for stateless operations
 * 
 * Use Tasks for fire-and-forget operations that don't need:
 * - State persistence
 * - Journal replay
 * - Actor pool overhead
 * 
 * Perfect for:
 * - Sending notifications
 * - Triggering webhooks
 * - Simple transformations
 * - One-off calculations
 */

/**
 * Task execution context
 */
export interface TaskContext {
  taskId: string
  taskType: string
  correlationId?: string
  metadata?: Record<string, unknown>
}

/**
 * Task execution result
 */
export interface TaskResult<T = unknown> {
  success: boolean
  data?: T
  error?: Error
  duration: number
}

/**
 * Base Task class
 */
export abstract class Task<TInput = unknown, TOutput = unknown> {
  /**
   * Execute the task (implement this)
   */
  abstract execute(input: TInput, context: TaskContext): Promise<TOutput>
  
  /**
   * Run task with timing and error handling
   */
  async run(input: TInput, context?: Partial<TaskContext>): Promise<TaskResult<TOutput>> {
    const startTime = Date.now()
    const taskContext: TaskContext = {
      taskId: context?.taskId || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      taskType: this.constructor.name,
      correlationId: context?.correlationId,
      metadata: context?.metadata,
    }
    
    try {
      const data = await this.execute(input, taskContext)
      const duration = Date.now() - startTime
      
      return {
        success: true,
        data,
        duration,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        duration,
      }
    }
  }
  
  /**
   * Get task name
   */
  get name(): string {
    return this.constructor.name
  }
}

/**
 * Helper to create inline tasks without subclassing
 */
export function createTask<TInput = unknown, TOutput = unknown>(
  name: string,
  executeFn: (input: TInput, context: TaskContext) => Promise<TOutput>
): Task<TInput, TOutput> {
  return new (class extends Task<TInput, TOutput> {
    async execute(input: TInput, context: TaskContext): Promise<TOutput> {
      return executeFn(input, context)
    }
    
    get name(): string {
      return name
    }
  })()
}
