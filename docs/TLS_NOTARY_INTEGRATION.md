# TLS Notary Integration Guide

## Real TLS Notary Implementation

The current TLS Notary actor in `examples/tls-notary-actor.ts` is a **demo/mock** implementation showing the workflow. To use **real TLS Notary**, you need to integrate the actual Rust libraries.

## TLS Notary Architecture

```
User Browser/App          Loom Backend              TLS Notary
┌────────────────┐       ┌─────────────┐           ┌──────────┐
│                │       │             │           │          │
│  1. Generate   │──────▶│             │           │          │
│     Proof      │       │             │           │          │
│                │       │             │           │          │
│  (tlsn-js or   │       │  2. Verify  │──────────▶│ Notary   │
│   Extension)   │       │     Proof   │◀──────────│ Server   │
│                │       │             │           │          │
│                │       │  3. Extract │           │          │
│                │       │     Data    │           │          │
└────────────────┘       └─────────────┘           └──────────┘
```

## Components

### 1. Prover (User-side)

**Options:**
- **tlsn-extension**: Chrome extension for browser proofs
- **tlsn-js**: NPM package for Node.js/browser integration
- **Rust library**: Direct integration with `tlsn` crate

**User Flow:**
1. User navigates to bank website (e.g., Chase.com)
2. TLS Notary extension/library captures TLS session
3. Generates cryptographic proof of data
4. User submits proof to Loom application

### 2. Verifier (Loom Backend)

**Current Status:** Mock implementation  
**Needed:** Real Rust integration

**Options for Integration:**

#### Option A: Rust WASM Module (Recommended)

```rust
// File: rust/tlsn-verifier/src/lib.rs
use tlsn::verifier::{Verifier, VerifierConfig, VerifierOutput, VerifyConfig};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct TlsNotaryVerifier {
    config: VerifierConfig,
}

#[wasm_bindgen]
impl TlsNotaryVerifier {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let config = VerifierConfig::builder()
            .build()
            .unwrap();
        
        Self { config }
    }
    
    #[wasm_bindgen]
    pub fn verify_proof(&self, proof_json: &str) -> Result<String, JsValue> {
        // Parse proof
        let proof: Presentation = serde_json::from_str(proof_json)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        
        // Verify
        let provider = CryptoProvider::default();
        let output = proof.verify(&provider)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        
        // Extract verified data
        let result = VerificationResult {
            server_name: output.server_name,
            transcript: output.transcript,
            verified: true,
        };
        
        Ok(serde_json::to_string(&result).unwrap())
    }
}

// Compile:
// cargo build --target wasm32-unknown-unknown --release
// wasm-bindgen target/wasm32-unknown-unknown/release/tlsn_verifier.wasm --out-dir build
```

#### Option B: Node.js Native Module

```rust
// Use neon or napi-rs to create Node.js binding
use neon::prelude::*;

fn verify_proof(mut cx: FunctionContext) -> JsResult<JsString> {
    let proof_json = cx.argument::<JsString>(0)?.value(&mut cx);
    
    // Use tlsn library
    // ... verification logic ...
    
    Ok(cx.string(result_json))
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("verifyProof", verify_proof)?;
    Ok(())
}
```

#### Option C: Separate Microservice

```rust
// Standalone Rust service
use axum::{Json, Router, routing::post};
use tlsn::attestation::presentation::Presentation;

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/verify", post(verify_handler));
    
    axum::Server::bind(&"0.0.0.0:3001".parse().unwrap())
        .serve(app.into_make_service())
        .await
        .unwrap();
}

async fn verify_handler(
    Json(proof): Json<Presentation>
) -> Json<VerificationResult> {
    let provider = CryptoProvider::default();
    let output = proof.verify(&provider).unwrap();
    
    Json(VerificationResult {
        verified: true,
        data: output.transcript,
        // ...
    })
}
```

## Integration Steps

### Step 1: Add Rust Workspace

```toml
# Cargo.toml (new file at root)
[workspace]
members = ["rust/tlsn-verifier"]

[workspace.dependencies]
tlsn = "0.7"
wasm-bindgen = "0.2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

### Step 2: Create Verifier Module

```bash
mkdir -p rust/tlsn-verifier/src
cd rust/tlsn-verifier

# Add to Cargo.toml
cat > Cargo.toml << 'EOF'
[package]
name = "tlsn-verifier"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
tlsn = "0.7"
wasm-bindgen = "0.2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
EOF

# Create lib.rs with verifier code
```

### Step 3: Compile to WASM

```bash
# Install wasm32 target
rustup target add wasm32-unknown-unknown

# Install wasm-bindgen-cli
cargo install wasm-bindgen-cli

# Build
cargo build --target wasm32-unknown-unknown --release

# Generate JS bindings
wasm-bindgen \
  target/wasm32-unknown-unknown/release/tlsn_verifier.wasm \
  --out-dir ../../build/tlsn \
  --target nodejs
```

### Step 4: Update TypeScript Actor

```typescript
// examples/tls-notary-actor.ts
import { readFileSync } from 'fs'

// Load WASM verifier
const wasmModule = await WebAssembly.compile(
  readFileSync('./build/tlsn/tlsn_verifier_bg.wasm')
)
const wasmInstance = await WebAssembly.instantiate(wasmModule, {})

