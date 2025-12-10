/**
 * Lock - Distributed lock handle
 */
export interface Lock {
  key: string
  token: string
  expiresAt: number
}

/**
 * LockManager - Distributed locking for single-activation guarantee
 */
export interface LockManager {
  /**
   * Acquire a lock (returns null if already locked)
   */
  acquire(key: string, ttlMs: number): Promise<Lock | null>

  /**
   * Release a lock
   */
  release(lock: Lock): Promise<void>

  /**
   * Extend lock TTL (for heartbeat)
   */
  extend(lock: Lock, ttlMs: number): Promise<void>
}
