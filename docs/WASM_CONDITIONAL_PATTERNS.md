/**
 * WASM Actors in Pipeline Conditionals - Design & Examples
 * 
 * Shows how to use WASM actor results in conditional logic
 */

import type { PipelineDefinition } from '../pipelines/pipeline-dsl'

// ============================================================================
// Pattern 1: ALREADY WORKS - Use Actor Results in Conditions
// ============================================================================

/**
 * Use WASM validation actor result in subsequent stage conditions
 */
export const wasmValidationPipeline: PipelineDefinition = {
  name: 'wasm-validation-example',
  stages: [
    // Stage 1: Run WASM validator
    {
      name: 'validate-document',
      mode: 'single',
      actor: 'WasmDocumentValidator',  // WASM actor returns { isValid: boolean, score: number }
      input: {
        document: '$.trigger.document'
      }
    },
    
    // Stage 2: Only process if validation passed
    {
      name: 'process-document',
      mode: 'single',
      actor: 'DocumentProcessor',
      when: '$.stages["validate-document"].isValid == true',  // ← Use WASM result!
      input: {
        document: '$.trigger.document'
      }
    },
    
    // Stage 3: Send to manual review if validation score is low
    {
      name: 'manual-review',
      mode: 'single',
      actor: 'HumanReviewActor',
      when: '$.stages["validate-document"].score < 0.7',  // ← Use WASM score!
      input: {
        document: '$.trigger.document',
        validationScore: '$.stages["validate-document"].score'
      }
    }
  ]
}

// ============================================================================
// Pattern 2: WASM Actor in Scatter Condition
// ============================================================================

/**
 * Use WASM classification result to filter scatter items
 */
export const wasmScatterFilterPipeline: PipelineDefinition = {
  name: 'wasm-scatter-filter',
  stages: [
    // Stage 1: Classify all documents with WASM actor
    {
      name: 'classify-documents',
      mode: 'scatter',
      actor: 'WasmDocumentClassifier',  // Returns { type: 'invoice' | 'receipt' | 'other' }
      scatter: {
        input: '$.trigger.documents',
        as: 'doc'
      },
      input: {
        document: '$.doc'
      }
    },
    
    // Stage 2: Only process invoices (filtered by WASM classification)
    {
      name: 'process-invoices',
      mode: 'scatter',
      actor: 'InvoiceProcessor',
      scatter: {
        input: '$.stages["classify-documents"]',
        as: 'classified',
        condition: '$.classified.type == "invoice"'  // ← Filter by WASM result!
      },
      input: {
        invoice: '$.classified.document'
      }
    }
  ]
}

// ============================================================================
// Pattern 3: PROPOSED - Inline WASM Execution in Expressions
// ============================================================================

/**
 * FUTURE: Execute WASM inline in condition expression
 * 
 * Syntax: @wasm:actorType(jsonInput)
 */
export const inlineWasmPipeline: PipelineDefinition = {
  name: 'inline-wasm-execution',
  stages: [
    {
      name: 'process-items',
      mode: 'scatter',
      actor: 'ItemProcessor',
      scatter: {
        input: '$.trigger.items',
        as: 'item',
        // PROPOSED: Execute WASM inline
        condition: '@wasm:ComplexValidator($.item).isValid == true'  // ← Execute WASM in expression!
      },
      input: {
        item: '$.item'
      }
    }
  ]
}

// ============================================================================
// Pattern 4: PROPOSED - Code Block Conditions
// ============================================================================

/**
 * FUTURE: Execute arbitrary code in condition
 * 
 * Store code as string, execute in sandboxed environment
 */
export const codeBlockPipeline: PipelineDefinition = {
  name: 'code-block-conditions',
  stages: [
    {
      name: 'smart-filter',
      mode: 'scatter',
      actor: 'DataProcessor',
      scatter: {
        input: '$.trigger.items',
        as: 'item',
        // PROPOSED: JavaScript/TypeScript code block
        condition: `
          const score = $.item.confidence * $.item.quality;
          const hasRequiredFields = $.item.name && $.item.email;
          return score > 0.8 && hasRequiredFields;
        `
      },
      input: {
        item: '$.item'
      }
    }
  ]
}

// ============================================================================
// Implementation Approaches
// ============================================================================

/**
 * Approach 1: SIMPLE (10 lines) - Already works!
 * 
 * Use multi-stage pattern:
 * 1. Run WASM actor first
 * 2. Use result in subsequent conditions
 */

/**
 * Approach 2: INLINE WASM (~50 lines)
 * 
 * Enhance ExpressionEvaluator to detect @wasm:actorType(input) syntax:
 * 1. Parse expression
 * 2. Extract actor call
 * 3. Execute actor synchronously (blocking!)
 * 4. Use result in comparison
 * 
 * Limitations:
 * - Synchronous execution (blocks worker)
 * - No actor pooling
 * - Can't use scatter (1:1 only)
 */

/**
 * Approach 3: CODE BLOCKS (~100 lines)
 * 
 * Use VM or isolated-vm to execute code:
 * 1. Parse code block from condition
 * 2. Create sandboxed context with JSONPath values
 * 3. Execute code
 * 4. Return boolean result
 * 
 * Limitations:
 * - Security concerns (need sandbox)
 * - Performance overhead
 * - Debugging difficulty
 */

// ============================================================================
// Recommendation
// ============================================================================

/**
 * Use Pattern 1 (multi-stage) for now:
 * 
 * Benefits:
 * - Already works with zero code changes
 * - Distributed execution (actors run in worker pool)
 * - Full observability (each stage tracked)
 * - Reusable actor results
 * 
 * When to add inline execution:
 * - User requests it explicitly
 * - Have specific use case that can't use multi-stage
 * - Worth the ~50-100 line complexity
 * 
 * Current Phase 2 (Conditional Scatter) is perfect as-is:
 * - Filter by simple comparisons (fast)
 * - Or filter by previous WASM actor results (distributed)
 */
