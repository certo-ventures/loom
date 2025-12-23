import { Actor } from './actor'
import type { ActorContext } from './journal'
import type { BlobStore } from '../storage/blob-store'

/**
 * WASMActorAdapter - Loads and executes WASM actors
 * 
 * Bridges WASM modules to Actor interface
 * Uses BlobStore abstraction (NO hard-coded storage!)
 */
export class WASMActorAdapter extends Actor {
  private wasmInstance?: WebAssembly.Instance
  private wasmMemory?: WebAssembly.Memory
  private blobPath: string
  private blobStore: BlobStore

  constructor(blobPath: string, blobStore: BlobStore, context: ActorContext) {
    super(context)
    this.blobPath = blobPath
    this.blobStore = blobStore
  }

  async execute(input: unknown): Promise<void> {
    // Lazy load WASM on first execute
    if (!this.wasmInstance) {
      await this.loadWASM()
    }

    // Serialize input to WASM memory
    const inputJson = JSON.stringify(input)
    const inputPtr = this.writeToWASM(inputJson)

    // Call WASM execute function
    const exports = this.wasmInstance!.exports as any

    if (!exports.execute) {
      throw new Error('WASM module must export "execute" function')
    }

    const resultPtr = exports.execute(inputPtr)

    // Read result from WASM memory
    const resultJson = this.readFromWASM(resultPtr)
    this.state = JSON.parse(resultJson)

    // Cleanup
    if (exports.free) {
      exports.free(inputPtr)
      exports.free(resultPtr)
    }
  }

  private async loadWASM(): Promise<void> {
    // Use BlobStore abstraction - works with ANY storage backend!
    const binary = await this.blobStore.download(this.blobPath)

    // Create imports for WASM module
    const importObject = this.createImports()

    // Instantiate WASM
    const wasmModule = await WebAssembly.compile(new Uint8Array(binary))
    const wasmResult = await WebAssembly.instantiate(wasmModule, importObject)
    const wasmInstance =
      'instance' in wasmResult
        ? (wasmResult as { instance: WebAssembly.Instance }).instance
        : (wasmResult as WebAssembly.Instance)
    this.wasmInstance = wasmInstance

    // Store memory reference
    if (importObject.env?.memory) {
      this.wasmMemory = importObject.env.memory
    } else if (wasmInstance.exports?.memory) {
      this.wasmMemory = wasmInstance.exports.memory as WebAssembly.Memory
    } else {
      throw new Error('WASM module must export or import memory')
    }
  }

  private createImports(): any {
    return {
      env: {
        memory: new WebAssembly.Memory({ initial: 256, maximum: 512 }),

        // Logging from WASM
        log: (ptr: number) => {
          const message = this.readFromWASM(ptr)
          console.log(`[WASM Actor ${this.blobPath}] ${message}`)
        },

        // Error handling
        abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
          const msg = this.readFromWASM(msgPtr)
          const file = this.readFromWASM(filePtr)
          throw new Error(`WASM abort: ${msg} at ${file}:${line}:${col}`)
        },
      },
    }
  }

  private writeToWASM(str: string): number {
    if (!this.wasmInstance || !this.wasmMemory) {
      throw new Error('WASM not initialized')
    }

    const exports = this.wasmInstance.exports as any

    if (!exports.alloc) {
      throw new Error('WASM module must export "alloc" function')
    }

    const encoder = new TextEncoder()
    const bytes = encoder.encode(str)
    const ptr = exports.alloc(bytes.length + 1) // +1 for null terminator

    const buffer = new Uint8Array(this.wasmMemory.buffer)
    buffer.set(bytes, ptr)
    buffer[ptr + bytes.length] = 0 // Null terminator

    return ptr
  }

  private readFromWASM(ptr: number): string {
    if (!this.wasmMemory) {
      throw new Error('WASM memory not available')
    }

    const buffer = new Uint8Array(this.wasmMemory.buffer)

    // Read null-terminated string
    let len = 0
    while (buffer[ptr + len] !== 0 && ptr + len < buffer.length) {
      len++
    }

    const bytes = buffer.slice(ptr, ptr + len)
    return new TextDecoder().decode(bytes)
  }
}
