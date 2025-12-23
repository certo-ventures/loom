/**
 * Real-World Pipeline: Contract Analysis System
 * 
 * Uses multiple executor patterns:
 * - Scatter with parallelism limits
 * - Gather with grouping and timeout
 * - Broadcast for notifications
 * - Fork-Join for parallel validation/extraction
 */

import { Redis } from 'ioredis'
import { BullMQMessageQueue } from '../src/storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../src/discovery'
import { PipelineOrchestrator } from '../src/pipelines/pipeline-orchestrator'
import { PipelineActorWorker } from '../src/pipelines/pipeline-actor-worker'
import { PipelineDefinition } from '../src/pipelines/pipeline-dsl'

// ============================================================================
// Business Logic Actors
// ============================================================================

class PDFExtractorActor {
  async execute(input: { contractPath: string }) {
    console.log(`      📄 Extracting: ${input.contractPath}`)
    await new Promise(r => setTimeout(r, 80))
    
    // Simulate OCR/extraction
    const pages = Math.floor(Math.random() * 10) + 5
    const extracted = []
    
    for (let i = 1; i <= pages; i++) {
      extracted.push({
        contractPath: input.contractPath,
        pageNumber: i,
        text: `Page ${i} content from ${input.contractPath.split('/').pop()}`,
        confidence: 0.9 + Math.random() * 0.1
      })
    }
    
    return { contractPath: input.contractPath, pages: extracted }
  }
}

class ClauseDetectorActor {
  async execute(input: { contractPath: string; pageNumber: number; text: string }) {
    console.log(`      🔍 Detecting clauses: page ${input.pageNumber}`)
    await new Promise(r => setTimeout(r, 60))
    
    // Detect contract clauses
    const clauseTypes = ['payment', 'termination', 'liability', 'confidentiality', 'force-majeure']
    const detected = clauseTypes[Math.floor(Math.random() * clauseTypes.length)]
    
    return {
      contractPath: input.contractPath,
      pageNumber: input.pageNumber,
      clauseType: detected,
      text: input.text.substring(0, 100),
      confidence: 0.85 + Math.random() * 0.15
    }
  }
}

class ClauseAnalyzerActor {
  async execute(input: { group: { key: string; items: any[] } }) {
    console.log(`      📊 Analyzing ${input.group.key}: ${input.group.items.length} clauses`)
    await new Promise(r => setTimeout(r, 120))
    
    const { key: clauseType, items } = input.group
    
    // Analyze all clauses of this type
    const risks = items.map(item => ({
      page: item.pageNumber,
      contract: item.contractPath.split('/').pop(),
      riskLevel: Math.random() > 0.7 ? 'high' : Math.random() > 0.4 ? 'medium' : 'low'
    }))
    
    return {
      clauseType,
      totalClauses: items.length,
      risks,
      summary: `Found ${items.length} ${clauseType} clauses across ${new Set(items.map(i => i.contractPath)).size} contracts`
    }
  }
}

class RiskValidatorActor {
  async execute(input: { analyses: any[] }) {
    console.log(`      ✅ Validating risks`)
    await new Promise(r => setTimeout(r, 100))
    
    const highRiskClauses = input.analyses
      .flatMap(a => a.risks.filter((r: any) => r.riskLevel === 'high'))
    
    return {
      validated: true,
      highRiskCount: highRiskClauses.length,
      requiresReview: highRiskClauses.length > 5
    }
  }
}

class ComplianceCheckerActor {
  async execute(input: { analyses: any[] }) {
    console.log(`      📋 Checking compliance`)
    await new Promise(r => setTimeout(r, 100))
    
    const requiredClauses = ['payment', 'termination', 'liability']
    const foundTypes = new Set(input.analyses.map(a => a.clauseType))
    const missing = requiredClauses.filter(t => !foundTypes.has(t))
    
    return {
      compliant: missing.length === 0,
      missingClauses: missing,
      score: ((requiredClauses.length - missing.length) / requiredClauses.length) * 100
    }
  }
}

class ReportGeneratorActor {
  async execute(input: { validation: any; compliance: any; analyses: any[] }) {
    console.log(`      📝 Generating report`)
    await new Promise(r => setTimeout(r, 150))
    
    return {
      reportId: `RPT-${Date.now()}`,
      timestamp: new Date().toISOString(),
      summary: {
        totalClauses: input.analyses.reduce((sum, a) => sum + a.totalClauses, 0),
        clauseTypes: input.analyses.length,
        highRisks: input.validation.highRiskCount,
        complianceScore: input.compliance.score,
        requiresReview: input.validation.requiresReview
      },
      details: input.analyses
    }
  }
}

