/**
 * OPA (Open Policy Agent) Authorization Service
 * 
 * Integrates with an external OPA server for policy-based authorization.
 * Supports local caching to reduce network overhead.
 */

import type { 
  IAuthorizationService, 
  AuthorizationContext, 
  ResourceAction, 
  AuthorizationDecision 
} from './types.js'

/**
 * OPA response types for type-safe parsing
 */
interface OPAResponse {
  result?: {
    allow?: boolean
    reason?: string
    requiredPermissions?: string[]
    metadata?: Record<string, any>
  }
}

interface OPABatchResponse {
  result?: {
    decisions?: AuthorizationDecision[]
  }
}

export interface OPAConfig {
  /**
   * OPA endpoint (e.g., 'http://opa:8181')
   */
  endpoint: string
  
  /**
   * Policy path in OPA (e.g., 'loom/authz')
   * Default: 'loom/authz'
   */
  policyPath?: string
  
  /**
   * Request timeout in milliseconds
   * Default: 5000
   */
  timeout?: number
  
  /**
   * Cache TTL in milliseconds (0 to disable)
   * Default: 60000 (1 minute)
   */
  cacheTTL?: number
  
  /**
   * Maximum cache size (number of entries)
   * Default: 10000
   * Prevents DoS attacks via unbounded cache growth
   */
  maxCacheSize?: number
  
  /**
   * Optional headers to include in OPA requests
   */
  headers?: Record<string, string>
}

interface CacheEntry {
  decision: AuthorizationDecision
  expiresAt: number
}

export class OPAAuthorizationService implements IAuthorizationService {
  private cache = new Map<string, CacheEntry>()
  private cacheOperationInProgress = false
  private readonly policyPath: string
  private readonly timeout: number
  private readonly cacheTTL: number
  private readonly maxCacheSize: number
  private evictionTimer?: NodeJS.Timeout
  
  constructor(private config: OPAConfig) {
    // Validate configuration
    if (!config.endpoint) {
      throw new Error('OPA endpoint is required')
    }
    
    // Normalize endpoint - remove trailing slash
    if (config.endpoint.endsWith('/')) {
      config.endpoint = config.endpoint.slice(0, -1)
    }
    
    if (!config.endpoint.startsWith('http://') && !config.endpoint.startsWith('https://')) {
      throw new Error('OPA endpoint must start with http:// or https://')
    }
    
    if (config.timeout !== undefined && config.timeout < 0) {
      throw new Error('Timeout must be non-negative')
    }
    
    if (config.timeout !== undefined && config.timeout === 0) {
      throw new Error('Timeout cannot be zero (use positive value or undefined for default)')
    }
    
    if (config.cacheTTL !== undefined && config.cacheTTL < 0) {
      throw new Error('Cache TTL must be non-negative')
    }
    
    if (config.maxCacheSize !== undefined && config.maxCacheSize < 1) {
      throw new Error('Max cache size must be at least 1')
    }
    
    this.policyPath = config.policyPath || 'loom/authz'
    this.timeout = config.timeout || 5000
    this.cacheTTL = config.cacheTTL !== undefined ? config.cacheTTL : 60000
    this.maxCacheSize = config.maxCacheSize || 10000
    
    // Start periodic cache eviction to prevent memory leaks
    if (this.cacheTTL > 0) {
      this.startCacheEviction()
    }
  }
  
