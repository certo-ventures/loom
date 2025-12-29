/**
 * Authorization Service Factory
 * 
 * Helper to create authorization services from configuration.
 * Provides platform helpers for environment-based setup.
 */

import type { IAuthorizationService } from './types.js'
import { OPAAuthorizationService, type OPAConfig } from './opa-client.js'
import { NoOpAuthorizationService } from './noop-authorization.js'

export class AuthorizationFactory {
  /**
   * Create authorization service from environment variables.
   * Returns NoOpAuthorizationService if OPA_ENDPOINT is not set.
   * 
   * Environment variables:
   * - OPA_ENDPOINT: OPA server URL (required to enable authorization)
   * - OPA_POLICY_PATH: Policy path in OPA (default: 'loom.authz')
   * - OPA_TIMEOUT: Request timeout in ms (default: 5000)
   * - OPA_CACHE_TTL: Cache TTL in ms (default: 60000)
   */
  static createFromEnv(): IAuthorizationService {
    const endpoint = process.env.OPA_ENDPOINT
    
    if (!endpoint) {
      // No OPA configured - return no-op service
      return new NoOpAuthorizationService()
    }
    
    return new OPAAuthorizationService({
      endpoint,
      policyPath: process.env.OPA_POLICY_PATH || 'loom.authz',
      timeout: parseInt(process.env.OPA_TIMEOUT || '5000', 10),
      cacheTTL: parseInt(process.env.OPA_CACHE_TTL || '60000', 10)
    })
  }
  
  /**
   * Create OPA authorization service with explicit configuration
   */
  static createOPA(config: OPAConfig): IAuthorizationService {
    return new OPAAuthorizationService(config)
  }
  
  /**
   * Create no-op authorization service (allows all operations)
   */
  static createNoOp(): IAuthorizationService {
    return new NoOpAuthorizationService()
  }
}
