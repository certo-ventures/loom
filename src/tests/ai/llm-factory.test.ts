/**
 * Tests for LLM Factory - Configuration-driven provider initialization
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createLLMProvider, loadLLMConfigFromEnv, LLMConfigurationError } from '../../ai/llm-factory'
import type { LLMEnvironmentConfig } from '../../ai/llm-factory'

describe('LLM Factory', () => {
  describe('createLLMProvider', () => {
    it('should create OpenAI provider with valid config', () => {
      const config: LLMEnvironmentConfig = {
        provider: 'openai',
        openai: {
          apiKey: 'test-key',
          model: 'gpt-4',
          temperature: 0.7,
        }
      }

      const provider = createLLMProvider(config)
      expect(provider).toBeDefined()
    })

    it('should create Azure OpenAI provider with valid config', () => {
      const config: LLMEnvironmentConfig = {
        provider: 'azure-openai',
        azureOpenAI: {
          apiKey: 'test-key',
          endpoint: 'https://test.openai.azure.com',
          model: 'gpt-4',
        }
      }

      const provider = createLLMProvider(config)
      expect(provider).toBeDefined()
    })

    it('should create Anthropic provider with valid config', () => {
      const config: LLMEnvironmentConfig = {
        provider: 'anthropic',
        anthropic: {
          apiKey: 'test-key',
          model: 'claude-3-5-sonnet-20241022',
        }
      }

      const provider = createLLMProvider(config)
      expect(provider).toBeDefined()
    })

    it('should create Gemini provider with valid config', () => {
      const config: LLMEnvironmentConfig = {
        provider: 'gemini',
        gemini: {
          apiKey: 'test-key',
          model: 'gemini-pro',
        }
      }

      const provider = createLLMProvider(config)
      expect(provider).toBeDefined()
    })

    it('should throw error for OpenAI without config', () => {
      const config: LLMEnvironmentConfig = {
        provider: 'openai',
      }

      expect(() => createLLMProvider(config)).toThrow(LLMConfigurationError)
      expect(() => createLLMProvider(config)).toThrow('openai configuration missing')
    })

    it('should throw error for OpenAI without API key', () => {
      const config: LLMEnvironmentConfig = {
        provider: 'openai',
        openai: {
          apiKey: '',
          model: 'gpt-4',
        }
      }

      expect(() => createLLMProvider(config)).toThrow(LLMConfigurationError)
      expect(() => createLLMProvider(config)).toThrow('API key is required')
    })

    it('should throw error for OpenAI without model', () => {
      const config: LLMEnvironmentConfig = {
        provider: 'openai',
        openai: {
          apiKey: 'test-key',
          model: '',
        }
      }

      expect(() => createLLMProvider(config)).toThrow(LLMConfigurationError)
      expect(() => createLLMProvider(config)).toThrow('model is required')
    })

    it('should throw error for Azure OpenAI without endpoint', () => {
      const config: LLMEnvironmentConfig = {
        provider: 'azure-openai',
        azureOpenAI: {
          apiKey: 'test-key',
          endpoint: '',
          model: 'gpt-4',
        }
      }

      expect(() => createLLMProvider(config)).toThrow(LLMConfigurationError)
      expect(() => createLLMProvider(config)).toThrow('endpoint is required')
    })

    it('should throw error for unknown provider', () => {
      const config: any = {
        provider: 'unknown-provider',
      }

      expect(() => createLLMProvider(config)).toThrow(LLMConfigurationError)
      expect(() => createLLMProvider(config)).toThrow('Unknown provider')
    })
  })

  describe('loadLLMConfigFromEnv', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should load OpenAI config from environment', () => {
      process.env.LLM_PROVIDER = 'openai'
      process.env.OPENAI_API_KEY = 'test-key'
      process.env.OPENAI_MODEL = 'gpt-4'
      process.env.OPENAI_TEMPERATURE = '0.8'
      process.env.OPENAI_MAX_TOKENS = '2000'

      const config = loadLLMConfigFromEnv()

      expect(config.provider).toBe('openai')
      expect(config.openai).toEqual({
        apiKey: 'test-key',
        model: 'gpt-4',
        temperature: 0.8,
        maxTokens: 2000,
      })
    })

    it('should load Azure OpenAI config from environment', () => {
      process.env.LLM_PROVIDER = 'azure-openai'
      process.env.AZURE_OPENAI_API_KEY = 'test-key'
      process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com'
      process.env.AZURE_OPENAI_MODEL = 'gpt-4'

      const config = loadLLMConfigFromEnv()

      expect(config.provider).toBe('azure-openai')
      expect(config.azureOpenAI).toEqual({
        apiKey: 'test-key',
        endpoint: 'https://test.openai.azure.com',
        model: 'gpt-4',
        temperature: undefined,
        maxTokens: undefined,
      })
    })

    it('should default to openai provider', () => {
      delete process.env.LLM_PROVIDER
      process.env.OPENAI_API_KEY = 'test-key'

      const config = loadLLMConfigFromEnv()

      expect(config.provider).toBe('openai')
    })

    it('should default OpenAI model to gpt-4', () => {
      process.env.OPENAI_API_KEY = 'test-key'
      delete process.env.OPENAI_MODEL

      const config = loadLLMConfigFromEnv()

      expect(config.openai?.model).toBe('gpt-4')
    })

    it('should handle missing API keys gracefully', () => {
      delete process.env.OPENAI_API_KEY
      delete process.env.AZURE_OPENAI_API_KEY

      const config = loadLLMConfigFromEnv()

      expect(config.openai).toBeUndefined()
      expect(config.azureOpenAI).toBeUndefined()
    })
  })
})
