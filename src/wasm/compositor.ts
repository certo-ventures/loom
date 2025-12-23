/**
 * WASM Compositor - Runtime composition of WASM modules via function tables
 * 
 * This class loads multiple WASM modules and wires them together using
 * WebAssembly function tables, enabling pure WASM execution with zero host overhead.
 * 
 * Perfect for Monte Carlo simulations where billions of function calls are needed.
 */

import * as fs from 'fs'
import * as path from 'path'

export interface ModelModule {
  name: string
  wasmPath: string
  functionName: string
}

export interface CompositeEngineConfig {
  enginePath: string
  models: ModelModule[]
}

export class WasmCompositor {
  private engineModule?: WebAssembly.Module
  private engineInstance?: WebAssembly.Instance
  private modelInstances: Map<string, WebAssembly.Instance> = new Map()
  private functionTable?: WebAssembly.Table
  private memory?: WebAssembly.Memory

  constructor(private config: CompositeEngineConfig) {}

  /**
   * Load and compile all WASM modules, wire them as host imports
   */
  async initialize(): Promise<void> {
    console.log('🔧 Initializing WASM Compositor...')

    // Step 1: Create shared memory
    this.memory = new WebAssembly.Memory({ initial: 10, maximum: 100 })

    console.log(`📦 Created shared memory`)

    // Step 2: Load and instantiate model WASMs
    for (const model of this.config.models) {
      const wasmBuffer = fs.readFileSync(model.wasmPath)
      const wasmModule = await WebAssembly.compile(wasmBuffer)
      
      const result = await WebAssembly.instantiate(wasmModule, {
        env: {
          memory: this.memory,
          abort: (msg: number, file: number, line: number, col: number) => {
            console.error(`WASM abort: ${msg} at ${file}:${line}:${col}`)
          }
        }
      })

      this.modelInstances.set(model.name, result.instance)
      console.log(`✅ Loaded model: ${model.name}`)
    }

    // Step 3: Load and instantiate main engine with model functions as imports
    const engineBuffer = fs.readFileSync(this.config.enginePath)
    this.engineModule = await WebAssembly.compile(engineBuffer)
    
    // Get model instances
    const prepaymentInst = this.modelInstances.get('prepayment')!
    const defaultInst = this.modelInstances.get('default')!
    const lgdInst = this.modelInstances.get('lgd')!
    
    // Create wrapper functions that adapt signatures
    // Models are pure calculation functions, engine calls them with f64 params
    // @ts-ignore - WebAssembly exports type issue
    const prepaymentFunc = (prepaymentInst.exports as any).calculate as Function
    // @ts-ignore - WebAssembly exports type issue
    const defaultFunc = (defaultInst.exports as any).calculate as Function
    // @ts-ignore - WebAssembly exports type issue
    const lgdFunc = (lgdInst.exports as any).calculate as Function
    
    console.log(`🔗 Wired model functions to engine imports`)
    
    // @ts-ignore - WebAssembly instance type issue
    this.engineInstance = await WebAssembly.instantiate(this.engineModule, {
      env: {
        memory: this.memory,
        prepaymentModel: prepaymentFunc,
        defaultModel: defaultFunc,
        lgdModel: lgdFunc,
        abort: (msg: number, file: number, line: number, col: number) => {
          console.error(`Engine abort: ${msg} at ${file}:${line}:${col}`)
        }
      }
    })

    console.log(`🚀 Composite engine ready!`)
    console.log(`   WASM-to-WASM calls with ${this.config.models.length} composed models`)
  }

  /**
   * Execute the composite engine
   */
  execute(
    principal: number,
    rate: number,
    term: number,
    currentRate: number,
    fico: number,
    origLTV: number,
    propertyType: number,
    state: number,
    hpiChange: number
  ): any {
    if (!this.engineInstance) {
      throw new Error('Engine not initialized. Call initialize() first.')
    }

    const exports = this.engineInstance.exports as any
    
    // Call the execute function
    const resultPtr = exports.execute(
      principal,
      rate,
      term,
      currentRate,
      fico,
      origLTV,
      propertyType,
      state,
      hpiChange
    )
    
    // Read the JSON string result from WASM memory
    const result = this.readString(resultPtr)
    
    // Parse and return
    return JSON.parse(result)
  }

  /**
   * Read UTF-16LE string from WASM memory (AssemblyScript format)
   */
  private readString(ptr: number): string {
    if (!this.memory) {
      throw new Error('Memory not initialized')
    }

    // AssemblyScript strings have a 4-byte header (length) before the string data
    const view = new DataView(this.memory.buffer)
    const length = view.getUint32(ptr - 4, true)  // Read length (little-endian)
    
    const buffer = new Uint16Array(this.memory.buffer, ptr, length)
    let result = String.fromCharCode(...Array.from(buffer))
    
    // Find the end of JSON (closing brace)
    const jsonEnd = result.indexOf('}')
    if (jsonEnd !== -1) {
      result = result.substring(0, jsonEnd + 1)
    }
    
    return result
  }

  /**
   * Get statistics about the compositor
   */
  getStats() {
    return {
      modelsLoaded: this.modelInstances.size,
      memoryPages: this.memory?.buffer.byteLength ? this.memory.buffer.byteLength / 65536 : 0
    }
  }
}
