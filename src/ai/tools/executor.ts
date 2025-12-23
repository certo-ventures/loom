/**
 * Tool Executor
 * 
 * Safely executes tools with error handling, timeout, and logging
 * 
 * ~120 lines
 */

import type { Tool, ToolResult, ToolCall } from './types'
import type { ToolRegistry } from './registry'

export interface ExecutorOptions {
  /**
   * Maximum execution time in ms (default: 30000)
   */
  timeout?: number
  
  /**
   * Log tool execution
   */
  logExecution?: boolean
}

export class ToolExecutor {
  private options: Required<ExecutorOptions>
  
  constructor(
    private registry: ToolRegistry,
    options: ExecutorOptions = {}
  ) {
    this.options = {
      timeout: options.timeout ?? 30000,
      logExecution: options.logExecution ?? true,
    }
  }
  
  /**
   * Execute a single tool call
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now()
    
    // Get tool
    const tool = this.registry.get(toolCall.name)
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${toolCall.name}`,
        executionTime: 0,
      }
    }
    
    if (this.options.logExecution) {
      console.log(`🔧 [Tool] Executing: ${toolCall.name}`)
      console.log(`   Arguments:`, JSON.stringify(toolCall.arguments, null, 2))
    }
    
    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(
        tool,
        toolCall.arguments,
        this.options.timeout
      )
      
      const executionTime = Date.now() - startTime
      
      if (this.options.logExecution) {
        console.log(`✅ [Tool] Success (${executionTime}ms)`)
        console.log(`   Result:`, JSON.stringify(result, null, 2))
      }
      
      return {
        success: true,
        data: result,
        executionTime,
      }
    } catch (error) {
      const executionTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (this.options.logExecution) {
        console.error(`❌ [Tool] Failed (${executionTime}ms): ${errorMessage}`)
      }
      
      return {
        success: false,
        error: errorMessage,
        executionTime,
      }
    }
  }
  
  /**
   * Execute multiple tool calls
   */
  async executeMany(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map(call => this.execute(call)))
  }
  
  /**
   * Execute tool with timeout
   */
  private async executeWithTimeout<T>(
    tool: Tool<any, T>,
    params: any,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timeout (${timeoutMs}ms)`))
      }, timeoutMs)
      
      Promise.resolve(tool.execute(params))
        .then(result => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch(error => {
          clearTimeout(timer)
          reject(error)
        })
    })
  }
  
  /**
   * Format tool result for LLM
   */
  formatResult(toolCall: ToolCall, result: ToolResult): string {
    if (result.success) {
      return JSON.stringify(result.data, null, 2)
    } else {
      return `Error: ${result.error}`
    }
  }
}
