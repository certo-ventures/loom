/**
 * Test: Unified LLM with Azure OpenAI
 * Quick validation that our implementation works with real endpoints
 */

import { UnifiedLLM } from '../src/ai/unified-llm'
import * as dotenv from 'dotenv'

dotenv.config()

async function testAzureOpenAI() {
  console.log('🧪 Testing Unified LLM with Azure OpenAI...\n')

  // Initialize LLM with Azure OpenAI config from .env
  const llm = new UnifiedLLM({
    provider: 'azure-openai',
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    model: process.env.AZURE_OPENAI_DEPLOYMENT!, // Deployment name
    temperature: 0.7,
    maxTokens: 150,
  })

  console.log('✅ LLM initialized')
  console.log('   Provider:', llm.getConfig().provider)
  console.log('   Model:', llm.getConfig().model)
  console.log('   Endpoint:', llm.getConfig().endpoint)
  console.log()

  // Test 1: Simple chat completion
  console.log('📝 Test 1: Simple Chat Completion')
  console.log('   Question: "What is 2+2? Answer in one short sentence."')
  
  const startTime = Date.now()
  const response = await llm.chat([
    {
      role: 'user',
      content: 'What is 2+2? Answer in one short sentence.',
    },
  ])

  const duration = Date.now() - startTime
  
  console.log('   Response:', response.content)
  console.log('   Tokens:', response.usage.totalTokens, '(prompt:', response.usage.promptTokens, '+ completion:', response.usage.completionTokens + ')')
  console.log('   Model:', response.model)
  console.log('   Duration:', duration + 'ms')
  console.log()

  // Test 2: Streaming chat
  console.log('📡 Test 2: Streaming Chat')
  console.log('   Question: "Count from 1 to 5 with one number per line."')
  console.log('   Response: ', '')

  const streamStart = Date.now()
  let chunkCount = 0
  
  const streamResponse = await llm.stream(
    [
      {
        role: 'user',
        content: 'Count from 1 to 5 with one number per line.',
      },
    ],
    (chunk) => {
      process.stdout.write(chunk)
      chunkCount++
    }
  )

  const streamDuration = Date.now() - streamStart
  
  console.log('\n')
  console.log('   Chunks received:', chunkCount)
  console.log('   Tokens:', streamResponse.usage.totalTokens)
  console.log('   Duration:', streamDuration + 'ms')
  console.log()

  // Test 3: Multi-turn conversation
  console.log('💬 Test 3: Multi-turn Conversation')
  
  const conversation = [
    { role: 'system' as const, content: 'You are a helpful math tutor.' },
    { role: 'user' as const, content: 'What is a prime number?' },
  ]
  
  const turn1 = await llm.chat(conversation)
  console.log('   User: What is a prime number?')
  console.log('   Assistant:', turn1.content.substring(0, 100) + '...')
  
  conversation.push({ role: 'assistant' as const, content: turn1.content })
  conversation.push({ role: 'user' as const, content: 'Give me an example' })
  
  const turn2 = await llm.chat(conversation)
  console.log('   User: Give me an example')
  console.log('   Assistant:', turn2.content.substring(0, 100) + '...')
  console.log()

  console.log('✅ All tests passed!')
  console.log()
  console.log('Total usage:')
  console.log('  - Test 1:', response.usage.totalTokens, 'tokens')
  console.log('  - Test 2:', streamResponse.usage.totalTokens, 'tokens')
  console.log('  - Test 3:', turn1.usage.totalTokens + turn2.usage.totalTokens, 'tokens')
  console.log('  - Grand total:', 
    response.usage.totalTokens + 
    streamResponse.usage.totalTokens + 
    turn1.usage.totalTokens + 
    turn2.usage.totalTokens, 
    'tokens'
  )
}

// Run tests
testAzureOpenAI()
  .then(() => {
    console.log('\n🎉 Unified LLM implementation validated!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message)
    console.error(error)
    process.exit(1)
  })
