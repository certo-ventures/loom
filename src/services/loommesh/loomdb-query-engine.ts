/**
 * LoomDB Query Engine (TODO-019)
 * 
 * Advanced graph query capabilities including:
 * - Path finding between nodes
 * - Shortest path algorithms
 * - Graph traversal (DFS, BFS)
 * - Subgraph extraction
 * - Neighbor queries
 * - Connected component analysis
 */

import { LoomDBStore } from './loomdb-store'
import type { Node, Edge, NodeType, EdgeType } from './graph-model'

/**
 * Options for path finding
 */
export interface PathFindingOptions {
  /** Maximum depth to search (prevents infinite loops) */
  maxDepth?: number
  /** Maximum number of paths to find */
  maxPaths?: number
  /** Edge types to follow (if not specified, follows all edges) */
  edgeTypes?: EdgeType[]
  /** Whether to consider edge direction */
  directed?: boolean
}

/**
 * Options for graph traversal
 */
export interface TraversalOptions {
  /** Maximum depth to traverse */
  maxDepth?: number
  /** Edge types to follow */
  edgeTypes?: EdgeType[]
  /** Whether to follow edge direction */
  directed?: boolean
}

/**
 * Options for subgraph extraction
 */
export interface SubgraphOptions {
  /** Maximum depth from starting node */
  maxDepth?: number
  /** Node types to include */
  nodeTypes?: NodeType[]
  /** Edge types to include */
  edgeTypes?: EdgeType[]
  /** Whether to follow edge direction */
  directed?: boolean
}

/**
 * Options for neighbor queries
 */
export interface NeighborOptions {
  /** Edge types to follow */
  edgeTypes?: EdgeType[]
  /** Whether to follow edge direction */
  directed?: boolean
}

/**
 * Represents a path through the graph
 */
export interface Path {
  /** Nodes in the path, in order */
  nodes: Node[]
  /** Edges in the path, in order */
  edges: Edge[]
  /** Total weight of the path */
  weight: number
  /** Length of the path (number of edges) */
  length: number
}

/**
 * Result of subgraph extraction
 */
export interface Subgraph {
  /** Nodes in the subgraph */
  nodes: Node[]
  /** Edges in the subgraph */
  edges: Edge[]
  /** Center node ID */
  centerId: string
  /** Maximum depth included */
  maxDepth: number
}

/**
 * Advanced query engine for LoomDB
 */
export class LoomDBQueryEngine {
  constructor(private store: LoomDBStore) {}

  /**
   * Find all paths between two nodes
   */
  async findPaths(
    fromId: string,
    toId: string,
    options: PathFindingOptions = {}
  ): Promise<Path[]> {
    const {
      maxDepth = 10,
      maxPaths = 100,
      edgeTypes,
      directed = true
    } = options

    const paths: Path[] = []
    const visited = new Set<string>()

    const dfs = async (
      currentId: string,
      currentPath: Node[],
      currentEdges: Edge[],
      currentWeight: number,
      depth: number
    ) => {
      // Check termination conditions
      if (paths.length >= maxPaths || depth > maxDepth) {
        return
      }

      // Found target
      if (currentId === toId && currentPath.length > 1) {
        paths.push({
          nodes: [...currentPath],
          edges: [...currentEdges],
          weight: currentWeight,
          length: currentEdges.length
        })
        return
      }

      // Mark as visited for this path
      visited.add(currentId)

      // Get outgoing edges
      const outgoing = await this.store.getOutgoingEdges(currentId)
      
      // Get incoming edges if not directed
      const incoming = directed ? [] : await this.store.getIncomingEdges(currentId)
      
      const allEdges = [...outgoing, ...incoming]

      // Filter by edge types if specified
      const relevantEdges = edgeTypes
        ? allEdges.filter(e => edgeTypes.includes(e.type as EdgeType))
        : allEdges

      for (const edge of relevantEdges) {
        const nextId = edge.from === currentId ? edge.to : edge.from
        
        // Skip if already visited in this path
        if (visited.has(nextId)) {
          continue
        }

        const nextNode = await this.store.getNode(nextId)
        if (!nextNode) {
          continue
        }

        // Recurse
        await dfs(
          nextId,
          [...currentPath, nextNode],
          [...currentEdges, edge],
          currentWeight + (edge.weight || 1),
          depth + 1
        )
      }

      // Unmark for other paths
      visited.delete(currentId)
    }

    const startNode = await this.store.getNode(fromId)
    if (!startNode) {
      return []
    }

    await dfs(fromId, [startNode], [], 0, 0)
    return paths
  }

