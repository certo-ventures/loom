/**
 * REAL Pipeline Demo - Using actual BullMQ message queue
 * 
 * This shows:
 * - Real Redis message passing via BullMQ
 * - Actor workers processing messages
 * - Fan-out with scatter
 * - Barrier synchronization with gather
 * - Dynamic grouping
 */

import { Redis } from 'ioredis'
import { BullMQMessageQueue } from '../src/storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../src/discovery'
import { PipelineOrchestrator } from '../src/pipelines/pipeline-orchestrator'
import { PipelineActorWorker } from '../src/pipelines/pipeline-actor-worker'
import { PipelineDefinition } from '../src/pipelines/pipeline-dsl'

// ============================================================================
// Actor Implementations
// ============================================================================

class FileProcessorActor {
  async execute(input: { filepath: string }): Promise<any> {
    // Simulate file processing
    await new Promise(resolve => setTimeout(resolve, 100))
    
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
      pages: items.map(item => item.pageNumber).sort((a, b) => a - b),
      consolidated: true
    }
  }
}

class ReportGeneratorActor {
  async execute(input: { documents: any[] }): Promise<any> {
    // Simulate report generation
    await new Promise(resolve => setTimeout(resolve, 200))
    
    const totalPages = input.documents.reduce((sum, doc) => sum + doc.pageCount, 0)
    
    return {
      summary: `Processed ${input.documents.length} document types with ${totalPages} total pages`,
      documents: input.documents,
      timestamp: new Date().toISOString()
    }
  }
}

// ============================================================================
// Pipeline Definition
// ============================================================================

const pipelineDef: PipelineDefinition = {
  name: 'document-processing-pipeline',
  description: 'Real distributed document processing with BullMQ',
  
  stages: [
    // Stage 1: Split files into pages (SCATTER)
    {
      name: 'split-pages',
      mode: 'scatter',
      actor: 'FileProcessor',
      scatter: {
        input: '$.trigger.files',
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
        input: '$.stages["split-pages"][*].pages[*]',
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
        groupBy: '$.documentType'
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
  console.log('REAL DISTRIBUTED PIPELINE - Using BullMQ')
  console.log('='.repeat(80))
  
  // Setup Redis with BullMQ required options
  const redis = new Redis('redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  })
  
  // Setup BullMQ message queue
  const messageQueue = new BullMQMessageQueue(redis)
  
  // Setup actor registry
  const actorRegistry = new InMemoryActorRegistry()
  
  // Create orchestrator
  const orchestrator = new PipelineOrchestrator(messageQueue, actorRegistry, redis)
  
  // Create worker
  const worker = new PipelineActorWorker(messageQueue)
  
  // Register actors
  console.log('\n📦 Registering actors...')
  worker.registerActor('FileProcessor', FileProcessorActor)
  worker.registerActor('PageClassifier', PageClassifierActor)
  worker.registerActor('DocumentConsolidator', DocumentConsolidatorActor)
  worker.registerActor('ReportGenerator', ReportGeneratorActor)
  
  // Start workers
  console.log('\n🏭 Starting workers...')
  worker.startWorker('FileProcessor', 2)
  worker.startWorker('PageClassifier', 4)
  worker.startWorker('DocumentConsolidator', 2)
  worker.startWorker('ReportGenerator', 1)
  
  // Wait for workers to initialize
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Execute pipeline
  console.log('\n' + '='.repeat(80))
  const triggerData = {
    files: [
      { path: '/uploads/batch1/document1.pdf' },
      { path: '/uploads/batch1/document2.pdf' },
      { path: '/uploads/batch2/document3.pdf' }
    ]
  }
  
  const pipelineId = await orchestrator.execute(pipelineDef, triggerData)
  
  // Wait for completion
  console.log('\n⏳ Waiting for pipeline to complete...')
  await new Promise(resolve => setTimeout(resolve, 10000))
  
  // Cleanup
  console.log('\n' + '='.repeat(80))
  console.log('Cleaning up...')
  await worker.close()
  await orchestrator.close()
  await redis.quit()
  
  console.log('\n✅ Demo complete!')
  console.log('\nWhat you saw:')
  console.log('  ✓ Real BullMQ message queue (Redis-backed)')
  console.log('  ✓ Actor workers processing messages')
  console.log('  ✓ True fan-out with scatter')
  console.log('  ✓ Barrier synchronization with gather')
  console.log('  ✓ Dynamic grouping by document type')
  console.log('='.repeat(80))
  
  process.exit(0)
}

main().catch(error => {
  console.error('❌ Error:', error)
  process.exit(1)
})
