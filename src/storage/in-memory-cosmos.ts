/**
 * In-Memory CosmosDB - Simple JSON document store for testing
 * 
 * CRUD operations on JSON documents
 * Query by partition key
 * REAL enough to test the system!
 */

export interface CosmosDocument {
  id: string;
  partitionKey: string;
  [key: string]: any;
}

export interface QueryOptions {
  partitionKey?: string;
  filter?: (doc: CosmosDocument) => boolean;
}

/**
 * Simple in-memory CosmosDB implementation
 * Just a JSON document store - SIMPLE!
 */
export class InMemoryCosmos {
  private documents = new Map<string, CosmosDocument>();

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '⚠️  [InMemoryCosmos] Using in-memory adapter in production. ' +
        'This is not recommended for distributed systems. ' +
        'Use actual Azure Cosmos DB instead.'
      )
    }
  }

  /**
   * Create document
   */
  async create(doc: CosmosDocument): Promise<void> {
    const key = this.makeKey(doc.partitionKey, doc.id);
    if (this.documents.has(key)) {
      throw new Error(`Document ${doc.id} already exists in partition ${doc.partitionKey}`);
    }
    this.documents.set(key, { ...doc });
  }

  /**
   * Read document by id and partition key
   */
  async read(id: string, partitionKey: string): Promise<CosmosDocument | null> {
    const key = this.makeKey(partitionKey, id);
    return this.documents.get(key) || null;
  }

  /**
   * Update document (full replacement)
   */
  async update(doc: CosmosDocument): Promise<void> {
    const key = this.makeKey(doc.partitionKey, doc.id);
    if (!this.documents.has(key)) {
      throw new Error(`Document ${doc.id} not found in partition ${doc.partitionKey}`);
    }
    this.documents.set(key, { ...doc });
  }

  /**
   * Upsert document (create or update)
   */
  async upsert(doc: CosmosDocument): Promise<void> {
    const key = this.makeKey(doc.partitionKey, doc.id);
    this.documents.set(key, { ...doc });
  }

  /**
   * Delete document
   */
  async delete(id: string, partitionKey: string): Promise<void> {
    const key = this.makeKey(partitionKey, id);
    this.documents.delete(key);
  }

  /**
   * Query documents
   */
  async query(options: QueryOptions = {}): Promise<CosmosDocument[]> {
    let results = Array.from(this.documents.values());

    // Filter by partition key
    if (options.partitionKey) {
      results = results.filter(doc => doc.partitionKey === options.partitionKey);
    }

    // Apply custom filter
    if (options.filter) {
      results = results.filter(options.filter);
    }

    return results;
  }

  /**
   * Clear all documents (for testing)
   */
  async clear(): Promise<void> {
    this.documents.clear();
  }

  /**
   * Get document count (for testing)
   */
  count(): number {
    return this.documents.size;
  }

  private makeKey(partitionKey: string, id: string): string {
    return `${partitionKey}:${id}`;
  }
}
