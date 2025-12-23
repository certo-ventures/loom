# TLS Notary Implementation Guide for Loom

**Last Updated:** December 18, 2024  
**Target:** Loom Actor Framework Integration

## Implementation Strategy

### Two-Phase Approach

#### Phase 1: TypeScript Integration Layer (Immediate)
**What:** Actor abstractions, workflow orchestration, mock verification  
**Timeline:** 1-2 days  
**Status:** Can implement now

#### Phase 2: Rust WASM Verifier (Future)
**What:** Real cryptographic verification  
**Timeline:** 2-4 hours (with Rust knowledge)  
**Status:** Needs Rust developer or later implementation

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Loom Application                          │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         TLSNotaryVerifier (Interface)              │    │
│  │  - verify(presentation): Promise<VerifiedData>     │    │
│  │  - validateStructure(presentation): void           │    │
│  └─────┬──────────────────────────────┬────────────────┘    │
│        │                              │                     │
│        ▼                              ▼                     │
│  ┌──────────────┐           ┌──────────────────┐          │
│  │ MockVerifier │           │  WasmVerifier    │          │
│  │ (Dev/Demo)   │           │ (Production)     │          │
│  │              │           │                  │          │
│  │ Returns true │           │ Loads Rust WASM  │          │
│  │ with warning │           │ Real crypto      │          │
│  └──────────────┘           └────────┬─────────┘          │
│                                      │                     │
│                                      ▼                     │
│                            ┌──────────────────┐           │
│                            │ tlsn-verifier    │           │
│                            │ (Rust WASM)      │           │
│                            │                  │           │
│                            │ ✓ Signature      │           │
│                            │ ✓ Certificates   │           │
│                            │ ✓ Commitments    │           │
│                            └──────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

## Phase 1: TypeScript Integration Layer

### 1.1 Core Interfaces

```typescript
// src/tlsnotary/types.ts

/**
 * TLS Notary Presentation
 * 
 * Based on actual tlsn crate structure
 */
export interface TLSNotaryPresentation {
  version: string
  
  // Session header signed by notary
  header: {
    // Encoder commitment to transcript
    encoder_seed: string
    
    // Merkle root of commitments
    merkle_root: string
    
    // Sent/received data ranges
    sent_len: number
    recv_len: number
    
    // Connection info
    handshake_summary: {
      time: number
      server_name: string
      signature: ServerSignature
    }
  }
  
  // Notary's signature over session header
  signature: NotarySignature
  
  // Revealed transcript data with commitments
  session: {
    // Partially revealed data
    sent: {
      cleartext: Uint8Array
      commitments: MerkleProof[]
    }
    recv: {
      cleartext: Uint8Array
      commitments: MerkleProof[]
    }
  }
}

export interface ServerSignature {
  algorithm: string      // e.g., "secp256k1", "secp256r1"
  signature: string      // Hex-encoded
  cert_chain: string[]   // PEM-encoded certificates
}

export interface NotarySignature {
  algorithm: string
  signature: string
  public_key: string     // Notary's public key
}

export interface MerkleProof {
  index: number
  path: string[]         // Sibling hashes in Merkle tree
}

/**
 * Verified data result
 */
export interface VerifiedData {
  verified: boolean
  server_name: string
  timestamp: number
  
  // Extracted data from revealed transcript
  data: {
    method: string       // HTTP method
    url: string          // Full URL
    headers: Record<string, string>
    body: any            // Parsed JSON or raw string
  }
  
  // Audit information
  proof_hash: string     // Hash of presentation for audit trail
  notary_pubkey: string
  redacted_ranges?: Array<[number, number]>  // Byte ranges that were redacted
}

/**
 * Verifier interface
 */
export interface TLSNotaryVerifier {
  /**
   * Verify a TLS Notary presentation
   */
  verify(presentation: TLSNotaryPresentation): Promise<VerifiedData>
  
  /**
   * Validate presentation structure (syntax check)
   */
  validateStructure(presentation: TLSNotaryPresentation): void
  
  /**
   * Get verifier info
   */
  getInfo(): {
    type: 'mock' | 'wasm'
    version: string
    ready: boolean
  }
}
```

