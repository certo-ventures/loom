import { randomUUID } from 'crypto'
import { Redis } from 'ioredis'

export interface RedisTestContext {
  stateRedis: Redis
  queueRedis: Redis
  queuePrefix: string
}

export async function createIsolatedRedis(): Promise<RedisTestContext> {
  const uniqueId = randomUUID()
  const keyPrefix = `test:${uniqueId}:`

  const stateRedis = new Redis('redis://localhost:6379', {
    keyPrefix,
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  })

  const queueRedis = new Redis('redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  })

  return {
    stateRedis,
    queueRedis,
    queuePrefix: `test-${uniqueId}`
  }
}
