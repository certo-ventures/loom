/**
 * Tool Registry
 * 
 * Central registry for tools that AI agents can use
 * Supports registration, lookup, and listing
 * 
 * ~80 lines
 */

import type { Tool } from './types'

export class ToolRegistry {
  private tools = new Map<string, Tool>()
  
  /**
   * Register a tool
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`)
    }
    this.tools.set(tool.name, tool)
  }
  
  /**
   * Register multiple tools
   */
  registerMany(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool)
    }
  }
  
  /**
   * Get a tool by name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }
  
  /**
   * Check if tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }
  
  /**
   * List all registered tools
   */
  list(): Tool[] {
    return Array.from(this.tools.values())
  }
  
  /**
   * List tools by category
   */
  listByCategory(category: string): Tool[] {
    return this.list().filter(t => t.category === category)
  }
  
  /**
   * Get tool names (for LLM context)
   */
  getNames(): string[] {
    return Array.from(this.tools.keys())
  }
  
  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }
  
  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear()
  }
  
  /**
   * Get tool count
   */
  size(): number {
    return this.tools.size
  }
  
  /**
   * Export tools in OpenAI function calling format
   */
  toOpenAIFormat(): any[] {
    return this.list().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }
  
  /**
   * Export tools in Anthropic tool use format
   */
  toAnthropicFormat(): any[] {
    return this.list().map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }))
  }
}
