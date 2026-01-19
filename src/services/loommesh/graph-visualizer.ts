/**
 * Graph Visualization Exporter (TODO-021)
 * 
 * Exports graph data to D3.js JSON format for visualization.
 */

import { LoomDBStore } from './loomdb-store'
import type { Node, Edge, NodeType, EdgeType, NodeFilter, EdgeFilter } from './graph-model'

/**
 * D3.js node format
 */
export interface D3Node {
  /** Node ID */
  id: string
  /** Node label (display name) */
  label?: string
  /** Node type/group for styling */
  group?: string
  /** Additional node properties */
  [key: string]: any
}

/**
 * D3.js link (edge) format
 */
export interface D3Link {
  /** Source node ID */
  source: string
  /** Target node ID */
  target: string
  /** Link type/label */
  type?: string
  /** Link weight/strength */
  value?: number
  /** Additional link properties */
  [key: string]: any
}

/**
 * D3.js graph format
 */
export interface D3Graph {
  /** Array of nodes */
  nodes: D3Node[]
  /** Array of links (edges) */
  links: D3Link[]
}

/**
 * Options for graph export
 */
export interface ExportOptions {
  /** Filter for nodes to include */
  nodeFilter?: NodeFilter
  /** Filter for edges to include */
  edgeFilter?: EdgeFilter
  /** Include node properties in output */
  includeNodeProperties?: boolean
  /** Include edge properties in output */
  includeEdgeProperties?: boolean
  /** Include node metadata */
  includeNodeMetadata?: boolean
  /** Include edge metadata */
  includeEdgeMetadata?: boolean
  /** Custom node label function */
  nodeLabel?: (node: Node) => string
  /** Custom node group function */
  nodeGroup?: (node: Node) => string
  /** Custom link value function */
  linkValue?: (edge: Edge) => number
}

/**
 * Graph Visualization Exporter
 * 
 * Exports LoomDB graphs to D3.js JSON format for visualization.
 */
export class GraphVisualizer {
  constructor(private store: LoomDBStore) {}

