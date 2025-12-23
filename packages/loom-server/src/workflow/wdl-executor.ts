/**
 * WDL Workflow Executor
 * 
 * Executes Azure Logic Apps Workflow Definition Language workflows
 */

import type { WasmExecutor } from '../execution/wasm-executor';
import type {
  WorkflowDefinition,
  WorkflowAction,
  WorkflowActionResult,
  WorkflowExecutionContext,
  WorkflowExecutionResult,
} from './wdl-types';
import { WdlExpressionParser } from './wdl-expression-parser';
import { v4 as uuidv4 } from 'uuid';

export class WdlWorkflowExecutor {
  constructor(private wasmExecutor: WasmExecutor) {}

  /**
   * Execute a workflow definition
   */
  async execute(
    workflow: WorkflowDefinition,
    triggerInputs: any = {}
  ): Promise<WorkflowExecutionResult> {
    const workflowId = uuidv4();
    const startTime = new Date().toISOString();
    
    const context: WorkflowExecutionContext = {
      parameters: this.resolveParameters(workflow.parameters || {}, triggerInputs.parameters || {}),
      actions: {},
      trigger: triggerInputs,
    };

    try {
      // Execute actions in dependency order
      await this.executeActions(workflow.actions, context);

      // Resolve outputs
      const outputs = this.resolveOutputs(workflow.outputs || {}, context);

      const endTime = new Date().toISOString();
      return {
        workflowId,
        status: 'Succeeded',
        startTime,
        endTime,
        duration: new Date(endTime).getTime() - new Date(startTime).getTime(),
        actions: context.actions,
        outputs,
      };
    } catch (error: any) {
      const endTime = new Date().toISOString();
      return {
        workflowId,
        status: 'Failed',
        startTime,
        endTime,
        duration: new Date(endTime).getTime() - new Date(startTime).getTime(),
        actions: context.actions,
        error: {
          message: error.message,
          failedAction: error.actionName,
        },
      };
    }
  }

  /**
   * Resolve workflow parameters with defaults
   */
  private resolveParameters(
    definitions: Record<string, any>,
    inputs: Record<string, any>
  ): Record<string, any> {
    const resolved: Record<string, any> = {};
    
    for (const [key, def] of Object.entries(definitions)) {
      resolved[key] = inputs[key] ?? def.defaultValue;
    }
    
    return resolved;
  }

