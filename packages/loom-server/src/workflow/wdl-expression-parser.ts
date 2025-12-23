/**
 * WDL Expression Parser
 * 
 * Parses Azure Logic Apps expressions like:
 * - @parameters('name')
 * - @actions('step1').outputs.result
 * - @equals(body('step1').status, 'ok')
 */

import type { WorkflowExecutionContext } from './wdl-types';

export class WdlExpressionParser {
  /**
   * Evaluate a WDL expression
   */
  static evaluate(expression: string, context: WorkflowExecutionContext): any {
    if (!expression?.startsWith('@')) {
      return expression; // Literal value
    }

    // Remove @ prefix
    const expr = expression.slice(1);

    try {
      // Parse function calls: parameters('name'), actions('step1').outputs
      return this.parseFunction(expr, context);
    } catch (error: any) {
      throw new Error(`Expression evaluation failed: ${error.message}`);
    }
  }

  /**
   * Parse function expressions
   */
  private static parseFunction(expr: string, context: WorkflowExecutionContext): any {
    // parameters('key')
    if (expr.startsWith('parameters(')) {
      const key = this.extractStringArg(expr, 'parameters');
      return context.parameters[key];
    }

    // actions('actionName')
    if (expr.startsWith('actions(')) {
      const actionName = this.extractStringArg(expr, 'actions');
      const rest = this.getRest(expr, 'actions');
      const action = context.actions[actionName];
      return rest ? this.navigatePath(action, rest) : action;
    }

    // body('actionName') - shortcut for actions().outputs
    if (expr.startsWith('body(')) {
      const actionName = this.extractStringArg(expr, 'body');
      const rest = this.getRest(expr, 'body');
      const outputs = context.actions[actionName]?.outputs;
      return rest ? this.navigatePath(outputs, rest) : outputs;
    }

    // trigger()
    if (expr.startsWith('trigger()')) {
      const rest = expr.slice('trigger()'.length);
      return rest ? this.navigatePath(context.trigger, rest) : context.trigger;
    }

    // equals(a, b)
    if (expr.startsWith('equals(')) {
      const [a, b] = this.extractFunctionArgs(expr, 'equals', 2);
      const valA = this.evaluate(`@${a}`, context);
      const valB = this.evaluate(`@${b}`, context);
      return valA === valB;
    }

    // concat(str1, str2, ...)
    if (expr.startsWith('concat(')) {
      const args = this.extractFunctionArgs(expr, 'concat');
      return args.map(arg => this.evaluate(`@${arg}`, context)).join('');
    }

    // string(value)
    if (expr.startsWith('string(')) {
      const [arg] = this.extractFunctionArgs(expr, 'string', 1);
      return String(this.evaluate(`@${arg}`, context));
    }

    // int(value)
    if (expr.startsWith('int(')) {
      const [arg] = this.extractFunctionArgs(expr, 'int', 1);
      return parseInt(this.evaluate(`@${arg}`, context), 10);
    }

    // variables('varName') - not implementing variables for now
    throw new Error(`Unsupported expression: ${expr}`);
  }

  /**
   * Extract string argument from function: parameters('name') -> 'name'
   */
  private static extractStringArg(expr: string, funcName: string): string {
    const start = expr.indexOf('(') + 1;
    const end = expr.indexOf(')', start);
    const arg = expr.slice(start, end).trim();
    return arg.replace(/^['"]|['"]$/g, ''); // Remove quotes
  }

  /**
   * Get rest of expression after function: actions('x').outputs -> .outputs
   */
  private static getRest(expr: string, funcName: string): string {
    const funcEnd = expr.indexOf(')') + 1;
    return expr.slice(funcEnd);
  }

  /**
   * Extract multiple function arguments
   */
  private static extractFunctionArgs(expr: string, funcName: string, expectedCount?: number): string[] {
    const start = expr.indexOf('(') + 1;
    const end = expr.lastIndexOf(')');
    const argsStr = expr.slice(start, end);
    
    // Simple split by comma (doesn't handle nested functions yet)
    const args = argsStr.split(',').map(s => s.trim());
    
    if (expectedCount !== undefined && args.length !== expectedCount) {
      throw new Error(`${funcName}() expects ${expectedCount} arguments, got ${args.length}`);
    }
    
    return args;
  }

  /**
   * Navigate object path: .outputs.result
   */
  private static navigatePath(obj: any, path: string): any {
    if (!path || !obj) return obj;
    
    // Remove leading dot
    path = path.startsWith('.') ? path.slice(1) : path;
    
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    
    return current;
  }
}
