/**
 * TLS Notary Integration for Loom
 * 
 * Provides cryptographic verification of data provenance using TLS Notary proofs
 * 
 * Quick Start:
 * 
 * ```typescript
 * import { createVerifier } from './tlsnotary'
 * 
 * // Create verifier (auto-selects WASM or Mock)
 * const verifier = await createVerifier()
 * 
 * // Verify a TLS Notary presentation
 * const verified = await verifier.verify(presentation)
 * 
 * console.log('Data from:', verified.server_name)
 * console.log('Data:', verified.data)
 * ```
 * 
 * Documentation: docs/tlsnotary/README.md
 */

import { MockTLSNotaryVerifier } from './mock-verifier'
import { WasmTLSNotaryVerifier } from './wasm-verifier'
import type { TLSNotaryVerifier, VerifierOptions } from './types'

// Re-export types
export type {
  TLSNotaryPresentation,
  SessionHeader,
  HandshakeSummary,
  ServerSignature,
  NotarySignature,
  SessionData,
  TranscriptData,
  MerkleProof,
  VerifiedData,
  TLSNotaryVerifier,
  VerifierInfo,
  VerifierOptions
} from './types'

// Re-export implementations
export { MockTLSNotaryVerifier } from './mock-verifier'
export { WasmTLSNotaryVerifier } from './wasm-verifier'

/**
 * Create TLS Notary verifier
 * 
 * Automatically uses WASM verifier if available, falls back to mock
 * 
 * @param options Verifier options
 * @returns TLS Notary verifier instance
 * 
 * @example
 * ```typescript
 * // Auto-select (prefers WASM)
 * const verifier = await createVerifier()
 * 
 * // Force mock for testing
 * const mockVerifier = await createVerifier({ preferMock: true })
 * 
 * // With trusted notaries
 * const verifier = await createVerifier({
 *   trustedNotaries: ['notary_pubkey_1', 'notary_pubkey_2']
 * })
 * 
 * // With proof age limit
 * const verifier = await createVerifier({
 *   maxProofAge: 24 * 60 * 60 * 1000  // 24 hours
 * })
 * ```
 */
export async function createVerifier(options: VerifierOptions = {}): Promise<TLSNotaryVerifier> {
  // Force mock if requested
  if (options.preferMock) {
    console.log('📝 [TLSNotary] Using MockTLSNotaryVerifier (explicitly requested)')
    return new MockTLSNotaryVerifier(options)
  }
  
  // Try to load WASM verifier
  try {
    const verifier = new WasmTLSNotaryVerifier(options)
    await verifier.initialize()
    return verifier
  } catch (error) {
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.warn('📝 [TLSNotary] WASM verifier not available')
    console.warn('   Falling back to MockTLSNotaryVerifier')
    console.warn('   ')
    console.warn('   To use real verification:')
    console.warn('   1. Install Rust: https://rustup.rs/')
    console.warn('   2. Run: npm run build:tlsn')
    console.warn('   3. See: docs/tlsnotary/IMPLEMENTATION.md')
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    return new MockTLSNotaryVerifier(options)
  }
}

/**
 * Singleton verifier instance
 * 
 * Useful for sharing a single verifier across multiple actors
 */
let sharedVerifier: TLSNotaryVerifier | null = null

/**
 * Get shared verifier instance
 * 
 * Creates and initializes a verifier on first call, reuses on subsequent calls
 * 
 * @param options Verifier options (only used on first call)
 * @returns Shared verifier instance
 */
export async function getSharedVerifier(options: VerifierOptions = {}): Promise<TLSNotaryVerifier> {
  if (!sharedVerifier) {
    sharedVerifier = await createVerifier(options)
  }
  return sharedVerifier
}

/**
 * Reset shared verifier
 * 
 * Useful for testing or when changing configuration
 */
export function resetSharedVerifier(): void {
  sharedVerifier = null
}