### 1.2 Mock Verifier Implementation

```typescript
// src/tlsnotary/mock-verifier.ts

import type { TLSNotaryVerifier, TLSNotaryPresentation, VerifiedData } from './types'
import crypto from 'crypto'

/**
 * Mock TLS Notary Verifier
 * 
 * ⚠️  FOR DEVELOPMENT/DEMO ONLY
 * 
 * This implementation:
 * - Validates presentation structure
 * - Extracts data from revealed transcript
 * - Returns successful verification (WITHOUT cryptographic checks)
 * 
 * For production, replace with WasmVerifier
 */
export class MockTLSNotaryVerifier implements TLSNotaryVerifier {
  getInfo() {
    return {
      type: 'mock' as const,
      version: '0.1.0-mock',
      ready: true
    }
  }
  
  validateStructure(presentation: TLSNotaryPresentation): void {
    if (!presentation.version) throw new Error('Missing version')
    if (!presentation.header) throw new Error('Missing session header')
    if (!presentation.signature) throw new Error('Missing notary signature')
    if (!presentation.session) throw new Error('Missing session data')
    if (!presentation.header.handshake_summary) throw new Error('Missing handshake summary')
  }
  
  async verify(presentation: TLSNotaryPresentation): Promise<VerifiedData> {
    console.warn('⚠️  [MockTLSNotaryVerifier] Using MOCK verification - NOT cryptographically secure')
    console.warn('   For production, use WasmVerifier with compiled Rust module')
    
    // Validate structure
    this.validateStructure(presentation)
    
    // Extract server information
    const { server_name, time } = presentation.header.handshake_summary
    
    // Parse HTTP data from revealed transcript
    const httpData = this.parseHTTPTranscript(
      presentation.session.recv.cleartext
    )
    
    // Generate proof hash for audit trail
    const proofHash = this.hashPresentation(presentation)
    
    console.log('✅ [MockTLSNotaryVerifier] Verification successful (MOCK)')
    console.log(`   Server: ${server_name}`)
    console.log(`   Time: ${new Date(time * 1000).toISOString()}`)
    console.log(`   Proof Hash: ${proofHash}`)
    
    return {
      verified: true,
      server_name,
      timestamp: time,
      data: httpData,
      proof_hash: proofHash,
      notary_pubkey: presentation.signature.public_key
    }
  }
  
  private parseHTTPTranscript(data: Uint8Array): any {
    // Convert bytes to string
    const text = new TextDecoder().decode(data)
    
    // Simple HTTP response parser
    const lines = text.split('\r\n')
    const headers: Record<string, string> = {}
    let bodyStart = 0
    
    // Parse headers
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (line === '') {
        bodyStart = i + 1
        break
      }
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim()
        const value = line.slice(colonIdx + 1).trim()
        headers[key] = value
      }
    }
    
    // Extract body
    const body = lines.slice(bodyStart).join('\r\n')
    
    // Try to parse as JSON
    let parsedBody: any
    try {
      parsedBody = JSON.parse(body)
    } catch {
      parsedBody = body
    }
    
    return {
      method: 'GET',  // Would be in request part (sent)
      url: headers['Host'] || 'unknown',
      headers,
      body: parsedBody
    }
  }
  
  private hashPresentation(presentation: TLSNotaryPresentation): string {
    const json = JSON.stringify(presentation)
    return crypto.createHash('sha256').update(json).digest('hex')
  }
}
```

### 1.3 WASM Verifier (Stub for Future)

