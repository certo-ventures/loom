import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import Redis from 'ioredis'
import { RedisSharedMemory } from '../../shared-memory/redis-shared-memory'

describe('RedisSharedMemory', () => {
  let redis: Redis
  let sharedMemory: RedisSharedMemory

  beforeEach(async () => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
    })
    
    sharedMemory = new RedisSharedMemory(redis)
    
    // Clean up test keys
    const keys = await redis.keys('test:*')
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  })

  afterAll(async () => {
    await redis.quit()
  })

  describe('Key-Value Operations', () => {
    it('should write and read a value', async () => {
      await sharedMemory.write('test:key1', { message: 'hello' })
      const result = await sharedMemory.read('test:key1')
      
      expect(result).toEqual({ message: 'hello' })
    })

    it('should overwrite existing value', async () => {
      await sharedMemory.write('test:key2', 'first')
      await sharedMemory.write('test:key2', 'second')
      const result = await sharedMemory.read('test:key2')
      
      expect(result).toBe('second')
    })

    it('should return null for non-existent key', async () => {
      const result = await sharedMemory.read('test:nonexistent')
      expect(result).toBeNull()
    })

    it('should delete a key', async () => {
      await sharedMemory.write('test:key3', 'value')
      await sharedMemory.delete('test:key3')
      const result = await sharedMemory.read('test:key3')
      
      expect(result).toBeNull()
    })

    it('should check if key exists', async () => {
      await sharedMemory.write('test:key4', 'value')
      
      expect(await sharedMemory.exists('test:key4')).toBe(true)
      expect(await sharedMemory.exists('test:nonexistent')).toBe(false)
    })

    it('should handle TTL', async () => {
      await sharedMemory.write('test:key5', 'value', { seconds: 1 })
      
      expect(await sharedMemory.read('test:key5')).toBe('value')
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100))
      
      expect(await sharedMemory.read('test:key5')).toBeNull()
    })
  })

  describe('List Operations', () => {
    it('should append values to a list', async () => {
      await sharedMemory.append('test:list1', 'first')
      await sharedMemory.append('test:list1', 'second')
      await sharedMemory.append('test:list1', 'third')
      
      const result = await sharedMemory.readList('test:list1')
      expect(result).toEqual(['first', 'second', 'third'])
    })

    it('should append objects to a list', async () => {
      await sharedMemory.append('test:list2', { id: 1, name: 'Alice' })
      await sharedMemory.append('test:list2', { id: 2, name: 'Bob' })
      
      const result = await sharedMemory.readList('test:list2')
      expect(result).toEqual([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ])
    })

    it('should return empty array for non-existent list', async () => {
      const result = await sharedMemory.readList('test:nonexistent')
      expect(result).toEqual([])
    })

    it('should handle list TTL', async () => {
      await sharedMemory.append('test:list3', 'value', { seconds: 1 })
      
      expect(await sharedMemory.readList('test:list3')).toEqual(['value'])
      
      await new Promise(resolve => setTimeout(resolve, 1100))
      
      expect(await sharedMemory.readList('test:list3')).toEqual([])
    })
  })

  describe('Hash Operations', () => {
    it('should set and get hash fields', async () => {
      await sharedMemory.hset('test:hash1', 'name', 'Alice')
      await sharedMemory.hset('test:hash1', 'age', 30)
      
      const name = await sharedMemory.hget('test:hash1', 'name')
      const age = await sharedMemory.hget('test:hash1', 'age')
      
      expect(name).toBe('Alice')
      expect(age).toBe(30)
    })

    it('should get all hash fields', async () => {
      await sharedMemory.hset('test:hash2', 'city', 'NYC')
      await sharedMemory.hset('test:hash2', 'country', 'USA')
      
      const result = await sharedMemory.hgetall('test:hash2')
      expect(result).toEqual({ city: 'NYC', country: 'USA' })
    })

    it('should return null for non-existent hash', async () => {
      const result = await sharedMemory.hgetall('test:nonexistent')
      expect(result).toBeNull()
    })

    it('should update hash fields independently', async () => {
      await sharedMemory.hset('test:hash3', 'field1', 'value1')
      await sharedMemory.hset('test:hash3', 'field2', 'value2')
      await sharedMemory.hset('test:hash3', 'field1', 'updated')
      
      const result = await sharedMemory.hgetall('test:hash3')
      expect(result).toEqual({ field1: 'updated', field2: 'value2' })
    })
  })

  describe('Set Operations', () => {
    it('should add values to a set', async () => {
      await sharedMemory.sadd('test:set1', 'apple')
      await sharedMemory.sadd('test:set1', 'banana')
      await sharedMemory.sadd('test:set1', 'apple') // Duplicate
      
      const result = await sharedMemory.smembers('test:set1')
      expect(result).toHaveLength(2)
      expect(result).toContain('apple')
      expect(result).toContain('banana')
    })

    it('should return empty array for non-existent set', async () => {
      const result = await sharedMemory.smembers('test:nonexistent')
      expect(result).toEqual([])
    })
  })

  describe('Atomic Operations', () => {
    it('should increment a counter', async () => {
      const val1 = await sharedMemory.incr('test:counter1')
      const val2 = await sharedMemory.incr('test:counter1')
      const val3 = await sharedMemory.incr('test:counter1')
      
      expect(val1).toBe(1)
      expect(val2).toBe(2)
      expect(val3).toBe(3)
    })

    it('should decrement a counter', async () => {
      await sharedMemory.incr('test:counter2')
      await sharedMemory.incr('test:counter2')
      await sharedMemory.incr('test:counter2')
      
      const val = await sharedMemory.decr('test:counter2')
      expect(val).toBe(2)
    })

    it('should handle concurrent increments', async () => {
      // Simulate race condition
      const promises = Array.from({ length: 10 }, () =>
        sharedMemory.incr('test:counter3')
      )
      
      await Promise.all(promises)
      
      const final = await sharedMemory.read<string>('test:counter3')
      expect(Number(final)).toBe(10)
    })
  })

  describe('Namespace Isolation', () => {
    it('should isolate different namespaces', async () => {
      await sharedMemory.write('test:team-a:goal', 'Goal A')
      await sharedMemory.write('test:team-b:goal', 'Goal B')
      
      const goalA = await sharedMemory.read('test:team-a:goal')
      const goalB = await sharedMemory.read('test:team-b:goal')
      
      expect(goalA).toBe('Goal A')
      expect(goalB).toBe('Goal B')
    })

    it('should support conversation history pattern', async () => {
      const conversationId = 'conv-123'
      
      // Append messages
      await sharedMemory.append(`test:chat:${conversationId}:history`, {
        role: 'user',
        content: 'Hello'
      })
      await sharedMemory.append(`test:chat:${conversationId}:history`, {
        role: 'agent',
        name: 'assistant',
        content: 'Hi there!'
      })
      
      // Read history
      const history = await sharedMemory.readList(`test:chat:${conversationId}:history`)
      
      expect(history).toHaveLength(2)
      expect(history[0]).toMatchObject({ role: 'user', content: 'Hello' })
      expect(history[1]).toMatchObject({ role: 'agent', content: 'Hi there!' })
    })

    it('should support agent profile pattern', async () => {
      const agentId = 'agent-456'
      
      // Set profile fields
      await sharedMemory.hset(`test:agent:${agentId}:profile`, 'name', 'ResearchAgent')
      await sharedMemory.hset(`test:agent:${agentId}:profile`, 'role', 'researcher')
      await sharedMemory.hset(`test:agent:${agentId}:profile`, 'expertise', ['data', 'analysis'])
      
      // Read profile
      const profile = await sharedMemory.hgetall(`test:agent:${agentId}:profile`)
      
      expect(profile).toEqual({
        name: 'ResearchAgent',
        role: 'researcher',
        expertise: ['data', 'analysis']
      })
    })
  })
})
