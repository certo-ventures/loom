/**
 * Tests for LoomDB Query Engine (TODO-019)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LoomMeshService } from '../../../services/loommesh/loommesh-service'
import { LoomDBStore } from '../../../services/loommesh/loomdb-store'
import { LoomDBQueryEngine } from '../../../services/loommesh/loomdb-query-engine'
import { createNode, createEdge, NodeType, EdgeType } from '../../../services/loommesh/graph-model'
import type { LoomMeshConfig } from '../../../services/loommesh/loommesh-service'

describe('LoomDB Query Engine (TODO-019)', () => {
  let service: LoomMeshService
  let store: LoomDBStore
  let engine: LoomDBQueryEngine

  beforeEach(async () => {
    const config: LoomMeshConfig = {
      storage: { type: 'memory' }
    }
    
    service = new LoomMeshService(config)
    await service.start()
    store = new LoomDBStore(service)
    engine = new LoomDBQueryEngine(store)
  })

  afterEach(async () => {
    if (store) {
      await store.clear()
    }
    if (service) {
      await service.stop()
    }
  })

  describe('Path Finding', () => {
    it('should find all paths between two nodes', async () => {
      // Create a simple graph: A -> B -> D
      //                         A -> C -> D
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))
      await store.putNode(createNode('D', NodeType.AGENT, { name: 'D' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'B', 'D', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e3', 'A', 'C', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e4', 'C', 'D', EdgeType.COLLABORATES_WITH))

      await new Promise(resolve => setTimeout(resolve, 500))

      const paths = await engine.findPaths('A', 'D')
      
      expect(paths.length).toBe(2)
      expect(paths.every(p => p.nodes[0].id === 'A' && p.nodes[p.nodes.length - 1].id === 'D')).toBe(true)
    })

    it('should respect maxDepth in path finding', async () => {
      // Create a chain: A -> B -> C -> D
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))
      await store.putNode(createNode('D', NodeType.AGENT, { name: 'D' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'B', 'C', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e3', 'C', 'D', EdgeType.COLLABORATES_WITH))

      await new Promise(resolve => setTimeout(resolve, 500))

      // With maxDepth=2, should not reach D from A
      const paths = await engine.findPaths('A', 'D', { maxDepth: 2 })
      expect(paths.length).toBe(0)

      // With maxDepth=3, should reach D
      const pathsDeep = await engine.findPaths('A', 'D', { maxDepth: 3 })
      expect(pathsDeep.length).toBe(1)
    })

    it('should filter paths by edge type', async () => {
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'B', 'C', EdgeType.DEPENDS_ON))

      await new Promise(resolve => setTimeout(resolve, 500))

      // Should find path with both edge types
      const allPaths = await engine.findPaths('A', 'C')
      expect(allPaths.length).toBe(1)

      // Should not find path when filtering for only COLLABORATES_WITH
      const collaborationPaths = await engine.findPaths('A', 'C', {
        edgeTypes: [EdgeType.COLLABORATES_WITH]
      })
      expect(collaborationPaths.length).toBe(0)
    })
  })

  describe('Shortest Path', () => {
    it('should find shortest path between two nodes', async () => {
      // Create graph with multiple paths of different lengths
      // A -> B -> D (2 edges)
      // A -> C -> E -> D (3 edges)
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))
      await store.putNode(createNode('D', NodeType.AGENT, { name: 'D' }))
      await store.putNode(createNode('E', NodeType.AGENT, { name: 'E' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'B', 'D', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e3', 'A', 'C', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e4', 'C', 'E', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e5', 'E', 'D', EdgeType.COLLABORATES_WITH))

      await new Promise(resolve => setTimeout(resolve, 500))

      const path = await engine.findShortestPath('A', 'D')
      
      expect(path).not.toBeNull()
      expect(path!.length).toBe(2)
      expect(path!.nodes.map(n => n.id)).toEqual(['A', 'B', 'D'])
    })

    it('should return null when no path exists', async () => {
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))

      await new Promise(resolve => setTimeout(resolve, 500))

      const path = await engine.findShortestPath('A', 'B')
      expect(path).toBeNull()
    })
  })

  describe('Graph Traversal', () => {
    it('should traverse graph using DFS', async () => {
      // Create a simple tree
      //     A
      //    / \
      //   B   C
      //  /
      // D
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))
      await store.putNode(createNode('D', NodeType.AGENT, { name: 'D' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.PARENT_OF))
      await store.putEdge(createEdge('e2', 'A', 'C', EdgeType.PARENT_OF))
      await store.putEdge(createEdge('e3', 'B', 'D', EdgeType.PARENT_OF))

      await new Promise(resolve => setTimeout(resolve, 500))

      const visited: string[] = []
      await engine.traverseDFS('A', (node) => {
        visited.push(node.id)
      })

      expect(visited).toContain('A')
      expect(visited).toContain('B')
      expect(visited).toContain('C')
      expect(visited).toContain('D')
      expect(visited.length).toBe(4)
    })

    it('should traverse graph using BFS', async () => {
      // Create a simple tree
      //     A
      //    / \
      //   B   C
      //  /
      // D
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))
      await store.putNode(createNode('D', NodeType.AGENT, { name: 'D' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.PARENT_OF))
      await store.putEdge(createEdge('e2', 'A', 'C', EdgeType.PARENT_OF))
      await store.putEdge(createEdge('e3', 'B', 'D', EdgeType.PARENT_OF))

      await new Promise(resolve => setTimeout(resolve, 500))

      const visited: Array<{ id: string; depth: number }> = []
      await engine.traverseBFS('A', (node, depth) => {
        visited.push({ id: node.id, depth })
      })

      expect(visited.length).toBe(4)
      // A should be at depth 0
      expect(visited.find(v => v.id === 'A')?.depth).toBe(0)
      // B and C should be at depth 1
      expect(visited.find(v => v.id === 'B')?.depth).toBe(1)
      expect(visited.find(v => v.id === 'C')?.depth).toBe(1)
      // D should be at depth 2
      expect(visited.find(v => v.id === 'D')?.depth).toBe(2)
    })

    it('should stop traversal when visitor returns true', async () => {
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.PARENT_OF))
      await store.putEdge(createEdge('e2', 'B', 'C', EdgeType.PARENT_OF))

      await new Promise(resolve => setTimeout(resolve, 500))

      const visited: string[] = []
      await engine.traverseBFS('A', (node) => {
        visited.push(node.id)
        // Stop after visiting B
        return node.id === 'B'
      })

      expect(visited).toContain('A')
      expect(visited).toContain('B')
      expect(visited).not.toContain('C')
    })
  })

  describe('Neighbor Queries', () => {
    it('should get direct neighbors (depth 1)', async () => {
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))
      await store.putNode(createNode('D', NodeType.AGENT, { name: 'D' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'A', 'C', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e3', 'B', 'D', EdgeType.COLLABORATES_WITH))

      await new Promise(resolve => setTimeout(resolve, 500))

      const neighbors = await engine.getNeighbors('A', 1)
      
      expect(neighbors.length).toBe(2)
      expect(neighbors.map(n => n.id).sort()).toEqual(['B', 'C'])
    })

    it('should get neighbors at depth 2', async () => {
      // A -> B -> D
      // A -> C
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))
      await store.putNode(createNode('D', NodeType.AGENT, { name: 'D' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'A', 'C', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e3', 'B', 'D', EdgeType.COLLABORATES_WITH))

      await new Promise(resolve => setTimeout(resolve, 500))

      const neighbors = await engine.getNeighbors('A', 2)
      
      // D is the only node at depth 2 from A
      expect(neighbors.length).toBe(1)
      expect(neighbors[0].id).toBe('D')
    })
  })

  describe('Subgraph Extraction', () => {
    it('should extract subgraph around a node', async () => {
      // Create a network: A -> B -> C
      //                   A -> D
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))
      await store.putNode(createNode('D', NodeType.AGENT, { name: 'D' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'B', 'C', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e3', 'A', 'D', EdgeType.COLLABORATES_WITH))

      await new Promise(resolve => setTimeout(resolve, 500))

      const subgraph = await engine.extractSubgraph('A', { maxDepth: 1 })
      
      expect(subgraph).not.toBeNull()
      expect(subgraph!.centerId).toBe('A')
      expect(subgraph!.nodes.length).toBe(3) // A, B, D
      expect(subgraph!.edges.length).toBe(2) // e1, e3
    })

    it('should filter subgraph by node type', async () => {
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.TASK, { name: 'C' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'A', 'C', EdgeType.OWNS))

      await new Promise(resolve => setTimeout(resolve, 500))

      const subgraph = await engine.extractSubgraph('A', {
        maxDepth: 1,
        nodeTypes: [NodeType.AGENT]
      })
      
      expect(subgraph).not.toBeNull()
      // Should only include A and B (both AGENT type), not C (TASK type)
      expect(subgraph!.nodes.length).toBe(2)
      expect(subgraph!.nodes.every(n => n.type === NodeType.AGENT)).toBe(true)
    })
  })

  describe('Connected Components', () => {
    it('should find all nodes in connected component', async () => {
      // Create two separate components:
      // Component 1: A - B - C
      // Component 2: D - E
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))
      await store.putNode(createNode('D', NodeType.AGENT, { name: 'D' }))
      await store.putNode(createNode('E', NodeType.AGENT, { name: 'E' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'B', 'C', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e3', 'D', 'E', EdgeType.COLLABORATES_WITH))

      await new Promise(resolve => setTimeout(resolve, 500))

      const component1 = await engine.findConnectedComponent('A')
      expect(component1.length).toBe(3)
      expect(component1.map(n => n.id).sort()).toEqual(['A', 'B', 'C'])

      const component2 = await engine.findConnectedComponent('D')
      expect(component2.length).toBe(2)
      expect(component2.map(n => n.id).sort()).toEqual(['D', 'E'])
    }, 10000) // Increase timeout to 10s

    it('should handle isolated nodes', async () => {
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await new Promise(resolve => setTimeout(resolve, 500))

      const component = await engine.findConnectedComponent('A')
      expect(component.length).toBe(1)
      expect(component[0].id).toBe('A')
    })
  })

  describe('Edge Cases', () => {
    it('should handle non-existent start node in path finding', async () => {
      const paths = await engine.findPaths('non-existent', 'also-non-existent')
      expect(paths.length).toBe(0)
    })

    it('should handle circular graphs', async () => {
      // Create a cycle: A -> B -> C -> A
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))

      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'B', 'C', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e3', 'C', 'A', EdgeType.COLLABORATES_WITH))

      await new Promise(resolve => setTimeout(resolve, 500))

      // Should handle cycle without infinite loop
      const neighbors = await engine.getNeighbors('A', 2)
      expect(neighbors.length).toBeGreaterThan(0)
    })
  })
})
