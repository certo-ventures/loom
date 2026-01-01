/**
 * TLS Notary Actor Base Class
 * 
 * Provides TLS Notary verification capabilities to actors
 * 
 * Usage:
 * 
 * ```typescript
 * class MyActor extends TLSNotaryActor {
 *   async execute(input: { proof: TLSNotaryPresentation }) {
 *     // Verify proof
 *     const verified = await this.verifyPresentation(input.proof)
 *     
 *     // Use verified data
 *     console.log('Data from:', verified.server_name)
 *     return verified.data
 *   }
 * }
 * ```
 */

import { Actor } from './actor'
import type { ActorContext } from './journal'
import type { 
  TLSNotaryVerifier, 
  TLSNotaryPresentation, 
  VerifiedData,
  VerifierOptions 
} from '../tlsnotary'
import { createVerifier } from '../tlsnotary'

/**
 * Base class for actors that verify TLS Notary proofs
 * 
 * Provides:
 * - Automatic verifier initialization
 * - Proof verification
 * - Audit trail (proof history)
 * - Replay attack prevention
 */
export abstract class TLSNotaryActor extends Actor {
  protected verifier: TLSNotaryVerifier | null = null
  protected proofHistory: Map<string, { timestamp: number; server_name: string }> = new Map()
  
  constructor(context: ActorContext) {
    super(context)
  }
  
  /**
   * Initialize TLS Notary verifier
   * 
   * @param options Verifier options
   */
  async initializeVerifier(options: VerifierOptions = {}) {
    if (!this.verifier) {
      // Import createVerifier from production module
      const { createVerifier: createProductionVerifier } = await import('../tlsnotary/production')
      this.verifier = await createProductionVerifier({
        mode: (options as any).mode || 'development',
        allowMock: (options as any).allowMock,
        trustedNotaries: options.trustedNotaries,
        maxPresentationAge: (options as any).maxPresentationAge,
      })
      const info = this.verifier.getInfo()
      console.log(`✅ [TLSNotaryActor] Verifier initialized: ${info.type} v${info.version}`)
    }
  }
  
  /**
   * Verify a TLS Notary presentation
   * 
   * This performs:
   * - Full cryptographic verification (if WASM available)
   * - Replay attack prevention
   * - Audit trail recording
   * 
   * @param presentation TLS Notary presentation to verify
   * @returns Verified data
   * @throws Error if verification fails or proof is replayed
   */
  async verifyPresentation(presentation: TLSNotaryPresentation): Promise<VerifiedData> {
    // Initialize verifier if needed
    if (!this.verifier) {
      await this.initializeVerifier()
    }
    
    // Verify the proof
    const verified = await this.verifier!.verify(presentation)
    
    // Check for replay attack
    if (this.proofHistory.has(verified.proof_hash)) {
      const previous = this.proofHistory.get(verified.proof_hash)!
      throw new Error(
        `Proof already used (replay attack detected). ` +
        `Originally verified at ${new Date(previous.timestamp).toISOString()} ` +
        `for ${previous.server_name}`
      )
    }
    
    // Record in audit trail
    this.proofHistory.set(verified.proof_hash, {
      timestamp: Date.now(),
      server_name: verified.server_name
    })
    
    return verified
  }
  
  /**
   * Get proof history (audit trail)
   * 
   * @returns Array of verified proofs with timestamps
   */
  getProofHistory(): Array<{ proof_hash: string; timestamp: number; server_name: string }> {
    return Array.from(this.proofHistory.entries()).map(([proof_hash, info]) => ({
      proof_hash,
      ...info
    }))
  }
  
  /**
   * Clear proof history
   * 
   * Use with caution - removes replay attack protection
   */
  clearProofHistory(): void {
    this.proofHistory.clear()
  }
}

/**
 * Example: Simple verification actor
 * 
 * Verifies a TLS Notary proof and returns the data
 * 
 * NOTE: Experimental - TLS Notary integration incomplete
 */
// @ts-ignore - TLSNotaryActor generic type issue
export class SimpleVerificationActor extends TLSNotaryActor<{ lastVerified: VerifiedData | null }> {
  private state = { lastVerified: null as VerifiedData | null }
  
  async execute(input: { proof: TLSNotaryPresentation }): Promise<VerifiedData> {
    // @ts-ignore - verifyPresentation method incomplete
    const verified = await this.verifyPresentation(input.proof)
    this.state.lastVerified = verified
    return verified
  }
  
  getState() {
    return this.state
  }
  
  setState(state: { lastVerified: VerifiedData | null }) {
    this.state = state
  }
}

/**
 * Example: Data aggregation actor
 * 
 * Collects verified data from multiple sources
 * 
 * NOTE: Experimental - TLS Notary integration incomplete
 */
// @ts-ignore - TLSNotaryActor generic type issue
export class AggregatorActor extends TLSNotaryActor<{ verifiedData: Map<string, VerifiedData> }> {
  private state = { verifiedData: new Map<string, VerifiedData>() }
  
  async execute(input: { 
    action: 'add-proof' | 'get-data' | 'get-all',
    proof?: TLSNotaryPresentation,
    server?: string
  }): Promise<any> {
    if (input.action === 'add-proof' && input.proof) {
      // @ts-ignore - verifyPresentation method incomplete
      const verified = await this.verifyPresentation(input.proof)
      this.state.verifiedData.set(verified.server_name, verified)
      return { added: verified.server_name }
    }
    
    if (input.action === 'get-data' && input.server) {
      return this.state.verifiedData.get(input.server) || null
    }
    
    if (input.action === 'get-all') {
      return Array.from(this.state.verifiedData.entries()).map(([server, data]) => ({
        server,
        timestamp: data.timestamp,
        data: data.data
      }))
    }
    
    throw new Error(`Unknown action: ${input.action}`)
  }
  
  getState() {
    return this.state
  }
  
  setState(state: { verifiedData: Map<string, VerifiedData> }) {
    this.state = state
  }
}
