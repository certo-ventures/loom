/**
 * Actor Orchestration Example
 * 
 * Demonstrates LLM dynamically orchestrating actors from the registry.
 * The LLM sees available actors as tools and can call them to complete tasks.
 */

import { AIActor } from '../src/actor/ai-actor'
import type { ActorContext } from '../src/actor/journal'
import type { ActorExecutor } from '../src/ai/tools/actor-registry'
import { WasmActorExecutor } from '../src/actor/wasm-actor-executor'
import { InMemoryDataStore } from '../packages/loom-server/src/registry/in-memory-store'
import type { ActorMetadata } from '../packages/loom-server/src/types'
import * as dotenv from 'dotenv'

dotenv.config()

/**
 * Mock executor - In production this would execute actual actors
 */
class MockActorExecutor implements ActorExecutor {
  async execute(actorId: string, version: string | undefined, input: any): Promise<any> {
    console.log(`\n🔧 [Executor] Running actor: ${actorId}@${version || 'latest'}`)
    console.log(`   Input:`, JSON.stringify(input, null, 2))
    
    // Simulate different actors
    switch (actorId) {
      case 'customer-lookup':
        await new Promise(resolve => setTimeout(resolve, 300))
        return {
          customer: {
            id: 'cust-123',
            name: input.name || 'Alice Johnson',
            email: 'alice@example.com',
            plan: 'Pro',
            joinDate: '2024-01-15',
          },
        }
      
      case 'loan-calculator':
        await new Promise(resolve => setTimeout(resolve, 500))
        const monthlyRate = input.annualRate / 100 / 12
        const numPayments = input.years * 12
        const payment =
          (input.principal * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
          (Math.pow(1 + monthlyRate, numPayments) - 1)
        
        return {
          monthlyPayment: Math.round(payment * 100) / 100,
          totalPaid: Math.round(payment * numPayments * 100) / 100,
          totalInterest: Math.round((payment * numPayments - input.principal) * 100) / 100,
        }
      
      case 'email-sender':
        await new Promise(resolve => setTimeout(resolve, 400))
        return {
          sent: true,
          messageId: `msg-${Date.now()}`,
          to: input.to,
          timestamp: new Date().toISOString(),
        }
      
      case 'credit-check':
        await new Promise(resolve => setTimeout(resolve, 600))
        return {
          customerId: input.customerId,
          creditScore: 720 + Math.floor(Math.random() * 80),
          approved: true,
          limit: 500000,
        }
      
      default:
        throw new Error(`Unknown actor: ${actorId}`)
    }
  }
}

/**
 * Orchestrator Actor - Uses LLM to coordinate other actors
 */
class OrchestratorActor extends AIActor {
  constructor(context: ActorContext) {
    super(context)
    
    this.initializeLLM({
      provider: 'azure-openai',
      apiKey: process.env.AZURE_OPENAI_API_KEY!,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
      model: process.env.AZURE_OPENAI_DEPLOYMENT!,
      temperature: 0.3, // Lower temperature for more deterministic orchestration
    })
  }

