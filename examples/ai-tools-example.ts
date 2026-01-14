/**
 * Example: AI Actors with Tool Calling
 * 
 * Demonstrates AI agents that can use tools to:
 * - Query APIs
 * - Perform calculations
 * - Access databases
 * - Execute code
 */

import { AIActor } from '../src/actor/ai-actor'
import type { ActorContext } from '../src/actor/journal'
import type { Tool } from '../src/ai/tools/types'
import * as dotenv from 'dotenv'

dotenv.config()

/**
 * Example Tools
 */

// Tool: Get current weather
const getWeatherTool: Tool = {
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or coordinates',
      },
      unit: {
        type: 'string',
        description: 'Temperature unit (celsius or fahrenheit)',
        enum: ['celsius', 'fahrenheit'],
      },
    },
    required: ['location'],
  },
  execute: async (params: { location: string; unit?: string }) => {
    // Simulate API call
    console.log(`   🌤️  Fetching weather for ${params.location}...`)
    await new Promise(resolve => setTimeout(resolve, 500))
    
    return {
      location: params.location,
      temperature: 72,
      unit: params.unit || 'fahrenheit',
      condition: 'Sunny',
      humidity: 45,
    }
  },
}

// Tool: Calculate mortgage payment
const calculateMortgageTool: Tool = {
  name: 'calculate_mortgage',
  description: 'Calculate monthly mortgage payment',
  parameters: {
    type: 'object',
    properties: {
      principal: {
        type: 'number',
        description: 'Loan amount in dollars',
      },
      rate: {
        type: 'number',
        description: 'Annual interest rate (e.g., 6.5 for 6.5%)',
      },
      years: {
        type: 'number',
        description: 'Loan term in years',
      },
    },
    required: ['principal', 'rate', 'years'],
  },
  execute: async (params: { principal: number; rate: number; years: number }) => {
    const monthlyRate = params.rate / 100 / 12
    const numPayments = params.years * 12
    
    const payment =
      (params.principal * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
      (Math.pow(1 + monthlyRate, numPayments) - 1)
    
    return {
      monthlyPayment: Math.round(payment * 100) / 100,
      totalPaid: Math.round(payment * numPayments * 100) / 100,
      totalInterest: Math.round((payment * numPayments - params.principal) * 100) / 100,
    }
  },
}

// Tool: Search database
const searchDatabaseTool: Tool = {
  name: 'search_database',
  description: 'Search customer database',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      limit: {
        type: 'number',
        description: 'Max results to return',
      },
    },
    required: ['query'],
  },
  execute: async (params: { query: string; limit?: number }) => {
    console.log(`   🔍 Searching database: "${params.query}"`)
    await new Promise(resolve => setTimeout(resolve, 300))
    
    // Mock results
    return {
      results: [
        { id: 1, name: 'Alice Johnson', email: 'alice@example.com', plan: 'Pro' },
        { id: 2, name: 'Bob Smith', email: 'bob@example.com', plan: 'Enterprise' },
      ].slice(0, params.limit || 10),
      total: 2,
    }
  },
}

// Tool: Send email
const sendEmailTool: Tool = {
  name: 'send_email',
  description: 'Send an email',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address',
      },
      subject: {
        type: 'string',
        description: 'Email subject',
      },
      body: {
        type: 'string',
        description: 'Email body',
      },
    },
    required: ['to', 'subject', 'body'],
  },
  execute: async (params: { to: string; subject: string; body: string }) => {
    console.log(`   📧 Sending email to ${params.to}`)
    console.log(`      Subject: ${params.subject}`)
    await new Promise(resolve => setTimeout(resolve, 500))
    
    return {
      sent: true,
      messageId: `msg-${Date.now()}`,
      timestamp: new Date().toISOString(),
    }
  },
}

/**
 * Weather Assistant Actor
 * Uses tools to get weather and suggest activities
 */
class WeatherAssistantActor extends AIActor {
  constructor(context: ActorContext) {
    super(context)
    
    this.initializeLLM({
      provider: 'azure-openai',
      apiKey: process.env.AZURE_OPENAI_API_KEY!,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
      model: process.env.AZURE_OPENAI_DEPLOYMENT!, // Use deployment name for Azure
      temperature: 0.7,
    })
    
    // Register weather tool
    this.registerTool(getWeatherTool)
  }
  
