/**
 * Tests for Graph Visualization Exporter (TODO-021)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LoomMeshService } from '../../../services/loommesh/loommesh-service'
import { LoomDBStore } from '../../../services/loommesh/loomdb-store'
import { GraphVisualizer } from '../../../services/loommesh/graph-visualizer'
import { createNode, createEdge, NodeType, EdgeType } from '../../../services/loommesh/graph-model'
import type { LoomMeshConfig } from '../../../services/loommesh/loommesh-service'

describe('Graph Visualization Exporter (TODO-021)', () => {
  let service: LoomMeshService
  let store: LoomDBStore
  let visualizer: GraphVisualizer

  beforeEach(async () => {
    const config: LoomMeshConfig = {
      storage: { type: 'memory' }
    }
    
    service = new LoomMeshService(config)
    await service.start()
    store = new LoomDBStore(service)
    visualizer = new GraphVisualizer(store)
  })

  afterEach(async () => {
    if (store) {
      await store.clear()
    }
    if (service) {
      await service.stop()
    }
  })

  describe('Basic D3 Export', () => {
    it('should export empty graph', async () => {
      const d3Graph = await visualizer.exportToD3()
      
      expect(d3Graph.nodes).toEqual([])
      expect(d3Graph.links).toEqual([])
    })

    it('should export nodes with default formatting', async () => {
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await store.putNode(createNode('node-2', NodeType.TASK, { title: 'Task 1' }))
      await new Promise(resolve => setTimeout(resolve, 300))

      const d3Graph = await visualizer.exportToD3()
      
      expect(d3Graph.nodes.length).toBe(2)
      expect(d3Graph.nodes[0].id).toBe('node-1')
      expect(d3Graph.nodes[0].label).toBe('Agent 1')
      expect(d3Graph.nodes[0].group).toBe(NodeType.AGENT)
      
      expect(d3Graph.nodes[1].id).toBe('node-2')
      expect(d3Graph.nodes[1].label).toBe('Task 1')
      expect(d3Graph.nodes[1].group).toBe(NodeType.TASK)
    })

    it('should export edges as links', async () => {
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await store.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await store.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH, {}, 0.8))
      await new Promise(resolve => setTimeout(resolve, 300))

      const d3Graph = await visualizer.exportToD3()
      
      expect(d3Graph.links.length).toBe(1)
      expect(d3Graph.links[0].source).toBe('node-1')
      expect(d3Graph.links[0].target).toBe('node-2')
      expect(d3Graph.links[0].type).toBe(EdgeType.COLLABORATES_WITH)
      expect(d3Graph.links[0].value).toBe(0.8)
    })

    it('should filter out edges with missing nodes', async () => {
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await store.putEdge(createEdge('edge-1', 'node-1', 'missing-node', EdgeType.COLLABORATES_WITH))
      await new Promise(resolve => setTimeout(resolve, 300))

      const d3Graph = await visualizer.exportToD3()
      
      expect(d3Graph.nodes.length).toBe(1)
      expect(d3Graph.links.length).toBe(0) // Edge filtered out
    })
  })

  describe('Export Options', () => {
    it('should include node properties when requested', async () => {
      await store.putNode(createNode('node-1', NodeType.AGENT, { 
        name: 'Agent 1', 
        status: 'active',
        priority: 'high'
      }))
      await new Promise(resolve => setTimeout(resolve, 300))

      const d3Graph = await visualizer.exportToD3({ includeNodeProperties: true })
      
      expect(d3Graph.nodes[0].properties).toBeDefined()
      expect(d3Graph.nodes[0].properties.status).toBe('active')
      expect(d3Graph.nodes[0].properties.priority).toBe('high')
    })

    it('should include edge properties when requested', async () => {
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await store.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await store.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH, {
        strength: 'strong',
        duration: '6 months'
      }))
      await new Promise(resolve => setTimeout(resolve, 300))

      const d3Graph = await visualizer.exportToD3({ includeEdgeProperties: true })
      
      expect(d3Graph.links[0].properties).toBeDefined()
      expect(d3Graph.links[0].properties.strength).toBe('strong')
      expect(d3Graph.links[0].properties.duration).toBe('6 months')
    })

    it('should use custom node label function', async () => {
      await store.putNode(createNode('node-1', NodeType.AGENT, { 
        firstName: 'John',
        lastName: 'Doe'
      }))
      await new Promise(resolve => setTimeout(resolve, 300))

      const d3Graph = await visualizer.exportToD3({
        nodeLabel: (node) => `${node.properties.firstName} ${node.properties.lastName}`
      })
      
      expect(d3Graph.nodes[0].label).toBe('John Doe')
    })

    it('should use custom node group function', async () => {
      await store.putNode(createNode('node-1', NodeType.AGENT, { 
        name: 'Agent 1',
        department: 'Engineering'
      }))
      await new Promise(resolve => setTimeout(resolve, 300))

      const d3Graph = await visualizer.exportToD3({
        nodeGroup: (node) => node.properties.department
      })
      
      expect(d3Graph.nodes[0].group).toBe('Engineering')
    })

    it('should use custom link value function', async () => {
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await store.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await store.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH, {
        interactions: 50
      }))
      await new Promise(resolve => setTimeout(resolve, 300))

      const d3Graph = await visualizer.exportToD3({
        linkValue: (edge) => edge.properties.interactions / 10
      })
      
      expect(d3Graph.links[0].value).toBe(5)
    })
  })

  describe('Filtering', () => {
    it('should filter nodes by type', async () => {
      await store.putNode(createNode('agent-1', NodeType.AGENT, { name: 'Agent 1' }))
      await store.putNode(createNode('task-1', NodeType.TASK, { title: 'Task 1' }))
      await store.putNode(createNode('agent-2', NodeType.AGENT, { name: 'Agent 2' }))
      await new Promise(resolve => setTimeout(resolve, 300))

      const d3Graph = await visualizer.exportToD3({
        nodeFilter: { type: NodeType.AGENT }
      })
      
      expect(d3Graph.nodes.length).toBe(2)
      expect(d3Graph.nodes.every(n => n.group === NodeType.AGENT)).toBe(true)
    })

    it('should filter edges by type', async () => {
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await store.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await store.putNode(createNode('node-3', NodeType.AGENT, { name: 'Agent 3' }))
      
      await store.putEdge(createEdge('e1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'node-2', 'node-3', EdgeType.DEPENDS_ON))
      await new Promise(resolve => setTimeout(resolve, 300))

      const d3Graph = await visualizer.exportToD3({
        edgeFilter: { type: EdgeType.COLLABORATES_WITH }
      })
      
      expect(d3Graph.links.length).toBe(1)
      expect(d3Graph.links[0].type).toBe(EdgeType.COLLABORATES_WITH)
    })

    it('should filter nodes by properties', async () => {
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'A1', status: 'active' }))
      await store.putNode(createNode('node-2', NodeType.AGENT, { name: 'A2', status: 'inactive' }))
      await store.putNode(createNode('node-3', NodeType.AGENT, { name: 'A3', status: 'active' }))
      await new Promise(resolve => setTimeout(resolve, 300))

      const d3Graph = await visualizer.exportToD3({
        nodeFilter: { properties: { status: 'active' } }
      })
      
      expect(d3Graph.nodes.length).toBe(2)
    })
  })

  describe('Subgraph Export', () => {
    it('should export subgraph around center node', async () => {
      // Create a network: A -> B -> C -> D
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))
      await store.putNode(createNode('D', NodeType.AGENT, { name: 'D' }))
      
      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'B', 'C', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e3', 'C', 'D', EdgeType.COLLABORATES_WITH))
      await new Promise(resolve => setTimeout(resolve, 500))

      const d3Graph = await visualizer.exportSubgraphToD3('B', 1)
      
      // Should include B, A (depth 1), and C (depth 1), but not D
      expect(d3Graph.nodes.length).toBe(3)
      expect(d3Graph.nodes.map(n => n.id).sort()).toEqual(['A', 'B', 'C'])
    })

    it('should export subgraph with depth 0 (only center)', async () => {
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await new Promise(resolve => setTimeout(resolve, 300))

      const d3Graph = await visualizer.exportSubgraphToD3('A', 0)
      
      expect(d3Graph.nodes.length).toBe(1)
      expect(d3Graph.nodes[0].id).toBe('A')
      expect(d3Graph.links.length).toBe(0)
    })
  })

  describe('JSON Export', () => {
    it('should export to formatted JSON string', async () => {
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await store.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await store.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH))
      await new Promise(resolve => setTimeout(resolve, 300))

      const json = await visualizer.exportToJSON()
      
      expect(json).toBeTruthy()
      const parsed = JSON.parse(json)
      expect(parsed.nodes).toBeDefined()
      expect(parsed.links).toBeDefined()
      expect(parsed.nodes.length).toBe(2)
      expect(parsed.links.length).toBe(1)
    })

    it('should export subgraph to JSON string', async () => {
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await new Promise(resolve => setTimeout(resolve, 300))

      const json = await visualizer.exportSubgraphToJSON('A', 1)
      
      const parsed = JSON.parse(json)
      expect(parsed.nodes.length).toBe(2)
      expect(parsed.links.length).toBe(1)
    })
  })

  describe('Complex Scenarios', () => {
    it('should handle disconnected components', async () => {
      // Component 1: A - B
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      
      // Component 2: C - D
      await store.putNode(createNode('C', NodeType.AGENT, { name: 'C' }))
      await store.putNode(createNode('D', NodeType.AGENT, { name: 'D' }))
      await store.putEdge(createEdge('e2', 'C', 'D', EdgeType.COLLABORATES_WITH))
      await new Promise(resolve => setTimeout(resolve, 500))

      const d3Graph = await visualizer.exportToD3()
      
      expect(d3Graph.nodes.length).toBe(4)
      expect(d3Graph.links.length).toBe(2)
    })

    it('should handle nodes with no edges', async () => {
      await store.putNode(createNode('isolated', NodeType.AGENT, { name: 'Isolated' }))
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Node 1' }))
      await store.putNode(createNode('node-2', NodeType.AGENT, { name: 'Node 2' }))
      await store.putEdge(createEdge('e1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH))
      await new Promise(resolve => setTimeout(resolve, 500))

      const d3Graph = await visualizer.exportToD3()
      
      expect(d3Graph.nodes.length).toBe(3)
      expect(d3Graph.links.length).toBe(1)
    })

    it('should handle bidirectional edges', async () => {
      await store.putNode(createNode('A', NodeType.AGENT, { name: 'A' }))
      await store.putNode(createNode('B', NodeType.AGENT, { name: 'B' }))
      
      await store.putEdge(createEdge('e1', 'A', 'B', EdgeType.COLLABORATES_WITH))
      await store.putEdge(createEdge('e2', 'B', 'A', EdgeType.COLLABORATES_WITH))
      await new Promise(resolve => setTimeout(resolve, 500))

      const d3Graph = await visualizer.exportToD3()
      
      expect(d3Graph.nodes.length).toBe(2)
      expect(d3Graph.links.length).toBe(2)
    })
  })
})