```typescript
// src/tlsnotary/wasm-verifier.ts

import type { TLSNotaryVerifier, TLSNotaryPresentation, VerifiedData } from './types'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * WASM TLS Notary Verifier
 * 
 * Production implementation using Rust WASM module
 * 
 * Requires:
 * - build/tlsn/tlsn_verifier_bg.wasm (compiled Rust)
 * - build/tlsn/tlsn_verifier.js (wasm-bindgen output)
 */
export class WasmTLSNotaryVerifier implements TLSNotaryVerifier {
  private wasmInstance: any
  private ready = false
  
  async initialize() {
    try {
      // Load WASM module
      const wasmPath = join(process.cwd(), 'build/tlsn/tlsn_verifier_bg.wasm')
      const wasmBuffer = readFileSync(wasmPath)
      
      // Import wasm-bindgen generated JS
      const { default: init, verify_presentation } = await import('../../build/tlsn/tlsn_verifier.js')
      
      // Initialize WASM
      await init(wasmBuffer)
      
      this.wasmInstance = { verify_presentation }
      this.ready = true
      
      console.log('✅ [WasmTLSNotaryVerifier] Loaded real Rust verifier')
    } catch (error) {
      console.error('❌ [WasmTLSNotaryVerifier] Failed to load WASM module:', error)
      throw new Error('WASM verifier not available. Run `npm run build:tlsn` or use MockVerifier')
    }
  }
  
  getInfo() {
    return {
      type: 'wasm' as const,
      version: '0.1.0',
      ready: this.ready
    }
  }
  
  validateStructure(presentation: TLSNotaryPresentation): void {
    if (!presentation.version) throw new Error('Missing version')
    if (!presentation.header) throw new Error('Missing session header')
    if (!presentation.signature) throw new Error('Missing notary signature')
    if (!presentation.session) throw new Error('Missing session data')
  }
  
  async verify(presentation: TLSNotaryPresentation): Promise<VerifiedData> {
    if (!this.ready) {
      throw new Error('WASM verifier not initialized. Call initialize() first')
    }
    
    this.validateStructure(presentation)
    
    // Call Rust WASM function
    // This does REAL cryptographic verification:
    // - Verify notary signature (secp256k1/secp256r1)
    // - Verify server certificate chain
    // - Verify Merkle proofs for commitments
    // - Verify transcript hash matches commitments
    const resultJson = this.wasmInstance.verify_presentation(
      JSON.stringify(presentation)
    )
    
    const result = JSON.parse(resultJson)
    
    if (!result.valid) {
      throw new Error(`TLS Notary verification failed: ${result.error}`)
    }
    
    console.log('✅ [WasmTLSNotaryVerifier] Cryptographic verification successful')
    
    return {
      verified: true,
      server_name: result.server_name,
      timestamp: result.time,
      data: result.data,
      proof_hash: result.proof_hash,
      notary_pubkey: result.notary_pubkey,
      redacted_ranges: result.redacted_ranges
    }
  }
}
```

### 1.4 Verifier Factory

```typescript
// src/tlsnotary/index.ts

import { MockTLSNotaryVerifier } from './mock-verifier'
import { WasmTLSNotaryVerifier } from './wasm-verifier'
import type { TLSNotaryVerifier } from './types'

export * from './types'
export { MockTLSNotaryVerifier } from './mock-verifier'
export { WasmTLSNotaryVerifier } from './wasm-verifier'

/**
 * Create TLS Notary verifier
 * 
 * Automatically uses WASM verifier if available, falls back to mock
 */
export async function createVerifier(options?: {
  preferMock?: boolean
}): Promise<TLSNotaryVerifier> {
  // Force mock if requested
  if (options?.preferMock) {
    console.warn('📝 Using MockTLSNotaryVerifier (explicitly requested)')
    return new MockTLSNotaryVerifier()
  }
  
  // Try to load WASM verifier
  try {
    const verifier = new WasmTLSNotaryVerifier()
    await verifier.initialize()
    return verifier
  } catch (error) {
    console.warn('📝 WASM verifier not available, using MockTLSNotaryVerifier')
    console.warn('   To use real verification, build Rust WASM module:')
    console.warn('   $ npm run build:tlsn')
    return new MockTLSNotaryVerifier()
  }
}
```

