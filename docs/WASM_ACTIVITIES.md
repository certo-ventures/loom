# Building and Running WASM Activities

## Step 1: Write the Activity (Rust Example)

```rust
// src/lib.rs
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
struct Input {
    url: String,
    method: String,
}

#[derive(Serialize)]
struct Output {
    status: u16,
    body: String,
}

#[wasm_bindgen]
pub fn execute(input_json: &str) -> String {
    // Parse input
    let input: Input = serde_json::from_str(input_json).unwrap();
    
    // Do the work (simplified - real version would use HTTP client)
    let output = Output {
        status: 200,
        body: format!("Response from {}", input.url),
    };
    
    // Return JSON
    serde_json::to_string(&output).unwrap()
}
```

## Step 2: Build to WASM

```bash
# Cargo.toml
[package]
name = "http-activity"
version = "0.1.0"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Build
cargo build --target wasm32-unknown-unknown --release

# Optimize (optional)
wasm-opt -Os -o activity.wasm target/wasm32-unknown-unknown/release/http_activity.wasm
```

## Step 3: Upload to Blob Storage

```typescript
const wasmBytes = fs.readFileSync('activity.wasm')
const blobPath = await blobStore.upload('activities/http-request-v1.0.0.wasm', wasmBytes)
```

## Step 4: Register Activity Definition

```typescript
const activityDef: ActivityDefinition = {
  name: 'http-request',
  version: '1.0.0',
  wasmBlobPath: 'activities/http-request-v1.0.0.wasm',
  capabilities: {
    network: true,
  },
  limits: {
    maxMemoryMB: 128,
    maxExecutionMs: 5000,
  }
}
```

## Step 5: Execute from Actor

```typescript
class MyActor extends Actor {
  async execute() {
    // This calls the WASM activity
    const result = await this.callActivity('http-request', {
      url: 'https://api.example.com/data',
      method: 'GET'
    })
    
    console.log(result) // { status: 200, body: "..." }
  }
}
```

## What Happens Behind the Scenes

1. **Actor calls activity** → Suspends and records in journal
2. **Runtime catches suspend** → Gets activity definition
3. **WasmExecutor loads module** → Downloads from blob storage, compiles, caches
4. **Execute in sandbox** → Calls WASM's `execute()` function with JSON input
5. **Parse result** → JSON output returned to runtime
6. **Resume actor** → Replays journal with activity result

## Alternative: JavaScript/AssemblyScript

```typescript
// activity.ts (AssemblyScript)
export function execute(inputJson: string): string {
  const input = JSON.parse(inputJson)
  
  const output = {
    status: 200,
    body: `Hello from ${input.name}`
  }
  
  return JSON.stringify(output)
}
```

Compile: `asc activity.ts -o activity.wasm`

## The WASM Contract

Every activity MUST:
- Export an `execute(inputJson: string): string` function
- Accept JSON input as string
- Return JSON output as string
- Be deterministic (same input = same output)

This makes activities:
- ✅ Language agnostic (Rust, C++, AssemblyScript, etc.)
- ✅ Sandboxed (can't access host unless given capability)
- ✅ Portable (run anywhere WebAssembly runs)
- ✅ Fast (compiled, cached, pooled)
