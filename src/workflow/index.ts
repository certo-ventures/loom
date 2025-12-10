/**
 * Workflow Definition Language
 * 
 * Azure Logic Apps compatible workflow engine for orchestrating actors.
 * - Versioned workflow definitions
 * - Store/retrieve from Cosmos DB
 * - Compile & validate before execution
 * - Execute as actor orchestrations
 */

// ============================================================================
// WORKFLOW DEFINITION (Azure Logic Apps Compatible)
// ============================================================================

export interface WorkflowParameter {
  type: 'string' | 'int' | 'float' | 'bool' | 'object' | 'array';
  defaultValue?: any;
  allowedValues?: any[];
  metadata?: {
    description?: string;
  };
}

export interface WorkflowTrigger {
  type: 'manual' | 'schedule' | 'event';
  inputs?: any;
}

export interface WorkflowAction {
  type: 'Actor' | 'Activity' | 'AI' | 'Http' | 'Compose' | 'If' | 'Foreach' | 'Parallel';
  inputs: any;
  runAfter?: { [actionName: string]: string[] }; // dependency: ['Succeeded', 'Failed', etc]
}

export interface WorkflowDefinition {
  $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#';
  contentVersion: string; // Semantic version: "1.0.0"
  parameters?: { [name: string]: WorkflowParameter };
  triggers: { [name: string]: WorkflowTrigger };
  actions: { [name: string]: WorkflowAction };
  outputs?: { [name: string]: any };
}

// ============================================================================
// WORKFLOW METADATA & VERSIONING
// ============================================================================

export interface WorkflowMetadata {
  id: string; // workflow name
  version: string; // semantic version: "1.2.3"
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  description?: string;
  tags?: string[];
}

export interface WorkflowVersion {
  metadata: WorkflowMetadata;
  definition: WorkflowDefinition;
}

// ============================================================================
// WORKFLOW STORE (Cosmos DB)
// ============================================================================

export interface WorkflowStore {
  // Create new workflow (version 1.0.0)
  create(id: string, definition: WorkflowDefinition, metadata?: Partial<WorkflowMetadata>): Promise<WorkflowVersion>;
  
  // Get specific version (or latest if version not specified)
  get(id: string, version?: string): Promise<WorkflowVersion | null>;
  
  // List all versions of a workflow
  listVersions(id: string): Promise<WorkflowMetadata[]>;
  
  // Publish new version (auto-increment based on changes: major.minor.patch)
  publish(id: string, definition: WorkflowDefinition, versionBump: 'major' | 'minor' | 'patch'): Promise<WorkflowVersion>;
  
  // Delete workflow (all versions)
  delete(id: string): Promise<void>;
}

export class InMemoryWorkflowStore implements WorkflowStore {
  private workflows = new Map<string, WorkflowVersion[]>(); // id -> versions

  async create(id: string, definition: WorkflowDefinition, metadata?: Partial<WorkflowMetadata>): Promise<WorkflowVersion> {
    if (this.workflows.has(id)) {
      throw new Error(`Workflow ${id} already exists`);
    }

    const version: WorkflowVersion = {
      metadata: {
        id,
        version: '1.0.0',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...metadata,
      },
      definition,
    };

    this.workflows.set(id, [version]);
    return version;
  }

  async get(id: string, version?: string): Promise<WorkflowVersion | null> {
    const versions = this.workflows.get(id);
    if (!versions) return null;

    if (version) {
      return versions.find(v => v.metadata.version === version) || null;
    }

    // Return latest version
    return versions[versions.length - 1];
  }

  async listVersions(id: string): Promise<WorkflowMetadata[]> {
    const versions = this.workflows.get(id);
    return versions ? versions.map(v => v.metadata) : [];
  }

