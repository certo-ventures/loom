/**
 * OpenAI Provider
 * Simple wrapper around OpenAI API with tool calling support
 * ~200 lines with tool integration
 */

import type { ILLMProvider, LLMConfig, LLMMessage, LLMResponse } from '../llm-provider'
import type { LLMToolResponse, ToolCall } from '../tools/types'

export class OpenAIProvider implements ILLMProvider {
  private config: LLMConfig
  private baseUrl: string = 'https://api.openai.com/v1'

  constructor(config: LLMConfig) {
    this.config = config
  }

  async chat(
    messages: LLMMessage[],
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options }
    
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mergedConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: mergedConfig.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: mergedConfig.temperature ?? 0.7,
        max_tokens: mergedConfig.maxTokens,
        top_p: mergedConfig.topP,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as any

    return {
      content: data.choices[0].message.content,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      model: data.model,
      finishReason: data.choices[0].finish_reason,
    }
  }

  async stream(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void,
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options }
    
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mergedConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: mergedConfig.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: mergedConfig.temperature ?? 0.7,
        max_tokens: mergedConfig.maxTokens,
        top_p: mergedConfig.topP,
        stream: true,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${error}`)
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
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const content = parsed.choices[0]?.delta?.content
            if (content) {
              fullContent += content
              onChunk(content)
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
      finishReason: 'stop',
    }
  }
  
  /**
   * Chat with tool calling support
   */
  async chatWithTools(
    messages: LLMMessage[],
    tools: any[], // OpenAI format tools
    options?: Partial<LLMConfig>
  ): Promise<LLMToolResponse> {
    const mergedConfig = { ...this.config, ...options }
    
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mergedConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: mergedConfig.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        tools,
        tool_choice: 'auto',
        temperature: mergedConfig.temperature ?? 0.7,
        max_tokens: mergedConfig.maxTokens,
        top_p: mergedConfig.topP,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as any
    const choice = data.choices[0]
    
    // Parse tool calls if present
    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }))

    return {
      content: choice.message.content || '',
      toolCalls,
      finishReason: choice.finish_reason,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    }
  }
}
