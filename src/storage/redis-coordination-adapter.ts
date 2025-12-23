// @ts-ignore - redlock v5 has ESM/types issue
import Redlock from 'redlock'
import type { Redis } from 'ioredis'
import type { ActorLock, CoordinationAdapter } from './coordination-adapter'

export class RedisCoordinationAdapter implements CoordinationAdapter {
  private redlock: Redlock

  constructor(redisClient: Redis) {
    this.redlock = new Redlock([redisClient as any], {
      retryCount: 0, // Fail fast - don't retry
    })
  }

  async acquireLock(actorId: string, ttlMs: number): Promise<ActorLock | null> {
    try {
      const lock = await this.redlock.acquire([`actor:${actorId}`], ttlMs)
      return {
        actorId,
        lockId: lock.value,
        expiresAt: Date.now() + ttlMs,
      }
    } catch {
      return null // Already locked
    }
  }

  async releaseLock(lock: ActorLock): Promise<void> {
    await this.redlock.release({
      resources: [`actor:${lock.actorId}`],
      value: lock.lockId,
    } as any)
  }

  async renewLock(lock: ActorLock, ttlMs: number): Promise<boolean> {
    try {
      await this.redlock.extend(
        {
          resources: [`actor:${lock.actorId}`],
          value: lock.lockId,
        } as any,
        ttlMs,
      )
      lock.expiresAt = Date.now() + ttlMs
      return true
    } catch {
      return false // Lock was lost
    }
  }
}