  async execute(location: string): Promise<void> {
    console.log(`\n🤖 Weather Assistant for: ${location}`)
    
    const response = await this.chatWithTools([
      {
        role: 'system',
        content: 'You are a helpful weather assistant. Get the weather and suggest activities based on conditions.',
      },
      {
        role: 'user',
        content: `What's the weather in ${location} and what should I do today?`,
      },
    ])
    
    console.log(`\n💬 Assistant:`, response)
    
    this.updateState(draft => {
      draft.location = location
      draft.response = response
      draft.timestamp = new Date().toISOString()
    })
  }
}

/**
 * Loan Officer Actor
 * Uses tools to calculate mortgages and send quotes
 */
class LoanOfficerActor extends AIActor {
  constructor(context: ActorContext) {
    super(context)
    
    this.initializeLLM({
      provider: 'azure-openai',
      apiKey: process.env.AZURE_OPENAI_API_KEY!,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
      model: process.env.AZURE_OPENAI_DEPLOYMENT!, // Use deployment name for Azure
      temperature: 0.3,
    })
    
    this.registerTools([calculateMortgageTool, sendEmailTool])
  }
  
  async execute(request: { principal: number; rate: number; years: number; email: string }): Promise<void> {
    console.log(`\n🏦 Processing loan request for $${request.principal.toLocaleString()}`)
    
    const response = await this.chatWithTools([
      {
        role: 'system',
        content: `You are a helpful loan officer. Calculate the mortgage payment and send a quote email.`,
      },
      {
        role: 'user',
        content: `Calculate mortgage for $${request.principal} at ${request.rate}% for ${request.years} years and send quote to ${request.email}`,
      },
    ])
    
    console.log(`\n💬 Officer:`, response)
    
    this.updateState(draft => {
      draft.request = request
      draft.response = response
      draft.timestamp = new Date().toISOString()
    })
  }
}

/**
 * Customer Support Actor
 * Uses multiple tools to help customers
 */
class CustomerSupportActor extends AIActor {
  constructor(context: ActorContext) {
    super(context)
    
    this.initializeLLM({
      provider: 'azure-openai',
      apiKey: process.env.AZURE_OPENAI_API_KEY!,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
      model: process.env.AZURE_OPENAI_DEPLOYMENT!, // Use deployment name for Azure
      temperature: 0.7,
    })
    
    this.registerTools([searchDatabaseTool, sendEmailTool])
  }
  
  async execute(query: string): Promise<void> {
    console.log(`\n👤 Customer Query: ${query}`)
    
    const response = await this.chatWithTools([
      {
        role: 'system',
        content: 'You are a customer support agent. Search the database and help customers. Send emails when needed.',
      },
      {
        role: 'user',
        content: query,
      },
    ])
    
    console.log(`\n💬 Support:`, response)
    
    this.updateState(draft => {
      draft.query = query
      draft.response = response
      draft.timestamp = new Date().toISOString()
    })
  }
}

/**
 * Run examples
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║       AI Actors with Tool Calling - Examples             ║')
  console.log('╚═══════════════════════════════════════════════════════════╝')
  
  // Example 1: Weather Assistant
  console.log('\n━━━ Example 1: Weather Assistant ━━━')
  const weatherActor = new WeatherAssistantActor({
    actorId: 'weather-1',
    correlationId: 'demo-1',
  } as ActorContext)
  
  await weatherActor.execute('San Francisco')
  
  // Example 2: Loan Officer
  console.log('\n\n━━━ Example 2: Loan Officer ━━━')
  const loanActor = new LoanOfficerActor({
    actorId: 'loan-1',
    correlationId: 'demo-2',
  } as ActorContext)
  
  await loanActor.execute({
    principal: 500000,
    rate: 6.5,
    years: 30,
    email: 'customer@example.com',
  })
  
  // Example 3: Customer Support (Anthropic Claude)
  console.log('\n\n━━━ Example 3: Customer Support ━━━')
  const supportActor = new CustomerSupportActor({
    actorId: 'support-1',
    correlationId: 'demo-3',
  } as ActorContext)
  
  await supportActor.execute('Find Alice Johnson and send her a welcome email')
  
  console.log('\n\n✨ All examples complete!')
}

main().catch(console.error)
