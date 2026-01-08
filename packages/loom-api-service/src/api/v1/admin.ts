/**
 * 9. Admin & Operations API
 * 
 * System administration and operations
 */

import { Router } from 'express'
import jwt from 'jsonwebtoken'
import type { LoomService } from '../../services/loom-service'
import { ApiError } from '../../middleware/error-handler'

export function createAdminRouter(loomService: LoomService) {
  const router = Router()

  // Require admin role for all admin endpoints
  router.use((req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      throw new ApiError(403, 'Admin access required')
    }
    next()
  })

  // GET /api/v1/admin/info - System information
  router.get('/info', async (req, res) => {
    const info = {
      version: '0.1.0',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development'
    }
    
    res.json(info)
  })

  // GET /api/v1/admin/storage/stats - Storage statistics
  router.get('/storage/stats', async (req, res) => {
    const storage = loomService.storage
    
    // Get basic stats from memory storage
    const stats = {
      type: 'in-memory', // or postgresql/redis
      entities: 0,
      facts: 0,
      episodes: 0,
      totalSize: 0
    }
    
    res.json(stats)
  })

  // POST /api/v1/admin/storage/cleanup - Cleanup old data
  router.post('/storage/cleanup', async (req, res) => {
    const { olderThan, dryRun = false } = req.body
    
    if (!olderThan) {
      throw new ApiError(400, 'olderThan parameter is required')
    }
    
    // TODO: Implement cleanup logic
    
    res.json({
      cleaned: true,
      dryRun,
      entitiesRemoved: 0,
      factsRemoved: 0,
      episodesRemoved: 0
    })
  })

  // POST /api/v1/admin/cache/clear - Clear caches
  router.post('/cache/clear', async (req, res) => {
    const { cacheType } = req.body
    
    const redis = loomService.redis
    
    if (cacheType === 'all' || !cacheType) {
      // Clear all cache keys (use with caution!)
      // await redis?.flushdb()
    }
    
    res.json({ cleared: true, cacheType: cacheType || 'all' })
  })

  // ===== Tenant Management =====

  // POST /api/v1/admin/tenants - Create tenant
  router.post('/tenants', async (req, res) => {
    const { tenantId, name, config } = req.body
    
    if (!tenantId || !name) {
      throw new ApiError(400, 'tenantId and name are required')
    }
    
    const tenant = {
      tenantId,
      name,
      config: config || {},
      createdAt: new Date().toISOString(),
      status: 'active'
    }
    
    // TODO: Store tenant in database
    
    res.status(201).json(tenant)
  })

  // GET /api/v1/admin/tenants - List tenants
  router.get('/tenants', async (req, res) => {
    res.json({
      tenants: [],
      total: 0
    })
  })

  // PUT /api/v1/admin/tenants/:tenantId - Update tenant
  router.put('/tenants/:tenantId', async (req, res) => {
    const { tenantId } = req.params
    const updates = req.body
    
    res.json({
      tenantId,
      ...updates,
      updatedAt: new Date().toISOString()
    })
  })

  // DELETE /api/v1/admin/tenants/:tenantId - Delete tenant
  router.delete('/tenants/:tenantId', async (req, res) => {
    const { tenantId } = req.params
    
    // TODO: Delete tenant and all associated data
    
    res.status(204).send()
  })

  // ===== Token Management =====

  // POST /api/v1/admin/tokens - Generate API token
  router.post('/tokens', async (req, res) => {
    const { userId, tenantId, expiresIn = '30d', permissions = [] } = req.body
    
    if (!userId) {
      throw new ApiError(400, 'userId is required')
    }
    
    const jwtSecret = process.env.JWT_SECRET || 'dev-secret'
    
    const token = jwt.sign(
      {
        userId,
        tenantId,
        role: 'user',
        permissions
      },
      jwtSecret,
      { expiresIn }
    )
    
    res.status(201).json({
      token,
      userId,
      tenantId,
      expiresIn,
      createdAt: new Date().toISOString()
    })
  })

  // GET /api/v1/admin/tokens - List active tokens
  router.get('/tokens', async (req, res) => {
    res.json({
      tokens: [],
      total: 0
    })
  })

  // DELETE /api/v1/admin/tokens/:tokenId - Revoke token
  router.delete('/tokens/:tokenId', async (req, res) => {
    const { tokenId } = req.params
    
    // TODO: Add token to revocation list
    
    res.status(204).send()
  })

  return router
}
