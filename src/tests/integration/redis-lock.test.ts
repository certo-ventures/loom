import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Redis from 'ioredis'
import { RedisLockManager } from '../../storage/redis-lock-manager'

describe('RedisLockManager - Integration', () => {
  let redis: Redis
  let lockManager: RedisLockManager

  beforeAll(async () => {
    redis = new Redis({
      host: 'localhost',
      port: 6379,
    })
    lockManager = new RedisLockManager(redis)
  })

  afterAll(async () => {
    await redis.quit()
  })

  it('should acquire and release locks', async () => {
    const lock = await lockManager.acquire('resource-1', 5000)
    expect(lock).not.toBeNull()

    const blocked = await lockManager.acquire('resource-1', 5000)
    expect(blocked).toBeNull()

    await lockManager.release(lock!)

    const reacquired = await lockManager.acquire('resource-1', 5000)
    expect(reacquired).not.toBeNull()
    await lockManager.release(reacquired!)
  })

  it('should extend lock TTL', async () => {
    const lock = await lockManager.acquire('resource-2', 1000)
    expect(lock).not.toBeNull()

    await lockManager.extend(lock!, 5000)

    const blocked = await lockManager.acquire('resource-2', 1000)
    expect(blocked).toBeNull()

    await lockManager.release(lock!)
  })

  it('should handle concurrent lock attempts', async () => {
    const attempts = await Promise.all([
      lockManager.acquire('resource-4', 5000),
      lockManager.acquire('resource-4', 5000),
      lockManager.acquire('resource-4', 5000),
    ])

    const successful = attempts.filter(a => a !== null)
    expect(successful.length).toBe(1)

    await lockManager.release(successful[0]!)
  })
})
