# TLS Notary Verifier

WebAssembly module for verifying TLS Notary proofs in Loom actors.

## Purpose

This crate provides cryptographic verification of TLS Notary proofs. It compiles to WASM and is loaded by TypeScript actors to verify that data truly came from a specific server.

## Architecture

```
TypeScript Actor
    ↓
verify_tls_notary_proof(proof_json)
    ↓
Parse JSON → Verify Signature → Extract Data
    ↓
Return VerifiedData JSON
```

## Building

```bash
# From workspace root
npm run build:rust

# Or manually
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen target/wasm32-unknown-unknown/release/tlsn_verifier.wasm \
  --out-dir ../../build/wasm/tlsn-verifier \
  --target nodejs
```

## Testing

```bash
# Run Rust tests
cargo test

# Run with WASM
wasm-pack test --node
```

## API

### `verify_tls_notary_proof(proof_json: string) -> Result<string, JsValue>`

**Input:** JSON string with TLS Notary proof
```json
{
  "session_header": {
    "server_name": "api.bank.com",
    "handshake_hash": [...]
  },
  "transcript_proof": {
    "sent": [...],
    "received": [...],
    "ranges": [{"start": 0, "end": 100}]
  },
  "signature": [...]
}
```

**Output:** JSON string with verified data
```json
{
  "server": "api.bank.com",
  "data": "verified content",
  "verified_at": 1700000000000,
  "signature_valid": true
}
```

## Current Status

⚠️ **PLACEHOLDER IMPLEMENTATION**

This crate currently has placeholder verification logic. Real implementation requires:

1. Full integration with `tlsn-verifier` crate
2. Proper signature verification using notary's public key
3. Merkle proof verification for transcript ranges
4. Production-ready error handling

See [TLS_NOTARY_INTEGRATION.md](../../docs/TLS_NOTARY_INTEGRATION.md) for details.

## Size

- Debug build: ~2 MB
- Release build: ~500-800 KB
- After wasm-opt: ~400-600 KB

## Dependencies

- `tlsn-core` - Core TLS Notary types
- `tlsn-verifier` - Verification logic
- `wasm-bindgen` - JS/Rust bindings
- `serde` - JSON serialization
