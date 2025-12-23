/**
 * TLS Notary Types
 * 
 * Based on tlsn-core crate structures
 * See: https://github.com/tlsnotary/tlsn
 */

/**
 * TLS Notary Presentation
 * 
 * The complete proof package that can be verified
 */
export interface TLSNotaryPresentation {
  version: string
  
  // Session header signed by notary
  header: SessionHeader
  
  // Notary's signature over session header
  signature: NotarySignature
  
  // Server identity proof
  server_name: string
  server_cert_chain: string[]  // PEM-encoded certificates
  
  // Revealed transcript data with commitments
  session: SessionData
}

/**
 * Session header - what the notary signs
 */
export interface SessionHeader {
  // Encoder commitment to transcript
  encoder_seed: string
  
  // Merkle root of commitments
  merkle_root: string
  
  // Sent/received data lengths
  sent_len: number
  recv_len: number
  
  // Connection info
  handshake_summary: HandshakeSummary
}

/**
 * Handshake summary
 */
export interface HandshakeSummary {
  time: number              // Unix timestamp
  server_name: string
  signature: ServerSignature
}

/**
 * Server signature (ephemeral key)
 */
export interface ServerSignature {
  algorithm: string         // e.g., "secp256k1", "secp256r1"
  signature: string         // Hex-encoded
  cert_chain: string[]      // PEM-encoded certificates
}

/**
 * Notary signature
 */
export interface NotarySignature {
  algorithm: string         // e.g., "secp256k1", "ed25519"
  signature: string         // Hex-encoded
  public_key: string        // Notary's public key (hex)
}

/**
 * Session data with revealed transcript portions
 */
export interface SessionData {
  sent: TranscriptData
  recv: TranscriptData
}

/**
 * Transcript data with Merkle proofs
 */
export interface TranscriptData {
  cleartext: Uint8Array
  commitments: MerkleProof[]
}

/**
 * Merkle proof for transcript chunk
 */
export interface MerkleProof {
  index: number
  path: string[]            // Sibling hashes
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
    method: string          // HTTP method
    url: string             // Full URL
    headers: Record<string, string>
    body: any               // Parsed JSON or raw string
  }
  
  // Audit information
  proof_hash: string        // Hash of presentation for audit trail
  notary_pubkey: string
  redacted_ranges?: Array<[number, number]>  // Byte ranges that were redacted
}

/**
 * Verifier interface
 */
export interface TLSNotaryVerifier {
  /**
   * Verify a TLS Notary presentation
   * 
   * This performs full cryptographic verification:
   * - Notary signature validation
   * - Certificate chain verification
   * - Merkle proof validation
   * - Transcript commitment verification
   * 
   * @throws Error if verification fails
   */
  verify(presentation: TLSNotaryPresentation): Promise<VerifiedData>
  
  /**
   * Validate presentation structure (syntax check only)
   * 
   * @throws Error if structure is invalid
   */
  validateStructure(presentation: TLSNotaryPresentation): void
  
  /**
   * Get verifier information
   */
  getInfo(): VerifierInfo
}

/**
 * Verifier information
 */
export interface VerifierInfo {
  type: 'mock' | 'wasm'
  version: string
  ready: boolean
}

/**
 * Verifier options
 */
export interface VerifierOptions {
  /**
   * Prefer mock verifier even if WASM is available
   * (useful for testing)
   */
  preferMock?: boolean
  
  /**
   * Trusted notary public keys (hex-encoded)
   * If provided, only proofs from these notaries are accepted
   */
  trustedNotaries?: string[]
  
  /**
   * Maximum proof age in milliseconds
   * Proofs older than this are rejected
   */
  maxProofAge?: number
}
