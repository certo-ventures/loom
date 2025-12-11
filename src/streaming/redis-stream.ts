import type { Redis } from 'ioredis'
import type { StreamChunk } from './types'

/**
 * Publishes stream chunks to Redis Stream
 * Used by actor workers to stream results to consumers
 */
export class RedisStreamPublisher {
  constructor(
    private redis: Redis,
    private streamId: string
  ) {}

  /**
   * Publish a chunk to the stream
   */
  async publish(chunk: StreamChunk): Promise<void> {
    await this.redis.xadd(
      `stream:${this.streamId}`,
      '*',
      'type', chunk.type,
      'data', JSON.stringify(chunk.data || null),
      'error', chunk.error ? chunk.error.message : '',
      'progress', JSON.stringify(chunk.progress || null)
    )
  }

  /**
   * Mark stream as complete and set TTL
   */
  async complete(): Promise<void> {
    await this.publish({ type: 'complete' })
    // Cleanup stream after 1 hour
    await this.redis.expire(`stream:${this.streamId}`, 3600)
  }

  /**
   * Publish error and mark stream as failed
   */
  async error(error: Error): Promise<void> {
    await this.publish({ type: 'error', error })
    await this.redis.expire(`stream:${this.streamId}`, 3600)
  }
}

/**
 * Consumes stream chunks from Redis Stream
 * Used by clients to receive streaming results from remote actors
 */
export class RedisStreamConsumer {
  constructor(private redis: Redis) {}

  /**
   * Read stream chunks as async generator
   */
  async *read(streamId: string): AsyncGenerator<StreamChunk, void, unknown> {
    let lastId = '0'
    let isComplete = false

    while (!isComplete) {
      // Blocking read with 1s timeout
      const results = await this.redis.xread(
        'BLOCK', 1000,
        'STREAMS', `stream:${streamId}`, lastId
      )

      if (!results) {
        continue // Timeout, retry
      }

      for (const [_stream, messages] of results) {
        for (const [id, fields] of messages) {
          // Parse chunk from Redis Stream entry
          const chunk: StreamChunk = {
            type: fields[1] as any,
            data: fields[3] !== 'null' ? JSON.parse(fields[3] as string) : undefined,
            error: fields[5] ? new Error(fields[5] as string) : undefined,
            progress: fields[7] !== 'null' ? JSON.parse(fields[7] as string) : undefined,
          }

          yield chunk

          // Check if stream is complete
          if (chunk.type === 'complete' || chunk.type === 'error') {
            isComplete = true
            return
          }

          lastId = id
        }
      }
    }
  }
}
