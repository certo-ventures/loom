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
  type: 'Actor' | 'Activity' | 'AI' | 'Http' | 'Compose' | 'If' | 'Foreach' | 'Parallel' | 'Until' | 'While' | 'DoUntil' | 'Retry' | 'Scope';
  inputs: any;
  runAfter?: { [actionName: string]: string[] }; // dependency: ['Succeeded', 'Failed', etc]
  timeout?: number; // Timeout in milliseconds
  retryPolicy?: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
  };
  circuitBreaker?: {
    enabled: boolean;
    failureThreshold?: number;
    timeout?: number;
  };
  rateLimit?: {
    requests: number;
    per: 'second' | 'minute' | 'hour';
  };
}

// Loop-specific configurations
export interface LoopLimit {
  count?: number; // Max iterations (default: 60)
  timeout?: string; // ISO 8601 duration (default: PT1H)
}

export interface LoopDelay {
  interval: {
    count: number;
    unit: 'second' | 'minute' | 'hour';
  };
}

export interface RetryPolicyConfig {
  type: 'fixed' | 'exponential' | 'none';
  count: number; // Max retry attempts
  interval: string; // ISO 8601 duration (PT5S = 5 seconds)
  maxInterval?: string; // Max delay for exponential backoff
  minimumInterval?: string; // Min delay for exponential backoff
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
  secretsClient?: any; // SecretsClient for secure credential management
  enableResilience?: boolean; // Enable circuit breakers, rate limiting, etc (default: true)
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
  private resilienceManager: any; // ResilienceManager

  constructor(deps: WorkflowExecutorDependencies = {}) {
    this.deps = deps;
    // Lazy load resilience to avoid circular dependency
    if (deps.enableResilience !== false) {
      this.resilienceManager = this.createResilienceManager();
    }
  }

  private createResilienceManager(): any {
    // Lazy import to avoid adding to main bundle if not used
    try {
      const { ResilienceManager } = require('./resilience');
      return new ResilienceManager();
    } catch {
      return null;
    }
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

  async waitForCompletion(instanceId: string, timeoutMs: number = 30000): Promise<any> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getStatus(instanceId);
      
      if (status === 'completed' || status === 'failed') {
        return await this.getResult(instanceId);
      }
      
      // Wait 10ms before checking again
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    throw new Error(`Workflow execution timed out after ${timeoutMs}ms`);
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

    // Set outputs (return action results for testing)
    const result = context.actions;
    this.executions.set(instanceId, { status: 'completed', result });
  }

  private async executeAction(name: string, action: WorkflowAction, context: WorkflowExecutionContext): Promise<any> {
    // Apply resilience patterns
    return await this.executeWithResilience(name, action, () => this.executeActionCore(name, action, context));
  }

