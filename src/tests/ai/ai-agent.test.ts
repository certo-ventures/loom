import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LLMClient, PromptManager, AIAgent } from '../../ai'
import type { LLMConfig, Tool } from '../../ai'
import type { ActorContext } from '../../actor'

// Mock OpenAI with controllable responses
const mockCreate = vi.fn()
vi.mock('openai', () => {
  return {
    OpenAI: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      }
    },
  }
})

describe('AI Agent Platform', () => {
  describe('PromptManager', () => {
    let promptManager: PromptManager

    beforeEach(() => {
      promptManager = new PromptManager()
    })

    it('should register and render templates', () => {
      promptManager.register({
        name: 'greeting',
        template: 'Hello {{name}}, welcome to {{company}}!',
        variables: ['name', 'company'],
      })

      const rendered = promptManager.render('greeting', {
        name: 'Alice',
        company: 'Loom AI',
      })

      expect(rendered).toBe('Hello Alice, welcome to Loom AI!')
    })

    it('should handle multiple variable replacements', () => {
      promptManager.register({
        name: 'report',
        template: '{{metric}} is {{value}} (target: {{target}})',
        variables: ['metric', 'value', 'target'],
      })

      const rendered = promptManager.render('report', {
        metric: 'Revenue',
        value: '$100K',
        target: '$90K',
      })

      expect(rendered).toBe('Revenue is $100K (target: $90K)')
    })

    it('should throw on missing template', () => {
      expect(() => {
        promptManager.render('nonexistent', {})
      }).toThrow('Template nonexistent not found')
    })
  })

  describe('LLMClient', () => {
    beforeEach(() => {
      mockCreate.mockClear()
    })

    it('should pass messages correctly to OpenAI API', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Test response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      const config: LLMConfig = {
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4',
      }

      const client = new LLMClient(config)
      await client.chat([
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'What is 2+2?' },
      ])

      // Verify OpenAI was called with correct parameters
      expect(mockCreate).toHaveBeenCalledTimes(1)
      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.model).toBe('gpt-4')
      expect(callArgs.messages).toHaveLength(2)
      expect(callArgs.messages[0].content).toBe('You are a helpful assistant')
      expect(callArgs.messages[1].content).toBe('What is 2+2?')
    })

    it('should handle tool calls correctly', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'call_123',
              function: {
                name: 'calculator',
                arguments: JSON.stringify({ operation: 'add', a: 2, b: 2 }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      })

      const config: LLMConfig = {
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4',
      }

      const client = new LLMClient(config)
      const tools: Tool[] = [{
        name: 'calculator',
        description: 'Perform math',
        parameters: {
          type: 'object',
          properties: {
            operation: { type: 'string' },
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['operation', 'a', 'b'],
        },
      }]

      const response = await client.chat([
        { role: 'user', content: 'What is 2+2?' },
      ], tools)

      // Verify tools were passed to API
      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.tools).toBeDefined()
      expect(callArgs.tools[0].function.name).toBe('calculator')

      // Verify tool calls were parsed correctly
      expect(response.tool_calls).toHaveLength(1)
      expect(response.tool_calls![0].name).toBe('calculator')
      expect(response.tool_calls![0].arguments).toEqual({
        operation: 'add',
        a: 2,
        b: 2,
      })
    })

    it('should calculate cost correctly', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 2000, total_tokens: 3000 },
      })

      const config: LLMConfig = {
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4',
      }

      const client = new LLMClient(config)
      const response = await client.chat([
        { role: 'user', content: 'Test' },
      ])

      // 1000 prompt tokens * $0.03/1k = $0.03
      // 2000 completion tokens * $0.06/1k = $0.12
      // Total = $0.15
      expect(response.cost).toBeCloseTo(0.15, 2)
      expect(response.usage.total_tokens).toBe(3000)
    })
  })

  describe('AIAgent', () => {
    class TestAgent extends AIAgent {
      constructor(context: ActorContext, state?: any) {
        super(context, state)
        // Initialize LLM in subclass
        this.configureLLM({
          provider: 'openai',
          apiKey: 'test-key',
          model: 'gpt-4',
        })
      }

      async execute(input: { message: string }): Promise<any> {
        const response = await this.callLLM(input.message)
        return { reply: response.content }
      }
      
      // Override callActivity to not suspend in tests
      async callActivity(name: string, input: any): Promise<any> {
        // Call the mock if it exists
        if (this.context.callActivity) {
          return this.context.callActivity(name, input)
        }
        return {}
      }
    }

    beforeEach(() => {
      mockCreate.mockClear()
    })

    it('should build conversation memory across multiple turns', async () => {
      const context: ActorContext = {
        actorId: 'test-agent',
        actorType: 'TestAgent',
        correlationId: 'test',
      } as any

      const agent = new TestAgent(context)
      
      // Manually add messages
      agent['addToMemory']('system', 'You are helpful')
      agent['addToMemory']('user', 'Hello!')
      agent['addToMemory']('assistant', 'Hi there!')
      agent['addToMemory']('user', 'How are you?')

      const history = agent['getConversationHistory']()
      expect(history).toHaveLength(4)
      expect(history[0].role).toBe('system')
      expect(history[1].content).toBe('Hello!')
      expect(history[2].content).toBe('Hi there!')
      expect(history[3].content).toBe('How are you?')
    })

    it('should send full conversation history to LLM', async () => {
      let callCount = 0
      mockCreate.mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return {
            choices: [{ message: { content: 'Hi there!' } }],
            usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
          }
        } else {
          return {
            choices: [{ message: { content: 'I am doing well!' } }],
            usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
          }
        }
      })

      const context: ActorContext = {
        actorId: 'test-agent',
        actorType: 'TestAgent',
        correlationId: 'test',
      } as any

      const agent = new TestAgent(context)
      
      // First call
      await agent['callLLM']('Hello!')
      
      // Second call
      await agent['callLLM']('How are you?')

      // Verify second call includes history
      const secondCall = mockCreate.mock.calls[1][0]
      const messages = secondCall.messages
      
      // Should have accumulated messages
      expect(messages.length).toBeGreaterThanOrEqual(3)
      
      // Verify the conversation flow is preserved
      const conversationContent = messages.map((m: any) => m.content).join(' | ')
      expect(conversationContent).toContain('Hello!')
      expect(conversationContent).toContain('Hi there!')
      expect(conversationContent).toContain('How are you?')
    })

    it('should execute tools and add results to conversation', async () => {
      const context: ActorContext = {
        actorId: 'test-agent',
        actorType: 'TestAgent',
        correlationId: 'test',
        callActivity: vi.fn().mockResolvedValue({ result: 4 }),
      } as any

      const agent = new TestAgent(context)

      // Execute a tool
      const toolCall = {
        id: 'call_123',
        name: 'calculator',
        arguments: { operation: 'add', a: 2, b: 2 },
      }

      const result = await agent['executeTool'](toolCall)

      // Verify activity was called
      expect(context.callActivity).toHaveBeenCalledWith('calculator', {
        operation: 'add',
        a: 2,
        b: 2,
      })

      // Verify result was added to memory as tool message
      const history = agent['getConversationHistory']()
      const toolMessage = history.find(m => m.role === 'tool')
      expect(toolMessage).toBeDefined()
      expect(toolMessage!.name).toBe('calculator')
      expect(toolMessage!.tool_call_id).toBe('call_123')
      expect(JSON.parse(toolMessage!.content)).toEqual({ result: 4 })
    })

    it('should persist memory in actor state', async () => {
      const updateStateMock = vi.fn()
      const context: ActorContext = {
        actorId: 'test-agent',
        actorType: 'TestAgent',
        correlationId: 'test',
      } as any

      const agent = new TestAgent(context)
      agent.updateState = updateStateMock

      // Add message (should trigger state update)
      agent['addToMemory']('user', 'Test message')

      // Verify state was updated with memory
      expect(updateStateMock).toHaveBeenCalled()
      const stateUpdate = updateStateMock.mock.calls[0][0]
      expect(stateUpdate.memory).toBeDefined()
      expect(stateUpdate.memory.working).toHaveLength(1)
      expect(stateUpdate.memory.working[0].content).toBe('Test message')
    })
  })

  describe('Agent-to-Agent Communication', () => {
    it('should send durable messages to other agents', async () => {
      const enqueueMock = vi.fn()
      const context: ActorContext = {
        actorId: 'agent-1',
        actorType: 'TestAgent',
        correlationId: 'test-123',
        messageQueue: {
          enqueue: enqueueMock,
        },
      } as any

      class TestAgent extends AIAgent {
        constructor(context: ActorContext) {
          super(context)
          this.configureLLM({
            provider: 'openai',
            apiKey: 'test',
            model: 'gpt-4',
          })
        }
        
        async execute(): Promise<any> {
          return {}
        }
      }

      const agent = new TestAgent(context)

      // Send message to another agent
      await agent['sendToAgent']('agent-2', {
        task: 'analyze_data',
        data: { values: [1, 2, 3] },
      })

      // Verify message was enqueued
      expect(enqueueMock).toHaveBeenCalledTimes(1)
      const [queueName, message] = enqueueMock.mock.calls[0]
      
      expect(queueName).toBe('actor:agent-2')
      expect(message.actorId).toBe('agent-2')
      expect(message.messageType).toBe('event')
      expect(message.correlationId).toBe('test-123') // Inherited!
      expect(message.payload.eventType).toBe('agent_message')
      expect(message.payload.data.from).toBe('agent-1')
      expect(message.payload.data.message.task).toBe('analyze_data')
    })
  })

  describe('ReAct Pattern', () => {
    beforeEach(() => {
      mockCreate.mockClear()
    })

    class TestReActAgent extends AIAgent {
      constructor(context: ActorContext) {
        super(context)
        this.configureLLM({
          provider: 'openai',
          apiKey: 'test',
          model: 'gpt-4',
        })
      }
      
      async execute(): Promise<any> {
        return {}
      }
      
      // Override callActivity to not suspend
      async callActivity(name: string, input: any): Promise<any> {
        if (this.context.callActivity) {
          return this.context.callActivity(name, input)
        }
        return {}
      }
    }

    it('should execute reasoning loop until final answer', async () => {
      const context: ActorContext = {
        actorId: 'research-agent',
        actorType: 'ResearchAgent',
        correlationId: 'research-1',
        callActivity: vi.fn()
          .mockResolvedValueOnce({ results: ['fact1', 'fact2'] })
          .mockResolvedValueOnce({ summary: 'analyzed' }),
      } as any

      const agent = new TestReActAgent(context)

      // Mock LLM responses in sequence
      let llmCallCount = 0
      mockCreate.mockImplementation(async () => {
        llmCallCount++
        
        if (llmCallCount === 1) {
          // First: tool call to search
          return {
            choices: [{
              message: {
                content: '',
                tool_calls: [{
                  id: 'call_1',
                  function: {
                    name: 'search',
                    arguments: JSON.stringify({ query: 'test' }),
                  },
                }],
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }
        } else if (llmCallCount === 2) {
          // Second: tool call to analyze
          return {
            choices: [{
              message: {
                content: '',
                tool_calls: [{
                  id: 'call_2',
                  function: {
                    name: 'analyze',
                    arguments: JSON.stringify({ data: 'test' }),
                  },
                }],
              },
            }],
            usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
          }
        } else {
          // Third: final answer
          return {
            choices: [{
              message: {
                content: 'Thought: I have enough info\nFinal Answer: The result is 42',
              },
            }],
            usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          }
        }
      })

      const tools: Tool[] = [
        {
          name: 'search',
          description: 'Search',
          parameters: { type: 'object', properties: {} },
        },
        {
          name: 'analyze',
          description: 'Analyze',
          parameters: { type: 'object', properties: {} },
        },
      ]

      const result = await agent['react']('Find information about X', tools)

      // Should have executed 2 tools
      expect(context.callActivity).toHaveBeenCalledTimes(2)
      
      // Should return final answer
      expect(result).toBe('The result is 42')
    })

    it('should stop at max iterations to prevent infinite loops', async () => {
      const context: ActorContext = {
        actorId: 'agent',
        actorType: 'TestAgent',
        correlationId: 'test',
        callActivity: vi.fn().mockResolvedValue({}),
      } as any

      const agent = new TestReActAgent(context)

      // Always return tool calls, never final answer
      mockCreate.mockImplementation(async () => ({
        choices: [{
          message: {
            content: 'Thought: Keep going',
            tool_calls: [{
              id: 'call_x',
              function: {
                name: 'dummy',
                arguments: '{}',
              },
            }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }))

      const result = await agent['react']('Task', [
        {
          name: 'dummy',
          description: 'Dummy',
          parameters: { type: 'object', properties: {} },
        },
      ], 3)

      // Should stop after 3 iterations
      expect(result).toContain('Max iterations reached')
    })
  })
})
