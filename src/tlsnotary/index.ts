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
 * // Create verifier with production validation
 * const verifier = await createVerifier({ 
 *   mode: 'production',
 *   allowMock: false 
 * })
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
import { createVerifier as createProductionVerifier } from './production'
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

// Re-export production utilities
export { 
  createVerifier, 
  healthCheck, 
  validateProductionReadiness,
  getVerifierInfo,
  loadTLSNotaryConfigFromEnv,
  ProductionReadinessError
} from './production'
export type { TLSNotaryConfig, HealthCheckResult } from './production'

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
    // Convert VerifierOptions to TLSNotaryConfig
    sharedVerifier = await createProductionVerifier({
      mode: (options as any).mode || 'development',
      allowMock: (options as any).allowMock,
      trustedNotaries: options.trustedNotaries,
      maxPresentationAge: (options as any).maxPresentationAge,
    })
  }
  return sharedVerifier!
}

/**
 * Reset shared verifier
 * 
 * Useful for testing or when changing configuration
 */
export function resetSharedVerifier(): void {
  sharedVerifier = null
}