  private async executeWithResilience<T>(name: string, action: WorkflowAction, fn: () => Promise<T>): Promise<T> {
    let execution = fn;

    // Apply timeout
    if (action.timeout) {
      const timeoutMs = action.timeout;
      const originalFn = execution;
      execution = () => Promise.race([
        originalFn(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`Action '${name}' timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
    }

    // Apply rate limiting
    if (action.rateLimit && this.resilienceManager) {
      const limiter = this.resilienceManager.getRateLimiter(`action:${name}`, action.rateLimit);
      await limiter.acquire();
    }

    // Apply circuit breaker
    if (action.circuitBreaker?.enabled && this.resilienceManager) {
      const breaker = this.resilienceManager.getCircuitBreaker(`action:${name}`, action.circuitBreaker);
      const originalFn = execution;
      execution = () => breaker.execute(originalFn);
    }

    // Apply retry policy
    if (action.retryPolicy) {
      const { retryWithBackoff } = require('./resilience');
      return await retryWithBackoff(execution, action.retryPolicy);
    }

    return await execution();
  }

  private async executeActionCore(name: string, action: WorkflowAction, context: WorkflowExecutionContext): Promise<any> {
    // REAL action execution!
    switch (action.type) {
      case 'Compose':
        // Simple value composition
        return await this.evaluateInputs(action.inputs, context);

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
          args: await this.evaluateInputs(args, context),
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
        const evaluatedInput = await this.evaluateInputs(input, context);

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
            message: await this.evaluateInputs(prompt, context),
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
        const response = await fetch(await this.evaluateInputs(url, context), {
          method: method || 'GET',
          headers: await this.evaluateInputs(headers, context),
          body: body ? JSON.stringify(await this.evaluateInputs(body, context)) : undefined,
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
        const conditionResult = await this.evaluateExpression(condition, context);

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
        const collection = await this.evaluateInputs(items, context);

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

      case 'Until': {
        // Loop until condition is TRUE
        return await this.executeUntilLoop(action, context, false);
      }

      case 'While': {
        // Loop while condition is TRUE (convert to Until with inverted condition)
        return await this.executeWhileLoop(action, context);
      }

      case 'DoUntil': {
        // Execute at least once, then loop until condition is TRUE
        return await this.executeUntilLoop(action, context, true);
      }

      case 'Retry': {
        // Retry action with backoff policy
        return await this.executeRetryAction(action, context);
      }

      case 'Scope': {
        // Scope for grouping actions with error handling
        const { actions: scopeActions } = action.inputs;
        const results: any = {};
        let scopeError: any = null;

        try {
          for (const [scopeName, scopeAction] of Object.entries(scopeActions)) {
            results[scopeName] = await this.executeAction(scopeName, scopeAction as WorkflowAction, context);
          }
        } catch (error: any) {
          scopeError = error;
          
          // Check if there's an error handler in runAfter
          if (action.runAfter) {
            const errorHandlers = Object.entries(action.runAfter)
              .filter(([_, conditions]) => conditions.includes('Failed'));
            
            // Execute error handlers
            for (const [handlerName] of errorHandlers) {
              // Error handler would be executed by parent workflow
            }
          }
          
          // Re-throw unless explicitly handled
          throw error;
        }

        return results;
      }

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  // ========================================================================
  // LOOP EXECUTION METHODS
  // ========================================================================

  private async executeUntilLoop(
    action: WorkflowAction,
    context: WorkflowExecutionContext,
    executeFirst: boolean = false
  ): Promise<any> {
    const { condition, actions: loopActions, limit, delay } = action.inputs;
    
    // Default limits
    const maxIterations = limit?.count || 60;
    const timeoutMs = this.parseDuration(limit?.timeout || 'PT1H');
    const startTime = Date.now();

    let iteration = 0;
    let lastResult: any = null;
    const iterationResults: any[] = [];

    // Execute first iteration if DoUntil
    if (executeFirst) {
      const loopContext = this.createLoopContext(context, iteration, lastResult, startTime);
      lastResult = await this.executeLoopActions(loopActions, loopContext);
      iterationResults.push(lastResult);
      iteration++;
    }

    // Loop until condition is TRUE
    while (iteration < maxIterations) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        return {
          status: 'timeout',
          iterations: iteration,
          lastResult,
          results: iterationResults,
          error: `Loop timeout after ${timeoutMs}ms`,
        };
      }

      // Create loop context with special variables
      const loopContext = this.createLoopContext(context, iteration, lastResult, startTime);

      // Execute loop actions FIRST
      lastResult = await this.executeLoopActions(loopActions, loopContext);
      iterationResults.push(lastResult);
      iteration++;

      // Then evaluate condition (stop when TRUE for Until)
      // Use updated iteration count for condition check
      const conditionContext = this.createLoopContext(context, iteration, lastResult, startTime);
      const conditionResult = await this.evaluateExpression(condition, conditionContext);
      
      if (conditionResult) {
        return {
          status: 'completed',
          iterations: iteration,
          lastResult,
          results: iterationResults,
          conditionMet: true,
        };
      }

      // Delay before next iteration
      if (delay) {
        await this.sleep(this.parseDelayMs(delay));
      }
    }

    // Max iterations reached
    return {
      status: 'max-iterations',
      iterations: iteration,
      lastResult,
      results: iterationResults,
      error: `Loop exceeded maximum iterations: ${maxIterations}`,
    };
  }

  private async executeWhileLoop(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<any> {
    // While is syntactic sugar for Until with inverted condition
    const { condition, actions: loopActions, limit, delay } = action.inputs;
    
    // Convert While condition to Until condition by wrapping in NOT
    const invertedCondition = `@not(${condition})`;
    
    const untilAction: WorkflowAction = {
      type: 'Until',
      inputs: {
        condition: invertedCondition,
        actions: loopActions,
        limit,
        delay,
      },
    };

    return await this.executeUntilLoop(untilAction, context, false);
  }

  private async executeRetryAction(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<any> {
    const { action: retryAction, retryPolicy } = action.inputs;
    
    const policy = retryPolicy || {
      type: 'exponential',
      count: 3,
      interval: 'PT1S',
      maxInterval: 'PT1M',
      minimumInterval: 'PT1S',
    };

    const maxRetries = policy.count;
    const baseDelayMs = this.parseDuration(policy.interval);
    const maxDelayMs = policy.maxInterval ? this.parseDuration(policy.maxInterval) : baseDelayMs * 10;
    const minDelayMs = policy.minimumInterval ? this.parseDuration(policy.minimumInterval) : baseDelayMs;

    let attempt = 0;
    let lastError: any = null;
    const attemptResults: any[] = [];

    while (attempt <= maxRetries) {
      try {
        // Execute the action
        const result = await this.executeAction('retry-action', retryAction as WorkflowAction, context);
        
        return {
          status: 'success',
          attempts: attempt + 1,
          result,
          attemptResults,
        };
      } catch (error: any) {
        lastError = error;
        attemptResults.push({
          attempt: attempt + 1,
          error: error.message,
          timestamp: new Date().toISOString(),
        });

        // If we've exhausted retries, throw
        if (attempt >= maxRetries) {
          return {
            status: 'failed',
            attempts: attempt + 1,
            error: lastError.message,
            attemptResults,
          };
        }

        // Calculate delay based on policy type
        let delayMs: number;
        if (policy.type === 'exponential') {
          // Exponential backoff with jitter
          delayMs = Math.min(
            maxDelayMs,
            Math.max(minDelayMs, baseDelayMs * Math.pow(2, attempt))
          );
          // Add jitter (±25%)
          const jitter = delayMs * 0.25 * (Math.random() * 2 - 1);
          delayMs = Math.max(minDelayMs, delayMs + jitter);
        } else {
          // Fixed delay
          delayMs = baseDelayMs;
        }

        // Wait before retry
        await this.sleep(delayMs);
        attempt++;
      }
    }

    // Should never reach here
    throw lastError;
  }

  private createLoopContext(
    context: WorkflowExecutionContext,
    iteration: number,
    lastResult: any,
    startTime: number
  ): WorkflowExecutionContext {
    return {
      ...context,
      variables: {
        ...context.variables,
        loopIndex: iteration,
        loopResult: lastResult,
        loopCount: iteration + 1,
        loopStartTime: startTime,
        loopElapsedMs: Date.now() - startTime,
      },
    };
  }

  private async executeLoopActions(
    loopActions: any,
    context: WorkflowExecutionContext
  ): Promise<any> {
    const results: any = {};
    
    for (const [actionName, loopAction] of Object.entries(loopActions)) {
      results[actionName] = await this.executeAction(
        actionName,
        loopAction as WorkflowAction,
        context
      );
    }

    return results;
  }

  private parseDuration(duration: string): number {
    // Parse ISO 8601 duration: PT1H30M5S
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) {
      throw new Error(`Invalid duration format: ${duration}`);
    }

    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');

    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  private parseDelayMs(delay: LoopDelay): number {
    const { count, unit } = delay.interval;
    
    switch (unit) {
      case 'second': return count * 1000;
      case 'minute': return count * 60 * 1000;
      case 'hour': return count * 3600 * 1000;
      default: throw new Error(`Invalid delay unit: ${unit}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ========================================================================
  // SECRETS MANAGEMENT
  // ========================================================================

  private async getSecretValue(secretName: string): Promise<string> {
    if (!this.deps.secretsClient) {
      throw new Error(`Cannot access secret '${secretName}': No secrets client configured`);
    }

    if (!this.deps.secretsClient.isAvailable()) {
      throw new Error(`Cannot access secret '${secretName}': Secrets client not available`);
    }

    const secret = await this.deps.secretsClient.getSecret(secretName);
    return secret.value;
  }

  // ========================================================================
  // EXPRESSION EVALUATION HELPERS
  // ========================================================================

  private extractFunctionArg(expr: string, funcName: string): string {
    // Extract single argument from @func(arg)
    const start = expr.indexOf('(') + 1;
    const end = this.findMatchingParen(expr, start - 1);
    return expr.substring(start, end).trim();
  }

  private extractFunctionArgs(expr: string, funcName: string, count: number): string[] {
    // Extract multiple arguments from @func(arg1, arg2, ...)
    const start = expr.indexOf('(') + 1;
    const end = this.findMatchingParen(expr, start - 1);
    const argsStr = expr.substring(start, end);
    
    // Split by commas, but respect nested parentheses
    const args: string[] = [];
    let currentArg = '';
    let depth = 0;
    
    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];
      
      if (char === '(' || char === '[') {
        depth++;
        currentArg += char;
      } else if (char === ')' || char === ']') {
        depth--;
        currentArg += char;
      } else if (char === ',' && depth === 0) {
        args.push(currentArg.trim());
        currentArg = '';
      } else {
        currentArg += char;
      }
    }
    
    if (currentArg.trim()) {
      args.push(currentArg.trim());
    }
    
    return args;
  }

  private findMatchingParen(str: string, openPos: number): number {
    // Find the matching closing parenthesis
    let depth = 1;
    for (let i = openPos + 1; i < str.length; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    throw new Error(`Unmatched parenthesis in: ${str}`);
  }

  // ========================================================================
  // EXPRESSION EVALUATION
  // ========================================================================

  // Simple expression evaluation (would use full @{} parser in real system)
  private async evaluateInputs(inputs: any, context: WorkflowExecutionContext): Promise<any> {
    if (typeof inputs === 'string') {
      return await this.evaluateExpression(inputs, context);
    }
    
    if (Array.isArray(inputs)) {
      return await Promise.all(inputs.map(item => this.evaluateInputs(item, context)));
    }
    
    if (inputs && typeof inputs === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(inputs)) {
        result[key] = await this.evaluateInputs(value, context);
      }
      return result;
    }
    
    return inputs;
  }

  private async evaluateExpression(expr: string, context: WorkflowExecutionContext): Promise<any> {
    // Simple expression evaluator - real version would parse @{} syntax
    if (typeof expr !== 'string') return expr;

    // @parameters('name')
    const paramMatch = expr.match(/^@parameters\(['"](\w+)['"]\)$/);
    if (paramMatch) {
      return context.parameters[paramMatch[1]];
    }

    // @actions('name').output
    const actionMatch = expr.match(/^@actions\(['"](\w+)['"]\)\.(\w+)$/);
    if (actionMatch) {
      const actionResult = context.actions[actionMatch[1]];
      return actionResult?.[actionMatch[2]];
    }

    // @variables('name')
    const varMatch = expr.match(/^@variables\(['"](\w+)['"]\)$/);
    if (varMatch) {
      return context.variables[varMatch[1]];
    }

    // @secret('name') - Get secret from secrets client
    if (expr.startsWith('@secret(')) {
      const secretName = this.extractFunctionArg(expr, '@secret');
      // Remove quotes if present
      const cleanName = secretName.replace(/^['"]|['"]$/g, '');
      return this.getSecretValue(cleanName);
    }

    // Common functions for loop conditions - use helper to parse arguments
    
    // @not(expression)
    if (expr.startsWith('@not(')) {
      const arg = this.extractFunctionArg(expr, '@not');
      return !(await this.evaluateExpression(arg, context));
    }

    // @equals(a, b)
    if (expr.startsWith('@equals(')) {
      const args = this.extractFunctionArgs(expr, '@equals', 2);
      const a = await this.evaluateExpression(args[0], context);
      const b = await this.evaluateExpression(args[1], context);
      return a === b;
    }

    // @greaterOrEquals(a, b)
    if (expr.startsWith('@greaterOrEquals(')) {
      const args = this.extractFunctionArgs(expr, '@greaterOrEquals', 2);
      const a = await this.evaluateExpression(args[0], context);
      const b = await this.evaluateExpression(args[1], context);
      return a >= b;
    }

    // @less(a, b)
    if (expr.startsWith('@less(')) {
      const args = this.extractFunctionArgs(expr, '@less', 2);
      const a = await this.evaluateExpression(args[0], context);
      const b = await this.evaluateExpression(args[1], context);
      return a < b;
    }

    // @empty(array)
    if (expr.startsWith('@empty(')) {
      const arg = this.extractFunctionArg(expr, '@empty');
      const arr = await this.evaluateExpression(arg, context);
      return !arr || (Array.isArray(arr) && arr.length === 0);
    }

    // String literals in quotes
    const stringMatch = expr.match(/^['"](.*)['"]$/);
    if (stringMatch) {
      return stringMatch[1];
    }

    // Number literals
    if (/^-?\d+(\.\d+)?$/.test(expr)) {
      return parseFloat(expr);
    }

    // Boolean literals
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;

    return expr;
  }
}
