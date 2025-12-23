/**
 * Tool System Types
 * 
 * Defines tools that AI agents can call to interact with external systems
 * Compatible with OpenAI function calling and Anthropic tool use
 */

/**
 * JSON Schema for tool parameters
 */
export interface ToolParameterSchema {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array'
  description?: string
  properties?: Record<string, ToolParameterSchema>
  required?: string[]
  items?: ToolParameterSchema
  enum?: any[]
}

/**
 * Tool definition
 */
export interface Tool<TParams = any, TReturn = any> {
  /**
   * Unique tool name (snake_case recommended)
   */
  name: string
  
  /**
   * Human-readable description of what the tool does
   */
  description: string
  
  /**
   * JSON schema for parameters
   */
  parameters: ToolParameterSchema
  
  /**
   * Tool execution function
   */
  execute: (params: TParams) => Promise<TReturn> | TReturn
  
  /**
   * Optional: Category for organizing tools
   */
  category?: string
  
  /**
   * Optional: Metadata for additional context
   */
  metadata?: Record<string, any>
}

/**
 * Tool execution result
 */
export interface ToolResult<T = any> {
  success: boolean
  data?: T
  error?: string
  executionTime?: number
}

/**
 * Tool call request from LLM
 */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

/**
 * Tool call response to LLM
 */
export interface ToolCallResponse {
  id: string
  name: string
  result: string // JSON stringified result
}

/**
 * LLM response with tool calls
 */
export interface LLMToolResponse {
  content: string
  toolCalls?: ToolCall[]
  finishReason?: 'stop' | 'tool_calls' | 'length'
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}
