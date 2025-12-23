# WASM Quick Reference

## Quick Start (2 Commands)

```bash
# Compile AssemblyScript to WASM
npm run asbuild:counter

# Run complete demo
npm run example:real-wasm
```

## Files

| File | Purpose | Size |
|------|---------|------|
| `examples/wasm/counter-actor.ts` | Source code (AssemblyScript) | 2KB |
| `build/counter-actor.wasm` | Compiled binary | 6.5KB |
| `examples/run-real-wasm-activity.ts` | Demo script | 4KB |

## API

### Activity Contract

```typescript
// WASM must export this function
export function execute(inputJson: string): string {
  const input = JSON.parse(inputJson)
  // ... your logic ...
  return JSON.stringify(result)
}
```

### Using in Loom

```typescript
import { WasmActivityExecutor } from './src/activities/wasm-executor'

const executor = new WasmActivityExecutor(blobStore)

const result = await executor.execute({
  name: 'counter',
  version: '1.0.0',
  wasmBlobPath: 'counter-actor.wasm'
}, {
  action: 'increment',
  amount: 5
})

console.log(result) // { count: 5, action: 'increment' }
```

## Compilation Options

### AssemblyScript (Current)

```bash
npx asc source.ts \
  --outFile build/module.wasm \
  --optimize \
  --exportRuntime \
  --runtime stub
```

**Output:** 6-10KB, <1s compile time

### Rust (Future)

```bash
cargo build \
  --target wasm32-wasi \
  --release
```

**Output:** 100KB-1MB, 5-30s compile time

### Extism PDK (Optional)

```rust
use extism_pdk::*;

#[plugin_fn]
pub fn execute(input: Json<Input>) -> FnResult<Json<Output>> {
    // Can call host functions
    let secret = extism_pdk::host_fn!("get_secret", "KEY");
    Ok(Json(output))
}
```

## Package Scripts

```json
{
  "asbuild:echo": "asc assembly/echo.ts --outFile build/echo.wasm ...",
  "asbuild:counter": "asc examples/wasm/counter-actor.ts --outFile build/counter-actor.wasm ...",
  "example:wasm": "tsx examples/run-wasm.ts",
  "example:real-wasm": "tsx examples/run-real-wasm-activity.ts"
}
```

## Verification

```bash
# Check it's real WASM
file build/counter-actor.wasm
# Output: WebAssembly (wasm) binary module version 0x1 (MVP)

# Check magic bytes
hexdump -C build/counter-actor.wasm | head -1
# Output: 00000000  00 61 73 6d 01 00 00 00  ...
#                    ^^^^^^^^^^ "\0asm" = real WASM
```

## Performance

| Metric | Value |
|--------|-------|
| Compile (AS) | <1 second |
| Binary Size | 6-10KB |
| Load Time | <10ms |
| Execution | ~1ms/call |
| Throughput | 1,000 calls/sec/core |

## Storage

```typescript
// In-memory (dev/test)
const store = new MemoryBlobStore()

// Azure (production)
const store = new AzureBlobStore({
  connectionString: process.env.AZURE_STORAGE,
  container: 'loom-activities'
})

// Upload WASM
await store.upload('my-activity.wasm', wasmBytes)

// Use in executor (same code!)
const executor = new WasmActivityExecutor(store)
```

## Integration Examples

### Current: Business Logic

```typescript
// counter, echo, data transforms
export function execute(input: string): string {
  // Pure computation
  return result
}
```

### Future: TLS Notary

```rust
// Verify bank statement is real
pub fn verify_proof(proof: &[u8]) -> bool {
    TlsNotaryVerifier::new().verify(proof)
}
```

### Future: RISC Zero

```rust
// Prove DTI calculation is correct
risc0_zkvm::guest::entry!(main);
pub fn main() {
    let dti = calculate_dti();
    env::commit(&dti); // Public output
}
```

## Documentation

- **[REAL_WASM_IMPLEMENTATION.md](REAL_WASM_IMPLEMENTATION.md)** - Complete implementation guide
- **[WASM_OPTIONS.md](WASM_OPTIONS.md)** - AssemblyScript vs Rust vs Extism
- **[WASM_INTEGRATION_ARCHITECTURE.md](WASM_INTEGRATION_ARCHITECTURE.md)** - Full stack view
- **[examples/wasm/README.md](../examples/wasm/README.md)** - Quick start

## Common Tasks

### Create New Activity

```bash
# 1. Create source
vim examples/wasm/my-activity.ts

# 2. Add build script to package.json
"asbuild:my-activity": "asc examples/wasm/my-activity.ts --outFile build/my-activity.wasm --optimize --exportRuntime --runtime stub"

# 3. Compile
npm run asbuild:my-activity

# 4. Test
npm test
```

### Debug WASM

```typescript
// Enable debug logging in WasmActivityExecutor
const executor = new WasmActivityExecutor(blobStore, {
  debug: true
})

// Or add logging in AssemblyScript
export function execute(input: string): string {
  trace("Received input: " + input) // Will call env.log
  return result
}
```

### Benchmark

```typescript
import { performance } from 'perf_hooks'

const start = performance.now()
for (let i = 0; i < 1000; i++) {
  await executor.execute(activity, input)
}
const elapsed = performance.now() - start
console.log(`${1000 / elapsed * 1000} calls/second`)
```

## Status

| Component | Status | Next Step |
|-----------|--------|-----------|
| AssemblyScript | ✅ Working | Use for activities |
| Blob Store | ✅ Working | Azure integration |
| Executor | ✅ Working | Add metrics |
| Rust Support | ⏳ Ready | Add tooling |
| TLS Notary | ⏳ Ready | Integrate library |
| RISC Zero | ⏳ Ready | Setup toolchain |
| Extism | ⏳ Optional | Evaluate need |

---

**Bottom Line:** Real WASM is working. AssemblyScript for business logic now, Rust for crypto later.
