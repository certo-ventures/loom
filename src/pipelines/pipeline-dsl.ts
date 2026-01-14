/**
 * Loom Pipeline DSL - Declarative Pipeline Definition
 * 
 * Inspired by WDL (Workflow Description Language) but for actor orchestration
 * 
 * Features:
 * - Declarative stage definitions
 * - Automatic fan-out (scatter)
 * - Barrier synchronization (gather)
 * - Dynamic actor spawning
 * - Message routing
 * - State management
 */

// ============================================================================
// Pipeline DSL Types
// ============================================================================

/**
 * Strategy-based actor selection
 * Allows choosing actor at runtime based on conditions
 */
export interface ActorStrategy {
  // Strategy expression (ternary): $.fileSize > 1000000 ? "BlobStorage" : "CosmosStorage"
  strategy: string
  
  // Or explicit mappings
  when?: Array<{
    condition: string
    actor: string
  }>
  default?: string  // Fallback actor if no conditions match
}

export interface PipelineDefinition {
  name: string
  version?: string
  description?: string
  
  // Input trigger (optional - can be executed directly)
  trigger?: TriggerDefinition
  
  // Pipeline stages
  stages: StageDefinition[]
  
  // Global configuration
  config?: {
    maxConcurrency?: number
    timeout?: number
    retryPolicy?: RetryPolicy
  }
}

export interface TriggerDefinition {
  type: 'event' | 'webhook' | 'schedule' | 'manual'
  event?: string  // Event name to listen for
  webhook?: string  // Webhook path
  schedule?: string  // Cron expression
}

export interface StageDefinition {
  name: string
  actor: string | ActorStrategy  // Actor type OR strategy-based selection
  
  // Execution mode (extensible via executor registry)
  mode: 'single' | 'scatter' | 'gather' | 'map-reduce' | 'broadcast' | 'fork-join' | 'human-approval' | string

  // Optional explicit dependencies (stage names this stage waits on)
  dependsOn?: string | string[]
  
  // Executor-specific configuration
  executorConfig?: Record<string, any>  // Type-safe configs per executor
  
  // For scatter mode: what to fan-out over
  scatter?: {
    input: string  // JMESPath expression to array (e.g., "stages.parse[0].pages")
    as: string  // Variable name for each item
    condition?: string  // Optional filter: JMESPath expression (e.g., "[?status != 'processed']")
  }
  
  // For gather mode: what to wait for
  gather?: {
    stage: string | string[]  // Single stage or multiple stages to gather from
    condition?: 'all' | 'any' | 'count'  // Default: 'all'
    count?: number  // For 'count' condition
    groupBy?: string  // Group results by field
    combine?: 'concat' | 'object'  // How to combine multi-stage results (default: 'concat')
  }
  
  // Input mapping (JMESPath expressions or static values)
  // Examples:
  //   fileUrl: "trigger.fileUrl"
  //   pages: "stages.extract[0].pages"
  //   content: "stages.detect[0].pdfType == 'text' && stages.extractText[0].text || stages.extractImages[0].imageUrls"
  input: Record<string, string | any>
  
  // Output mapping (what to emit for next stages)
  output?: Record<string, string>
  
  // Conditional execution (JMESPath boolean expression)
  // Examples:
  //   "stages.detect[0].pdfType == 'text'"
  //   "trigger.fileSize < `10000000` && trigger.valid"
  //   "length(stages.classify[?confidence > `0.8`]) > `0`"
  when?: string
  
  // Stage configuration
  config?: {
    concurrency?: number
    timeout?: number
    retryPolicy?: RetryPolicy
    leaseTtlMs?: number
    initialDelayMs?: number
    deadLetterQueue?: string
  }
  
  // NEW: Retry configuration (maps to BullMQ job options)
  retry?: StageRetryPolicy
  
  // NEW: Circuit breaker configuration
  circuitBreaker?: {
    failureThreshold: number  // Open circuit after N failures
    timeout: number           // Time to wait before half-open (ms)
    halfOpenRequests?: number // Number of requests to test in half-open state
  }
  
  // NEW: Saga compensation for rollback
  compensation?: {
    actor: string             // Actor to execute on rollback
    input: any                // JSONPath or static data
    condition?: string        // Optional condition
  }
  
