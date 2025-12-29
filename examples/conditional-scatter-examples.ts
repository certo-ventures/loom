/**
 * Conditional Scatter Example - Filter items before processing
 * 
 * Demonstrates $ savings by skipping already-processed documents
 */

import type { PipelineDefinition } from '../src/pipelines/pipeline-dsl'

// ============================================================================
// Use Case: Skip Already-Processed Documents
// ============================================================================

/**
 * Real-world example: Document processing with LLM
 * 
 * Problem: Re-running pipeline processes ALL documents, even ones already done
 * Cost: $0.05 per document × 1000 documents = $50 wasted per run
 * 
 * Solution: Filter scatter with condition
 */
export const documentProcessingPipeline: PipelineDefinition = {
  name: 'smart-document-processing',
  stages: [
    {
      name: 'process-unprocessed-docs',
      mode: 'scatter',
      actor: 'LLMDocumentProcessor',  // Expensive LLM calls
      scatter: {
        input: '$.trigger.documents',
        as: 'doc',
        condition: '$.doc.status != "processed"'  // ← Skip processed docs!
      },
      input: {
        documentId: '$.doc.id',
        content: '$.doc.content'
      }
    }
  ]
}

// Without condition: 1000 documents × $0.05 = $50 per run
// With condition: 50 unprocessed × $0.05 = $2.50 per run
// Savings: $47.50 per run (95% cost reduction!)

// ============================================================================
// Use Case: Process Only High-Value Transactions
// ============================================================================

export const highValueTransactionsPipeline: PipelineDefinition = {
  name: 'fraud-detection',
  stages: [
    {
      name: 'analyze-large-transactions',
      mode: 'scatter',
      actor: 'FraudAnalysisActor',  // Expensive analysis
      scatter: {
        input: '$.trigger.transactions',
        as: 'tx',
        condition: '$.tx.amount > 10000'  // Only analyze high-value
      },
      input: {
        transaction: '$.tx'
      }
    }
  ]
}

// ============================================================================
// Use Case: Filter by Multiple Conditions
// ============================================================================

export const complexFilterPipeline: PipelineDefinition = {
  name: 'qualified-leads',
  stages: [
    {
      name: 'process-qualified-leads',
      mode: 'scatter',
      actor: 'LeadEnrichmentActor',
      scatter: {
        input: '$.trigger.leads',
        as: 'lead',
        // Can use && and || operators
        condition: '$.lead.score >= 80 && $.lead.verified == true'
      },
      input: {
        leadId: '$.lead.id',
        email: '$.lead.email'
      }
    }
  ]
}

// ============================================================================
// Use Case: Use Previous Stage Results in Filter
// ============================================================================

export const wasmValidationFilterPipeline: PipelineDefinition = {
  name: 'validated-document-processing',
  stages: [
    // Stage 1: Validate all documents
    {
      name: 'validate-documents',
      mode: 'scatter',
      actor: 'WasmDocumentValidator',  // Fast WASM validation
      scatter: {
        input: '$.trigger.documents',
        as: 'doc'
      },
      input: {
        document: '$.doc'
      }
    },
    
    // Stage 2: Only process validated documents
    {
      name: 'process-validated',
      mode: 'scatter',
      actor: 'ExpensiveLLMProcessor',  // Expensive processing
      scatter: {
        input: '$.stages["validate-documents"]',
        as: 'validated',
        condition: '$.validated.isValid == true'  // Use WASM result!
      },
      input: {
        document: '$.validated.document'
      }
    }
  ]
}

// ============================================================================
// Supported Expression Syntax
// ============================================================================

/**
 * Comparison operators:
 * - ==  : Equal (with type coercion)
 * - !=  : Not equal
 * - >   : Greater than
 * - <   : Less than
 * - >=  : Greater or equal
 * - <=  : Less or equal
 * 
 * Logical operators:
 * - &&  : AND
 * - ||  : OR
 * 
 * Value types:
 * - JSONPath: $.item.status
 * - Strings: "processed" or 'pending'
 * - Numbers: 100, 3.14, -50
 * - Booleans: true, false
 * - Null: null
 * 
 * Examples:
 * - $.doc.status == "pending"
 * - $.tx.amount > 1000
 * - $.item.priority >= 5 && $.item.verified == true
 * - $.user.role == "admin" || $.user.role == "moderator"
 */

// ============================================================================
// Migration from No Filter → Filtered
// ============================================================================

/**
 * Before (processes everything):
 */
const before: PipelineDefinition = {
  name: 'before',
  stages: [{
    name: 'process-all',
    mode: 'scatter',
    actor: 'Processor',
    scatter: {
      input: '$.trigger.items',
      as: 'item'
      // No filter - processes ALL items
    },
    input: { item: '$.item' }
  }]
}

/**
 * After (processes only what's needed):
 */
const after: PipelineDefinition = {
  name: 'after',
  stages: [{
    name: 'process-unprocessed',
    mode: 'scatter',
    actor: 'Processor',
    scatter: {
      input: '$.trigger.items',
      as: 'item',
      condition: '$.item.processed != true'  // ← Add this line!
    },
    input: { item: '$.item' }
  }]
}

// Zero breaking changes - condition is optional!
