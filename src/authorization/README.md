# Authorization Module

Optional authorization system for Loom actors and services.

## ⚠️ Important: Opt-In Only

**Authorization is COMPLETELY OPTIONAL and OPT-IN.**

- If you don't configure authorization, all operations are allowed
- Existing code continues to work without any changes
- No authorization checks are performed unless explicitly enabled

## Quick Start

### 1. No Authorization (Default)

By default, authorization is not enabled:

```typescript
// No authorization service passed = all operations allowed
const actor = new MyActor(context)
await actor.execute(input)  // ✅ Works without authorization
```

### 2. Enable Authorization (Opt-In)

To enable authorization, create and pass authorization service:

```typescript
import { OPAAuthorizationService, AuthorizationFactory } from '@certo-ventures/loom'

// Option A: Use OPA
const authz = new OPAAuthorizationService({
  endpoint: 'http://opa:8181',
  policyPath: 'loom.authz',
  cacheTTL: 60000,
  maxCacheSize: 10000  // Prevents DoS via unbounded cache growth
})

// Option B: Use factory (reads from env)
const authz = AuthorizationFactory.createFromEnv()

// Option C: No-op (testing)
const authz = AuthorizationFactory.createNoOp()

// Create authorization context
const authContext = {
  principal: {
    actorId: 'actor-001',
    actorType: 'SupervisorActor',
    tenantId: 'acme-corp',
    userId: 'user-123'
  }
}

// Pass to actor
const actor = new MyActor(
  context,
  undefined,  // initialState
  undefined,  // tracer
  undefined,  // idempotency
  undefined,  // memory
  authContext,  // ← authorization context
  authz        // ← authorization service
)

// Now authorization checks are performed
await actor.execute(input)  // Checks authorization first
```

## Architecture

### Components

1. **IAuthorizationService** - Interface for authorization implementations
2. **OPAAuthorizationService** - OPA (Open Policy Agent) integration
3. **NoOpAuthorizationService** - Allow-all implementation (for testing)
4. **Middleware** - Helper functions for authorization checks

### Flow

```
Actor/Service Method Called
       ↓
Authorization Configured?
       ↓
    NO → Allow operation (no check)
       ↓
   YES → Query authorization service
       ↓
     Allowed? → Continue
     Denied? → Throw UnauthorizedError
```

## Integration with OPA

### Prerequisites

1. OPA server running (e.g., `docker run -p 8181:8181 openpolicyagent/opa:latest run --server`)
2. Policies loaded in OPA

### Example OPA Policy

```rego
# policies/loom_authz.rego
package loom.authz

import future.keywords.if

# Default deny
default allow = false

# Allow actor invocation
allow if {
  input.action.resource == "actor"
  input.action.action == "invoke"
  
  # SupervisorActor can invoke anyone in their tenant
  input.principal.actorType == "SupervisorActor"
  input.principal.tenantId == input.action.tenantId
}

# Allow memory read
allow if {
  input.action.resource == "memory"
  input.action.action == "read"
  
  # Any actor can read memory in their tenant
  input.principal.tenantId == input.action.tenantId
}

# Allow memory write for specific actor types
allow if {
  input.action.resource == "memory"
  input.action.action == "write"
  
  input.principal.actorType in ["SupervisorActor", "ReviewerActor"]
  input.principal.tenantId == input.action.tenantId
}

# Provide reason when denied
reason = msg if {
  not allow
  input.principal.tenantId != input.action.tenantId
  msg := "Tenant mismatch"
} else = msg if {
  not allow
  msg := "Access denied by policy"
}
```

### Load Policy into OPA

```bash
# Via OPA CLI
opa run --server --addr :8181 policies/

# Via API
curl -X PUT http://localhost:8181/v1/policies/loom \
  --data-binary @policies/loom_authz.rego
```

## Usage Examples

### Example 1: Actor with Authorization

```typescript
import { 
  Actor, 
  OPAAuthorizationService,
  type AuthorizationContext 
} from '@certo-ventures/loom'

class MyActor extends Actor {
  async execute(input: unknown): Promise<void> {
    // Authorization is checked automatically in protected methods
    
    // This will check authorization if configured
    await this.invokeActor('TargetActor', data)
    
    // Memory operations also check authorization
    await this.memory.remember('Important fact')
  }
}

// Enable authorization
const authz = new OPAAuthorizationService({
  endpoint: process.env.OPA_ENDPOINT!
})

const authContext: AuthorizationContext = {
  principal: {
    actorId: context.actorId,
    actorType: 'MyActor',
    tenantId: 'acme-corp'
  }
}

const actor = new MyActor(
  context,
  undefined, undefined, undefined, undefined,
  authContext,  // ← Add auth context
  authz        // ← Add auth service
)
```

### Example 2: Service with Authorization

