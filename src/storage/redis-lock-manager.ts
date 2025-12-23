// @ts-ignore - redlock ESM type issue
import Redlock from 'redlock'
// @ts-ignore - Redlock has typing issues with ESM
import type { Redis } from 'ioredis'
import type { Lock, LockManager } from './lock-manager'

/**
 * RedisLockManager - Distributed locking using Redlock algorithm
 */
export class RedisLockManager implements LockManager {
  private redlock: Redlock

  constructor(redisClient: Redis) {
    this.redlock = new Redlock([redisClient], {
      retryCount: 0, // Don't retry - return null immediately if locked
    })
  }

  async acquire(key: string, ttlMs: number): Promise<Lock | null> {
    try {
      const lock = await this.redlock.acquire([`lock:${key}`], ttlMs)
      
      return {
        key,
        token: lock.value,
        expiresAt: Date.now() + ttlMs,
      }
    } catch (error) {
      // Lock is already held
      return null
    }
  }

  async release(lock: Lock): Promise<void> {
    try {
      await this.redlock.release({
        resources: [`lock:${lock.key}`],
        value: lock.token,
        expiration: lock.expiresAt,
      } as any)
    } catch (error) {
      // Lock already expired or doesn't exist - ignore
    }
  }

  async extend(lock: Lock, ttlMs: number): Promise<void> {
    try {
      await this.redlock.extend(
        {
          resources: [`lock:${lock.key}`],
          value: lock.token,
          expiration: lock.expiresAt,
        } as any,
        ttlMs
      )
      lock.expiresAt = Date.now() + ttlMs
    } catch (error) {
      // Failed to extend - lock may have been released
    }
  }
}
