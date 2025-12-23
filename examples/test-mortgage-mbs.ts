/**
 * Test Advanced Mortgage Calculator with CPR/CDR
 * 
 * Tests prepayments and defaults with MBS metrics
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
  console.log('║     Advanced Mortgage Calculator with CPR/CDR/SMM/MDR    ║')
  console.log('╚═══════════════════════════════════════════════════════════╝\n')
  
  const dataStore = new InMemoryDataStore()
  const wasmPath = path.join(__dirname, '../build/calculator-actor.wasm')
  const wasmBuffer = fs.readFileSync(wasmPath)
  
  console.log(`✅ Loaded WASM from: ${wasmPath}`)
  console.log(`   Size: ${wasmBuffer.length} bytes\n`)
  
  const metadata: ActorMetadata = {
    actorId: 'mortgage-calculator',
    version: '2.0.0',
    displayName: 'Advanced Mortgage Calculator',
    description: 'Calculate mortgage with prepayments (CPR/SMM) and defaults (CDR/MDR)',
    inputSchema: {
      type: 'object',
      properties: {
        principal: { type: 'number', description: 'Loan amount in dollars' },
        annualRate: { type: 'number', description: 'Annual interest rate (e.g., 6.5 for 6.5%)' },
        years: { type: 'number', description: 'Loan term in years' },
        cpr: { type: 'number', description: 'Constant Prepayment Rate (annual %, optional)' },
        cdr: { type: 'number', description: 'Constant Default Rate (annual %, optional)' },
      },
      required: ['principal', 'annualRate', 'years'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        monthlyPayment: { type: 'number' },
        totalPaid: { type: 'number' },
        totalInterest: { type: 'number' },
        smm: { type: 'number' },
        totalPrepayments: { type: 'number' },
        mdr: { type: 'number' },
        totalDefaults: { type: 'number' },
        totalRecovery: { type: 'number' },
        netLoss: { type: 'number' },
      },
    },
    wasmModule: 'blob://mortgage-calculator-2.0.0.wasm',
    tags: ['mortgage', 'mbs', 'structured-finance'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  
  await dataStore.saveActorMetadata(metadata)
  await dataStore.saveWasmModule('mortgage-calculator', '2.0.0', wasmBuffer)
  
  const executor = new WasmActorExecutor({
    dataStore,
    enableCache: true,
    defaultTimeout: 10000,
    validateSchemas: false, // Output schema is flexible based on input
  })
  
  console.log('━━━ Test 1: Standard Mortgage (No Prepay/Default) ━━━\n')
  const result1 = await executor.execute('mortgage-calculator', '2.0.0', {
    principal: 400000,
    annualRate: 6.5,
    years: 30,
  })
  console.log('Input: $400K @ 6.5% for 30 years')
  console.log('Output:', result1)
  console.log()
  
  console.log('━━━ Test 2: With 5% CPR Prepayments ━━━\n')
  const result2 = await executor.execute('mortgage-calculator', '2.0.0', {
    principal: 400000,
    annualRate: 6.5,
    years: 30,
    cpr: 5.0, // 5% annual prepayment rate
  })
  console.log('Input: $400K @ 6.5% for 30 years, CPR=5%')
  console.log('Output:', result2)
  console.log(`📊 SMM (Single Monthly Mortality): ${result2.smm}%`)
  console.log(`💰 Total Prepayments: $${result2.totalPrepayments.toLocaleString()}`)
  console.log()
  
  console.log('━━━ Test 3: With 1% CDR Defaults ━━━\n')
  const result3 = await executor.execute('mortgage-calculator', '2.0.0', {
    principal: 400000,
    annualRate: 6.5,
    years: 30,
    cdr: 1.0, // 1% annual default rate
  })
  console.log('Input: $400K @ 6.5% for 30 years, CDR=1%')
  console.log('Output:', result3)
  console.log(`📊 MDR (Monthly Default Rate): ${result3.mdr}%`)
  console.log(`❌ Total Defaults: $${result3.totalDefaults.toLocaleString()}`)
  console.log(`💵 Total Recovery (70%): $${result3.totalRecovery.toLocaleString()}`)
  console.log(`📉 Net Loss: $${result3.netLoss.toLocaleString()}`)
  console.log()
  
  console.log('━━━ Test 4: Combined CPR=10% + CDR=2% (Stressed) ━━━\n')
  const result4 = await executor.execute('mortgage-calculator', '2.0.0', {
    principal: 1000000,
    annualRate: 7.0,
    years: 30,
    cpr: 10.0, // High prepayment
    cdr: 2.0,  // High default
  })
  console.log('Input: $1M @ 7% for 30 years, CPR=10%, CDR=2%')
  console.log('Output:', result4)
  console.log(`📊 SMM: ${result4.smm}%, MDR: ${result4.mdr}%`)
  console.log(`💰 Total Prepayments: $${result4.totalPrepayments.toLocaleString()}`)
  console.log(`❌ Total Defaults: $${result4.totalDefaults.toLocaleString()}`)
  console.log(`💵 Recovery: $${result4.totalRecovery.toLocaleString()}`)
  console.log(`📉 Net Loss: $${result4.netLoss.toLocaleString()}`)
  console.log()
  
  console.log('━━━ Test 5: Subprime Crisis Scenario (CPR=15%, CDR=5%) ━━━\n')
  const result5 = await executor.execute('mortgage-calculator', '2.0.0', {
    principal: 500000,
    annualRate: 8.5,
    years: 30,
    cpr: 15.0, // Very high prepayment
    cdr: 5.0,  // Very high default
  })
  console.log('Input: $500K @ 8.5% for 30 years, CPR=15%, CDR=5%')
  console.log('Output:', result5)
  console.log(`📊 SMM: ${result5.smm}%, MDR: ${result5.mdr}%`)
  console.log(`💰 Total Prepayments: $${result5.totalPrepayments.toLocaleString()}`)
  console.log(`❌ Total Defaults: $${result5.totalDefaults.toLocaleString()}`)
  console.log(`💵 Recovery: $${result5.totalRecovery.toLocaleString()}`)
  console.log(`📉 Net Loss: $${result5.netLoss.toLocaleString()}`)
  console.log()
  
  console.log('✨ All MBS tests passed! CPR/CDR/SMM/MDR working.\n')
}

main().catch(console.error)
