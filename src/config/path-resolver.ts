/**
 * Hierarchical Path Resolution Logic
 * 
 * Implements fallback resolution strategy:
 * Most specific → Least specific → Global default
 */

import type { ConfigContext } from './index'

/**
 * Build hierarchical key paths from context
 * Returns paths in order of specificity (most specific first)
 * 
 * Example:
 * buildKeyPaths("azure-openai", { clientId: "acme", tenantId: "finance", environment: "prod" })
 * Returns:
 * [
 *   "acme/finance/prod/azure-openai",
 *   "acme/finance/azure-openai",
 *   "acme/prod/azure-openai",
 *   "acme/azure-openai",
 *   "prod/azure-openai",
 *   "azure-openai",
 *   "global/azure-openai"
 * ]
 */
export function buildKeyPaths(key: string, context: ConfigContext): string[] {
  const paths: string[] = []
  
  // Extract context dimensions in priority order
  const dimensions: Array<{ name: string; value: string }> = []
  
  if (context.clientId) dimensions.push({ name: 'clientId', value: context.clientId })
  if (context.tenantId) dimensions.push({ name: 'tenantId', value: context.tenantId })
  if (context.userId) dimensions.push({ name: 'userId', value: context.userId })
  if (context.environment) dimensions.push({ name: 'environment', value: context.environment })
  if (context.region) dimensions.push({ name: 'region', value: context.region })
  
  // Build all combinations from most specific to least specific
  // Using bit manipulation to generate all subsets
  const numDimensions = dimensions.length
  const numCombinations = Math.pow(2, numDimensions)
  
  // Generate combinations sorted by specificity (number of dimensions included)
  const combinations: string[][] = []
  
  for (let i = numCombinations - 1; i >= 0; i--) {
    const combo: string[] = []
    for (let j = 0; j < numDimensions; j++) {
      if (i & (1 << j)) {
        combo.push(dimensions[j].value)
      }
    }
    if (combo.length > 0) {
      combinations.push(combo)
    }
  }
  
  // Sort by specificity (most dimensions first)
  combinations.sort((a, b) => b.length - a.length)
  
  // Build paths
  for (const combo of combinations) {
    paths.push([...combo, key].join('/'))
  }
  
  // Add bare key
  paths.push(key)
  
  // Add global fallback
  paths.push(`global/${key}`)
  
  return paths
}

/**
 * Parse a key path into its components
 * 
 * Example: "acme/finance/prod/azure-openai" → 
 * { clientId: "acme", tenantId: "finance", environment: "prod", key: "azure-openai" }
 */
export function parseKeyPath(keyPath: string): {
  segments: string[]
  key: string
  context: Partial<ConfigContext>
} {
  const segments = keyPath.split('/').filter(s => s.length > 0)
  const key = segments[segments.length - 1]
  
  // Try to infer context from path structure
  // This is heuristic-based since we don't enforce strict ordering
  const context: Partial<ConfigContext> = {}
  
  // Common patterns we recognize
  if (segments.length >= 2) {
    // Assume first segment could be clientId
    context.clientId = segments[0]
  }
  if (segments.length >= 3) {
    // Second segment could be tenantId
    context.tenantId = segments[1]
  }
  if (segments.length >= 4) {
    // Check for environment keywords
    const envSegment = segments[2]
    if (['prod', 'dev', 'staging', 'test', 'production', 'development'].includes(envSegment)) {
      context.environment = envSegment
    }
  }
  
  return { segments, key, context }
}

/**
 * Validate key path format
 */
export function validateKeyPath(keyPath: string): { valid: boolean; error?: string } {
  if (!keyPath || keyPath.trim().length === 0) {
    return { valid: false, error: 'Key path cannot be empty' }
  }
  
  if (keyPath.startsWith('/') || keyPath.endsWith('/')) {
    return { valid: false, error: 'Key path cannot start or end with /' }
  }
  
  if (keyPath.includes('//')) {
    return { valid: false, error: 'Key path cannot contain consecutive slashes' }
  }
  
  // Check for invalid characters
  const validPattern = /^[a-zA-Z0-9/_-]+$/
  if (!validPattern.test(keyPath)) {
    return { valid: false, error: 'Key path contains invalid characters (only a-z, A-Z, 0-9, /, _, - allowed)' }
  }
  
  return { valid: true }
}
