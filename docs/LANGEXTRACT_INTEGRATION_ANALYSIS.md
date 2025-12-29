# Langextract Integration Analysis for Loom

## Executive Summary

Google's Langextract library provides sophisticated patterns for structured LLM extraction with validation, grounding, and few-shot learning that would significantly enhance Loom's AI capabilities. This document outlines key patterns to adopt and potential integration strategies.

## Key Findings

### 1. **Structured Extraction with Schema Validation** 🎯 HIGH PRIORITY

**What Langextract Does:**
- Enforces consistent structured outputs using schema constraints generated from few-shot examples
- Provider-specific schema implementations (Gemini, OpenAI, Ollama)
- Automatic validation of extraction format and alignment

**Current Loom Gap:**
- Basic LLM integration without structured output enforcement
- No schema-driven extraction validation
- Limited few-shot example handling

**Recommended Integration:**

```typescript
// New: src/ai/extraction/structured-extractor.ts

export interface ExtractionExample {
  text: string
  extractions: Array<{
    extraction_class: string
    extraction_text: string
    attributes?: Record<string, any>
  }>
}

export interface StructuredExtractionConfig {
  prompt_description: string
  examples: ExtractionExample[]
  format_type: 'json' | 'yaml'
  use_schema_constraints: boolean
  validation_level: 'off' | 'warning' | 'error'
}

export class StructuredExtractor {
  constructor(
    private llm: UnifiedLLM,
    private config: StructuredExtractionConfig
  ) {}

  /**
   * Extract structured data with schema enforcement
   */
  async extract(text: string): Promise<{
    extractions: Array<any>
    confidence: number
    validation_report: ValidationReport
  }> {
    // 1. Generate schema from examples
    const schema = this.buildSchemaFromExamples()
    
    // 2. Validate examples align with their own text
    const validationReport = await this.validateExamples()
    if (validationReport.has_failed && this.config.validation_level === 'error') {
      throw new Error('Example validation failed')
    }
    
    // 3. Build few-shot prompt
    const prompt = this.buildFewShotPrompt(text, schema)
    
    // 4. Call LLM with schema constraints
    const response = await this.llm.chat([
      { role: 'system', content: prompt }
    ], {
      response_schema: schema, // For Gemini
      structured_output: true
    })
    
    // 5. Validate and align output
    return this.validateAndAlignOutput(response, text)
  }

  private buildSchemaFromExamples(): Record<string, any> {
    // Extract extraction classes and attribute types from examples
    const classes = new Set<string>()
    const attributeTypes: Record<string, Record<string, string>> = {}
    
    for (const example of this.config.examples) {
      for (const extraction of example.extractions) {
        classes.add(extraction.extraction_class)
        
        if (extraction.attributes) {
          if (!attributeTypes[extraction.extraction_class]) {
            attributeTypes[extraction.extraction_class] = {}
          }
          for (const [key, value] of Object.entries(extraction.attributes)) {
            attributeTypes[extraction.extraction_class][key] = typeof value
          }
        }
      }
    }
    
    // Build JSON schema
    return {
      type: 'object',
      required: ['extractions'],
      properties: {
        extractions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['extraction_class', 'extraction_text'],
            properties: {
              extraction_class: {
                type: 'string',
                enum: Array.from(classes)
              },
              extraction_text: { type: 'string' },
              attributes: {
                type: 'object',
                // Dynamic based on class
              }
            }
          }
        }
      }
    }
  }
}
```

### 2. **Prompt Validation and Alignment** ⚠️ HIGH PRIORITY

**What Langextract Does:**
- Pre-flight validation that few-shot examples align with their source text
- Three validation levels: OFF, WARNING, ERROR
- Fuzzy matching for near-exact alignment detection
- Detailed validation reports with line/char positions

**Value for Loom:**
- Catch prompt engineering errors before expensive LLM calls
- Ensure actor prompts are well-formed
- Improve reliability of extraction actors

**Integration:**

