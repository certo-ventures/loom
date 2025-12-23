// Greeter Actor - AssemblyScript WASM
// This version uses a static buffer instead of dynamic allocation

// Extism host functions
@external("extism:host/env", "input_length")
declare function input_length(): i64;

@external("extism:host/env", "input_load_u8")
declare function input_load_u8(offset: i64): u8;

@external("extism:host/env", "output_set")
declare function output_set(offset: i64, length: i64): void;

// Static buffer for input/output (1KB should be enough)
const BUFFER_SIZE = 1024;
let buffer = new ArrayBuffer(BUFFER_SIZE);

// Read input from Extism
function readInput(): string {
  const len = input_length();
  if (len > BUFFER_SIZE) {
    return ""; // Input too large
  }
  
  const inputBytes = new Uint8Array(BUFFER_SIZE);
  for (let i: i64 = 0; i < len; i++) {
    inputBytes[i as i32] = input_load_u8(i);
  }
  
  return String.UTF8.decode(inputBytes.buffer);
}

// Write output to Extism using static buffer
function writeOutput(s: string): void {
  const outputBytes = new Uint8Array(BUFFER_SIZE);
  const encoded = String.UTF8.encode(s, false);
  const len = encoded.byteLength;
  
  if (len > BUFFER_SIZE) {
    return; // Output too large
  }
  
  // Copy to our static buffer
  const src = changetype<usize>(encoded);
  const dst = changetype<usize>(outputBytes);
  for (let i = 0; i < len; i++) {
    store<u8>(dst + i, load<u8>(src + i));
  }
  
  // Tell Extism about our static buffer  
  // Use the pointer directly as i64
  output_set(dst as i64, len as i64);
}

// Main entry point
export function execute(): i32 {
  const inputJson = readInput();
  
  // Parse input (simple JSON parsing)
  const nameStart = inputJson.indexOf('"name"') + 8; // Skip to value
  const nameEnd = inputJson.indexOf('"', nameStart + 1);
  const name = inputJson.substring(nameStart, nameEnd);
  
  // Generate greeting
  const greeting = `Hello, ${name}! Welcome to Loom!`;
  const length = greeting.length;
  
  // Create output JSON
  const output = `{"greeting":"${greeting}","length":${length}}`;
  
  writeOutput(output);
  return 0;
}
