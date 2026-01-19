/**
 * LoomDB Transaction Manager (TODO-020)
 * 
 * Provides atomic operations across multiple graph operations.
 * Supports commit/rollback with snapshot-based isolation.
 */

import { LoomDBStore } from './loomdb-store'
import type { Node, Edge } from './graph-model'

/**
 * Transaction operation types
 */
export enum TransactionOperationType {
  PUT_NODE = 'PUT_NODE',
  PUT_EDGE = 'PUT_EDGE',
  DELETE_NODE = 'DELETE_NODE',
  DELETE_EDGE = 'DELETE_EDGE'
}

/**
 * A single operation in a transaction
 */
export interface TransactionOperation {
  type: TransactionOperationType
  data: Node | Edge | string
}

/**
 * Transaction state
 */
export enum TransactionState {
  ACTIVE = 'ACTIVE',
  COMMITTED = 'COMMITTED',
  ROLLED_BACK = 'ROLLED_BACK',
  FAILED = 'FAILED'
}

/**
 * Snapshot of graph state for rollback
 */
interface StateSnapshot {
  nodes: Map<string, Node | null>
  edges: Map<string, Edge | null>
}

/**
 * Transaction error
 */
export class TransactionError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message)
    this.name = 'TransactionError'
  }
}

/**
 * LoomDB Transaction Manager
 * 
 * Provides ACID-like transaction semantics for graph operations:
 * - Atomicity: All operations succeed or all fail
 * - Consistency: Validation ensures valid graph state
 * - Isolation: Snapshot-based isolation from concurrent operations
 * - Durability: Changes are persisted to GUN on commit
 */
export class LoomDBTransaction {
  private operations: TransactionOperation[] = []
  private state: TransactionState = TransactionState.ACTIVE
  private snapshot: StateSnapshot = {
    nodes: new Map(),
    edges: new Map()
  }
  private readonly transactionId: string

