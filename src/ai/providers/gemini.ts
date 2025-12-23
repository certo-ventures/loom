/**
 * Google Gemini Provider
 * Simple wrapper around Gemini API
 * ~50 lines of actual logic
 */

import type { ILLMProvider, LLMConfig, LLMMessage, LLMResponse } from '../llm-provider'

export class GeminiProvider implements ILLMProvider {
  private config: LLMConfig
  private baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta'

  constructor(config: LLMConfig) {
    this.config = config
  }

  async chat(
    messages: LLMMessage[],
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options }
    
    // Gemini format: separate system instruction from conversation
    const systemMessage = messages.find(m => m.role === 'system')
    const conversationMessages = messages.filter(m => m.role !== 'system')
    
    const url = `${this.baseUrl}/models/${mergedConfig.model}:generateContent?key=${mergedConfig.apiKey}`
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: conversationMessages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        systemInstruction: systemMessage ? {
          parts: [{ text: systemMessage.content }],
        } : undefined,
        generationConfig: {
          temperature: mergedConfig.temperature ?? 0.7,
          maxOutputTokens: mergedConfig.maxTokens,
          topP: mergedConfig.topP,
        },
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Gemini API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as any

    return {
      content: data.candidates[0].content.parts[0].text,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
      model: mergedConfig.model,
      finishReason: data.candidates[0].finishReason,
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
    
    const url = `${this.baseUrl}/models/${mergedConfig.model}:streamGenerateContent?key=${mergedConfig.apiKey}`
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: conversationMessages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        systemInstruction: systemMessage ? {
          parts: [{ text: systemMessage.content }],
        } : undefined,
        generationConfig: {
          temperature: mergedConfig.temperature ?? 0.7,
          maxOutputTokens: mergedConfig.maxTokens,
          topP: mergedConfig.topP,
        },
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Gemini API error: ${response.status} - ${error}`)
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
        
        // Gemini streams JSON objects separated by newlines
        const lines = chunk.split('\n').filter(line => line.trim())

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line)
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text
            if (text) {
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
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      model: mergedConfig.model,
      finishReason: 'STOP',
    }
  }
}