class EmailNotifierActor {
  async execute(input: { report: any }) {
    console.log(`      📧 Sending email notification`)
    await new Promise(r => setTimeout(r, 50))
    return { sent: 'email', to: 'legal@company.com', reportId: input.report.reportId }
  }
}

class SlackNotifierActor {
  async execute(input: { report: any }) {
    console.log(`      💬 Posting to Slack`)
    await new Promise(r => setTimeout(r, 50))
    return { sent: 'slack', channel: '#legal-alerts', reportId: input.report.reportId }
  }
}

class WebhookNotifierActor {
  async execute(input: { report: any }) {
    console.log(`      🔔 Triggering webhook`)
    await new Promise(r => setTimeout(r, 50))
    return { sent: 'webhook', url: 'https://api.company.com/alerts', reportId: input.report.reportId }
  }
}

// ============================================================================
// Pipeline Definition
// ============================================================================

const contractAnalysisPipeline: PipelineDefinition = {
  name: 'contract-analysis-system',
  description: 'Automated contract analysis with risk detection and compliance checking',
  
  stages: [
    // Stage 1: Extract pages from PDFs (Scatter with parallelism limit)
    {
      name: 'extract-pages',
      mode: 'scatter',
      actor: 'PDFExtractor',
      scatter: {
        input: '$.trigger.contracts',
        as: 'contract'
      },
      input: {
        contractPath: '$.contract.path'
      },
      executorConfig: {
        maxParallel: 3  // ← Limit to 3 PDFs at a time (resource intensive)
      }
    },
    
    // Stage 2: Detect clauses in all pages (Scatter - many workers)
    {
      name: 'detect-clauses',
      mode: 'scatter',
      actor: 'ClauseDetector',
      scatter: {
        input: '$.stages["extract-pages"][*].pages[*]',
        as: 'page'
      },
      input: {
        contractPath: '$.page.contractPath',
        pageNumber: '$.page.pageNumber',
        text: '$.page.text'
      },
      executorConfig: {
        maxParallel: 10  // ← Many pages, can process in parallel
      }
    },
    
    // Stage 3: Analyze clauses by type (Gather with grouping + timeout)
    {
      name: 'analyze-clauses',
      mode: 'gather',
      actor: 'ClauseAnalyzer',
      gather: {
        stage: 'detect-clauses',
        condition: 'all',  // Wait for all clauses
        groupBy: '$.clauseType'  // ← Group by clause type
      },
      input: {
        group: '$.group'
      },
      executorConfig: {
        timeout: 30000,  // ← 30 second timeout for barrier
        minResults: 1
      }
    },
    
    // Stage 4: Parallel validation and compliance (Fork-Join)
    {
      name: 'parallel-checks',
      mode: 'fork-join',
      actor: 'unused',
      input: {},
      executorConfig: {
        branches: [
          {
            name: 'risk-validation',
            actor: 'RiskValidator',
            input: { analyses: '$.stages["analyze-clauses"]' }
          },
          {
            name: 'compliance-check',
            actor: 'ComplianceChecker',
            input: { analyses: '$.stages["analyze-clauses"]' }
          }
        ]
      }
    },
    
    // Stage 5: Generate report (Single)
    {
      name: 'generate-report',
      mode: 'single',
      actor: 'ReportGenerator',
      input: {
        validation: '$.stages["parallel-checks"][0]',
        compliance: '$.stages["parallel-checks"][1]',
        analyses: '$.stages["analyze-clauses"]'
      }
    },
    
    // Stage 6: Notify all channels (Broadcast)
    {
      name: 'notify-stakeholders',
      mode: 'broadcast',
      actor: 'unused',
      input: {
        report: '$.stages["generate-report"][0]'
      },
      executorConfig: {
        actors: ['EmailNotifier', 'SlackNotifier', 'WebhookNotifier'],
        waitForAll: false  // ← Don't wait for notifications
      }
    }
  ]
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n' + '='.repeat(80))
  console.log('CONTRACT ANALYSIS SYSTEM')
  console.log('Real-world pipeline using pluggable executors')
  console.log('='.repeat(80))

  // Setup
  const redis = new Redis('redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  })

  const keys = await redis.keys('pipeline:*')
  if (keys.length > 0) await redis.del(...keys)

  const messageQueue = new BullMQMessageQueue(redis)
  const orchestrator = new PipelineOrchestrator(
    messageQueue,
    new InMemoryActorRegistry(),
    redis
  )
  const worker = new PipelineActorWorker(messageQueue)

  console.log('\n✅ Pluggable executors registered:')
  console.log('   • single')
  console.log('   • scatter (with maxParallel config)')
  console.log('   • gather (with groupBy + timeout)')
  console.log('   • fork-join (parallel branches)')
  console.log('   • broadcast (multiple actors)')

  // Register actors
  console.log('\n📦 Registering Business Logic Actors:')
  const actors = [
    ['PDFExtractor', PDFExtractorActor],
    ['ClauseDetector', ClauseDetectorActor],
    ['ClauseAnalyzer', ClauseAnalyzerActor],
    ['RiskValidator', RiskValidatorActor],
    ['ComplianceChecker', ComplianceCheckerActor],
    ['ReportGenerator', ReportGeneratorActor],
    ['EmailNotifier', EmailNotifierActor],
    ['SlackNotifier', SlackNotifierActor],
    ['WebhookNotifier', WebhookNotifierActor]
  ]
  actors.forEach(([name, cls]) => worker.registerActor(name as string, cls as any))

  // Start workers
  console.log('\n🏭 Starting Worker Pool:')
  console.log('   • PDFExtractor: 3 workers (resource intensive)')
  console.log('   • ClauseDetector: 10 workers (high volume)')
  console.log('   • ClauseAnalyzer: 3 workers (compute intensive)')
  console.log('   • Validators/Checkers: 2 workers each')
  console.log('   • Notifiers: 3 workers each')
  
  worker.startWorker('PDFExtractor', 3)
  worker.startWorker('ClauseDetector', 10)
  worker.startWorker('ClauseAnalyzer', 3)
  worker.startWorker('RiskValidator', 2)
  worker.startWorker('ComplianceChecker', 2)
  worker.startWorker('ReportGenerator', 1)
  worker.startWorker('EmailNotifier', 3)
  worker.startWorker('SlackNotifier', 3)
  worker.startWorker('WebhookNotifier', 3)

  await new Promise(r => setTimeout(r, 1000))

  // Execute
  console.log('\n' + '='.repeat(80))
  console.log('🚀 PROCESSING CONTRACTS')
  console.log('='.repeat(80))

  const pipelineId = await orchestrator.execute(contractAnalysisPipeline, {
    contracts: [
      { path: '/contracts/vendor-agreement-2024.pdf' },
      { path: '/contracts/service-contract-acme.pdf' },
      { path: '/contracts/nda-partner-xyz.pdf' }
    ]
  })

  console.log(`\n✅ Pipeline started: ${pipelineId}`)
  console.log('\nWorkflow:')
  console.log('  1. 📄 Extract pages (scatter, max 3 parallel)')
  console.log('  2. 🔍 Detect clauses (scatter, max 10 parallel)')
  console.log('  3. 📊 Analyze by type (gather + group by clause type)')
  console.log('  4. ⚡ Parallel: Risk validation + Compliance check (fork-join)')
  console.log('  5. 📝 Generate report (single)')
  console.log('  6. 📢 Notify all channels (broadcast)')
  console.log('\n⏳ Processing...\n')

  await new Promise(r => setTimeout(r, 8000))

  // Show results
  console.log('\n' + '='.repeat(80))
  console.log('📊 PIPELINE RESULTS')
  console.log('='.repeat(80))

  const state = await redis.get(`pipeline:${pipelineId}:state`)
  if (state) {
    const data = JSON.parse(state)
    const stages = data.context.stages || {}
    
    console.log('\n✅ Completed Stages:')
    Object.keys(stages).forEach((stage, i) => {
      const outputs = stages[stage]
      console.log(`   ${i + 1}. ${stage}: ${outputs.length} output(s)`)
    })
  }

  // Cleanup
  console.log('\n🧹 Cleaning up...')
  await worker.close()
  await orchestrator.close()
  await redis.quit()

  console.log('\n✅ CONTRACT ANALYSIS COMPLETE!\n')
  console.log('Demonstrated Features:')
  console.log('  ✓ Scatter with parallelism limits (3 PDFs, 10 pages)')
  console.log('  ✓ Gather with grouping by clause type')
  console.log('  ✓ Barrier synchronization (wait for all pages)')
  console.log('  ✓ Fork-Join for parallel validation/compliance')
  console.log('  ✓ Broadcast to multiple notification channels')
  console.log('  ✓ All executors pluggable and configurable!')
  console.log('='.repeat(80) + '\n')

  process.exit(0)
}

main().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
