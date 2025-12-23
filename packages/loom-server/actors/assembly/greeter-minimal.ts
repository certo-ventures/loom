// Ultra-minimal greeter for Extism - avoids BigInt issues

export function execute(): i32 {
  const input = getInput();
  
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
  
  // Create response (avoid Date.now() for now)
  const greeting = `Hello, ${name}! Welcome to Loom Server.`;
  const response = `{"greeting":"${greeting}","length":${greeting.length}}`;
  
  setOutput(response);
  return 0;
}

function getInput(): string {
  const len = i32(input_length());
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = u8(input_load_u8(i));
  }
  return String.UTF8.decode(bytes.buffer);
}

function setOutput(s: string): void {
  const buf = String.UTF8.encode(s);
  const len = buf.byteLength;
  const ptr = i32(alloc(len));
  
  for (let i = 0; i < len; i++) {
    store<u8>(ptr + i, load<u8>(changetype<usize>(buf) + i));
  }
  
  output_set(ptr, len);
}

@external("extism:host/env", "input_length")
declare function input_length(): i64;

@external("extism:host/env", "input_load_u8")
declare function input_load_u8(offset: i64): i32;

@external("extism:host/env", "alloc")
declare function alloc(len: i64): i64;

@external("extism:host/env", "output_set")
declare function output_set(offset: i64, len: i64): void;
