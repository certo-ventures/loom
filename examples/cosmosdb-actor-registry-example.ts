/**
 * CosmosDB Actor Registry Example
 * 
 * Demonstrates:
 * 1. Registering actors with full metadata
 * 2. Versioning and revisions
 * 3. Publishing and deprecation workflows
 * 4. Querying and discovery
 * 5. Usage tracking
 * 6. Audit trails
 */

import { CosmosDBActorRegistry } from '../src/storage/cosmosdb-actor-registry'
import { ActorMetadata } from '../src/discovery/actor-metadata'
import { DefaultAzureCredential } from '@azure/identity'

async function main() {
  // Initialize CosmosDB registry
  const registry = new CosmosDBActorRegistry(
    process.env.COSMOS_ENDPOINT || 'https://your-account.documents.azure.com:443/',
    new DefaultAzureCredential(),
    'loom',
    'actors'
  )

  await registry.initialize()
  console.log('✅ CosmosDB registry initialized\n')

  // Example 1: Register new actor (draft)
  console.log('📝 Registering PDF Extractor v1.0.0...')
  
  const pdfExtractorV1: ActorMetadata = {
    name: 'PDF Extractor',
    description: 'Extracts text and images from PDF documents',
    type: 'javascript',
    reference: './actors/pdf-extractor.js',
    version: '1.0.0',
    author: 'Jane Smith',
    owner: 'Document Processing Team',
    contact: 'jane.smith@example.com',
    repository: 'https://github.com/example/pdf-extractor',
    license: 'MIT',
    
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['documentUrl'],
      properties: {
        documentUrl: {
          type: 'string',
          description: 'URL to PDF document'
        },
        extractImages: {
          type: 'boolean',
          default: false
        }
      }
    },
    
    outputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['success', 'text'],
      properties: {
        success: { type: 'boolean' },
        text: { type: 'string' },
        images: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    },
    
    tags: ['pdf', 'extraction', 'document-processing'],
    category: 'data-processing',
    
    lifecycle: {
      stage: 'experimental',
      createdAt: new Date().toISOString()
    }
  }

  const v1Doc = await registry.register(pdfExtractorV1, 'jane.smith@example.com', 'draft')
  console.log(`✅ Registered: ${v1Doc.id}`)
  console.log(`   Status: ${v1Doc.status}`)
  console.log(`   Revision: ${v1Doc.revision}\n`)

  // Example 2: Update and publish
  console.log('📢 Publishing v1.0.0 to production...')
  
  const v1Published = await registry.publish(
    'pdf-extractor',
    '1.0.0',
    1,
    'admin@example.com'
  )
  console.log(`✅ Published: ${v1Published.id}`)
  console.log(`   Published at: ${v1Published.publishedAt}\n`)

  // Example 3: Register new version with improvements
  console.log('🚀 Registering v2.0.0 with OCR support...')
  
  const pdfExtractorV2: ActorMetadata = {
    ...pdfExtractorV1,
    version: '2.0.0',
    description: 'Extracts text, images, and metadata from PDF documents with OCR support',
    
    aiContext: {
      purpose: 'Extract structured data from PDFs including OCR for scanned documents',
      usageGuidelines: 'Use for text extraction, table parsing, and OCR on scanned PDFs',
      capabilities: [
        {
          name: 'extractText',
          description: 'Extract text with OCR',
          parameters: {
            type: 'object',
            properties: {
              ocrLanguage: { type: 'string', enum: ['eng', 'fra', 'deu'] }
            }
          }
        }
      ],
      limitations: [
        'Maximum file size: 100MB',
        'OCR languages: English, French, German'
      ],
      bestPractices: [
        'Check file size before processing',
        'Use appropriate OCR language'
      ]
    },
    
    permissions: {
      system: ['fs:read', 'network:http'],
      storage: [
        { type: 's3', operations: ['read'] }
      ]
    },
    
    policies: {
      authentication: 'jwt',
      authorization: {
        roles: ['document-processor', 'admin'],
        scopes: ['documents:read']
      },
      rateLimit: {
        requestsPerMinute: 60
      },
      dataClassification: 'confidential',
      piiHandling: true
    },
    
    performance: {
      latency: {
        p50: 2000,
        p95: 5000,
        p99: 10000,
        unit: 'ms'
      },
      resources: {
        cpu: '2 cores',
        memory: '2GB'
      }
    },
    
    lifecycle: {
      stage: 'beta',
      backwardCompatible: false,
      breakingChanges: ['OCR requires new configuration parameter'],
      createdAt: new Date().toISOString()
    },
    
    quality: {
      testCoverage: 85,
      maintainabilityIndex: 78,
      lastAudit: new Date().toISOString(),
      auditStatus: 'passed'
    },
    
    security: {
      vulnerabilities: {
        critical: 0,
        high: 0,
        medium: 1,
        low: 3
      },
      lastScan: new Date().toISOString(),
      scanTool: 'snyk',
      compliant: true
    },
    
    business: {
      costCenter: 'DOC-PROC-001',
      businessOwner: 'John Doe',
      serviceLevel: 'high'
    },
    
    testing: {
      unitTestsPass: true,
      integrationTestsPass: true,
      e2eTestsPass: true,
      lastTestRun: new Date().toISOString(),
      testFramework: 'vitest'
    }
  }

  const v2Doc = await registry.register(pdfExtractorV2, 'jane.smith@example.com', 'draft')
  console.log(`✅ Registered: ${v2Doc.id}`)
  console.log(`   Previous version: ${v2Doc.previousVersion}`)
  console.log(`   Revision: ${v2Doc.revision}\n`)

  // Example 4: Deprecate old version
  console.log('⚠️  Deprecating v1.0.0...')
  
  const v1Deprecated = await registry.deprecate(
    'pdf-extractor',
    '1.0.0',
    1,
    'pdf-extractor:2.0.0',
    'admin@example.com'
  )
  console.log(`✅ Deprecated: ${v1Deprecated.id}`)
  console.log(`   Deprecated at: ${v1Deprecated.deprecatedAt}`)
  console.log(`   Replaced by: ${v1Deprecated.metadata.lifecycle?.replacedBy}\n`)

  // Example 5: Query actors
  console.log('🔍 Searching for document processing actors...')
  
  const results = await registry.search({
    category: 'data-processing',
    status: 'published'
  })
  console.log(`Found ${results.length} actors:`)
  results.forEach(actor => {
    console.log(`  - ${actor.metadata.name} v${actor.version} (${actor.status})`)
  })
  console.log()

  // Example 6: Get latest version
  console.log('📦 Getting latest published version...')
  
  const latest = await registry.getLatest('pdf-extractor')
  if (latest) {
    console.log(`Latest: ${latest.metadata.name} v${latest.version}`)
    console.log(`  Published: ${latest.publishedAt}`)
    console.log(`  Revision: ${latest.revision}`)
  }
  console.log()

  // Example 7: Record usage
  console.log('📊 Recording usage statistics...')
  
  for (let i = 0; i < 100; i++) {
    await registry.recordUsage('pdf-extractor', '2.0.0', 1, {
      latencyMs: 1500 + Math.random() * 2000,
      success: Math.random() > 0.05 // 95% success rate
    })
  }
  console.log('✅ Recorded 100 invocations\n')

  // Example 8: Get analytics
  console.log('📈 Usage analytics:')
  
  const analytics = await registry.getUsageAnalytics('pdf-extractor')
  console.log(`  Total invocations: ${analytics.totalInvocations}`)
  console.log(`  Avg latency: ${analytics.avgLatency.toFixed(2)}ms`)
  console.log(`  Success rate: ${(analytics.successRate * 100).toFixed(2)}%`)
  console.log('  By version:')
  for (const [version, count] of Object.entries(analytics.byVersion)) {
    console.log(`    ${version}: ${count} invocations`)
  }
  console.log()

  // Example 9: Version history
  console.log('📜 Version history:')
  
  const versions = await registry.getVersions('pdf-extractor')
  versions.forEach(v => {
    console.log(`  v${v.version}.${v.revision} (${v.status})`)
    console.log(`    Registered: ${v.registeredAt}`)
    console.log(`    By: ${v.registeredBy}`)
    if (v.usageStats) {
      console.log(`    Invocations: ${v.usageStats.totalInvocations}`)
    }
  })
  console.log()

  // Example 10: Query by capabilities
  console.log('🔎 Finding actors with OCR capability...')
  
  const allActors = await registry.search({ category: 'data-processing' })
  const withOCR = allActors.filter(actor => 
    actor.metadata.aiContext?.capabilities?.some(cap => 
      cap.name.toLowerCase().includes('ocr') || 
      cap.description.toLowerCase().includes('ocr')
    )
  )
  console.log(`Found ${withOCR.length} actors with OCR:`)
  withOCR.forEach(actor => {
    console.log(`  - ${actor.metadata.name}`)
  })
  console.log()

  console.log('✅ All examples completed!')
  console.log('\n💡 Key features demonstrated:')
  console.log('  ✓ Actor registration with full metadata')
  console.log('  ✓ Versioning and revision tracking')
  console.log('  ✓ Publishing and deprecation workflows')
  console.log('  ✓ Audit trails (who, when, why)')
  console.log('  ✓ Usage tracking and analytics')
  console.log('  ✓ Discovery by tags, category, capabilities')
  console.log('  ✓ JSON Schema for input/output validation')
  console.log('  ✓ Security policies and permissions')
  console.log('  ✓ Quality and testing metrics')
  console.log('  ✓ Business metadata')
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error)
}

export { main }
