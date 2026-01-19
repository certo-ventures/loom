/**
 * LoomDB Graph Data Model (TODO-017)
 * 
 * Type-safe graph data structures for agent knowledge graphs
 */

/**
 * Node types for agent system
 */
export enum NodeType {
  // Agent entities
  AGENT = 'agent',
  ACTOR = 'actor',
  TASK = 'task',
  GOAL = 'goal',
  
  // Knowledge entities
  CONCEPT = 'concept',
  FACT = 'fact',
  RULE = 'rule',
  PATTERN = 'pattern',
  
  // Data entities
  DOCUMENT = 'document',
  MESSAGE = 'message',
  EVENT = 'event',
  STATE = 'state',
  
  // Organizational
  TEAM = 'team',
  PROJECT = 'project',
  WORKFLOW = 'workflow',
  
  // Custom
  CUSTOM = 'custom'
}

/**
 * Edge types for agent relationships
 */
export enum EdgeType {
  // Hierarchical
  PARENT_OF = 'parent_of',
  CHILD_OF = 'child_of',
  OWNS = 'owns',
  BELONGS_TO = 'belongs_to',
  
  // Communication
  SENDS_TO = 'sends_to',
  RECEIVES_FROM = 'receives_from',
  COLLABORATES_WITH = 'collaborates_with',
  
  // Dependencies
  DEPENDS_ON = 'depends_on',
  REQUIRED_BY = 'required_by',
  BLOCKS = 'blocks',
  BLOCKED_BY = 'blocked_by',
  
  // Knowledge
  KNOWS_ABOUT = 'knows_about',
  DERIVES_FROM = 'derives_from',
  IMPLIES = 'implies',
  CONTRADICTS = 'contradicts',
  
  // Temporal
  PRECEDES = 'precedes',
  FOLLOWS = 'follows',
  TRIGGERED_BY = 'triggered_by',
  TRIGGERS = 'triggers',
  
  // State
  TRANSITIONS_TO = 'transitions_to',
  RESULTED_IN = 'resulted_in',
  
  // Custom
  CUSTOM = 'custom'
}

/**
 * Graph node
 */
export interface Node {
  /**
   * Unique node identifier
   */
  id: string
  
  /**
   * Node type
   */
  type: NodeType | string
  
  /**
   * Node properties (arbitrary JSON data)
   */
  properties: Record<string, any>
  
  /**
   * Node metadata
   */
  metadata?: {
    /**
     * Creation timestamp
     */
    createdAt: number
    
    /**
     * Last modification timestamp
     */
    updatedAt: number
    
    /**
     * Creator identifier
     */
    createdBy?: string
    
    /**
     * Labels/tags for categorization
     */
    labels?: string[]
    
    /**
     * Version number
     */
    version?: number
    
    /**
     * Additional metadata
     */
    [key: string]: any
  }
}

/**
 * Graph edge (relationship)
 */
export interface Edge {
  /**
   * Unique edge identifier
   */
  id: string
  
  /**
   * Source node ID
   */
  from: string
  
  /**
   * Target node ID
   */
  to: string
  
  /**
   * Edge type
   */
  type: EdgeType | string
  
  /**
   * Edge properties (arbitrary JSON data)
   */
  properties?: Record<string, any>
  
  /**
   * Edge weight (for weighted graphs)
   */
  weight?: number
  
  /**
   * Edge direction (true = directed, false = undirected)
   */
  directed?: boolean
  
  /**
   * Edge metadata
   */
  metadata?: {
    /**
     * Creation timestamp
     */
    createdAt: number
    
    /**
     * Last modification timestamp
     */
    updatedAt: number
    
    /**
     * Creator identifier
     */
    createdBy?: string
    
    /**
     * Labels/tags
     */
    labels?: string[]
    
    /**
     * Additional metadata
     */
    [key: string]: any
  }
}

/**
 * Graph structure
 */
export interface Graph {
  /**
   * Graph identifier
   */
  id: string
  
  /**
   * Graph name
   */
  name: string
  
  /**
   * All nodes in the graph
   */
  nodes: Map<string, Node>
  
  /**
   * All edges in the graph
   */
  edges: Map<string, Edge>
  
  /**
   * Graph metadata
   */
  metadata?: {
    /**
     * Creation timestamp
     */
    createdAt: number
    
    /**
     * Last modification timestamp
     */
    updatedAt: number
    
    /**
     * Graph description
     */
    description?: string
    
    /**
     * Graph properties
     */
    properties?: Record<string, any>
  }
}

