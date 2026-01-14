/**
 * AIActor - Actor with built-in LLM and Tool capabilities
 * 
 * Extends base Actor with:
 * - Unified LLM API integration
 * - Tool calling support
 * - Automatic journaling of LLM calls and tool executions
 * - Streaming support
 * - Token usage tracking
 * 
 * Philosophy: Opt-in AI layer, minimal overhead when not using LLM
 * ~250 lines with tool support
 */

import { Actor } from './actor'
import { UnifiedLLM } from '../ai/unified-llm'
import type { LLMConfig, LLMMessage, LLMResponse } from '../ai/llm-provider'
import type { ActorContext } from './journal'
import { ToolRegistry, ToolExecutor } from '../ai/tools'
import type { Tool, ToolCall, LLMToolResponse } from '../ai/tools/types'
import { OpenAIProvider } from '../ai/providers/openai'
import { AnthropicProvider } from '../ai/providers/anthropic'
import { AzureOpenAIProvider } from '../ai/providers/azure-openai'
import { ActorToolRegistry, type ActorExecutor } from '../ai'
import type { DataStore } from '../../packages/loom-server/src/registry/data-store'
import type { ActorFilter } from '../../packages/loom-server/src/types'

export abstract class AIActor extends Actor {
  protected llm?: UnifiedLLM
  protected toolRegistry: ToolRegistry
  protected toolExecutor?: ToolExecutor

  constructor(context: ActorContext, initialState?: Record<string, unknown>) {
    super(context, initialState)
    
    this.toolRegistry = new ToolRegistry()
    
    // Restore LLM from state if config exists (actor recovery/replay)
    if (this.state._llmConfig) {
      this.llm = new UnifiedLLM(this.state._llmConfig as LLMConfig)
      this.toolExecutor = new ToolExecutor(this.toolRegistry)
    }
  }

  /**
   * Initialize LLM with configuration reference
   * Resolves config from ConfigResolver using actor's context
   * Config path: 'azure-openai', 'anthropic', etc.
   */
  protected async initializeLLMFromConfig(configKey: string): Promise<void> {
    const config = await this.getConfig<LLMConfig>(configKey)
    if (!config) {
      throw new Error(`LLM config not found: ${configKey}`)
    }
    this.llm = new UnifiedLLM(config)
    
    // Store config in state for actor recovery/replay
    this.updateState(draft => {
      draft._llmConfig = config
      draft._llmConfigKey = configKey
    })
  }

  /**
   * Initialize LLM with direct configuration
   * Use this for testing or when config is provided directly
   */
  protected initializeLLM(config: LLMConfig): void {
    this.llm = new UnifiedLLM(config)
    this.toolExecutor = new ToolExecutor(this.toolRegistry)
    
    // Store config in state for actor recovery/replay
    this.updateState(draft => {
      draft._llmConfig = config
    })
  }
  
  /**
   * Register a tool that this actor can use
   */
  protected registerTool(tool: Tool): void {
    this.toolRegistry.register(tool)
  }
  
  /**
   * Register multiple tools
   */
  protected registerTools(tools: Tool[]): void {
    this.toolRegistry.registerMany(tools)
  }

  /**
   * Chat completion with automatic journaling
   * Returns just the content string for convenience
   */
  protected async chat(
    messages: LLMMessage[],
    options?: Partial<LLMConfig>
  ): Promise<string> {
    if (!this.llm) {
      throw new Error('LLM not initialized. Call initializeLLM() first.')
    }

    const startTime = Date.now()
    const response = await this.llm.chat(messages, options)
    const duration = Date.now() - startTime

    // Journal the LLM call for replay and audit
    this.updateState(draft => {
      draft._lastLLMCall = {
        timestamp: new Date().toISOString(),
        messages,
        response: response.content,
        usage: response.usage,
        model: response.model,
        duration,
      }
    })

    return response.content
  }

