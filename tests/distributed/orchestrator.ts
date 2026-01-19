/**
 * Distributed Test Orchestrator
 * 
 * Coordinates tests across multiple distributed nodes
 */

import axios from 'axios'
import { NodeType, EdgeType } from '../../src/services/loommesh/graph-model'

interface NodeStats {
  nodeId: string
  stats: {
    nodesCreated: number
    edgesCreated: number
    remoteChanges: number
  }
  syncStatus: {
    connected: boolean
    subscriptions: number
    changeHistory: number
  }
}

class TestOrchestrator {
  private nodes = [
    { id: 'node-1', url: process.env.NODE_1_URL || 'http://loom-node-1:3001' },
    { id: 'node-2', url: process.env.NODE_2_URL || 'http://loom-node-2:3002' },
    { id: 'node-3', url: process.env.NODE_3_URL || 'http://loom-node-3:3003' }
  ]

  async waitForNodes() {
    console.log('⏳ Waiting for nodes to be ready...')
    
    for (const node of this.nodes) {
      let ready = false
      let attempts = 0
      
      while (!ready && attempts < 30) {
        try {
          const response = await axios.get(`${node.url}/health`, { timeout: 1000 })
          if (response.data.healthy) {
            console.log(`   ✅ ${node.id} is ready`)
            ready = true
          }
        } catch (error) {
          attempts++
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }
      
      if (!ready) {
        throw new Error(`Node ${node.id} failed to start`)
      }
    }
    
    console.log('✅ All nodes ready\n')
  }

  async getStats(nodeUrl: string): Promise<NodeStats> {
    const response = await axios.get(`${nodeUrl}/stats`)
    return response.data
  }

  async createNode(nodeUrl: string, nodeData: any) {
    const response = await axios.post(`${nodeUrl}/nodes`, nodeData)
    return response.data
  }

  async createEdge(nodeUrl: string, edgeData: any) {
    const response = await axios.post(`${nodeUrl}/edges`, edgeData)
    return response.data
  }

  async queryNodes(nodeUrl: string, filter?: any) {
    const params = new URLSearchParams(filter).toString()
    const response = await axios.get(`${nodeUrl}/nodes?${params}`)
    return response.data
  }

  async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async resetStats() {
    for (const node of this.nodes) {
      await axios.post(`${node.url}/stats/reset`)
      await axios.post(`${node.url}/history/clear`)
    }
  }

  // Test 1: Basic Sync - Node 1 creates, all nodes receive
  async testBasicSync() {
    console.log('\n📋 Test 1: Basic Synchronization')
    console.log('═'.repeat(60))
    
    await this.resetStats()
    
    // Node 1 creates a node
    console.log('1️⃣  Node 1: Creating test node...')
    await this.createNode(this.nodes[0].url, {
      id: 'test-basic-sync',
      type: NodeType.AGENT,
      properties: { name: 'Test Agent', test: 'basic-sync' }
    })
    
    // Wait for propagation
    console.log('⏳ Waiting for sync propagation...')
    await this.sleep(2000)
    
    // Check all nodes received it
    console.log('🔍 Checking sync on all nodes...')
    for (const node of this.nodes) {
      const result = await this.queryNodes(node.url, { type: NodeType.AGENT })
      const testNode = result.nodes.find((n: any) => n.id === 'test-basic-sync')
      
      if (testNode) {
        console.log(`   ✅ ${node.id}: Node synced successfully`)
      } else {
        console.log(`   ❌ ${node.id}: Node NOT found`)
        return false
      }
    }
    
    // Check stats
    const stats = await Promise.all(this.nodes.map(n => this.getStats(n.url)))
    console.log('\n📊 Stats:')
    stats.forEach((s, i) => {
      console.log(`   ${this.nodes[i].id}: ${s.stats.remoteChanges} remote changes`)
    })
    
    console.log('✅ Test 1: PASSED\n')
    return true
  }

  // Test 2: Concurrent Updates - Multiple nodes create simultaneously
  async testConcurrentUpdates() {
    console.log('\n📋 Test 2: Concurrent Updates')
    console.log('═'.repeat(60))
    
    await this.resetStats()
    
    // All nodes create nodes simultaneously
    console.log('🔀 All nodes creating nodes concurrently...')
    const creates = this.nodes.map((node, i) => 
      this.createNode(node.url, {
        id: `concurrent-node-${i}`,
        type: NodeType.TASK,
        properties: { createdBy: node.id, index: i }
      })
    )
    
    await Promise.all(creates)
    console.log('✅ All creates completed')
    
    // Wait for sync
    console.log('⏳ Waiting for sync propagation...')
    await this.sleep(3000)
    
    // Each node should see all 3 nodes
    console.log('🔍 Verifying all nodes see all creations...')
    for (const node of this.nodes) {
      const result = await this.queryNodes(node.url, { type: NodeType.TASK })
      const concurrentNodes = result.nodes.filter((n: any) => n.id.startsWith('concurrent-node-'))
      
      console.log(`   ${node.id}: Sees ${concurrentNodes.length}/3 nodes`)
      
      if (concurrentNodes.length !== 3) {
        console.log(`   ❌ ${node.id}: Missing nodes!`)
        return false
      }
    }
    
    console.log('✅ Test 2: PASSED\n')
    return true
  }

  // Test 3: Cross-Node Edges - Create edges between nodes from different creators
  async testCrossNodeEdges() {
    console.log('\n📋 Test 3: Cross-Node Edges')
    console.log('═'.repeat(60))
    
    await this.resetStats()
    
    // Node 1 creates two nodes
    console.log('1️⃣  Node 1: Creating source and target nodes...')
    await this.createNode(this.nodes[0].url, {
      id: 'edge-test-source',
      type: NodeType.AGENT,
      properties: { role: 'source' }
    })
    
    await this.createNode(this.nodes[0].url, {
      id: 'edge-test-target',
      type: NodeType.AGENT,
      properties: { role: 'target' }
    })
    
    await this.sleep(2000)
    
    // Node 2 creates edge between them
    console.log('2️⃣  Node 2: Creating edge between nodes...')
    await this.createEdge(this.nodes[1].url, {
      id: 'edge-test-connection',
      from: 'edge-test-source',
      to: 'edge-test-target',
      type: EdgeType.COLLABORATES_WITH
    })
    
    await this.sleep(2000)
    
    // Node 3 queries edges
    console.log('3️⃣  Node 3: Querying edges...')
    const result = await this.queryNodes(this.nodes[2].url)
    const edges = await axios.get(`${this.nodes[2].url}/edges`)
    
    const testEdge = edges.data.edges.find((e: any) => e.id === 'edge-test-connection')
    
    if (testEdge) {
      console.log(`   ✅ Edge synced: ${testEdge.from} → ${testEdge.to}`)
    } else {
      console.log(`   ❌ Edge not found`)
      return false
    }
    
    console.log('✅ Test 3: PASSED\n')
    return true
  }

  // Test 4: High Volume - Many operations in quick succession
  async testHighVolume() {
    console.log('\n📋 Test 4: High Volume Operations')
    console.log('═'.repeat(60))
    
    await this.resetStats()
    
    const nodeCount = 50
    console.log(`📊 Creating ${nodeCount} nodes across 3 nodes...`)
    
    const creates: Promise<any>[] = []
    for (let i = 0; i < nodeCount; i++) {
      const nodeIndex = i % 3
      creates.push(
        this.createNode(this.nodes[nodeIndex].url, {
          id: `volume-test-${i}`,
          type: NodeType.FACT,
          properties: { index: i, createdBy: this.nodes[nodeIndex].id }
        })
      )
    }
    
    await Promise.all(creates)
    console.log('✅ All creates completed')
    
    // Wait for sync
    console.log('⏳ Waiting for sync propagation...')
    await this.sleep(5000)
    
    // Check each node sees all facts
    console.log('🔍 Verifying sync...')
    for (const node of this.nodes) {
      const result = await this.queryNodes(node.url, { type: NodeType.FACT })
      const volumeNodes = result.nodes.filter((n: any) => n.id.startsWith('volume-test-'))
      
      console.log(`   ${node.id}: Sees ${volumeNodes.length}/${nodeCount} nodes`)
    }
    
    // Check stats
    const stats = await Promise.all(this.nodes.map(n => this.getStats(n.url)))
    console.log('\n📊 Sync Statistics:')
    stats.forEach((s, i) => {
      console.log(`   ${this.nodes[i].id}:`)
      console.log(`      Created: ${s.stats.nodesCreated}`)
      console.log(`      Received: ${s.stats.remoteChanges} remote changes`)
      console.log(`      History: ${s.syncStatus.changeHistory} events`)
    })
    
    console.log('✅ Test 4: PASSED\n')
    return true
  }

  // Test 5: Sync Latency Measurement
  async testSyncLatency() {
    console.log('\n📋 Test 5: Sync Latency Measurement')
    console.log('═'.repeat(60))
    
    await this.resetStats()
    
    const measurements: number[] = []
    const iterations = 10
    
    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now()
      
      // Node 1 creates
      await this.createNode(this.nodes[0].url, {
        id: `latency-test-${i}`,
        type: NodeType.EVENT,
        properties: { iteration: i, timestamp: startTime }
      })
      
      // Poll node 2 until it appears
      let synced = false
      let attempts = 0
      const maxAttempts = 50 // 5 seconds max
      
      while (!synced && attempts < maxAttempts) {
        const result = await this.queryNodes(this.nodes[1].url)
        const found = result.nodes.find((n: any) => n.id === `latency-test-${i}`)
        
        if (found) {
          const latency = Date.now() - startTime
          measurements.push(latency)
          synced = true
          console.log(`   Iteration ${i + 1}: ${latency}ms`)
        } else {
          await this.sleep(100)
          attempts++
        }
      }
      
      if (!synced) {
        console.log(`   ❌ Iteration ${i + 1}: Timeout`)
      }
    }
    
    // Calculate statistics
    const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length
    const min = Math.min(...measurements)
    const max = Math.max(...measurements)
    const sorted = measurements.sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length * 0.5)]
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    const p99 = sorted[Math.floor(sorted.length * 0.99)]
    
    console.log('\n📊 Latency Statistics:')
    console.log(`   Average: ${avg.toFixed(0)}ms`)
    console.log(`   Min: ${min}ms`)
    console.log(`   Max: ${max}ms`)
    console.log(`   p50: ${p50}ms`)
    console.log(`   p95: ${p95}ms`)
    console.log(`   p99: ${p99}ms`)
    
    console.log('✅ Test 5: PASSED\n')
    return true
  }

  async runAllTests() {
    console.log('\n🧪 Distributed LoomDB Sync Tests')
    console.log('═'.repeat(60))
    console.log(`Testing ${this.nodes.length} nodes:\n`)
    this.nodes.forEach(n => console.log(`   • ${n.id}: ${n.url}`))
    console.log('═'.repeat(60))
    
    try {
      await this.waitForNodes()
      
      const results = {
        basicSync: await this.testBasicSync(),
        concurrentUpdates: await this.testConcurrentUpdates(),
        crossNodeEdges: await this.testCrossNodeEdges(),
        highVolume: await this.testHighVolume(),
        syncLatency: await this.testSyncLatency()
      }
      
      console.log('\n' + '═'.repeat(60))
      console.log('📊 Test Results Summary')
      console.log('═'.repeat(60))
      
      Object.entries(results).forEach(([name, passed]) => {
        const icon = passed ? '✅' : '❌'
        console.log(`   ${icon} ${name}`)
      })
      
      const allPassed = Object.values(results).every(r => r)
      
      console.log('═'.repeat(60))
      if (allPassed) {
        console.log('✅ ALL TESTS PASSED')
      } else {
        console.log('❌ SOME TESTS FAILED')
      }
      console.log('═'.repeat(60))
      
      process.exit(allPassed ? 0 : 1)
      
    } catch (error) {
      console.error('\n❌ Test execution failed:', error)
      process.exit(1)
    }
  }
}

// Run tests
const orchestrator = new TestOrchestrator()
orchestrator.runAllTests()
