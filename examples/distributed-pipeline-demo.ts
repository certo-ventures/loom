/**
 * REAL Distributed Pipeline Demo
 * 
 * This demonstrates ACTUAL distributed execution:
 * - Redis message passing
 * - Real actor workers listening on queues
 * - True fan-out with work distribution
 * - Barrier synchronization via Redis
 * - Durable pipeline state
 * 
 * Shows the ACTUAL messages flowing through Redis!
 */

import { DistributedPipelineOrchestrator } from '../src/pipelines/distributed-pipeline-orchestrator'
import { DistributedWorkerPool } from '../src/pipelines/distributed-actor-worker'
import { PipelineDefinition } from '../src/pipelines/pipeline-dsl'

// ============================================================================
// Mock Actors (same interface, but these will be spawned by workers)
// ============================================================================

class FileProcessorActor {
  async execute(input: { filepath: string }): Promise<any> {
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Extract pages from file
    const filename = input.filepath.split('/').pop()!
    const pageCount = Math.floor(Math.random() * 5) + 2
    const pages = []
    
    for (let i = 1; i <= pageCount; i++) {
      pages.push({
        filepath: input.filepath,
        filename,
        pageNumber: i,
        content: `Content from ${filename} page ${i}`
      })
    }
    
    return { pages }
  }
}

class PageClassifierActor {
  async execute(input: { filepath: string; pageNumber: number; content: string }): Promise<any> {
    // Simulate classification
    await new Promise(resolve => setTimeout(resolve, 50))
    
    const types = ['invoice', 'receipt', 'contract', 'form', 'letter']
    const documentType = types[Math.floor(Math.random() * types.length)]
    
    return {
      filepath: input.filepath,
      pageNumber: input.pageNumber,
      documentType,
      confidence: 0.85 + Math.random() * 0.15
    }
  }
}

class DocumentConsolidatorActor {
  async execute(input: { group: { key: string; items: any[] } }): Promise<any> {
    // Simulate consolidation
    await new Promise(resolve => setTimeout(resolve, 150))
    
    const { key: documentType, items } = input.group
    
    return {
      documentType,
      pageCount: items.length,
      pages: items.map(item => item.pageNumber),
      consolidated: true,
      timestamp: new Date().toISOString()
    }
  }
}

class ReportGeneratorActor {
  async execute(input: { documents: any[] }): Promise<any> {
    // Simulate report generation
    await new Promise(resolve => setTimeout(resolve, 200))
    
    const totalPages = input.documents.reduce((sum, doc) => sum + doc.pageCount, 0)
    const typeBreakdown = input.documents.map(doc => ({
      type: doc.documentType,
      pages: doc.pageCount
    }))
    
    return {
      summary: `Processed ${input.documents.length} document types with ${totalPages} total pages`,
      typeBreakdown,
      timestamp: new Date().toISOString()
    }
  }
}

// ============================================================================
// Pipeline Definition
// ============================================================================

const pipelineDef: PipelineDefinition = {
  name: 'document-processing-pipeline',
  description: 'Distributed document processing with real Redis coordination',
  
  stages: [
    // Stage 1: Split files into pages (SCATTER)
    {
      name: 'split-pages',
      mode: 'scatter',
      actor: 'FileProcessor',
      scatter: {
        input: '$.files',  // Fan-out over input files
        as: 'file'
      },
      input: {
        filepath: '$.file.path'
      }
    },
    
    // Stage 2: Classify each page (SCATTER)
    {
      name: 'classify-pages',
      mode: 'scatter',
      actor: 'PageClassifier',
      scatter: {
        input: '$.stages["split-pages"][*].pages[*]',  // Fan-out over all pages
        as: 'page'
      },
      input: {
        filepath: '$.page.filepath',
        pageNumber: '$.page.pageNumber',
        content: '$.page.content'
      }
    },
    
    // Stage 3: Consolidate by document type (GATHER + GROUP)
    {
      name: 'consolidate-documents',
      mode: 'gather',
      actor: 'DocumentConsolidator',
      gather: {
        stage: 'classify-pages',
        condition: 'all',
        groupBy: '$.documentType'  // Group by classification
      },
      input: {
        group: '$.group'
      }
    },
    
    // Stage 4: Generate final report (SINGLE)
    {
      name: 'generate-report',
      mode: 'single',
      actor: 'ReportGenerator',
      input: {
        documents: '$.stages["consolidate-documents"]'
      }
    }
  ]
}

// ============================================================================
// Main Demo
// ============================================================================

async function main() {
  console.log('='.repeat(80))
  console.log('REAL DISTRIBUTED PIPELINE DEMO')
  console.log('Redis-backed execution with actual message passing')
  console.log('='.repeat(80))
  
  // Create worker pool
  const pool = new DistributedWorkerPool()
  
  // Register actor types
  pool.registerActor('FileProcessor', FileProcessorActor)
  pool.registerActor('PageClassifier', PageClassifierActor)
  pool.registerActor('DocumentConsolidator', DocumentConsolidatorActor)
  pool.registerActor('ReportGenerator', ReportGeneratorActor)
  
  // Spawn workers for each actor type
  console.log('\n🏭 Starting worker pool...')
  pool.spawnWorkers('FileProcessor', 2)      // 2 workers for file processing
  pool.spawnWorkers('PageClassifier', 4)     // 4 workers for page classification
  pool.spawnWorkers('DocumentConsolidator', 2)  // 2 workers for consolidation
  pool.spawnWorkers('ReportGenerator', 1)    // 1 worker for reporting
  
  // Give workers time to start
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Create orchestrator
  const orchestrator = new DistributedPipelineOrchestrator()
  
  // Execute pipeline
  const triggerData = {
    files: [
      { path: '/uploads/batch1/document1.pdf' },
      { path: '/uploads/batch1/document2.pdf' },
      { path: '/uploads/batch2/document3.pdf' }
    ]
  }
  
  console.log('\n' + '='.repeat(80))
  const pipelineId = await orchestrator.execute(pipelineDef, triggerData)
  
  // Wait for completion (in real system, would use event listeners)
  console.log('\n⏳ Waiting for pipeline to complete...')
  await new Promise(resolve => setTimeout(resolve, 5000))
  
  // Cleanup
  console.log('\n' + '='.repeat(80))
  console.log('Cleaning up...')
  await pool.stopAll()
  await orchestrator.close()
  
  console.log('\n✅ Demo complete!')
  console.log('\nWhat you just saw:')
  console.log('  ✓ Real Redis pub/sub for coordination')
  console.log('  ✓ Multiple workers listening on queues')
  console.log('  ✓ True distributed fan-out (scatter)')
  console.log('  ✓ Barrier synchronization with Redis')
  console.log('  ✓ Dynamic grouping and consolidation')
  console.log('  ✓ Durable state in Redis')
  console.log('='.repeat(80))
}

main().catch(console.error)
