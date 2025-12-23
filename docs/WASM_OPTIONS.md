# WASM Integration Options for Loom

## Overview

Loom now supports **real compiled WebAssembly modules** for activities. This document explains the different approaches and their benefits.

## ✅ Current Implementation: AssemblyScript

### What We Have Now

- **Working WASM compilation** from AssemblyScript to binary `.wasm` files
- **In-memory blob store** for dynamic loading
- **Sandboxed execution** with memory isolation
- **Module caching** for performance

### Example

```bash
# Compile AssemblyScript to WASM
npm run asbuild:counter

# Run demo
npm run example:real-wasm
```

The counter actor:
- Compiles from TypeScript-like syntax to real WASM binary
- Loads dynamically from blob store
- Executes with near-native speed
- Maintains state across calls

### Benefits

✅ **TypeScript-like syntax** - familiar to JS/TS developers  
✅ **Small binaries** - 6-10KB typical  
✅ **Fast compilation** - sub-second builds  
✅ **Memory-safe** - no manual memory management needed  
✅ **Works with existing tooling** - npm, tsx, vitest  

## 🔄 Alternative: Extism

[Extism](https://extism.org/) is a universal plugin system powered by WebAssembly.

### What Extism Provides

1. **Host Functions** - Call back into host from WASM
2. **Multi-language SDKs** - Write plugins in Rust, Go, C, etc.
3. **PDK (Plugin Development Kit)** - Easier than raw WASM
4. **HTTP/JSON built-in** - Common operations simplified
5. **Cross-runtime** - Same WASM works in Node, Deno, browsers

### Example Architecture with Extism

```typescript
import { createPlugin } from '@extism/extism'

// Load WASM from blob store
const wasmBytes = await blobStore.download('my-plugin.wasm')

// Create plugin
const plugin = await createPlugin(wasmBytes, {
  useWasi: true,
  functions: {
    // Host functions callable from WASM
    'log': (msg: string) => console.log(msg),
    'fetch_data': async (url: string) => {
      const response = await fetch(url)
      return response.json()
    }
  }
})

// Execute
const result = await plugin.call('process', inputData)
```

### When to Use Extism

**Use Extism if you need:**
- ✅ Rust/Go/C plugins (not just TypeScript)
- ✅ Host function callbacks from WASM
- ✅ HTTP calls from within WASM
- ✅ Complex system interactions
- ✅ Pre-built plugin ecosystem

**Stick with AssemblyScript if:**
- ✅ TypeScript developers writing activities
- ✅ Simple, fast compilation
- ✅ Small binary sizes
- ✅ Minimal dependencies

## 🚀 Recommended Approach

### For Loom Activities (Current)

**Use AssemblyScript** for:
- Data transformations
- Business logic
- State machines
- Calculations
- JSON processing

### For TLS Notary / RISC Zero Integration

**Use Rust → WASM** with either:

1. **Direct compilation** (like AssemblyScript approach)
   - Compile Rust to `wasm32-wasi` or `wasm32-unknown-unknown`
   - Load via existing `WasmActivityExecutor`
   - Minimal dependencies

2. **Extism** (if needed for host functions)
   - TLS Notary plugins in Rust
   - RISC Zero guest programs
   - Call back to host for cryptographic operations

## Example: TLS Notary Activity

### Option 1: AssemblyScript (Simple)

```typescript
// assembly/tls-notary-verify.ts
export function execute(inputJson: string): string {
  // Parse proof
  const proof = parseProof(inputJson)
  
  // Verify (pure computation)
  const isValid = verifyProof(proof)
  
  return `{"valid":${isValid}}`
}
```

### Option 2: Rust + Extism (Full Featured)

```rust
// src/lib.rs
use extism_pdk::*;
use tlsn_verifier::Verifier;

#[plugin_fn]
pub fn verify_proof(proof_json: String) -> FnResult<String> {
    // Parse proof
    let proof = serde_json::from_str(&proof_json)?;
    
    // Call host function for network
    let notary_key = extism_pdk::http::request(
        "GET", 
        "https://notary.example.com/key"
    )?;
    
    // Verify
    let verifier = Verifier::new(notary_key);
    let result = verifier.verify(&proof)?;
    
    Ok(serde_json::to_string(&result)?)
}
```

## 🔧 Integration Steps

### Adding Extism Support (if needed)

1. **Install Extism**
```bash
npm install @extism/extism
```

2. **Create ExtismActivityExecutor** (similar to WasmActivityExecutor)
```typescript
export class ExtismActivityExecutor {
  async execute(definition: ActivityDefinition, input: unknown) {
    const wasmBytes = await this.blobStore.download(definition.wasmBlobPath)
    
    const plugin = await createPlugin(wasmBytes, {
      useWasi: true,
      functions: this.getHostFunctions()
    })
    
    return plugin.call('execute', JSON.stringify(input))
  }
  
  private getHostFunctions() {
    return {
      'loom_log': (msg: string) => console.log(msg),
      'loom_get_secret': async (key: string) => {
        // Call secret manager
      }
    }
  }
}
```

3. **Use in workflows**
```typescript
const activity = {
  name: 'tls-notary-verify',
  version: '1.0.0',
  wasmBlobPath: 'tls-notary.wasm',
  runtime: 'extism' // <-- Specify runtime
}

const result = await executeActivity(activity, { proof: '...' })
```

## 📊 Comparison

| Feature | AssemblyScript | Extism |
|---------|---------------|---------|
| Language | TypeScript-like | Rust, Go, C, etc. |
| Binary Size | 6-10KB | 100KB-1MB |
| Compilation | Fast (<1s) | Slower (5-30s) |
| Host Functions | Limited | Full support |
| Network | No | Yes (via host) |
| Crypto Libraries | Limited | Full (Rust crates) |
| Learning Curve | Easy | Moderate |
| Maturity | Established | Growing |

## 🎯 Recommendation

**For Loom MVP:**
1. ✅ Keep AssemblyScript for general activities (done)
2. ✅ Add Rust compilation support for crypto operations
3. ⏳ Add Extism support later if host functions needed

**For TLS Notary / RISC Zero:**
1. Compile Rust guest programs to WASM
2. Load via existing infrastructure
3. Add Extism only if need host callbacks

## 🔗 Resources

- [AssemblyScript Book](https://www.assemblyscript.org/)
- [Extism Documentation](https://extism.org/docs/)
- [WASM Component Model](https://component-model.bytecodealliance.org/)
- [TLS Notary](https://tlsnotary.org/)
- [RISC Zero](https://www.risczero.com/)

## Next Steps

1. ✅ AssemblyScript WASM working
2. ⏳ Add Rust WASM compilation example
3. ⏳ TLS Notary guest program in Rust
4. ⏳ RISC Zero prover integration
5. ⏳ Evaluate Extism for advanced use cases
