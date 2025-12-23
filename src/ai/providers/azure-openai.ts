/**
 * Azure OpenAI Provider
 * Uses Azure endpoint instead of OpenAI direct
 * ~200 lines with tool calling support
 */

import type { ILLMProvider, LLMConfig, LLMMessage, LLMResponse } from '../llm-provider'
import type { LLMToolResponse, ToolCall } from '../tools/types'

export class AzureOpenAIProvider implements ILLMProvider {
  private config: LLMConfig

  constructor(config: LLMConfig) {
    this.config = config
    if (!config.endpoint) {
      throw new Error('Azure OpenAI requires endpoint configuration')
    }
  }

  async chat(
    messages: LLMMessage[],
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options }
    
    // Azure OpenAI URL format: https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=2024-02-15-preview
    const url = `${mergedConfig.endpoint}/openai/deployments/${mergedConfig.model}/chat/completions?api-version=2024-02-15-preview`
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': mergedConfig.apiKey,
      },
      body: JSON.stringify({
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
      throw new Error(`Azure OpenAI API error: ${response.status} - ${error}`)
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
    
    const url = `${mergedConfig.endpoint}/openai/deployments/${mergedConfig.model}/chat/completions?api-version=2024-02-15-preview`
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': mergedConfig.apiKey,
      },
      body: JSON.stringify({
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
      throw new Error(`Azure OpenAI API error: ${response.status} - ${error}`)
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
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      model: mergedConfig.model,
      finishReason: 'stop',
    }
  }
  
  /**
   * Chat with tool calling support
   * Uses same format as OpenAI since Azure OpenAI is compatible
   */
  async chatWithTools(
    messages: LLMMessage[],
    tools: any[], // OpenAI format tools
    options?: Partial<LLMConfig>
  ): Promise<LLMToolResponse> {
    const mergedConfig = { ...this.config, ...options }
    
    // For tool calling, need newer API version that supports tools
    const url = `${mergedConfig.endpoint}/openai/deployments/${mergedConfig.model}/chat/completions?api-version=2024-08-01-preview`
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': mergedConfig.apiKey,
      },
      body: JSON.stringify({
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
      throw new Error(`Azure OpenAI API error: ${response.status} - ${error}`)
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
