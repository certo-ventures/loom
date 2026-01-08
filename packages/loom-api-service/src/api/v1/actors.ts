/**
 * 1. Actor Management API
 * 
 * Endpoints for creating, managing, and monitoring actors
 */

import { Router } from 'express'
import type { LoomService } from '../../services/loom-service'
import { ApiError } from '../../middleware/error-handler'

export function createActorRouter(loomService: LoomService) {
  const router = Router()
  const actorService = loomService.actorService!
  
  // POST /api/v1/actors - Create actor
  router.post('/', async (req, res) => {
    const { name, type, config, metadata } = req.body
    
    if (!name || !type) {
      throw new ApiError(400, 'name and type are required')
    }
    
    const actor = await actorService.createActor(
      { name, type, config, metadata },
      req.tenantId!
    )
    
    res.status(201).json({
      id: actor.actorId,
      name,
      type,
      config,
      status: 'created',
      createdAt: new Date().toISOString()
    })
  })
  
  // GET /api/v1/actors/:id - Get actor details
  router.get('/:id', async (req, res) => {
    const { id } = req.params
    
    const actor = await actorService.getActor(id, req.tenantId!)
    if (!actor) {
      throw new ApiError(404, `Actor ${id} not found`)
    }
    
    res.json({
      id: actor.actorId,
      name: actor.actorId,
      type: 'actor',
      status: 'running'
    })
  })
  
  // GET /api/v1/actors - List actors
  router.get('/', async (req, res) => {
    const { type, status, limit = 50, offset = 0 } = req.query
    
    const result = await actorService.listActors({
      type: type as string,
      status: status as string,
      tenantId: req.tenantId!,
      limit: Number(limit),
      offset: Number(offset)
    })
    
    res.json({
      actors: result.actors.map(a => ({
        id: a.actorId,
        name: a.actorId,
        type: 'actor'
      })),
      total: result.total,
      limit: Number(limit),
      offset: Number(offset)
    })
  })
  
  // PUT /api/v1/actors/:id - Update actor
  router.put('/:id', async (req, res) => {
    const { id } = req.params
    const updates = req.body
    
    const actor = await actorService.updateActor(id, updates, req.tenantId!)
    
    res.json({
      id: actor.actorId,
      ...updates,
      updatedAt: new Date().toISOString()
    })
  })
  
  // DELETE /api/v1/actors/:id - Delete actor
  router.delete('/:id', async (req, res) => {
    const { id } = req.params
    
    await actorService.deleteActor(id, req.tenantId!)
    
    res.status(204).send()
  })
  
  // POST /api/v1/actors/:id/start - Start actor
  router.post('/:id/start', async (req, res) => {
    const { id } = req.params
    
    await actorService.startActor(id, req.tenantId!)
    
    res.json({ id, status: 'running', startedAt: new Date().toISOString() })
  })
  
  // POST /api/v1/actors/:id/stop - Stop actor
  router.post('/:id/stop', async (req, res) => {
    const { id } = req.params
    
    await actorService.stopActor(id, req.tenantId!)
    
    res.json({ id, status: 'stopped', stoppedAt: new Date().toISOString() })
  })
  
  // POST /api/v1/actors/:id/restart - Restart actor
  router.post('/:id/restart', async (req, res) => {
    const { id } = req.params
    
    await actorService.restartActor(id, req.tenantId!)
    
    res.json({ id, status: 'restarting', restartedAt: new Date().toISOString() })
  })
  
  // GET /api/v1/actors/:id/status - Get runtime status
  router.get('/:id/status', async (req, res) => {
    const { id } = req.params
    
    const status = await actorService.getActorStatus(id, req.tenantId!)
    
    res.json(status)
  })
  
  // POST /api/v1/actors/:id/message - Send message to actor
  router.post('/:id/message', async (req, res) => {
    const { id } = req.params
    const { message, priority } = req.body
    
    const messageId = await actorService.sendMessage(id, message, priority, req.tenantId!)
    
    res.json({
      messageId,
      actorId: id,
      status: 'queued',
      queuedAt: new Date().toISOString()
    })
  })
  
  // GET /api/v1/actors/:id/messages - Get actor messages
  router.get('/:id/messages', async (req, res) => {
    const { id } = req.params
    const { status, limit = 50 } = req.query
    
    const messages = await actorService.getActorMessages(id, {
      status: status as string,
      limit: Number(limit),
      tenantId: req.tenantId!
    })
    
    res.json({
      actorId: id,
      messages,
      total: messages.length
    })
  })
  
  // POST /api/v1/actors/:id/config - Update configuration
  router.post('/:id/config', async (req, res) => {
    const { id } = req.params
    const config = req.body
    
    await actorService.updateActorConfig(id, config, req.tenantId!)
    
    res.json({
      id,
      config,
      appliedAt: new Date().toISOString()
    })
  })
  
  // GET /api/v1/actors/:id/health - Health check
  router.get('/:id/health', async (req, res) => {
    const { id } = req.params
    
    const health = await actorService.checkActorHealth(id, req.tenantId!)
    
    res.json(health)
  })
  
  return router
}
