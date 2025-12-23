/**
 * Document Processing Workflow
 * 
 * Demonstrates REAL workflow using pluggable executors:
 * 1. Upload files (scatter)
 * 2. Process to pages (scatter -> nested scatter)
 * 3. Classify pages (scatter)
 * 4. Extract data (scatter)
 * 5. Consolidate by document type (gather + groupBy) ← THE KEY PATTERN!
 */

import { PipelineDefinition } from '../src/pipelines/pipeline-dsl'

/**
 * COMPLETE WORKFLOW - Ready to execute!
 * 
 * This is what WDL would compile to.
 */
export const documentProcessingWorkflow: PipelineDefinition = {
  name: 'document-processing-workflow',
  description: 'Upload → Process → Classify → Extract → Consolidate by type',
  
  stages: [
    // ========================================================================
    // STAGE 1: File Upload (Scatter over uploaded files)
    // ========================================================================
    {
      name: 'upload-files',
      mode: 'scatter',
      actor: 'FileUploadWorker',
      scatter: {
        input: '$.trigger.files',  // Array of files or URLs
        as: 'file'
      },
      input: {
        fileRef: '$.file'  // Could be URL, path, or blob reference
      },
      executorConfig: {
        maxParallel: 5  // Limit upload concurrency
      }
    },
    
    // ========================================================================
    // STAGE 2: Document Processing - Split into Pages (Scatter)
    // ========================================================================
    {
      name: 'process-to-pages',
      mode: 'scatter',
      actor: 'DocumentProcessingWorker',
      scatter: {
        // Get all uploaded files from stage 1
        input: '$.stages["upload-files"][*]',
        as: 'uploadedFile'
      },
      input: {
        uploadId: '$.uploadedFile.uploadId',
        fileRef: '$.uploadedFile.storedRef',
        format: '$.uploadedFile.format'  // pdf, image, etc.
      },
      executorConfig: {
        maxParallel: 3  // Resource intensive (PDF processing)
      }
      // OUTPUT: Each returns { uploadId, pages: [{ pageNum, pngUrl, uploadId }] }
    },
    
    // ========================================================================
    // STAGE 3: Classify Pages (Scatter over ALL pages from ALL files)
    // ========================================================================
    {
      name: 'classify-pages',
      mode: 'scatter',
      actor: 'DocumentClassificationWorker',
      scatter: {
        // JSONPath: Get all pages from all processing results
        input: '$.stages["process-to-pages"][*].pages[*]',
        as: 'page'
      },
      input: {
        pageUrl: '$.page.pngUrl',
        pageNumber: '$.page.pageNum',
        uploadId: '$.page.uploadId'
      },
      executorConfig: {
        maxParallel: 10  // Many pages, can classify in parallel
      }
      // OUTPUT: { pageUrl, uploadId, pageNum, documentType: 'invoice' | 'receipt' | 'po' | 'other' }
    },
    
    // ========================================================================
    // STAGE 4: Extract Data from Classified Pages (Scatter)
    // ========================================================================
    {
      name: 'extract-data',
      mode: 'scatter',
      actor: 'DataExtractionWorker',
      scatter: {
        input: '$.stages["classify-pages"][*]',
        as: 'classifiedPage'
      },
      input: {
        pageUrl: '$.classifiedPage.pageUrl',
        uploadId: '$.classifiedPage.uploadId',
        pageNumber: '$.classifiedPage.pageNumber',
        documentType: '$.classifiedPage.documentType'
        // Worker will use documentType to load schema and build prompt
      },
      executorConfig: {
        maxParallel: 8  // LLM calls - limit concurrency
      }
      // OUTPUT: { uploadId, pageNum, documentType, extractedData: {...}, success: true/false }
    },
    
    // ========================================================================
    // STAGE 5: Consolidate by Document Type (Gather + GroupBy) ← THE KEY!
    // ========================================================================
    {
      name: 'consolidate-by-type',
      mode: 'gather',
      actor: 'DocumentConsolidationWorker',
      gather: {
        stage: 'extract-data',
        condition: 'all',  // Wait for all extractions
        groupBy: '$.documentType'  // ← Group by document type!
      },
      input: {
        // Each invocation gets ONE document type with ALL pages of that type
        group: '$.group'  // { key: 'invoice', items: [{...}, {...}] }
      },
      executorConfig: {
        timeout: 60000,  // 60 second timeout for barrier
        minResults: 1    // Need at least one extraction to consolidate
      }
      // OUTPUT: { documentType, consolidatedData: {...}, pageCount, successCount }
    },
    
    // ========================================================================
    // STAGE 6: Generate Final Report (Single)
    // ========================================================================
    {
      name: 'generate-report',
      mode: 'single',
      actor: 'ReportGenerator',
      input: {
        consolidations: '$.stages["consolidate-by-type"]',
        uploadCount: '$.stages["upload-files"].length',
        totalPages: '$.stages["classify-pages"].length'
      }
    }
  ]
}

