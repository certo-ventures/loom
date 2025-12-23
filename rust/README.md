# Loom Rust Workspace

This directory contains Rust crates that compile to WebAssembly for cryptographic verification.

## Overview

**Why Rust here?**
- TLS Notary and RISC Zero only exist in Rust
- Cryptographic operations need native performance
- WASM provides sandboxing and portability

**What's in this workspace:**
- `tlsn-verifier/` - TLS Notary proof verification
- _(future)_ `risc-zero-verifier/` - RISC Zero proof verification

## Setup

```bash
# Install Rust and WASM toolchain
./scripts/setup-dev.sh

# Or manually:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
```

## Building

```bash
# Build all Rust modules
npm run build:rust

# Or manually:
cd rust
cargo build --target wasm32-unknown-unknown --release
```

## Testing

```bash
# Run Rust tests
npm run test:rust

# Or manually:
cd rust
cargo test
```

## Architecture

```
TypeScript (Orchestration)
    ↓
TypeScript Wrapper (src/activities/tls-notary-executor.ts)
    ↓
WASM Module (build/wasm/tlsn-verifier/*.wasm)
    ↓
Rust Code (rust/tlsn-verifier/src/lib.rs)
    ↓
TLS Notary Library (tlsn-core, tlsn-verifier)
```

## Development Workflow

1. **Modify Rust code** in `rust/tlsn-verifier/src/`
2. **Build WASM** with `npm run build:rust`
3. **Test from TypeScript** with your examples
4. **Commit both** Rust source and compiled WASM

## Size Reference

- `tlsn-verifier.wasm` - ~500-800 KB
- AssemblyScript WASM - ~6-10 KB
- RISC Zero verifier - ~1-2 MB

## Notes

- Keep Rust code simple and focused on crypto
- All business logic stays in TypeScript/AssemblyScript
- WASM modules export JSON interfaces only
- See [RUST_CONSEQUENCES.md](../docs/RUST_CONSEQUENCES.md) for trade-offs
