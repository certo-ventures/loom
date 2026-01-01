/**
 * Enhanced Streaming with Backpressure and Auth
 * 
 * Production-ready streaming implementation:
 * - Backpressure control (client-driven rate limiting)
 * - Authorization enforcement
 * - Connection health monitoring
 * - Graceful degradation
 * - Metrics tracking
 */

import type { Redis } from 'ioredis'
import type { StreamChunk } from './types'

/**
 * Authorization context for streaming
 */
export interface StreamAuthContext {
  userId?: string
  tenantId?: string
  permissions?: string[]
  token?: string
}

/**
 * Backpressure configuration
 */
export interface BackpressureConfig {
  /** Max pending chunks before blocking (default: 100) */
  maxPendingChunks: number
  
  /** Max bytes in buffer before blocking (default: 1MB) */
  maxBufferBytes: number
  
  /** Timeout waiting for consumer (default: 30s) */
  consumerTimeout: number
  
  /** Check interval for buffer status (default: 100ms) */
  checkInterval: number
}

/**
 * Streaming metrics
 */
export interface StreamMetrics {
  streamId: string
  chunksPublished: number
  bytesPublished: number
  backpressureEvents: number
  errors: number
  startedAt: number
  completedAt?: number
  durationMs?: number
}

/**
 * Enhanced Redis Stream Publisher with backpressure
 */
export class EnhancedRedisStreamPublisher {
  private redis: Redis
  private streamId: string
  private authContext: StreamAuthContext
  private backpressureConfig: BackpressureConfig
  private metrics: StreamMetrics
  private pendingBytes: number = 0

  constructor(
    redis: Redis,
    streamId: string,
    authContext: StreamAuthContext,
    backpressureConfig?: Partial<BackpressureConfig>
  ) {
    this.redis = redis
    this.streamId = streamId
    this.authContext = authContext

    this.backpressureConfig = {
      maxPendingChunks: backpressureConfig?.maxPendingChunks ?? 100,
      maxBufferBytes: backpressureConfig?.maxBufferBytes ?? 1024 * 1024, // 1MB
      consumerTimeout: backpressureConfig?.consumerTimeout ?? 30000, // 30s
      checkInterval: backpressureConfig?.checkInterval ?? 100, // 100ms
    }

    this.metrics = {
      streamId,
      chunksPublished: 0,
      bytesPublished: 0,
      backpressureEvents: 0,
      errors: 0,
      startedAt: Date.now(),
    }
  }

  /**
   * Publish chunk with backpressure control
   */
  async publish(chunk: StreamChunk): Promise<void> {
    // Wait for backpressure to clear
    await this.waitForBackpressure()

    const streamKey = `stream:${this.streamId}`
    const data = JSON.stringify(chunk.data || null)
    const progress = JSON.stringify(chunk.progress || null)

    // Estimate chunk size
    const chunkSize = data.length + progress.length + 100 // overhead

    // Add to Redis Stream
    await this.redis.xadd(
      streamKey,
      'MAXLEN', '~', '1000', // Keep last 1000 entries (approximate)
      '*',
      'type', chunk.type,
      'data', data,
      'error', chunk.error ? chunk.error.message : '',
      'progress', progress,
      'userId', this.authContext.userId || '',
      'tenantId', this.authContext.tenantId || '',
      'timestamp', Date.now().toString()
    )

    // Update metrics
    this.metrics.chunksPublished++
    this.metrics.bytesPublished += chunkSize
    this.pendingBytes += chunkSize

    // Update stream metadata
    await this.updateStreamMetadata()
  }

  /**
   * Wait for backpressure to clear
   */
  private async waitForBackpressure(): Promise<void> {
    const startWait = Date.now()
    const streamKey = `stream:${this.streamId}`
    const consumerKey = `stream:${this.streamId}:consumer`

    while (true) {
      // Check if consumer is alive
      const lastAck = await this.redis.get(consumerKey)
      const lastAckTime = lastAck ? parseInt(lastAck, 10) : 0
      const timeSinceAck = Date.now() - lastAckTime

      if (timeSinceAck > this.backpressureConfig.consumerTimeout) {
        throw new Error(`Consumer timeout: no acknowledgment for ${timeSinceAck}ms`)
      }

      // Check stream length
      const length = await this.redis.xlen(streamKey)
      if (length < this.backpressureConfig.maxPendingChunks) {
        // Check buffer size
        if (this.pendingBytes < this.backpressureConfig.maxBufferBytes) {
          return // Backpressure cleared
        }
      }

      // Still under backpressure
      this.metrics.backpressureEvents++

      // Wait before checking again
      await new Promise(resolve => 
        setTimeout(resolve, this.backpressureConfig.checkInterval)
      )

      // Check for timeout
      if (Date.now() - startWait > this.backpressureConfig.consumerTimeout) {
        throw new Error('Backpressure timeout: consumer not keeping up')
      }
    }
  }