  // NEW: Human approval configuration
  humanApproval?: {
    assignTo: string | string[]
    timeout: number           // How long to wait for decision (ms)
    fallback: 'auto-approve' | 'auto-reject' | 'escalate'
    webhookUrl?: string       // Optional webhook to notify
  }
}

export interface RetryPolicy {
  maxAttempts: number
  backoff: 'linear' | 'exponential'
  initialDelay: number
  maxDelay?: number
}

export interface StageRetryPolicy {
  maxAttempts: number
  backoff?: 'fixed' | 'exponential' | 'linear'
  backoffDelay?: number
  maxBackoffDelay?: number
}

// ============================================================================
// Example: Document Processing Pipeline
// ============================================================================

export const DOCUMENT_PROCESSING_PIPELINE: PipelineDefinition = {
  name: 'DocumentProcessing',
  version: '1.0',
  description: 'Process uploaded documents with classification and extraction',
  
  trigger: {
    type: 'event',
    event: 'FileSetUploaded'
  },
  
  stages: [
    // Stage 1: Split files into pages (SCATTER - fan-out over files)
    {
      name: 'SplitFiles',
      actor: 'FileProcessorActor',
      mode: 'scatter',
      scatter: {
        input: '$.files',  // JSONPath to array of files
        as: 'file'  // Each file becomes 'file' variable
      },
      input: {
        fileId: '$.file.fileId',
        fileName: '$.file.fileName',
        path: '$.file.path'
      },
      output: {
        pages: '$.pages'  // Array of page objects
      },
      config: {
        concurrency: 10,  // Process up to 10 files in parallel
        timeout: 60000
      }
    },
    
    // Stage 2: Classify pages (SCATTER - fan-out over all pages from all files)
    {
      name: 'ClassifyPages',
      actor: 'ClassificationActor',
      mode: 'scatter',
      scatter: {
        input: '$.stages.SplitFiles.*.pages[*]',  // Flatten all pages from previous stage
        as: 'page'
      },
      input: {
        pageId: '$.page.pageId',
        imagePath: '$.page.pngPath'
      },
      output: {
        pageId: '$.pageId',
        documentType: '$.classification.type',
        confidence: '$.classification.confidence'
      },
      config: {
        concurrency: 20  // Classify up to 20 pages in parallel
      }
    },
    
    // Stage 3: Extract data from classified pages (SCATTER)
    {
      name: 'ExtractData',
      actor: 'ExtractionActor',
      mode: 'scatter',
      scatter: {
        input: '$.stages.ClassifyPages.*',
        as: 'classifiedPage'
      },
      input: {
        pageId: '$.classifiedPage.pageId',
        documentType: '$.classifiedPage.documentType',
        imagePath: '$.classifiedPage.imagePath'
      },
      output: {
        pageId: '$.pageId',
        documentType: '$.documentType',
        extractedData: '$.data'
      },
      config: {
        concurrency: 15
      }
    },
    
    // Stage 4: Consolidate by document type (GATHER - barrier sync + group)
    {
      name: 'ConsolidateByType',
      actor: 'ConsolidationActor',
      mode: 'gather',
      gather: {
        stage: 'ExtractData',
        condition: 'all',  // Wait for ALL extractions
        groupBy: '$.documentType'  // Group by document type
      },
      input: {
        documentType: '$.group.key',  // The documentType we're consolidating
        pages: '$.group.items'  // All pages of this type
      },
      output: {
        documentType: '$.documentType',
        consolidatedSchema: '$.schema',
        pageCount: '$.pageCount'
      },
      config: {
        concurrency: 5  // Process 5 document types in parallel
      }
    },
    
    // Stage 5: Final validation (single - runs once after all consolidations)
    {
      name: 'ValidateAndStore',
      actor: 'ValidationActor',
      mode: 'single',
      input: {
        fileSetId: '$.trigger.fileSetId',
        documents: '$.stages.ConsolidateByType'  // Array of all consolidation outputs
      },
      output: {
        fileSetId: '$.fileSetId',
        status: '$.status',
        documentCount: '$.documentCount'
      }
    }
  ],
  
  config: {
    maxConcurrency: 50,
    timeout: 300000,  // 5 minutes
    retryPolicy: {
      maxAttempts: 3,
      backoff: 'exponential',
      initialDelay: 1000,
      maxDelay: 30000
    }
  }
}
