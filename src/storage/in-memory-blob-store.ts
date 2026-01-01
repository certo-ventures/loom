import type { BlobStore } from './blob-store'

/**
 * InMemoryBlobStore - Simple in-memory implementation for testing
 */
export class InMemoryBlobStore implements BlobStore {
  private store = new Map<string, Buffer>()

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '⚠️  [InMemoryBlobStore] Using in-memory adapter in production. ' +
        'This is not recommended for distributed systems. ' +
        'Use AzureBlobStore instead.'
      )
    }
  }

  async upload(path: string, data: Buffer): Promise<string> {
    this.store.set(path, data)
    return `memory://${path}`
  }

  async download(path: string): Promise<Buffer> {
    const data = this.store.get(path)
    if (!data) {
      throw new Error(`Blob not found: ${path}`)
    }
    return data
  }

  async exists(path: string): Promise<boolean> {
    return this.store.has(path)
  }

  async delete(path: string): Promise<void> {
    this.store.delete(path)
  }

  // Helper for testing
  clear(): void {
    this.store.clear()
  }
}
