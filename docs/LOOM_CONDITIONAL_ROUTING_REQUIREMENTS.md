# Loom Enhancement Requirements: Conditional Routing & Expression Evaluation

**Date**: January 13, 2026  
**Context**: Certo Candor adaptive document processing pipeline  
**Priority**: HIGH - Blocking adaptive pipeline implementation

---

## Executive Summary

The current Loom pipeline framework uses JSONPath for data mapping but **lacks support for conditional stage execution, dynamic actor selection, and complex boolean expressions**. This document outlines required enhancements to enable adaptive pipelines that can route to different processing paths based on runtime data.

**Current Blocker**: Cannot build a single pipeline that automatically routes text-based PDFs to text extraction and image-based PDFs to vision extraction.

**Proposed Solution**: Migrate from JSONPath to **Google's CEL (Common Expression Language)** for full expression evaluation capabilities.

---

## Current Limitations

### 1. When Clauses Don't Support Boolean Operators

**Problem**:
```typescript
// Current syntax in pipeline definition
{
  name: 'extract-text',
  actor: 'PdfTextExtractor',
  when: '$.stages["detect"][0].pdfType === "text"',  // ❌ FAILS
  mode: 'single'
}
```

**What happens**:
- JSONPath treats `===` as part of the path, not a comparison operator
- `when` clause evaluates the JSONPath expression, checking if result is truthy
- Expression `$.stages["detect"][0].pdfType === "text"` returns `undefined` (path not found)
- Stage is skipped even when condition should be true

**Test output**:
```
⏭️  Skipping stage extract-text (when condition evaluated to false)
```

### 2. No Support for Logical Operators

**Cannot do**:
```typescript
when: '$.pdfType === "image" && $.fileSize < 10000000'  // ❌ No && support
when: '$.docType !== "Other" && $.confidence > 0.8'     // ❌ No != or && support
when: '$.textPages.length > 0 || $.imagePages.length > 0'  // ❌ No || support
```

### 3. Dynamic Actor Selection Not Possible

**Cannot do**:
```typescript
{
  name: 'extract',
  actor: '$.pdfType === "text" ? "TextExtractor" : "ImageExtractor"',  // ❌ FAILS
  mode: 'single'
}
```

### 4. Conditional Input Mapping Limited

**Current workaround is verbose**:
```typescript
// Need to run both stages and merge later
{ name: 'extract-text', actor: 'TextExtractor' },      // Always runs
{ name: 'extract-images', actor: 'ImageExtractor' },   // Always runs
{ 
  name: 'merge',
  input: {
    // This might work, but it's unclear if ternary is supported in input mapping
    pages: '$.pdfType === "text" ? $.textPages : $.imagePages'  // ❓ Untested
  }
}
```

---

## Expression Language Comparison

### Option 1: Keep JSONPath (Current)

**Pros**:
- Already integrated
- Simple for basic data extraction
- Widely known

**Cons**:
- ❌ No boolean operators (===, !==, <, >, &&, ||)
- ❌ No ternary expressions (? :)
- ❌ No function calls
- ❌ No type coercion
- ❌ Limited to data selection, not evaluation

**Verdict**: Insufficient for conditional routing

### Option 2: JMESPath

**Pros**:
- ✅ Supports comparisons: `pdfType == 'text'`
- ✅ Supports filters: `pages[?pageNumber > 5]`
- ✅ Supports functions: `length(pages)`, `max(scores)`
- ✅ Boolean operators: `&&`, `||`, `!`
- ✅ AWS standard (used in AWS CLI, boto3)
- ✅ Relatively simple migration from JSONPath

**Cons**:
- ⚠️ Less type-safe than CEL
- ⚠️ Limited standard library
- ⚠️ No custom function registration
- ⚠️ Syntax can be awkward for complex expressions

**Example**:
```typescript
when: "stages.detect[0].pdfType == 'text'"
actor: "pdfType == 'text' && 'TextExtractor' || 'ImageExtractor'"
```

**Verdict**: Good middle ground, sufficient for most use cases

### Option 3: Google's CEL (Common Expression Language) ⭐ **RECOMMENDED**