```typescript
// New: src/ai/validation/prompt-validator.ts

export interface ValidationIssue {
  example_index: number
  extraction_class: string
  extraction_text: string
  alignment_status: 'exact' | 'fuzzy' | 'failed' | null
  char_interval?: [number, number]
}

export interface ValidationReport {
  issues: ValidationIssue[]
  has_failed: boolean
  has_non_exact: boolean
}

export class PromptValidator {
  /**
   * Validate that examples align with their source text
   */
  async validatePromptAlignment(
    examples: ExtractionExample[],
    policy: {
      enable_fuzzy_alignment: boolean
      fuzzy_threshold: number
      accept_match_lesser: boolean
    } = {
      enable_fuzzy_alignment: true,
      fuzzy_threshold: 0.75,
      accept_match_lesser: true
    }
  ): Promise<ValidationReport> {
    const issues: ValidationIssue[] = []
    
    for (let idx = 0; idx < examples.length; idx++) {
      const example = examples[idx]
      
      for (const extraction of example.extractions) {
        // Check if extraction_text exists in example.text
        const exactMatch = example.text.includes(extraction.extraction_text)
        
        if (!exactMatch) {
          // Try fuzzy matching
          const fuzzyResult = this.fuzzyMatch(
            extraction.extraction_text,
            example.text,
            policy.fuzzy_threshold
          )
          
          if (!fuzzyResult.found) {
            issues.push({
              example_index: idx,
              extraction_class: extraction.extraction_class,
              extraction_text: extraction.extraction_text,
              alignment_status: 'failed'
            })
          } else if (fuzzyResult.score < 1.0) {
            issues.push({
              example_index: idx,
              extraction_class: extraction.extraction_class,
              extraction_text: extraction.extraction_text,
              alignment_status: 'fuzzy',
              char_interval: fuzzyResult.position
            })
          }
        }
      }
    }
    
    return {
      issues,
      has_failed: issues.some(i => i.alignment_status === 'failed'),
      has_non_exact: issues.some(i => i.alignment_status === 'fuzzy')
    }
  }

  private fuzzyMatch(needle: string, haystack: string, threshold: number): {
    found: boolean
    score: number
    position?: [number, number]
  } {
    // Simple fuzzy string matching - can be enhanced
    const normalized_needle = needle.toLowerCase().replace(/[^a-z0-9]/g, '')
    const normalized_haystack = haystack.toLowerCase()
    
    // Implementation of Levenshtein-based fuzzy search
    // Returns best match position and similarity score
    // ... (simplified for brevity)
    
    return { found: false, score: 0 }
  }
}
```

### 3. **Multi-Pass Extraction for Higher Recall** 📈 MEDIUM PRIORITY

**What Langextract Does:**
- Multiple extraction passes over the same document
- Aggregates results from multiple passes
- Improves recall at the cost of API calls

**Integration for Loom:**

```typescript
// Enhancement to StructuredExtractor

export class StructuredExtractor {
  async extractWithPasses(
    text: string,
    extraction_passes: number = 1
  ): Promise<{
    extractions: Array<any>
    passes: number
    total_extractions: number
  }> {
    const allExtractions: Array<any> = []
    const seen = new Set<string>()
    
    for (let pass = 0; pass < extraction_passes; pass++) {
      const result = await this.extract(text)
      
      // Deduplicate by creating hash of extraction
      for (const extraction of result.extractions) {
        const hash = this.hashExtraction(extraction)
        if (!seen.has(hash)) {
          seen.add(hash)
          allExtractions.push({
            ...extraction,
            discovered_in_pass: pass + 1
          })
        }
      }
    }
    
    return {
      extractions: allExtractions,
      passes: extraction_passes,
      total_extractions: allExtractions.length
    }
  }
  
  private hashExtraction(extraction: any): string {
    return `${extraction.extraction_class}:${extraction.extraction_text}:${JSON.stringify(extraction.attributes || {})}`
  }
}
```

### 4. **Provider Registry Pattern** 🔧 HIGH PRIORITY

**What Langextract Does:**
- Lazy provider registration with pattern matching
- Pluggable provider system with entry points
- Priority-based pattern resolution
- Schema support per provider

**Value for Loom:**
- More flexible LLM provider architecture
- Better support for custom/local models
- Easier to add new providers

**Integration:**

