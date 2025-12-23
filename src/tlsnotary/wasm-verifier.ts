/**
 * WASM TLS Notary Verifier
 * 
 * Production implementation using Rust WASM module
 * 
 * ⚠️  REQUIRES:
 * - build/tlsn/tlsn_verifier_bg.wasm (compiled Rust)
 * - build/tlsn/tlsn_verifier.js (wasm-bindgen output)
 * 
 * To build:
 *   npm run build:tlsn
 * 
 * See: docs/tlsnotary/IMPLEMENTATION.md for Rust implementation
 */

import type { TLSNotaryVerifier, TLSNotaryPresentation, VerifiedData, VerifierInfo, VerifierOptions } from './types'
import { readFileSync } from 'fs'
import { join } from 'path'

export class WasmTLSNotaryVerifier implements TLSNotaryVerifier {
  private wasmInstance: any
  private ready = false
  private options: VerifierOptions
  
  constructor(options: VerifierOptions = {}) {
    this.options = options
  }
  
  /**
   * Initialize the WASM verifier
   * 
   * This loads the Rust WASM module and prepares it for verification
   */
  async initialize() {
    try {
      // Load WASM binary
      const wasmPath = join(process.cwd(), 'build/tlsn/tlsn_verifier_bg.wasm')
      const wasmBuffer = readFileSync(wasmPath)
      
      // Import wasm-bindgen generated JS module
      // @ts-ignore - Dynamic import of WASM module (built separately)
      const wasmModule = await import('../../build/tlsn/tlsn_verifier.js')
      // @ts-ignore - WASM module exports incomplete
      const { default: init, verify_presentation } = wasmModule
      
      // Initialize WASM with buffer (Node.js requires explicit buffer)
      // @ts-ignore - WASM init signature issue
      await init(wasmBuffer)
      
      this.wasmInstance = { verify_presentation }
      this.ready = true
      console.log('✅ [WasmTLSNotaryVerifier] Loaded real Rust verifier')
      console.log('   Cryptographic verification enabled')
    } catch (error: any) {
      console.error('❌ [WasmTLSNotaryVerifier] Failed to load WASM module')
      console.error('   Error:', error.message)
      console.error('')
      console.error('   To build the WASM module:')
      console.error('     1. Install Rust: https://rustup.rs/')
      console.error('     2. Run: npm run build:tlsn')
      console.error('     3. See: docs/tlsnotary/IMPLEMENTATION.md')
      console.error('')
      console.error('   For development, use MockVerifier instead:')
      console.error('     const verifier = await createVerifier({ preferMock: true })')
      throw new Error('WASM verifier not available. Run `npm run build:tlsn` or use MockVerifier')
    }
  }
  
  getInfo(): VerifierInfo {
    return {
      type: 'wasm',
      version: '0.1.0',
      ready: this.ready
    }
  }
  
  validateStructure(presentation: TLSNotaryPresentation): void {
    if (!presentation.version) {
      throw new Error('Missing presentation version')
    }
    if (!presentation.header) {
      throw new Error('Missing session header')
    }
    if (!presentation.signature) {
      throw new Error('Missing notary signature')
    }
    if (!presentation.session) {
      throw new Error('Missing session data')
    }
  }
  
  async verify(presentation: TLSNotaryPresentation): Promise<VerifiedData> {
    if (!this.ready) {
      throw new Error('WASM verifier not initialized. Call initialize() first')
    }
    
    // Validate structure
    this.validateStructure(presentation)
    
    // Check trusted notaries if configured
    if (this.options.trustedNotaries && this.options.trustedNotaries.length > 0) {
      if (!this.options.trustedNotaries.includes(presentation.signature.public_key)) {
        throw new Error(`Notary public key not trusted: ${presentation.signature.public_key}`)
      }
    }
    
    console.log('🔍 [WasmTLSNotaryVerifier] Starting cryptographic verification...')
    
    // Call Rust WASM function
    // This performs REAL cryptographic verification:
    // - Verify notary signature (secp256k1/secp256r1/ed25519)
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
    
    // Check proof age if configured
    if (this.options.maxProofAge) {
      const age = Date.now() - result.time * 1000
      if (age > this.options.maxProofAge) {
        throw new Error(`Proof too old: ${Math.floor(age / 1000)}s (max: ${Math.floor(this.options.maxProofAge / 1000)}s)`)
      }
    }
    
    console.log('✅ [WasmTLSNotaryVerifier] Cryptographic verification successful')
    console.log(`   Server: ${result.server_name}`)
    console.log(`   Time: ${new Date(result.time * 1000).toISOString()}`)
    console.log(`   Notary: ${result.notary_pubkey.slice(0, 16)}...`)
    
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
