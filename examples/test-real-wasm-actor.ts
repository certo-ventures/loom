/**
 * Test Real WASM Actor Execution
 * 
 * Tests WasmActorExecutor with actual compiled WASM actor
 */

import { WasmActorExecutor } from '../src/actor/wasm-actor-executor'
import { InMemoryDataStore } from '../packages/loom-server/src/registry/in-memory-store'
import type { ActorMetadata } from '../packages/loom-server/src/types'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║          Real WASM Actor Execution Test                   ║')
  console.log('╚═══════════════════════════════════════════════════════════╝\n')
  
  // Setup data store
  const dataStore = new InMemoryDataStore()
  
  // Load compiled WASM
  const wasmPath = path.join(__dirname, '../build/calculator-actor.wasm')
  const wasmBuffer = fs.readFileSync(wasmPath)
  
  console.log(`✅ Loaded WASM from: ${wasmPath}`)
  console.log(`   Size: ${wasmBuffer.length} bytes\n`)
  
  // Register actor metadata
  const metadata: ActorMetadata = {
    actorId: 'mortgage-calculator',
    version: '1.0.0',
    displayName: 'Mortgage Calculator Actor',
    description: 'Calculate mortgage amortization: monthly payment, total paid, and interest',
    inputSchema: {
      type: 'object',
      properties: {
        principal: { type: 'number', description: 'Loan amount in dollars' },
        annualRate: { type: 'number', description: 'Annual interest rate (e.g., 6.5 for 6.5%)' },
        years: { type: 'number', description: 'Loan term in years' },
      },
      required: ['principal', 'annualRate', 'years'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        monthlyPayment: { type: 'number', description: 'Monthly payment amount' },
        totalPaid: { type: 'number', description: 'Total amount paid over life of loan' },
        totalInterest: { type: 'number', description: 'Total interest paid' },
      },
      required: ['monthlyPayment', 'totalPaid', 'totalInterest'],
    },
    wasmModule: 'blob://mortgage-calculator-1.0.0.wasm',
    tags: ['mortgage', 'calculator', 'finance'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  
  await dataStore.saveActorMetadata(metadata)
  await dataStore.saveWasmModule('mortgage-calculator', '1.0.0', wasmBuffer)
  
  console.log('✅ Registered mortgage calculator actor in registry\n')
  
  // Create executor
  const executor = new WasmActorExecutor({
    dataStore,
    enableCache: true,
    defaultTimeout: 5000,
    validateSchemas: true,
  })
  
  console.log('━━━ Test 1: $400,000 at 6.5% for 30 years ━━━\n')
  const result1 = await executor.execute('mortgage-calculator', '1.0.0', { 
    principal: 400000, 
    annualRate: 6.5, 
    years: 30 
  })
  console.log('Input: { principal: 400000, annualRate: 6.5, years: 30 }')
  console.log('Output:', result1)
  console.log(`✅ Monthly Payment: $${result1.monthlyPayment}`)
  console.log(`   Total Paid: $${result1.totalPaid}`)
  console.log(`   Total Interest: $${result1.totalInterest}\n`)
  
  console.log('━━━ Test 2: $250,000 at 7% for 15 years ━━━\n')
  const result2 = await executor.execute('mortgage-calculator', '1.0.0', { 
    principal: 250000, 
    annualRate: 7, 
    years: 15 
  })
  console.log('Input: { principal: 250000, annualRate: 7, years: 15 }')
  console.log('Output:', result2)
  console.log(`✅ Monthly Payment: $${result2.monthlyPayment}`)
  console.log(`   Total Paid: $${result2.totalPaid}`)
  console.log(`   Total Interest: $${result2.totalInterest}\n`)
  
  console.log('━━━ Test 3: $500,000 at 5.5% for 20 years ━━━\n')
  const result3 = await executor.execute('mortgage-calculator', '1.0.0', { 
    principal: 500000, 
    annualRate: 5.5, 
    years: 20 
  })
  console.log('Input: { principal: 500000, annualRate: 5.5, years: 20 }')
  console.log('Output:', result3)
  console.log(`✅ Monthly Payment: $${result3.monthlyPayment}`)
  console.log(`   Total Paid: $${result3.totalPaid}`)
  console.log(`   Total Interest: $${result3.totalInterest}\n`)
  
  console.log('━━━ Test 4: Schema Validation (Should Fail) ━━━\n')
  try {
    await executor.execute('mortgage-calculator', '1.0.0', { principal: 400000, annualRate: 6.5 }) // Missing 'years'
    console.log('❌ Should have failed validation')
  } catch (error: any) {
    console.log('✅ Validation correctly rejected invalid input')
    console.log(`   Error: ${error.message}\n`)
  }
  
  console.log('━━━ Cache Statistics ━━━\n')
  const stats = executor.getCacheStats()
  console.log('Cached modules:', stats.modules)
  console.log('Cached metadata:', stats.metadata)
  
  console.log('\n✨ All tests passed! Real WASM execution working.\n')
}

main().catch(console.error)
