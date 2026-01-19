/**
 * Distributed Node Runner
 * 
 * Runs a LoomMesh node that participates in distributed graph sync testing
 */

import express from 'express'
import { LoomMeshService } from './src/services/loommesh/loommesh-service'
import { LoomDBSync } from './src/services/loommesh/loomdb-sync'
import { NodeType, EdgeType } from './src/services/loommesh/graph-model'

const app = express()
app.use(express.json())

const nodeId = process.env.NODE_ID || 'unknown'
const port = parseInt(process.env.PORT || '3000')
const gunPeers = process.env.GUN_PEERS?.split(',') || []

let service: LoomMeshService
let sync: LoomDBSync
let stats = {
  nodesCreated: 0,
  edgesCreated: 0,
  remoteChanges: 0,
  lastChange: null as any
}

// Initialize service
async function init() {
  console.log(`🚀 Starting Loom Node: ${nodeId}`)
  console.log(`   Port: ${port}`)
  console.log(`   Peers: ${gunPeers.join(', ')}`)

  service = new LoomMeshService({
    peers: gunPeers,
    persistence: false,
    storage: {
      type: 'memory'
    }
  })

  await service.start()
  console.log(`✅ LoomMesh service started`)

  sync = new LoomDBSync(service, {
    debounceMs: 50,
    trackChanges: true,
    maxChangeHistory: 1000,
    conflictResolution: 'last-write-wins',
    autoResolveConflicts: true
  })

  // Track remote changes
  sync.on('remote-change', (event) => {
    stats.remoteChanges++
    stats.lastChange = event.change
  })

  await sync.startSync()
  console.log(`✅ Sync started`)
}

// Health check
app.get('/health', (req, res) => {
  const status = sync?.getStatus()
  res.json({
    nodeId,
    healthy: true,
    sync: status,
    stats
  })
})

// Get node stats
app.get('/stats', (req, res) => {
  const status = sync?.getStatus()
  res.json({
    nodeId,
    stats,
    syncStatus: status
  })
})

// Create node
app.post('/nodes', async (req, res) => {
  try {
    const node = await sync.putNode({
      id: req.body.id || `node-${Date.now()}`,
      type: req.body.type || NodeType.CUSTOM,
      properties: req.body.properties || {},
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: nodeId
      }
    })
    
    stats.nodesCreated++
    res.json({ success: true, node })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Create edge
app.post('/edges', async (req, res) => {
  try {
    const edge = await sync.putEdge({
      id: req.body.id || `edge-${Date.now()}`,
      from: req.body.from,
      to: req.body.to,
      type: req.body.type || EdgeType.CUSTOM,
      properties: req.body.properties,
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: nodeId
      }
    })
    
    stats.edgesCreated++
    res.json({ success: true, edge })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Query nodes
app.get('/nodes', async (req, res) => {
  try {
    const store = sync.getStore()
    const filter: any = {}
    
    if (req.query.type) filter.type = req.query.type
    
    const nodes = await store.queryNodes(filter)
    res.json({ success: true, count: nodes.length, nodes })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Query edges
app.get('/edges', async (req, res) => {
  try {
    const store = sync.getStore()
    const filter: any = {}
    
    if (req.query.type) filter.type = req.query.type
    if (req.query.from) filter.from = req.query.from
    if (req.query.to) filter.to = req.query.to
    
    const edges = await store.queryEdges(filter)
    res.json({ success: true, count: edges.length, edges })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Get change history
app.get('/history', (req, res) => {
  const history = sync.getChangeHistory()
  res.json({ success: true, count: history.length, history })
})

// Clear change history
app.post('/history/clear', (req, res) => {
  sync.clearChangeHistory()
  res.json({ success: true })
})

// Reset stats
app.post('/stats/reset', (req, res) => {
  stats = {
    nodesCreated: 0,
    edgesCreated: 0,
    remoteChanges: 0,
    lastChange: null
  }
  res.json({ success: true })
})

// Shutdown
app.post('/shutdown', async (req, res) => {
  res.json({ success: true, message: 'Shutting down...' })
  
  setTimeout(async () => {
    await sync.cleanup()
    await service.stop()
    process.exit(0)
  }, 1000)
})

// Start server
init().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`📡 Node API listening on http://0.0.0.0:${port}`)
    console.log(`   Node ID: ${nodeId}`)
  })
}).catch(error => {
  console.error('Failed to start node:', error)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down node...')
  await sync?.cleanup()
  await service?.stop()
  process.exit(0)
})
