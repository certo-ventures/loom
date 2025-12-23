// Minimal greeter that works with Extism

export function execute(): i32 {
  // Get input string from Extism
  const input = Host.inputString();
  
  // Parse the name from JSON
  let name = "World";
  const nameIndex = input.indexOf('"name"');
  if (nameIndex >= 0) {
    const start = input.indexOf('"', nameIndex + 7) + 1;
    const end = input.indexOf('"', start);
    if (start > 0 && end > start) {
      name = input.substring(start, end);
    }
  }
  
  // Create response
  const greeting = `Hello, ${name}! Welcome to Loom Server.`;
  const timestamp = Date.now();
  const response = `{"greeting":"${greeting}","timestamp":${timestamp},"length":${greeting.length}}`;
  
  // Output response
  Host.outputString(response);
  return 0;
}

// Minimal Extism host interface
class Host {
  static inputString(): string {
    const len = input_length();
    if (len == 0) return "";
    
    const bytes = new Uint8Array(len as i32);
    for (let i = 0; i < (len as i32); i++) {
      bytes[i] = input_load_u8(i);
    }
    return String.UTF8.decode(bytes.buffer);
  }
  
  static outputString(s: string): void {
    const encoded = String.UTF8.encode(s);
    const len = encoded.byteLength as i64;
    const offset = alloc(len);
    
    // Convert i64 offset to usize for memory operations
    const offsetUsize = offset as usize;
    memory.copy(offsetUsize, changetype<usize>(encoded), len as usize);
    output_set(offset, len);
  }
}

// Extism host functions
@external("extism:host/env", "input_length")
declare function input_length(): i64;

@external("extism:host/env", "input_load_u8")
declare function input_load_u8(offset: i64): i32;

@external("extism:host/env", "alloc")
declare function alloc(len: i64): i64;

@external("extism:host/env", "output_set")
declare function output_set(offset: i64, len: i64): void;
