/**
 * Simple Expression Evaluator for Pipeline Conditions
 * 
 * Supports:
 * - JSONPath value extraction: $.item.status
 * - Comparisons: ==, !=, >, <, >=, <=
 * - Logical operators: &&, ||
 * - Literals: strings ("value"), numbers (123), booleans (true/false)
 */

import jp from 'jsonpath'

export class ExpressionEvaluator {
  /**
   * Evaluate a condition expression against a context
   */
  static evaluate(expression: string, context: any): boolean {
    try {
      // Tokenize the expression
      const tokens = this.tokenize(expression)
      
      // Evaluate tokens
      return this.evaluateTokens(tokens, context)
    } catch (error) {
      console.error(`Failed to evaluate expression: ${expression}`, error)
      return false
    }
  }

  /**
   * Tokenize expression into parts
   */
  private static tokenize(expr: string): string[] {
    // Split on operators while preserving them
    return expr
      .replace(/\s*(&&|\|\||==|!=|>=|<=|>|<)\s*/g, ' $1 ')  // Add spaces around operators
      .split(/\s+/)  // Split on whitespace
      .filter(t => t.length > 0)
  }

  /**
   * Evaluate tokenized expression
   */
  private static evaluateTokens(tokens: string[], context: any): boolean {
    // Handle simple binary comparisons first
    if (tokens.length === 3) {
      const [left, op, right] = tokens
      const leftVal = this.getValue(left, context)
      const rightVal = this.getValue(right, context)
      return this.compare(leftVal, op, rightVal)
    }

    // Handle logical operators (&&, ||)
    let result = true
    let currentOp = '&&'
    let i = 0

    while (i < tokens.length) {
      if (tokens[i] === '&&' || tokens[i] === '||') {
        currentOp = tokens[i]
        i++
        continue
      }

      // Get comparison (next 3 tokens)
      if (i + 2 < tokens.length) {
        const left = tokens[i]
        const op = tokens[i + 1]
        const right = tokens[i + 2]
        
        const leftVal = this.getValue(left, context)
        const rightVal = this.getValue(right, context)
        const compResult = this.compare(leftVal, op, rightVal)

        if (currentOp === '&&') {
          result = result && compResult
        } else {
          result = result || compResult
        }

        i += 3
      } else {
        break
      }
    }

    return result
  }

  /**
   * Get value from token (JSONPath, literal, or boolean)
   */
  private static getValue(token: string, context: any): any {
    // JSONPath
    if (token.startsWith('$.')) {
      const value = jp.value(context, token)
      return value
    }

    // String literal
    if (token.startsWith('"') && token.endsWith('"')) {
      return token.slice(1, -1)
    }
    if (token.startsWith("'") && token.endsWith("'")) {
      return token.slice(1, -1)
    }

    // Boolean
    if (token === 'true') return true
    if (token === 'false') return false
    if (token === 'null') return null

    // Number
    if (!isNaN(Number(token))) {
      return Number(token)
    }

    // Default: return as string
    return token
  }

  /**
   * Compare two values with an operator
   */
  private static compare(left: any, op: string, right: any): boolean {
    switch (op) {
      case '==':
        return left == right  // Intentional == for type coercion
      case '!=':
        return left != right
      case '>':
        return left > right
      case '<':
        return left < right
      case '>=':
        return left >= right
      case '<=':
        return left <= right
      default:
        console.warn(`Unknown operator: ${op}`)
        return false
    }
  }
}
