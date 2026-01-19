/**
 * Tests for LoomDB Transaction Manager (TODO-020)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LoomMeshService } from '../../../services/loommesh/loommesh-service'
import { LoomDBStore } from '../../../services/loommesh/loomdb-store'
import { LoomDBTransaction, TransactionState, TransactionError } from '../../../services/loommesh/loomdb-transaction'
import { createNode, createEdge, NodeType, EdgeType } from '../../../services/loommesh/graph-model'
import type { LoomMeshConfig } from '../../../services/loommesh/loommesh-service'

describe('LoomDB Transaction Manager (TODO-020)', () => {
  let service: LoomMeshService
  let store: LoomDBStore

  beforeEach(async () => {
    const config: LoomMeshConfig = {
      storage: { type: 'memory' }
    }
    
    service = new LoomMeshService(config)
    await service.start()
    store = new LoomDBStore(service)
  })

  afterEach(async () => {
    if (store) {
      await store.clear()
    }
    if (service) {
      await service.stop()
    }
  })

  describe('Transaction Lifecycle', () => {
    it('should create a transaction with unique ID', () => {
      const txn = new LoomDBTransaction(store)
      expect(txn.getId()).toMatch(/^txn-/)
      expect(txn.getState()).toBe(TransactionState.ACTIVE)
      expect(txn.isActive()).toBe(true)
    })

    it('should track operation count', async () => {
      const txn = new LoomDBTransaction(store)
      
      expect(txn.getOperationCount()).toBe(0)
      
      await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent' }))
      expect(txn.getOperationCount()).toBe(1)
      
      await txn.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH))
      expect(txn.getOperationCount()).toBe(2)
    })

    it('should transition to COMMITTED state after commit', async () => {
      const txn = new LoomDBTransaction(store)
      await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent' }))
      
      await txn.commit()
      
      expect(txn.getState()).toBe(TransactionState.COMMITTED)
      expect(txn.isActive()).toBe(false)
    })

    it('should transition to ROLLED_BACK state after rollback', async () => {
      const txn = new LoomDBTransaction(store)
      await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent' }))
      
      await txn.rollback()
      
      expect(txn.getState()).toBe(TransactionState.ROLLED_BACK)
      expect(txn.isActive()).toBe(false)
    })
  })

  describe('Atomic Node Operations', () => {
    it('should commit multiple node creations atomically', async () => {
      const txn = new LoomDBTransaction(store)
      
      await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await txn.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await txn.putNode(createNode('node-3', NodeType.AGENT, { name: 'Agent 3' }))
      
      await txn.commit()
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const node1 = await store.getNode('node-1')
      const node2 = await store.getNode('node-2')
      const node3 = await store.getNode('node-3')
      
      expect(node1).not.toBeNull()
      expect(node2).not.toBeNull()
      expect(node3).not.toBeNull()
    })

    it('should rollback node creations', async () => {
      const txn = new LoomDBTransaction(store)
      
      await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await txn.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      
      await txn.rollback()
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const node1 = await store.getNode('node-1')
      const node2 = await store.getNode('node-2')
      
      expect(node1).toBeNull()
      expect(node2).toBeNull()
    })

    it('should rollback node updates to original state', async () => {
      // Create original node
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Original', status: 'active' }))
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Update in transaction and rollback
      const txn = new LoomDBTransaction(store)
      await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Modified', status: 'inactive' }))
      await txn.rollback()
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const node = await store.getNode('node-1')
      expect(node?.properties.name).toBe('Original')
      expect(node?.properties.status).toBe('active')
    })

    it('should handle node deletions in transaction', async () => {
      // Create node
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent' }))
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Delete in transaction
      const txn = new LoomDBTransaction(store)
      await txn.deleteNode('node-1')
      await txn.commit()
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const node = await store.getNode('node-1')
      expect(node).toBeNull()
    })

    it('should rollback node deletions', async () => {
      // Create node
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent' }))
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Delete in transaction and rollback
      const txn = new LoomDBTransaction(store)
      await txn.deleteNode('node-1')
      await txn.rollback()
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const node = await store.getNode('node-1')
      expect(node).not.toBeNull()
      expect(node?.properties.name).toBe('Agent')
    })
  })

  describe('Atomic Edge Operations', () => {
    it('should commit edge creation atomically', async () => {
      // Create nodes first
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await store.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const txn = new LoomDBTransaction(store)
      await txn.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH))
      await txn.commit()
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const edge = await store.getEdge('edge-1')
      expect(edge).not.toBeNull()
      expect(edge?.from).toBe('node-1')
      expect(edge?.to).toBe('node-2')
    })

    it('should rollback edge creation', async () => {
      await store.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await store.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const txn = new LoomDBTransaction(store)
      await txn.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH))
      await txn.rollback()
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const edge = await store.getEdge('edge-1')
      expect(edge).toBeNull()
    })
  })

  describe('Mixed Operations', () => {
    it('should handle mixed node and edge operations', async () => {
      const txn = new LoomDBTransaction(store)
      
      // Create nodes and edges in one transaction
      await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await txn.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await txn.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH))
      
      await txn.commit()
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const node1 = await store.getNode('node-1')
      const node2 = await store.getNode('node-2')
      const edge = await store.getEdge('edge-1')
      
      expect(node1).not.toBeNull()
      expect(node2).not.toBeNull()
      expect(edge).not.toBeNull()
    })

    it('should rollback all operations on failure', async () => {
      const txn = new LoomDBTransaction(store)
      
      await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await txn.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      await txn.putEdge(createEdge('edge-1', 'node-1', 'node-2', EdgeType.COLLABORATES_WITH))
      
      await txn.rollback()
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const node1 = await store.getNode('node-1')
      const node2 = await store.getNode('node-2')
      const edge = await store.getEdge('edge-1')
      
      expect(node1).toBeNull()
      expect(node2).toBeNull()
      expect(edge).toBeNull()
    })
  })

  describe('Transaction Constraints', () => {
    it('should throw error when operating on inactive transaction', async () => {
      const txn = new LoomDBTransaction(store)
      await txn.commit()
      
      await expect(
        txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent' }))
      ).rejects.toThrow(TransactionError)
    })

    it('should throw error when exceeding operation limit', async () => {
      const txn = new LoomDBTransaction(store, { maxOperations: 2 })
      
      await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
      await txn.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      
      await expect(
        txn.putNode(createNode('node-3', NodeType.AGENT, { name: 'Agent 3' }))
      ).rejects.toThrow(TransactionError)
    })

    it('should not allow rollback of committed transaction', async () => {
      const txn = new LoomDBTransaction(store)
      await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent' }))
      await txn.commit()
      
      await expect(txn.rollback()).rejects.toThrow(TransactionError)
    })
  })

  describe('Static Execute Helper', () => {
    it('should auto-commit on success', async () => {
      await LoomDBTransaction.execute(store, async (txn) => {
        await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
        await txn.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
      })
      
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const node1 = await store.getNode('node-1')
      const node2 = await store.getNode('node-2')
      
      expect(node1).not.toBeNull()
      expect(node2).not.toBeNull()
    })

    it('should auto-rollback on error', async () => {
      await expect(
        LoomDBTransaction.execute(store, async (txn) => {
          await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent 1' }))
          await txn.putNode(createNode('node-2', NodeType.AGENT, { name: 'Agent 2' }))
          throw new Error('Simulated error')
        })
      ).rejects.toThrow('Simulated error')
      
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const node1 = await store.getNode('node-1')
      const node2 = await store.getNode('node-2')
      
      expect(node1).toBeNull()
      expect(node2).toBeNull()
    })

    it('should return function result', async () => {
      const result = await LoomDBTransaction.execute(store, async (txn) => {
        await txn.putNode(createNode('node-1', NodeType.AGENT, { name: 'Agent' }))
        return 'success'
      })
      
      expect(result).toBe('success')
    })
  })

  describe('Complex Scenarios', () => {
    it('should handle creating a subgraph atomically', async () => {
      await LoomDBTransaction.execute(store, async (txn) => {
        // Create a small workflow graph
        await txn.putNode(createNode('task-1', NodeType.TASK, { title: 'Task 1' }))
        await txn.putNode(createNode('task-2', NodeType.TASK, { title: 'Task 2' }))
        await txn.putNode(createNode('task-3', NodeType.TASK, { title: 'Task 3' }))
        
        await txn.putEdge(createEdge('e1', 'task-1', 'task-2', EdgeType.PRECEDES))
        await txn.putEdge(createEdge('e2', 'task-2', 'task-3', EdgeType.PRECEDES))
      })
      
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const task1 = await store.getNode('task-1')
      const task2 = await store.getNode('task-2')
      const task3 = await store.getNode('task-3')
      const edge1 = await store.getEdge('e1')
      const edge2 = await store.getEdge('e2')
      
      expect(task1).not.toBeNull()
      expect(task2).not.toBeNull()
      expect(task3).not.toBeNull()
      expect(edge1).not.toBeNull()
      expect(edge2).not.toBeNull()
    })

    it('should preserve existing data when transaction fails', async () => {
      // Create initial data
      await store.putNode(createNode('existing', NodeType.AGENT, { name: 'Existing' }))
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Attempt transaction that fails
      await expect(
        LoomDBTransaction.execute(store, async (txn) => {
          await txn.putNode(createNode('new-1', NodeType.AGENT, { name: 'New 1' }))
          await txn.putNode(createNode('new-2', NodeType.AGENT, { name: 'New 2' }))
          throw new Error('Transaction failed')
        })
      ).rejects.toThrow()
      
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Existing data should still be there
      const existing = await store.getNode('existing')
      expect(existing).not.toBeNull()
      
      // New data should not exist
      const new1 = await store.getNode('new-1')
      const new2 = await store.getNode('new-2')
      expect(new1).toBeNull()
      expect(new2).toBeNull()
    })
  })
})
