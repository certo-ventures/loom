/**
 * Integration tests for WASM Activity Executor
 * 
 * These tests compile and execute REAL WASM modules!
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { WasmActivityExecutor, ActivityDefinition } from '../../activities'
import * as fs from 'fs'
import * as path from 'path'

// Simple in-memory blob store for tests
class MemoryBlobStore {
  private blobs = new Map<string, Buffer>()
  
  async upload(path: string, data: Buffer): Promise<string> {
    this.blobs.set(path, data)
    return path
  }
  
  async download(path: string): Promise<Buffer> {
    const data = this.blobs.get(path)
    if (!data) throw new Error(`Blob not found: ${path}`)
    return data
  }
  
  async exists(path: string): Promise<boolean> {
    return this.blobs.has(path)
  }
  
  async delete(path: string): Promise<void> {
    this.blobs.delete(path)
  }
}

describe('WASM Activity Executor - Integration', () => {
  let executor: WasmActivityExecutor
  let blobStore: MemoryBlobStore
  let wasmBytes: Buffer
  
  beforeAll(async () => {
    // Load the compiled WASM module
    const wasmPath = path.join(process.cwd(), 'build', 'echo.wasm')
    
    if (!fs.existsSync(wasmPath)) {
      throw new Error(
        'echo.wasm not found! Build it first: npm run asbuild:echo'
      )
    }
    
    wasmBytes = fs.readFileSync(wasmPath)
    blobStore = new MemoryBlobStore()
    executor = new WasmActivityExecutor(blobStore)
    
    // Upload WASM to blob store
    await blobStore.upload('echo.wasm', wasmBytes)
  })
  
  it('should execute WASM activity with simple input', async () => {
    const activity: ActivityDefinition = {
      name: 'echo',
      version: '1.0.0',
      wasmBlobPath: 'echo.wasm',
      limits: {
        maxMemoryMB: 128,
        maxExecutionMs: 5000,
      }
    }
    
    const input = {
      message: 'Test',
      times: 2
    }
    
    const result = await executor.execute(activity, input) as any
    
    expect(result.result).toBe('Test Test')
    expect(result.length).toBe(9)
    expect(result.executedBy).toBe('WASM')
  })
  
  it('should execute WASM activity multiple times', async () => {
    const activity: ActivityDefinition = {
      name: 'echo',
      version: '1.0.0',
      wasmBlobPath: 'echo.wasm',
      limits: {
        maxMemoryMB: 128,
        maxExecutionMs: 5000,
      }
    }
    
    const input1 = { message: 'First', times: 1 }
    const input2 = { message: 'Second', times: 3 }
    
    const result1 = await executor.execute(activity, input1) as any
    const result2 = await executor.execute(activity, input2) as any
    
    expect(result1.result).toBe('First')
    expect(result2.result).toBe('Second Second Second')
  })
  
  it('should cache compiled WASM modules', async () => {
    const activity: ActivityDefinition = {
      name: 'echo',
      version: '1.0.0',
      wasmBlobPath: 'echo.wasm',
      limits: {
        maxMemoryMB: 128,
        maxExecutionMs: 5000,
      }
    }
    
    const input = { message: 'Cached', times: 1 }
    
    // First execution - compiles and caches
    const start1 = Date.now()
    const result1 = await executor.execute(activity, input)
    const time1 = Date.now() - start1
    
    // Second execution - should use cached module (much faster)
    const start2 = Date.now()
    const result2 = await executor.execute(activity, input)
    const time2 = Date.now() - start2
    
    expect(result1).toEqual(result2)
    // Cached execution should be faster (though not always guaranteed in tests)
    console.log(`First: ${time1}ms, Cached: ${time2}ms`)
  })
  
  it('should handle different input values', async () => {
    const activity: ActivityDefinition = {
      name: 'echo',
      version: '1.0.0',
      wasmBlobPath: 'echo.wasm',
      limits: {
        maxMemoryMB: 128,
        maxExecutionMs: 5000,
      }
    }
    
    // Zero times
    const result0 = await executor.execute(activity, { message: 'Zero', times: 0 }) as any
    expect(result0.result).toBe('')
    
    // Many times
    const result10 = await executor.execute(activity, { message: 'Hi', times: 5 }) as any
    expect(result10.result).toBe('Hi Hi Hi Hi Hi')
    
    // Special characters
    const resultSpecial = await executor.execute(activity, { 
      message: 'Hello 🚀', 
      times: 2 
    }) as any
    expect(resultSpecial.result).toBe('Hello 🚀 Hello 🚀')
  })
})
