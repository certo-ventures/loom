/**
 * Unified LLM API - Provider-agnostic AI integration
 * 
 * Philosophy: Minimal abstraction over LLM providers
 * - Support OpenAI, Anthropic, Azure OpenAI, Gemini
 * - Simple interface: chat() and stream()
 * - No heavy frameworks (no LangChain, no ai-sdk dependencies)
 * - ~300 lines total for all providers
 */

/**
 * LLM provider types
 */
export type LLMProvider = 'openai' | 'anthropic' | 'azure-openai' | 'gemini'

/**
 * Configuration for LLM provider
 */
export interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  model: string
  endpoint?: string // For Azure OpenAI
  temperature?: number
  maxTokens?: number
  topP?: number
}

/**
 * Standard message format (OpenAI-compatible)
 */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Token usage information
 */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/**
 * LLM response
 */
export interface LLMResponse {
  content: string
  usage: TokenUsage
  model: string
  finishReason?: string
}

/**
 * Provider interface - all providers implement this
 */
export interface ILLMProvider {
  chat(
    messages: LLMMessage[],
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse>
  
  stream(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void,
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse>
}
