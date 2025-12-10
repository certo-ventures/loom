/**
 * Echo Activity - WASM version
 * 
 * This is a simple activity that repeats a message N times.
 * Demonstrates the WASM contract: execute(inputJson: string): string
 */

/**
 * Simple JSON parser for our specific input format
 */
function parseInput(inputJson: string): Map<string, string> {
  const result = new Map<string, string>()
  
  // Extract message
  let idx = inputJson.indexOf('"message"')
  if (idx >= 0) {
    let start = inputJson.indexOf('"', idx + 9)
    let end = inputJson.indexOf('"', start + 1)
    result.set('message', inputJson.substring(start + 1, end))
  }
  
  // Extract times
  idx = inputJson.indexOf('"times"')
  if (idx >= 0) {
    let start = inputJson.indexOf(':', idx + 7) + 1
    let end = inputJson.indexOf(',', start)
    if (end < 0) end = inputJson.indexOf('}', start)
    result.set('times', inputJson.substring(start, end).trim())
  }
  
  return result
}

/**
 * Main entry point - MUST be exported and named "execute"
 */
export function execute(inputJson: string): string {
  // Parse JSON input
  const input = parseInput(inputJson)
  const message = input.get('message')
  const timesStr = input.get('times')
  
  if (!message || !timesStr) {
    return '{"error":"Invalid input format"}'
  }
  
  const times = I32.parseInt(timesStr)
  
  // Do the work - repeat the message
  let result = ''
  for (let i = 0; i < times; i++) {
    if (i > 0) result += ' '
    result += message
  }
  
  // Build JSON output manually (AssemblyScript JSON is limited)
  const output = `{"result":"${result}","length":${result.length},"executedBy":"WASM"}`
  
  return output
}