**Pros**:
- ✅ **Type-safe expression evaluation**
- ✅ Full boolean operators: `==`, `!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`, `!`
- ✅ Ternary operator: `condition ? trueValue : falseValue`
- ✅ String interpolation: `"Hello " + name`
- ✅ **Custom function registration** (extensible)
- ✅ **Macros** for common patterns
- ✅ Used by Google (Cloud, Kubernetes, Firebase)
- ✅ Strong typing prevents runtime errors
- ✅ **Better error messages** than JMESPath
- ✅ **Gradual evaluation** (can optimize)
- ✅ **Well-documented** and actively maintained

**Cons**:
- ⚠️ Slightly steeper learning curve than JMESPath
- ⚠️ Requires CEL library (but well-supported: [@buf/googleapis_cel-spec.js](https://www.npmjs.com/package/@buf/googleapis_cel-spec))

**Example**:
```typescript
when: "stages.detect[0].pdfType == 'text'"
actor: "stages.detect[0].pdfType == 'text' ? 'TextExtractor' : 'ImageExtractor'"
input: {
  pages: "pdfType == 'text' ? stages.extractText[0].pages : stages.extractImages[0].pages",
  confidence: "max(stages.classify.map(c, c.confidence))"
}
```

**Verdict**: Best long-term solution, most powerful and maintainable

### Option 4: FEEL (Friendly Enough Expression Language)

**Pros**:
- ✅ Part of DMN standard (decision modeling)
- ✅ Good for business rules
- ✅ Human-readable

**Cons**:
- ❌ Primarily designed for decision tables, not data pipelines
- ❌ Less commonly used than CEL or JMESPath
- ❌ Fewer libraries and tools
- ❌ Overkill for our use case

**Verdict**: Not recommended for pipeline routing

---

## Recommended Solution: Migrate to JMESPath ⭐

### Critical Requirement: Dynamic Pipeline Generation

**MOST IMPORTANT**: Pipelines must be **dynamically generated and parsed at runtime** from:
- Database-stored JSON definitions
- API responses
- Configuration files (YAML/JSON)
- User-defined templates

This requirement **eliminates CEL** from consideration because:
- ❌ CEL requires type schema definitions at compile time for full benefits
- ❌ Type safety is lost when using dynamic types (`map<string, dyn>`)
- ❌ Compilation step adds complexity for runtime-loaded pipelines
- ❌ Harder to serialize/deserialize pipeline definitions

### Why JMESPath?

1. **String-Based, Zero Compilation**: Expressions are evaluated directly from strings
2. **JSON-Native**: Pipeline definitions stored as pure JSON, no special handling
3. **Runtime-Friendly**: No schema or type definitions required
4. **AWS Standard**: Battle-tested, used by AWS CLI, boto3, CloudFormation
5. **Sufficient Power**: Boolean operators, comparisons, ternary-like expressions, filtering
6. **Simple Integration**: Single npm package, drop-in replacement for JSONPath

### JMESPath vs CEL for Dynamic Pipelines

| Feature | JMESPath ⭐ | CEL |
|---------|----------|-----|
| **Runtime Pipeline Generation** | ✅ Native JSON storage | ⚠️ Requires runtime compilation |
| **Database-Stored Definitions** | ✅ Pure JSON, no processing | ⚠️ Need to compile CEL strings |
| **No Type Schema Required** | ✅ Fully dynamic | ⚠️ Loses type safety without schema |
| **Serialization** | ✅ Direct JSON | ⚠️ CEL strings in JSON |
| **Startup Performance** | ✅ No compilation | ⚠️ Must compile expressions |
| **Boolean Operators** | ✅ `==`, `!=`, `&&`, `\|\|` | ✅ `==`, `!=`, `&&`, `\|\|` |
| **Ternary/Conditional** | ✅ `a && b \|\| c` pattern | ✅ `a ? b : c` |
| **Filtering** | ✅ `[?condition]` | ✅ `.filter(x, condition)` |
| **Learning Curve** | ✅ Simple | ⚠️ Moderate |
| **Type Safety** | ❌ Runtime only | ⚠️ Runtime only (without static schema) |

**Decision**: **JMESPath wins for dynamic runtime pipeline generation**. CEL's advantages disappear when pipelines are loaded from JSON at runtime.

---

## Required Loom Enhancements

### 1. Expression Evaluator Service

**New Module**: `@certo-ventures/loom/expressions`

```typescript
// loom/expressions/ExpressionEvaluator.ts

import jmespath from 'jmespath';

export interface ExpressionContext {
  trigger: any;           // Original trigger data
  stages: Record<string, any[]>;  // Stage results by name
  metadata: {
    executionId: string;
    startTime: string;
    currentStage: string;
  };
}

export interface EvaluationResult<T = any> {
  success: boolean;
  value?: T;
  error?: string;
  expression: string;
}

export class ExpressionEvaluator {
  private customFunctions: Map<string, Function> = new Map();

  /**
   * Evaluate a JMESPath expression against pipeline context
   * 
   * No compilation needed - JMESPath evaluates strings directly
   */
  async evaluate<T = any>(
    expression: string,
    context: ExpressionContext
  ): Promise<EvaluationResult<T>> {
    try {
      // JMESPath evaluates directly from string, no compilation
      const result = jmespath.search(context, expression, {
        functionTable: this.buildFunctionTable()
      });

      return {
        success: true,
        value: result as T,
        expression
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        expression
      };
    }
  }

  /**
   * Build JMESPath custom function table
   */
  private buildFunctionTable(): Record<string, Function> {
    const functions: Record<string, Function> = {};
    
    // Convert registered functions to JMESPath format
    for (const [name, fn] of this.customFunctions.entries()) {
      functions[name] = fn;
    }
    
    return functions;
  }

  /**
   * Evaluate boolean condition (for when clauses)
   */
  async evaluateCondition(
    expression: string,
    context: ExpressionContext
  ): Promise<boolean> {
    const result = await this.evaluate<boolean>(expression, context);
    
    if (!result.success) {
      console.error(`[Loom] Condition evaluation failed: ${result.error}`);
      console.error(`  Expression: ${expression}`);
      return false;  // Fail-safe: skip stage if condition errors
    }

    return result.value === true;
  }

  /**
   * Evaluate dynamic actor name
   */
  async evaluateActorName(
    expression: string,
    context: ExpressionContext
  ): Promise<string | null> {
    const result = await this.evaluate<string>(expression, context);
    
    if (!result.success) {
      console.error(`[Loom] Actor evaluation failed: ${result.error}`);
      return null;
    }

    return result.value || null;
  }

  /**
   * Register custom JMESPath function for pipeline-specific operations
   * 
   * @example
   * evaluator.registerFunction('getStage', function(stageName, index = 0) {
   *   return this.stages[stageName]?.[index];
   * });
   */
  registerFunction(name: string, fn: (...args: any[]) => any): void {
    this.customFunctions.set(name, fn);
  }
}
```

### 2. Enhanced Pipeline Definition Types

**Update**: `@certo-ventures/loom/pipelines/types.ts`

```typescript
export interface StageDefinition {
  name: string;
  actor: string | DynamicActorExpressioJMESPath expression
   * Expression must evaluate to boolean-ish value (truthy/falsy)
   * 
   * @example
   * when: "stages.detect[0].pdfType == 'text'"
   * when: "length(stages.classify[?confidence > `0.8`]) > `0`"
   * when: "trigger.fileSize < `10000000` && trigger.contentType == 'application/pdf'"
   */
  when?: string;  // ✅ ENHANCED: Now supports full JMESPath expressions
  
  scatter?: {
    input: string;  // JMESPath expression returning array
    as: string;
  };
  
  input?: Record<string, string | any>;  // Values can be JMESPath expressions
}

/**
 * Dynamic actor selection using JMESPath expression
 * Expression must evaluate to string (actor name)
 * 
 * @example "stages.detect[0].pdfType == 'text' && 'TextExtractor' || 'ImageExtractor'"
 */
export type DynamicActorExpression = string;  // JMESPath
 * Dynamic actor selection using CEL expression
 * Expression must evaluate to string (actor name)
 */
export type DynamicActorExpression = string;  // CEL expression
```

### 3. Pipeline Orchestrator Enhancements

**Update**: `@certo-ventures/loom/pipelines/PipelineOrchestrator.ts`

```typescript
import { ExpressionEvaluator } from '../expressions/ExpressionEvaluator';

export class PipelineOrchestrator {
  private expressionEvaluator: ExpressionEvaluator;

  constructor(
    messageQueue: MessageQueue,
    actorRegistry: ActorRegistry,
    redis: Redis,
    stateStore: PipelineStateStore,jmespath';  // Default: 'jmespath
    options?: {
      expressionLanguage?: 'jsonpath' | 'cel';  // Default: 'cel'
      customFunctions?: Record<string, Function>;
    }
  ) {
    this.expressionEvaluator = new ExpressionEvaluator();
    
    // Register custom functions if provided
    if (options?.customFunctions) {
      Object.entries(options.customFunctions).forEach(([name, fn]) => {
        this.expressionEvaluator.registerFunction(name, fn);
      });
    }
  }

  /**
   * Execute pipeline stage with conditional evaluation
   */
  private async executeStage(
    stage: StageDefinition,
    context: ExpressionContext
  ): Promise<void> {
    // ✅ NEW: Evaluate when clause
    if (stage.when) {
      const shouldExecute = await this.expressionEvaluator.evaluateCondition(
        stage.when,
        context
      );

      if (!shouldExecute) {
        console.log(`⏭️  Skipping stage ${stage.name} (condition: ${stage.when})`);
        return;
      }
    }

    // ✅ NEW: Resolve dynamic actor
    const actorName = await this.resolveActorName(stage.actor, context);
    
    if (!actorName) {
      throw new Error(`Failed to resolve actor for stage ${stage.name}`);
    }

    // ✅ NEW: Evaluate input expressions
    const resolvedInput = await this.resolveInput(stage.input, context);

    // Continue with execution...
    await this.enqueueActorJob(actorName, resolvedInput);
  }

  /**
   * Resolve actor name (static or dynamic expression)
   */
  private async resolveActorName(
    actor: string | DynamicActorExpression,
    context: ExpressionContext
  ): Promise<string | null> {
    // Check if actor is an expression (contains CEL operators)
    if (this.isExpression(actor)) {
      return await this.expressionEvaluator.evaluateActorName(actor, context);
    }

    // Static actor name
    return actor;
  }

  /**
   * Resolve input object with CEL expressions
   */
  private async resolveInput(
    input: Record<string, string | any> | undefined,
    context: ExpressionContext
  ): Promise<Record<string, any>> {
    if (!input) return {};

    const resolved: Record<string, any> = {};

    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string' && this.isExpression(value)) {
        // Evaluate expression
        const result = await this.expressionEvaluator.evaluate(value, context);
        resolved[key] = result.success ? result.value : undefined;
      } else {
        // Static value
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Check if string is a JMESPath expression vs literal value
   */
  private isExpression(value: string): boolean {
    // Simple heuristic: contains JMESPath operators or functions
    return /[?:==!<>&|[\]]|^\$/.test(value) || 
           value.includes('stages.') || 
           value.includes('trigger.') ||
           /\w+\(/.test(value);  // Function call like length()
  }
}
```

### 4. Built-in JMESPath Functions for Pipelines

**Register These Functions**:

```typescript
// Standard pipeline functions (JMESPath format)
const pipelineFunctions = {
  /**
   * Get stage result by name and index
   * @example getStage('detect', `0`).pdfType
   */
  getStage: function(name: string, index: number = 0) {
    return this.stages[name]?.[index];
  },

  /**
   * Check if stage exists and has results
   * @example hasStage('extract-text')
   */
  hasStage: function(name: string) {
    return !!this.stages[name]?.length;
  },

  /**
   * Coalesce: return first non-null value
   * @example coalesce(stages.text[0].pages, stages.images[0].pages, `[]`)
   */
  coalesce: function(...values: any[]) {
    return values.find(v => v != null);
  },
  
  /**
   * Safe null check with default
   * @example nvl(stages.extract[0].pages, `[]`)
   */
  nvl: function(value: any, defaultValue: any) {
    return value != null ? value : defaultValue;
  }
};

// Note: JMESPath has built-in functions we can use:
// - length(array) - get array length
// - max(array) - maximum value
// - min(array) - minimum value
// - sum(array) - sum values
// - [?condition] - filter arrays
// - @.field - current object field access
```

### 5. Migration Path & Backwards Compatibility

```typescript
// Support both JSONPath (legacy) and CEL (new)
export interface PipelineDefinition {
  /**
   * Expression language for this pipeline
   * @default 'jmespath' (as of v0.4.0)
   * @deprecated 'jsonpath' will be removed in v1.0.0
   */
  expressionLanguage?: 'jsonpath' | 'jmespath';
  
  stages: StageDefinition[];
}

// In orchestrator:
if (pipeline.expressionLanguage === 'jsonpath') {
  // Legacy JSONPath evaluation (current behavior)
  return this.legacyJSONPathEvaluator.evaluate(expression, context);
} else {
  // New JMESPath evaluation (default)
  return this.expressionEvaluator.evaluate(expression, context);
}
```

---

## Example: Before & After

### Before (Current - Limited)

```typescript
// Need separate pipelines or complex workarounds
export const textPipeline: PipelineDefinition = {
  stages: [
    { name: 'extract', actor: 'PdfTextExtractor', mode: 'single' },
    { name: 'classify', actor: 'TextBasedClassification', mode: 'scatter' }
  ]
};

export const imagePipeline: PipelineDefinition = {
  stages: [
    { name: 'extract', actor: 'PdfImageExtractor', mode: 'single' },
    { name: 'classify', actor: 'ImageBasedClassification', mode: 'scatter' }
  ]
};

// Runner must select pipeline manually
const pipeline = pdfType === 'image' ? imagePipeline : textPipeline;
```

### After (With JMESPath - Adaptive)

```typescript
// Single adaptive pipeline - stored as JSON, loaded at runtime
export const adaptivePipeline: PipelineDefinition = {
  expressionLanguage: 'jmespath',
  
  stages: [
    // Stage 1: Detect PDF type
    {
      name: 'detect',
      actor: 'PdfTypeAnalyzer',
      mode: 'single',
      input: {
        fileUrl: 'trigger().fileUrl'
      }
    },

    // Stage 2a: Extract text (conditional)
    {
      name: 'extract-text',
      actor: 'PdfTextExtractor',
      when: "stages.detect[0].pdfType == 'text'",  // ✅ JMESPath expression
      mode: 'single',
      input: {
        fileUrl: 'trigger.fileUrl'
      }
    },

    // Stage 2b: Extract images (conditional)
    {
      name: 'extract-images',
      actor: 'PdfImageExtractor',
      when: "stages.detect[0].pdfType == 'image'",  // ✅ JMESPath expression
      mode: 'single',
      input: {
        fileUrl: 'trigger.fileUrl'
      }
    },

    // Stage 3: Dynamic classification based on PDF type
    {
      name: 'classify',
      // ✅ JMESPath ternary using && || pattern
      actor: "stages.detect[0].pdfType == 'text' && 'TextBasedClassification' || 'ImageBasedClassification'",
      mode: 'scatter',
      scatter: {
        // ✅ Coalesce using custom function
        input: "coalesce(stages.extractText[0].pages, stages.extractImages[0].pages, `[]`)",
        as: 'page'
      },
      input: {
        pageNumber: 'page.pageNumber',
        // ✅ Conditional field using && || pattern
        content: "stages.detect[0].pdfType == 'text' && page.text || page.imageUrl",
        documentTypes: 'trigger.documentTypes'
      }
    },

    // Stage 4: Extract structured data (dynamic actor)
    {
      name: 'extract',
      // ✅ Dynamic actor selection
      actor: "stages.detect[0].pdfType == 'text' && 'SchemaBasedExtraction' || 'VisionSchemaExtraction'",
      mode: 'scatter',
      // ✅ Complex condition with filtering
      when: "length(stages.classify[?documentType != 'Other']) > `0`",
      scatter: {
        input: "stages.classify[?documentType != 'Other']",  // ✅ JMESPath filter
        as: 'doc'
      },
      input: {
        documentType: 'doc.documentType',
        content: "stages.detect[0].pdfType == 'text' && doc.text || doc.imageUrls"
      }
    }
  ]
};
```

---

## API Design Summary

### JMESPath Expression Syntax in Pipelines

```typescript
// 1. WHEN CLAUSE (boolean condition)
when: "stages.detect[0].pdfType == 'text'"
when: "trigger.fileSize < `10000000` && stages.validate[0].isValid"
when: "length(stages.classify[?confidence > `0.8`]) > `5`"

// 2. DYNAMIC ACTOR (using && || pattern for ternary)
actor: "stages.detect[0].pdfType == 'text' && 'TextActor' || 'ImageActor'"
actor: "trigger.priority == 'high' && 'FastProcessor' || 'StandardProcessor'"

// 3. INPUT MAPPING (any type)
input: {
  pages: "coalesce(stages.extractText[0].pages, stages.extractImages[0].pages, `[]`)",
  documentType: "stages.classify[0].documentType",
  confidence: "max(stages.classify[*].confidence)"  // Built-in max()
}

// 4. SCATTER INPUT (array result with filtering)
scatter: {
  input: "stages.classify[?documentType != 'Other']",  // JMESPath filter
  as: 'doc'
}

// Note: Backticks (`) for literals, no backticks for references
// - stages.detect[0] - reference to data
// - `'text'` - literal string
// - `10000000` - literal number
```

### Helper Functions Available in JMESPath

```typescript
// Custom functions (registered)
getStage(name: string, index?: number) -> any
hasStage(name: string) -> boolean
coalesce(...values) -> first non-null value
nvl(value, default) -> value if not null, else default

// Built-in JMESPath functions
length(array) -> number
max(array) -> maximum value
min(array) -> minimum value
sum(array) -> sum of values
keys(object) -> array of keys
values(object) -> array of values
type(any) -> type string

// JMESPath operators
[?condition] - filter array
[*] - flatten array
@ - current object
| - pipe operator
```

---

## Implementation Checklist

### Phase 1: Core JMESPath Integration (Week 1)
- [ ] Add `jmespath` dependency to Loom (`npm install jmespath @types/jmespath`)
- [ ] Create `ExpressionEvaluator` service (no compilation needed)
- [ ] Update `PipelineDefinition` types to support `when` and dynamic `actor`
- [ ] Add `expressionLanguage` field to pipeline definition
- [ ] Implement custom function registration system

### Phase 2: Orchestrator Enhancement (Week 1-2)
- [ ] Update `PipelineOrchestrator.executeStage()` to evaluate `when` clauses
- [ ] Implement `resolveActorName()` for dynamic actor selection
- [ ] Implement `resolveInput()` for expression-based input mapping
- [ ] Add `isExpression()` heuristic to detect CEL vs literals
- [ ] Handle CEL evaluation errors gracefully (fail-safe behavior)

### Phase 3: Built-in Functions (Week 2)
- [ ] Register `getStage()`, `hasStage()` custom functions
- [ ] Register `coalesce()`, `nvl()` utility functions
- [ ] Document all custom functions
- [ ] Document JMESPath built-in functions (length, max, min, sum, etc.)
- [ ] Provide examples of common patterns (ternary using && ||)

### Phase 4: Testing (Week 2-3)
- [ ] Unit tests for `ExpressionEvaluator`
- [ ] Integration tests for conditional stage execution
- [ ] Integration tests for dynamic actor selection
- [ ] Integration tests for conditional input mapping
- [ ] Test dynamic pipeline loading from JSON
- [ ] Test runtime pipeline generation

### Phase 5: Documentation (Week 3)
- [ ] Migration guide from JSONPath to JMESPath
- [ ] JMESPath syntax reference for pipelines
- [ ] Examples of common patterns (conditional routing, dynamic actors, ternary using && ||)
- [ ] Guide for storing pipelines in database as JSON
- [ ] Troubleshooting guide for expression errors

### Phase 6: Backwards Compatibility (Week 3-4)
- [ ] Keep JSONPath evaluator for `expressionLanguage: 'jsonpath'`
- [ ] Add deprecation warnings for JSONPath usage
- [ ] Plan JSONPath removal timeline (v1.0.0)

---

## Testing Requirements

### Unit Tests

```typescript
describe('ExpressionEvaluator', () => {
  describe('evaluateCondition', () => {
    it('should evaluate simple equality', async () => {
      const result = await evaluator.evaluateCondition(
        "stage('detect').pdfType == 'text'",
        { stages: { detect: [{ pdfType: 'text' }] } }
      );
      expect(result).toBe(true);
    });

    it('should evaluate complex boolean expression', async () => {
      const result = await evaluator.evaluateCondition(
        "stage('detect').pdfType == 'image' && trigger().fileSize < 10000000",
        { 
          stages: { detect: [{ pdfType: 'image' }] },
          trigger: { fileSize: 5000000 }
        }
      );
      expect(result).toBe(true);
    });

    it('should handle array filtering', async () => {
      const result = await evaluator.evaluateCondition(
        "stages('classify').filter(c, c.confidence > 0.8).size() > 0",
        {
          stages: {
            classify: [
              { confidence: 0.9 },
              { confidence: 0.5 },
              { confidence: 0.95 }
            ]
          }
        }
      );
      expect(result).toBe(true);
    });
  });

  describe('evaluateActorName', () => {
    it('should resolve dynamic actor name', async () => {
      const actor = await evaluator.evaluateActorName(
        "stage('detect').pdfType == 'text' ? 'TextExtractor' : 'ImageExtractor'",
        { stages: { detect: [{ pdfType: 'text' }] } }
      );
      expect(actor).toBe('TextExtractor');
    });
  });
});
```

### Integration Tests

```typescript
describe('Conditional Pipeline Execution', () => {
  it('should skip stages based on when clause', async () => {
    const pipeline = {
      stages: [
        { name: 'detect', actor: 'Detector', mode: 'single' },
        { 
          name: 'text-only', 
          actor: 'TextActor',
          when: "stage('detect').type == 'text'",
          mode: 'single'
        }
      ]
    };

    const result = await orchestrator.execute(pipeline, { fileUrl: 'test.pdf' });
    
    // Verify text-only stage was skipped for image PDF
    expect(result.stages['text-only']).toBeUndefined();
  });

  it('should select actor dynamically', async () => {
    const pipeline = {
      stages: [
        { name: 'detect', actor: 'Detector', mode: 'single' },
        {
          name: 'extract',
          actor: "stage('detect').type == 'text' ? 'TextExtractor' : 'ImageExtractor'",
          mode: 'single'
        }
      ]
    };

    const result = await orchestrator.execute(pipeline, { fileUrl: 'image.pdf' });
    
    // Verify ImageExtractor was used
    expect(result.stages['extract'][0].method).toBe('image-extraction');
  });
});
```

---

## Performance Considerations

### JMESPath Performance

**No Compilation Needed**: JMESPath evaluates strings directly, no caching required.

**Expected Performance**:
- Every evaluation: ~0.5-2ms (parse + execute)
- No memory overhead for caching
- Consistent performance regardless of expression complexity

**Benchmarks** (approximate, from jmespath library):
- Simple field access (`stages.detect[0].pdfType`): ~0.3ms
- Filtering (`stages.classify[?confidence > 0.8]`): ~1-2ms per 100 items
- Complex expressions with functions: ~2-5ms

### No Memory Management Needed

- ✅ No compiled expression cache
- ✅ No cache eviction logic
- ✅ No memory pressure from caching
- ✅ Pipeline definitions are pure JSON (no special handling)

### Runtime Pipeline Loading

**Key Advantage**: Pipelines can be loaded from database and executed immediately.

```typescript
// Load pipeline from database (or API, file, etc.)
const pipelineJson = await database.getPipeline('adaptive-pdf');

// Execute immediately - no compilation step
const result = await orchestrator.execute(pipelineJson, triggerData);

// Expressions are evaluated on-the-fly:
// - "stages.detect[0].pdfType == 'text'" parsed and executed
// - No pre-processing, no caching, no compilation
// - Works perfectly for dynamic runtime pipelines
```

---

## Migration Guide for Users

### Step 1: Update Loom Version

```bash
npm install @certo-ventures/loom@^0.4.0
```

### Step 2: Update Pipeline Definitions

**Before (JSONPath)**:
```typescript
{
  name: 'extract',
  actor: 'PdfTextExtractor',
  mode: 'single',
  input: {
    pages: '$.stages["parse"][0].pages'
  }
}
```

**After (JMESPath)**:
```typescript
{
  name: 'extract',
  actor: 'PdfTextExtractor',
  mode: 'single',
  input: {
    pages: "stages.parse[0].pages"  // ✅ Cleaner syntax, no $ prefix
  }
}
```

### Step 3: Add Conditional Logic

```typescript
{
  name: 'extract-text',
  actor: 'PdfTextExtractor',
  when: "stages.detect[0].pdfType == 'text'",  // ✅ NEW
  mode: 'single'
}
```

### Step 4: Use Dynamic Actors

```typescript
{
  name: 'extract',
  // ✅ JMESPath ternary using && || pattern
  actor: "stages.detect[0].pdfType == 'text' && 'TextExtractor' || 'ImageExtractor'",
  mode: 'single'
}
```

### Step 5: Store Pipelines in Database

```typescript
// Pipeline can be stored as pure JSON in database
const pipelineJson = {
  name: "adaptive-pdf-processing",
  expressionLanguage: "jmespath",
  stages: [
    {
      name: "detect",
      actor: "PdfTypeAnalyzer",
      mode: "single"
    },
    {
      name: "extract",
      actor: "stages.detect[0].pdfType == 'text' && 'TextExtractor' || 'ImageExtractor'",
      mode: "single"
    }
  ]
};

// Load from database
const pipeline = await db.collection('pipelines').findOne({ name: 'adaptive-pdf-processing' });

// Execute directly - no compilation or pre-processing needed
await orchestrator.execute(pipeline, triggerData);
```

---

## Recommended Timeline

| Week | Milestone | Deliverable |
|------|-----------|-------------|
| 1 | Core CEL Integration | `ExpressionEvaluator` class, basic `when` clause support |
| 2 | Orchestrator Enhancement | Dynamic actor selection, conditional input mapping |
| 3 | Testing & Documentation | Unit tests, integration tests, migration guide |
| 4 | Release Candidate | Loom v0.4.0-rc.1 with CEL support |
| 5 | Production Release | Loom v0.4.0 stable |

---

## Conclusion

**Recommendation**: Migrate Loom from JSONPath to **JMESPath** for expression evaluation.

**Why JMESPath over CEL**:
1. ✅ **Runtime pipeline generation** - no compilation required
2. ✅ **Pure JSON storage** - pipelines stored in database as-is
3. ✅ **Immediate execution** - load from DB and run
4. ✅ **Zero memory overhead** - no expression caching needed
5. ✅ **Simpler integration** - single npm package
6. ✅ **AWS battle-tested** - production-proven in AWS CLI, boto3
7. ✅ **Dynamic pipelines** - perfect for SaaS where pipelines come from database

**CEL Would Require**:
- ❌ Runtime compilation step when loading from database
- ❌ Type schema definitions (loses type safety with dynamic types anyway)
- ❌ Expression cache management
- ❌ More complex serialization/deserialization

**Key Benefits**:
- ✅ Single adaptive pipeline replaces multiple specialized pipelines
- ✅ Dynamic routing based on runtime data
- ✅ Cleaner, more maintainable pipeline definitions
- ✅ **Perfect for database-stored pipelines** (no pre-processing)
- ✅ Extensible with custom functions for domain-specific logic
- ✅ **Zero startup overhead** - pipelines load and execute instantly

**Effort**: ~2-3 weeks for full implementation and testing (simpler than CEL)

**Breaking Changes**: None (with backwards compatibility layer)

**Next Steps**:
1. Review this proposal with Loom team
2. Create GitHub issue in Loom repository
3. Implement Phase 1 (JMESPath integration) - ~1 week
4. Beta test with Certo Candor adaptive pipeline
5. Test dynamic pipeline loading from database
6. Release Loom v0.4.0 with JMESPath support
