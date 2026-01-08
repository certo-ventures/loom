/**
 * 7. Queue & Messaging API
 * 
 * Message queue operations via BullMQ
 */

import { Router } from 'express'
import type { LoomService } from '../../services/loom-service'
import { ApiError } from '../../middleware/error-handler'

export function createQueueRouter(loomService: LoomService) {
  const router = Router()
  const queueService = loomService.queueService!

  // POST /api/v1/queue/:queueName/publish - Publish message to queue
  router.post('/:queueName/publish', async (req, res) => {
    const { queueName } = req.params
    const { data, priority, delay } = req.body
    
    if (!data) {
      throw new ApiError(400, 'data is required')
    }
    
    const jobId = await queueService.publishMessage(
      queueName,
      data,
      { priority, delay },
      req.tenantId!
    )
    
    res.status(201).json({ queueName, jobId, status: 'published' })
  })

  // GET /api/v1/queue/:queueName/messages - Get messages from queue
  router.get('/:queueName/messages', async (req, res) => {
    const { queueName } = req.params
    const { status = 'waiting', limit = 50 } = req.query
    
    const messages = await queueService.getQueueMessages(
      queueName,
      status as 'waiting' | 'active' | 'completed' | 'failed',
      Number(limit),
      req.tenantId!
    )
    
    res.json({ queueName, status, messages, total: messages.length })
  })

  // POST /api/v1/queue/:queueName/consume - Consume next message
  router.post('/:queueName/consume', async (req, res) => {
    const { queueName } = req.params
    
    const message = await queueService.consumeMessage(queueName, req.tenantId!)
    
    if (!message) {
      res.json({ queueName, message: null, empty: true })
    } else {
      res.json({ queueName, message })
    }
  })

  // GET /api/v1/queue/:queueName/stats - Get queue statistics
  router.get('/:queueName/stats', async (req, res) => {
    const { queueName } = req.params
    
    const stats = await queueService.getQueueStats(queueName, req.tenantId!)
    
    res.json({ queueName, ...stats })
  })

  // POST /api/v1/queue/:queueName/purge - Purge queue
  router.post('/:queueName/purge', async (req, res) => {
    const { queueName } = req.params
    const { olderThan } = req.body
    
    await queueService.purgeQueue(queueName, olderThan, req.tenantId!)
    
    res.json({ queueName, purged: true })
  })

  // GET /api/v1/queue - List all queues
  router.get('/', async (req, res) => {
    // Get all queue names (would need to extend QueueService)
    res.json({ queues: [], total: 0 })
  })

  return router
}
