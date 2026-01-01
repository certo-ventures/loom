/**
 * LLM Factory - Configuration-driven provider initialization
 * 
 * Principle: Plain objects, explicit wiring, no magic
 * Validates at startup, fails fast on misconfiguration
 */

import type { ILLMProvider, LLMConfig, LLMProvider as LLMProviderType } from './llm-provider'
import { OpenAIProvider } from './providers/openai'
import { AnthropicProvider } from './providers/anthropic'
import { AzureOpenAIProvider } from './providers/azure-openai'
import { GeminiProvider } from './providers/gemini'

/**
 * Environment-based configuration
 */
export interface LLMEnvironmentConfig {
  /** Primary provider to use */
  provider: LLMProviderType
  
  /** OpenAI configuration */
  openai?: {
    apiKey: string
    model: string
    temperature?: number
    maxTokens?: number
  }
  
  /** Azure OpenAI configuration */
  azureOpenAI?: {
    apiKey: string
    endpoint: string
    model: string
    temperature?: number
    maxTokens?: number
  }
  
  /** Anthropic configuration */
  anthropic?: {
    apiKey: string
    model: string
    temperature?: number
    maxTokens?: number
  }
  
  /** Gemini configuration */
  gemini?: {
    apiKey: string
    model: string
    temperature?: number
    maxTokens?: number
  }
}

/**
 * Validation errors
 */
export class LLMConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LLMConfigurationError'
  }
}

/**
 * Validate configuration before creating provider
 */
function validateConfig(config: LLMEnvironmentConfig): void {
  const { provider } = config
  
  switch (provider) {
    case 'openai':
      if (!config.openai) {
        throw new LLMConfigurationError('OpenAI provider selected but openai configuration missing')
      }
      if (!config.openai.apiKey) {
        throw new LLMConfigurationError('OpenAI API key is required')
      }
      if (!config.openai.model) {
        throw new LLMConfigurationError('OpenAI model is required')
      }
      break
      
    case 'azure-openai':
      if (!config.azureOpenAI) {
        throw new LLMConfigurationError('Azure OpenAI provider selected but azureOpenAI configuration missing')
      }
      if (!config.azureOpenAI.apiKey) {
        throw new LLMConfigurationError('Azure OpenAI API key is required')
      }
      if (!config.azureOpenAI.endpoint) {
        throw new LLMConfigurationError('Azure OpenAI endpoint is required')
      }
      if (!config.azureOpenAI.model) {
        throw new LLMConfigurationError('Azure OpenAI model/deployment is required')
      }
      break
      
    case 'anthropic':
      if (!config.anthropic) {
        throw new LLMConfigurationError('Anthropic provider selected but anthropic configuration missing')
      }
      if (!config.anthropic.apiKey) {
        throw new LLMConfigurationError('Anthropic API key is required')
      }
      if (!config.anthropic.model) {
        throw new LLMConfigurationError('Anthropic model is required')
      }
      break
      
    case 'gemini':
      if (!config.gemini) {
        throw new LLMConfigurationError('Gemini provider selected but gemini configuration missing')
      }
      if (!config.gemini.apiKey) {
        throw new LLMConfigurationError('Gemini API key is required')
      }
      if (!config.gemini.model) {
        throw new LLMConfigurationError('Gemini model is required')
      }
      break
      
    default:
      throw new LLMConfigurationError(`Unknown provider: ${provider}`)
  }
}

/**
 * Create LLM provider from environment configuration
 * Throws LLMConfigurationError if configuration is invalid
 */
export function createLLMProvider(config: LLMEnvironmentConfig): ILLMProvider {
  // Validate first
  validateConfig(config)
  
  const { provider } = config
  
  switch (provider) {
    case 'openai': {
      const providerConfig: LLMConfig = {
        provider: 'openai',
        apiKey: config.openai!.apiKey,
        model: config.openai!.model,
        temperature: config.openai!.temperature,
        maxTokens: config.openai!.maxTokens,
      }
      return new OpenAIProvider(providerConfig)
    }
    
    case 'azure-openai': {
      const providerConfig: LLMConfig = {
        provider: 'azure-openai',
        apiKey: config.azureOpenAI!.apiKey,
        endpoint: config.azureOpenAI!.endpoint,
        model: config.azureOpenAI!.model,
        temperature: config.azureOpenAI!.temperature,
        maxTokens: config.azureOpenAI!.maxTokens,
      }
      return new AzureOpenAIProvider(providerConfig)
    }
    
    case 'anthropic': {
      const providerConfig: LLMConfig = {
        provider: 'anthropic',
        apiKey: config.anthropic!.apiKey,
        model: config.anthropic!.model,
        temperature: config.anthropic!.temperature,
        maxTokens: config.anthropic!.maxTokens,
      }
      return new AnthropicProvider(providerConfig)
    }
    
    case 'gemini': {
      const providerConfig: LLMConfig = {
        provider: 'gemini',
        apiKey: config.gemini!.apiKey,
        model: config.gemini!.model,
        temperature: config.gemini!.temperature,
        maxTokens: config.gemini!.maxTokens,
      }
      return new GeminiProvider(providerConfig)
    }
    
    default:
      throw new LLMConfigurationError(`Unknown provider: ${provider}`)
  }
}

/**
 * Load configuration from environment variables
 */
export function loadLLMConfigFromEnv(): LLMEnvironmentConfig {
  const provider = (process.env.LLM_PROVIDER || 'openai') as LLMProviderType
  
  return {
    provider,
    openai: process.env.OPENAI_API_KEY ? {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4',
      temperature: process.env.OPENAI_TEMPERATURE ? parseFloat(process.env.OPENAI_TEMPERATURE) : undefined,
      maxTokens: process.env.OPENAI_MAX_TOKENS ? parseInt(process.env.OPENAI_MAX_TOKENS) : undefined,
    } : undefined,
    azureOpenAI: process.env.AZURE_OPENAI_API_KEY ? {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
      model: process.env.AZURE_OPENAI_MODEL || 'gpt-4',
      temperature: process.env.AZURE_OPENAI_TEMPERATURE ? parseFloat(process.env.AZURE_OPENAI_TEMPERATURE) : undefined,
      maxTokens: process.env.AZURE_OPENAI_MAX_TOKENS ? parseInt(process.env.AZURE_OPENAI_MAX_TOKENS) : undefined,
    } : undefined,
    anthropic: process.env.ANTHROPIC_API_KEY ? {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
      temperature: process.env.ANTHROPIC_TEMPERATURE ? parseFloat(process.env.ANTHROPIC_TEMPERATURE) : undefined,
      maxTokens: process.env.ANTHROPIC_MAX_TOKENS ? parseInt(process.env.ANTHROPIC_MAX_TOKENS) : undefined,
    } : undefined,
    gemini: process.env.GEMINI_API_KEY ? {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-pro',
      temperature: process.env.GEMINI_TEMPERATURE ? parseFloat(process.env.GEMINI_TEMPERATURE) : undefined,
      maxTokens: process.env.GEMINI_MAX_TOKENS ? parseInt(process.env.GEMINI_MAX_TOKENS) : undefined,
    } : undefined,
  }
}

/**
 * Create LLM provider from environment variables
 * Validates at startup, fails fast on misconfiguration
 */
export function createLLMProviderFromEnv(): ILLMProvider {
  const config = loadLLMConfigFromEnv()
  return createLLMProvider(config)
}
