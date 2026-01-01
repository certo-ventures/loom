import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Redis } from 'ioredis'
import { QueueMetadataStore } from '../../storage/queue-metadata-store'

describe('QueueMetadataStore', () => {
  let redis: Redis
  let store: QueueMetadataStore

  beforeEach(async () => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      db: 15 // Use test database
    })
    await redis.flushdb() // Clean before each test
    store = new QueueMetadataStore(redis)
  })

  afterEach(async () => {
    await redis.flushdb()
    await redis.quit()
  })

  it('should record and retrieve job metadata', async () => {
    const metadata = {
      jobId: 'job-123',
      queueName: 'test-queue',
      data: { test: 'data' },
      options: {
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 1000 }
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'queued' as const,
      attempts: 0,
      maxAttempts: 3
    }

    await store.recordJob(metadata)
    const retrieved = await store.getJobMetadata('job-123')

    expect(retrieved).toMatchObject({
      jobId: 'job-123',
      queueName: 'test-queue',
      status: 'queued',
      maxAttempts: 3
    })
  })

  it('should record job attempt history', async () => {
    const metadata = {
      jobId: 'job-456',
      queueName: 'test-queue',
      data: {},
      options: { attempts: 3 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'queued' as const,
      attempts: 0,
      maxAttempts: 3
    }

    await store.recordJob(metadata)

    // Record start attempt
    await store.recordAttempt('job-456', {
      attemptNumber: 1,
      timestamp: new Date().toISOString(),
      status: 'started',
      workerId: 'worker-1'
    })

    // Record failure
    await store.recordAttempt('job-456', {
      attemptNumber: 1,
      timestamp: new Date().toISOString(),
      status: 'failed',
      duration: 100,
      error: {
        message: 'Test error',
        type: 'Error'
      },
      workerId: 'worker-1'
    })

    const attempts = await store.getJobAttempts('job-456')
    expect(attempts).toHaveLength(2)
    expect(attempts[0].status).toBe('started')
    expect(attempts[1].status).toBe('failed')
    expect(attempts[1].error?.message).toBe('Test error')
  })

  it('should track queue statistics', async () => {
    const metadata1 = {
      jobId: 'job-1',
      queueName: 'metrics-queue',
      data: {},
      options: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'queued' as const,
      attempts: 0,
      maxAttempts: 3
    }

    const metadata2 = {
      jobId: 'job-2',
      queueName: 'metrics-queue',
      data: {},
      options: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'queued' as const,
      attempts: 0,
      maxAttempts: 3
    }

    await store.recordJob(metadata1)
    await store.recordJob(metadata2)

    // Mark one as active
    await store.recordAttempt('job-1', {
      attemptNumber: 1,
      timestamp: new Date().toISOString(),
      status: 'started',
      workerId: 'worker-1'
    })

    const stats = await store.getQueueStats('metrics-queue')
    expect(stats).toMatchObject({
      queueName: 'metrics-queue',
      totalJobs: 2,
      waitingJobs: 1,
      activeJobs: 1
    })
  })

  it('should handle job completion workflow', async () => {
    const metadata = {
      jobId: 'job-complete',
      queueName: 'complete-queue',
      data: {},
      options: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'queued' as const,
      attempts: 0,
      maxAttempts: 3
    }

    await store.recordJob(metadata)

    // Start
    await store.recordAttempt('job-complete', {
      attemptNumber: 1,
      timestamp: new Date().toISOString(),
      status: 'started'
    })

    // Complete
    await store.recordAttempt('job-complete', {
      attemptNumber: 1,
      timestamp: new Date().toISOString(),
      status: 'completed',
      duration: 250
    })

    const final = await store.getJobMetadata('job-complete')
    expect(final?.status).toBe('completed')
    expect(final?.attempts).toBe(1)

    const stats = await store.getQueueStats('complete-queue')
    expect(stats?.completedJobs).toBe(1)
    expect(stats?.activeJobs).toBe(0)
  })

  it('should list all queues', async () => {
    await store.recordJob({
      jobId: 'j1',
      queueName: 'queue-a',
      data: {},
      options: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'queued',
      attempts: 0,
      maxAttempts: 3
    })

    await store.recordJob({
      jobId: 'j2',
      queueName: 'queue-b',
      data: {},
      options: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'queued',
      attempts: 0,
      maxAttempts: 3
    })

    const queues = await store.listQueues()
    expect(queues).toContain('queue-a')
    expect(queues).toContain('queue-b')
  })
})