/**
 * WDL-STYLE SYNTAX (Conceptual)
 * 
 * This is what a user might write, which would compile to the above:
 * 
 * workflow DocumentProcessing {
 *   input {
 *     Array[File] files
 *   }
 *   
 *   scatter (file in files) {
 *     call FileUploadWorker { input: fileRef = file }
 *   }
 *   
 *   scatter (upload in FileUploadWorker.outputs) {
 *     call DocumentProcessingWorker { 
 *       input: uploadId = upload.id, fileRef = upload.ref 
 *     }
 *   }
 *   
 *   # Flatten all pages from all documents
 *   Array[Page] allPages = flatten(DocumentProcessingWorker.outputs.pages)
 *   
 *   scatter (page in allPages) {
 *     call DocumentClassificationWorker { 
 *       input: pageUrl = page.url, pageNum = page.num 
 *     }
 *   }
 *   
 *   scatter (classified in DocumentClassificationWorker.outputs) {
 *     call DataExtractionWorker {
 *       input: 
 *         pageUrl = classified.pageUrl,
 *         documentType = classified.documentType
 *     }
 *   }
 *   
 *   # THE KEY: Group by document type and consolidate
 *   scatter (docType in ["invoice", "receipt", "po", "other"]) {
 *     Array[Extraction] pagesOfType = select_all(
 *       DataExtractionWorker.outputs, 
 *       lambda x: x.documentType == docType
 *     )
 *     
 *     call DocumentConsolidationWorker {
 *       input: 
 *         documentType = docType,
 *         extractions = pagesOfType
 *     }
 *   }
 *   
 *   call ReportGenerator {
 *     input: consolidations = DocumentConsolidationWorker.outputs
 *   }
 *   
 *   output {
 *     File report = ReportGenerator.report
 *   }
 * }
 */

/**
 * EXECUTION
 */
