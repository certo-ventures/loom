// Working Greeter for Extism - Proper memory handling

export function execute(): i32 {
  const input = readInput();
  
  // Parse name from JSON
  let name = "World";
  const nameIdx = input.indexOf('"name"');
  if (nameIdx >= 0) {
    const start = input.indexOf('"', nameIdx + 7) + 1;
    const end = input.indexOf('"', start);
    if (start > 0 && end > start) {
      name = input.substring(start, end);
    }
  }
  
  // Create response
  const greeting = `Hello, ${name}! Welcome to Loom Server.`;
  const response = `{"greeting":"${greeting}","length":${greeting.length}}`;
  
  writeOutput(response);
  return 0;
}

// Read input from Extism using proper memory operations
function readInput(): string {
  const len = input_length();
  if (len == 0) return "";
  
  // Allocate AssemblyScript memory
  const ptr = heap.alloc(len as usize);
  
  // Read from Extism's input buffer byte by byte
  for (let i: i64 = 0; i < len; i++) {
    const byte = input_load_u8(i); // i is offset in Extism's buffer, not our memory
    store<u8>(ptr + (i as usize), byte as u8);
  }
  
  return String.UTF8.decodeUnsafe(ptr, len as usize);
}

// Write output to Extism
function writeOutput(s: string): void {
  const encoded = String.UTF8.encode(s);
  const len = encoded.byteLength;
  
  // Allocate in linear memory using Extism's alloc
  const offset = alloc(len as i64);
  const offsetNum = offset as usize; // Convert once
  
  // Copy string data to allocated memory
  const src = changetype<usize>(encoded);
  for (let i = 0; i < len; i++) {
    store<u8>(offsetNum + i, load<u8>(src + i));
  }
  
  // Tell Extism where the output is
  output_set(offset, len as i64);
}

// Extism host functions - these are provided by Extism runtime
@external("extism:host/env", "input_length")
declare function input_length(): i64;

@external("extism:host/env", "input_load_u8")
declare function input_load_u8(offset: i64): i32;

@external("extism:host/env", "alloc")
declare function alloc(len: i64): i64;

@external("extism:host/env", "output_set")
declare function output_set(offset: i64, len: i64): void;
