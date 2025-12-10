/**
 * BlobStore - Store and retrieve large binary data (WASM modules, payloads)
 */
export interface BlobStore {
  /**
   * Upload data to blob storage
   */
  upload(path: string, data: Buffer): Promise<string>

  /**
   * Download data from blob storage
   */
  download(path: string): Promise<Buffer>

  /**
   * Check if blob exists
   */
  exists(path: string): Promise<boolean>

  /**
   * Delete a blob
   */
  delete(path: string): Promise<void>
}
