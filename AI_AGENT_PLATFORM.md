# AI Agent Platform - The BRAIN! 🧠

**~280 lines of PURE POWER!**

## What We Built

A complete AI agent framework that makes LLM-powered actors TRIVIAL!

### Features

1. **Multi-LLM Support** (~100 lines)
   - Unified `LLMClient` interface
   - OpenAI, Azure OpenAI ready
   - Easy to add: Gemini, Anthropic, Llama, custom endpoints
   - Automatic cost tracking (token-based pricing)

2. **Prompt Management** (~50 lines)
   - `PromptManager` for template registration
   - Variable interpolation: `{{variable}}`
   - Load from URLs, files, databases
   - Version tracking

3. **Conversation Memory** (~40 lines)
   - Working memory (current conversation)
   - Long-term memory (semantic storage)
   - Automatic persistence to actor state
   - Never lose context!

4. **Tool Calling** (~30 lines)
   - Seamless integration with WASM activities
   - Tool results added to conversation
   - Durable execution (suspend/resume on tool calls)
   - Error handling via retry system

5. **Agent-to-Agent Communication** (~20 lines)
   - Send durable messages between agents
   - Correlation ID propagation
   - Event-based collaboration
   - Built on existing message queue

6. **ReAct Pattern** (~40 lines)
   - Reasoning + Acting loop
   - Think → Act → Observe → Repeat
   - Automatic tool orchestration
   - Max iterations safeguard

## Architecture

```
AIAgent (base class)
  ├─ Extends Actor (gets all durability features)
  ├─ LLMClient (provider abstraction)
  ├─ PromptManager (template engine)
  ├─ Memory (working + long-term)
  └─ Tool Integration (via callActivity)
```

## Usage Example

```typescript
class CustomerSupportAgent extends AIAgent {
  constructor(context: ActorContext, state?: any) {
    super(context, state)
    
    // Configure LLM
    this.configureLLM({
      provider: 'azure-openai',
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_KEY,
      deploymentName: 'gpt-4',
      model: 'gpt-4',
      temperature: 0.7,
    })
    
    // Set system prompt
    if (!state?.memory) {
      this.addToMemory('system', 'You are a helpful support agent...')
    }
  }
  
  async execute(input: { message: string }): Promise<any> {
    // Call LLM with tools
    const response = await this.callLLM(input.message, this.getTools())
    
    // Execute any tool calls
    if (response.tool_calls) {
      for (const toolCall of response.tool_calls) {
        await this.executeTool(toolCall) // Calls WASM activity!
      }
      
      // Get final response
      const finalResponse = await this.callLLM()
      return { response: finalResponse.content }
    }
    
    return { response: response.content }
  }
  
  protected getTools(): Tool[] {
    return [
      {
        name: 'check_order_status',
        description: 'Check order status',
        parameters: {
          type: 'object',
          properties: {
            order_id: { type: 'string' },
          },
          required: ['order_id'],
        },
      },
    ]
  }
}
```

## Testing

**13 comprehensive tests** that actually verify behavior:

1. ✅ Prompt template rendering with variables
2. ✅ LLM API calls with correct parameters
3. ✅ Tool call parsing and execution
4. ✅ Cost calculation based on tokens
5. ✅ Conversation memory accumulation
6. ✅ Full history sent to LLM on each call
7. ✅ Tool execution adds results to memory
8. ✅ Memory persistence in actor state
9. ✅ Agent-to-agent messaging with correlation IDs
10. ✅ ReAct loop with multi-step reasoning
11. ✅ Tool orchestration in reasoning loop
12. ✅ Max iterations prevents infinite loops
13. ✅ Final answer extraction

**ALL TESTS PASS!**

## What Makes This Special

1. **Durable by Default** - Inherit from `AIAgent`, get durable execution for free
2. **Tool = Activity** - Every tool call is a WASM activity with full retries, observability
3. **Conversation = State** - Memory automatically persisted, survive crashes
4. **Agent-to-Agent** - Durable messaging between AI agents via actor model
5. **MINIMAL Code** - ~280 lines for COMPLETE AI agent platform!

## Key Files

- `src/ai/index.ts` - Core platform (~280 lines)
- `examples/ai-agents.ts` - Customer support & research agents (~120 lines)
- `src/tests/ai/ai-agent.test.ts` - Real tests (~270 lines)

## Total Impact

**280 lines** unlocks:
- Multi-LLM conversations
- Tool calling with durable execution
- Agent collaboration
- Planning and reasoning
- Automatic cost tracking
- Memory management
- Template-based prompts

**This is the JOY of minimal code with maximum power!** 🚀
