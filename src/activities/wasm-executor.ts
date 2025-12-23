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
    module = await WebAssembly.compile(new Uint8Array(wasmBytes))

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
    const wasmResult = await WebAssembly.instantiate(module, imports)
    const instance =
      'instance' in wasmResult
        ? (wasmResult as { instance: WebAssembly.Instance }).instance
        : (wasmResult as WebAssembly.Instance)

    // Get the exported execute function
    const execute = instance.exports.execute as CallableFunction
    if (!execute) {
      throw new Error('WASM module must export an "execute" function')
    }

    // Serialize input to JSON
    const inputJson = JSON.stringify(input)

    // Execute with timeout
    const timeout = definition.limits?.maxExecutionMs || 30000
    const result = await this.withTimeout(
      async () => {
        // Call the WASM function
        // AssemblyScript exports __new, __pin, __unpin, __collect for memory management
        const exports = instance.exports as any
        
        // Allocate string in WASM memory
        const strPtr = this.allocateString(exports, inputJson)
        
        // Execute
        const resultPtr = exports.execute(strPtr) as number
        
        // Read result string from WASM memory
        const resultStr = this.readString(exports, resultPtr)
        
        return resultStr
      },
      timeout
    )

    return JSON.parse(result as string)
  }
  
  /**
   * Allocate a JavaScript string in WASM memory
   */
  private allocateString(exports: any, str: string): number {
    const buffer = Buffer.from(str, 'utf16le')
    const len = buffer.length
    const ptr = exports.__new(len, 1) // Allocate memory
    const mem = new Uint8Array(exports.memory.buffer)
    mem.set(buffer, ptr)
    return ptr
  }
  
  /**
   * Read a string from WASM memory
   */
  private readString(exports: any, ptr: number): string {
    const mem = new Uint8Array(exports.memory.buffer)
    
    // Find string length (AssemblyScript strings are UTF-16)
    let len = 0
    while (mem[ptr + len] !== 0 || mem[ptr + len + 1] !== 0) {
      len += 2
      if (len > 1000000) break // Safety limit
    }
    
    const buffer = mem.slice(ptr, ptr + len)
    return Buffer.from(buffer).toString('utf16le')
  }

  /**
   * Create imports for WASM module (capabilities)
   */
  private createImports(definition: ActivityDefinition): WebAssembly.Imports {
    const imports: WebAssembly.Imports = {
      env: {
        // AssemblyScript requires an abort function
        abort: (msg: number, file: number, line: number, column: number) => {
          throw new Error(`WASM abort at line ${line}, column ${column}`)
        }
      },
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
