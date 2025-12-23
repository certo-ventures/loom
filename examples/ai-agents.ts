/**
 * Example: Customer Support AI Agent
 * 
 * Shows how to use AIActor with:
 * - Tool calling (check order status, process refund)
 * - Conversation state management
 * - LLM integration
 */

import { AIActor } from '../src/actor/ai-actor'
import type { Tool } from '../src/ai/tools/types'
import type { LLMMessage } from '../src/ai/llm-provider'
import type { ActorContext } from '../src/actor/journal'

/**
 * Customer Support Agent with tool calling
 */
class CustomerSupportAgent extends AIActor {
  constructor(context: ActorContext, state?: any) {
    super(context, state)

    // Initialize LLM
    this.initializeLLM({
      provider: 'azure-openai',
      endpoint: process.env.AZURE_OPENAI_ENDPOINT || 'https://your-endpoint.openai.azure.com',
      apiKey: process.env.AZURE_OPENAI_KEY || 'your-key',
      model: 'gpt-4',
      temperature: 0.7,
    })

    // Register available tools
    this.registerTools([
      this.createCheckOrderTool(),
      this.createRefundTool(),
      this.createEscalateTool(),
    ])
  }

  private createCheckOrderTool(): Tool {
    return {
      name: 'check_order_status',
      description: 'Check the status of a customer order',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'string',
            description: 'The order ID to check',
          },
        },
        required: ['order_id'],
      },
      execute: async (params: { order_id: string }) => {
        // Simulate order lookup
        console.log(`🔍 Checking order: ${params.order_id}`)
        return {
          order_id: params.order_id,
          status: 'shipped',
          tracking: 'TRACK123',
          eta: '2025-12-25',
        }
      },
    }
  }

  private createRefundTool(): Tool {
    return {
      name: 'process_refund',
      description: 'Process a refund for an order',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'string',
            description: 'The order ID to refund',
          },
          reason: {
            type: 'string',
            description: 'Reason for the refund',
          },
        },
        required: ['order_id', 'reason'],
      },
      execute: async (params: { order_id: string; reason: string }) => {
        // Simulate refund processing
        console.log(`💰 Processing refund for order: ${params.order_id}`)
        return {
          success: true,
          refund_id: `REF-${Date.now()}`,
          amount: 99.99,
          order_id: params.order_id,
          reason: params.reason,
        }
      },
    }
  }

  private createEscalateTool(): Tool {
    return {
      name: 'escalate_to_human',
      description: 'Escalate the conversation to a human agent',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Why escalation is needed',
          },
        },
        required: ['reason'],
      },
      execute: async (params: { reason: string }) => {
        console.log(`🆘 Escalating to human: ${params.reason}`)
        return {
          escalated: true,
          ticket_id: `TICKET-${Date.now()}`,
          reason: params.reason,
        }
      },
    }
  }

  /**
   * Handle customer message
   */
  async execute(input: { message: string }): Promise<any> {
    // Get conversation history from state
    const messages: LLMMessage[] = (this.state.messages as LLMMessage[]) || []
    
    // Add system prompt if first message
    if (messages.length === 0) {
      messages.push({
        role: 'system',
        content: `You are a helpful customer support agent for an e-commerce company.
You can check order status, process refunds, and escalate to human agents.
Be friendly, professional, and concise.`,
      })
    }
    
    // Add user message
    messages.push({
      role: 'user',
      content: input.message,
    })

    // Chat with tools available (returns final response string)
    const responseContent = await this.chatWithTools(messages)
    
    // Add assistant response to history
    messages.push({
      role: 'assistant',
      content: responseContent,
    })
    
    // Update conversation state
    this.updateState({ messages })

    return {
      response: responseContent,
    }
  }
}

// Example usage
async function demo() {
  const context: ActorContext = {
    actorId: 'customer-support-001',
    actorType: 'CustomerSupport',
    correlationId: 'demo-123',
  }

  const agent = new CustomerSupportAgent(context)

  // Customer asks about their order
  const response1 = await agent.execute({
    message: 'Hi, can you check the status of my order #12345?',
  })
  console.log('Agent:', response1.response)

  // Customer requests a refund
  const response2 = await agent.execute({
    message: 'The product was damaged. Can you process a refund?',
  })
  console.log('Agent:', response2.response)
}

// Run demo if this file is executed directly
if (require.main === module) {
  demo().catch(console.error)
}

export { CustomerSupportAgent }
