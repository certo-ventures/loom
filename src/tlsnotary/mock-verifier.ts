/**
 * Mock TLS Notary Verifier
 * 
 * ⚠️  FOR DEVELOPMENT/DEMO ONLY - NOT CRYPTOGRAPHICALLY SECURE
 * 
 * This implementation:
 * - Validates presentation structure
 * - Extracts data from revealed transcript
 * - Returns successful verification WITHOUT cryptographic checks
 * 
 * For production, replace with WasmVerifier using Rust module
 * See: docs/tlsnotary/IMPLEMENTATION.md
 */

import type { TLSNotaryVerifier, TLSNotaryPresentation, VerifiedData, VerifierInfo, VerifierOptions } from './types'
import crypto from 'crypto'

export class MockTLSNotaryVerifier implements TLSNotaryVerifier {
  private options: VerifierOptions
  
  constructor(options: VerifierOptions = {}) {
    this.options = options
  }
  
  getInfo(): VerifierInfo {
    return {
      type: 'mock',
      version: '0.1.0-mock',
      ready: true
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
    if (!presentation.header.handshake_summary) {
      throw new Error('Missing handshake summary')
    }
    if (!presentation.server_name) {
      throw new Error('Missing server name')
    }
  }
  
  async verify(presentation: TLSNotaryPresentation): Promise<VerifiedData> {
    // Warn about mock usage
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.warn('⚠️  [MockTLSNotaryVerifier] MOCK VERIFICATION')
    console.warn('   This is NOT cryptographically secure!')
    console.warn('   For production, use WasmVerifier with Rust module')
    console.warn('   See: docs/tlsnotary/IMPLEMENTATION.md')
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    
    // Prevent production use (unless explicitly allowed)
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_MOCK_VERIFIER) {
      throw new Error(
        'MockTLSNotaryVerifier not allowed in production. ' +
        'Set ALLOW_MOCK_VERIFIER=true to override (not recommended)'
      )
    }
    
    // Validate structure
    this.validateStructure(presentation)
    
    // Check trusted notaries if configured
    if (this.options.trustedNotaries && this.options.trustedNotaries.length > 0) {
      if (!this.options.trustedNotaries.includes(presentation.signature.public_key)) {
        throw new Error(`Notary public key not trusted: ${presentation.signature.public_key}`)
      }
    }
    
    // Extract server information
    const { server_name } = presentation
    const { time } = presentation.header.handshake_summary
    
    // Check proof age if configured
    if (this.options.maxProofAge) {
      const age = Date.now() - time * 1000
      if (age > this.options.maxProofAge) {
        throw new Error(`Proof too old: ${Math.floor(age / 1000)}s (max: ${Math.floor(this.options.maxProofAge / 1000)}s)`)
      }
    }
    
    // Parse HTTP data from revealed transcript
    const httpData = this.parseHTTPTranscript(
      presentation.session.recv.cleartext
    )
    
    // Generate proof hash for audit trail
    const proofHash = this.hashPresentation(presentation)
    
    console.log('✅ [MockTLSNotaryVerifier] Mock verification successful')
    console.log(`   Server: ${server_name}`)
    console.log(`   Time: ${new Date(time * 1000).toISOString()}`)
    console.log(`   Proof Hash: ${proofHash}`)
    console.log(`   Data Keys: ${Object.keys(httpData.body || {}).join(', ') || '(raw)'}`)
    
    return {
      verified: true,
      server_name,
      timestamp: time,
      data: httpData,
      proof_hash: proofHash,
      notary_pubkey: presentation.signature.public_key
    }
  }
  
  /**
   * Parse HTTP response from transcript bytes
   */
  private parseHTTPTranscript(data: Uint8Array): VerifiedData['data'] {
    // Convert bytes to string
    const text = new TextDecoder().decode(data)
    
    // Simple HTTP response parser
    const lines = text.split('\r\n')
    const headers: Record<string, string> = {}
    let bodyStart = 0
    
    // Extract method and URL from first line (if request)
    // For response, first line is status
    let method = 'GET'
    let url = 'unknown'
    
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
    const body = lines.slice(bodyStart).join('\r\n').trim()
    
    // Try to parse as JSON
    let parsedBody: any
    try {
      parsedBody = JSON.parse(body)
    } catch {
      parsedBody = body || null
    }
    
    // Build URL from headers
    if (headers['Host']) {
      url = `https://${headers['Host']}${headers['Path'] || '/'}`
    }
    
    return {
      method,
      url,
      headers,
      body: parsedBody
    }
  }
  
  /**
   * Hash presentation for audit trail
   */
  private hashPresentation(presentation: TLSNotaryPresentation): string {
    const json = JSON.stringify(presentation)
    return crypto.createHash('sha256').update(json).digest('hex')
  }
}
