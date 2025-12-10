/**
 * REAL WORKING EXAMPLE: AssemblyScript WASM Activity
 * 
 * This is a simple "echo" activity that demonstrates:
 * - JSON input/output
 * - String manipulation
 * - The WASM contract
 */

// Input type
class Input {
  message!: string
  times!: i32
}

// Output type  
class Output {
  result!: string
  length!: i32
}

/**
 * Main entry point - MUST be exported and named "execute"
 */
export function execute(inputJson: string): string {
  // Parse JSON input
  const input: Input = JSON.parse(inputJson) as Input
  
  // Do some work
  let result = ''
  for (let i = 0; i < input.times; i++) {
    result += input.message + ' '
  }
  
  // Create output
  const output: Output = {
    result: result.trim(),
    length: result.length
  }
  
  // Return JSON output
  return JSON.stringify(output)
}

/**
 * Build this with:
 * 
 * npm install -g assemblyscript
 * asc examples/wasm/echo-activity.ts -o examples/wasm/echo.wasm --optimize
 */
