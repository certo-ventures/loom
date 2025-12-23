# Unified LLM API

Provider-agnostic LLM integration for Loom actors.

## Philosophy

**Minimal, Direct, No Frameworks**

- ~300 lines total (all 4 providers)
- Direct fetch API (no LangChain, no ai-sdk)
- Switch providers with config change
- Streaming built-in

## Quick Start

### Basic Usage

```typescript
import { UnifiedLLM } from '@loom/ai'

const llm = new UnifiedLLM({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 1000
})

// Chat
const response = await llm.chat([
  { role: 'system', content: 'You are a helpful assistant' },
  { role: 'user', content: 'What is the capital of France?' }
])

console.log(response.content) // "Paris"
console.log(response.usage)   // { promptTokens: 20, completionTokens: 5, totalTokens: 25 }
```

### Streaming

```typescript
await llm.stream(
  [
    { role: 'user', content: 'Write a haiku about coding' }
  ],
  (chunk) => {
    process.stdout.write(chunk) // Real-time output
  }
)
```

### With AIActor

```typescript
import { AIActor } from '@loom/actor'

class MyChatbot extends AIActor {
  constructor(context: ActorContext) {
    super(context)
    
    this.initializeLLM({
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022'
    })
  }
  
  async execute(userMessage: string) {
    const response = await this.chat([
      { role: 'user', content: userMessage }
    ])
    
    this.updateState({ lastResponse: response })
  }
}
```

## Supported Providers

### OpenAI

```typescript
{
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini' // or 'gpt-4o', 'gpt-4-turbo', etc.
}
```

### Anthropic (Claude)

```typescript
{
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022' // or 'claude-3-opus', etc.
}
```

### Azure OpenAI

```typescript
{
  provider: 'azure-openai',
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: 'https://your-resource.openai.azure.com',
  model: 'your-deployment-name' // Deployment name in Azure
}
```

### Google Gemini

```typescript
{
  provider: 'gemini',
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-pro' // or 'gemini-pro-vision'
}
```

## API Reference

### Types

```typescript
interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'azure-openai' | 'gemini'
  apiKey: string
  model: string
  endpoint?: string      // For Azure OpenAI
  temperature?: number   // 0-2, default 0.7
  maxTokens?: number     // Max response length
  topP?: number          // Nucleus sampling
}

interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface LLMResponse {
  content: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  model: string
  finishReason?: string
}
```

### UnifiedLLM Class

```typescript
class UnifiedLLM {
  constructor(config: LLMConfig)
  
  // Non-streaming chat
  async chat(
    messages: LLMMessage[],
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse>
  
  // Streaming chat
  async stream(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void,
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse>
  
  // Get/update config
  getConfig(): LLMConfig
  updateConfig(updates: Partial<LLMConfig>): void
}
```

### AIActor Class

```typescript
abstract class AIActor extends Actor {
  // Initialize LLM
  protected initializeLLM(config: LLMConfig): void
  
  // Simple chat (returns just content)
  protected async chat(
    messages: LLMMessage[],
    options?: Partial<LLMConfig>
  ): Promise<string>
  
  // Chat with full metadata
  protected async chatWithMetadata(
    messages: LLMMessage[],
    options?: Partial<LLMConfig>
  ): Promise<LLMResponse>
  
  // Streaming chat
  protected async streamChat(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void,
    options?: Partial<LLMConfig>
  ): Promise<string>
  
  // Config management
  protected getLLMConfig(): LLMConfig | undefined
  protected updateLLMConfig(updates: Partial<LLMConfig>): void
}
```

## Examples

See `examples/ai-actors-example.ts` for:
- Customer support chatbot
- Loan underwriting with AI
- Streaming chat actor

## Performance

| Provider | Typical Latency | Streaming Latency |
|----------|----------------|-------------------|
| OpenAI | 500-2000ms | First chunk: ~200ms |
| Anthropic | 500-2000ms | First chunk: ~300ms |
| Azure OpenAI | 500-2000ms | First chunk: ~200ms |
| Gemini | 500-2000ms | First chunk: ~250ms |

## Cost Estimation

Approximate costs per 1M tokens:

| Provider | Input | Output |
|----------|-------|--------|
| GPT-4o-mini | $0.15 | $0.60 |
| GPT-4o | $2.50 | $10.00 |
| Claude 3.5 Sonnet | $3.00 | $15.00 |
| Gemini Pro | $0.50 | $1.50 |

## Error Handling

```typescript
try {
  const response = await llm.chat(messages)
} catch (error) {
  // All providers throw descriptive errors
  console.error(error.message)
  // "OpenAI API error: 429 - Rate limit exceeded"
}
```

## Journaling

All LLM calls are automatically journaled when using `AIActor`:

```typescript
// Automatically recorded in actor state
{
  _lastLLMCall: {
    timestamp: "2025-12-18T10:30:00Z",
    messages: [...],
    response: "...",
    usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
    model: "gpt-4o-mini",
    duration: 1250
  }
}
```

## Adding New Providers

1. Implement `ILLMProvider` interface
2. Add to `createProvider()` factory
3. Export from `llm-provider.ts`

```typescript
export class MyProvider implements ILLMProvider {
  async chat(messages, options) { /* ... */ }
  async stream(messages, onChunk, options) { /* ... */ }
}
```

## Testing

Set environment variables:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_ENDPOINT=https://...
export GEMINI_API_KEY=...
```

Run examples:

```bash
npm run example examples/ai-actors-example.ts
```

## Philosophy: Why No LangChain?

We chose **direct fetch API** over frameworks because:

✅ **Minimal** - ~50 lines per provider  
✅ **Fast** - No abstraction overhead  
✅ **Debuggable** - See exactly what's happening  
✅ **Maintainable** - No framework lock-in  
✅ **Flexible** - Easy to customize  

For complex use cases (agents, tools, RAG), build on top of this simple foundation.

## License

MIT
