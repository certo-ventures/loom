/**
 * Tests for Graph Data Model (TODO-017)
 */

import { describe, it, expect } from 'vitest'
import {
  NodeType,
  EdgeType,
  ValidationError,
  validateNode,
  validateEdge,
  serializeNode,
  deserializeNode,
  serializeEdge,
  deserializeEdge,
  createNode,
  createEdge,
  createGraph
} from '../../../services/loommesh/graph-model'
import type { Node, Edge } from '../../../services/loommesh/graph-model'

describe('Graph Data Model (TODO-017)', () => {
  describe('Node Creation and Validation', () => {
    it('should create a valid node', () => {
      const node = createNode('node-1', NodeType.AGENT, {
        name: 'Test Agent',
        status: 'active'
      })

      expect(node.id).toBe('node-1')
      expect(node.type).toBe(NodeType.AGENT)
      expect(node.properties.name).toBe('Test Agent')
      expect(node.metadata?.createdAt).toBeDefined()
      expect(node.metadata?.updatedAt).toBeDefined()
      expect(node.metadata?.version).toBe(1)
    })

    it('should validate a valid node', () => {
      const node: Node = {
        id: 'node-1',
        type: NodeType.CONCEPT,
        properties: { value: 'test' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      }

      expect(() => validateNode(node)).not.toThrow()
    })

    it('should reject node without id', () => {
      const invalidNode = {
        type: NodeType.AGENT,
        properties: {}
      }

      expect(() => validateNode(invalidNode)).toThrow(ValidationError)
      expect(() => validateNode(invalidNode)).toThrow('Node ID is required')
    })

    it('should reject node without type', () => {
      const invalidNode = {
        id: 'node-1',
        properties: {}
      }

      expect(() => validateNode(invalidNode)).toThrow(ValidationError)
      expect(() => validateNode(invalidNode)).toThrow('Node type is required')
    })

    it('should reject node without properties', () => {
      const invalidNode = {
        id: 'node-1',
        type: NodeType.AGENT
      }

      expect(() => validateNode(invalidNode)).toThrow(ValidationError)
      expect(() => validateNode(invalidNode)).toThrow('Node properties are required')
    })
  })

  describe('Edge Creation and Validation', () => {
    it('should create a valid edge', () => {
      const edge = createEdge(
        'edge-1',
        'node-1',
        'node-2',
        EdgeType.DEPENDS_ON,
        { strength: 0.8 },
        1.0
      )

      expect(edge.id).toBe('edge-1')
      expect(edge.from).toBe('node-1')
      expect(edge.to).toBe('node-2')
      expect(edge.type).toBe(EdgeType.DEPENDS_ON)
      expect(edge.properties?.strength).toBe(0.8)
      expect(edge.weight).toBe(1.0)
      expect(edge.directed).toBe(true)
      expect(edge.metadata?.createdAt).toBeDefined()
    })

    it('should validate a valid edge', () => {
      const edge: Edge = {
        id: 'edge-1',
        from: 'node-1',
        to: 'node-2',
        type: EdgeType.COLLABORATES_WITH,
        properties: {},
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      }

      expect(() => validateEdge(edge)).not.toThrow()
    })

    it('should reject edge without id', () => {
      const invalidEdge = {
        from: 'node-1',
        to: 'node-2',
        type: EdgeType.DEPENDS_ON
      }

      expect(() => validateEdge(invalidEdge)).toThrow(ValidationError)
      expect(() => validateEdge(invalidEdge)).toThrow('Edge ID is required')
    })

    it('should reject edge without source', () => {
      const invalidEdge = {
        id: 'edge-1',
        to: 'node-2',
        type: EdgeType.DEPENDS_ON
      }

      expect(() => validateEdge(invalidEdge)).toThrow(ValidationError)
      expect(() => validateEdge(invalidEdge)).toThrow('Edge source (from) is required')
    })

    it('should reject edge without target', () => {
      const invalidEdge = {
        id: 'edge-1',
        from: 'node-1',
        type: EdgeType.DEPENDS_ON
      }

      expect(() => validateEdge(invalidEdge)).toThrow(ValidationError)
      expect(() => validateEdge(invalidEdge)).toThrow('Edge target (to) is required')
    })

    it('should reject edge with invalid weight', () => {
      const invalidEdge = {
        id: 'edge-1',
        from: 'node-1',
        to: 'node-2',
        type: EdgeType.DEPENDS_ON,
        weight: 'invalid' as any
      }

      expect(() => validateEdge(invalidEdge)).toThrow(ValidationError)
      expect(() => validateEdge(invalidEdge)).toThrow('Edge weight must be a number')
    })
  })

  describe('Node Serialization', () => {
    it('should serialize and deserialize node', () => {
      const node = createNode('node-1', NodeType.TASK, {
        title: 'Complete task',
        priority: 'high',
        nested: { value: 42 }
      })

      const serialized = serializeNode(node)
      expect(typeof serialized).toBe('string')

      const deserialized = deserializeNode(serialized)
      expect(deserialized.id).toBe(node.id)
      expect(deserialized.type).toBe(node.type)
      expect(deserialized.properties.title).toBe('Complete task')
      expect(deserialized.properties.nested.value).toBe(42)
    })

    it('should handle nodes with metadata', () => {
      const node = createNode('node-1', NodeType.AGENT, { name: 'Agent' }, {
        labels: ['production', 'critical'],
        createdBy: 'system'
      })

      const serialized = serializeNode(node)
      const deserialized = deserializeNode(serialized)

      expect(deserialized.metadata?.labels).toEqual(['production', 'critical'])
      expect(deserialized.metadata?.createdBy).toBe('system')
    })
  })

  describe('Edge Serialization', () => {
    it('should serialize and deserialize edge', () => {
      const edge = createEdge(
        'edge-1',
        'node-1',
        'node-2',
        EdgeType.TRIGGERS,
        { condition: 'on_complete' },
        0.75
      )

      const serialized = serializeEdge(edge)
      expect(typeof serialized).toBe('string')

      const deserialized = deserializeEdge(serialized)
      expect(deserialized.id).toBe(edge.id)
      expect(deserialized.from).toBe(edge.from)
      expect(deserialized.to).toBe(edge.to)
      expect(deserialized.type).toBe(edge.type)
      expect(deserialized.weight).toBe(0.75)
      expect(deserialized.properties?.condition).toBe('on_complete')
    })

    it('should preserve directed property', () => {
      const edge = createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH)
      edge.directed = false

      const serialized = serializeEdge(edge)
      const deserialized = deserializeEdge(serialized)

      expect(deserialized.directed).toBe(false)
    })
  })

  describe('Graph Creation', () => {
    it('should create an empty graph', () => {
      const graph = createGraph('graph-1', 'Test Graph')

      expect(graph.id).toBe('graph-1')
      expect(graph.name).toBe('Test Graph')
      expect(graph.nodes.size).toBe(0)
      expect(graph.edges.size).toBe(0)
      expect(graph.metadata?.createdAt).toBeDefined()
      expect(graph.metadata?.updatedAt).toBeDefined()
    })

    it('should add nodes to graph', () => {
      const graph = createGraph('graph-1', 'Test Graph')
      
      const node1 = createNode('node-1', NodeType.AGENT, { name: 'Agent 1' })
      const node2 = createNode('node-2', NodeType.AGENT, { name: 'Agent 2' })

      graph.nodes.set(node1.id, node1)
      graph.nodes.set(node2.id, node2)

      expect(graph.nodes.size).toBe(2)
      expect(graph.nodes.get('node-1')).toBe(node1)
      expect(graph.nodes.get('node-2')).toBe(node2)
    })

    it('should add edges to graph', () => {
      const graph = createGraph('graph-1', 'Test Graph')
      
      const edge = createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH)
      graph.edges.set(edge.id, edge)

      expect(graph.edges.size).toBe(1)
      expect(graph.edges.get('edge-1')).toBe(edge)
    })
  })

  describe('Node and Edge Types', () => {
    it('should support all node types', () => {
      const types = [
        NodeType.AGENT,
        NodeType.ACTOR,
        NodeType.TASK,
        NodeType.GOAL,
        NodeType.CONCEPT,
        NodeType.FACT,
        NodeType.RULE,
        NodeType.PATTERN,
        NodeType.DOCUMENT,
        NodeType.MESSAGE,
        NodeType.EVENT,
        NodeType.STATE,
        NodeType.TEAM,
        NodeType.PROJECT,
        NodeType.WORKFLOW,
        NodeType.CUSTOM
      ]

      types.forEach(type => {
        const node = createNode(`node-${type}`, type, { test: true })
        expect(node.type).toBe(type)
      })
    })

    it('should support all edge types', () => {
      const types = [
        EdgeType.PARENT_OF,
        EdgeType.CHILD_OF,
        EdgeType.OWNS,
        EdgeType.BELONGS_TO,
        EdgeType.SENDS_TO,
        EdgeType.RECEIVES_FROM,
        EdgeType.COLLABORATES_WITH,
        EdgeType.DEPENDS_ON,
        EdgeType.REQUIRED_BY,
        EdgeType.BLOCKS,
        EdgeType.BLOCKED_BY,
        EdgeType.KNOWS_ABOUT,
        EdgeType.DERIVES_FROM,
        EdgeType.IMPLIES,
        EdgeType.CONTRADICTS,
        EdgeType.PRECEDES,
        EdgeType.FOLLOWS,
        EdgeType.TRIGGERED_BY,
        EdgeType.TRIGGERS,
        EdgeType.TRANSITIONS_TO,
        EdgeType.RESULTED_IN,
        EdgeType.CUSTOM
      ]

      types.forEach(type => {
        const edge = createEdge(`edge-${type}`, 'node-1', 'node-2', type)
        expect(edge.type).toBe(type)
      })
    })

    it('should support custom node types', () => {
      const node = createNode('node-1', 'my_custom_type', { custom: true })
      expect(node.type).toBe('my_custom_type')
    })

    it('should support custom edge types', () => {
      const edge = createEdge('edge-1', 'node-1', 'node-2', 'my_custom_relation')
      expect(edge.type).toBe('my_custom_relation')
    })
  })
})
