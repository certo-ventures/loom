/**
 * Monte Carlo Loan Valuation Engine
 * 
 * Runs thousands of loan scenarios through composed WASM models
 * Demonstrates pure WASM execution at massive scale
 */

import { WasmCompositor } from '../src/wasm/compositor'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface LoanParameters {
  principal: number
  rate: number
  term: number
  fico: number
  origLTV: number
  propertyType: number
  state: number
}

interface ScenarioParameters {
  currentRate: number
  hpiChange: number
}

interface MonteCarloResult {
  totalInterest: number
  totalPrincipal: number
  totalPrepayments: number
  totalDefaults: number
  totalRecoveries: number
  finalBalance: number
  netLoss: number
}

async function main() {
  console.log('🎲 Monte Carlo Loan Valuation Simulator\n')

  // Initialize compositor once
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

  await compositor.initialize()
  console.log('✅ Compositor initialized\n')

  // Define base loan parameters
  const baseLoan: LoanParameters = {
    principal: 300000,
    rate: 0.0650,
    term: 360,
    fico: 720,
    origLTV: 0.80,
    propertyType: 0,
    state: 10
  }

  // Define scenario variations
  const rateScenarios = [0.0550, 0.0600, 0.0650, 0.0700, 0.0750] // Rate environment
  const hpiScenarios = [0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15] // HPI changes

  const scenarios: ScenarioParameters[] = []
  for (const rate of rateScenarios) {
    for (const hpi of hpiScenarios) {
      scenarios.push({ currentRate: rate, hpiChange: hpi })
    }
  }

  console.log(`📊 Running ${scenarios.length} scenarios...`)
  console.log(`   Rate scenarios: ${rateScenarios.length}`)
  console.log(`   HPI scenarios: ${hpiScenarios.length}`)
  console.log(`   Total combinations: ${scenarios.length}\n`)

  // Run Monte Carlo simulation
  const startTime = performance.now()
  const results: MonteCarloResult[] = []

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]
    
    const result = compositor.execute(
      baseLoan.principal,
      baseLoan.rate,
      baseLoan.term,
      scenario.currentRate,
      baseLoan.fico,
      baseLoan.origLTV,
      baseLoan.propertyType,
      baseLoan.state,
      scenario.hpiChange
    )

    results.push(result)

    // Progress indicator
    if ((i + 1) % 10 === 0 || i === scenarios.length - 1) {
      const progress = ((i + 1) / scenarios.length * 100).toFixed(1)
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2)
      process.stdout.write(`\r⏱️  Progress: ${progress}% (${i + 1}/${scenarios.length}) - ${elapsed}s elapsed`)
    }
  }

  const endTime = performance.now()
  const totalTime = (endTime - startTime) / 1000

  console.log('\n\n🎯 Monte Carlo Results:\n')
  console.log(`Total scenarios run: ${results.length}`)
  console.log(`Total time: ${totalTime.toFixed(3)} seconds`)
  console.log(`Scenarios per second: ${(results.length / totalTime).toFixed(2)}`)
  console.log(`Average time per scenario: ${(totalTime / results.length * 1000).toFixed(3)} ms\n`)

  // Calculate statistics across all scenarios
  const netLosses = results.map(r => r.netLoss)
  const prepayments = results.map(r => r.totalPrepayments)
  const defaults = results.map(r => r.totalDefaults)

  const avgNetLoss = netLosses.reduce((a, b) => a + b, 0) / netLosses.length
  const minNetLoss = Math.min(...netLosses)
  const maxNetLoss = Math.max(...netLosses)
  const stdNetLoss = Math.sqrt(
    netLosses.map(x => Math.pow(x - avgNetLoss, 2)).reduce((a, b) => a + b, 0) / netLosses.length
  )

  const avgPrepayment = prepayments.reduce((a, b) => a + b, 0) / prepayments.length
  const avgDefault = defaults.reduce((a, b) => a + b, 0) / defaults.length

  console.log('📈 Statistical Summary:\n')
  console.log(`Net Loss:`)
  console.log(`  Average: $${avgNetLoss.toFixed(2)}`)
  console.log(`  Min: $${minNetLoss.toFixed(2)}`)
  console.log(`  Max: $${maxNetLoss.toFixed(2)}`)
  console.log(`  Std Dev: $${stdNetLoss.toFixed(2)}`)
  console.log()
  console.log(`Average Total Prepayments: $${avgPrepayment.toFixed(2)}`)
  console.log(`Average Total Defaults: $${avgDefault.toFixed(2)}`)

  // Find best and worst scenarios
  const bestIdx = netLosses.indexOf(minNetLoss)
  const worstIdx = netLosses.indexOf(maxNetLoss)

  console.log('\n🎖️  Best Case Scenario:')
  console.log(`   Rate: ${scenarios[bestIdx].currentRate.toFixed(2)}%, HPI: ${(scenarios[bestIdx].hpiChange * 100 - 100).toFixed(0)}%`)
  console.log(`   Net Loss: $${results[bestIdx].netLoss.toFixed(2)}`)
  console.log(`   Defaults: $${results[bestIdx].totalDefaults.toFixed(2)}`)

  console.log('\n⚠️  Worst Case Scenario:')
  console.log(`   Rate: ${scenarios[worstIdx].currentRate.toFixed(2)}%, HPI: ${(scenarios[worstIdx].hpiChange * 100 - 100).toFixed(0)}%`)
  console.log(`   Net Loss: $${results[worstIdx].netLoss.toFixed(2)}`)
  console.log(`   Defaults: $${results[worstIdx].totalDefaults.toFixed(2)}`)

  // Estimate scaling to full Monte Carlo
  console.log('\n\n🚀 Scaling Projection:')
  const fullMonteCarloScenarios = 1000 * 1000 // 1M scenarios
  const estimatedTime = (totalTime / results.length) * fullMonteCarloScenarios
  const estimatedMinutes = Math.floor(estimatedTime / 60)
  const estimatedSeconds = Math.floor(estimatedTime % 60)
  
  console.log(`For ${fullMonteCarloScenarios.toLocaleString()} scenarios:`)
  console.log(`  Estimated time: ${estimatedMinutes}m ${estimatedSeconds}s`)
  console.log(`  That's ${(estimatedTime / 3600).toFixed(2)} hours`)
  console.log()
  console.log('💡 To achieve even faster execution:')
  console.log('   • Run scenarios in parallel (10 workers = 10x speedup)')
  console.log('   • Use true call_indirect with function tables (ongoing research)')
  console.log('   • Compile to native code with AOT compilation')
}

main().catch(console.error)
