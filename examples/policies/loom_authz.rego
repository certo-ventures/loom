# Example OPA Policy for Loom Authorization

package loom.authz

import future.keywords.if
import future.keywords.in

# Default: Deny all access
default allow := false

# ============================================================================
# Actor Invocation Rules
# ============================================================================

# SupervisorActor can invoke any actor within their tenant
allow if {
  input.action.resource == "actor"
  input.action.action == "invoke"
  input.principal.actorType == "SupervisorActor"
  tenant_match
}

# CriteriaReviewerActor can invoke ValidatorActor
allow if {
  input.action.resource == "actor"
  input.action.action == "invoke"
  input.principal.actorType == "CriteriaReviewerActor"
  input.action.target == "ValidatorActor"
  tenant_match
}

# ============================================================================
# Memory Access Rules
# ============================================================================

# All actors can read memory in their own tenant
allow if {
  input.action.resource == "memory"
  input.action.action == "read"
  tenant_match
}

# Only specific actor types can write memory
allow if {
  input.action.resource == "memory"
  input.action.action == "write"
  input.principal.actorType in [
    "SupervisorActor",
    "CriteriaReviewerActor",
    "ReviewerActor"
  ]
  tenant_match
}

# System actors can delete memory
allow if {
  input.action.resource == "memory"
  input.action.action == "delete"
  input.principal.actorType == "SystemActor"
  tenant_match
}

# ============================================================================
# Configuration Access Rules
# ============================================================================

# Read config: All actors in tenant
allow if {
  input.action.resource == "config"
  input.action.action == "read"
  tenant_match
}

# Write config: Only supervisors and system actors
allow if {
  input.action.resource == "config"
  input.action.action == "write"
  input.principal.actorType in ["SupervisorActor", "SystemActor"]
  tenant_match
}

# ============================================================================
# Helper Rules
# ============================================================================

# Tenant isolation check
tenant_match if {
  input.principal.tenantId == input.action.tenantId
}

# Check delegation chain
allow if {
  input.delegationChain
  count(input.delegationChain) > 0
  valid_delegation
}

valid_delegation if {
  # First step in delegation chain must be from allowed actor
  chain := input.delegationChain[0]
  chain.fromActorType in ["SupervisorActor", "SystemActor"]
  
  # TODO: Add expiration check
  # TODO: Add scope validation
}

# ============================================================================
# Denial Reasons
# ============================================================================

reason := msg if {
  not allow
  not tenant_match
  msg := "Tenant mismatch: Actor cannot access resources in different tenant"
} else := msg if {
  not allow
  input.action.resource == "memory"
  input.action.action == "write"
  msg := "Actor type not authorized to write memory"
} else := msg if {
  not allow
  msg := "Access denied by policy"
}

# Required permissions (for debugging)
requiredPermissions contains perm if {
  not allow
  input.action.resource == "memory"
  input.action.action == "write"
  perm := "memory:write"
}

requiredPermissions contains perm if {
  not allow
  input.action.resource == "actor"
  perm := sprintf("actor:invoke:%s", [input.action.target])
}
