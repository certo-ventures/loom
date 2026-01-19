/**
 * Tests for LoomDB Real-Time Sync
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LoomMeshService } from '../../../services/loommesh/loommesh-service'
import { LoomDBSync, ChangeType, type GraphChange, type SyncEvent } from '../../../services/loommesh/loomdb-sync'
import { NodeType, EdgeType } from '../../../services/loommesh/graph-model'

describe('LoomDBSync', () => {
  let service: LoomMeshService
  let sync: LoomDBSync

  beforeEach(async () => {
    service = new LoomMeshService({
      peers: [],
      persistence: false,
      storage: {
        type: 'memory'
      }
    })
    await service.start()

    sync = new LoomDBSync(service, {
      debounceMs: 50,
      trackChanges: true,
      maxChangeHistory: 100
    })
  })

  afterEach(async () => {
    if (sync) {
      await sync.cleanup()
    }
    if (service) {
      await service.stop()
    }
  })

  describe('Sync Lifecycle', () => {
    it('should start and stop sync', async () => {
      expect(sync.getStatus().connected).toBe(false)

      await sync.startSync()
      expect(sync.getStatus().connected).toBe(true)

      await sync.stopSync()
      expect(sync.getStatus().connected).toBe(false)
    })

    it('should emit sync-connected event', async () => {
      const events: SyncEvent[] = []
      sync.on('sync-connected', (event) => events.push(event))

      await sync.startSync()

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('sync-connected')
    })

    it('should emit sync-disconnected event', async () => {
      const events: SyncEvent[] = []
      sync.on('sync-disconnected', (event) => events.push(event))

      await sync.startSync()
      await sync.stopSync()

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('sync-disconnected')
    })

    it('should not start sync twice', async () => {
      await sync.startSync()
      const status1 = sync.getStatus()

      await sync.startSync() // Second call should be no-op
      const status2 = sync.getStatus()

      expect(status1.subscriptions).toBe(status2.subscriptions)
    })
  })

  describe('Node Synchronization', () => {
    beforeEach(async () => {
      await sync.startSync()
    })

    it('should sync node creation across nodes', async () => {
      const changes: GraphChange[] = []
      sync.on('remote-change', (event) => {
        if (event.change) changes.push(event.change)
      })

      // Create node
      const node = await sync.putNode({
        id: 'node-1',
        type: NodeType.AGENT,
        properties: { name: 'Test Agent' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 200))

      expect(node.id).toBe('node-1')
      // Remote changes will be captured when GUN broadcasts
    })

    it('should sync node updates', async () => {
      // Create initial node
      await sync.putNode({
        id: 'node-2',
        type: NodeType.TASK,
        properties: { status: 'pending' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Update node
      const updated = await sync.putNode({
        id: 'node-2',
        type: NodeType.TASK,
        properties: { status: 'completed' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      expect(updated.properties.status).toBe('completed')
    })

    it('should sync node deletion', async () => {
      // Create node
      await sync.putNode({
        id: 'node-3',
        type: NodeType.MESSAGE,
        properties: { content: 'Test' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Delete node
      const deleted = await sync.deleteNode('node-3')
      expect(deleted).toBe(true)
    })

    it('should track node changes in history', async () => {
      await sync.putNode({
        id: 'node-4',
        type: NodeType.FACT,
        properties: { value: 'test' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 200))

      const history = sync.getChangeHistory()
      expect(history.length).toBeGreaterThan(0)
    })
  })

  describe('Edge Synchronization', () => {
    beforeEach(async () => {
      await sync.startSync()

      // Create nodes for edges
      await sync.putNode({
        id: 'node-a',
        type: NodeType.AGENT,
        properties: { name: 'Agent A' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await sync.putNode({
        id: 'node-b',
        type: NodeType.AGENT,
        properties: { name: 'Agent B' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 100))
    })

    it('should sync edge creation', async () => {
      const edge = await sync.putEdge({
        id: 'edge-1',
        from: 'node-a',
        to: 'node-b',
        type: EdgeType.COLLABORATES_WITH,
        properties: { since: '2024-01-01' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      expect(edge.id).toBe('edge-1')
      expect(edge.from).toBe('node-a')
      expect(edge.to).toBe('node-b')
    })

    it('should sync edge updates', async () => {
      await sync.putEdge({
        id: 'edge-2',
        from: 'node-a',
        to: 'node-b',
        type: EdgeType.SENDS_TO,
        weight: 1.0,
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const updated = await sync.putEdge({
        id: 'edge-2',
        from: 'node-a',
        to: 'node-b',
        type: EdgeType.SENDS_TO,
        weight: 2.5,
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      expect(updated.weight).toBe(2.5)
    })

    it('should sync edge deletion', async () => {
      await sync.putEdge({
        id: 'edge-3',
        from: 'node-a',
        to: 'node-b',
        type: EdgeType.DEPENDS_ON,
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const deleted = await sync.deleteEdge('edge-3')
      expect(deleted).toBe(true)
    })
  })

  describe('Change Events', () => {
    beforeEach(async () => {
      await sync.startSync()
    })

    it('should emit remote-change events for nodes', async () => {
      const events: SyncEvent[] = []
      sync.on('remote-change', (event) => events.push(event))

      await sync.putNode({
        id: 'node-5',
        type: NodeType.CONCEPT,
        properties: { name: 'Test Concept' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 200))

      // Should have received change event from GUN broadcast
      expect(events.length).toBeGreaterThan(0)
    })

    it('should handle sync errors gracefully', async () => {
      const errors: SyncEvent[] = []
      sync.on('sync-error', (event) => errors.push(event))

      // This should not crash the system even if it causes errors
      await sync.putNode({
        id: 'invalid',
        type: NodeType.CUSTOM,
        properties: {},
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // System should still be operational
      expect(sync.getStatus().connected).toBe(true)
    })
  })

  describe('Change History', () => {
    beforeEach(async () => {
      await sync.startSync()
    })

    it('should track change history', async () => {
      sync.clearChangeHistory()

      await sync.putNode({
        id: 'node-6',
        type: NodeType.EVENT,
        properties: { action: 'test' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 200))

      const history = sync.getChangeHistory()
      expect(history.length).toBeGreaterThan(0)
    })

    it('should limit change history size', async () => {
      const smallSync = new LoomDBSync(service, {
        trackChanges: true,
        maxChangeHistory: 3
      })

      await smallSync.startSync()

      // Create more nodes than history limit
      for (let i = 0; i < 5; i++) {
        await smallSync.putNode({
          id: `node-hist-${i}`,
          type: NodeType.STATE,
          properties: { index: i },
          metadata: {
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        })
      }

      await new Promise(resolve => setTimeout(resolve, 300))

      const history = smallSync.getChangeHistory()
      expect(history.length).toBeLessThanOrEqual(3)

      await smallSync.cleanup()
    })

    it('should clear change history', async () => {
      await sync.putNode({
        id: 'node-7',
        type: NodeType.RULE,
        properties: { condition: 'true' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 200))

      sync.clearChangeHistory()
      expect(sync.getChangeHistory()).toHaveLength(0)
    })
  })

  describe('Circuit Breaker', () => {
    it('should track circuit breaker status', async () => {
      await sync.startSync()

      const status = sync.getStatus()
      expect(status.circuitBreakers).toBeDefined()
    })
  })

  describe('Event Listeners', () => {
    it('should add and remove event listeners', async () => {
      const listener = vi.fn()

      sync.on('remote-change', listener)
      sync.off('remote-change', listener)

      await sync.startSync()

      await sync.putNode({
        id: 'node-8',
        type: NodeType.GOAL,
        properties: { target: 'test' },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 200))

      // Listener was removed, should not be called
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('Status Reporting', () => {
    it('should report sync status', async () => {
      const status1 = sync.getStatus()
      expect(status1.connected).toBe(false)
      expect(status1.subscriptions).toBe(0)

      await sync.startSync()

      const status2 = sync.getStatus()
      expect(status2.connected).toBe(true)
      expect(status2.subscriptions).toBeGreaterThan(0)
    })
  })

  describe('Store Access', () => {
    it('should provide access to underlying store', () => {
      const store = sync.getStore()
      expect(store).toBeDefined()
      expect(typeof store.putNode).toBe('function')
      expect(typeof store.getNode).toBe('function')
    })

    it('should allow direct store operations without sync', async () => {
      // Don't start sync
      const store = sync.getStore()

      const node = await store.putNode({
        id: 'direct-node',
        type: NodeType.CUSTOM,
        properties: { direct: true },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      expect(node.id).toBe('direct-node')

      const retrieved = await store.getNode('direct-node')
      expect(retrieved?.properties.direct).toBe(true)
    })
  })

  describe('Debouncing', () => {
    it('should debounce rapid changes', async () => {
      const fastSync = new LoomDBSync(service, {
        debounceMs: 100,
        trackChanges: false
      })

      await fastSync.startSync()

      // Rapid updates
      await fastSync.putNode({
        id: 'rapid-node',
        type: NodeType.STATE,
        properties: { value: 1 },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await fastSync.putNode({
        id: 'rapid-node',
        type: NodeType.STATE,
        properties: { value: 2 },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await fastSync.putNode({
        id: 'rapid-node',
        type: NodeType.STATE,
        properties: { value: 3 },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 200))

      const status = fastSync.getStatus()
      expect(status.pendingChanges).toBe(0) // All should be processed

      await fastSync.cleanup()
    })
  })

  describe('Multi-Node Simulation', () => {
    it('should simulate changes from multiple nodes', async () => {
      // Create second sync instance (simulating another node)
      const sync2 = new LoomDBSync(service, {
        debounceMs: 50,
        trackChanges: true
      })

      await sync.startSync()
      await sync2.startSync()

      const changes1: GraphChange[] = []
      const changes2: GraphChange[] = []

      sync.on('remote-change', (event) => {
        if (event.change) changes1.push(event.change)
      })

      sync2.on('remote-change', (event) => {
        if (event.change) changes2.push(event.change)
      })

      // Node 1 creates a node
      await sync.putNode({
        id: 'multi-node-1',
        type: NodeType.AGENT,
        properties: { node: 1 },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 200))

      // Node 2 should receive the change
      expect(changes2.length).toBeGreaterThan(0)

      // Node 2 creates a node
      await sync2.putNode({
        id: 'multi-node-2',
        type: NodeType.AGENT,
        properties: { node: 2 },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await new Promise(resolve => setTimeout(resolve, 200))

      // Node 1 should receive the change
      expect(changes1.length).toBeGreaterThan(0)

      await sync2.cleanup()
    })
  })

  describe('Cleanup', () => {
    it('should cleanup all resources', async () => {
      await sync.startSync()

      await sync.putNode({
        id: 'cleanup-node',
        type: NodeType.PATTERN,
        properties: { test: true },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })

      await sync.cleanup()

      const status = sync.getStatus()
      expect(status.connected).toBe(false)
      expect(status.subscriptions).toBe(0)
      expect(status.pendingChanges).toBe(0)
      expect(status.changeHistory).toBe(0)
    })
  })
})
