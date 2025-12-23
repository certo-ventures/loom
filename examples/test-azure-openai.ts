/**
 * Simple test to verify Azure OpenAI API is actually being called
 */

import 'dotenv/config'
import { AzureOpenAI } from 'openai'

async function testAzureOpenAI() {
  console.log('🧪 Testing Azure OpenAI API Connection\n')

  const client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT!,
    apiVersion: '2024-04-01-preview',
  })

  console.log('📡 Configuration:')
  console.log(`   Endpoint: ${process.env.AZURE_OPENAI_ENDPOINT}`)
  console.log(`   Deployment: ${process.env.AZURE_OPENAI_DEPLOYMENT}`)
  console.log(`   Model: ${process.env.AZURE_OPENAI_MODEL}`)
  console.log()

  console.log('📤 Sending request to Azure OpenAI...')
  const startTime = Date.now()

  try {
    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_MODEL!,
      messages: [
        {
          role: 'system',
          content: 'You are coordinating a software development team. The team has: Alice (Architect), Bob (Developer), Carol (Tester).'
        },
        {
          role: 'user',
          content: 'The task is to design a user authentication system. Who should speak first? Reply with ONLY the name.'
        }
      ],
      temperature: 0.7,
      max_tokens: 50
    })

    const endTime = Date.now()
    const latency = endTime - startTime

    console.log('✅ Response received!\n')
    
    console.log('📥 Response Details:')
    console.log(`   Latency: ${latency}ms`)
    console.log(`   Model: ${response.model}`)
    console.log(`   Created: ${new Date(response.created * 1000).toISOString()}`)
    console.log(`   Response ID: ${response.id}`)
    console.log()

    const choice = response.choices[0]
    console.log('💬 AI Response:')
    console.log(`   Content: "${choice.message.content}"`)
    console.log(`   Finish Reason: ${choice.finish_reason}`)
    console.log()

    const usage = response.usage!
    console.log('📊 Token Usage:')
    console.log(`   Prompt Tokens: ${usage.prompt_tokens}`)
    console.log(`   Completion Tokens: ${usage.completion_tokens}`)
    console.log(`   Total Tokens: ${usage.total_tokens}`)
    console.log()

    // Estimate cost (GPT-4o pricing)
    const promptCost = (usage.prompt_tokens / 1000) * 0.0025 // $2.50 per 1M input tokens
    const completionCost = (usage.completion_tokens / 1000) * 0.01 // $10 per 1M output tokens
    const totalCost = promptCost + completionCost

    console.log('💰 Estimated Cost:')
    console.log(`   Prompt: $${promptCost.toFixed(6)}`)
    console.log(`   Completion: $${completionCost.toFixed(6)}`)
    console.log(`   Total: $${totalCost.toFixed(6)}`)
    console.log()

    console.log('✅ VERIFIED: Azure OpenAI API is working and returning real responses!')
    console.log(`   The AI intelligently selected: ${choice.message.content}`)
    console.log(`   This is a REAL API call with unique response ID: ${response.id}`)

  } catch (error) {
    console.error('❌ Error calling Azure OpenAI:', error)
    if (error instanceof Error) {
      console.error('   Message:', error.message)
    }
  }
}

testAzureOpenAI().catch(console.error)
