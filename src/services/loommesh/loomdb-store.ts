/**
 * LoomDB Storage Layer (TODO-018)
 * 
 * Graph database storage built on LoomMesh/GUN with:
 * - Node and edge storage
 * - Outgoing/incoming edge indexes
 * - Type-based indexes
 * - Efficient graph traversal
 */

import type { LoomMeshService } from './loommesh-service'
import type {
  Node,
  Edge,
  NodeFilter,
  EdgeFilter
} from './graph-model'
import {
  validateNode,
  validateEdge,
  serializeNode,
  deserializeNode,
  serializeEdge,
  deserializeEdge
} from './graph-model'

/**
 * LoomDB Store - Graph database on LoomMesh
 */
export class LoomDBStore {
  private gun: any

  constructor(private service: LoomMeshService) {
    this.gun = service.getGun()
  }

  /**
   * Store a node in the graph
   */
  async putNode(node: Node): Promise<Node> {
    // Validate node
    validateNode(node)

    // Update timestamp
    if (node.metadata) {
      node.metadata.updatedAt = Date.now()
    }

    // Serialize and store
    const serialized = serializeNode(node)
    
    return new Promise((resolve, reject) => {
      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          reject(new Error(`Timeout storing node ${node.id}`))
        }
      }, 3000)

      this.gun.get('loomdb:nodes').get(node.id).put(serialized, (ack: any) => {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)

        if (ack.err) {
          reject(new Error(`Failed to store node: ${ack.err}`))
        } else {
          // Update indexes
          this.updateNodeIndexes(node).then(() => {
            resolve(node)
          }).catch(reject)
        }
      })
    })
  }

  /**
   * Retrieve a node by ID
   */
  async getNode(id: string): Promise<Node | null> {
    return new Promise((resolve, reject) => {
      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          resolve(null) // Not found
        }
      }, 3000)

      this.gun.get('loomdb:nodes').get(id).once((data: any) => {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)

        if (!data || data === null) {
          resolve(null)
          return
        }

        try {
          const node = deserializeNode(data)
          resolve(node)
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  /**
   * Delete a node (and its edges)
   */
  async deleteNode(id: string): Promise<boolean> {
    // Get node to check existence
    const node = await this.getNode(id)
    if (!node) return false

    // Delete node
    await new Promise<void>((resolve) => {
      this.gun.get('loomdb:nodes').get(id).put(null)
      setTimeout(resolve, 100)
    })

    // Remove from indexes
    await this.removeNodeFromIndexes(node)

    // Delete associated edges
    const outgoing = await this.getOutgoingEdges(id)
    const incoming = await this.getIncomingEdges(id)
    
    for (const edge of [...outgoing, ...incoming]) {
      await this.deleteEdge(edge.id)
    }

    return true
  }

  /**
   * Store an edge in the graph
   */
  async putEdge(edge: Edge): Promise<Edge> {
    // Validate edge
    validateEdge(edge)

    // Update timestamp
    if (edge.metadata) {
      edge.metadata.updatedAt = Date.now()
    }

    // Serialize and store
    const serialized = serializeEdge(edge)
    
    return new Promise((resolve, reject) => {
      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          reject(new Error(`Timeout storing edge ${edge.id}`))
        }
      }, 3000)

      this.gun.get('loomdb:edges').get(edge.id).put(serialized, (ack: any) => {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)

        if (ack.err) {
          reject(new Error(`Failed to store edge: ${ack.err}`))
        } else {
          // Update indexes
          this.updateEdgeIndexes(edge).then(() => {
            resolve(edge)
          }).catch(reject)
        }
      })
    })
  }

  /**
   * Retrieve an edge by ID
   */
  async getEdge(id: string): Promise<Edge | null> {
    return new Promise((resolve, reject) => {
      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          resolve(null)
        }
      }, 3000)

      this.gun.get('loomdb:edges').get(id).once((data: any) => {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)

        if (!data || data === null) {
          resolve(null)
          return
        }

        try {
          const edge = deserializeEdge(data)
          resolve(edge)
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  /**
   * Delete an edge
   */
  async deleteEdge(id: string): Promise<boolean> {
    const edge = await this.getEdge(id)
    if (!edge) return false

    // Delete edge
    await new Promise<void>((resolve) => {
      this.gun.get('loomdb:edges').get(id).put(null)
      setTimeout(resolve, 100)
    })

    // Remove from indexes
    await this.removeEdgeFromIndexes(edge)

    return true
  }

  /**
   * Get outgoing edges from a node
   */
  async getOutgoingEdges(nodeId: string, type?: string): Promise<Edge[]> {
    const indexKey = type 
      ? `loomdb:index:edges:outgoing:${nodeId}:${type}`
      : `loomdb:index:edges:outgoing:${nodeId}`

    const edgeIds = await this.getIndexValues(indexKey)
    
    const edges: Edge[] = []
    for (const edgeId of edgeIds) {
      const edge = await this.getEdge(edgeId)
      if (edge) edges.push(edge)
    }
    
    return edges
  }

  /**
   * Get incoming edges to a node
   */
  async getIncomingEdges(nodeId: string, type?: string): Promise<Edge[]> {
    const indexKey = type
      ? `loomdb:index:edges:incoming:${nodeId}:${type}`
      : `loomdb:index:edges:incoming:${nodeId}`

    const edgeIds = await this.getIndexValues(indexKey)
    
    const edges: Edge[] = []
    for (const edgeId of edgeIds) {
      const edge = await this.getEdge(edgeId)
      if (edge) edges.push(edge)
    }
    
    return edges
  }

  /**
   * Query nodes by filter
   */
  async queryNodes(filter: NodeFilter = {}): Promise<Node[]> {
    let nodes: Node[] = []

    if (filter.type) {
      // Use type index
      const nodeIds = await this.getIndexValues(`loomdb:index:nodes:type:${filter.type}`)
      nodes = (await Promise.all(nodeIds.map(id => this.getNode(id)))).filter(n => n !== null) as Node[]
    } else {
      // Scan all nodes
      const allIds = await this.getAllNodeIds()
      nodes = (await Promise.all(allIds.map(id => this.getNode(id)))).filter(n => n !== null) as Node[]
    }

    // Apply filters
    if (filter.labels && filter.labels.length > 0) {
      nodes = nodes.filter(n => 
        filter.labels!.some(label => n.metadata?.labels?.includes(label))
      )
    }

    if (filter.properties) {
      nodes = nodes.filter(n => {
        for (const [key, value] of Object.entries(filter.properties!)) {
          if (n.properties[key] !== value) return false
        }
        return true
      })
    }

    if (filter.createdAfter) {
      nodes = nodes.filter(n => (n.metadata?.createdAt || 0) >= filter.createdAfter!)
    }

    if (filter.createdBefore) {
      nodes = nodes.filter(n => (n.metadata?.createdAt || 0) <= filter.createdBefore!)
    }

    // Pagination
    const offset = filter.offset || 0
    const limit = filter.limit || nodes.length
    return nodes.slice(offset, offset + limit)
  }

  /**
   * Query edges by filter
   */
  async queryEdges(filter: EdgeFilter = {}): Promise<Edge[]> {
    let edges: Edge[] = []

    if (filter.from) {
      // Use outgoing index
      edges = await this.getOutgoingEdges(filter.from, filter.type)
    } else if (filter.to) {
      // Use incoming index
      edges = await this.getIncomingEdges(filter.to, filter.type)
    } else if (filter.type) {
      // Use type index
      const edgeIds = await this.getIndexValues(`loomdb:index:edges:type:${filter.type}`)
      edges = (await Promise.all(edgeIds.map(id => this.getEdge(id)))).filter(e => e !== null) as Edge[]
    } else {
      // Scan all edges
      const allIds = await this.getAllEdgeIds()
      edges = (await Promise.all(allIds.map(id => this.getEdge(id)))).filter(e => e !== null) as Edge[]
    }

    // Apply filters
    if (filter.minWeight !== undefined) {
      edges = edges.filter(e => (e.weight || 0) >= filter.minWeight!)
    }

    if (filter.maxWeight !== undefined) {
      edges = edges.filter(e => (e.weight || 0) <= filter.maxWeight!)
    }

    if (filter.labels && filter.labels.length > 0) {
      edges = edges.filter(e =>
        filter.labels!.some(label => e.metadata?.labels?.includes(label))
      )
    }

    // Pagination
    const offset = filter.offset || 0
    const limit = filter.limit || edges.length
    return edges.slice(offset, offset + limit)
  }

  /**
   * Update node indexes
   */
  private async updateNodeIndexes(node: Node): Promise<void> {
    // Type index
    await this.addToIndex(`loomdb:index:nodes:type:${node.type}`, node.id)

    // Label indexes
    if (node.metadata?.labels) {
      for (const label of node.metadata.labels) {
        await this.addToIndex(`loomdb:index:nodes:label:${label}`, node.id)
      }
    }
  }

  /**
   * Remove node from indexes
   */
  private async removeNodeFromIndexes(node: Node): Promise<void> {
    await this.removeFromIndex(`loomdb:index:nodes:type:${node.type}`, node.id)
    
    if (node.metadata?.labels) {
      for (const label of node.metadata.labels) {
        await this.removeFromIndex(`loomdb:index:nodes:label:${label}`, node.id)
      }
    }
  }

  /**
   * Update edge indexes
   */
  private async updateEdgeIndexes(edge: Edge): Promise<void> {
    // Outgoing edges index (from -> edge)
    await this.addToIndex(`loomdb:index:edges:outgoing:${edge.from}`, edge.id)
    await this.addToIndex(`loomdb:index:edges:outgoing:${edge.from}:${edge.type}`, edge.id)

    // Incoming edges index (to -> edge)
    await this.addToIndex(`loomdb:index:edges:incoming:${edge.to}`, edge.id)
    await this.addToIndex(`loomdb:index:edges:incoming:${edge.to}:${edge.type}`, edge.id)

    // Type index
    await this.addToIndex(`loomdb:index:edges:type:${edge.type}`, edge.id)
  }

  /**
   * Remove edge from indexes
   */
  private async removeEdgeFromIndexes(edge: Edge): Promise<void> {
    await this.removeFromIndex(`loomdb:index:edges:outgoing:${edge.from}`, edge.id)
    await this.removeFromIndex(`loomdb:index:edges:outgoing:${edge.from}:${edge.type}`, edge.id)
    await this.removeFromIndex(`loomdb:index:edges:incoming:${edge.to}`, edge.id)
    await this.removeFromIndex(`loomdb:index:edges:incoming:${edge.to}:${edge.type}`, edge.id)
    await this.removeFromIndex(`loomdb:index:edges:type:${edge.type}`, edge.id)
  }

  /**
   * Add value to index
   */
  private async addToIndex(indexKey: string, value: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.gun.get(indexKey).get(value).put(true)
      setTimeout(resolve, 50)
    })
  }

  /**
   * Remove value from index
   */
  private async removeFromIndex(indexKey: string, value: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.gun.get(indexKey).get(value).put(null)
      setTimeout(resolve, 50)
    })
  }

  /**
   * Get all values from an index
   */
  private async getIndexValues(indexKey: string): Promise<string[]> {
    return new Promise((resolve) => {
      const values: string[] = []
      
      this.gun.get(indexKey).map().once((exists: any, id: string) => {
        if (exists && id !== '_') {
          values.push(id)
        }
      })
      
      setTimeout(() => resolve(values), 300)
    })
  }

  /**
   * Get all node IDs
   */
  private async getAllNodeIds(): Promise<string[]> {
    return new Promise((resolve) => {
      const ids: string[] = []
      
      this.gun.get('loomdb:nodes').map().once((data: any, id: string) => {
        if (data && id !== '_') {
          ids.push(id)
        }
      })
      
      setTimeout(() => resolve(ids), 300)
    })
  }

  /**
   * Get all edge IDs
   */
  private async getAllEdgeIds(): Promise<string[]> {
    return new Promise((resolve) => {
      const ids: string[] = []
      
      this.gun.get('loomdb:edges').map().once((data: any, id: string) => {
        if (data && id !== '_') {
          ids.push(id)
        }
      })
      
      setTimeout(() => resolve(ids), 300)
    })
  }

  /**
   * Clear all graph data (for testing)
   */
  async clear(): Promise<void> {
    const nodeIds = await this.getAllNodeIds()
    const edgeIds = await this.getAllEdgeIds()

    await Promise.all([
      ...nodeIds.map(id => this.deleteNode(id)),
      ...edgeIds.map(id => this.deleteEdge(id))
    ])
  }
}
