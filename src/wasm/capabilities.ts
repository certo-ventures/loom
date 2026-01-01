/**
 * WASM Capability Manifest
 * 
 * Security model: Explicit capability declarations
 * - No ambient authority
 * - Fail-closed by default
 * - Timeout enforcement
 */

/**
 * WASM module capabilities
 */
export interface WasmCapabilities {
  /** Allow network access (HTTP/HTTPS) */
  network?: boolean
  
  /** Allow file system access */
  filesystem?: boolean
  
  /** Allow environment variable access */
  env?: boolean
  
  /** Allow random number generation */
  random?: boolean
  
  /** Allow date/time access */
  time?: boolean
  
  /** Maximum execution time in milliseconds */
  timeout?: number
  
  /** Maximum memory in MB */
  maxMemoryMB?: number
  
  /** Allow access to specific host functions */
  hostFunctions?: string[]
}

/**
 * WASM execution context with enforced capabilities
 */
export interface WasmExecutionContext {
  /** Module capabilities */
  capabilities: WasmCapabilities
  
  /** Execution timeout in ms */
  timeout: number
  
  /** Start time for timeout enforcement */
  startTime?: number
  
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal
}

/**
 * Default safe capabilities (minimal access)
 */
export const DEFAULT_CAPABILITIES: WasmCapabilities = {
  network: false,
  filesystem: false,
  env: false,
  random: true,
  time: true,
  timeout: 5000, // 5 second default
  maxMemoryMB: 64,
  hostFunctions: [],
}

/**
 * Capability validation error
 */
export class CapabilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityError'
  }
}

/**
 * Execution timeout error
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * Validate capability request
 */
export function validateCapabilities(requested: WasmCapabilities, allowed: WasmCapabilities): void {
  if (requested.network && !allowed.network) {
    throw new CapabilityError('Network access not permitted')
  }
  
  if (requested.filesystem && !allowed.filesystem) {
    throw new CapabilityError('Filesystem access not permitted')
  }
  
  if (requested.env && !allowed.env) {
    throw new CapabilityError('Environment variable access not permitted')
  }
  
  if (requested.maxMemoryMB && allowed.maxMemoryMB && requested.maxMemoryMB > allowed.maxMemoryMB) {
    throw new CapabilityError(`Memory limit exceeded: requested ${requested.maxMemoryMB}MB, allowed ${allowed.maxMemoryMB}MB`)
  }
  
  if (requested.timeout && allowed.timeout && requested.timeout > allowed.timeout) {
    throw new CapabilityError(`Timeout limit exceeded: requested ${requested.timeout}ms, allowed ${allowed.timeout}ms`)
  }
  
  // Check host function allowlist
  if (requested.hostFunctions && allowed.hostFunctions) {
    const disallowed = requested.hostFunctions.filter(fn => !allowed.hostFunctions!.includes(fn))
    if (disallowed.length > 0) {
      throw new CapabilityError(`Host functions not permitted: ${disallowed.join(', ')}`)
    }
  }
}

/**
 * Create execution context with timeout enforcement
 */
export function createExecutionContext(
  capabilities: WasmCapabilities,
  timeoutMs?: number
): WasmExecutionContext {
  const timeout = timeoutMs || capabilities.timeout || DEFAULT_CAPABILITIES.timeout!
  const abortController = new AbortController()
  
  // Set timeout
  const timeoutId = setTimeout(() => {
    abortController.abort()
  }, timeout)
  
  // Clear timeout on abort
  abortController.signal.addEventListener('abort', () => {
    clearTimeout(timeoutId)
  })
  
  return {
    capabilities,
    timeout,
    startTime: Date.now(),
    abortSignal: abortController.signal,
  }
}

/**
 * Check if execution has timed out
 */
export function checkTimeout(context: WasmExecutionContext): void {
  if (!context.startTime) return
  
  const elapsed = Date.now() - context.startTime
  if (elapsed > context.timeout) {
    throw new TimeoutError(`Execution timed out after ${elapsed}ms (limit: ${context.timeout}ms)`)
  }
  
  if (context.abortSignal?.aborted) {
    throw new TimeoutError(`Execution aborted`)
  }
}

/**
 * Capability manifest for a WASM module
 */
export interface WasmManifest {
  /** Module name */
  name: string
  
  /** Module version */
  version: string
  
  /** Required capabilities */
  capabilities: WasmCapabilities
  
  /** Module description */
  description?: string
  
  /** Module author */
  author?: string
  
  /** Exported functions */
  exports?: string[]
}

/**
 * Load and validate manifest
 */
export function validateManifest(manifest: WasmManifest, allowedCapabilities: WasmCapabilities): void {
  if (!manifest.name) {
    throw new Error('Manifest missing required field: name')
  }
  
  if (!manifest.version) {
    throw new Error('Manifest missing required field: version')
  }
  
  if (!manifest.capabilities) {
    throw new Error('Manifest missing required field: capabilities')
  }
  
  // Validate capabilities
  validateCapabilities(manifest.capabilities, allowedCapabilities)
}
