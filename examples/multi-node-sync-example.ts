/**
 * Multi-Node Criteria Evaluation Engine Example with Real-Time Sync
 * 
 * Demonstrates LoomDB real-time synchronization across multiple nodes:
 * - Multi-node distributed processing
 * - Real-time change propagation
 * - Event-driven architecture
 * - Automatic conflict resolution
 * 
 * Scenario:
 * Two nodes (Node A and Node B) collaborate on evaluating a project proposal:
 * - Node A: Extracts data and creates initial facts
 * - Node B: Evaluates criteria based on Node A's facts
 * - Both nodes sync graph changes in real-time
 */

import { LoomMeshService } from '../src/services/loommesh/loommesh-service'
import { LoomDBSync, type GraphChange, ChangeType } from '../src/services/loommesh/loomdb-sync'
import { LoomDBQueryEngine } from '../src/services/loommesh/loomdb-query-engine'
import { GraphVisualizer } from '../src/services/loommesh/graph-visualizer'
import { NodeType, EdgeType } from '../src/services/loommesh/graph-model'

/**
 * Simulate Node A - Document Extractor
 * Extracts facts from documents and creates the knowledge graph
 */
async function runNodeA(service: LoomMeshService): Promise<LoomDBSync> {
  console.log('\n🅰️  NODE A: Document Extractor Node')
  console.log('═'.repeat(60))
  
  const syncA = new LoomDBSync(service, {
    debounceMs: 100,
    trackChanges: true,
    conflictResolution: 'last-write-wins',
    autoResolveConflicts: true
  })

  // Listen for remote changes
  let remoteChanges = 0
  syncA.on('remote-change', (event) => {
    remoteChanges++
    if (event.change) {
      console.log(`  📥 Received change from other node: ${event.change.type}`)
    }
  })

  // Start syncing
  await syncA.startSync()
  console.log('✅ Sync started')

  // Create document node
  await syncA.putNode({
    id: 'doc-001',
    type: NodeType.DOCUMENT,
    properties: {
      title: 'Project Proposal: AI-Powered Supply Chain',
      source: 'proposal-2024-q1.pdf',
      pages: 45
    },
    metadata: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'node-a'
    }
  })
  console.log('📄 Created document node')

  // Create extraction agent
  await syncA.putNode({
    id: 'agent-extractor',
    type: NodeType.AGENT,
    properties: {
      name: 'GPT-4 Extractor',
      model: 'gpt-4-turbo',
      role: 'data_extraction'
    },
    metadata: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'node-a'
    }
  })
  console.log('🤖 Created extractor agent')

  // Extract facts
  const facts = [
    { id: 'fact-budget', key: 'budget', value: '$2.5M', confidence: 0.95 },
    { id: 'fact-timeline', key: 'timeline', value: '18 months', confidence: 0.90 },
    { id: 'fact-tech', key: 'technology', value: 'TensorFlow + PyTorch', confidence: 0.85 },
    { id: 'fact-compliance', key: 'compliance', value: 'ISO 27001, SOC 2', confidence: 0.92 }
  ]

  for (const fact of facts) {
    await syncA.putNode({
      id: fact.id,
      type: NodeType.FACT,
      properties: {
        key: fact.key,
        value: fact.value,
        confidence: fact.confidence,
        extractedBy: 'agent-extractor'
      },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'node-a'
      }
    })

    // Link fact to document and agent
    await syncA.putEdge({
      id: `edge-doc-${fact.id}`,
      from: 'doc-001',
      to: fact.id,
      type: EdgeType.DERIVES_FROM,
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'node-a'
      }
    })

    await syncA.putEdge({
      id: `edge-agent-${fact.id}`,
      from: 'agent-extractor',
      to: fact.id,
      type: EdgeType.RESULTED_IN,
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'node-a'
      }
    })
  }

  console.log(`📊 Extracted ${facts.length} facts and created relationships`)
  console.log(`📡 Status: ${remoteChanges} remote changes received`)

  return syncA
}

/**
 * Simulate Node B - Criteria Evaluator
 * Waits for facts from Node A, then evaluates criteria
 */