  /**
   * Find shortest path between two nodes using BFS
   */
  async findShortestPath(
    fromId: string,
    toId: string,
    options: PathFindingOptions = {}
  ): Promise<Path | null> {
    const { maxDepth = 10, edgeTypes, directed = true } = options

    const queue: Array<{
      nodeId: string
      path: Node[]
      edges: Edge[]
      weight: number
      depth: number
    }> = []

    const visited = new Set<string>()

    const startNode = await this.store.getNode(fromId)
    if (!startNode) {
      return null
    }

    queue.push({
      nodeId: fromId,
      path: [startNode],
      edges: [],
      weight: 0,
      depth: 0
    })
    visited.add(fromId)

    while (queue.length > 0) {
      const current = queue.shift()!

      // Found target
      if (current.nodeId === toId && current.path.length > 1) {
        return {
          nodes: current.path,
          edges: current.edges,
          weight: current.weight,
          length: current.edges.length
        }
      }

      // Check depth limit
      if (current.depth >= maxDepth) {
        continue
      }

      // Get edges
      const outgoing = await this.store.getOutgoingEdges(current.nodeId)
      const incoming = directed ? [] : await this.store.getIncomingEdges(current.nodeId)
      const allEdges = [...outgoing, ...incoming]

      // Filter by edge types
      const relevantEdges = edgeTypes
        ? allEdges.filter(e => edgeTypes.includes(e.type as EdgeType))
        : allEdges

      for (const edge of relevantEdges) {
        const nextId = edge.from === current.nodeId ? edge.to : edge.from

        if (visited.has(nextId)) {
          continue
        }

        const nextNode = await this.store.getNode(nextId)
        if (!nextNode) {
          continue
        }

        visited.add(nextId)
        queue.push({
          nodeId: nextId,
          path: [...current.path, nextNode],
          edges: [...current.edges, edge],
          weight: current.weight + (edge.weight || 1),
          depth: current.depth + 1
        })
      }
    }

    return null
  }

  /**
   * Depth-first traversal
   * Returns true from visitor to stop traversal
   */
  async traverseDFS(
    startId: string,
    visitor: (node: Node, depth: number) => boolean | void,
    options: TraversalOptions = {}
  ): Promise<void> {
    const { maxDepth = 10, edgeTypes, directed = true } = options
    const visited = new Set<string>()

    const dfs = async (nodeId: string, depth: number) => {
      if (depth > maxDepth || visited.has(nodeId)) {
        return
      }

      const node = await this.store.getNode(nodeId)
      if (!node) {
        return
      }

      visited.add(nodeId)

      // Visit node
      const stop = visitor(node, depth)
      if (stop === true) {
        return
      }

      // Get edges
      const outgoing = await this.store.getOutgoingEdges(nodeId)
      const incoming = directed ? [] : await this.store.getIncomingEdges(nodeId)
      const allEdges = [...outgoing, ...incoming]

      // Filter by edge types
      const relevantEdges = edgeTypes
        ? allEdges.filter(e => edgeTypes.includes(e.type as EdgeType))
        : allEdges

      for (const edge of relevantEdges) {
        const nextId = edge.from === nodeId ? edge.to : edge.from
        await dfs(nextId, depth + 1)
      }
    }

    await dfs(startId, 0)
  }

  /**
   * Breadth-first traversal
   * Returns true from visitor to stop traversal
   */
  async traverseBFS(
    startId: string,
    visitor: (node: Node, depth: number) => boolean | void,
    options: TraversalOptions = {}
  ): Promise<void> {
    const { maxDepth = 10, edgeTypes, directed = true } = options
    const visited = new Set<string>()
    const queue: Array<{ nodeId: string; depth: number }> = []

    const startNode = await this.store.getNode(startId)
    if (!startNode) {
      return
    }

    queue.push({ nodeId: startId, depth: 0 })
    visited.add(startId)

    while (queue.length > 0) {
      const current = queue.shift()!

      const node = await this.store.getNode(current.nodeId)
      if (!node) {
        continue
      }

      // Visit node
      const stop = visitor(node, current.depth)
      if (stop === true) {
        return
      }

      // Check depth limit
      if (current.depth >= maxDepth) {
        continue
      }

      // Get edges
      const outgoing = await this.store.getOutgoingEdges(current.nodeId)
      const incoming = directed ? [] : await this.store.getIncomingEdges(current.nodeId)
      const allEdges = [...outgoing, ...incoming]

      // Filter by edge types
      const relevantEdges = edgeTypes
        ? allEdges.filter(e => edgeTypes.includes(e.type as EdgeType))
        : allEdges

      for (const edge of relevantEdges) {
        const nextId = edge.from === current.nodeId ? edge.to : edge.from

        if (visited.has(nextId)) {
          continue
        }

        visited.add(nextId)
        queue.push({ nodeId: nextId, depth: current.depth + 1 })
      }
    }
  }

