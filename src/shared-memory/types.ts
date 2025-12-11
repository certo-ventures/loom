/**
 * Shared Memory - Distributed data structures for agent coordination
 * 
 * Supports multiple data structures:
 * - Key-value: write/read (overwrite semantics)
 * - Lists: append/readList (append-only, ordered)
 * - Hashes: hset/hgetall (partial updates)
 * - Sets: sadd/smembers (unique values)
 */

/**
 * Time-to-live options for ephemeral data
 */
export interface TTLOptions {
  /** Seconds until expiration (undefined = no expiration) */
  seconds?: number
}

/**
 * Shared memory interface for distributed coordination
 */
export interface SharedMemory {
  // Key-Value operations (last-write-wins)
  write(key: string, value: any, options?: TTLOptions): Promise<void>
  read<T = any>(key: string): Promise<T | null>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  
  // List operations (append-only, ordered)
  append(key: string, value: any, options?: TTLOptions): Promise<void>
  readList<T = any>(key: string): Promise<T[]>
  
  // Hash operations (partial updates)
  hset(key: string, field: string, value: any, options?: TTLOptions): Promise<void>
  hgetall<T = Record<string, any>>(key: string): Promise<T | null>
  hget<T = any>(key: string, field: string): Promise<T | null>
  
  // Set operations (unique values)
  sadd(key: string, value: any, options?: TTLOptions): Promise<void>
  smembers<T = any>(key: string): Promise<T[]>
  
  // Atomic operations
  incr(key: string): Promise<number>
  decr(key: string): Promise<number>
}