async function runNodeB(service: LoomMeshService): Promise<LoomDBSync> {
  console.log('\n🅱️  NODE B: Criteria Evaluator Node')
  console.log('═'.repeat(60))
  
  const syncB = new LoomDBSync(service, {
    debounceMs: 100,
    trackChanges: true,
    conflictResolution: 'last-write-wins',
    autoResolveConflicts: true
  })

  // Track changes from Node A
  const receivedFacts = new Set<string>()
  let remoteChanges = 0
  
  syncB.on('remote-change', (event) => {
    remoteChanges++
    if (event.change?.node?.type === NodeType.FACT) {
      receivedFacts.add(event.change.node.id)
      console.log(`  📥 Received fact from Node A: ${event.change.node.id}`)
    }
  })

  await syncB.startSync()
  console.log('✅ Sync started')

  // Wait for facts from Node A
  console.log('⏳ Waiting for facts from Node A...')
  await new Promise(resolve => setTimeout(resolve, 1500))
  
  console.log(`📊 Received ${receivedFacts.size} facts from Node A`)

  // Create evaluator agent
  await syncB.putNode({
    id: 'agent-evaluator',
    type: NodeType.AGENT,
    properties: {
      name: 'Claude Evaluator',
      model: 'claude-3-opus',
      role: 'criteria_evaluation'
    },
    metadata: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'node-b'
    }
  })
  console.log('🤖 Created evaluator agent')

  // Define evaluation criteria
  const criteria = [
    { id: 'rule-budget', name: 'Budget Alignment', target: '$2M-$3M' },
    { id: 'rule-timeline', name: 'Timeline Feasibility', target: '<24 months' },
    { id: 'rule-tech', name: 'Technology Stack', target: 'Modern ML frameworks' },
    { id: 'rule-compliance', name: 'Compliance Requirements', target: 'ISO/SOC certified' }
  ]

  for (const criterion of criteria) {
    await syncB.putNode({
      id: criterion.id,
      type: NodeType.RULE,
      properties: {
        name: criterion.name,
        target: criterion.target,
        evaluatedBy: 'agent-evaluator'
      },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'node-b'
      }
    })
  }

  console.log(`📋 Defined ${criteria.length} evaluation criteria`)

  // Evaluate each criterion
  const evaluations = [
    { ruleId: 'rule-budget', factId: 'fact-budget', status: 'PASS', score: 0.9, reasoning: 'Within target range' },
    { ruleId: 'rule-timeline', factId: 'fact-timeline', status: 'PASS', score: 0.85, reasoning: 'Reasonable timeline' },
    { ruleId: 'rule-tech', factId: 'fact-tech', status: 'PASS', score: 0.8, reasoning: 'Industry standard frameworks' },
    { ruleId: 'rule-compliance', factId: 'fact-compliance', status: 'CONDITIONAL', score: 0.7, reasoning: 'Needs verification' }
  ]

  for (const evaluation of evaluations) {
    const resultId = `result-${evaluation.ruleId}`
    
    await syncB.putNode({
      id: resultId,
      type: NodeType.STATE,
      properties: {
        status: evaluation.status,
        score: evaluation.score,
        reasoning: evaluation.reasoning,
        evaluatedBy: 'agent-evaluator'
      },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'node-b'
      }
    })

    // Link evaluation result to fact and rule
    await syncB.putEdge({
      id: `edge-fact-result-${resultId}`,
      from: evaluation.factId,
      to: resultId,
      type: EdgeType.RESULTED_IN,
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'node-b'
      }
    })

    await syncB.putEdge({
      id: `edge-rule-result-${resultId}`,
      from: evaluation.ruleId,
      to: resultId,
      type: EdgeType.DERIVES_FROM,
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'node-b'
      }
    })
  }

  console.log(`✅ Completed ${evaluations.length} evaluations`)
  console.log(`📡 Status: ${remoteChanges} remote changes received`)

  return syncB
}

/**
 * Main example execution
 */
