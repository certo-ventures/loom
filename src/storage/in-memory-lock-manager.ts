import type { Lock, LockManager } from './lock-manager'

/**
 * InMemoryLockManager - Simple in-memory implementation for testing
 */
export class InMemoryLockManager implements LockManager {
  private locks = new Map<string, Lock>()

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '⚠️  [InMemoryLockManager] Using in-memory adapter in production. ' +
        'This is not recommended for distributed systems. ' +
        'Use RedisLockManager instead.'
      )
    }
  }

  async acquire(key: string, ttlMs: number): Promise<Lock | null> {
    const existing = this.locks.get(key)
    
    // Check if lock exists and is still valid
    if (existing && existing.expiresAt > Date.now()) {
      return null
    }

    const lock: Lock = {
      key,
      token: Math.random().toString(36).substring(7),
      expiresAt: Date.now() + ttlMs,
    }

    this.locks.set(key, lock)
    return lock
  }

  async release(lock: Lock): Promise<void> {
    const existing = this.locks.get(lock.key)
    
    // Only release if token matches
    if (existing?.token === lock.token) {
      this.locks.delete(lock.key)
    }
  }

  async extend(lock: Lock, ttlMs: number): Promise<void> {
    const existing = this.locks.get(lock.key)
    
    // Only extend if token matches
    if (existing?.token === lock.token) {
      existing.expiresAt = Date.now() + ttlMs
    }
  }

  // Helper for testing
  clear(): void {
    this.locks.clear()
  }
}