  async authorize(
    context: AuthorizationContext,
    action: ResourceAction
  ): Promise<AuthorizationDecision> {
    // Validate inputs
    if (!context.principal.actorId || !context.principal.actorType || !context.principal.tenantId) {
      throw new Error('Principal actorId, actorType, and tenantId are required')
    }
    
    if (!action.resource || !action.action) {
      throw new Error('Action resource and action are required')
    }
    
    // Compute cache key once to avoid TOCTOU issues
    const cacheKey = this.cacheTTL > 0 ? this.getCacheKey(context, action) : null
    
    // Check cache first (with atomic read)
    if (cacheKey) {
      const cached = this.cache.get(cacheKey)
      
      if (cached && cached.expiresAt > Date.now()) {
        // Return deep clone to prevent caller from mutating cached decision
        return this.cloneDecision(cached.decision)
      }
    }
    
    // Build OPA input
    const input = {
      principal: context.principal,
      action: action,
      delegationChain: context.delegationChain,
      claims: context.claims,
      sessionId: context.sessionId,
      metadata: context.metadata,
      timestamp: new Date().toISOString()
    }
    
    // Query OPA - encode path components to handle special characters
    const pathComponents = this.policyPath.split('.').map(encodeURIComponent)
    const url = `${this.config.endpoint}/v1/data/${pathComponents.join('/')}`
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers
        },
        body: JSON.stringify({ input }),
        signal: controller.signal
      })
      
      if (!response.ok) {
        throw new Error(`OPA request failed: ${response.status} ${response.statusText}`)
      }
      
      let result: OPAResponse
      try {
        // Check if already aborted before reading body
        if (controller.signal.aborted) {
          throw new Error('Request aborted before reading response')
        }
        result = await response.json() as OPAResponse
      } catch (jsonError) {
        if (jsonError instanceof Error && jsonError.name === 'AbortError') {
          throw new Error('Request timed out while reading response')
        }
        throw new Error(`Invalid JSON response from OPA: ${jsonError instanceof Error ? jsonError.message : 'Unknown error'}`)
      }
      
      // Type-safe access to OPA response
      const decision: AuthorizationDecision = {
        allow: result.result?.allow === true,
        reason: result.result?.reason,
        requiredPermissions: result.result?.requiredPermissions,
        metadata: result.result?.metadata
      }
      
      // Cache successful decisions (only allow=true to avoid caching transient denials)
      if (cacheKey && decision.allow) {
        // Atomic cache update - use the pre-computed key
        this.addToCache(cacheKey, decision)
      }
      
      return decision
      
    } catch (error) {
      // Fail-safe: Deny on error and log
      console.error('[OPA Authorization] Error querying OPA:', error)
      
      return {
        allow: false,
        reason: `Authorization service error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: { error: true }
      }
    } finally {
      // Always clear timeout to prevent leak
      clearTimeout(timeoutId)
    }
  }
  
  async batchAuthorize(
    context: AuthorizationContext,
    actions: ResourceAction[]
  ): Promise<AuthorizationDecision[]> {
    // Handle empty batch
    if (actions.length === 0) {
      return []
    }
    
    // Validate inputs
    if (!context.principal.actorId || !context.principal.actorType || !context.principal.tenantId) {
      throw new Error('Principal actorId, actorType, and tenantId are required')
    }
    
    // OPA supports batch queries - more efficient than N requests
    const input = {
      principal: context.principal,
      actions: actions,
      delegationChain: context.delegationChain,
      claims: context.claims,
      sessionId: context.sessionId,
      metadata: context.metadata,
      timestamp: new Date().toISOString()
    }
    
    const batchPolicyPath = `${this.policyPath}/batch`
    const pathComponents = batchPolicyPath.split('.').map(encodeURIComponent)
    const url = `${this.config.endpoint}/v1/data/${pathComponents.join('/')}`
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers
        },
        body: JSON.stringify({ input }),
        signal: controller.signal
      })
      
      if (!response.ok) {
        throw new Error(`OPA batch request failed: ${response.status}`)
      }
      
      let result: OPABatchResponse
      try {
        // Check if already aborted before reading body
        if (controller.signal.aborted) {
          throw new Error('Batch request aborted before reading response')
        }
        result = await response.json() as OPABatchResponse
      } catch (jsonError) {
        if (jsonError instanceof Error && jsonError.name === 'AbortError') {
          throw new Error('Batch request timed out while reading response')
        }
        throw new Error(`Invalid JSON response from OPA batch: ${jsonError instanceof Error ? jsonError.message : 'Unknown error'}`)
      }
      
      const decisions = result.result?.decisions
      
      // Validate response length matches request
      if (decisions && decisions.length !== actions.length) {
        console.error(`[OPA Authorization] Decision count mismatch: expected ${actions.length}, got ${decisions.length}`)
        // Fallback to deny-all for safety
        return actions.map(() => ({ 
          allow: false, 
          reason: 'Invalid batch response from OPA' 
        }))
      }
      
      return decisions || actions.map(() => ({ 
        allow: false, 
        reason: 'Batch authorization failed' 
      }))
      
    } catch (error) {
      console.error('[OPA Authorization] Error in batch query:', error)
      
      // Fail-safe: Deny all on error
      return actions.map(() => ({
        allow: false,
        reason: 'Authorization service error',
        metadata: { error: true }
      }))
    } finally {
      // Always clear timeout to prevent leak
      clearTimeout(timeoutId)
    }
  }
  
  clearCache(retryCount = 0): void {
    // Prevent infinite recursion - max 100 retries (1 second)
    if (retryCount > 100) {
      console.error('[OPA Authorization] clearCache exceeded retry limit - forcing clear')
      this.cache.clear()
      return
    }
    
    // Wait for any in-progress operations
    if (this.cacheOperationInProgress) {
      // Defer clear to avoid race condition
      setTimeout(() => this.clearCache(retryCount + 1), 10)
      return
    }
    
    this.cacheOperationInProgress = true
    try {
      this.cache.clear()
    } finally {
      this.cacheOperationInProgress = false
    }
  }
  
  /**
   * Clean up resources (stop eviction timer)
   */
  destroy(retryCount = 0): void {
    // Prevent infinite recursion - max 100 retries (1 second)
    if (retryCount > 100) {
      console.error('[OPA Authorization] destroy exceeded retry limit - forcing cleanup')
      if (this.evictionTimer) {
        clearInterval(this.evictionTimer)
        this.evictionTimer = undefined
      }
      this.cache.clear()
      return
    }
    
    // Stop eviction timer first
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer)
      this.evictionTimer = undefined
    }
    
    // Wait for in-progress operations before clearing cache
    if (this.cacheOperationInProgress) {
      setTimeout(() => this.destroy(retryCount + 1), 10)
      return
    }
    
    this.cacheOperationInProgress = true
    try {
      this.cache.clear()
    } finally {
      this.cacheOperationInProgress = false
    }
  }
  
  /**
   * Start periodic cache eviction to remove expired entries
   */
  private startCacheEviction(): void {
    // Run eviction every 30 seconds
    this.evictionTimer = setInterval(() => {
      this.evictExpiredEntries()
    }, 30000)
    
    // Don't prevent process exit
    if (this.evictionTimer.unref) {
      this.evictionTimer.unref()
    }
  }
  
  /**
   * Remove expired entries from cache
   */
  private evictExpiredEntries(): void {
    // Skip if cache operation already in progress to avoid race conditions
    if (this.cacheOperationInProgress) {
      return
    }
    
    this.cacheOperationInProgress = true
    try {
      const now = Date.now()
      const keysToDelete: string[] = []
      
      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt <= now) {
          keysToDelete.push(key)
        }
      }
      
      for (const key of keysToDelete) {
        this.cache.delete(key)
      }
      
      if (keysToDelete.length > 0) {
        console.debug(`[OPA Authorization] Evicted ${keysToDelete.length} expired cache entries`)
      }
    } finally {
      this.cacheOperationInProgress = false
    }
  }
  
  private getCacheKey(context: AuthorizationContext, action: ResourceAction): string {
    // Create a deterministic cache key from context and action
    // Use URL encoding to prevent separator collision
    const parts = [
      encodeURIComponent(context.principal.actorId),
      encodeURIComponent(context.principal.actorType),
      encodeURIComponent(context.principal.tenantId),
      encodeURIComponent(action.resource),
      encodeURIComponent(action.action)
    ]
    
    // Add action-specific fields in deterministic order
    if ('target' in action && action.target) {
      parts.push(`t:${encodeURIComponent(action.target)}`)
    }
    if ('tenantId' in action && action.tenantId) {
      parts.push(`tid:${encodeURIComponent(action.tenantId)}`)
    }
    if ('threadId' in action && action.resource === 'memory' && action.threadId) {
      parts.push(`th:${encodeURIComponent(action.threadId)}`)
    }
    
    // Use | as separator - now safe since all values are URL-encoded
    return parts.join('|')
  }
  
  /**
   * Deep clone an authorization decision to prevent mutation
   */
  private cloneDecision(decision: AuthorizationDecision): AuthorizationDecision {
    return {
      allow: decision.allow,
      reason: decision.reason,
      requiredPermissions: decision.requiredPermissions ? [...decision.requiredPermissions] : undefined,
      // Deep clone metadata using JSON (handles nested objects)
      metadata: decision.metadata ? JSON.parse(JSON.stringify(decision.metadata)) : undefined
    }
  }
  
  /**
   * Atomically add entry to cache with proper LRU eviction
   */
  private addToCache(cacheKey: string, decision: AuthorizationDecision): void {
    // Skip if eviction in progress to avoid race conditions
    if (this.cacheOperationInProgress) {
      return
    }
    
    this.cacheOperationInProgress = true
    try {
      // Check if a fresher entry already exists (prevents stale overwrites)
      const existing = this.cache.get(cacheKey)
      if (existing && existing.expiresAt > Date.now()) {
        // Don't overwrite fresh cache entry with potentially stale decision
        return
      }
      
      // Enforce cache size limit with proper LRU (evict soonest-to-expire)
      if (this.cache.size >= this.maxCacheSize) {
        let oldestKey: string | null = null
        let oldestExpiry = Infinity
        
        // Find entry that expires soonest
        for (const [key, entry] of this.cache.entries()) {
          if (entry.expiresAt < oldestExpiry) {
            oldestExpiry = entry.expiresAt
            oldestKey = key
          }
        }
        
        if (oldestKey) {
          this.cache.delete(oldestKey)
        }
      }
      
      // Add new entry
      this.cache.set(cacheKey, {
        decision,
        expiresAt: Date.now() + this.cacheTTL
      })
    } finally {
      this.cacheOperationInProgress = false
    }
  }
}