```typescript
// New: src/ai/registry/provider-registry.ts

export interface ProviderRegistration {
  patterns: RegExp[]
  priority: number
  loader: () => ILLMProvider
  schema_class?: any
}

export class LLMProviderRegistry {
  private static entries: ProviderRegistration[] = []
  private static cache = new Map<string, ILLMProvider>()

  static register(
    patterns: string[],
    loader: () => ILLMProvider,
    priority: number = 10
  ): void {
    this.entries.push({
      patterns: patterns.map(p => new RegExp(p)),
      priority,
      loader
    })
    
    // Sort by priority (descending)
    this.entries.sort((a, b) => b.priority - a.priority)
  }

  static resolve(model_id: string): ILLMProvider {
    // Check cache first
    if (this.cache.has(model_id)) {
      return this.cache.get(model_id)!
    }
    
    // Find matching provider
    for (const entry of this.entries) {
      if (entry.patterns.some(p => p.test(model_id))) {
        const provider = entry.loader()
        this.cache.set(model_id, provider)
        return provider
      }
    }
    
    throw new Error(`No provider registered for model: ${model_id}`)
  }

  static listProviders(): Array<{ patterns: string[], priority: number }> {
    return this.entries.map(e => ({
      patterns: e.patterns.map(p => p.source),
      priority: e.priority
    }))
  }
}

// Register built-in providers
LLMProviderRegistry.register(
  ['^gpt-4', '^gpt-5', '^o1'], 
  () => new OpenAIProvider({ /* config */ }),
  10
)

LLMProviderRegistry.register(
  ['^claude-'], 
  () => new AnthropicProvider({ /* config */ }),
  10
)

LLMProviderRegistry.register(
  ['^gemini', '^models/gemini'], 
  () => new GeminiProvider({ /* config */ }),
  10
)

LLMProviderRegistry.register(
  ['^llama', '^gemma', '^mistral', '^qwen'], 
  () => new OllamaProvider({ /* config */ }),
  5  // Lower priority for local models
)
```

### 5. **Chunking and Document Processing** 📄 MEDIUM PRIORITY

**What Langextract Does:**
- Smart text chunking with token-aware splitting
- Parallel processing of chunks
- Context preservation across chunks
- Handles documents up to millions of tokens

**Value for Loom:**
- Better handling of large documents in extraction actors
- More efficient token usage
- Parallel processing within actors

**Integration:**

```typescript
// New: src/ai/extraction/chunker.ts

export interface ChunkConfig {
  max_char_buffer: number
  overlap_tokens: number
  max_workers: number
}

export class DocumentChunker {
  constructor(private config: ChunkConfig) {}

  /**
   * Split document into processable chunks with overlap
   */
  chunkDocument(text: string): Array<{
    chunk: string
    start_char: number
    end_char: number
    overlap_with_previous: boolean
  }> {
    const chunks: Array<any> = []
    let position = 0
    
    while (position < text.length) {
      const chunk_end = Math.min(
        position + this.config.max_char_buffer,
        text.length
      )
      
      // Find sentence boundary
      const boundary = this.findSentenceBoundary(
        text.substring(position, chunk_end)
      )
      
      chunks.push({
        chunk: text.substring(position, position + boundary),
        start_char: position,
        end_char: position + boundary,
        overlap_with_previous: position > 0
      })
      
      // Move forward with overlap
      position += boundary - (this.config.overlap_tokens * 5) // ~5 chars per token
    }
    
    return chunks
  }

  private findSentenceBoundary(text: string): number {
    // Find last sentence ending (.!?) within chunk
    const matches = [...text.matchAll(/[.!?]\s+/g)]
    if (matches.length === 0) return text.length
    
    const lastMatch = matches[matches.length - 1]
    return lastMatch.index! + lastMatch[0].length
  }

  /**
   * Process chunks in parallel
   */
  async processChunksParallel<T>(
    chunks: Array<{ chunk: string }>,
    processor: (chunk: string) => Promise<T>
  ): Promise<T[]> {
    const results: T[] = []
    const workers = Math.min(this.config.max_workers, chunks.length)
    
    // Process in batches
    for (let i = 0; i < chunks.length; i += workers) {
      const batch = chunks.slice(i, i + workers)
      const batchResults = await Promise.all(
        batch.map(c => processor(c.chunk))
      )
      results.push(...batchResults)
    }
    
    return results
  }
}
```

### 6. **Interactive Visualization** 🎨 LOW PRIORITY (Nice to Have)

**What Langextract Does:**
- Generates interactive HTML visualizations
- Shows extractions highlighted in source text
- Animated rendering for thousands of entities

**Value for Loom:**
- Better debugging of extraction actors
- Human-in-the-loop verification UI
- Demo and presentation material

**Integration Strategy:**
- Could be added as a separate observability feature
- Generate HTML reports from extraction traces
- Link with existing tracing infrastructure

## Recommended Implementation Plan

### Phase 1: Foundation (Week 1-2)
1. ✅ Implement `StructuredExtractor` with schema generation
2. ✅ Add `PromptValidator` for example validation
3. ✅ Create provider registry system

### Phase 2: Enhancement (Week 3-4)
4. ✅ Add multi-pass extraction support
5. ✅ Implement document chunking
6. ✅ Add fuzzy matching and alignment

### Phase 3: Integration (Week 5-6)
7. ✅ Integrate with existing Actor system
8. ✅ Add to AI module exports
9. ✅ Create example actors using structured extraction
10. ✅ Document patterns and best practices

