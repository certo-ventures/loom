/**
 * Anthropic Provider (Claude)
 * Simple wrapper around Anthropic API with tool calling support
 * ~200 lines with tool integration
 */

import type { ILLMProvider, LLMConfig, LLMMessage, LLMResponse } from '../llm-provider'
import type { LLMToolResponse, ToolCall } from '../tools/types'

export class AnthropicProvider implements ILLMProvider {
  private config: LLMConfig
  private baseUrl: string = 'https://api.anthropic.com/v1'

  constructor(config: LLMConfig) {
    this.config = config
  }

  async chat(
    messages: LLMMessage[],
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options }
    
    // Anthropic requires system message separate
    const systemMessage = messages.find(m => m.role === 'system')
    const conversationMessages = messages.filter(m => m.role !== 'system')
    
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': mergedConfig.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: mergedConfig.model,
        messages: conversationMessages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        system: systemMessage?.content,
        max_tokens: mergedConfig.maxTokens ?? 4096,
        temperature: mergedConfig.temperature ?? 0.7,
        top_p: mergedConfig.topP,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as any

    return {
      content: data.content[0].text,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      model: data.model,
      finishReason: data.stop_reason,
    }
  }

  async stream(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void,
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options }
    
    const systemMessage = messages.find(m => m.role === 'system')
    const conversationMessages = messages.filter(m => m.role !== 'system')
    
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': mergedConfig.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: mergedConfig.model,
        messages: conversationMessages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        system: systemMessage?.content,
        max_tokens: mergedConfig.maxTokens ?? 4096,
        temperature: mergedConfig.temperature ?? 0.7,
        top_p: mergedConfig.topP,
        stream: true,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic API error: ${response.status} - ${error}`)
    }

    let fullContent = ''
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      throw new Error('Response body is not readable')
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n').filter(line => line.trim().startsWith('data: '))

        for (const line of lines) {
          const data = line.replace('data: ', '').trim()

          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              const text = parsed.delta.text
              fullContent += text
              onChunk(text)
            }
          } catch (e) {
            // Skip invalid JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return {
      content: fullContent,
      usage: {
        promptTokens: 0, // Streaming doesn't provide usage
        completionTokens: 0,
        totalTokens: 0,
      },
      model: mergedConfig.model,
      finishReason: 'end_turn',
    }
  }
  
  /**
   * Chat with tool calling support
   */
  async chatWithTools(
    messages: LLMMessage[],
    tools: any[], // Anthropic format tools
    options?: Partial<LLMConfig>
  ): Promise<LLMToolResponse> {
    const mergedConfig = { ...this.config, ...options }
    
    const systemMessage = messages.find(m => m.role === 'system')
    const conversationMessages = messages.filter(m => m.role !== 'system')
    
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': mergedConfig.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: mergedConfig.model,
        messages: conversationMessages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        system: systemMessage?.content,
        tools,
        max_tokens: mergedConfig.maxTokens ?? 4096,
        temperature: mergedConfig.temperature ?? 0.7,
        top_p: mergedConfig.topP,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as any
    
    // Parse tool calls if present
    const toolCalls: ToolCall[] | undefined = data.content
      .filter((block: any) => block.type === 'tool_use')
      .map((block: any) => ({
        id: block.id,
        name: block.name,
        arguments: block.input,
      }))
    
    // Get text content
    const textContent = data.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n')

    return {
      content: textContent,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: data.stop_reason,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    }
  }
}
