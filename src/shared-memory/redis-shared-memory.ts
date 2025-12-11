import type { Redis } from 'ioredis'
import type { SharedMemory, TTLOptions } from './types'

/**
 * Redis-based shared memory implementation
 * Uses different Redis data structures for different use cases
 */
export class RedisSharedMemory implements SharedMemory {
  constructor(private redis: Redis) {}

  // Key-Value operations (last-write-wins)
  
  async write(key: string, value: any, options?: TTLOptions): Promise<void> {
    const serialized = JSON.stringify(value)
    
    if (options?.seconds) {
      await this.redis.setex(key, options.seconds, serialized)
    } else {
      await this.redis.set(key, serialized)
    }
  }

  async read<T = any>(key: string): Promise<T | null> {
    const value = await this.redis.get(key)
    return value ? JSON.parse(value) : null
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key)
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key)
    return result === 1
  }

  // List operations (append-only, ordered)
  
  async append(key: string, value: any, options?: TTLOptions): Promise<void> {
    const serialized = JSON.stringify(value)
    await this.redis.rpush(key, serialized)
    
    if (options?.seconds) {
      await this.redis.expire(key, options.seconds)
    }
  }

  async readList<T = any>(key: string): Promise<T[]> {
    const values = await this.redis.lrange(key, 0, -1)
    return values.map((v: string) => JSON.parse(v))
  }

  // Hash operations (partial updates)
  
  async hset(key: string, field: string, value: any, options?: TTLOptions): Promise<void> {
    const serialized = JSON.stringify(value)
    await this.redis.hset(key, field, serialized)
    
    if (options?.seconds) {
      await this.redis.expire(key, options.seconds)
    }
  }

  async hgetall<T = Record<string, any>>(key: string): Promise<T | null> {
    const hash = await this.redis.hgetall(key)
    
    if (Object.keys(hash).length === 0) {
      return null
    }
    
    const result: Record<string, any> = {}
    for (const [field, value] of Object.entries(hash)) {
      result[field] = JSON.parse(value as string)
    }
    
    return result as T
  }

  async hget<T = any>(key: string, field: string): Promise<T | null> {
    const value = await this.redis.hget(key, field)
    return value ? JSON.parse(value) : null
  }

  // Set operations (unique values)
  
  async sadd(key: string, value: any, options?: TTLOptions): Promise<void> {
    const serialized = JSON.stringify(value)
    await this.redis.sadd(key, serialized)
    
    if (options?.seconds) {
      await this.redis.expire(key, options.seconds)
    }
  }

  async smembers<T = any>(key: string): Promise<T[]> {
    const values = await this.redis.smembers(key)
    return values.map((v: string) => JSON.parse(v))
  }

  // Atomic operations
  
  async incr(key: string): Promise<number> {
    return await this.redis.incr(key)
  }

  async decr(key: string): Promise<number> {
    return await this.redis.decr(key)
  }
}