async function main() {
  console.log('\n🚀 Multi-Node Criteria Evaluation with Real-Time Sync')
  console.log('═'.repeat(60))
  console.log('Scenario: Two nodes collaborate on project evaluation')
  console.log('  • Node A: Extracts data and creates facts')
  console.log('  • Node B: Evaluates criteria based on facts')
  console.log('  • Both sync changes in real-time via LoomMesh')
  console.log('═'.repeat(60))

  // Initialize shared LoomMesh service (simulates distributed network)
  const service = new LoomMeshService({
    peers: [],
    persistence: false,
    storage: {
      type: 'memory'
    }
  })
  await service.start()
  console.log('✅ LoomMesh service started')

  // Run both nodes concurrently
  console.log('\n📡 Starting multi-node processing...')
  
  const [syncA, syncB] = await Promise.all([
    runNodeA(service),
    runNodeB(service)
  ])

  // Wait for all changes to propagate
  await new Promise(resolve => setTimeout(resolve, 500))

  // Analyze the synchronized graph
  console.log('\n📊 Analyzing Synchronized Graph')
  console.log('═'.repeat(60))

  const store = syncA.getStore()
  const query = new LoomDBQueryEngine(store)

  // Query nodes by type
  const documents = await store.queryNodes({ type: NodeType.DOCUMENT })
  const agents = await store.queryNodes({ type: NodeType.AGENT })
  const facts = await store.queryNodes({ type: NodeType.FACT })
  const rules = await store.queryNodes({ type: NodeType.RULE })
  const results = await store.queryNodes({ type: NodeType.STATE })

  console.log(`📄 Documents: ${documents.length}`)
  console.log(`🤖 Agents: ${agents.length}`)
  console.log(`📊 Facts: ${facts.length}`)
  console.log(`📋 Rules: ${rules.length}`)
  console.log(`✅ Results: ${results.length}`)

  // Find paths from document to results
  console.log('\n🔍 Tracing Evaluation Flow')
  console.log('═'.repeat(60))
  
  const paths = await query.findPaths('doc-001', 'result-rule-budget', {
    maxDepth: 10,
    maxPaths: 1
  })

  if (paths.length > 0) {
    console.log(`Found evaluation path (${paths[0].length} steps):`)
    for (let i = 0; i < paths[0].length; i++) {
      const nodeId = paths[0][i]
      const node = await store.getNode(nodeId)
      const indent = '  '.repeat(i)
      if (node) {
        console.log(`${indent}→ ${node.type}: ${node.id}`)
      }
    }
  }

  // Export to D3.js for visualization
  console.log('\n📈 Exporting for Visualization')
  console.log('═'.repeat(60))
  
  const visualizer = new GraphVisualizer(store)
  const d3Graph = await visualizer.exportToD3({
    nodeLabel: (node) => node.properties.name || node.properties.title || node.id,
    nodeGroup: (node) => node.type,
    includeProperties: true
  })

  console.log(`📊 D3.js Export Complete:`)
  console.log(`   • Nodes: ${d3Graph.nodes.length}`)
  console.log(`   • Links: ${d3Graph.links.length}`)
  console.log(`   • Ready for force-directed graph visualization`)

  // Show sync statistics
  console.log('\n📡 Sync Statistics')
  console.log('═'.repeat(60))
  
  const statusA = syncA.getStatus()
  const statusB = syncB.getStatus()

  console.log('Node A:')
  console.log(`  • Active subscriptions: ${statusA.subscriptions}`)
  console.log(`  • Change history: ${statusA.changeHistory} events`)
  console.log(`  • Pending changes: ${statusA.pendingChanges}`)

  console.log('\nNode B:')
  console.log(`  • Active subscriptions: ${statusB.subscriptions}`)
  console.log(`  • Change history: ${statusB.changeHistory} events`)
  console.log(`  • Pending changes: ${statusB.pendingChanges}`)

  // Show change history from one node
  console.log('\n📜 Recent Change History (Node A):')
  console.log('═'.repeat(60))
  const history = syncA.getChangeHistory().slice(-5)
  for (const change of history) {
    const timestamp = new Date(change.timestamp).toISOString()
    const id = change.nodeId || change.edgeId
    console.log(`  ${timestamp} - ${change.type}: ${id}`)
  }

  // Cleanup
  console.log('\n🧹 Cleaning up...')
  await syncA.cleanup()
  await syncB.cleanup()
  await service.stop()

  console.log('\n' + '═'.repeat(60))
  console.log('✅ MULTI-NODE SYNC EXAMPLE COMPLETE')
  console.log('═'.repeat(60))
  console.log('\n💡 Key Benefits Demonstrated:')
  console.log('   ✓ Real-time synchronization across distributed nodes')
  console.log('   ✓ Event-driven architecture with change notifications')
  console.log('   ✓ Automatic conflict resolution')
  console.log('   ✓ Change history tracking for audit/replay')
  console.log('   ✓ Zero-configuration multi-node setup')
  console.log('   ✓ Complete visibility into graph evolution')
  
  console.log('\n🏁 Done!')
}

// Run the example
main().catch(console.error)
