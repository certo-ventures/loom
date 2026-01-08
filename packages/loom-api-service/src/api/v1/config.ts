/**
 * 4. Configuration API
 * 
 * Hierarchical configuration management with context-aware resolution
 */

import { Router } from 'express'
import type { LoomService } from '../../services/loom-service'
import { ApiError } from '../../middleware/error-handler'

export function createConfigRouter(loomService: LoomService) {
  const router = Router()
  const configService = loomService.configService!

  // GET /api/v1/config/:keyPath - Get configuration value
  router.get('/:keyPath(*)', async (req, res) => {
    const { keyPath } = req.params
    
    if (!keyPath) {
      throw new ApiError(400, 'keyPath is required')
    }
    
    const value = await configService.get(keyPath, req.tenantId!)
    
    if (value === undefined) {
      throw new ApiError(404, `Configuration key not found: ${keyPath}`)
    }
    
    res.json({ keyPath, value })
  })

  // PUT /api/v1/config/:keyPath - Set configuration value
  router.put('/:keyPath(*)', async (req, res) => {
    const { keyPath } = req.params
    const { value } = req.body
    
    if (!keyPath) {
      throw new ApiError(400, 'keyPath is required')
    }
    
    if (value === undefined) {
      throw new ApiError(400, 'value is required')
    }
    
    await configService.set(keyPath, value, req.tenantId!)
    
    res.json({ keyPath, value, updated: true })
  })

  // DELETE /api/v1/config/:keyPath - Delete configuration value
  router.delete('/:keyPath(*)', async (req, res) => {
    const { keyPath } = req.params
    
    if (!keyPath) {
      throw new ApiError(400, 'keyPath is required')
    }
    
    await configService.delete(keyPath, req.tenantId!)
    
    res.status(204).send()
  })

  // GET /api/v1/config - List configuration keys
  router.get('/', async (req, res) => {
    const { prefix } = req.query
    
    const keys = await configService.listKeys(prefix as string, req.tenantId!)
    
    res.json({ keys, prefix: prefix || '', total: keys.length })
  })

  // POST /api/v1/config/resolve - Resolve with context
  router.post('/resolve', async (req, res) => {
    const { key, context } = req.body
    
    if (!key) {
      throw new ApiError(400, 'key is required')
    }
    
    const value = await configService.resolveWithContext(
      key,
      context || {},
      req.tenantId!
    )
    
    res.json({ key, value, context })
  })

  // POST /api/v1/config/import - Bulk import configuration
  router.post('/import', async (req, res) => {
    const { config, merge = true } = req.body
    
    if (!config || typeof config !== 'object') {
      throw new ApiError(400, 'config object is required')
    }
    
    await configService.importConfig(config, merge, req.tenantId!)
    
    res.json({ imported: true, keyCount: Object.keys(config).length })
  })

  // POST /api/v1/config/export - Bulk export configuration
  router.post('/export', async (req, res) => {
    const { prefix } = req.body
    
    const config = await configService.exportConfig(prefix, req.tenantId!)
    
    res.json({ config, prefix: prefix || '' })
  })

  // POST /api/v1/config/validate - Validate configuration structure
  router.post('/validate', async (req, res) => {
    const { requiredKeys } = req.body
    
    if (!Array.isArray(requiredKeys)) {
      throw new ApiError(400, 'requiredKeys array is required')
    }
    
    const result = await configService.validateStructure(requiredKeys, req.tenantId!)
    
    res.json(result)
  })

  return router
}
