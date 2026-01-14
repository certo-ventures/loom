/**
 * JMESPath Expression Evaluator for Pipeline Conditional Routing
 * 
 * Minimal implementation with maximum functionality:
 * - Boolean condition evaluation (when clauses)
 * - Dynamic actor name resolution
 * - Expression-based input mapping
 * - Custom function support
 * 
 * No compilation, no caching - strings evaluate directly
 */

import jmespath from 'jmespath'

export interface ExpressionContext {
  trigger: any // Original trigger data
  stages: Record<string, any[]> // Stage results by name
  metadata?: {
    executionId?: string
    startTime?: string
    currentStage?: string
  }
}

export interface EvaluationResult<T = any> {
  success: boolean
  value?: T
  error?: string
  expression: string
}

export class ExpressionEvaluator {
  private customFunctions: Map<string, Function> = new Map()
  private contextCache: ExpressionContext | null = null

  /**
   * Evaluate JMESPath expression
   * No compilation - evaluates strings directly
   */
  evaluate<T = any>(expression: string, context: ExpressionContext): EvaluationResult<T> {
    try {
      // Store context for built-in functions
      this.contextCache = context

      const result = jmespath.search(context, expression)

      return {
        success: true,
        value: result as T,
        expression
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        expression
      }
    }
  }

  /**
   * Evaluate boolean condition (for when clauses)
   */
  evaluateCondition(expression: string, context: ExpressionContext): boolean {
    const result = this.evaluate<boolean>(expression, context)

    if (!result.success) {
      console.error(`[Loom] Condition evaluation failed: ${result.error}`)
      console.error(`  Expression: ${expression}`)
      return false // Fail-safe: skip stage if condition errors
    }

    // Coerce to boolean
    return result.value === true
  }

  /**
   * Evaluate dynamic actor name
   */
  evaluateActorName(expression: string, context: ExpressionContext): string | null {
    const result = this.evaluate<string>(expression, context)

    if (!result.success) {
      console.error(`[Loom] Actor evaluation failed: ${result.error}`)
      return null
    }

    return result.value || null
  }

  /**
   * Register custom JMESPath function
   */
  registerFunction(name: string, fn: (...args: any[]) => any): void {
    this.customFunctions.set(name, fn)
  }

  /**
   * Build JMESPath custom function table
   */
  private buildFunctionTable(): Record<string, Function> {
    const functions: Record<string, Function> = {}

    // Register custom functions
    for (const [name, fn] of this.customFunctions.entries()) {
      functions[name] = fn
    }

    // Built-in pipeline helpers
    const self = this
    functions['getStage'] = function(name: string, index: number = 0) {
      return self.contextCache?.stages?.[name]?.[index]
    }

    functions['hasStage'] = function(name: string) {
      return !!self.contextCache?.stages?.[name]?.length
    }

    functions['coalesce'] = function(...values: any[]) {
      return values.find(v => v != null)
    }

    functions['nvl'] = function(value: any, defaultValue: any) {
      return value != null ? value : defaultValue
    }

    return functions
  }
}

/**
 * Singleton instance for pipeline evaluations
 */
export const pipelineExpressionEvaluator = new ExpressionEvaluator()