## Phase 2: Rust WASM Module

### 2.1 Rust Workspace Setup

```bash
# Create Rust workspace
mkdir -p rust/tlsn-verifier/src
cd rust/tlsn-verifier
```

```toml
# rust/tlsn-verifier/Cargo.toml
[package]
name = "tlsn-verifier"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
tlsn-core = "0.1"
wasm-bindgen = "0.2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
getrandom = { version = "0.2", features = ["js"] }

[profile.release]
opt-level = "z"     # Optimize for size
lto = true          # Link-time optimization
codegen-units = 1   # Better optimization
```

### 2.2 Rust Verifier Implementation

```rust
// rust/tlsn-verifier/src/lib.rs

use tlsn_core::presentation::Presentation;
use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct VerificationResult {
    valid: bool,
    server_name: String,
    time: u64,
    data: serde_json::Value,
    proof_hash: String,
    notary_pubkey: String,
    redacted_ranges: Option<Vec<(usize, usize)>>,
    error: Option<String>,
}

#[wasm_bindgen]
pub fn verify_presentation(presentation_json: &str) -> Result<String, JsValue> {
    // Parse presentation
    let presentation: Presentation = serde_json::from_str(presentation_json)
        .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;
    
    // Create crypto provider
    let provider = tlsn_core::CryptoProvider::default();
    
    // Verify presentation cryptographically
    match presentation.verify(&provider) {
        Ok(output) => {
            // Extract HTTP data from transcript
            let data = parse_http_response(&output.recv_transcript);
            
            // Calculate proof hash
            let proof_hash = calculate_hash(presentation_json);
            
            let result = VerificationResult {
                valid: true,
                server_name: output.server_name,
                time: output.time,
                data,
                proof_hash,
                notary_pubkey: hex::encode(output.notary_pubkey),
                redacted_ranges: Some(output.redacted_ranges),
                error: None,
            };
            
            Ok(serde_json::to_string(&result).unwrap())
        }
        Err(e) => {
            let result = VerificationResult {
                valid: false,
                server_name: String::new(),
                time: 0,
                data: serde_json::Value::Null,
                proof_hash: String::new(),
                notary_pubkey: String::new(),
                redacted_ranges: None,
                error: Some(format!("Verification failed: {}", e)),
            };
            
            Ok(serde_json::to_string(&result).unwrap())
        }
    }
}

fn parse_http_response(transcript: &[u8]) -> serde_json::Value {
    // Parse HTTP response
    let text = String::from_utf8_lossy(transcript);
    
    // Simple parser - find JSON body
    if let Some(body_start) = text.find("\r\n\r\n") {
        let body = &text[body_start + 4..];
        if let Ok(json) = serde_json::from_str(body) {
            return json;
        }
    }
    
    serde_json::Value::String(text.to_string())
}

fn calculate_hash(data: &str) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}
```

### 2.3 Build Commands

```bash
# Install Rust targets
rustup target add wasm32-unknown-unknown

# Install wasm-bindgen CLI
cargo install wasm-bindgen-cli

# Build WASM module
cargo build --target wasm32-unknown-unknown --release

# Generate JS bindings
wasm-bindgen \
  target/wasm32-unknown-unknown/release/tlsn_verifier.wasm \
  --out-dir ../../build/tlsn \
  --target nodejs

# Output files:
# - build/tlsn/tlsn_verifier_bg.wasm (WASM binary)
# - build/tlsn/tlsn_verifier.js (JS bindings)
# - build/tlsn/tlsn_verifier.d.ts (TypeScript types)
```

### 2.4 Package.json Scripts

