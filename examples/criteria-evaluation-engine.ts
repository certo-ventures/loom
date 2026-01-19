/**
 * Criteria Evaluation Engine Example
 * 
 * Demonstrates using LoomDB to model a multi-LLM pipeline that:
 * 1. Extracts information from PDF documents
 * 2. Evaluates a list of criteria across the extracted data
 * 3. Tracks the evaluation workflow and results
 */

import { LoomMeshService } from '../src/services/loommesh/loommesh-service'
import { LoomDBStore } from '../src/services/loommesh/loomdb-store'
import { LoomDBQueryEngine } from '../src/services/loommesh/loomdb-query-engine'
import { LoomDBTransaction } from '../src/services/loommesh/loomdb-transaction'
import { GraphVisualizer } from '../src/services/loommesh/graph-visualizer'
import { createNode, createEdge, NodeType, EdgeType } from '../src/services/loommesh/graph-model'

async function main() {
  console.log('🚀 Criteria Evaluation Engine Example\n')

  // Initialize LoomDB
  const service = new LoomMeshService({ storage: { type: 'memory' } })
  await service.start()
  
  const store = new LoomDBStore(service)
  const queryEngine = new LoomDBQueryEngine(store)
  const visualizer = new GraphVisualizer(store)

  console.log('✅ LoomDB initialized\n')

  // ========================================
  // STEP 1: Create Document Processing Pipeline
  // ========================================
  console.log('📄 Step 1: Creating document processing pipeline...')

  await LoomDBTransaction.execute(store, async (txn) => {
    // Create PDF document node
    await txn.putNode(createNode('doc-rfp-2024', NodeType.DOCUMENT, {
      name: 'Government RFP 2024-Q1',
      type: 'pdf',
      path: '/documents/rfp-2024-q1.pdf',
      pages: 45,
      uploadedAt: Date.now()
    }))

    // Create extraction agent (LLM 1 - GPT-4)
    await txn.putNode(createNode('agent-extractor', NodeType.AGENT, {
      name: 'Document Extractor',
      llm: 'gpt-4',
      role: 'Extract structured data from documents',
      temperature: 0.1
    }))

    // Create evaluation agent (LLM 2 - Claude)
    await txn.putNode(createNode('agent-evaluator', NodeType.AGENT, {
      name: 'Criteria Evaluator',
      llm: 'claude-3',
      role: 'Evaluate criteria compliance',
      temperature: 0.2
    }))

    // Create synthesis agent (LLM 3 - GPT-4)
    await txn.putNode(createNode('agent-synthesizer', NodeType.AGENT, {
      name: 'Report Synthesizer',
      llm: 'gpt-4',
      role: 'Generate final evaluation report',
      temperature: 0.3
    }))

    // Define workflow edges
    await txn.putEdge(createEdge('e1', 'doc-rfp-2024', 'agent-extractor', EdgeType.SENDS_TO))
    await txn.putEdge(createEdge('e2', 'agent-extractor', 'agent-evaluator', EdgeType.PRECEDES))
    await txn.putEdge(createEdge('e3', 'agent-evaluator', 'agent-synthesizer', EdgeType.PRECEDES))
  })

  console.log('✅ Pipeline created: Document → Extractor → Evaluator → Synthesizer\n')

  // ========================================
  // STEP 2: Create Extracted Data Facts
  // ========================================
  console.log('📊 Step 2: Recording extracted data...')

  await LoomDBTransaction.execute(store, async (txn) => {
    // Extracted facts from the document
    await txn.putNode(createNode('fact-budget', NodeType.FACT, {
      name: 'Budget Amount',
      value: '$2.5M',
      confidence: 0.95,
      extractedBy: 'agent-extractor',
      extractedAt: Date.now()
    }))

    await txn.putNode(createNode('fact-timeline', NodeType.FACT, {
      name: 'Project Timeline',
      value: '18 months',
      confidence: 0.92,
      extractedBy: 'agent-extractor',
      extractedAt: Date.now()
    }))

    await txn.putNode(createNode('fact-tech-stack', NodeType.FACT, {
      name: 'Required Technology Stack',
      value: 'Cloud-native, Kubernetes, Python, React',
      confidence: 0.88,
      extractedBy: 'agent-extractor',
      extractedAt: Date.now()
    }))

    await txn.putNode(createNode('fact-compliance', NodeType.FACT, {
      name: 'Compliance Requirements',
      value: 'NIST 800-53, SOC2 Type II, FedRAMP',
      confidence: 0.94,
      extractedBy: 'agent-extractor',
      extractedAt: Date.now()
    }))

    // Link facts to extractor
    await txn.putEdge(createEdge('e4', 'agent-extractor', 'fact-budget', EdgeType.RESULTED_IN))
    await txn.putEdge(createEdge('e5', 'agent-extractor', 'fact-timeline', EdgeType.RESULTED_IN))
    await txn.putEdge(createEdge('e6', 'agent-extractor', 'fact-tech-stack', EdgeType.RESULTED_IN))
    await txn.putEdge(createEdge('e7', 'agent-extractor', 'fact-compliance', EdgeType.RESULTED_IN))
  })

  console.log('✅ Extracted 4 facts from document\n')

  // ========================================
  // STEP 3: Define Evaluation Criteria
  // ========================================
  console.log('📋 Step 3: Defining evaluation criteria...')

  await LoomDBTransaction.execute(store, async (txn) => {
    // Define criteria that need to be evaluated
    await txn.putNode(createNode('criteria-budget-fit', NodeType.RULE, {
      name: 'Budget Alignment',
      description: 'Does our capability fit within the stated budget?',
      priority: 'high',
      weight: 0.3
    }))

    await txn.putNode(createNode('criteria-timeline-feasible', NodeType.RULE, {
      name: 'Timeline Feasibility',
      description: 'Can we deliver within the required timeline?',
      priority: 'high',
      weight: 0.25
    }))

    await txn.putNode(createNode('criteria-tech-match', NodeType.RULE, {
      name: 'Technology Match',
      description: 'Do we have expertise in required technologies?',
      priority: 'medium',
      weight: 0.25
    }))

    await txn.putNode(createNode('criteria-compliance-ready', NodeType.RULE, {
      name: 'Compliance Readiness',
      description: 'Do we meet all compliance requirements?',
      priority: 'critical',
      weight: 0.2
    }))

    // Link criteria to facts they depend on
    await txn.putEdge(createEdge('e8', 'criteria-budget-fit', 'fact-budget', EdgeType.DEPENDS_ON))
    await txn.putEdge(createEdge('e9', 'criteria-timeline-feasible', 'fact-timeline', EdgeType.DEPENDS_ON))
    await txn.putEdge(createEdge('e10', 'criteria-tech-match', 'fact-tech-stack', EdgeType.DEPENDS_ON))
    await txn.putEdge(createEdge('e11', 'criteria-compliance-ready', 'fact-compliance', EdgeType.DEPENDS_ON))
  })

  console.log('✅ Defined 4 evaluation criteria\n')

  // ========================================
  // STEP 4: Run Evaluation and Record Results
  // ========================================
  console.log('🔍 Step 4: Running evaluations...')

  await LoomDBTransaction.execute(store, async (txn) => {
    // Create evaluation result nodes
    await txn.putNode(createNode('result-budget', NodeType.STATE, {
      name: 'Budget Evaluation Result',
      criteriaId: 'criteria-budget-fit',
      status: 'pass',
      score: 0.85,
      reasoning: 'Our solution can be delivered for $2.2M, within budget',
      evaluatedBy: 'agent-evaluator',
      evaluatedAt: Date.now()
    }))

    await txn.putNode(createNode('result-timeline', NodeType.STATE, {
      name: 'Timeline Evaluation Result',
      criteriaId: 'criteria-timeline-feasible',
      status: 'pass',
      score: 0.75,
      reasoning: 'We can deliver in 16 months with proper staffing',
      evaluatedBy: 'agent-evaluator',
      evaluatedAt: Date.now()
    }))

    await txn.putNode(createNode('result-tech', NodeType.STATE, {
      name: 'Technology Evaluation Result',
      criteriaId: 'criteria-tech-match',
      status: 'pass',
      score: 0.95,
      reasoning: 'Strong expertise in all required technologies',
      evaluatedBy: 'agent-evaluator',
      evaluatedAt: Date.now()
    }))

    await txn.putNode(createNode('result-compliance', NodeType.STATE, {
      name: 'Compliance Evaluation Result',
      criteriaId: 'criteria-compliance-ready',
      status: 'conditional',
      score: 0.60,
      reasoning: 'Have SOC2, need to obtain FedRAMP (6-month process)',
      evaluatedBy: 'agent-evaluator',
      evaluatedAt: Date.now()
    }))

    // Link evaluations
    await txn.putEdge(createEdge('e12', 'agent-evaluator', 'result-budget', EdgeType.RESULTED_IN))
    await txn.putEdge(createEdge('e13', 'agent-evaluator', 'result-timeline', EdgeType.RESULTED_IN))
    await txn.putEdge(createEdge('e14', 'agent-evaluator', 'result-tech', EdgeType.RESULTED_IN))
    await txn.putEdge(createEdge('e15', 'agent-evaluator', 'result-compliance', EdgeType.RESULTED_IN))

    await txn.putEdge(createEdge('e16', 'result-budget', 'criteria-budget-fit', EdgeType.DERIVES_FROM))
    await txn.putEdge(createEdge('e17', 'result-timeline', 'criteria-timeline-feasible', EdgeType.DERIVES_FROM))
    await txn.putEdge(createEdge('e18', 'result-tech', 'criteria-tech-match', EdgeType.DERIVES_FROM))
    await txn.putEdge(createEdge('e19', 'result-compliance', 'criteria-compliance-ready', EdgeType.DERIVES_FROM))
  })

  console.log('✅ Completed 4 evaluations\n')

  // ========================================
  // STEP 5: Generate Final Report
  // ========================================
  console.log('📝 Step 5: Generating final report...')

  await LoomDBTransaction.execute(store, async (txn) => {
    await txn.putNode(createNode('report-final', NodeType.DOCUMENT, {
      name: 'Final Evaluation Report',
      type: 'report',
      overallScore: 0.79,
      recommendation: 'PURSUE WITH CONDITIONS',
      summary: 'Strong technical and budget fit. Timeline is feasible. Must address FedRAMP compliance.',
      generatedBy: 'agent-synthesizer',
      generatedAt: Date.now()
    }))

    // Link report to results
    await txn.putEdge(createEdge('e20', 'result-budget', 'report-final', EdgeType.RESULTED_IN))
    await txn.putEdge(createEdge('e21', 'result-timeline', 'report-final', EdgeType.RESULTED_IN))
    await txn.putEdge(createEdge('e22', 'result-tech', 'report-final', EdgeType.RESULTED_IN))
    await txn.putEdge(createEdge('e23', 'result-compliance', 'report-final', EdgeType.RESULTED_IN))
  })

  console.log('✅ Final report generated\n')

  // Wait for GUN to persist
  await new Promise(resolve => setTimeout(resolve, 500))

  // ========================================
  // STEP 6: Query the Knowledge Graph
  // ========================================
  console.log('🔎 Step 6: Querying the knowledge graph...\n')

  const facts = await store.queryNodes({ type: NodeType.FACT })
  console.log(`📊 Found ${facts.length} extracted facts:`)
  facts.forEach(fact => {
    console.log(`   • ${fact.properties.name}: ${fact.properties.value} (${fact.properties.confidence})`)
  })
  console.log()

  const criteria = await store.queryNodes({ type: NodeType.RULE })
  console.log(`📋 Found ${criteria.length} evaluation criteria:`)
  criteria.forEach(criterion => {
    console.log(`   • ${criterion.properties.name} (weight: ${criterion.properties.weight})`)
  })
  console.log()

  const results = await store.queryNodes({ type: NodeType.STATE })
  console.log(`✅ Found ${results.length} evaluation results:`)
  results.forEach(result => {
    const status = result.properties.status ? result.properties.status.toUpperCase() : 'UNKNOWN'
    console.log(`   • ${result.properties.name}: ${status} (${result.properties.score})`)
  })
  console.log()

  // ========================================
  // STEP 7: Export for Visualization
  // ========================================
  console.log('📊 Step 7: Exporting for visualization...\n')

  const d3Graph = await visualizer.exportToD3({
    includeNodeProperties: true,
    nodeLabel: (node) => node.properties.name || node.id,
    nodeGroup: (node) => node.type
  })

  console.log(`📈 D3.js Export: ${d3Graph.nodes.length} nodes, ${d3Graph.links.length} links`)
  console.log('💾 Ready for D3.js force-directed graph visualization\n')

  // ========================================
  // Summary
  // ========================================
  console.log('='.repeat(60))
  console.log('✅ CRITERIA EVALUATION ENGINE COMPLETE')
  console.log('='.repeat(60))
  console.log('\nBenefits of LoomDB:')
  console.log('  ✓ Track complete evaluation workflow')
  console.log('  ✓ Query relationships between documents, facts, and criteria')
  console.log('  ✓ Atomic transactions ensure data consistency')
  console.log('  ✓ Export to D3.js for visual analysis')
  console.log('  ✓ Time-travel to see evaluation history\n')

  await service.stop()
  console.log('🏁 Done!')
}

main().catch(console.error)
