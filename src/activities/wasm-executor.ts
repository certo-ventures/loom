import type { BlobStore } from '../storage'

/**
 * Activity definition stored in database
 */
export interface ActivityDefinition {
  name: string
  version: string
  wasmBlobPath: string
  inputSchema?: any // Zod schema for validation
  outputSchema?: any
  capabilities?: {
    network?: boolean
    filesystem?: boolean
    env?: string[]
  }
  limits?: {
    maxMemoryMB?: number
    maxExecutionMs?: number
  }
}

/**
 * WASM Activity Executor - Loads and executes WASM modules
 */
export class WasmActivityExecutor {
  private moduleCache = new Map<string, WebAssembly.Module>()

  constructor(private blobStore: BlobStore) {}

  /**
   * Execute an activity
   */
  async execute<T = unknown>(
    definition: ActivityDefinition,
    input: unknown
  ): Promise<T> {
    // Load WASM module (with caching)
    const module = await this.loadModule(definition)

    // Execute in sandbox
    const result = await this.executeInSandbox(module, definition, input)

    return result as T
  }

  /**
   * Load WASM module from blob storage (with caching)
   */
  private async loadModule(definition: ActivityDefinition): Promise<WebAssembly.Module> {
    const cacheKey = `${definition.name}@${definition.version}`

    let module = this.moduleCache.get(cacheKey)
    if (module) {
      return module
    }

    // Download WASM from blob storage
    const wasmBytes = await this.blobStore.download(definition.wasmBlobPath)

    // Compile WASM module
    module = await WebAssembly.compile(wasmBytes)

    // Cache it
    this.moduleCache.set(cacheKey, module)

    return module
  }

  /**
   * Execute WASM in a sandbox with resource limits
   */
  private async executeInSandbox(
    module: WebAssembly.Module,
    definition: ActivityDefinition,
    input: unknown
  ): Promise<unknown> {
    // Create imports (capabilities)
    const imports = this.createImports(definition)

    // Instantiate WASM
    const instance = await WebAssembly.instantiate(module, imports)

    // Get the exported execute function
    const execute = instance.exports.execute as CallableFunction
    if (!execute) {
      throw new Error('WASM module must export an "execute" function')
    }

    // Serialize input to JSON
    const inputJson = JSON.stringify(input)

    // For now, we'll assume the WASM module exports memory and string helpers
    // In a real implementation, you'd need to pass strings via linear memory

    // Execute with timeout
    const timeout = definition.limits?.maxExecutionMs || 30000
    const result = await this.withTimeout(
      async () => {
        // Call the WASM function (simplified - real implementation needs memory management)
        return execute(inputJson)
      },
      timeout
    )

    return JSON.parse(result as string)
  }

  /**
   * Create imports for WASM module (capabilities)
   */
  private createImports(definition: ActivityDefinition): WebAssembly.Imports {
    const imports: WebAssembly.Imports = {
      env: {},
    }

    // Add capabilities based on definition
    if (definition.capabilities?.network) {
      // Add network functions
      imports.env = {
        ...imports.env,
        fetch: () => {
          /* network capability */
        },
      }
    }

    return imports
  }

  /**
   * Execute with timeout
   */
  private withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Activity timeout')), timeoutMs)
      ),
    ])
  }

  /**
   * Clear module cache
   */
  clearCache(): void {
    this.moduleCache.clear()
  }
}
