/**
 * TLS Notary Health Checks and Production Readiness
 * 
 * Ensures TLS Notary verifier is ready for production use:
 * - Blocks mock verifier in production
 * - Validates WASM module availability
 * - Provides health check endpoints
 * - Enforces security policies
 */

import type { TLSNotaryVerifier, VerifierInfo } from './types'
import { WasmTLSNotaryVerifier } from './wasm-verifier'
import { MockTLSNotaryVerifier } from './mock-verifier'

export interface TLSNotaryConfig {
  /** Environment mode */
  mode: 'production' | 'development' | 'test'
  
  /** Allow mock verifier (only in non-production) */
  allowMock?: boolean
  
  /** Trusted notary public keys */
  trustedNotaries?: string[]
  
  /** Maximum presentation age in seconds */
  maxPresentationAge?: number
}

export interface HealthCheckResult {
  healthy: boolean
  verifierType: 'wasm' | 'mock'
  ready: boolean
  error?: string
  details?: {
    wasmAvailable: boolean
    mode: string
    mockAllowed: boolean
  }
}

/**
 * Production readiness error
 */
export class ProductionReadinessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionReadinessError'
  }
}

/**
 * Create TLS Notary verifier with production validation
 */
export async function createVerifier(config: TLSNotaryConfig): Promise<TLSNotaryVerifier> {
  const { mode, allowMock = false } = config
  
  // Production mode MUST use WASM verifier
  if (mode === 'production') {
    if (allowMock) {
      throw new ProductionReadinessError(
        'Mock verifier is not allowed in production mode. Set allowMock=false.'
      )
    }
    
    console.log('🔒 [TLSNotary] Production mode - attempting to load WASM verifier')
    
    try {
      const verifier = new WasmTLSNotaryVerifier({
        trustedNotaries: config.trustedNotaries,
        maxPresentationAge: config.maxPresentationAge,
      })
      
      await verifier.initialize()
      
      console.log('✅ [TLSNotary] WASM verifier loaded successfully')
      return verifier
    } catch (error) {
      console.error('❌ [TLSNotary] Failed to load WASM verifier in production mode')
      console.error('   This is a fatal error in production')
      throw new ProductionReadinessError(
        `WASM verifier required in production but failed to load: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
  
  // Development/test mode - try WASM first, fall back to mock
  console.log(`📋 [TLSNotary] ${mode} mode - loading verifier`)
  
  if (!allowMock) {
    // Must use WASM even in dev/test
    const verifier = new WasmTLSNotaryVerifier({
      trustedNotaries: config.trustedNotaries,
      maxPresentationAge: config.maxPresentationAge,
    })
    
    await verifier.initialize()
    return verifier
  }
  
  // Try WASM first
  try {
    const verifier = new WasmTLSNotaryVerifier({
      trustedNotaries: config.trustedNotaries,
      maxPresentationAge: config.maxPresentationAge,
    })
    
    await verifier.initialize()
    console.log('✅ [TLSNotary] Using WASM verifier')
    return verifier
  } catch (error) {
    console.warn('⚠️  [TLSNotary] WASM verifier not available, falling back to mock')
    console.warn('   For production deployment, build WASM module: npm run build:tlsn')
    
    return new MockTLSNotaryVerifier({
      trustedNotaries: config.trustedNotaries,
      maxPresentationAge: config.maxPresentationAge,
    })
  }
}

/**
 * Health check for TLS Notary verifier
 */
export async function healthCheck(config: TLSNotaryConfig): Promise<HealthCheckResult> {
  try {
    const verifier = await createVerifier(config)
    const info = verifier.getInfo()
    
    const healthy = info.type === 'wasm' || config.mode !== 'production'
    
    return {
      healthy,
      verifierType: info.type,
      ready: info.ready,
      details: {
        wasmAvailable: info.type === 'wasm',
        mode: config.mode,
        mockAllowed: config.allowMock || false,
      }
    }
  } catch (error) {
    return {
      healthy: false,
      verifierType: 'mock',
      ready: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      details: {
        wasmAvailable: false,
        mode: config.mode,
        mockAllowed: config.allowMock || false,
      }
    }
  }
}

/**
 * Validate production readiness at startup
 */
export async function validateProductionReadiness(config: TLSNotaryConfig): Promise<void> {
  if (config.mode !== 'production') {
    return
  }
  
  console.log('🔍 [TLSNotary] Validating production readiness...')
  
  const health = await healthCheck(config)
  
  if (!health.healthy) {
    throw new ProductionReadinessError(
      `TLS Notary not ready for production: ${health.error || 'WASM verifier unavailable'}`
    )
  }
  
  if (health.verifierType !== 'wasm') {
    throw new ProductionReadinessError(
      'Mock verifier cannot be used in production. Build WASM module with: npm run build:tlsn'
    )
  }
  
  console.log('✅ [TLSNotary] Production readiness validated')
  console.log(`   Verifier type: ${health.verifierType}`)
  console.log(`   Ready: ${health.ready}`)
}

/**
 * Get verifier information for monitoring
 */
export function getVerifierInfo(verifier: TLSNotaryVerifier): VerifierInfo & { productionReady: boolean } {
  const info = verifier.getInfo()
  
  return {
    ...info,
    productionReady: info.type === 'wasm' && info.ready,
  }
}

/**
 * Load configuration from environment
 */
export function loadTLSNotaryConfigFromEnv(): TLSNotaryConfig {
  const mode = (process.env.NODE_ENV || 'development') as 'production' | 'development' | 'test'
  const allowMock = process.env.TLSNOTARY_ALLOW_MOCK === 'true'
  
  const trustedNotaries = process.env.TLSNOTARY_TRUSTED_NOTARIES
    ? process.env.TLSNOTARY_TRUSTED_NOTARIES.split(',')
    : undefined
  
  const maxPresentationAge = process.env.TLSNOTARY_MAX_PRESENTATION_AGE
    ? parseInt(process.env.TLSNOTARY_MAX_PRESENTATION_AGE)
    : undefined
  
  return {
    mode,
    allowMock,
    trustedNotaries,
    maxPresentationAge,
  }
}