  /**
   * Get all neighbors at specified depth
   * Depth 1 = direct neighbors, 2 = neighbors of neighbors, etc.
   */
  async getNeighbors(
    nodeId: string,
    depth: number = 1,
    options: NeighborOptions = {}
  ): Promise<Node[]> {
    const { edgeTypes, directed = true } = options
    const neighbors = new Map<string, Node>()
    const visited = new Set<string>([nodeId])

    const bfs = async (currentId: string, currentDepth: number) => {
      if (currentDepth > depth) {
        return
      }

      // Get edges
      const outgoing = await this.store.getOutgoingEdges(currentId)
      const incoming = directed ? [] : await this.store.getIncomingEdges(currentId)
      const allEdges = [...outgoing, ...incoming]

      // Filter by edge types
      const relevantEdges = edgeTypes
        ? allEdges.filter(e => edgeTypes.includes(e.type as EdgeType))
        : allEdges

      for (const edge of relevantEdges) {
        const nextId = edge.from === currentId ? edge.to : edge.from

        if (visited.has(nextId)) {
          continue
        }

        visited.add(nextId)

        const nextNode = await this.store.getNode(nextId)
        if (nextNode) {
          // Add to neighbors if at target depth
          if (currentDepth === depth) {
            neighbors.set(nextId, nextNode)
          }
          
          // Continue if not at target depth yet
          if (currentDepth < depth) {
            await bfs(nextId, currentDepth + 1)
          }
        }
      }
    }

    await bfs(nodeId, 1)
    return Array.from(neighbors.values())
  }

  /**
   * Extract a subgraph centered on a node
   */
  async extractSubgraph(
    centerId: string,
    options: SubgraphOptions = {}
  ): Promise<Subgraph | null> {
    const {
      maxDepth = 2,
      nodeTypes,
      edgeTypes,
      directed = true
    } = options

    const centerNode = await this.store.getNode(centerId)
    if (!centerNode) {
      return null
    }

    const nodes = new Map<string, Node>()
    const edges = new Map<string, Edge>()
    const visited = new Set<string>()

    nodes.set(centerId, centerNode)

    const bfs = async (nodeId: string, depth: number) => {
      if (visited.has(nodeId)) {
        return
      }

      visited.add(nodeId)

      // Don't explore beyond maxDepth
      if (depth >= maxDepth) {
        return
      }

      // Get edges
      const outgoing = await this.store.getOutgoingEdges(nodeId)
      const incoming = directed ? [] : await this.store.getIncomingEdges(nodeId)
      const allEdges = [...outgoing, ...incoming]

      // Filter by edge types
      const relevantEdges = edgeTypes
        ? allEdges.filter(e => edgeTypes.includes(e.type as EdgeType))
        : allEdges

      for (const edge of relevantEdges) {
        const nextId = edge.from === nodeId ? edge.to : edge.from
        const nextNode = await this.store.getNode(nextId)

        if (!nextNode) {
          continue
        }

        // Filter by node types
        if (nodeTypes && !nodeTypes.includes(nextNode.type as NodeType)) {
          continue
        }

        // Add node and edge
        nodes.set(nextId, nextNode)
        edges.set(edge.id, edge)

        // Recurse
        await bfs(nextId, depth + 1)
      }
    }

    await bfs(centerId, 0)

    return {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
      centerId,
      maxDepth
    }
  }

  /**
   * Find all nodes in the connected component containing the given node
   */
  async findConnectedComponent(
    nodeId: string,
    options: { edgeTypes?: EdgeType[] } = {}
  ): Promise<Node[]> {
    const { edgeTypes } = options
    const component = new Map<string, Node>()
    const visited = new Set<string>()

    const startNode = await this.store.getNode(nodeId)
    if (!startNode) {
      return []
    }

    const dfs = async (currentId: string) => {
      if (visited.has(currentId)) {
        return
      }

      visited.add(currentId)

      const node = await this.store.getNode(currentId)
      if (!node) {
        return
      }

      component.set(currentId, node)

      // Get all edges (treat as undirected)
      const outgoing = await this.store.getOutgoingEdges(currentId)
      const incoming = await this.store.getIncomingEdges(currentId)
      const allEdges = [...outgoing, ...incoming]

      // Filter by edge types
      const relevantEdges = edgeTypes
        ? allEdges.filter(e => edgeTypes.includes(e.type as EdgeType))
        : allEdges

      for (const edge of relevantEdges) {
        const nextId = edge.from === currentId ? edge.to : edge.from
        await dfs(nextId)
      }
    }

    await dfs(nodeId)
    return Array.from(component.values())
  }
}
