/**
 * In-Memory Blob Storage - Simple key-value store for testing
 * 
 * Store any data as blobs
 * REAL enough to test the system!
 */

export interface BlobMetadata {
  contentType?: string;
  contentLength: number;
  lastModified: Date;
  [key: string]: any;
}

export interface Blob {
  data: Buffer;
  metadata: BlobMetadata;
}

/**
 * Simple in-memory blob storage
 * Key-value store with metadata
 */
export class InMemoryBlobStorage {
  private blobs = new Map<string, Blob>();

  /**
   * Upload blob
   */
  async upload(key: string, data: Buffer | string, metadata?: Partial<BlobMetadata>): Promise<void> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    
    this.blobs.set(key, {
      data: buffer,
      metadata: {
        contentLength: buffer.length,
        lastModified: new Date(),
        ...metadata,
      },
    });
  }

  /**
   * Download blob
   */
  async download(key: string): Promise<Buffer | null> {
    const blob = this.blobs.get(key);
    return blob ? blob.data : null;
  }

  /**
   * Get blob metadata
   */
  async getMetadata(key: string): Promise<BlobMetadata | null> {
    const blob = this.blobs.get(key);
    return blob ? blob.metadata : null;
  }

  /**
   * Delete blob
   */
  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }

  /**
   * Check if blob exists
   */
  async exists(key: string): Promise<boolean> {
    return this.blobs.has(key);
  }

  /**
   * List blobs by prefix
   */
  async list(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.blobs.keys());
    if (prefix) {
      return keys.filter(key => key.startsWith(prefix));
    }
    return keys;
  }

  /**
   * Clear all blobs (for testing)
   */
  async clear(): Promise<void> {
    this.blobs.clear();
  }

  /**
   * Get blob count (for testing)
   */
  count(): number {
    return this.blobs.size;
  }
}
