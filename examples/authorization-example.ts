/**
 * Authorization Example (OPT-IN)
 * 
 * This example shows how to enable authorization in Loom.
 * By default, authorization is NOT enabled - this is completely optional.
 * 
 * Prerequisites:
 * 1. OPA server running: docker run -p 8181:8181 openpolicyagent/opa:latest run --server
 * 2. Load policy: curl -X PUT http://localhost:8181/v1/policies/loom --data-binary @examples/policies/loom_authz.rego
 */

import { 
  OPAAuthorizationService,
  NoOpAuthorizationService,
  type AuthorizationContext,
  UnauthorizedError
} from '../src/authorization/index.js'
import type { ActorContext } from '../src/actor/journal.js'

// Mock actor for demonstration
class DemoActor {
  constructor(
    private context: ActorContext,
    private authContext?: AuthorizationContext,
    private authzService?: OPAAuthorizationService
  ) {}
  
  async performOperation() {
    console.log(`[${this.context.actorId}] Performing operation...`)
    
    // Authorization check (no-op if not configured)
    if (this.authzService && this.authContext) {
      const decision = await this.authzService.authorize(
        this.authContext,
        { resource: 'memory', action: 'write', tenantId: this.authContext.principal.tenantId }
      )
      
      if (!decision.allow) {
        throw new UnauthorizedError(
          'Cannot write memory',
          this.authContext,
          { resource: 'memory', action: 'write', tenantId: this.authContext.principal.tenantId },
          decision
        )
      }
      
      console.log('✅ Authorization passed')
    } else {
      console.log('⚠️  No authorization configured (allowing all)')
    }
    
    console.log('✅ Operation completed\n')
  }
}

/**
 * Example 1: No Authorization (Default Behavior)
 */
async function example1_NoAuthorization() {
  console.log('=== Example 1: No Authorization (Default) ===\n')
  
  const context: ActorContext = {
    actorId: 'actor-001',
    actorType: 'DemoActor',
    correlationId: 'demo-1'
  } as any
  
  // No authorization service or context passed
  const actor = new DemoActor(context)
  
  // This works without any authorization checks
  await actor.performOperation()
}

/**
 * Example 2: No-Op Authorization (Allows All)
 */
async function example2_NoOpAuthorization() {
  console.log('=== Example 2: No-Op Authorization (Testing) ===\n')
  
  const context: ActorContext = {
    actorId: 'actor-002',
    actorType: 'DemoActor',
    correlationId: 'demo-2'
  } as any
  
  const authContext: AuthorizationContext = {
    principal: {
      actorId: 'actor-002',
      actorType: 'DemoActor',
      tenantId: 'test-tenant'
    }
  }
  
  // No-op service: always allows
  const authzService = new NoOpAuthorizationService()
  
  const actor = new DemoActor(context, authContext, authzService as any)
  await actor.performOperation()
}

/**
 * Example 3: OPA Authorization (Real Policy Enforcement)
 * 
 * Requires OPA server running with policies loaded.
 * If OPA is not available, this example will fail-safe and deny.
 */
async function example3_OPAAuthorization() {
  console.log('=== Example 3: OPA Authorization (Real Enforcement) ===\n')
  
  const opaEndpoint = process.env.OPA_ENDPOINT || 'http://localhost:8181'
  
  console.log(`Connecting to OPA at ${opaEndpoint}`)
  console.log('(If OPA is not running, operations will be denied)\n')
  
  const authzService = new OPAAuthorizationService({
    endpoint: opaEndpoint,
    policyPath: 'loom.authz',
    cacheTTL: 60000
  })
  
  // Example 3a: Allowed operation
  console.log('--- Attempt 1: SupervisorActor writing memory (should allow) ---\n')
  {
    const context: ActorContext = {
      actorId: 'supervisor-001',
      actorType: 'SupervisorActor',
      correlationId: 'demo-3a'
    } as any
    
    const authContext: AuthorizationContext = {
      principal: {
        actorId: 'supervisor-001',
        actorType: 'SupervisorActor',
        tenantId: 'acme-corp'
      }
    }
    
    const actor = new DemoActor(context, authContext, authzService)
    
    try {
      await actor.performOperation()
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        console.log(`❌ Denied: ${error.decision.reason}\n`)
      } else {
        console.log(`❌ Error: ${error}\n`)
      }
    }
  }
  
  // Example 3b: Denied operation
  console.log('--- Attempt 2: UnknownActor writing memory (should deny) ---\n')
  {
    const context: ActorContext = {
      actorId: 'unknown-001',
      actorType: 'UnknownActor',
      correlationId: 'demo-3b'
    } as any
    
    const authContext: AuthorizationContext = {
      principal: {
        actorId: 'unknown-001',
        actorType: 'UnknownActor',
        tenantId: 'acme-corp'
      }
    }
    
    const actor = new DemoActor(context, authContext, authzService)
    
    try {
      await actor.performOperation()
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        console.log(`❌ Denied: ${error.decision.reason}`)
        console.log(`   Required: ${error.decision.requiredPermissions?.join(', ') || 'N/A'}\n`)
      } else {
        console.log(`❌ Error: ${error}\n`)
      }
    }
  }
  
  // Example 3c: Cross-tenant attempt (should deny)
  console.log('--- Attempt 3: Cross-tenant access (should deny) ---\n')
  {
    const context: ActorContext = {
      actorId: 'supervisor-002',
      actorType: 'SupervisorActor',
      correlationId: 'demo-3c'
    } as any
    
    const authContext: AuthorizationContext = {
      principal: {
        actorId: 'supervisor-002',
        actorType: 'SupervisorActor',
        tenantId: 'tenant-a'
      }
    }
    
    const actor = new DemoActor(context, authContext, authzService)
    
    // Try to access different tenant's memory
    if (authzService && authContext) {
      const decision = await authzService.authorize(
        authContext,
        { resource: 'memory', action: 'write', tenantId: 'tenant-b' }  // Different tenant!
      )
      
      if (decision.allow) {
        console.log('✅ Cross-tenant access allowed (unexpected!)\n')
      } else {
        console.log(`❌ Cross-tenant denied: ${decision.reason}\n`)
      }
    }
  }
}

/**
 * Main
 */
async function main() {
  console.log('🔐 Loom Authorization Examples\n')
  console.log('IMPORTANT: Authorization is COMPLETELY OPTIONAL.')
  console.log('These examples show how to opt-in when you need it.\n')
  console.log(''.padEnd(60, '=') + '\n')
  
  // Example 1: Default behavior (no authorization)
  await example1_NoAuthorization()
  
  // Example 2: Testing with no-op
  await example2_NoOpAuthorization()
  
  // Example 3: Real OPA enforcement (requires OPA server)
  await example3_OPAAuthorization()
  
  console.log(''.padEnd(60, '='))
  console.log('\n✅ All examples completed')
  console.log('\nTo enable authorization in your code:')
  console.log('1. Create OPAAuthorizationService with your OPA endpoint')
  console.log('2. Create AuthorizationContext for the actor')
  console.log('3. Pass both to actor/service constructors')
  console.log('\nSee src/authorization/README.md for full documentation.')
}

// Run examples
main().catch(error => {
  console.error('❌ Example failed:', error)
  process.exit(1)
})