  /**
   * Update stream metadata in Redis
   */
  private async updateStreamMetadata(): Promise<void> {
    const metaKey = `stream:${this.streamId}:meta`
    await this.redis.hset(metaKey, {
      chunksPublished: this.metrics.chunksPublished.toString(),
      bytesPublished: this.metrics.bytesPublished.toString(),
      backpressureEvents: this.metrics.backpressureEvents.toString(),
      errors: this.metrics.errors.toString(),
      lastUpdate: Date.now().toString(),
    })
    await this.redis.expire(metaKey, 3600) // 1 hour TTL
  }

  /**
   * Mark stream as complete
   */
  async complete(): Promise<void> {
    await this.publish({ type: 'complete' })
    this.metrics.completedAt = Date.now()
    this.metrics.durationMs = this.metrics.completedAt - this.metrics.startedAt
    await this.updateStreamMetadata()
    
    // Cleanup after 1 hour
    await this.redis.expire(`stream:${this.streamId}`, 3600)
  }

  /**
   * Publish error and mark stream as failed
   */
  async error(error: Error): Promise<void> {
    this.metrics.errors++
    await this.publish({ type: 'error', error })
    this.metrics.completedAt = Date.now()
    this.metrics.durationMs = this.metrics.completedAt - this.metrics.startedAt
    await this.updateStreamMetadata()
    
    // Cleanup after 1 hour
    await this.redis.expire(`stream:${this.streamId}`, 3600)
  }

  /**
   * Get current metrics
   */
  getMetrics(): StreamMetrics {
    return { ...this.metrics }
  }
}

/**
 * Enhanced Redis Stream Consumer with auth enforcement
 */
export class EnhancedRedisStreamConsumer {
  private redis: Redis
  private authContext: StreamAuthContext

  constructor(redis: Redis, authContext: StreamAuthContext) {
    this.redis = redis
    this.authContext = authContext
  }

  /**
   * Read stream chunks with auth validation
   */
  async *read(streamId: string): AsyncGenerator<StreamChunk, void, unknown> {
    const streamKey = `stream:${streamId}`
    const consumerKey = `stream:${streamId}:consumer`
    let lastId = '0'
    let isComplete = false

    // Validate stream access
    await this.validateAccess(streamId)

    while (!isComplete) {
      // Update consumer heartbeat for backpressure
      await this.redis.set(consumerKey, Date.now().toString(), 'EX', 60)

      // Blocking read with 1s timeout
      const results = await this.redis.xread(
        'BLOCK', 1000,
        'STREAMS', streamKey, lastId
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

          // Validate auth on each chunk
          const chunkUserId = fields[9] as string
          const chunkTenantId = fields[11] as string

          if (this.authContext.tenantId && chunkTenantId !== this.authContext.tenantId) {
            throw new Error('Tenant mismatch: unauthorized access to stream')
          }

          yield chunk

          // Check if stream is complete
          if (chunk.type === 'complete' || chunk.type === 'error') {
            isComplete = true
            return
          }

          lastId = id

          // Acknowledge consumption (for backpressure)
          await this.redis.set(consumerKey, Date.now().toString(), 'EX', 60)
        }
      }
    }
  }

  /**
   * Validate access to stream
   */
  private async validateAccess(streamId: string): Promise<void> {
    const metaKey = `stream:${streamId}:meta`
    const exists = await this.redis.exists(metaKey)

    if (!exists) {
      throw new Error(`Stream not found: ${streamId}`)
    }

    // Additional auth checks can go here
    // - Check tenantId matches
    // - Check user has permission
    // - Check stream is active
  }

  /**
   * Get stream metrics
   */
  async getMetrics(streamId: string): Promise<Partial<StreamMetrics>> {
    const metaKey = `stream:${streamId}:meta`
    const meta = await this.redis.hgetall(metaKey)

    if (!meta || Object.keys(meta).length === 0) {
      throw new Error(`Stream metadata not found: ${streamId}`)
    }

    return {
      streamId,
      chunksPublished: parseInt(meta.chunksPublished || '0', 10),
      bytesPublished: parseInt(meta.bytesPublished || '0', 10),
      backpressureEvents: parseInt(meta.backpressureEvents || '0', 10),
      errors: parseInt(meta.errors || '0', 10),
    }
  }
}

/**
 * Stream factory with auth
 */
export class StreamFactory {
  constructor(private redis: Redis) {}

  /**
   * Create publisher with auth context
   */
  createPublisher(
    streamId: string,
    authContext: StreamAuthContext,
    backpressureConfig?: Partial<BackpressureConfig>
  ): EnhancedRedisStreamPublisher {
    return new EnhancedRedisStreamPublisher(
      this.redis,
      streamId,
      authContext,
      backpressureConfig
    )
  }

  /**
   * Create consumer with auth context
   */
  createConsumer(authContext: StreamAuthContext): EnhancedRedisStreamConsumer {
    return new EnhancedRedisStreamConsumer(this.redis, authContext)
  }
}
