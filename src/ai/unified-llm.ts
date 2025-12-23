/**
 * Unified LLM API - Provider-agnostic LLM interface
 * Switch providers with a config change!
 */

import { ILLMProvider, LLMConfig, LLMMessage, LLMResponse } from './llm-provider'
import { OpenAIProvider } from './providers/openai'
import { AnthropicProvider } from './providers/anthropic'
import { AzureOpenAIProvider } from './providers/azure-openai'
import { GeminiProvider } from './providers/gemini'

/**
 * Factory to create provider instances
 */
function createProvider(config: LLMConfig): ILLMProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config)
    case 'anthropic':
      return new AnthropicProvider(config)
    case 'azure-openai':
      return new AzureOpenAIProvider(config)
    case 'gemini':
      return new GeminiProvider(config)
    default:
      throw new Error(`Unknown provider: ${config.provider}`)
  }
}

/**
 * Unified LLM Client - Works with any provider
 */
export class UnifiedLLM {
  private provider: ILLMProvider
  private config: LLMConfig

  constructor(config: LLMConfig) {
    this.config = config
    this.provider = createProvider(config)
  }

  /**
   * Chat with the LLM (non-streaming)
   */
  async chat(
    messages: LLMMessage[],
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse> {
    return this.provider.chat(messages, options)
  }

  /**
   * Chat with streaming response
   */
  async stream(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void,
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse> {
    return this.provider.stream(messages, onChunk, options)
  }

  /**
   * Get current configuration
   */
  getConfig(): LLMConfig {
    return { ...this.config }
  }

  /**
   * Update configuration (creates new provider instance)
   */
  updateConfig(updates: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...updates }
    this.provider = createProvider(this.config)
  }
}
