/**
 * Authorization Module
 * 
 * Optional authorization system for Loom actors and services.
 * 
 * IMPORTANT: Authorization is COMPLETELY OPT-IN.
 * If you don't configure an authorization service, all operations are allowed.
 * 
 * Usage:
 * 
 * 1. Create authorization service:
 *    const authz = new OPAAuthorizationService({ endpoint: 'http://opa:8181' })
 * 
 * 2. Create authorization context:
 *    const authContext = { principal: { actorId, actorType, tenantId } }
 * 
 * 3. Pass to actor/service constructors:
 *    new Actor(context, state, tracer, store, memory, authContext, authz)
 * 
 * 4. Or use middleware directly:
 *    await requireAuthorization(authz, authContext, action, 'operation name')
 */

// Core types
export type {
  AuthorizationContext,
  ActorPrincipal,
  DelegationStep,
  AuthorizationDecision,
  ResourceAction,
  ActorInvocationAction,
  MemoryAction,
  ConfigAction,
  CustomAction,
  IAuthorizationService
} from './types.js'

export { UnauthorizedError } from './types.js'

// Implementations
export { OPAAuthorizationService, type OPAConfig } from './opa-client.js'
export { NoOpAuthorizationService } from './noop-authorization.js'

// Middleware helpers
export {
  requireAuthorization,
  checkAuthorization,
  batchCheckAuthorization
} from './middleware.js'

// Factory
export { AuthorizationFactory } from './factory.js'