/**
 * Query filter for nodes
 */
export interface NodeFilter {
  /**
   * Filter by node type
   */
  type?: NodeType | string
  
  /**
   * Filter by labels
   */
  labels?: string[]
  
  /**
   * Filter by property values
   */
  properties?: Record<string, any>
  
  /**
   * Filter by creation time range
   */
  createdAfter?: number
  createdBefore?: number
  
  /**
   * Limit results
   */
  limit?: number
  
  /**
   * Offset for pagination
   */
  offset?: number
}

/**
 * Query filter for edges
 */
export interface EdgeFilter {
  /**
   * Filter by edge type
   */
  type?: EdgeType | string
  
  /**
   * Filter by source node
   */
  from?: string
  
  /**
   * Filter by target node
   */
  to?: string
  
  /**
   * Filter by labels
   */
  labels?: string[]
  
  /**
   * Filter by weight range
   */
  minWeight?: number
  maxWeight?: number
  
  /**
   * Limit results
   */
  limit?: number
  
  /**
   * Offset for pagination
   */
  offset?: number
}

/**
 * Validation error
 */
export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Validate node data
 */
export function validateNode(node: Partial<Node>): node is Node {
  if (!node.id || typeof node.id !== 'string') {
    throw new ValidationError('Node ID is required and must be a string', 'id')
  }
  
  if (!node.type || typeof node.type !== 'string') {
    throw new ValidationError('Node type is required and must be a string', 'type')
  }
  
  if (!node.properties || typeof node.properties !== 'object') {
    throw new ValidationError('Node properties are required and must be an object', 'properties')
  }
  
  return true
}

/**
 * Validate edge data
 */
export function validateEdge(edge: Partial<Edge>): edge is Edge {
  if (!edge.id || typeof edge.id !== 'string') {
    throw new ValidationError('Edge ID is required and must be a string', 'id')
  }
  
  if (!edge.from || typeof edge.from !== 'string') {
    throw new ValidationError('Edge source (from) is required and must be a string', 'from')
  }
  
  if (!edge.to || typeof edge.to !== 'string') {
    throw new ValidationError('Edge target (to) is required and must be a string', 'to')
  }
  
  if (!edge.type || typeof edge.type !== 'string') {
    throw new ValidationError('Edge type is required and must be a string', 'type')
  }
  
  if (edge.weight !== undefined && typeof edge.weight !== 'number') {
    throw new ValidationError('Edge weight must be a number', 'weight')
  }
  
  return true
}

/**
 * Serialize node to JSON-safe format
 */
export function serializeNode(node: Node): string {
  return JSON.stringify({
    id: node.id,
    type: node.type,
    properties: node.properties,
    metadata: node.metadata || {}
  })
}

/**
 * Deserialize node from JSON string
 */
export function deserializeNode(json: string): Node {
  const data = JSON.parse(json)
  validateNode(data)
  return data as Node
}

/**
 * Serialize edge to JSON-safe format
 */
export function serializeEdge(edge: Edge): string {
  return JSON.stringify({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type: edge.type,
    properties: edge.properties || {},
    weight: edge.weight,
    directed: edge.directed ?? true,
    metadata: edge.metadata || {}
  })
}

/**
 * Deserialize edge from JSON string
 */
export function deserializeEdge(json: string): Edge {
  const data = JSON.parse(json)
  validateEdge(data)
  return data as Edge
}

/**
 * Create a new node with defaults
 */
export function createNode(
  id: string,
  type: NodeType | string,
  properties: Record<string, any> = {},
  metadata?: Partial<Node['metadata']>
): Node {
  const now = Date.now()
  
  return {
    id,
    type,
    properties,
    metadata: {
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...metadata
    }
  }
}

/**
 * Create a new edge with defaults
 */
export function createEdge(
  id: string,
  from: string,
  to: string,
  type: EdgeType | string,
  properties?: Record<string, any>,
  weight?: number,
  metadata?: Partial<Edge['metadata']>
): Edge {
  const now = Date.now()
  
  return {
    id,
    from,
    to,
    type,
    properties: properties || {},
    weight,
    directed: true,
    metadata: {
      createdAt: now,
      updatedAt: now,
      ...metadata
    }
  }
}

/**
 * Create an empty graph
 */
export function createGraph(id: string, name: string): Graph {
  return {
    id,
    name,
    nodes: new Map(),
    edges: new Map(),
    metadata: {
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }
}