export async function runWorkflow() {
  // Import at runtime
  const { Redis } = await import('ioredis')
  const { BullMQMessageQueue } = await import('../src/storage/bullmq-message-queue')
  const { InMemoryActorRegistry } = await import('../src/discovery')
  const { PipelineOrchestrator } = await import('../src/pipelines/pipeline-orchestrator')
  const { PipelineActorWorker } = await import('../src/pipelines/pipeline-actor-worker')
  const { OutboxRelay } = await import('../src/pipelines/outbox')
  
  console.log('\n' + '='.repeat(80))
  console.log('DOCUMENT PROCESSING WORKFLOW')
  console.log('Demonstrating: Upload → Process → Classify → Extract → Consolidate')
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
  
  // Register distributed outbox workers (BullMQ handles distribution automatically)
  const outboxRelay = orchestrator['outboxRelay']
  outboxRelay.registerWorkers(5) // 5 concurrent workers (can scale across processes)
  console.log('📬 OutboxRelay workers registered (distributed via BullMQ)\n')
  
  // Register mock actors (in real system, these would be actual workers)
  worker.registerActor('FileUploadWorker', class {
    async execute(input: any) {
      console.log(`      📤 Uploading: ${input.fileRef.name}`)
      await new Promise(r => setTimeout(r, 100))
      return {
        uploadId: `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        storedRef: input.fileRef.url || input.fileRef.path,
        format: input.fileRef.name.endsWith('.pdf') ? 'pdf' : 'image',
        size: Math.floor(Math.random() * 5000000)
      }
    }
  })
  
  worker.registerActor('DocumentProcessingWorker', class {
    async execute(input: any) {
      console.log(`      📄 Processing ${input.format}: ${input.uploadId}`)
      await new Promise(r => setTimeout(r, 150))
      
      const pageCount = input.format === 'pdf' ? Math.floor(Math.random() * 8) + 3 : 1
      const pages = []
      
      for (let i = 1; i <= pageCount; i++) {
        pages.push({
          pageNum: i,
          pngUrl: `https://storage.example.com/${input.uploadId}/page-${i}.png`,
          uploadId: input.uploadId
        })
      }
      
      console.log(`         → ${pageCount} pages extracted`)
      return { uploadId: input.uploadId, pages }
    }
  })
  
  worker.registerActor('DocumentClassificationWorker', class {
    async execute(input: any) {
      console.log(`      🔍 Classifying page ${input.pageNumber} from ${input.uploadId}`)
      await new Promise(r => setTimeout(r, 80))
      
      const types = ['invoice', 'receipt', 'purchase-order', 'other']
      const documentType = types[Math.floor(Math.random() * types.length)]
      
      return {
        pageUrl: input.pageUrl,
        uploadId: input.uploadId,
        pageNumber: input.pageNumber,
        documentType,
        confidence: 0.85 + Math.random() * 0.15
      }
    }
  })
  
  worker.registerActor('DataExtractionWorker', class {
    async execute(input: any) {
      console.log(`      📊 Extracting data: ${input.documentType} page ${input.pageNumber}`)
      await new Promise(r => setTimeout(r, 120))
      
      // Schema-dependent extraction (would use LLM in real system)
      const schemas: any = {
        'invoice': { invoiceNumber: 'INV-' + Math.random().toString(36).substr(2, 6).toUpperCase(), amount: Math.floor(Math.random() * 10000) },
        'receipt': { merchant: 'Store ' + Math.floor(Math.random() * 100), total: Math.floor(Math.random() * 500) },
        'purchase-order': { poNumber: 'PO-' + Math.random().toString(36).substr(2, 6).toUpperCase(), items: Math.floor(Math.random() * 20) },
        'other': { text: 'Unstructured content' }
      }
      
      return {
        uploadId: input.uploadId,
        pageNumber: input.pageNumber,
        documentType: input.documentType,
        extractedData: schemas[input.documentType],
        success: Math.random() > 0.1  // 90% success rate
      }
    }
  })
  
  worker.registerActor('DocumentConsolidationWorker', class {
    async execute(input: any) {
      const { key: documentType, items } = input.group
      console.log(`      🎯 Consolidating ${documentType}: ${items.length} pages`)
      await new Promise(r => setTimeout(r, 200))
      
      const successful = items.filter((i: any) => i.success)
      const failed = items.filter((i: any) => !i.success)
      
      // Consolidate all extractions into authoritative schema
      const consolidatedData = successful.map((s: any) => s.extractedData)
      
      return {
        documentType,
        consolidatedData,
        pageCount: items.length,
        successCount: successful.length,
        failedCount: failed.length,
        uniqueUploads: new Set(items.map((i: any) => i.uploadId)).size
      }
    }
  })
  
  worker.registerActor('ReportGenerator', class {
    async execute(input: any) {
      console.log(`      📝 Generating final report`)
      await new Promise(r => setTimeout(r, 100))
      
      return {
        reportId: `RPT-${Date.now()}`,
        summary: {
          totalUploads: input.uploadCount,
          totalPages: input.totalPages,
          documentTypes: input.consolidations.length,
          consolidations: input.consolidations
        },
        timestamp: new Date().toISOString()
      }
    }
  })
  
  // Start workers
  console.log('\n🏭 Starting Worker Pool...')
  worker.startWorker('FileUploadWorker', 5)
  worker.startWorker('DocumentProcessingWorker', 3)
  worker.startWorker('DocumentClassificationWorker', 10)
  worker.startWorker('DataExtractionWorker', 8)
  worker.startWorker('DocumentConsolidationWorker', 3)
  worker.startWorker('ReportGenerator', 1)
  
  await new Promise(r => setTimeout(r, 1000))
  
  // Execute workflow
  console.log('\n' + '='.repeat(80))
  console.log('🚀 STARTING WORKFLOW')
  console.log('='.repeat(80))
  
  const pipelineId = await orchestrator.execute(documentProcessingWorkflow, {
    files: [
      { name: 'batch-invoices-2024-Q4.pdf', url: 'https://example.com/invoices.pdf' },
      { name: 'receipts-december.pdf', url: 'https://example.com/receipts.pdf' },
      { name: 'purchase-orders.pdf', url: 'https://example.com/pos.pdf' },
      { name: 'mixed-documents.pdf', url: 'https://example.com/mixed.pdf' }
    ]
  })
  
  console.log(`\n✅ Workflow started: ${pipelineId}`)
  console.log('\nStage Flow:')
  console.log('  1. 📤 Upload 4 files (scatter, max 5 parallel)')
  console.log('  2. 📄 Process to pages (scatter, max 3 parallel)')
  console.log('  3. 🔍 Classify all pages (scatter, max 10 parallel)')
  console.log('  4. 📊 Extract data from pages (scatter, max 8 parallel)')
  console.log('  5. 🎯 Consolidate by document type (gather + groupBy) ← BARRIER!')
  console.log('  6. 📝 Generate report (single)')
  console.log('\n⏳ Processing...\n')
  
  await new Promise(r => setTimeout(r, 10000))
  
  // Show results
  console.log('\n' + '='.repeat(80))
  console.log('📊 WORKFLOW RESULTS')
  console.log('='.repeat(80))
  
  const state = await redis.get(`pipeline:${pipelineId}:state`)
  if (state) {
    const data = JSON.parse(state)
    const stages = data.context.stages || {}
    
    console.log('\n✅ Stage Outputs:')
    
    if (stages['upload-files']) {
      console.log(`\n  1. upload-files: ${stages['upload-files'].length} files uploaded`)
    }
    
    if (stages['process-to-pages']) {
      const totalPages = stages['process-to-pages'].reduce((sum: number, p: any) => sum + p.pages.length, 0)
      console.log(`  2. process-to-pages: ${totalPages} pages extracted from ${stages['process-to-pages'].length} files`)
    }
    
    if (stages['classify-pages']) {
      const types = stages['classify-pages'].reduce((acc: any, p: any) => {
        acc[p.documentType] = (acc[p.documentType] || 0) + 1
        return acc
      }, {})
      console.log(`  3. classify-pages: ${stages['classify-pages'].length} pages classified`)
      Object.entries(types).forEach(([type, count]) => {
        console.log(`     - ${type}: ${count} pages`)
      })
    }
    
    if (stages['extract-data']) {
      const successful = stages['extract-data'].filter((e: any) => e.success).length
      console.log(`  4. extract-data: ${successful}/${stages['extract-data'].length} successful extractions`)
    }
    
    if (stages['consolidate-by-type']) {
      console.log(`  5. consolidate-by-type: ${stages['consolidate-by-type'].length} document types consolidated`)
      stages['consolidate-by-type'].forEach((c: any) => {
        console.log(`     - ${c.documentType}: ${c.successCount}/${c.pageCount} pages, ${c.uniqueUploads} uploads`)
      })
    }
    
    if (stages['generate-report']) {
      console.log(`  6. generate-report: ${stages['generate-report'][0].reportId}`)
    }
  }
  
  // Cleanup
  console.log('\n🧹 Cleaning up...')
  await worker.close()
  await orchestrator.close()
  await redis.quit()
  
  console.log('\n✅ WORKFLOW COMPLETE!')
  console.log('\n' + '='.repeat(80) + '\n')
  console.log('KEY FEATURES DEMONSTRATED:')
  console.log('  ✓ Multi-stage scatter (files → pages → classifications → extractions)')
  console.log('  ✓ JSONPath flattening (all pages from all files)')
  console.log('  ✓ Gather with groupBy (by document type)')
  console.log('  ✓ Barrier synchronization (wait for ALL pages before consolidate)')
  console.log('  ✓ Schema-dependent processing (documentType → extraction schema)')
  console.log('  ✓ Pluggable executors with configs')
  console.log('  ✓ Real distributed execution via BullMQ')
  console.log('  ✓ Transactional outbox pattern (exactly-once delivery)')
  console.log('  ✓ Distributed outbox workers (scale across processes)')
  console.log('='.repeat(80) + '\n')
  
  process.exit(0)
}

// Auto-run
runWorkflow().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
