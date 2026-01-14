/**
 * Example: Customer Support AI Agent
 * Demonstrates AIActor with LLM integration
 */

import { AIActor } from '../src/actor/ai-actor'
import type { ActorContext } from '../src/actor/journal'

interface CustomerQuery {
  customerId: string
  message: string
  context?: string
}

export class CustomerSupportActor extends AIActor {
  constructor(context: ActorContext) {
    super(context, {
      supportedTopics: ['billing', 'technical', 'account'],
      conversationHistory: [],
    })

    // Initialize with OpenAI
    this.initializeLLM({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 500,
    })
  }

  async execute(query: CustomerQuery): Promise<void> {
    // Get conversation history from state
    const history = (this.state.conversationHistory as any[]) || []

    // Build messages for LLM
    const messages = [
      {
        role: 'system' as const,
        content: `You are a helpful customer support agent. Be concise and friendly.
        
Context: ${query.context || 'No additional context'}
Customer ID: ${query.customerId}

Previous conversation:
${history.map((h: any) => `${h.role}: ${h.message}`).join('\n')}`,
      },
      {
        role: 'user' as const,
        content: query.message,
      },
    ]

    // Get AI response
    const response = await this.chat(messages)

    // Update conversation history
    history.push(
      { role: 'user', message: query.message, timestamp: new Date().toISOString() },
      { role: 'assistant', message: response, timestamp: new Date().toISOString() }
    )

    this.updateState(draft => {
      draft.conversationHistory = history.slice(-10) // Keep last 10 messages
      draft.lastResponse = response
      draft.customerId = query.customerId
    })
  }
}

/**
 * Example: Loan Underwriter with AI
 * Demonstrates AIActor for financial decisions
 */

interface LoanApplication {
  applicantId: string
  amount: number
  income: number
  creditScore?: number
  purpose: string
}

export class LoanUnderwriterActor extends AIActor {
  constructor(context: ActorContext) {
    super(context, {
      decisions: [],
      totalProcessed: 0,
    })

    // Initialize with Anthropic Claude
    this.initializeLLM({
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.3, // Lower temperature for consistent decisions
      maxTokens: 1000,
    })
  }

  async execute(application: LoanApplication): Promise<void> {
    // Calculate debt-to-income ratio
    const monthlyPayment = this.calculateMonthlyPayment(application.amount, 0.06, 30)
    const dti = (monthlyPayment * 12) / application.income

    // Use AI to analyze the application
    const messages = [
      {
        role: 'system' as const,
        content: `You are a loan underwriting assistant. Analyze applications and provide a recommendation.
        
Guidelines:
- DTI < 0.36: Generally acceptable
- DTI 0.36-0.43: Requires strong credit
- DTI > 0.43: Generally decline
- Credit score > 700: Good
- Credit score 650-700: Fair
- Credit score < 650: Poor

Provide your analysis and recommendation (APPROVE or DECLINE) with reasoning.`,
      },
      {
        role: 'user' as const,
        content: `Loan Application:
- Amount: $${application.amount}
- Annual Income: $${application.income}
- Credit Score: ${application.creditScore || 'Not provided'}
- Purpose: ${application.purpose}
- Calculated DTI: ${(dti * 100).toFixed(2)}%
- Calculated Monthly Payment: $${monthlyPayment.toFixed(2)}

Provide your underwriting decision.`,
      },
    ]

    const analysis = await this.chat(messages)

    // Parse decision from analysis
    const decision = analysis.toLowerCase().includes('approve') ? 'APPROVED' : 'DECLINED'

    // Update state
    this.updateState(draft => {
      const decisions = (draft.decisions as any[]) || []
      decisions.push({
        applicantId: application.applicantId,
        decision,
        analysis,
        dti,
        timestamp: new Date().toISOString(),
      })
      draft.decisions = decisions
      draft.totalProcessed = (draft.totalProcessed as number || 0) + 1
      draft.lastDecision = decision
    })
  }

  private calculateMonthlyPayment(principal: number, annualRate: number, years: number): number {
    const monthlyRate = annualRate / 12
    const numPayments = years * 12
    return (principal * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
           (Math.pow(1 + monthlyRate, numPayments) - 1)
  }
}

/**
 * Example: Streaming Chat Actor
 * Demonstrates streaming LLM responses
 */

export class StreamingChatActor extends AIActor {
  private onChunk?: (chunk: string) => void

  constructor(context: ActorContext, onChunk?: (chunk: string) => void) {
    super(context)
    this.onChunk = onChunk

    this.initializeLLM({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'gpt-4o-mini',
      temperature: 0.8,
    })
  }

  async execute(userMessage: string): Promise<void> {
    const messages = [
      { role: 'system' as const, content: 'You are a helpful assistant.' },
      { role: 'user' as const, content: userMessage },
    ]

    // Stream the response
    const response = await this.streamChat(
      messages,
      (chunk) => {
        // Call callback if provided (for real-time UI updates)
        this.onChunk?.(chunk)
      }
    )

    this.updateState(draft => {
      draft.lastMessage = userMessage
      draft.lastResponse = response
      draft.responseLength = response.length
    })
      responseLength: response.length,
    })
  }
}
