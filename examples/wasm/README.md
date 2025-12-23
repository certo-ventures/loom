# WASM Examples

This directory contains WebAssembly examples for Loom.

## Quick Start

### Counter Actor (AssemblyScript)

A stateful counter that demonstrates real WASM compilation and execution:

```bash
# Compile AssemblyScript to WASM
npm run asbuild:counter

# Run the demo
npm run example:real-wasm
```

**What it demonstrates:**
1. ✅ Compiles TypeScript-like code to **real binary WASM**
2. ✅ Uploads to **in-memory blob store** (could be Azure/S3)
3. ✅ Loads dynamically from blob store
4. ✅ Executes with **near-native speed**
5. ✅ Maintains state across calls

## Files

- `counter-actor.ts` - AssemblyScript source code
- `../build/counter-actor.wasm` - Compiled binary (6.5KB)
- `../run-real-wasm-activity.ts` - Complete demo script

## Output Example

```
🚀 Real WASM Activity Example

This demonstrates a COMPLETE workflow:
  1. Compile AssemblyScript → WASM
  2. Upload WASM to blob store (in-memory)
  3. Load WASM from blob store
  4. Execute as activity with state

🔨 Compiling examples/wasm/counter-actor.ts...
✅ Compiled to build/counter-actor.wasm

📦 Setting up in-memory blob store...
📦 Uploaded counter-actor.wasm (6550 bytes)

▶️  Executing activity commands:

1️⃣  Increment by 5
   Result: { "count": 5, "action": "increment" }

2️⃣  Increment by 3
   Result: { "count": 3, "action": "increment" }

✨ WASM activity demonstration complete!
```

## Key Points

### This IS Real WASM

- ✅ **Binary format** - not interpreted
- ✅ **Near-native speed** - JIT compiled
- ✅ **Sandboxed** - isolated memory model
- ✅ **Portable** - runs anywhere WASM does
- ✅ **Dynamic loading** - from any blob store

### Why AssemblyScript?

- **TypeScript-like syntax** - familiar to JS/TS developers
- **Fast compilation** - sub-second builds
- **Small binaries** - 6-10KB typical
- **Memory-safe** - no manual memory management
- **npm-compatible** - works with existing tooling

### Alternative: Rust

For cryptographic operations (TLS Notary, RISC Zero):

```bash
# Compile Rust to WASM
cargo build --target wasm32-wasi

# Use the same loader infrastructure
```

See [../docs/WASM_OPTIONS.md](../docs/WASM_OPTIONS.md) for details.

## Next Steps

1. Try the counter example
2. Modify the counter logic
3. Create your own activity
4. Integrate with TLS Notary / RISC Zero

See [../docs/WASM_ACTIVITIES.md](../docs/WASM_ACTIVITIES.md) for architecture details.
