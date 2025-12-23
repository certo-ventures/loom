// @ts-nocheck - Outdated API usage, needs refactor
/**
 * Real LLM Service - Integrates with OpenAI, Azure OpenAI, and Anthropic
 * 
 * NOTE: This service is OUT OF DATE and uses old API patterns.
 * Should be updated to use UnifiedLLM from src/ai.
 * 
 * @deprecated - Needs update to current UnifiedLLM API
 */

// @ts-ignore - Using old API, needs refactor
import { UnifiedLLM, type LLMConfig, type LLMMessage } from '../../../src/ai';
import Anthropic from '@anthropic-ai/sdk';

export interface LLMServiceConfig {
  provider: 'openai' | 'azure-openai' | 'anthropic';
  apiKey: string;
  endpoint?: string;
  model: string;
  deploymentName?: string;
  temperature?: number;
  maxTokens?: number;
}

// @ts-nocheck - Entire file uses outdated API, needs refactor
export class LLMService {
  private openAIClient?: any;
  private anthropicClient?: Anthropic;
  private config: LLMServiceConfig;

  constructor(config: LLMServiceConfig) {
    this.config = config;

    if (config.provider === 'openai' || config.provider === 'azure-openai') {
      // Use existing Loom LLMClient for OpenAI
      const llmConfig: LLMConfig = {
        provider: config.provider,
        apiKey: config.apiKey,
        endpoint: config.endpoint,
        model: config.model,
        deploymentName: config.deploymentName,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens ?? 2000,
      };
      this.openAIClient = new LLMClient(llmConfig);
    } else if (config.provider === 'anthropic') {
      // Use Anthropic SDK
      this.anthropicClient = new Anthropic({
        apiKey: config.apiKey,
      });
    }
  }

  /**
   * Call LLM with a simple prompt and get text response
   */
  async prompt(systemPrompt: string, userPrompt: string): Promise<string> {
    if (this.openAIClient) {
      const messages: ConversationMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const response = await this.openAIClient.chat(messages);
      return response.content;
    } else if (this.anthropicClient) {
      const response = await this.anthropicClient.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? 2000,
        temperature: this.config.temperature ?? 0.7,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      });

      const contentBlock = response.content[0];
      if (contentBlock.type === 'text') {
        return contentBlock.text;
      }
      throw new Error('Unexpected Anthropic response format');
    }

    throw new Error(`Provider ${this.config.provider} not configured`);
  }

  /**
   * Call LLM with conversation history
   */
  async chat(messages: ConversationMessage[]): Promise<string> {
    if (this.openAIClient) {
      const response = await this.openAIClient.chat(messages);
      return response.content;
    } else if (this.anthropicClient) {
      // Convert messages for Anthropic
      const systemMessage = messages.find(m => m.role === 'system');
      const conversationMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const response = await this.anthropicClient.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? 2000,
        temperature: this.config.temperature ?? 0.7,
        system: systemMessage?.content,
        messages: conversationMessages,
      });

      const contentBlock = response.content[0];
      if (contentBlock.type === 'text') {
        return contentBlock.text;
      }
      throw new Error('Unexpected Anthropic response format');
    }

    throw new Error(`Provider ${this.config.provider} not configured`);
  }

  /**
   * Get token usage estimation
   */
  estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}

/**
 * Create LLM service from environment variables or config
 */
export function createLLMService(modelName: string): LLMService {
  // Map model names to providers
  const modelConfig: { [key: string]: Partial<LLMServiceConfig> } = {
    'gpt-4': {
      provider: 'azure-openai',
      model: process.env.AZURE_OPENAI_MODEL || 'gpt-4o',
      deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_OPENAI_GPT4_DEPLOYMENT,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY || '',
    },
    'gpt-4o': {
      provider: 'azure-openai',
      model: process.env.AZURE_OPENAI_MODEL || 'gpt-4o',
      deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY || '',
    },
    'gpt-4-turbo': {
      provider: 'azure-openai',
      model: 'gpt-4-turbo',
      deploymentName: process.env.AZURE_OPENAI_GPT4_TURBO_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY || '',
    },
    'gpt-3.5': {
      provider: 'azure-openai',
      model: 'gpt-3.5-turbo',
      deploymentName: process.env.AZURE_OPENAI_GPT35_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY || '',
    },
    'claude-3': {
      provider: 'anthropic',
      model: 'claude-3-sonnet-20240229',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    },
    'claude-3-opus': {
      provider: 'anthropic',
      model: 'claude-3-opus-20240229',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    },
  };

  const config = modelConfig[modelName];
  if (!config) {
    throw new Error(`Model ${modelName} not configured. Available models: ${Object.keys(modelConfig).join(', ')}`);
  }

  if (!config.apiKey || config.apiKey === '') {
    throw new Error(`API key not found for ${modelName}. Set environment variable: ${
      config.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'AZURE_OPENAI_API_KEY'
    }`);
  }

  return new LLMService(config as LLMServiceConfig);
}
