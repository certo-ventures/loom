/**
 * Pipeline Demo with Real-Time Monitoring
 * 
 * Shows actual Redis messages flowing through BullMQ in real-time
 */

import { Redis } from 'ioredis'
import { BullMQMessageQueue } from '../src/storage/bullmq-message-queue'
import { InMemoryActorRegistry } from '../src/discovery'
import { PipelineOrchestrator } from '../src/pipelines/pipeline-orchestrator'
import { PipelineActorWorker } from '../src/pipelines/pipeline-actor-worker'
import { PipelineMonitor } from '../src/pipelines/pipeline-monitor'
import { PipelineDefinition } from '../src/pipelines/pipeline-dsl'

// ============================================================================
// Actor Implementations
// ============================================================================

class FileProcessorActor {
  async execute(input: { filepath: string }): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 100))
    
    const filename = input.filepath.split('/').pop()!
    const pageCount = Math.floor(Math.random() * 3) + 2  // 2-4 pages
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
    await new Promise(resolve => setTimeout(resolve, 50))
    
    const types = ['invoice', 'receipt', 'contract']
    const documentType = types[Math.floor(Math.random() * types.length)]
    
    return {
      filepath: input.filepath,
      pageNumber: input.pageNumber,
      documentType,
      confidence: 0.9
    }
  }
}

class DocumentConsolidatorActor {
  async execute(input: { group: { key: string; items: any[] } }): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 100))
    
    const { key: documentType, items } = input.group
    
    return {
      documentType,
      pageCount: items.length,
      pages: items.map(item => item.pageNumber).sort((a, b) => a - b)
    }
  }
}

class ReportGeneratorActor {
  async execute(input: { documents: any[] }): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 100))
    
    const totalPages = input.documents.reduce((sum, doc) => sum + doc.pageCount, 0)
    
    return {
      summary: `Processed ${input.documents.length} document types with ${totalPages} total pages`,
      documents: input.documents
    }
  }
}

// ============================================================================
// Pipeline Definition
// ============================================================================

const pipelineDef: PipelineDefinition = {
  name: 'document-processing-pipeline',
  description: 'Real distributed document processing with monitoring',
  
  stages: [
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
    {
      name: 'consolidate-documents',
      mode: 'gather',
      actor: 'DocumentConsolidator',
      gather: {
        stage: 'classify-pages',
        condition: 'all',
        groupBy: '$.documentType'
      },
      input: {
        group: '$.group'
      }
    },
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
  console.log('PIPELINE DEMO WITH REAL-TIME MONITORING')
  console.log('Watch actual Redis messages flow through BullMQ!')
  console.log('='.repeat(80))
  
  // Setup Redis
  const redis = new Redis('redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  })
  
  // Clear old data
  console.log('\n🧹 Cleaning up old pipeline data...')
  const oldKeys = await redis.keys('pipeline:*')
  if (oldKeys.length > 0) {
    await redis.del(...oldKeys)
    console.log(`   Deleted ${oldKeys.length} old keys`)
  }
  
  // Setup monitoring
  const monitor = new PipelineMonitor()
  
  console.log('\n📡 Setting up monitoring...')
  monitor.monitorQueue('actor-FileProcessor')
  monitor.monitorQueue('actor-PageClassifier')
  monitor.monitorQueue('actor-DocumentConsolidator')
  monitor.monitorQueue('actor-ReportGenerator')
  monitor.monitorQueue('pipeline-stage-results')
  
  // Show initial state
  await monitor.showRedisKeys('bull:actor-*')
  
  // Setup infrastructure
  const messageQueue = new BullMQMessageQueue(redis)
  const actorRegistry = new InMemoryActorRegistry()
  const orchestrator = new PipelineOrchestrator(messageQueue, actorRegistry, redis)
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
  worker.startWorker('PageClassifier', 3)
  worker.startWorker('DocumentConsolidator', 1)
  worker.startWorker('ReportGenerator', 1)
  
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Execute pipeline
  console.log('\n' + '='.repeat(80))
  console.log('🚀 EXECUTING PIPELINE')
  console.log('='.repeat(80))
  
  const triggerData = {
    files: [
      { path: '/uploads/document1.pdf' },
      { path: '/uploads/document2.pdf' }
    ]
  }
  
  const pipelineId = await orchestrator.execute(pipelineDef, triggerData)
  
  // Monitor pipeline state
  monitor.monitorPipelineState(pipelineId)
  
  // Wait for completion
  console.log('\n⏳ Watching messages flow...\n')
  await new Promise(resolve => setTimeout(resolve, 8000))
  
  // Show final stats
  console.log('\n' + '='.repeat(80))
  console.log('📊 FINAL QUEUE STATISTICS')
  console.log('='.repeat(80))
  
  await monitor.showQueueStats('actor-FileProcessor')
  await monitor.showQueueStats('actor-PageClassifier')
  await monitor.showQueueStats('actor-DocumentConsolidator')
  await monitor.showQueueStats('actor-ReportGenerator')
  await monitor.showQueueStats('pipeline-stage-results')
  
  // Show Redis keys
  await monitor.showRedisKeys('pipeline:*')
  await monitor.showRedisKeys('bull:*:completed')
  
  // Cleanup
  console.log('\n' + '='.repeat(80))
  console.log('🧹 Cleaning up...')
  await worker.close()
  await orchestrator.close()
  await monitor.close()
  await redis.quit()
  
  console.log('\n✅ Demo complete!')
  console.log('\nWhat you saw:')
  console.log('  ✓ Real BullMQ jobs added to Redis queues')
  console.log('  ✓ Workers pulling jobs and processing them')
  console.log('  ✓ Messages flowing through pipeline-stage-results queue')
  console.log('  ✓ Barrier synchronization (all tasks complete before next stage)')
  console.log('  ✓ Dynamic grouping by document type')
  console.log('  ✓ Pipeline state persisted in Redis')
  console.log('='.repeat(80))
  
  process.exit(0)
}

main().catch(error => {
  console.error('❌ Error:', error)
  process.exit(1)
})
