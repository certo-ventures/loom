/**
 * 6. State Management API
 * 
 * Actor state operations via Redis
 */

import { Router } from 'express'
import type { LoomService } from '../../services/loom-service'
import { ApiError } from '../../middleware/error-handler'

export function createStateRouter(loomService: LoomService) {
  const router = Router()
  const stateService = loomService.stateService!

  // GET /api/v1/state/:actorId - Get actor state
  router.get('/:actorId', async (req, res) => {
    const { actorId } = req.params
    
    const state = await stateService.getActorState(actorId, req.tenantId!)
    
    if (!state) {
      throw new ApiError(404, 'Actor state not found')
    }
    
    res.json({ actorId, state })
  })

  // PUT /api/v1/state/:actorId - Set actor state
  router.put('/:actorId', async (req, res) => {
    const { actorId } = req.params
    const { state } = req.body
    
    if (!state) {
      throw new ApiError(400, 'state is required')
    }
    
    await stateService.setActorState(actorId, state, req.tenantId!)
    
    res.json({ actorId, updated: true })
  })

  // PATCH /api/v1/state/:actorId - Update actor state (partial)
  router.patch('/:actorId', async (req, res) => {
    const { actorId } = req.params
    const updates = req.body
    
    if (!updates || Object.keys(updates).length === 0) {
      throw new ApiError(400, 'state updates are required')
    }
    
    await stateService.updateActorState(actorId, updates, req.tenantId!)
    
    res.json({ actorId, updated: true })
  })

  // DELETE /api/v1/state/:actorId - Delete actor state
  router.delete('/:actorId', async (req, res) => {
    const { actorId } = req.params
    
    await stateService.deleteActorState(actorId, req.tenantId!)
    
    res.status(204).send()
  })

  // POST /api/v1/state/:actorId/snapshot - Create state snapshot
  router.post('/:actorId/snapshot', async (req, res) => {
    const { actorId } = req.params
    
    const snapshotId = await stateService.createSnapshot(actorId, req.tenantId!)
    
    res.status(201).json({ actorId, snapshotId, created: true })
  })

  // GET /api/v1/state/:actorId/snapshots - List snapshots
  router.get('/:actorId/snapshots', async (req, res) => {
    const { actorId } = req.params
    
    const snapshots = await stateService.listSnapshots(actorId, req.tenantId!)
    
    res.json({ actorId, snapshots, total: snapshots.length })
  })

  // GET /api/v1/state/:actorId/snapshots/:snapshotId - Get snapshot
  router.get('/:actorId/snapshots/:snapshotId', async (req, res) => {
    const { actorId, snapshotId } = req.params
    
    const snapshot = await stateService.getSnapshot(actorId, snapshotId, req.tenantId!)
    
    if (!snapshot) {
      throw new ApiError(404, 'Snapshot not found')
    }
    
    res.json({ actorId, snapshotId, snapshot })
  })

  // POST /api/v1/state/:actorId/restore/:snapshotId - Restore snapshot
  router.post('/:actorId/restore/:snapshotId', async (req, res) => {
    const { actorId, snapshotId } = req.params
    
    await stateService.restoreSnapshot(actorId, snapshotId, req.tenantId!)
    
    res.json({ actorId, snapshotId, restored: true })
  })

  // GET /api/v1/state/query - Query states across actors
  router.get('/query', async (req, res) => {
    const { pattern } = req.query
    
    if (!pattern) {
      throw new ApiError(400, 'pattern is required')
    }
    
    const results = await stateService.queryState(pattern as string, req.tenantId!)
    
    res.json({ pattern, results, total: results.length })
  })

  // GET /api/v1/state/metrics - Get aggregate metrics
  router.get('/metrics', async (req, res) => {
    const metrics = await stateService.getAggregateMetrics(req.tenantId!)
    
    res.json(metrics)
  })

  return router
}