  async orchestrate(task: string): Promise<string> {
    console.log(`\n🎯 Task: ${task}`)
    
    const response = await this.chatWithTools(
      [
        {
          role: 'system',
          content: `You are an AI orchestrator that coordinates multiple specialized actors to complete tasks.
          
Available actors:
- customer-lookup: Find customer information by name or email
- loan-calculator: Calculate mortgage payments and totals
- credit-check: Check customer credit score and approval
- email-sender: Send emails to customers

Call actors in the right sequence to complete the task. You can call multiple actors if needed.`,
        },
        {
          role: 'user',
          content: task,
        },
      ],
      {
        maxToolRounds: 10, // Allow multiple orchestration steps
      }
    )
    
    return response
  }
}

/**
 * Setup actor registry with sample actors
 */
async function setupRegistry(): Promise<InMemoryDataStore> {
  const dataStore = new InMemoryDataStore()
  
  const actors: ActorMetadata[] = [
    {
      actorId: 'customer-lookup',
      version: '1.0.0',
      displayName: 'Customer Lookup',
      description: 'Find customer by name or email and return their profile',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Customer name' },
          email: { type: 'string', description: 'Customer email' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          customer: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string' },
              plan: { type: 'string' },
            },
          },
        },
      },
      wasmModule: 'mock://customer-lookup',
      tags: ['customer', 'lookup'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      actorId: 'loan-calculator',
      version: '1.0.0',
      displayName: 'Loan Calculator',
      description: 'Calculate mortgage payment, total paid, and interest',
      inputSchema: {
        type: 'object',
        properties: {
          principal: { type: 'number', description: 'Loan amount in dollars' },
          annualRate: { type: 'number', description: 'Annual interest rate (e.g., 6.5)' },
          years: { type: 'number', description: 'Loan term in years' },
        },
        required: ['principal', 'annualRate', 'years'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          monthlyPayment: { type: 'number' },
          totalPaid: { type: 'number' },
          totalInterest: { type: 'number' },
        },
      },
      wasmModule: 'mock://loan-calculator',
      tags: ['loan', 'mortgage', 'calculator'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      actorId: 'credit-check',
      version: '1.0.0',
      displayName: 'Credit Check',
      description: 'Check customer credit score and loan approval status',
      inputSchema: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'Customer ID' },
        },
        required: ['customerId'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          creditScore: { type: 'number' },
          approved: { type: 'boolean' },
          limit: { type: 'number' },
        },
      },
      wasmModule: 'mock://credit-check',
      tags: ['credit', 'verification'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      actorId: 'email-sender',
      version: '1.0.0',
      displayName: 'Email Sender',
      description: 'Send email to customer with subject and body',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body' },
        },
        required: ['to', 'subject', 'body'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          sent: { type: 'boolean' },
          messageId: { type: 'string' },
        },
      },
      wasmModule: 'mock://email-sender',
      tags: ['email', 'notification'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]
  
  for (const actor of actors) {
    await dataStore.saveActorMetadata(actor)
  }
  
  console.log(`✅ Registered ${actors.length} actors in registry`)
  
  return dataStore
}

/**
 * Run orchestration examples
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║     LLM Orchestrating Actors - Dynamic Tool Calling       ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  
  // Setup registry
  const dataStore = await setupRegistry()
  
  // Use real WASM executor (with mock fallback for demo)
  const useRealWasm = process.env.USE_REAL_WASM === 'true'
  const executor: ActorExecutor = useRealWasm
    ? new WasmActorExecutor({
        dataStore,
        enableCache: true,
        defaultTimeout: 30000,
        validateSchemas: true,
      })
    : new MockActorExecutor()
  
  console.log(`\n🔧 Using ${useRealWasm ? 'REAL WASM' : 'MOCK'} executor`)
  console.log(`   Set USE_REAL_WASM=true to execute actual WASM actors\n`)
  
  // Create orchestrator
  const orchestrator = new OrchestratorActor({
    actorId: 'orchestrator-1',
    correlationId: 'demo-orchestration',
  } as ActorContext)
  
  // Register actors from registry as tools
  await orchestrator.registerActorsAsTools(dataStore, executor)
  
  console.log('\n━━━ Example 1: Multi-Step Customer Workflow ━━━')
  const result1 = await orchestrator.orchestrate(
    'Find customer Alice Johnson, check her credit, calculate a $400,000 mortgage at 6.5% for 30 years, and email her the quote'
  )
  console.log('\n💬 Final Result:', result1)
  
  console.log('\n\n━━━ Example 2: Simple Lookup ━━━')
  const result2 = await orchestrator.orchestrate(
    'Look up customer Bob Smith and tell me their plan type'
  )
  console.log('\n💬 Final Result:', result2)
  
  console.log('\n\n━━━ Example 3: Complex Orchestration ━━━')
  const result3 = await orchestrator.orchestrate(
    'Calculate mortgage payments for $350,000 at 7% for 15 years and 30 years. Compare them and recommend the better option.'
  )
  console.log('\n💬 Final Result:', result3)
  
  console.log('\n\n✨ All orchestration examples complete!')
}

main().catch(console.error)
