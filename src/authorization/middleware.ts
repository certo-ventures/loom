/**
 * Authorization Middleware
 * 
 * Helper functions for enforcing authorization in actors and services.
 * All functions are no-ops if authorization is not configured.
 */

import type { 
  IAuthorizationService, 
  AuthorizationContext, 
  ResourceAction 
} from './types.js'
import { UnauthorizedError } from './types.js'

/**
 * Require authorization for an operation.
 * 
 * This is a no-op if authzService or context is undefined.
 * Throws UnauthorizedError if authorization fails.
 * 
 * @param authzService - Optional authorization service
 * @param context - Optional authorization context
 * @param action - The action to authorize
 * @param operationName - Human-readable operation name for error messages
 */
export async function requireAuthorization(
  authzService: IAuthorizationService | undefined,
  context: AuthorizationContext | undefined,
  action: ResourceAction,
  operationName: string
): Promise<void> {
  // No-op if authorization not configured
  if (!authzService || !context) {
    return
  }
  
  const decision = await authzService.authorize(context, action)
  
  if (!decision.allow) {
    throw new UnauthorizedError(
      `Unauthorized ${operationName}: ${decision.reason || 'Access denied'}`,
      context,
      action,
      decision
    )
  }
}

/**
 * Check authorization without throwing.
 * Returns true if allowed, false if denied or not configured.
 * 
 * @param authzService - Optional authorization service
 * @param context - Optional authorization context
 * @param action - The action to authorize
 */
export async function checkAuthorization(
  authzService: IAuthorizationService | undefined,
  context: AuthorizationContext | undefined,
  action: ResourceAction
): Promise<boolean> {
  // Allow if authorization not configured
  if (!authzService || !context) {
    return true
  }
  
  try {
    const decision = await authzService.authorize(context, action)
    return decision.allow
  } catch (error) {
    console.error('[Authorization] Error checking authorization:', error)
    return false
  }
}

/**
 * Batch authorization check.
 * Returns array of booleans indicating which actions are allowed.
 * 
 * @param authzService - Optional authorization service
 * @param context - Optional authorization context
 * @param actions - Array of actions to authorize
 */
export async function batchCheckAuthorization(
  authzService: IAuthorizationService | undefined,
  context: AuthorizationContext | undefined,
  actions: ResourceAction[]
): Promise<boolean[]> {
  // Allow all if authorization not configured
  if (!authzService || !context) {
    return actions.map(() => true)
  }
  
  try {
    const decisions = await authzService.batchAuthorize(context, actions)
    return decisions.map(d => d.allow)
  } catch (error) {
    console.error('[Authorization] Error in batch authorization:', error)
    return actions.map(() => false)
  }
}