  async publish(id: string, definition: WorkflowDefinition, versionBump: 'major' | 'minor' | 'patch'): Promise<WorkflowVersion> {
    const versions = this.workflows.get(id);
    if (!versions) {
      throw new Error(`Workflow ${id} not found`);
    }

    const latest = versions[versions.length - 1];
    const newVersion = this.bumpVersion(latest.metadata.version, versionBump);

    const version: WorkflowVersion = {
      metadata: {
        ...latest.metadata,
        version: newVersion,
        updatedAt: new Date(),
      },
      definition,
    };

    versions.push(version);
    return version;
  }

  async delete(id: string): Promise<void> {
    this.workflows.delete(id);
  }

  private bumpVersion(current: string, bump: 'major' | 'minor' | 'patch'): string {
    const [major, minor, patch] = current.split('.').map(Number);
    
    switch (bump) {
      case 'major': return `${major + 1}.0.0`;
      case 'minor': return `${major}.${minor + 1}.0`;
      case 'patch': return `${major}.${minor}.${patch + 1}`;
    }
  }
}

// ============================================================================
// WORKFLOW COMPILER & VALIDATOR
// ============================================================================

export interface CompilationError {
  action?: string;
  message: string;
}

export interface CompilationResult {
  valid: boolean;
  errors: CompilationError[];
  warnings?: string[];
}