```json
{
  "scripts": {
    "build:tlsn": "cd rust/tlsn-verifier && cargo build --target wasm32-unknown-unknown --release && wasm-bindgen target/wasm32-unknown-unknown/release/tlsn_verifier.wasm --out-dir ../../build/tlsn --target nodejs",
    "test:tlsn": "npx tsx examples/test-tlsn-verifier.ts"
  }
}
```

## Integration with Loom Actors

### Actor Base Class

```typescript
// src/actor/tlsnotary-actor.ts

import type { Actor, ActorContext } from './journal'
import type { TLSNotaryVerifier, TLSNotaryPresentation, VerifiedData } from '../tlsnotary'
import { createVerifier } from '../tlsnotary'

/**
 * Base class for actors that verify TLS Notary proofs
 */
export abstract class TLSNotaryActor<TState = any> implements Actor {
  protected verifier: TLSNotaryVerifier | null = null
  
  constructor(protected context: ActorContext) {}
  
  /**
   * Initialize TLS Notary verifier
   */
  async initializeVerifier(preferMock = false) {
    if (!this.verifier) {
      this.verifier = await createVerifier({ preferMock })
      const info = this.verifier.getInfo()
      console.log(`✅ [TLSNotaryActor] Verifier initialized: ${info.type} v${info.version}`)
    }
  }
  
  /**
   * Verify a TLS Notary presentation
   */
  async verifyPresentation(presentation: TLSNotaryPresentation): Promise<VerifiedData> {
    if (!this.verifier) {
      await this.initializeVerifier()
    }
    
    return this.verifier!.verify(presentation)
  }
  
  abstract execute(input: any): Promise<any>
  abstract getState(): TState
  abstract setState(state: TState): void
}
```

## Testing Strategy

### Unit Tests

```typescript
// tests/tlsnotary/mock-verifier.test.ts

import { describe, it, expect } from 'vitest'
import { MockTLSNotaryVerifier } from '../src/tlsnotary/mock-verifier'

describe('MockTLSNotaryVerifier', () => {
  it('should validate presentation structure', () => {
    const verifier = new MockTLSNotaryVerifier()
    
    expect(() => {
      verifier.validateStructure({} as any)
    }).toThrow('Missing version')
  })
  
  it('should verify valid presentation', async () => {
    const verifier = new MockTLSNotaryVerifier()
    
    const presentation = {
      version: '0.1.0',
      header: {
        encoder_seed: 'seed',
        merkle_root: 'root',
        sent_len: 100,
        recv_len: 200,
        handshake_summary: {
          time: Date.now() / 1000,
          server_name: 'api.example.com',
          signature: {
            algorithm: 'secp256k1',
            signature: 'sig',
            cert_chain: []
          }
        }
      },
      signature: {
        algorithm: 'secp256k1',
        signature: 'notary_sig',
        public_key: 'notary_pubkey'
      },
      session: {
        sent: { cleartext: new Uint8Array(), commitments: [] },
        recv: { cleartext: new TextEncoder().encode('HTTP/1.1 200 OK\r\n\r\n{"data":"test"}'), commitments: [] }
      }
    }
    
    const result = await verifier.verify(presentation)
    
    expect(result.verified).toBe(true)
    expect(result.server_name).toBe('api.example.com')
  })
})
```

## Documentation

- [x] [OVERVIEW.md](./OVERVIEW.md) - TLS Notary explanation
- [x] [IMPLEMENTATION.md](./IMPLEMENTATION.md) - This file
- [ ] ARCHITECTURE.md - Design decisions for Loom
- [ ] EXAMPLES.md - Usage examples
- [ ] API.md - API reference

## Next Steps

1. ✅ Implement TypeScript integration layer (Phase 1)
2. ⏳ Create example actors using TLS Notary
3. ⏳ Implement Rust WASM verifier (Phase 2) - requires Rust expertise
4. ⏳ Add integration tests with real presentations
5. ⏳ Document common use cases
