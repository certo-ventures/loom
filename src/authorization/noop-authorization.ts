/**
 * No-Op Authorization Service
 * 
 * Default implementation that allows all operations.
 * Use this when authorization is not needed or for testing.
 */

import type { 
  IAuthorizationService, 
  AuthorizationContext, 
  ResourceAction, 
  AuthorizationDecision 
} from './types.js'

export class NoOpAuthorizationService implements IAuthorizationService {
  /**
   * Always allows all operations
   */
  async authorize(
    _context: AuthorizationContext,
    _action: ResourceAction
  ): Promise<AuthorizationDecision> {
    return { allow: true }
  }
  
  /**
   * Always allows all operations in batch
   */
  async batchAuthorize(
    _context: AuthorizationContext,
    actions: ResourceAction[]
  ): Promise<AuthorizationDecision[]> {
    return actions.map(() => ({ allow: true }))
  }
  
  clearCache(): void {
    // No cache to clear
  }
}
