/**
 * Test Composite WASM Engine - Single Loan Valuation
 * 
 * Demonstrates composing multiple WASM models into a single engine
 * using function tables for pure WASM execution.
 */

import { WasmCompositor } from '../src/wasm/compositor'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
  console.log('🏠 Composite Loan Valuation Test\n')

  // Configure the compositor
  const compositor = new WasmCompositor({
    enginePath: path.join(__dirname, '../build/composite-loan-engine.wasm'),
    models: [
      {
        name: 'prepayment',
        wasmPath: path.join(__dirname, '../build/models/prepayment-model.wasm'),
        functionName: 'calculate'
      },
      {
        name: 'default',
        wasmPath: path.join(__dirname, '../build/models/default-model.wasm'),
        functionName: 'calculate'
      },
      {
        name: 'lgd',
        wasmPath: path.join(__dirname, '../build/models/lgd-model.wasm'),
        functionName: 'calculate'
      }
    ]
  })

  // Initialize the compositor
  await compositor.initialize()
  console.log('\n📊 Compositor stats:', compositor.getStats())

  // Test Case 1: Prime loan in good market
  console.log('\n\n=== Test Case 1: Prime Loan (Good Market) ===')
  const result1 = compositor.execute(
    300000,    // $300k loan
    0.0650,    // 6.5% rate
    360,       // 30 years
    0.0700,    // Current rate 7% (no refi incentive)
    760,       // Excellent FICO
    0.80,      // 80% LTV
    0,         // Single family
    10,        // State 10
    1.05       // 5% HPI appreciation
  )
  console.log('Result:', JSON.stringify(result1, null, 2))

  // Test Case 2: Subprime loan in declining market
  console.log('\n\n=== Test Case 2: Subprime Loan (Declining Market) ===')
  const result2 = compositor.execute(
    200000,    // $200k loan
    0.0850,    // 8.5% rate (subprime)
    360,       // 30 years
    0.0650,    // Current rate 6.5% (big refi incentive)
    620,       // Fair FICO
    0.95,      // 95% LTV
    1,         // Condo
    5,         // CA (judicial foreclosure)
    0.90       // 10% HPI decline
  )
  console.log('Result:', JSON.stringify(result2, null, 2))

  // Test Case 3: Moderate loan with some prepayment
  console.log('\n\n=== Test Case 3: Moderate Loan ===')
  const result3 = compositor.execute(
    250000,    // $250k loan
    0.0725,    // 7.25% rate
    360,       // 30 years
    0.0650,    // Current rate 6.5% (moderate refi)
    700,       // Good FICO
    0.85,      // 85% LTV
    0,         // Single family
    15,        // State 15
    1.00       // Flat HPI
  )
  console.log('Result:', JSON.stringify(result3, null, 2))

  console.log('\n\n✅ All tests completed successfully!')
  console.log('🚀 Pure WASM execution with composed models')
}

main().catch(console.error)
