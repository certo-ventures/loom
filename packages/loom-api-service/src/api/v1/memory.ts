/**
 * 2. Memory & Knowledge Graph API
 * 
 * Full graph operations, entities, facts, episodes
 */

import { Router } from 'express'
import type { LoomService } from '../../services/loom-service'
import { ApiError } from '../../middleware/error-handler'

export function createMemoryRouter(loomService: LoomService) {
  const router = Router()
  const memoryService = loomService.memoryService!
  
  // ===== ENTITIES =====
  
  // POST /api/v1/memory/entities - Create entity
  router.post('/entities', async (req, res) => {
    const { name, type, properties } = req.body
    
    if (!name) {
      throw new ApiError(400, 'name is required')
    }
    
    const entity = await memoryService.createEntity(
      { name, type, properties },
      req.tenantId!
    )
    
    res.status(201).json(entity)
  })
  
  // GET /api/v1/memory/entities/:id - Get entity
  router.get('/entities/:id', async (req, res) => {
    const { id } = req.params
    
    const entity = await memoryService.getEntity(id, req.tenantId!)
    
    if (!entity) {
      throw new ApiError(404, 'Entity not found')
    }
    
    res.json(entity)
  })
  
  // PUT /api/v1/memory/entities/:id - Update entity
  router.put('/entities/:id', async (req, res) => {
    const { id } = req.params
    const updates = req.body
    
    const entity = await memoryService.updateEntity(id, updates, req.tenantId!)
    
    if (!entity) {
      throw new ApiError(404, 'Entity not found')
    }
    
    res.json(entity)
  })
  
  // DELETE /api/v1/memory/entities/:id - Delete entity
  router.delete('/entities/:id', async (req, res) => {
    const { id } = req.params
    
    await memoryService.deleteEntity(id, req.tenantId!)
    
    res.status(204).send()
  })
  
  // GET /api/v1/memory/entities - Search entities
  router.get('/entities', async (req, res) => {
    const { type, name, limit = 50, offset = 0 } = req.query
    
    const result = await memoryService.searchEntities(
      {
        type: type as string,
        name: name as string,
        limit: Number(limit),
        offset: Number(offset)
      },
      req.tenantId!
    )
    
    res.json(result)
  })
  
  // ===== FACTS (Relationships) =====
  
  // POST /api/v1/memory/facts - Add fact
  router.post('/facts', async (req, res) => {
    const { sourceEntityId, relation, targetEntityId, text, properties } = req.body
    
    if (!sourceEntityId || !relation || !targetEntityId) {
      throw new ApiError(400, 'sourceEntityId, relation, and targetEntityId are required')
    }
    
    const fact = await memoryService.addFact(
      {
        source_entity_id: sourceEntityId,
        relation,
        target_entity_id: targetEntityId,
        text,
        properties
      },
      req.tenantId!
    )
    
    res.status(201).json(fact)
  })
  
  // GET /api/v1/memory/facts/:id - Get fact
  router.get('/facts/:id', async (req, res) => {
    const { id } = req.params
    
    const fact = await memoryService.getFact(id, req.tenantId!)
    
    if (!fact) {
      throw new ApiError(404, 'Fact not found')
    }
    
    res.json(fact)
  })
  
  // GET /api/v1/memory/facts - Search facts
  router.get('/facts', async (req, res) => {
    const { sourceEntityId, relation, targetEntityId, limit = 50 } = req.query
    
    const result = await memoryService.searchFacts(
      {
        source: sourceEntityId as string,
        relation: relation as string,
        target: targetEntityId as string,
        limit: Number(limit)
      },
      req.tenantId!
    )
    
    res.json(result)
  })
  
  // DELETE /api/v1/memory/facts/:id - Delete fact
  router.delete('/facts/:id', async (req, res) => {
    const { id } = req.params
    
    await memoryService.deleteFact(id, req.tenantId!)
    
    res.status(204).send()
  })
  
  // ===== GRAPH QUERIES =====
  
  // POST /api/v1/memory/graph/query - Complex graph query
  router.post('/graph/query', async (req, res) => {
    const { query } = req.body
    
    // TODO: Execute graph query (Cypher-like or custom DSL)
    
    res.json({
      results: [],
      executionTime: 10
    })
  })
  
  // GET /api/v1/memory/graph/neighbors/:id - Get neighbors
  router.get('/graph/neighbors/:id', async (req, res) => {
    const { id } = req.params
    const { direction = 'both', relation, depth = 1 } = req.query
    
    const result = await memoryService.getNeighbors(
      id,
      {
        direction: direction as 'in' | 'out' | 'both',
        relation: relation as string,
        depth: Number(depth)
      },
      req.tenantId!
    )
    
    res.json(result)
  })
  
  // GET /api/v1/memory/graph/path - Find path between entities
  router.get('/graph/path', async (req, res) => {
    const { from, to, maxDepth = 5 } = req.query
    
    if (!from || !to) {
      throw new ApiError(400, 'from and to parameters are required')
    }
    
    const result = await memoryService.findPath(
      from as string,
      to as string,
      { maxDepth: Number(maxDepth) },
      req.tenantId!
    )
    
    res.json(result)
  })
  
  // POST /api/v1/memory/graph/traverse - Graph traversal
  router.post('/graph/traverse', async (req, res) => {
    const { startEntityId, traversalRules } = req.body
    
    res.json({
      startEntity: startEntityId,
      visitedNodes: [],
      edges: []
    })
  })
  
  // GET /api/v1/memory/graph/subgraph/:id - Extract subgraph
  router.get('/graph/subgraph/:id', async (req, res) => {
    const { id } = req.params
    const { depth = 2, maxNodes = 100 } = req.query
    
    const result = await memoryService.getSubgraph(
      id,
      { depth: Number(depth) },
      req.tenantId!
    )
    
    res.json(result)
  })
  
  // ===== EPISODES (Temporal) =====
  
  // POST /api/v1/memory/episodes - Create episode
  router.post('/episodes', async (req, res) => {
    const { actorId, content, facts, timestamp } = req.body
    
    const episode = await memoryService.createEpisode(
      {
        actor_id: actorId,
        content,
        facts: facts || [],
        timestamp: timestamp ? new Date(timestamp) : new Date()
      },
      req.tenantId!
    )
    
    res.status(201).json(episode)
  })
  
  // GET /api/v1/memory/episodes/:id - Get episode
  router.get('/episodes/:id', async (req, res) => {
    const { id } = req.params
    
    const episode = await memoryService.getEpisode(id, req.tenantId!)
    
    if (!episode) {
      throw new ApiError(404, 'Episode not found')
    }
    
    res.json(episode)
  })
  
  // GET /api/v1/memory/episodes - Search episodes
  router.get('/episodes', async (req, res) => {
    const { actorId, startDate, endDate, limit = 50 } = req.query
    
    const result = await memoryService.searchEpisodes(
      {
        actorId: actorId as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        limit: Number(limit)
      },
      req.tenantId!
    )
    
    res.json(result)
  })
  
  // ===== SIMILARITY SEARCH =====
  
  // POST /api/v1/memory/search/vector - Vector similarity search
  router.post('/search/vector', async (req, res) => {
    const { vector, topK = 10, threshold = 0.7 } = req.body
    
    if (!vector || !Array.isArray(vector)) {
      throw new ApiError(400, 'vector array is required')
    }
    
    const result = await memoryService.vectorSearch(
      vector,
      { topK: Number(topK), threshold: Number(threshold) },
      req.tenantId!
    )
    
    res.json(result)
  })
  
  // POST /api/v1/memory/search/semantic - Semantic search
  router.post('/search/semantic', async (req, res) => {
    const { query, topK = 10 } = req.body
    
    if (!query) {
      throw new ApiError(400, 'query is required')
    }
    
    const result = await memoryService.semanticSearch(
      query,
      { topK: Number(topK) },
      req.tenantId!
    )
    
    res.json(result)
  })
  
  // POST /api/v1/memory/search/hybrid - Hybrid search
  router.post('/search/hybrid', async (req, res) => {
    const { query, vector, weights = { semantic: 0.5, vector: 0.5 }, topK = 10 } = req.body
    
    const result = await memoryService.hybridSearch(
      { query, vector },
      { weights, topK: Number(topK) },
      req.tenantId!
    )
    
    res.json(result)
  })
  
  return router
}