  /**
   * Export entire graph to D3.js format
   */
  async exportToD3(options: ExportOptions = {}): Promise<D3Graph> {
    const {
      nodeFilter,
      edgeFilter,
      includeNodeProperties = false,
      includeEdgeProperties = false,
      includeNodeMetadata = false,
      includeEdgeMetadata = false,
      nodeLabel,
      nodeGroup,
      linkValue
    } = options

    // Query nodes
    const nodes = nodeFilter 
      ? await this.store.queryNodes(nodeFilter)
      : await this.getAllNodes()

    // Query edges
    const edges = edgeFilter
      ? await this.store.queryEdges(edgeFilter)
      : await this.getAllEdges()

    // Create node ID set for filtering edges
    const nodeIds = new Set(nodes.map(n => n.id))

    // Convert nodes to D3 format
    const d3Nodes: D3Node[] = nodes.map(node => {
      const d3Node: D3Node = {
        id: node.id,
        label: nodeLabel ? nodeLabel(node) : this.getDefaultLabel(node),
        group: nodeGroup ? nodeGroup(node) : node.type
      }

      // Include properties if requested
      if (includeNodeProperties) {
        d3Node.properties = node.properties
      }

      // Include metadata if requested
      if (includeNodeMetadata && node.metadata) {
        d3Node.metadata = node.metadata
      }

      return d3Node
    })

    // Convert edges to D3 format, filtering out edges with missing nodes
    const d3Links: D3Link[] = edges
      .filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to))
      .map(edge => {
        const d3Link: D3Link = {
          source: edge.from,
          target: edge.to,
          type: edge.type,
          value: linkValue ? linkValue(edge) : (edge.weight ?? 1)
        }

        // Include properties if requested
        if (includeEdgeProperties) {
          d3Link.properties = edge.properties
        }

        // Include metadata if requested
        if (includeEdgeMetadata && edge.metadata) {
          d3Link.metadata = edge.metadata
        }

        return d3Link
      })

    return {
      nodes: d3Nodes,
      links: d3Links
    }
  }

  /**
   * Export subgraph to D3.js format
   */
  async exportSubgraphToD3(
    centerNodeId: string,
    maxDepth: number = 2,
    options: ExportOptions = {}
  ): Promise<D3Graph> {
    // Get nodes within depth
    const nodeMap = new Map<string, Node>()
    const edgeMap = new Map<string, Edge>()
    const visited = new Set<string>()

    const bfs = async (nodeId: string, depth: number) => {
      if (depth > maxDepth || visited.has(nodeId)) {
        return
      }

      visited.add(nodeId)

      const node = await this.store.getNode(nodeId)
      if (!node) {
        return
      }

      nodeMap.set(nodeId, node)

      if (depth < maxDepth) {
        const outgoing = await this.store.getOutgoingEdges(nodeId)
        const incoming = await this.store.getIncomingEdges(nodeId)
        
        for (const edge of [...outgoing, ...incoming]) {
          edgeMap.set(edge.id, edge)
          const nextId = edge.from === nodeId ? edge.to : edge.from
          await bfs(nextId, depth + 1)
        }
      }
    }

    await bfs(centerNodeId, 0)

    const nodes = Array.from(nodeMap.values())
    const edges = Array.from(edgeMap.values())

    // Apply filters if provided
    const filteredNodes = options.nodeFilter
      ? nodes.filter(node => this.matchesNodeFilter(node, options.nodeFilter!))
      : nodes

    const filteredEdges = options.edgeFilter
      ? edges.filter(edge => this.matchesEdgeFilter(edge, options.edgeFilter!))
      : edges

    // Convert to D3 format using main export function
    const nodeIds = new Set(filteredNodes.map(n => n.id))
    
    return {
      nodes: filteredNodes.map(node => this.nodeToD3(node, options)),
      links: filteredEdges
        .filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to))
        .map(edge => this.edgeToD3(edge, options))
    }
  }

  /**
   * Convert node to D3 format
   */
  private nodeToD3(node: Node, options: ExportOptions): D3Node {
    const {
      includeNodeProperties = false,
      includeNodeMetadata = false,
      nodeLabel,
      nodeGroup
    } = options

    const d3Node: D3Node = {
      id: node.id,
      label: nodeLabel ? nodeLabel(node) : this.getDefaultLabel(node),
      group: nodeGroup ? nodeGroup(node) : node.type
    }

    if (includeNodeProperties) {
      d3Node.properties = node.properties
    }

    if (includeNodeMetadata && node.metadata) {
      d3Node.metadata = node.metadata
    }

    return d3Node
  }

  /**
   * Convert edge to D3 format
   */
  private edgeToD3(edge: Edge, options: ExportOptions): D3Link {
    const {
      includeEdgeProperties = false,
      includeEdgeMetadata = false,
      linkValue
    } = options

    const d3Link: D3Link = {
      source: edge.from,
      target: edge.to,
      type: edge.type,
      value: linkValue ? linkValue(edge) : (edge.weight ?? 1)
    }

    if (includeEdgeProperties) {
      d3Link.properties = edge.properties
    }

    if (includeEdgeMetadata && edge.metadata) {
      d3Link.metadata = edge.metadata
    }

    return d3Link
  }

  /**
   * Get default label for a node
   */
  private getDefaultLabel(node: Node): string {
    // Try common label properties
    if (node.properties.name) return node.properties.name
    if (node.properties.title) return node.properties.title
    if (node.properties.label) return node.properties.label
    // Fallback to ID
    return node.id
  }

  /**
   * Get all nodes from store
   */
  private async getAllNodes(): Promise<Node[]> {
    return await this.store.queryNodes({})
  }

  /**
   * Get all edges from store
   */
  private async getAllEdges(): Promise<Edge[]> {
    return await this.store.queryEdges({})
  }

  /**
   * Check if node matches filter
   */
  private matchesNodeFilter(node: Node, filter: NodeFilter): boolean {
    if (filter.type && node.type !== filter.type) {
      return false
    }

    if (filter.labels && node.metadata?.labels) {
      const hasLabel = filter.labels.some(label => 
        node.metadata!.labels!.includes(label)
      )
      if (!hasLabel) {
        return false
      }
    }

    if (filter.properties) {
      for (const [key, value] of Object.entries(filter.properties)) {
        if (node.properties[key] !== value) {
          return false
        }
      }
    }

    return true
  }

  /**
   * Check if edge matches filter
   */
  private matchesEdgeFilter(edge: Edge, filter: EdgeFilter): boolean {
    if (filter.type && edge.type !== filter.type) {
      return false
    }

    if (filter.from && edge.from !== filter.from) {
      return false
    }

    if (filter.to && edge.to !== filter.to) {
      return false
    }

    if (filter.minWeight !== undefined && (edge.weight ?? 1) < filter.minWeight) {
      return false
    }

    if (filter.maxWeight !== undefined && (edge.weight ?? 1) > filter.maxWeight) {
      return false
    }

    return true
  }

  /**
   * Export to formatted JSON string
   */
  async exportToJSON(options: ExportOptions = {}): Promise<string> {
    const graph = await this.exportToD3(options)
    return JSON.stringify(graph, null, 2)
  }

  /**
   * Export subgraph to formatted JSON string
   */
  async exportSubgraphToJSON(
    centerNodeId: string,
    maxDepth: number = 2,
    options: ExportOptions = {}
  ): Promise<string> {
    const graph = await this.exportSubgraphToD3(centerNodeId, maxDepth, options)
    return JSON.stringify(graph, null, 2)
  }
}
