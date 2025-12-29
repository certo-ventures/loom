/**
 * Authorization Types
 * 
 * Optional authorization system for Loom actors and services.
 * All authorization is OPT-IN - if not configured, all operations are allowed.
 */

export interface AuthorizationContext {
  /**
   * The principal (actor/user) making the request
   */
  principal: ActorPrincipal
  
  /**
   * Optional delegation chain (for supervisor → worker scenarios)
   */
  delegationChain?: DelegationStep[]
  
  /**
   * Optional claims from external identity provider (e.g., Azure AD)
   */
  claims?: Record<string, any>
  
  /**
   * Optional session identifier
   */
  sessionId?: string
  
  /**
   * Optional metadata
   */
  metadata?: Record<string, any>
}

export interface ActorPrincipal {
  actorId: string
  actorType: string
  tenantId: string
  userId?: string
  roles?: string[]
}

export interface DelegationStep {
  fromActorId: string
  fromActorType: string
  delegatedAt: string
  scope?: string[]
  expiresAt?: string
}

export interface AuthorizationDecision {
  /**
   * Whether the action is allowed
   */
  allow: boolean
  
  /**
   * Reason for denial (if not allowed)
   */
  reason?: string
  
  /**
   * Required permissions that were missing
   */
  requiredPermissions?: string[]
  
  /**
   * Additional metadata about the decision
   */
  metadata?: Record<string, any>
}

/**
 * Resource actions that can be authorized
 */
export type ResourceAction = 
  | ActorInvocationAction
  | MemoryAction
  | ConfigAction
  | CustomAction

export interface ActorInvocationAction {
  resource: 'actor'
  action: 'invoke'
  target: string  // Target actor type
  tenantId?: string
}

export interface MemoryAction {
  resource: 'memory'
  action: 'read' | 'write' | 'delete'
  tenantId: string
  threadId?: string
}

export interface ConfigAction {
  resource: 'config'
  action: 'read' | 'write' | 'delete'
  tenantId: string
  actorType?: string
}

export interface CustomAction {
  resource: string
  action: string
  target?: string
  tenantId?: string
  metadata?: Record<string, any>
}

/**
 * Authorization service interface
 * 
 * Implementations can use OPA, Casbin, or custom logic.
 */
export interface IAuthorizationService {
  /**
   * Check if a single action is authorized
   */
  authorize(
    context: AuthorizationContext,
    action: ResourceAction
  ): Promise<AuthorizationDecision>
  
  /**
   * Check multiple actions in batch (more efficient)
   */
  batchAuthorize(
    context: AuthorizationContext,
    actions: ResourceAction[]
  ): Promise<AuthorizationDecision[]>
  
  /**
   * Optional: Clear any local caches
   */
  clearCache?(): void
}

/**
 * Error thrown when authorization fails
 */
export class UnauthorizedError extends Error {
  constructor(
    message: string,
    public readonly context: AuthorizationContext,
    public readonly action: ResourceAction,
    public readonly decision: AuthorizationDecision
  ) {
    super(message)
    this.name = 'UnauthorizedError'
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnauthorizedError)
    }
  }
}