async function verifyWithRealTlsNotary(proof: TLSNotaryProof): Promise<VerifiedData> {
  // Call real WASM verifier
  const resultJson = wasmInstance.exports.verify_proof(JSON.stringify(proof))
  return JSON.parse(resultJson)
}
```

## Real Proof Structure

Based on the actual TLS Notary library:

```typescript
interface TLSNotaryPresentation {
  // Attestation from notary
  attestation: {
    // Server identity proof
    identity: {
      server_name: string
      cert_chain: string[]
    }
    
    // Connection info
    connection: {
      time: number           // Unix timestamp
      tls_version: string    // e.g., "1.3"
      cipher_suite: string
    }
    
    // Transcript commitments
    commitments: {
      sent: {
        ranges: Array<[number, number]>  // Revealed byte ranges
        commitment: string               // Hash commitment
      }
      received: {
        ranges: Array<[number, number]>
        commitment: string
      }
    }
    
    // Notary signature
    signature: {
      algorithm: string      // e.g., "secp256k1"
      signature: string      // Hex-encoded
      public_key: string     // Notary's public key
    }
  }
  
  // Revealed transcript data
  transcript: {
    sent: Uint8Array         // HTTP request (partially revealed)
    received: Uint8Array     // HTTP response (partially revealed)
  }
}
```

## Testing with Real TLS Notary

### 1. Use TLS Notary Demo

```bash
# Visit https://demo.tlsnotary.org
# Generate a proof for a public API
# Download the proof JSON
```

### 2. Verify in Loom

```typescript
import { readFileSync } from 'fs'

const proof = JSON.parse(readFileSync('proof.json', 'utf8'))
const result = await tlsNotaryActor.execute({
  action: 'verify',
  proof
})

console.log('Verified:', result.verified)
console.log('Data:', result.data)
```

## Production Considerations

### Security

1. **Notary Trust**: Verify notary public key is trusted
2. **Certificate Validation**: Check TLS certificate chain
3. **Timestamp Verification**: Ensure proof isn't too old
4. **Commitment Verification**: Validate all cryptographic commitments

### Performance

- **WASM Size**: TLS Notary WASM ~500KB-1MB
- **Verification Time**: ~50-200ms per proof
- **Caching**: Cache verified proofs by hash

### Scaling

```typescript
// Use worker threads for parallel verification
import { Worker } from 'worker_threads'

class TLSNotaryVerifierPool {
  private workers: Worker[]
  
  async verify(proof: TLSNotaryProof): Promise<VerifiedData> {
    const worker = this.getAvailableWorker()
    return new Promise((resolve, reject) => {
      worker.postMessage({ proof })
      worker.once('message', resolve)
      worker.once('error', reject)
    })
  }
}
```

## Current Demo vs Real Implementation

| Aspect | Current Demo | Real Implementation |
|--------|-------------|---------------------|
| Verification | Mock (always returns true) | Cryptographic proof verification |
| Proof Format | Simplified JSON | TLS Notary Presentation format |
| Security | None (for demo only) | Full MPC-TLS security guarantees |
| Dependencies | TypeScript only | Rust + WASM |
| Performance | Instant | 50-200ms per proof |
| Size | <1KB | ~500KB-1MB WASM |

## Next Steps

1. ✅ **Current**: Mock implementation working (demo/testing)
2. ⏳ **Phase 1**: Add Rust workspace with `tlsn` dependency
3. ⏳ **Phase 2**: Compile TLS Notary verifier to WASM
4. ⏳ **Phase 3**: Integrate WASM verifier with WasmActivityExecutor
5. ⏳ **Phase 4**: Test with real proofs from tlsnotary.org demo
6. ⏳ **Phase 5**: Production deployment with proper key management

## Resources

- **Main Repository**: https://github.com/tlsnotary/tlsn
- **Documentation**: https://tlsnotary.org/docs
- **Demo**: https://demo.tlsnotary.org
- **Chrome Extension**: https://github.com/tlsnotary/tlsn-extension
- **JS Library**: https://github.com/tlsnotary/tlsn-js
- **Examples**: https://github.com/tlsnotary/tlsn/tree/main/crates/examples

## Example: Real Verification Flow

```typescript
// 1. User generates proof with TLS Notary extension
// 2. User submits proof to Loom application

// 3. Loom verifies the proof
const actor = new TLSNotaryActor(context)

// Load real WASM verifier
const verifier = await WasmActivityExecutor.load('tlsn-verifier.wasm')

// Verify proof using real cryptography
const result = await verifier.execute({
  proof: presentation,
  notaryPublicKey: process.env.NOTARY_PUBLIC_KEY
})

if (result.verified) {
  // Extract proven data
  const bankBalance = JSON.parse(result.transcript.received).balance
  
  // Use in loan decision
  if (bankBalance >= loanAmount * 0.2) {
    approveLoan()
  }
}
```

---

**Status**: The current implementation is a **working demo** that shows the workflow. To use real TLS Notary, follow the integration steps above to compile the Rust library to WASM and integrate with Loom's existing WASM infrastructure.
