/**
 * Tests for LoomDB Storage Layer (TODO-018)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LoomMeshService } from '../../../services/loommesh/loommesh-service'
import { LoomDBStore } from '../../../services/loommesh/loomdb-store'
import { createNode, createEdge, NodeType, EdgeType } from '../../../services/loommesh/graph-model'
import type { LoomMeshConfig } from '../../../services/loommesh/loommesh-service'

describe('LoomDB Storage Layer (TODO-018)', () => {
  let service: LoomMeshService
  let db: LoomDBStore

  beforeEach(async () => {
    const config: LoomMeshConfig = {
      storage: { type: 'memory' }
    }
    
    service = new LoomMeshService(config)
    await service.start()
    db = new LoomDBStore(service)
  })

  afterEach(async () => {
    if (db) {
      await db.clear()
    }
    if (service) {
      await service.stop()
    }
  })

  describe('Node Operations', () => {
    it('should store and retrieve a node', async () => {
      const node = createNode('node-1', NodeType.AGENT, {
        name: 'Test Agent',
        status: 'active'
      })

      await db.putNode(node)
      await new Promise(resolve => setTimeout(resolve, 200))

      const retrieved = await db.getNode('node-1')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe('node-1')
      expect(retrieved?.type).toBe(NodeType.AGENT)
      expect(retrieved?.properties.name).toBe('Test Agent')
    })

    it('should return null for non-existent node', async () => {
      const node = await db.getNode('non-existent')
      expect(node).toBeNull()
    })

    it('should update an existing node', async () => {
      const node = createNode('node-1', NodeType.TASK, {
        title: 'Original Title',
        status: 'pending'
      })

      await db.putNode(node)
      await new Promise(resolve => setTimeout(resolve, 200))

      // Update node
      node.properties.title = 'Updated Title'
      node.properties.status = 'completed'
      await db.putNode(node)
      await new Promise(resolve => setTimeout(resolve, 200))

      const updated = await db.getNode('node-1')
      expect(updated?.properties.title).toBe('Updated Title')
      expect(updated?.properties.status).toBe('completed')
    })

    it('should delete a node', async () => {
      const node = createNode('node-1', NodeType.AGENT, { name: 'Agent' })

      await db.putNode(node)
      await new Promise(resolve => setTimeout(resolve, 200))

      const deleted = await db.deleteNode('node-1')
      expect(deleted).toBe(true)

      await new Promise(resolve => setTimeout(resolve, 200))

      const retrieved = await db.getNode('node-1')
      expect(retrieved).toBeNull()
    })

    it('should return false when deleting non-existent node', async () => {
      const deleted = await db.deleteNode('non-existent')
      expect(deleted).toBe(false)
    })
  })

  describe('Edge Operations', () => {
    it('should store and retrieve an edge', async () => {
      // Create nodes first
      await db.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await db.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await new Promise(resolve => setTimeout(resolve, 200))

      // Create edge
      const edge = createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH, {
        strength: 0.8
      }, 1.0)

      await db.putEdge(edge)
      await new Promise(resolve => setTimeout(resolve, 200))

      const retrieved = await db.getEdge('edge-1')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe('edge-1')
      expect(retrieved?.from).toBe('node-1')
      expect(retrieved?.to).toBe('node-2')
      expect(retrieved?.type).toBe(EdgeType.COLLABORATES_WITH)
      expect(retrieved?.weight).toBe(1.0)
    })

    it('should return null for non-existent edge', async () => {
      const edge = await db.getEdge('non-existent')
      expect(edge).toBeNull()
    })

    it('should delete an edge', async () => {
      await db.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await db.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      
      const edge = createEdge('edge-1', 'node-1', 'node-2', EdgeType.DEPENDS_ON)
      await db.putEdge(edge)
      await new Promise(resolve => setTimeout(resolve, 200))

      const deleted = await db.deleteEdge('edge-1')
      expect(deleted).toBe(true)

      await new Promise(resolve => setTimeout(resolve, 200))

      const retrieved = await db.getEdge('edge-1')
      expect(retrieved).toBeNull()
    })
  })

  describe('Edge Indexes', () => {
    it('should get outgoing edges from a node', async () => {
      // Create nodes
      await db.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await db.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await db.putNode(createNode('node-3', NodeType.AGENT, { name: 'Agent 3' }))
      
      // Create edges from node-1
      await db.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH))
      await db.putEdge(createEdge('edge-2', 'node-1', 'node-3', EdgeType.DEPENDS_ON))
      
      await new Promise(resolve => setTimeout(resolve, 500))

      const outgoing = await db.getOutgoingEdges('node-1')
      expect(outgoing.length).toBe(2)
      expect(outgoing.some(e => e.to === 'node-2')).toBe(true)
      expect(outgoing.some(e => e.to === 'node-3')).toBe(true)
    })

    it('should get incoming edges to a node', async () => {
      // Create nodes
      await db.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await db.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await db.putNode(createNode('node-3', NodeType.AGENT, { name: 'Agent 3' }))
      
      // Create edges to node-3
      await db.putEdge(createEdge('edge-1', 'node-1', 'node-3', EdgeType.COLLABORATES_WITH))
      await db.putEdge(createEdge('edge-2', 'node-2', 'node-3', EdgeType.SENDS_TO))
      
      await new Promise(resolve => setTimeout(resolve, 500))

      const incoming = await db.getIncomingEdges('node-3')
      expect(incoming.length).toBe(2)
      expect(incoming.some(e => e.from === 'node-1')).toBe(true)
      expect(incoming.some(e => e.from === 'node-2')).toBe(true)
    })

    it('should filter outgoing edges by type', async () => {
      await db.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await db.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await db.putNode(createNode('node-3', NodeType.AGENT, { name: 'Agent 3' }))
      
      await db.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH))
      await db.putEdge(createEdge('edge-2', 'node-1', 'node-3', EdgeType.DEPENDS_ON))
      
      await new Promise(resolve => setTimeout(resolve, 500))

      const collaborations = await db.getOutgoingEdges('node-1', EdgeType.COLLABORATES_WITH)
      expect(collaborations.length).toBe(1)
      expect(collaborations[0].type).toBe(EdgeType.COLLABORATES_WITH)
    })
  })

  describe('Node Queries', () => {
    it('should query nodes by type', async () => {
      await db.putNode(createNode('agent-1', NodeType.AGENT, { name: 'Agent 1' }))
      await db.putNode(createNode('agent-2', NodeType.AGENT, { name: 'Agent 2' }))
      await db.putNode(createNode('task-1', NodeType.TASK, { title: 'Task 1' }))
      
      await new Promise(resolve => setTimeout(resolve, 500))

      const agents = await db.queryNodes({ type: NodeType.AGENT })
      expect(agents.length).toBe(2)
      expect(agents.every(n => n.type === NodeType.AGENT)).toBe(true)
    })

    it('should query nodes by properties', async () => {
      await db.putNode(createNode('node-1', NodeType.AGENT, { status: 'active', priority: 'high' }))
      await db.putNode(createNode('node-2', NodeType.AGENT, { status: 'inactive', priority: 'low' }))
      await db.putNode(createNode('node-3', NodeType.AGENT, { status: 'active', priority: 'medium' }))
      
      await new Promise(resolve => setTimeout(resolve, 500))

      const activeNodes = await db.queryNodes({ properties: { status: 'active' } })
      expect(activeNodes.length).toBe(2)
      expect(activeNodes.every(n => n.properties.status === 'active')).toBe(true)
    })

    it('should query nodes with pagination', async () => {
      for (let i = 1; i <= 5; i++) {
        await db.putNode(createNode(`node-${i}`, NodeType.AGENT, { index: i }))
      }
      
      await new Promise(resolve => setTimeout(resolve, 500))

      const page1 = await db.queryNodes({ type: NodeType.AGENT, limit: 2, offset: 0 })
      expect(page1.length).toBe(2)

      const page2 = await db.queryNodes({ type: NodeType.AGENT, limit: 2, offset: 2 })
      expect(page2.length).toBe(2)

      // Should have different nodes
      const page1Ids = page1.map(n => n.id)
      const page2Ids = page2.map(n => n.id)
      expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false)
    })
  })

  describe('Edge Queries', () => {
    it('should query edges by type', async () => {
      await db.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await db.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await db.putNode(createNode('node-3', NodeType.AGENT, { name: 'Agent 3' }))
      
      await db.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH))
      await db.putEdge(createEdge('edge-2', 'node-2', 'node-3', EdgeType.COLLABORATES_WITH))
      await db.putEdge(createEdge('edge-3', 'node-1', 'node-3', EdgeType.DEPENDS_ON))
      
      await new Promise(resolve => setTimeout(resolve, 500))

      const collaborations = await db.queryEdges({ type: EdgeType.COLLABORATES_WITH })
      expect(collaborations.length).toBe(2)
      expect(collaborations.every(e => e.type === EdgeType.COLLABORATES_WITH)).toBe(true)
    })

    it('should query edges by source node', async () => {
      await db.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await db.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await db.putNode(createNode('node-3', NodeType.AGENT, { name: 'Agent 3' }))
      
      await db.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.SENDS_TO))
      await db.putEdge(createEdge('edge-2', 'node-1', 'node-3', EdgeType.SENDS_TO))
      await db.putEdge(createEdge('edge-3', 'node-2', 'node-3', EdgeType.SENDS_TO))
      
      await new Promise(resolve => setTimeout(resolve, 500))

      const fromNode1 = await db.queryEdges({ from: 'node-1' })
      expect(fromNode1.length).toBe(2)
      expect(fromNode1.every(e => e.from === 'node-1')).toBe(true)
    })

    it('should query edges by target node', async () => {
      await db.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await db.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await db.putNode(createNode('node-3', NodeType.AGENT, { name: 'Agent 3' }))
      
      await db.putEdge(createEdge('edge-1', 'node-1', 'node-3', EdgeType.SENDS_TO))
      await db.putEdge(createEdge('edge-2', 'node-2', 'node-3', EdgeType.SENDS_TO))
      
      await new Promise(resolve => setTimeout(resolve, 500))

      const toNode3 = await db.queryEdges({ to: 'node-3' })
      expect(toNode3.length).toBe(2)
      expect(toNode3.every(e => e.to === 'node-3')).toBe(true)
    })

    it('should filter edges by weight', async () => {
      await db.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await db.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await db.putNode(createNode('node-3', NodeType.AGENT, { name: 'Agent 3' }))
      
      await db.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.DEPENDS_ON, {}, 0.5))
      await db.putEdge(createEdge('edge-2', 'node-2', 'node-3', EdgeType.DEPENDS_ON, {}, 0.9))
      
      await new Promise(resolve => setTimeout(resolve, 500))

      const strongEdges = await db.queryEdges({ minWeight: 0.8 })
      expect(strongEdges.length).toBe(1)
      expect(strongEdges[0].weight).toBeGreaterThanOrEqual(0.8)
    })
  })

  describe('Node Deletion with Edges', () => {
    it('should delete associated edges when deleting a node', async () => {
      await db.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await db.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      
      await db.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH))
      await new Promise(resolve => setTimeout(resolve, 500))

      // Delete node-1
      await db.deleteNode('node-1')
      await new Promise(resolve => setTimeout(resolve, 500))

      // Edge should be deleted too
      const edge = await db.getEdge('edge-1')
      expect(edge).toBeNull()
    })
  })
})