```typescript
import { SemanticMemoryService } from '@certo-ventures/loom'

// Service accepts optional authorization
const memoryService = new SemanticMemoryService(
  memoryConfig,
  authzService  // ← Optional authorization service
)

// Operations can include auth context
await memoryService.add(
  memory,
  options,
  authContext  // ← Optional: check authorization
)
```

### Example 3: Manual Authorization Check

```typescript
import { requireAuthorization } from '@certo-ventures/loom'

async function myOperation() {
  // Check authorization before operation
  await requireAuthorization(
    authzService,
    authContext,
    { resource: 'actor', action: 'invoke', target: 'TargetActor' },
    'invoke target actor'
  )
  
  // If we get here, authorization passed
  // ... perform operation
}
```

### Example 4: Environment-Based Setup

```bash
# .env file
OPA_ENDPOINT=http://opa:8181
OPA_POLICY_PATH=loom.authz
OPA_CACHE_TTL=60000
```

```typescript
import { AuthorizationFactory } from '@certo-ventures/loom'

// Automatically uses environment variables
// Returns NoOp if OPA_ENDPOINT not set
const authz = AuthorizationFactory.createFromEnv()
```

## Authorization Context

The authorization context flows through actor invocations:

```typescript
interface AuthorizationContext {
  principal: {
    actorId: string      // Who is making the request
    actorType: string    // Type of actor
    tenantId: string     // Tenant boundary
    userId?: string      // Optional user
    roles?: string[]     // Optional roles
  }
  
  delegationChain?: Array<{
    fromActorId: string
    fromActorType: string
    delegatedAt: string
    scope?: string[]
  }>
  
  claims?: Record<string, any>  // From Azure AD/external IdP
  sessionId?: string
  metadata?: Record<string, any>
}
```

## Resource Actions

Actions that can be authorized:

```typescript
type ResourceAction = 
  | { resource: 'actor', action: 'invoke', target: string }
  | { resource: 'memory', action: 'read' | 'write', tenantId: string }
  | { resource: 'config', action: 'read' | 'write', tenantId: string }
  | { resource: string, action: string, target?: string }  // Custom
```

## Performance

### Caching

OPA decisions are cached locally by default (60 second TTL):

```typescript
const authz = new OPAAuthorizationService({
  endpoint: 'http://opa:8181',
  cacheTTL: 60000  // 1 minute (default)
})

// Clear cache manually if needed
authz.clearCache()
```

### Batch Operations

For multiple checks, use batch operations:

```typescript
const decisions = await authz.batchAuthorize(authContext, [
  { resource: 'actor', action: 'invoke', target: 'Actor1' },
  { resource: 'actor', action: 'invoke', target: 'Actor2' },
  { resource: 'memory', action: 'read', tenantId: 'acme' }
])

// Check results
decisions.forEach((decision, i) => {
  if (decision.allow) {
    console.log(`Action ${i} allowed`)
  }
})
```

## Error Handling

When authorization fails, `UnauthorizedError` is thrown:

```typescript
try {
  await actor.execute(input)
} catch (error) {
  if (error instanceof UnauthorizedError) {
    console.log('Denied:', error.decision.reason)
    console.log('Required:', error.decision.requiredPermissions)
    console.log('Context:', error.context)
    console.log('Action:', error.action)
  }
}
```

## Testing

For tests, use NoOpAuthorizationService:

```typescript
import { NoOpAuthorizationService } from '@certo-ventures/loom'

// All operations allowed (no OPA needed)
const authz = new NoOpAuthorizationService()

const actor = new MyActor(
  context,
  undefined, undefined, undefined, undefined,
  authContext,
  authz  // ← No-op: always allows
)
```

## Migration Path

Authorization is opt-in, so you can migrate gradually:

### Phase 1: Infrastructure (Now)
- Authorization module available but not used
- Existing code works unchanged

### Phase 2: Opt-In (Later)
- Enable authorization for specific actors/services
- Add authorization contexts where needed

### Phase 3: Enforcement (When Ready)
- Make authorization required (remove undefined defaults)
- Add policy enforcement points throughout

## Best Practices

1. **Start with No-Op** - Test with NoOpAuthorizationService first
2. **Cache Decisions** - Use built-in caching for performance
3. **Tenant Boundaries** - Always enforce tenant isolation
4. **Fail-Safe** - Authorization errors deny by default
5. **Audit Logs** - Log authorization decisions to observability
6. **Policy Testing** - Test OPA policies in isolation
7. **Delegation Chains** - Track actor→actor delegation

## See Also

- [OPA Documentation](https://www.openpolicyagent.org/docs/latest/)
- [Rego Policy Language](https://www.openpolicyagent.org/docs/latest/policy-language/)
- Actor base class (`src/actor/actor.ts`)
- Memory service (`src/memory/semantic-memory-service.ts`)