  /**
   * Execute actions in dependency order
   */
  private async executeActions(
    actions: Record<string, WorkflowAction>,
    context: WorkflowExecutionContext
  ): Promise<void> {
    const executed = new Set<string>();
    const pending = Object.keys(actions);

    while (pending.length > 0) {
      const executable = pending.filter(name => {
        const action = actions[name];
        // Check if dependencies are satisfied
        if (!action.runAfter) return true;
        
        for (const [dep, statuses] of Object.entries(action.runAfter)) {
          const depResult = context.actions[dep];
          if (!depResult || !statuses.includes(depResult.status)) {
            return false;
          }
        }
        return true;
      });

      if (executable.length === 0) {
        throw new Error('Circular dependency or unsatisfied dependencies detected');
      }

      // Execute all ready actions in parallel
      await Promise.all(
        executable.map(name => this.executeAction(name, actions[name], context))
      );

      executable.forEach(name => {
        executed.add(name);
        const index = pending.indexOf(name);
        if (index > -1) pending.splice(index, 1);
      });
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(
    name: string,
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<void> {
    const startTime = new Date().toISOString();

    try {
      let result: any;

      switch (action.type) {
        case 'actor':
          result = await this.executeActorAction(action, context);
          break;
        
        case 'condition':
          result = await this.executeConditionAction(action, context);
          break;
        
        case 'foreach':
          result = await this.executeForEachAction(action, context);
          break;
        
        case 'http':
          result = await this.executeHttpAction(action, context);
          break;
        
        case 'scope':
          result = await this.executeScopeAction(action, context);
          break;
        
        default:
          throw new Error(`Unsupported action type: ${action.type}`);
      }

      const endTime = new Date().toISOString();
      context.actions[name] = {
        status: 'Succeeded',
        outputs: result,
        startTime,
        endTime,
        duration: new Date(endTime).getTime() - new Date(startTime).getTime(),
      };
    } catch (error: any) {
      const endTime = new Date().toISOString();
      context.actions[name] = {
        status: 'Failed',
        error: {
          message: error.message,
          code: error.code || 'ACTION_FAILED',
        },
        startTime,
        endTime,
        duration: new Date(endTime).getTime() - new Date(startTime).getTime(),
      };
      
      // Mark error with action name for workflow-level error
      error.actionName = name;
      throw error;
    }
  }

  /**
   * Execute actor action (call Loom actor)
   */
  private async executeActorAction(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<any> {
    if (!action.actorType) {
      throw new Error('Actor action requires actorType');
    }

    const input = this.resolveInputs(action.inputs, context);

    const result = await this.wasmExecutor.execute({
      actorType: action.actorType,
      version: action.actorVersion,
      input,
    });

    if (result.status === 'failed') {
      throw new Error(result.error?.message || 'Actor execution failed');
    }

    return result.result;
  }

  /**
   * Execute condition action (if/else)
   */
  private async executeConditionAction(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<any> {
    if (!action.expression) {
      throw new Error('Condition action requires expression');
    }

    const condition = WdlExpressionParser.evaluate(action.expression, context);

    if (condition && action.actions) {
      await this.executeActions(action.actions, context);
    } else if (!condition && action.else?.actions) {
      await this.executeActions(action.else.actions, context);
    }

    return { condition, executed: condition ? 'if' : 'else' };
  }

  /**
   * Execute forEach action (loop)
   */
  private async executeForEachAction(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<any> {
    if (!action.foreach) {
      throw new Error('ForEach action requires foreach expression');
    }

    const items = WdlExpressionParser.evaluate(action.foreach, context);
    if (!Array.isArray(items)) {
      throw new Error('ForEach expression must evaluate to array');
    }

    const results = [];
    
    // Execute sequentially (can make parallel with Promise.all)
    for (const item of items) {
      const itemContext = { ...context, item };
      if (action.actions) {
        await this.executeActions(action.actions, itemContext);
      }
      results.push(itemContext.actions);
    }

    return { count: items.length, results };
  }

  /**
   * Execute HTTP action
   */
  private async executeHttpAction(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<any> {
    const uri = this.resolveValue(action.uri, context);
    const method = action.method || 'GET';
    const headers = this.resolveInputs(action.headers, context);
    const body = this.resolveInputs(action.body, context);

    const response = await fetch(uri, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  }

  /**
   * Execute scope action (group of actions)
   */
  private async executeScopeAction(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<any> {
    if (!action.actions) {
      throw new Error('Scope action requires actions');
    }

    await this.executeActions(action.actions, context);
    return { success: true };
  }

  /**
   * Resolve action inputs (evaluate expressions)
   */
  private resolveInputs(inputs: any, context: WorkflowExecutionContext): any {
    if (typeof inputs === 'string') {
      return WdlExpressionParser.evaluate(inputs, context);
    }
    
    if (Array.isArray(inputs)) {
      return inputs.map(item => this.resolveInputs(item, context));
    }
    
    if (inputs && typeof inputs === 'object') {
      const resolved: any = {};
      for (const [key, value] of Object.entries(inputs)) {
        resolved[key] = this.resolveInputs(value, context);
      }
      return resolved;
    }
    
    return inputs;
  }

  /**
   * Resolve a single value (string or expression)
   */
  private resolveValue(value: any, context: WorkflowExecutionContext): any {
    if (typeof value === 'string' && value.startsWith('@')) {
      return WdlExpressionParser.evaluate(value, context);
    }
    return value;
  }

  /**
   * Resolve workflow outputs
   */
  private resolveOutputs(
    outputs: Record<string, any>,
    context: WorkflowExecutionContext
  ): Record<string, any> {
    const resolved: Record<string, any> = {};
    
    for (const [key, output] of Object.entries(outputs)) {
      resolved[key] = this.resolveValue(output.value, context);
    }
    
    return resolved;
  }
}
