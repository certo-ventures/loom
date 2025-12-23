/**
 * Counter Actor - AssemblyScript WASM
 * 
 * A stateful actor that maintains a counter.
 * Demonstrates WASM actor with state management.
 * 
 * NOTE: AssemblyScript provides __new/__pin/__unpin/__collect for memory management
 * This is the proper way to work with AS-generated WASM.
 */

// Simple state class
class State {
  count: i32 = 0
}

// Parse input JSON manually (AssemblyScript JSON support is limited)
function parseInput(inputJson: string): Map<string, string> {
  const result = new Map<string, string>()
  
  // Extract action
  let idx = inputJson.indexOf('"action"')
  if (idx >= 0) {
    let start = inputJson.indexOf('"', idx + 8)
    let end = inputJson.indexOf('"', start + 1)
    result.set('action', inputJson.substring(start + 1, end))
  }
  
  // Extract amount (if present)
  idx = inputJson.indexOf('"amount"')
  if (idx >= 0) {
    let start = inputJson.indexOf(':', idx + 8) + 1
    let end = inputJson.indexOf(',', start)
    if (end < 0) end = inputJson.indexOf('}', start)
    result.set('amount', inputJson.substring(start, end).trim())
  }
  
  return result
}

// Global state (persisted across calls)
let state = new State()

/**
 * Main entry point - MUST be exported and named "execute"
 */
export function execute(inputJson: string): string {
  const input = parseInput(inputJson)
  const action = input.get('action')
  
  if (!action) {
    return '{"error":"Missing action"}'
  }
  
  if (action === 'increment') {
    const amountStr = input.get('amount')
    const amount = amountStr ? I32.parseInt(amountStr) : 1
    state.count += amount
  } else if (action === 'decrement') {
    const amountStr = input.get('amount')
    const amount = amountStr ? I32.parseInt(amountStr) : 1
    state.count -= amount
  } else if (action === 'reset') {
    state.count = 0
  } else if (action === 'get') {
    // Just return current state
  } else {
    return `{"error":"Unknown action: ${action}"}`
  }
  
  // Return current state as JSON
  return `{"count":${state.count},"action":"${action}"}`
}
