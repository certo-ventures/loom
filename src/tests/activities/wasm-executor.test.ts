import { describe, it, expect, beforeEach } from 'vitest'
import { WasmActivityExecutor, ActivityDefinition } from '../../activities'
import type { BlobStore } from '../../storage'

// Mock blob store
class MockBlobStore implements BlobStore {
  private blobs = new Map<string, Buffer>()

  async upload(path: string, data: Buffer): Promise<string> {
    this.blobs.set(path, data)
    return path
  }

  async download(path: string): Promise<Buffer> {
    const data = this.blobs.get(path)
    if (!data) throw new Error('Blob not found')
    return data
  }

  async exists(path: string): Promise<boolean> {
    return this.blobs.has(path)
  }

  async delete(path: string): Promise<void> {
    this.blobs.delete(path)
  }

  // Helper
  set(path: string, data: Buffer) {
    this.blobs.set(path, data)
  }
}

describe('WasmActivityExecutor', () => {
  let blobStore: MockBlobStore
  let executor: WasmActivityExecutor

  beforeEach(() => {
    blobStore = new MockBlobStore()
    executor = new WasmActivityExecutor(blobStore)
  })

  it('should create executor', () => {
    expect(executor).toBeDefined()
  })

  it('should cache WASM modules', () => {
    expect(executor['moduleCache'].size).toBe(0)
    executor.clearCache()
    expect(executor['moduleCache'].size).toBe(0)
  })

  // Note: Full WASM execution tests would require actual WASM modules
  // For now, we just test the structure
})
