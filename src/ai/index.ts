/**
 * Unified LLM API - Provider-agnostic AI integration
 * 
 * Minimal, direct, no frameworks - just clean LLM calls
 */

// Core types and interfaces
export type { 
  ILLMProvider,
  LLMConfig, 
  LLMMessage, 
  LLMResponse 
} from './llm-provider'

// Unified LLM client
export { UnifiedLLM } from './unified-llm'

// Individual providers (for advanced usage)
export { OpenAIProvider } from './providers/openai'
export { AnthropicProvider } from './providers/anthropic'
export { AzureOpenAIProvider } from './providers/azure-openai'
export { GeminiProvider } from './providers/gemini'

// Tool system
export { ToolRegistry, ToolExecutor } from './tools'
export type { 
  Tool, 
  ToolCall, 
  ToolResult, 
  ToolParameterSchema,
  LLMToolResponse 
} from './tools/types'

// Actor orchestration
export { ActorToolRegistry } from './tools/actor-registry'
export { type ActorExecutor, actorToTool, actorsToTools, buildActorToolDescription } from './tools/actor-adapter'
