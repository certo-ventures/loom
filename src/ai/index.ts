/**
 * AI Agent Platform - The BRAIN of Loom! 🧠
 * 
 * Multi-LLM support, memory, planning, tool orchestration
 * All MINIMAL and POWERFUL! 
 */

import { OpenAI } from 'openai'
import { Actor } from '../actor'

/**
 * LLM Provider types - support everything!
 */
export type LLMProvider = 'azure-openai' | 'openai' | 'gemini' | 'anthropic' | 'custom'

/**
 * LLM Configuration - flexible for any provider
 */
export interface LLMConfig {
  provider: LLMProvider
  apiKey?: string
  endpoint?: string // For Azure OpenAI or custom endpoints
  model: string
  temperature?: number
  maxTokens?: number
  deploymentName?: string // For Azure OpenAI
}

/**
 * Message in conversation
 */
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string // For tool responses
  tool_call_id?: string
}

/**
 * Tool definition for LLM
 */
export interface Tool {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

/**
 * LLM Response
 */
export interface LLMResponse {
  content: string
  tool_calls?: Array<{
    id: string
    name: string
    arguments: Record<string, any>
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  cost?: number // Estimated cost in USD
}

/**
 * Memory types for agents
 */
export interface AgentMemory {
  working: ConversationMessage[] // Short-term (current conversation)
  longTerm: Array<{ // Long-term (semantic search)
    content: string
    embedding?: number[]
    timestamp: string
    metadata?: Record<string, any>
  }>
}

/**
 * Prompt template
 */
export interface PromptTemplate {
  name: string
  template: string
  variables: string[]
  version?: string
}

/**
 * LLM Client - unified interface for all providers
 */
export class LLMClient {
  private openai?: OpenAI

  constructor(private config: LLMConfig) {
    if (config.provider === 'azure-openai' || config.provider === 'openai') {
      this.openai = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.endpoint,
        defaultQuery: config.deploymentName
          ? { 'api-version': '2024-02-01' }
          : undefined,
      })
    }
    // Add other providers here (Gemini, Anthropic, etc.)
  }

  /**
   * Call LLM with messages
   */
  async chat(
    messages: ConversationMessage[],
    tools?: Tool[]
  ): Promise<LLMResponse> {
    if (this.config.provider === 'azure-openai' || this.config.provider === 'openai') {
      const model = this.config.deploymentName || this.config.model
      
      const response = await this.openai!.chat.completions.create({
        model,
        messages: messages as any,
        temperature: this.config.temperature ?? 0.7,
        max_tokens: this.config.maxTokens,
        tools: tools?.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      })

      const choice = response.choices[0]
      const usage = response.usage!

      return {
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls?.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })),
        usage: {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        },
        cost: this.estimateCost(usage.prompt_tokens, usage.completion_tokens),
      }
    }

    throw new Error(`Provider ${this.config.provider} not yet implemented`)
  }

  /**
   * Estimate cost in USD (rough estimates)
   */
  private estimateCost(promptTokens: number, completionTokens: number): number {
    // GPT-4 pricing (approximate)
    const promptCost = (promptTokens / 1000) * 0.03
    const completionCost = (completionTokens / 1000) * 0.06
    return promptCost + completionCost
  }
}

/**
 * Prompt Manager - load templates from anywhere
 */
export class PromptManager {
  private templates = new Map<string, PromptTemplate>()

  /**
   * Register a prompt template
   */
  register(template: PromptTemplate): void {
    this.templates.set(template.name, template)
  }

  /**
   * Render a template with variables
   */
  render(name: string, variables: Record<string, any>): string {
    const template = this.templates.get(name)
    if (!template) {
      throw new Error(`Template ${name} not found`)
    }

    let rendered = template.template
    for (const [key, value] of Object.entries(variables)) {
      rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), String(value))
    }
    return rendered
  }

  /**
   * Load template from external source (URL, file, etc.)
   */
  async loadFromUrl(url: string): Promise<void> {
    const response = await fetch(url)
    const template = await response.json()
    this.register(template)
  }
}

/**
 * Base class for AI Agents - inherit from this!
 */
export abstract class AIAgent extends Actor {
  protected llm: LLMClient
  protected promptManager: PromptManager
  protected memory: AgentMemory = {
    working: [],
    longTerm: [],
  }

  constructor(context: any, state?: any) {
    super(context, state)
    
    // Don't initialize LLM in base class - let subclass do it
    this.llm = null as any
    this.promptManager = new PromptManager()
  }

  /**
   * Configure LLM (call from subclass constructor)
   */
  protected configureLLM(config: LLMConfig): void {
    this.llm = new LLMClient(config)
  }

  /**
   * Add message to working memory
   */
  protected addToMemory(role: ConversationMessage['role'], content: string): void {
    this.memory.working.push({ role, content })
    this.updateState({ memory: this.memory })
  }

  /**
   * Get conversation history
   */
  protected getConversationHistory(): ConversationMessage[] {
    return this.memory.working
  }

  /**
   * Call LLM with current conversation
   */
  protected async callLLM(
    userMessage?: string,
    tools?: Tool[]
  ): Promise<LLMResponse> {
    if (userMessage) {
      this.addToMemory('user', userMessage)
    }

    const response = await this.llm.chat(this.memory.working, tools)
    
    if (response.content) {
      this.addToMemory('assistant', response.content)
    }

    return response
  }

  /**
   * Execute a tool call via activity
   */
  protected async executeTool(
    toolCall: { id: string; name: string; arguments: Record<string, any> }
  ): Promise<any> {
    // Call the activity (WASM or other)
    const result = await this.callActivity(toolCall.name, toolCall.arguments)
    
    // Add tool result to memory
    this.memory.working.push({
      role: 'tool',
      content: JSON.stringify(result),
      name: toolCall.name,
      tool_call_id: toolCall.id,
    })
    
    return result
  }

  /**
   * Send message to another agent (durable!)
   */
  protected async sendToAgent(
    targetAgentId: string,
    message: any
  ): Promise<void> {
    await this.context.messageQueue.enqueue(`actor:${targetAgentId}`, {
      messageId: `agent-msg-${Date.now()}`,
      actorId: targetAgentId,
      messageType: 'event',
      correlationId: this.context.correlationId,
      payload: {
        eventType: 'agent_message',
        data: {
          from: this.context.actorId,
          message,
        },
      },
      metadata: {
        timestamp: new Date().toISOString(),
        priority: 0,
      },
    })
  }

  /**
   * ReAct pattern: Reasoning + Acting in a loop
   */
  protected async react(
    objective: string,
    tools: Tool[],
    maxIterations: number = 5
  ): Promise<string> {
    const systemPrompt = `You are a helpful AI agent. Use the available tools to accomplish the objective.
Think step by step. Format your response as:
Thought: [your reasoning]
Action: [tool to use]
Action Input: [tool arguments]

When you have the final answer, respond with:
Thought: [your reasoning]
Final Answer: [the answer]`

    this.addToMemory('system', systemPrompt)
    this.addToMemory('user', objective)

    for (let i = 0; i < maxIterations; i++) {
      const response = await this.callLLM(undefined, tools)

      // Check for tool calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        for (const toolCall of response.tool_calls) {
          await this.executeTool(toolCall)
        }
        // LLM will see tool results in memory on next iteration
      } else if (response.content.includes('Final Answer:')) {
        // Extract final answer
        const match = response.content.match(/Final Answer: (.+)/)
        return match ? match[1] : response.content
      }
    }

    return 'Max iterations reached without final answer'
  }
}