  /**
   * Get full LLM response with usage information
   */
  protected async chatWithMetadata(
    messages: LLMMessage[],
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse> {
    if (!this.llm) {
      throw new Error('LLM not initialized. Call initializeLLM() first.')
    }

    const response = await this.llm.chat(messages, options)

    // Journal the LLM call
    this.updateState(draft => {
      draft._lastLLMCall = {
        timestamp: new Date().toISOString(),
        messages,
        response: response.content,
        usage: response.usage,
        model: response.model,
      }
    })

    return response
  }

  /**
   * Streaming chat with chunk callback
   * Useful for real-time UX
   */
  protected async streamChat(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void,
    options?: Partial<LLMConfig>
  ): Promise<string> {
    if (!this.llm) {
      throw new Error('LLM not initialized. Call initializeLLM() first.')
    }

    const startTime = Date.now()
    const response = await this.llm.stream(messages, onChunk, options)
    const duration = Date.now() - startTime

    // Journal the completed stream
    this.updateState(draft => {
      draft._lastLLMCall = {
        timestamp: new Date().toISOString(),
        messages,
        response: response.content,
        usage: response.usage,
        model: response.model,
        duration,
        streamed: true,
      }
    })

    return response.content
  }

  /**
   * Get LLM configuration
   */
  protected getLLMConfig(): LLMConfig | undefined {
    return this.llm?.getConfig()
  }

  /**
   * Update LLM configuration
   */
  protected updateLLMConfig(updates: Partial<LLMConfig>): void {
    if (!this.llm) {
      throw new Error('LLM not initialized. Call initializeLLM() first.')
    }
    this.llm.updateConfig(updates)
  }

  /**
   * Get last LLM call from state (for debugging/replay)
   */
  protected getLastLLMCall(): any {
    return this.state._lastLLMCall
  }
  
  /**
   * Chat with automatic tool calling
   * LLM can call registered tools autonomously
   * Returns final response after all tool calls are resolved
   */
  protected async chatWithTools(
    messages: LLMMessage[],
    options?: Partial<LLMConfig & { maxToolRounds?: number }>
  ): Promise<string> {
    if (!this.llm) {
      throw new Error('LLM not initialized. Call initializeLLM() first.')
    }
    
    if (!this.toolExecutor) {
      throw new Error('Tool executor not initialized.')
    }
    
    const config = this.llm.getConfig()
    const maxRounds = options?.maxToolRounds ?? 5
    let currentMessages = [...messages]
    let round = 0
    
    // Get provider for tool calling
    const provider = this.getToolProvider(config)
    if (!provider) {
      throw new Error(`Tool calling not supported for provider: ${config.provider}`)
    }
    
    while (round < maxRounds) {
      round++
      
      // Get tools in provider format
      const tools = (config.provider === 'openai' || config.provider === 'azure-openai')
        ? this.toolRegistry.toOpenAIFormat()
        : this.toolRegistry.toAnthropicFormat()
      
      // Call LLM with tools
      const response = await provider.chatWithTools(currentMessages, tools, options)
      
      // Journal the call
      this.updateState(draft => {
        draft._lastToolCall = {
          timestamp: new Date().toISOString(),
          round,
          messages: currentMessages,
          response: response.content,
          toolCalls: response.toolCalls,
          usage: response.usage,
        }
      })
      
      // If no tool calls, return final response
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return response.content
      }
      
      // Execute tool calls
      console.log(`\n🔧 [AIActor] Round ${round}: ${response.toolCalls.length} tool(s) called`)
      
      const toolResults = await this.toolExecutor.executeMany(response.toolCalls)
      
      // Add assistant message with tool calls to conversation
      currentMessages.push({
        role: 'assistant',
        content: response.content || `Calling ${response.toolCalls.length} tool(s)...`,
      })
      
      // Add tool results to conversation
      for (let i = 0; i < response.toolCalls.length; i++) {
        const toolCall = response.toolCalls[i]
        const result = toolResults[i]
        
        currentMessages.push({
          role: 'user',
          content: `Tool "${toolCall.name}" result: ${this.toolExecutor.formatResult(toolCall, result)}`,
        })
      }
    }
    
    throw new Error(`Max tool rounds (${maxRounds}) exceeded`)
  }
  
  /**
   * Get provider with tool calling support
   */
  private getToolProvider(config: LLMConfig): { chatWithTools: (messages: LLMMessage[], tools: any[], options?: any) => Promise<LLMToolResponse> } | null {
    if (config.provider === 'openai') {
      return new OpenAIProvider(config)
    }
    if (config.provider === 'anthropic') {
      return new AnthropicProvider(config)
    }
    if (config.provider === 'azure-openai') {
      return new AzureOpenAIProvider(config)
    }
    return null
  }
  
  /**
   * Execute a single tool manually
   */
  protected async executeTool(toolCall: ToolCall): Promise<any> {
    if (!this.toolExecutor) {
      throw new Error('Tool executor not initialized.')
    }
    
    const result = await this.toolExecutor.execute(toolCall)
    
    // Journal tool execution
    this.updateState(draft => {
      draft._lastManualToolCall = {
        timestamp: new Date().toISOString(),
        toolCall,
        result,
      }
    })
    
    if (!result.success) {
      throw new Error(result.error)
    }
    
    return result.data
  }

  /**
   * Register actors from registry as tools
   * Enables LLM to orchestrate actors dynamically
   */
  async registerActorsAsTools(
    dataStore: DataStore,
    executor: ActorExecutor,
    filter?: ActorFilter
  ): Promise<void> {
    const actorRegistry = new ActorToolRegistry({
      dataStore,
      executor,
      filter,
      autoRefresh: false,
    })
    
    await actorRegistry.load()
    const actorTools = actorRegistry.getTools()
    
    this.registerTools(actorTools)
    
    // Journal registered actors
    this.updateState(draft => {
      draft._registeredActors = actorRegistry.getStats()
    })
  }

  /**
   * Get actor tool registry for dynamic orchestration
   */
  async getActorToolRegistry(
    dataStore: DataStore,
    executor: ActorExecutor,
    filter?: ActorFilter,
    options?: { autoRefresh?: boolean; refreshIntervalMs?: number }
  ): Promise<ActorToolRegistry> {
    const registry = new ActorToolRegistry({
      dataStore,
      executor,
      filter,
      autoRefresh: options?.autoRefresh,
      refreshIntervalMs: options?.refreshIntervalMs,
    })
    
    await registry.load()
    return registry
  }
}
