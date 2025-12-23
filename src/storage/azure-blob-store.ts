import { BlobServiceClient, ContainerClient } from '@azure/storage-blob'
import type { BlobStore } from './blob-store'

/**
 * AzureBlobStore - Azure Blob Storage implementation
 * 
 * Uses Azure Blob Storage for storing large binary data (WASM modules, payloads)
 * 
 * Usage:
 *   const store = new AzureBlobStore(connectionString, 'my-container')
 *   await store.initialize()
 *   await store.upload('actors/reviewer.wasm', buffer)
 */
export class AzureBlobStore implements BlobStore {
  private containerClient: ContainerClient | null = null

  constructor(
    private connectionString: string,
    private containerName: string = 'loom-blobs'
  ) {}

  /**
   * Initialize container (creates if not exists)
   */
  async initialize(): Promise<void> {
    const blobServiceClient = BlobServiceClient.fromConnectionString(
      this.connectionString
    )

    this.containerClient = blobServiceClient.getContainerClient(this.containerName)

    // Create container if it doesn't exist
    await this.containerClient.createIfNotExists()
  }

  private ensureInitialized(): ContainerClient {
    if (!this.containerClient) {
      throw new Error('AzureBlobStore not initialized. Call initialize() first.')
    }
    return this.containerClient
  }

  async upload(path: string, data: Buffer): Promise<string> {
    const containerClient = this.ensureInitialized()

    const blockBlobClient = containerClient.getBlockBlobClient(path)

    await blockBlobClient.upload(data, data.length, {
      blobHTTPHeaders: {
        blobContentType: this.getContentType(path),
      },
    })

    return blockBlobClient.url
  }

  async download(path: string): Promise<Buffer> {
    const containerClient = this.ensureInitialized()

    const blockBlobClient = containerClient.getBlockBlobClient(path)

    try {
      const downloadResponse = await blockBlobClient.download(0)

      if (!downloadResponse.readableStreamBody) {
        throw new Error(`Blob ${path} has no content`)
      }

      return await this.streamToBuffer(downloadResponse.readableStreamBody)
    } catch (error: any) {
      if (error.statusCode === 404) {
        throw new Error(`Blob not found: ${path}`)
      }
      throw error
    }
  }

  async exists(path: string): Promise<boolean> {
    const containerClient = this.ensureInitialized()

    const blockBlobClient = containerClient.getBlockBlobClient(path)

    return await blockBlobClient.exists()
  }

  async delete(path: string): Promise<void> {
    const containerClient = this.ensureInitialized()

    const blockBlobClient = containerClient.getBlockBlobClient(path)

    await blockBlobClient.deleteIfExists()
  }

  /**
   * List all blobs with optional prefix
   */
  async list(prefix?: string): Promise<string[]> {
    const containerClient = this.ensureInitialized()

    const blobs: string[] = []

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      blobs.push(blob.name)
    }

    return blobs
  }

  private async streamToBuffer(readableStream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []

      readableStream.on('data', (chunk) => {
        chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk))
      })

      readableStream.on('end', () => {
        resolve(Buffer.concat(chunks))
      })

      readableStream.on('error', reject)
    })
  }

  private getContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase()

    const contentTypes: Record<string, string> = {
      wasm: 'application/wasm',
      json: 'application/json',
      txt: 'text/plain',
      bin: 'application/octet-stream',
    }

    return contentTypes[ext || ''] || 'application/octet-stream'
  }
}
