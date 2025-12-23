/**
 * WASM Actor Executor - Loads and executes WASM actors from registry
 * 
 * Implements ActorExecutor interface for real actor orchestration
 */

import type { ActorExecutor } from '../ai'
import type { DataStore } from '../../packages/loom-server/src/registry/data-store'
import type { ActorMetadata } from '../../packages/loom-server/src/types'
import Ajv from 'ajv'

const ajv = new Ajv({ allErrors: true })

export interface WasmActorExecutorOptions {
  dataStore: DataStore
  enableCache?: boolean
  defaultTimeout?: number
  validateSchemas?: boolean
}

/**
 * Executes WASM actors from the registry
 */
export class WasmActorExecutor implements ActorExecutor {
  private moduleCache = new Map<string, WebAssembly.Module>()
  private metadataCache = new Map<string, ActorMetadata>()

  constructor(private options: WasmActorExecutorOptions) {}

  /**
   * Execute an actor from the registry
   */
  async execute(
    actorId: string,
    version: string | undefined,
    input: any
  ): Promise<any> {
    // Get actor metadata
    const metadata = await this.getActorMetadata(actorId, version)
    if (!metadata) {
      throw new Error(`Actor not found: ${actorId}@${version || 'latest'}`)
    }

    // Validate input schema
    if (this.options.validateSchemas !== false && metadata.inputSchema) {
      const valid = ajv.validate(metadata.inputSchema, input)
      if (!valid) {
        throw new Error(
          `Input validation failed: ${JSON.stringify(ajv.errors, null, 2)}`
        )
      }
    }

    // Load WASM module
    const module = await this.loadWasmModule(metadata)

    // Execute with timeout
    const timeout = metadata.maxExecutionTime
      ? metadata.maxExecutionTime * 1000
      : this.options.defaultTimeout || 30000

    const result = await this.executeWithTimeout(
      () => this.executeWasm(module, metadata, input),
      timeout
    )

    // Validate output schema
    if (this.options.validateSchemas !== false && metadata.outputSchema) {
      const valid = ajv.validate(metadata.outputSchema, result)
      if (!valid) {
        throw new Error(
          `Output validation failed: ${JSON.stringify(ajv.errors, null, 2)}`
        )
      }
    }

    return result
  }

  /**
   * Get actor metadata (with caching)
   */
  private async getActorMetadata(
    actorId: string,
    version?: string
  ): Promise<ActorMetadata | null> {
    const cacheKey = `${actorId}:${version || 'latest'}`

    if (this.options.enableCache !== false) {
      const cached = this.metadataCache.get(cacheKey)
      if (cached) return cached
    }

    const metadata = await this.options.dataStore.getActorMetadata(actorId, version)
    
    if (metadata && this.options.enableCache !== false) {
      this.metadataCache.set(cacheKey, metadata)
    }

    return metadata
  }

  /**
   * Load WASM module from storage (with caching)
   */
  private async loadWasmModule(metadata: ActorMetadata): Promise<WebAssembly.Module> {
    const cacheKey = `${metadata.actorId}:${metadata.version}`

    if (this.options.enableCache !== false) {
      const cached = this.moduleCache.get(cacheKey)
      if (cached) return cached
    }

    // Download WASM from storage
    const wasmBuffer = await this.options.dataStore.getWasmModule(
      metadata.actorId,
      metadata.version
    )

    if (!wasmBuffer) {
      throw new Error(
        `WASM module not found: ${metadata.actorId}@${metadata.version}`
      )
    }

    // Compile WASM
    const module = await WebAssembly.compile(wasmBuffer)

    if (this.options.enableCache !== false) {
      this.moduleCache.set(cacheKey, module)
    }

    return module
  }

  /**
   * Execute WASM module
   */
  private async executeWasm(
    module: WebAssembly.Module,
    metadata: ActorMetadata,
    input: any
  ): Promise<any> {
    // Create imports
    const imports = this.createImports(metadata)

    // Instantiate WASM
    const instance = await WebAssembly.instantiate(module, imports)

    // Get execute function
    // @ts-ignore - WebAssembly exports type issue
    const executeFn = instance.exports.execute as CallableFunction
    if (!executeFn) {
      throw new Error(`Actor ${metadata.actorId} must export an "execute" function`)
    }

    // @ts-ignore - WebAssembly exports type issue
    const exports = instance.exports as any

    // Serialize input to JSON string
    const inputJson = JSON.stringify(input)

    // Allocate input string in WASM memory
    const inputPtr = this.allocateString(exports, inputJson)

    // Execute
    const resultPtr = executeFn(inputPtr) as number

    // Read result string from WASM memory
    const resultJson = this.readString(exports, resultPtr)

    // Parse and return
    try {
      // Trim any whitespace/garbage
      const cleaned = resultJson.trim()
      return JSON.parse(cleaned)
    } catch (e) {
      console.error('Failed to parse WASM output:', resultJson)
      console.error('Bytes:', Buffer.from(resultJson).toString('hex'))
      throw e
    }
  }

  /**
   * Allocate JavaScript string in WASM memory (AssemblyScript format)
   */
  private allocateString(exports: any, str: string): number {
    const buffer = Buffer.from(str, 'utf16le')
    const len = buffer.length
    const ptr = exports.__new(len, 1) // AssemblyScript allocator
    const mem = new Uint8Array(exports.memory.buffer)
    mem.set(buffer, ptr)
    return ptr
  }

  /**
   * Read string from WASM memory (AssemblyScript format - UTF-16LE)
   */
  private readString(exports: any, ptr: number): string {
    const mem = new Uint8Array(exports.memory.buffer)

    // Find the closing brace for JSON (UTF-16LE: } = 0x7D, 0x00)
    let closeBraceIdx = -1
    for (let i = ptr; i < ptr + 20000; i += 2) {
      if (mem[i] === 0x7D && mem[i + 1] === 0x00) { // '}' in UTF-16LE
        closeBraceIdx = i
        break
      }
    }

    if (closeBraceIdx === -1) {
      throw new Error('Could not find end of JSON string in WASM memory')
    }

    // Read up to and including the closing brace (UTF-16LE pairs)
    const len = closeBraceIdx - ptr + 2
    const buffer = mem.slice(ptr, ptr + len)
    return Buffer.from(buffer).toString('utf16le')
  }

  /**
   * Create WASM imports based on actor capabilities
   */
  private createImports(metadata: ActorMetadata): WebAssembly.Imports {
    return {
      env: {
        // AssemblyScript abort function
        abort: (msg: number, file: number, line: number, column: number) => {
          throw new Error(
            `WASM abort in ${metadata.actorId} at line ${line}, column ${column}`
          )
        },
        // Add more capabilities based on policy
        // TODO: Implement network, filesystem, etc. based on metadata.policy
      },
    }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Actor execution timeout after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ])
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.moduleCache.clear()
    this.metadataCache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      modules: this.moduleCache.size,
      metadata: this.metadataCache.size,
    }
  }
}
