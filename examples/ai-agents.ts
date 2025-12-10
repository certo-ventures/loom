/**
 * Example: Customer Support AI Agent
 * 
 * Shows off:
 * - Multi-turn conversations
 * - Tool calling (check order status, process refund)
 * - Durable state (conversation never lost!)
 * - Agent-to-agent communication
 */

import { AIAgent, type Tool, type LLMConfig } from '../src/ai'
import type { ActorContext } from '../src/actor'

/**
 * Customer Support Agent
 */
class CustomerSupportAgent extends AIAgent {
  constructor(context: ActorContext, state?: any) {
    super(context, state)

    // Configure for Azure OpenAI
    this.configureLLM({
      provider: 'azure-openai',
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_KEY,
      deploymentName: 'gpt-4',
      model: 'gpt-4',
      temperature: 0.7,
    })

    // Set system prompt
    this.promptManager.register({
      name: 'system',
      template: `You are a helpful customer support agent for an e-commerce company.
You can:
- Check order status
- Process refunds
- Answer questions about products
- Escalate complex issues to human agents

Be friendly, professional, and concise.`,
      variables: [],
    })

    // Initialize with system prompt
    if (!state?.memory) {
      this.addToMemory('system', this.promptManager.render('system', {}))
    }
  }

  /**
   * Define available tools
   */
  protected getTools(): Tool[] {
    return [
      {
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
      },
      {
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
      },
      {
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
      },
    ]
  }

  /**
   * Main execution - handle customer message
   */
  async execute(input: { message: string }): Promise<any> {
    // Get LLM response with tools
    const response = await this.callLLM(input.message, this.getTools())

    // Handle tool calls
    if (response.tool_calls) {
      const results = []
      
      for (const toolCall of response.tool_calls) {
        // Execute the tool via WASM activity
        const result = await this.executeTool(toolCall)
        results.push(result)

        // Special case: escalation
        if (toolCall.name === 'escalate_to_human') {
          // Send to human agent queue
          await this.sendToAgent('human-agent-pool', {
            customerId: this.context.actorId,
            conversation: this.getConversationHistory(),
            reason: toolCall.arguments.reason,
          })
        }
      }

      // Get final response after tool execution
      const finalResponse = await this.callLLM()
      
      return {
        response: finalResponse.content,
        tool_results: results,
        cost: response.cost + (finalResponse.cost || 0),
        tokens: response.usage.total_tokens + finalResponse.usage.total_tokens,
      }
    }

    return {
      response: response.content,
      cost: response.cost,
      tokens: response.usage.total_tokens,
    }
  }
}

/**
 * Research Agent - with ReAct pattern!
 */
class ResearchAgent extends AIAgent {
  constructor(context: ActorContext, state?: any) {
    super(context, state)

    this.configureLLM({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4',
      temperature: 0.3, // Lower for more focused research
    })
  }

  protected getTools(): Tool[] {
    return [
      {
        name: 'search_web',
        description: 'Search the web for information',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
      },
      {
        name: 'analyze_document',
        description: 'Analyze a document or webpage',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to analyze' },
          },
          required: ['url'],
        },
      },
      {
        name: 'save_finding',
        description: 'Save an important finding to long-term memory',
        parameters: {
          type: 'object',
          properties: {
            finding: { type: 'string', description: 'The finding to save' },
            importance: {
              type: 'number',
              description: 'Importance score 1-10',
            },
          },
          required: ['finding'],
        },
      },
    ]
  }

  async execute(input: { task: string }): Promise<any> {
    // Use ReAct pattern for multi-step reasoning
    const result = await this.react(input.task, this.getTools(), 10)

    return {
      answer: result,
      findings: this.memory.longTerm,
      conversation: this.getConversationHistory(),
    }
  }
}

export { CustomerSupportAgent, ResearchAgent }