export class WorkflowCompiler {
  compile(workflow: WorkflowDefinition): CompilationResult {
    const errors: CompilationError[] = [];

    // Validate triggers
    if (!workflow.triggers || Object.keys(workflow.triggers).length === 0) {
      errors.push({ message: 'Workflow must have at least one trigger' });
    }

    // Validate actions
    if (!workflow.actions || Object.keys(workflow.actions).length === 0) {
      errors.push({ message: 'Workflow must have at least one action' });
    }

    // Validate runAfter dependencies
    const actionNames = new Set(Object.keys(workflow.actions || {}));
    for (const [name, action] of Object.entries(workflow.actions || {})) {
      if (action.runAfter) {
        for (const dep of Object.keys(action.runAfter)) {
          if (!actionNames.has(dep)) {
            errors.push({ action: name, message: `Unknown dependency: ${dep}` });
          }
        }
      }
    }

    // Detect cycles in runAfter
    const cycleError = this.detectCycles(workflow.actions || {});
    if (cycleError) {
      errors.push(cycleError);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private detectCycles(actions: { [name: string]: WorkflowAction }): CompilationError | null {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycle = (action: string): boolean => {
      if (recStack.has(action)) return true;
      if (visited.has(action)) return false;

      visited.add(action);
      recStack.add(action);

      const deps = Object.keys(actions[action]?.runAfter || {});
      for (const dep of deps) {
        if (hasCycle(dep)) return true;
      }

      recStack.delete(action);
      return false;
    };

    for (const action of Object.keys(actions)) {
      if (hasCycle(action)) {
        return { message: 'Circular dependency detected in runAfter' };
      }
    }

    return null;
  }
}

// ============================================================================
// WORKFLOW EXECUTOR (Runs workflows as actor orchestrations)
// ============================================================================

export interface WorkflowExecutionContext {
  workflowId: string;
  instanceId: string;
  parameters: { [name: string]: any };
  actions: { [name: string]: any }; // Action outputs
  variables: { [name: string]: any };
}

// Dependencies for real execution
export interface WorkflowExecutorDependencies {
  discoveryService?: any; // DiscoveryService for routing actor calls
  activityStore?: any; // ActivityStore for executing activities
  messageQueue?: any; // Queue for async operations
}

export interface WorkflowExecutor {
  // Execute workflow (returns workflow instance ID)
  execute(workflow: WorkflowDefinition, parameters?: { [name: string]: any }): Promise<string>;
  
  // Get execution status
  getStatus(instanceId: string): Promise<'running' | 'completed' | 'failed'>;
  
  // Get execution result
  getResult(instanceId: string): Promise<any>;
}

// Simple in-memory executor for testing
export class InMemoryWorkflowExecutor implements WorkflowExecutor {
  private executions = new Map<string, { status: 'running' | 'completed' | 'failed'; result: any }>();
  private nextInstanceId = 1;
  private deps: WorkflowExecutorDependencies;

  constructor(deps: WorkflowExecutorDependencies = {}) {
    this.deps = deps;
  }

  async execute(workflow: WorkflowDefinition, parameters?: { [name: string]: any }): Promise<string> {
    const instanceId = `wf-${this.nextInstanceId++}`;
    
    this.executions.set(instanceId, { status: 'running', result: null });

    // Execute async (simplified - real version would use WorkflowActor)
    this.executeAsync(instanceId, workflow, parameters || {}).catch(err => {
      this.executions.set(instanceId, { status: 'failed', result: err.message });
    });

    return instanceId;
  }

  async getStatus(instanceId: string): Promise<'running' | 'completed' | 'failed'> {
    const exec = this.executions.get(instanceId);
    return exec?.status || 'failed';
  }

  async getResult(instanceId: string): Promise<any> {
    const exec = this.executions.get(instanceId);
    return exec?.result;
  }

  private async executeAsync(instanceId: string, workflow: WorkflowDefinition, parameters: any): Promise<void> {
    const context: WorkflowExecutionContext = {
      workflowId: 'test',
      instanceId,
      parameters,
      actions: {},
      variables: {},
    };

    // Execute actions in dependency order
    const executed = new Set<string>();
    const actionNames = Object.keys(workflow.actions);

    while (executed.size < actionNames.length) {
      let madeProgress = false;

      for (const [name, action] of Object.entries(workflow.actions)) {
        if (executed.has(name)) continue;

        // Check if dependencies are satisfied
        const deps = Object.keys(action.runAfter || {});
        const depsReady = deps.every(d => executed.has(d));

        if (depsReady) {
          // Execute action (REAL execution!)
          context.actions[name] = await this.executeAction(name, action, context);
          executed.add(name);
          madeProgress = true;
        }
      }

      if (!madeProgress) {
        throw new Error('Cannot make progress - missing dependencies');
      }
    }

    // Set outputs
    const result = workflow.outputs || {};
    this.executions.set(instanceId, { status: 'completed', result });
  }

  private async executeAction(name: string, action: WorkflowAction, context: WorkflowExecutionContext): Promise<any> {
    // REAL action execution!
    switch (action.type) {
      case 'Compose':
        // Simple value composition
        return this.evaluateInputs(action.inputs, context);

      case 'Actor': {
        // Call actor via discovery service
        if (!this.deps.discoveryService) {
          // Fallback for testing without discovery
          return { status: 'success', output: 'actor-result' };
        }

        const { actorType, actorId, method, args } = action.inputs;
        
        // Route to actor instance
        const targetActorId = actorId || await this.deps.discoveryService.routeToActor(actorType);
        
        if (!targetActorId) {
          throw new Error(`No available actor of type ${actorType}`);
        }

        // Send message to actor (would use message queue in real system)
        const message = {
          targetActorId,
          method,
          args: this.evaluateInputs(args, context),
        };

        // Enqueue and wait for result
        if (this.deps.messageQueue) {
          const resultPromise = this.deps.messageQueue.sendAndWait(message);
          return await resultPromise;
        }

        return { status: 'success', actorId: targetActorId };
      }

      case 'Activity': {
        // Execute activity (WASM)
        if (!this.deps.activityStore) {
          // Fallback for testing without activity store
          return { status: 'success', output: 'activity-result' };
        }

        const { activityName, input } = action.inputs;
        const evaluatedInput = this.evaluateInputs(input, context);

        // Create activity instance
        const activityId = `${context.instanceId}-${name}`;
        await this.deps.activityStore.create({
          activityId,
          name: activityName,
          input: evaluatedInput,
          status: 'pending',
          createdAt: new Date(),
        });

        // Execute activity (simplified - real version would use WasmExecutor)
        const result = await this.deps.activityStore.execute(activityId);
        return result;
      }

      case 'AI': {
        // AI action - calls AIAgent
        const { model, prompt, systemPrompt, temperature } = action.inputs;
        
        if (!this.deps.discoveryService) {
          return { status: 'success', output: 'ai-response' };
        }

        // Route to AI agent
        const agentId = await this.deps.discoveryService.routeToActor('AIAgent');
        
        if (!agentId) {
          throw new Error('No AI agent available');
        }

        const message = {
          targetActorId: agentId,
          method: 'chat',
          args: {
            message: this.evaluateInputs(prompt, context),
            systemPrompt,
            temperature,
            model,
          },
        };

        if (this.deps.messageQueue) {
          return await this.deps.messageQueue.sendAndWait(message);
        }

        return { status: 'success', agentId };
      }

      case 'Http': {
        // HTTP request
        const { method, url, headers, body } = action.inputs;
        
        // Simple fetch (would add retries, timeouts in real system)
        const response = await fetch(this.evaluateInputs(url, context), {
          method: method || 'GET',
          headers: this.evaluateInputs(headers, context),
          body: body ? JSON.stringify(this.evaluateInputs(body, context)) : undefined,
        });

        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.json().catch(() => response.text()),
        };
      }

      case 'If': {
        // Conditional execution
        const { condition, actions: thenActions, else: elseActions } = action.inputs;
        const conditionResult = this.evaluateExpression(condition, context);

        const branchActions = conditionResult ? thenActions : elseActions;
        if (!branchActions) return { conditionResult };

        // Execute branch actions
        const results: any = {};
        for (const [branchName, branchAction] of Object.entries(branchActions)) {
          results[branchName] = await this.executeAction(branchName, branchAction as WorkflowAction, context);
        }

        return { conditionResult, results };
      }

      case 'Foreach': {
        // Loop over collection
        const { items, actions: loopActions } = action.inputs;
        const collection = this.evaluateInputs(items, context);

        if (!Array.isArray(collection)) {
          throw new Error('Foreach requires an array');
        }

        const results = [];
        for (const item of collection) {
          const itemContext = {
            ...context,
            variables: { ...context.variables, item },
          };

          const itemResults: any = {};
          for (const [loopName, loopAction] of Object.entries(loopActions)) {
            itemResults[loopName] = await this.executeAction(loopName, loopAction as WorkflowAction, itemContext);
          }
          results.push(itemResults);
        }

        return results;
      }

      case 'Parallel': {
        // Execute actions in parallel
        const { actions: parallelActions } = action.inputs;
        
        const promises = Object.entries(parallelActions).map(([parallelName, parallelAction]) =>
          this.executeAction(parallelName, parallelAction as WorkflowAction, context)
        );

        const results = await Promise.all(promises);
        
        return Object.fromEntries(
          Object.keys(parallelActions).map((name, i) => [name, results[i]])
        );
      }

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  // Simple expression evaluation (would use full @{} parser in real system)
  private evaluateInputs(inputs: any, context: WorkflowExecutionContext): any {
    if (typeof inputs === 'string') {
      return this.evaluateExpression(inputs, context);
    }
    
    if (Array.isArray(inputs)) {
      return inputs.map(item => this.evaluateInputs(item, context));
    }
    
    if (inputs && typeof inputs === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(inputs)) {
        result[key] = this.evaluateInputs(value, context);
      }
      return result;
    }
    
    return inputs;
  }

  private evaluateExpression(expr: string, context: WorkflowExecutionContext): any {
    // Simple expression evaluator - real version would parse @{} syntax
    if (typeof expr !== 'string') return expr;

    // @parameters('name')
    const paramMatch = expr.match(/@parameters\(['"](\w+)['"]\)/);
    if (paramMatch) {
      return context.parameters[paramMatch[1]];
    }

    // @actions('name').output
    const actionMatch = expr.match(/@actions\(['"](\w+)['"]\)\.(\w+)/);
    if (actionMatch) {
      const actionResult = context.actions[actionMatch[1]];
      return actionResult?.[actionMatch[2]];
    }

    // @variables('name')
    const varMatch = expr.match(/@variables\(['"](\w+)['"]\)/);
    if (varMatch) {
      return context.variables[varMatch[1]];
    }

    return expr;
  }
}
