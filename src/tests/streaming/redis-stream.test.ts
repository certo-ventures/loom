import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import Redis from 'ioredis'
import { RedisStreamPublisher, RedisStreamConsumer } from '../../streaming/redis-stream'
import type { StreamChunk } from '../../streaming/types'

describe('Redis Streams - Distributed Streaming', () => {
  let redis: Redis
  let publisher: RedisStreamPublisher
  let consumer: RedisStreamConsumer

  beforeEach(async () => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
    })

    // Clean up test streams
    const keys = await redis.keys('stream:test-*')
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  })

  afterAll(async () => {
    await redis.quit()
  })

  it('should publish and consume stream chunks', async () => {
    const streamId = 'test-stream-1'
    publisher = new RedisStreamPublisher(redis, streamId)
    consumer = new RedisStreamConsumer(redis)

    // Publish chunks in background
    const publishTask = (async () => {
      await publisher.publish({ type: 'start' })
      await publisher.publish({ type: 'data', data: { message: 'chunk 1' } })
      await publisher.publish({ type: 'data', data: { message: 'chunk 2' } })
      await publisher.publish({ type: 'data', data: { message: 'chunk 3' } })
      await publisher.complete()
    })()

    // Consume chunks
    const chunks: StreamChunk[] = []
    for await (const chunk of consumer.read(streamId)) {
      chunks.push(chunk)
    }

    await publishTask

    expect(chunks).toHaveLength(5)
    expect(chunks[0].type).toBe('start')
    expect(chunks[1].type).toBe('data')
    expect(chunks[1].data).toEqual({ message: 'chunk 1' })
    expect(chunks[4].type).toBe('complete')
  })

  it('should handle progress updates', async () => {
    const streamId = 'test-stream-2'
    publisher = new RedisStreamPublisher(redis, streamId)
    consumer = new RedisStreamConsumer(redis)

    const publishTask = (async () => {
      await publisher.publish({ type: 'start' })
      
      for (let i = 1; i <= 3; i++) {
        await publisher.publish({
          type: 'progress',
          progress: { current: i, total: 3, message: `Step ${i}` }
        })
      }
      
      await publisher.complete()
    })()

    const chunks: StreamChunk[] = []
    for await (const chunk of consumer.read(streamId)) {
      chunks.push(chunk)
    }

    await publishTask

    const progressChunks = chunks.filter(c => c.type === 'progress')
    expect(progressChunks).toHaveLength(3)
    expect(progressChunks[0].progress).toEqual({
      current: 1,
      total: 3,
      message: 'Step 1'
    })
  })

  it('should handle errors', async () => {
    const streamId = 'test-stream-3'
    publisher = new RedisStreamPublisher(redis, streamId)
    consumer = new RedisStreamConsumer(redis)

    const publishTask = (async () => {
      await publisher.publish({ type: 'start' })
      await publisher.publish({ type: 'data', data: 'some data' })
      await publisher.error(new Error('Something went wrong'))
    })()

    const chunks: StreamChunk[] = []
    for await (const chunk of consumer.read(streamId)) {
      chunks.push(chunk)
    }

    await publishTask

    expect(chunks[chunks.length - 1].type).toBe('error')
    expect(chunks[chunks.length - 1].error?.message).toBe('Something went wrong')
  })

  it('should support multiple consumers reading same stream', async () => {
    const streamId = 'test-stream-4'
    publisher = new RedisStreamPublisher(redis, streamId)
    
    const consumer1 = new RedisStreamConsumer(redis)
    const consumer2 = new RedisStreamConsumer(redis)

    // Publish chunks
    const publishTask = (async () => {
      await publisher.publish({ type: 'start' })
      await publisher.publish({ type: 'data', data: 'shared data' })
      await publisher.complete()
    })()

    // Both consumers read
    const [chunks1, chunks2] = await Promise.all([
      (async () => {
        const chunks: StreamChunk[] = []
        for await (const chunk of consumer1.read(streamId)) {
          chunks.push(chunk)
        }
        return chunks
      })(),
      (async () => {
        const chunks: StreamChunk[] = []
        for await (const chunk of consumer2.read(streamId)) {
          chunks.push(chunk)
        }
        return chunks
      })()
    ])

    await publishTask

    // Both should receive same chunks
    expect(chunks1).toHaveLength(3)
    expect(chunks2).toHaveLength(3)
    expect(chunks1[1].data).toBe('shared data')
    expect(chunks2[1].data).toBe('shared data')
  })

  it('should cleanup stream after completion', async () => {
    const streamId = 'test-stream-5'
    publisher = new RedisStreamPublisher(redis, streamId)

    await publisher.publish({ type: 'start' })
    await publisher.complete()

    // Check TTL is set
    const ttl = await redis.ttl(`stream:${streamId}`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(3600)
  })

  it('should handle slow publisher (streaming in real-time)', async () => {
    const streamId = 'test-stream-6'
    publisher = new RedisStreamPublisher(redis, streamId)
    consumer = new RedisStreamConsumer(redis)

    // Publish slowly
    const publishTask = (async () => {
      await publisher.publish({ type: 'start' })
      
      for (let i = 1; i <= 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        await publisher.publish({ type: 'data', data: `chunk ${i}` })
      }
      
      await publisher.complete()
    })()

    // Consume as they arrive
    const chunks: StreamChunk[] = []
    const timestamps: number[] = []
    
    for await (const chunk of consumer.read(streamId)) {
      chunks.push(chunk)
      timestamps.push(Date.now())
    }

    await publishTask

    expect(chunks).toHaveLength(5)
    
    // Verify chunks arrived over time (not all at once)
    const duration = timestamps[timestamps.length - 1] - timestamps[0]
    expect(duration).toBeGreaterThanOrEqual(200) // At least 200ms for 3 delays
  })
})