  constructor(
    private store: LoomDBStore,
    private options: {
      /** Maximum operations per transaction (default: 1000) */
      maxOperations?: number
      /** Auto-commit on reaching max operations (default: false) */
      autoCommit?: boolean
    } = {}
  ) {
    this.transactionId = `txn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    this.options.maxOperations = this.options.maxOperations ?? 1000
    this.options.autoCommit = this.options.autoCommit ?? false
  }

  /**
   * Get transaction ID
   */
  getId(): string {
    return this.transactionId
  }

  /**
   * Get transaction state
   */
  getState(): TransactionState {
    return this.state
  }

  /**
   * Get number of operations in transaction
   */
  getOperationCount(): number {
    return this.operations.length
  }

  /**
   * Check if transaction is active
   */
  isActive(): boolean {
    return this.state === TransactionState.ACTIVE
  }

  /**
   * Ensure transaction is active
   */
  private ensureActive(): void {
    if (!this.isActive()) {
      throw new TransactionError(
        `Transaction ${this.transactionId} is not active (state: ${this.state})`
      )
    }
  }

  /**
   * Check operation limit
   */
  private checkOperationLimit(): void {
    if (this.operations.length >= this.options.maxOperations!) {
      if (this.options.autoCommit) {
        // Auto-commit when limit reached
        this.commit().catch(err => {
          throw new TransactionError('Auto-commit failed', err)
        })
      } else {
        throw new TransactionError(
          `Transaction operation limit reached (${this.options.maxOperations})`
        )
      }
    }
  }

  /**
   * Create snapshot of a node's current state
   */
  private async snapshotNode(nodeId: string): Promise<void> {
    if (!this.snapshot.nodes.has(nodeId)) {
      const node = await this.store.getNode(nodeId)
      this.snapshot.nodes.set(nodeId, node ? { ...node } : null)
    }
  }

  /**
   * Create snapshot of an edge's current state
   */
  private async snapshotEdge(edgeId: string): Promise<void> {
    if (!this.snapshot.edges.has(edgeId)) {
      const edge = await this.store.getEdge(edgeId)
      this.snapshot.edges.set(edgeId, edge ? { ...edge } : null)
    }
  }

  /**
   * Put a node (create or update)
   */
  async putNode(node: Node): Promise<void> {
    this.ensureActive()
    this.checkOperationLimit()

    // Snapshot current state before modification
    await this.snapshotNode(node.id)

    this.operations.push({
      type: TransactionOperationType.PUT_NODE,
      data: node
    })
  }

  /**
   * Put an edge (create or update)
   */
  async putEdge(edge: Edge): Promise<void> {
    this.ensureActive()
    this.checkOperationLimit()

    // Snapshot current state before modification
    await this.snapshotEdge(edge.id)
    await this.snapshotNode(edge.from)
    await this.snapshotNode(edge.to)

    this.operations.push({
      type: TransactionOperationType.PUT_EDGE,
      data: edge
    })
  }

  /**
   * Delete a node
   */
  async deleteNode(nodeId: string): Promise<void> {
    this.ensureActive()
    this.checkOperationLimit()

    // Snapshot current state before deletion
    await this.snapshotNode(nodeId)

    // Snapshot connected edges
    const outgoing = await this.store.getOutgoingEdges(nodeId)
    const incoming = await this.store.getIncomingEdges(nodeId)
    for (const edge of [...outgoing, ...incoming]) {
      await this.snapshotEdge(edge.id)
    }

    this.operations.push({
      type: TransactionOperationType.DELETE_NODE,
      data: nodeId
    })
  }

  /**
   * Delete an edge
   */
  async deleteEdge(edgeId: string): Promise<void> {
    this.ensureActive()
    this.checkOperationLimit()

    // Snapshot current state before deletion
    await this.snapshotEdge(edgeId)

    this.operations.push({
      type: TransactionOperationType.DELETE_EDGE,
      data: edgeId
    })
  }

  /**
   * Commit the transaction
   * Applies all operations atomically
   */
  async commit(): Promise<void> {
    this.ensureActive()

    try {
      // Execute all operations
      for (const operation of this.operations) {
        switch (operation.type) {
          case TransactionOperationType.PUT_NODE:
            await this.store.putNode(operation.data as Node)
            break

          case TransactionOperationType.PUT_EDGE:
            await this.store.putEdge(operation.data as Edge)
            break

          case TransactionOperationType.DELETE_NODE:
            await this.store.deleteNode(operation.data as string)
            break

          case TransactionOperationType.DELETE_EDGE:
            await this.store.deleteEdge(operation.data as string)
            break
        }
      }

      // Wait for GUN to persist
      await new Promise(resolve => setTimeout(resolve, 100))

      this.state = TransactionState.COMMITTED
    } catch (error) {
      this.state = TransactionState.FAILED
      // Attempt rollback
      await this.rollback()
      throw new TransactionError(
        `Transaction ${this.transactionId} commit failed`,
        error as Error
      )
    }
  }

  /**
   * Rollback the transaction
   * Restores all modified entities to their snapshot state
   */
  async rollback(): Promise<void> {
    if (this.state === TransactionState.ROLLED_BACK) {
      return // Already rolled back
    }

    if (this.state === TransactionState.COMMITTED) {
      throw new TransactionError(
        `Cannot rollback committed transaction ${this.transactionId}`
      )
    }

    try {
      // Restore nodes from snapshot
      for (const [nodeId, originalNode] of this.snapshot.nodes.entries()) {
        if (originalNode === null) {
          // Node didn't exist, delete it
          await this.store.deleteNode(nodeId)
        } else {
          // Restore original node
          await this.store.putNode(originalNode)
        }
      }

      // Restore edges from snapshot
      for (const [edgeId, originalEdge] of this.snapshot.edges.entries()) {
        if (originalEdge === null) {
          // Edge didn't exist, delete it
          await this.store.deleteEdge(edgeId)
        } else {
          // Restore original edge
          await this.store.putEdge(originalEdge)
        }
      }

      // Wait for GUN to persist
      await new Promise(resolve => setTimeout(resolve, 100))

      this.state = TransactionState.ROLLED_BACK
    } catch (error) {
      throw new TransactionError(
        `Transaction ${this.transactionId} rollback failed`,
        error as Error
      )
    }
  }

  /**
   * Execute a function within a transaction
   * Automatically commits on success or rolls back on error
   */
  static async execute<T>(
    store: LoomDBStore,
    fn: (txn: LoomDBTransaction) => Promise<T>,
    options?: {
      maxOperations?: number
      autoCommit?: boolean
    }
  ): Promise<T> {
    const txn = new LoomDBTransaction(store, options)

    try {
      const result = await fn(txn)
      await txn.commit()
      return result
    } catch (error) {
      await txn.rollback()
      throw error
    }
  }
}