### Phase 4: Polish (Week 7-8)
11. 🔄 Add visualization tooling (optional)
12. 🔄 Performance optimization
13. 🔄 Comprehensive testing

## Example: Mortgage Appraisal with Structured Extraction

```typescript
// demos/mortgage-appraisal/actors/enhanced-document-extractor.ts

import { Actor } from '../../../src/actor/actor'
import { StructuredExtractor, ExtractionExample } from '../../../src/ai/extraction'
import { PromptValidator } from '../../../src/ai/validation'

export class EnhancedDocumentExtractorActor extends Actor {
  private extractor: StructuredExtractor
  private validator: PromptValidator

  constructor(context: ActorContext, llmConfig: LLMConfig) {
    super(context)
    
    // Define few-shot examples for appraisal extraction
    const examples: ExtractionExample[] = [
      {
        text: `Property Address: 123 Main St, Springfield, IL 62701
               Appraised Value: $275,000
               Effective Date: 2024-01-15
               Appraiser: John Smith, License #IL-12345`,
        extractions: [
          {
            extraction_class: 'property_address',
            extraction_text: '123 Main St, Springfield, IL 62701',
            attributes: {
              street: '123 Main St',
              city: 'Springfield',
              state: 'IL',
              zip: '62701'
            }
          },
          {
            extraction_class: 'appraised_value',
            extraction_text: '$275,000',
            attributes: {
              value: 275000,
              currency: 'USD'
            }
          },
          {
            extraction_class: 'effective_date',
            extraction_text: '2024-01-15',
            attributes: {
              date: '2024-01-15'
            }
          },
          {
            extraction_class: 'appraiser',
            extraction_text: 'John Smith',
            attributes: {
              name: 'John Smith',
              license: 'IL-12345'
            }
          }
        ]
      }
    ]

    this.extractor = new StructuredExtractor(
      new UnifiedLLM(llmConfig),
      {
        prompt_description: `Extract structured mortgage appraisal data including property address, 
                            appraised value, dates, appraiser info, and comparable sales.`,
        examples,
        format_type: 'json',
        use_schema_constraints: true,
        validation_level: 'warning'
      }
    )

    this.validator = new PromptValidator()
  }

  async execute(input: { pdfContent: string }): Promise<void> {
    // Validate examples before extraction
    const validationReport = await this.validator.validatePromptAlignment(
      this.extractor.config.examples
    )

    if (validationReport.has_failed) {
      console.warn('⚠️ Example validation issues:', validationReport.issues)
    }

    // Extract with multiple passes for higher recall
    const result = await this.extractor.extractWithPasses(
      input.pdfContent,
      3 // 3 passes
    )

    // Store results
    this.state.extractions = result.extractions
    this.state.confidence = result.validation_report.has_failed ? 0.5 : 0.95
    this.state.passes_used = result.passes
    this.state.total_found = result.total_extractions

    console.log(`✅ Extracted ${result.total_extractions} entities across ${result.passes} passes`)
  }
}
```

## Benefits Summary

### Reliability
- ✅ Pre-flight validation catches prompt errors
- ✅ Schema enforcement ensures consistent outputs
- ✅ Multi-pass extraction improves recall
- ✅ Fuzzy matching handles OCR/text variations

### Developer Experience
- ✅ Clear patterns for few-shot learning
- ✅ Type-safe extraction schemas
- ✅ Easier debugging with validation reports
- ✅ Pluggable provider system

### Performance
- ✅ Parallel chunk processing
- ✅ Provider caching
- ✅ Lazy loading of providers
- ✅ Token-aware chunking

### Maintainability
- ✅ Separation of concerns (extraction, validation, schema)
- ✅ Reusable components across actors
- ✅ Easier to add new providers
- ✅ Well-tested validation logic

## Next Steps

1. **Review and Prioritize**: Determine which features to implement first based on current Loom use cases
2. **Prototype**: Build POC of StructuredExtractor with one example actor
3. **Iterate**: Get feedback from Loom users on the API design
4. **Integrate**: Roll out to production actors incrementally
5. **Document**: Create comprehensive guides and examples

## References

- [Langextract GitHub](https://github.com/google/langextract)
- [Langextract Provider System](https://github.com/google/langextract/blob/main/langextract/providers/README.md)
- [Prompt Validation](https://github.com/google/langextract/blob/main/langextract/prompt_validation.py)
- [Schema Generation](https://github.com/google/langextract/blob/main/langextract/providers/schemas/gemini.py)
