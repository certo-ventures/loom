# RLM Integration Deep Dive: Recursive Decomposition for Loom

## Executive Summary

This document outlines a comprehensive strategy to integrate **Recursive Language Model (RLM)** concepts from MIT into Loom, adapted to use **actor messaging** instead of Python REPL, **WASM execution** instead of code sandboxing, and **Context Graph** for pattern learning.

## Core Insight from RLM

RLM's breakthrough: **offload context into a programmatic variable** that the LLM can examine, decompose, and recursively process. The LLM generates code that breaks down complex tasks into smaller sub-tasks, each handled by recursive LLM calls.

### RLM's Original Pattern
```python
# RLM's approach (Python REPL-based)
rlm.completion("Analyze 100GB dataset") 
  → LLM generates: "for chunk in split_context(1000): process(chunk)"
  → Executes in Python sandbox
  → Makes sub-LLM calls: llm_query(f"Summarize {chunk}")
  → Synthesizes results
```

### Loom's Actor-Native Pattern
```typescript
// Loom's approach (Actor message-based)
rlmActor.decompose("Analyze 100GB dataset")
  → LLM generates decomposition plan
  → Routes to WASM actors: dataProcessor.execute(chunk)
  → Sub-actors send messages: await this.sendToActor('summarizer', chunk)
  → Coordinator synthesizes results from actor replies
```

---

## Architecture: Loom RLM Actor System

### 1. Recursive Decomposition Actor (Core Primitive)

```typescript
/**
 * RecursiveDecompositionActor - The RLM primitive for Loom
 * 
 * Key differences from RLM's Python REPL approach:
 * - Uses actor messaging instead of exec()
 * - Routes to WASM actors instead of Python functions
 * - Journals decomposition tree for replay
 * - Updates Context Graph with learned patterns
 */
export class RecursiveDecompositionActor extends Actor {
  private llmClient: LLMClient;
  private contextGraph: ActorMemory;
  private decisionMemory: DecisionMemory;
  private decompositionCache: Map<string, DecompositionPlan>;
  private maxDepth: number = 5;
  
  constructor(
    context: ActorContext,
    options: {
      llmClient: LLMClient;
      contextGraph: ActorMemory;
      decisionMemory: DecisionMemory;
      maxDepth?: number;
    }
  ) {
    super(context);
    this.llmClient = options.llmClient;
    this.contextGraph = options.contextGraph;
    this.decisionMemory = options.decisionMemory;
    this.maxDepth = options.maxDepth || 5;
  }

  async execute(input: RLMRequest): Promise<void> {
    const depth = input.depth || 0;
    
    if (depth > this.maxDepth) {
      throw new Error(`Max decomposition depth ${this.maxDepth} exceeded`);
    }

    // Phase 1: Check for learned patterns in Context Graph
    const cachedPattern = await this.findCachedPattern(input.task);
    if (cachedPattern && cachedPattern.successRate > 0.8) {
      console.log(`📚 Using learned pattern: ${cachedPattern.patternId}`);
      await this.executeCachedPattern(cachedPattern, input);
      return;
    }

    // Phase 2: LLM generates decomposition plan
    const plan = await this.decompose(input.task, input.context, depth);
    
    // Phase 3: Execute plan via actor messaging
    const results = await this.executePlan(plan, depth);
    
    // Phase 4: Synthesize results (may involve recursive sub-decomposition)
    const finalResult = await this.synthesize(plan, results, depth);
    
    // Phase 5: Record in journal & context graph
    await this.recordDecomposition(input, plan, results, finalResult);
    
    // Phase 6: Update state
    this.updateState(draft => {
      draft.result = finalResult;
      draft.decompositionTrace = this.buildTraceTree(plan, results);
    });
  }

  /**
   * Phase 1: Check Context Graph for learned decomposition patterns
   */
  private async findCachedPattern(task: string): Promise<DecompositionPattern | null> {
    // Semantic search in Context Graph for similar tasks
    const similarDecompositions = await this.contextGraph.searchSemantic(
      await this.embedTask(task),
      { limit: 5 }
    );

    for (const fact of similarDecompositions) {
      const pattern = this.extractPattern(fact);
      if (pattern && pattern.taskSimilarity > 0.85) {
        return pattern;
      }
    }
    
    return null;
  }

  /**
   * Phase 2: Generate decomposition plan using LLM
   * 
   * This is where we differ from RLM's Python REPL approach:
   * - RLM: Generates Python code with llm_query() calls
   * - Loom: Generates actor routing plan with message specifications
   */
  private async decompose(
    task: string, 
    context: any,
    depth: number
  ): Promise<DecompositionPlan> {
    // Gather context from multiple sources
    const contextStr = await this.gatherContext(task, context);
    
    // Find precedent decompositions
    const precedents = await this.findPrecedentDecompositions(task);
    
    // Generate prompt for LLM
    const prompt = this.buildDecompositionPrompt(task, contextStr, precedents);
    
    // Call LLM to generate decomposition plan
    const response = await this.llmClient.completion(prompt);
    
    // Parse LLM response into structured plan
    const plan = this.parseDecompositionPlan(response);
    
    // Validate plan
    this.validatePlan(plan);
    
    return plan;
  }

  /**
   * Phase 3: Execute plan via actor messaging (NOT Python exec!)
   * 
   * This is the core replacement for RLM's REPL execution:
   * - Maps tasks to actor types
   * - Routes messages to appropriate actors
   * - Waits for responses via message correlation
   * - Handles WASM actor execution for compute tasks
   */
  private async executePlan(
    plan: DecompositionPlan,
    depth: number
  ): Promise<Map<string, any>> {
    const results = new Map<string, any>();
    
    // Execute steps (sequential or parallel based on plan)
    if (plan.executionMode === 'parallel') {
      await this.executeParallel(plan, results, depth);
    } else if (plan.executionMode === 'sequential') {
      await this.executeSequential(plan, results, depth);
    } else if (plan.executionMode === 'pipeline') {
      await this.executePipeline(plan, results, depth);
    }
    
    return results;
  }

  private async executeSequential(
    plan: DecompositionPlan,
    results: Map<string, any>,
    depth: number
  ): Promise<void> {
    for (const step of plan.steps) {
      const stepResult = await this.executeStep(step, results, depth);
      results.set(step.id, stepResult);
    }
  }

  private async executeParallel(
    plan: DecompositionPlan,
    results: Map<string, any>,
    depth: number
  ): Promise<void> {
    const stepPromises = plan.steps.map(step => 
      this.executeStep(step, results, depth)
    );
    
    const stepResults = await Promise.all(stepPromises);
    
    plan.steps.forEach((step, idx) => {
      results.set(step.id, stepResults[idx]);
    });
  }

  /**
   * Execute a single step - this is where actor routing happens
   */
  private async executeStep(
    step: DecompositionStep,
    existingResults: Map<string, any>,
    depth: number
  ): Promise<any> {
    // Record step execution in journal
    this.journal.entries.push({
      type: 'decomposition_step_start',
      stepId: step.id,
      stepType: step.type,
      depth,
      timestamp: Date.now()
    });

    let result: any;

    switch (step.type) {
      case 'recursive_decompose':
        // Recursive call to another RLM actor
        result = await this.recursiveDecompose(step, depth);
        break;
        
      case 'wasm_compute':
        // Execute WASM actor for computational tasks
        result = await this.executeWasmActor(step);
        break;
        
      case 'actor_message':
        // Send message to another actor and wait for response
        result = await this.sendActorMessage(step);
        break;
        
      case 'gather_context':
        // Fetch data from external systems
        result = await this.gatherExternalContext(step);
        break;
        
      case 'llm_query':
        // Direct LLM call (for synthesis, summarization, etc.)
        result = await this.llmQuery(step, existingResults);
        break;
        
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }

    // Record completion
    this.journal.entries.push({
      type: 'decomposition_step_complete',
      stepId: step.id,
      result: this.summarizeResult(result),
      timestamp: Date.now()
    });

    return result;
  }

  /**
   * Recursive decomposition - spawn child RLM actor
   */
  private async recursiveDecompose(
    step: DecompositionStep,
    parentDepth: number
  ): Promise<any> {
    const childActorId = `${this.context.actorId}-child-${step.id}`;
    
    // Create child RLM actor context
    const childContext: ActorContext = {
      actorId: childActorId,
      actorType: 'RecursiveDecompositionActor',
      parentActorId: this.context.actorId,
      correlationId: this.context.correlationId
    };

    // Create child actor
    const childActor = new RecursiveDecompositionActor(childContext, {
      llmClient: this.llmClient,
      contextGraph: this.contextGraph,
      decisionMemory: this.decisionMemory,
      maxDepth: this.maxDepth
    });

    // Execute child with increased depth
    await childActor.execute({
      task: step.task!,
      context: step.context,
      depth: parentDepth + 1,
      parentStepId: step.id
    });

    // Return child result
    return childActor.getState().result;
  }

  /**
   * Execute WASM actor - this replaces Python exec() from RLM
   */
  private async executeWasmActor(step: DecompositionStep): Promise<any> {
    // Determine which WASM actor to use based on task
    const wasmActorType = step.wasmActorType || this.selectWasmActor(step);
    
    // Create WASM actor context
    const wasmContext: ActorContext = {
      actorId: `wasm-${step.id}-${Date.now()}`,
      actorType: wasmActorType,
      parentActorId: this.context.actorId,
      correlationId: this.context.correlationId
    };

    // Load WASM actor from blob storage
    const wasmActor = await this.loadWasmActor(wasmActorType, wasmContext);
    
    // Execute with step input
    await wasmActor.execute(step.input);
    
    // Return result
    return wasmActor.getState();
  }

  /**
   * Send message to another actor and wait for response
   */
  private async sendActorMessage(step: DecompositionStep): Promise<any> {
    const targetActorId = step.targetActorId!;
    const messageType = step.messageType || 'execute';
    
    // Send message via message queue
    const messageId = `msg-${Date.now()}-${Math.random()}`;
    
    await this.context.messageQueue.enqueue(`actor:${targetActorId}`, {
      messageId,
      actorId: targetActorId,
      messageType,
      correlationId: this.context.correlationId,
      payload: step.input,
      metadata: {
        sourceActorId: this.context.actorId,
        sourceStepId: step.id,
        timestamp: new Date().toISOString()
      }
    });

    // Wait for response (via correlation ID)
    const response = await this.waitForActorResponse(messageId, step.timeout || 30000);
    
    return response;
  }

  /**
   * Phase 4: Synthesize results from all steps
   */
  private async synthesize(
    plan: DecompositionPlan,
    results: Map<string, any>,
    depth: number
  ): Promise<any> {
    // If plan has explicit synthesis step, use it
    if (plan.synthesisStrategy === 'llm') {
      return this.llmSynthesize(plan, results);
    } else if (plan.synthesisStrategy === 'reduce') {
      return this.reduceSynthesize(plan, results);
    } else if (plan.synthesisStrategy === 'aggregate') {
      return this.aggregateSynthesize(plan, results);
    }
    
    // Default: return all results
    return Object.fromEntries(results);
  }

  private async llmSynthesize(
    plan: DecompositionPlan,
    results: Map<string, any>
  ): Promise<any> {
    const synthesisPrompt = this.buildSynthesisPrompt(plan, results);
    const response = await this.llmClient.completion(synthesisPrompt);
    return this.parseSynthesisResponse(response);
  }

  /**
   * Phase 5: Record decomposition in journal & context graph
   */
  private async recordDecomposition(
    input: RLMRequest,
    plan: DecompositionPlan,
    results: Map<string, any>,
    finalResult: any
  ): Promise<void> {
    const decompositionId = `dec-${this.context.actorId}-${Date.now()}`;
    
    // Record as decision trace
    await this.recordDecision({
      decisionType: 'synthesis',
      rationale: `Decomposed task "${input.task}" into ${plan.steps.length} steps`,
      reasoning: plan.steps.map(s => s.description),
      inputs: [{
        system: 'rlm',
        entity: 'task',
        data: input.task,
        confidence: 1.0
      }],
      outcome: {
        decompositionId,
        planId: plan.id,
        stepsExecuted: plan.steps.length,
        successfulSteps: Array.from(results.values()).filter(r => !r.error).length,
        result: finalResult
      },
      policy: {
        id: 'rlm-decomposition',
        version: '1.0.0',
        rule: 'Recursive task decomposition via actor messaging'
      }
    });

    // Store pattern in Context Graph for future reuse
    await this.storeDecompositionPattern(input, plan, results, finalResult);
  }

  /**
   * Store decomposition pattern in Context Graph
   */
  private async storeDecompositionPattern(
    input: RLMRequest,
    plan: DecompositionPlan,
    results: Map<string, any>,
    finalResult: any
  ): Promise<void> {
    const successRate = this.calculateSuccessRate(results);
    const executionTime = Date.now() - (plan.startTime || 0);
    
    // Create pattern entity
    const patternId = `pattern-${Date.now()}`;
    await this.contextGraph.addEntity(patternId, 'decomposition_pattern', plan.description);
    
    // Add facts about the pattern
    await this.contextGraph.addFact(
      patternId,
      'has_success_rate',
      patternId,
      `Pattern ${patternId} has success rate ${successRate}`,
      { 
        confidence: successRate,
        metadata: { 
          successRate, 
          executionTime,
          stepCount: plan.steps.length 
        }
      }
    );

    // Link to task type
    await this.contextGraph.addFact(
      patternId,
      'solves_task_type',
      input.task,
      `Pattern ${patternId} solves task type "${input.task}"`,
      { confidence: 1.0 }
    );

    // Store decomposition structure for reuse
    await this.contextGraph.addFact(
      patternId,
      'has_structure',
      patternId,
      JSON.stringify({
        steps: plan.steps.map(s => ({
          type: s.type,
          description: s.description,
          dependencies: s.dependencies
        })),
        executionMode: plan.executionMode,
        synthesisStrategy: plan.synthesisStrategy
      }),
      { confidence: 1.0 }
    );
  }

  /**
   * Build decomposition tree for visualization
   */
  private buildTraceTree(
    plan: DecompositionPlan,
    results: Map<string, any>
  ): DecompositionTree {
    return {
      planId: plan.id,
      rootTask: plan.task,
      depth: plan.depth || 0,
      steps: plan.steps.map(step => ({
        id: step.id,
        type: step.type,
        description: step.description,
        status: results.has(step.id) ? 'completed' : 'pending',
        result: results.get(step.id),
        children: this.getStepChildren(step, results)
      })),
      totalSteps: plan.steps.length,
      successfulSteps: Array.from(results.values()).filter(r => !r.error).length,
      executionTime: Date.now() - (plan.startTime || 0)
    };
  }

  protected getDefaultState(): Record<string, unknown> {
    return {
      decompositions: [],
      patterns: [],
      result: null,
      decompositionTrace: null
    };
  }
}
```

---

## 2. Data Structures for Decomposition Tracking

```typescript
/**
 * RLM Request - Input to recursive decomposition actor
 */
export interface RLMRequest {
  task: string;                    // High-level task description
  context?: any;                   // Additional context
  depth?: number;                  // Current recursion depth
  parentStepId?: string;           // If this is a child decomposition
  constraints?: {
    maxDepth?: number;
    maxSteps?: number;
    timeout?: number;
  };
}

/**
 * Decomposition Plan - Generated by LLM
 */
export interface DecompositionPlan {
  id: string;
  task: string;
  description: string;
  steps: DecompositionStep[];
  executionMode: 'sequential' | 'parallel' | 'pipeline';
  synthesisStrategy: 'llm' | 'reduce' | 'aggregate' | 'none';
  dependencies: Map<string, string[]>;  // Step dependencies
  depth: number;
  startTime?: number;
}

/**
 * Decomposition Step - A single unit of work
 */
export interface DecompositionStep {
  id: string;
  type: 'recursive_decompose' | 'wasm_compute' | 'actor_message' | 'gather_context' | 'llm_query';
  description: string;
  task?: string;                    // For recursive_decompose
  targetActorId?: string;           // For actor_message
  messageType?: string;             // For actor_message
  wasmActorType?: string;           // For wasm_compute
  input: any;                       // Input data for this step
  context?: any;                    // Additional context
  dependencies?: string[];          // IDs of steps this depends on
  timeout?: number;                 // Timeout in ms
}

/**
 * Decomposition Tree - For visualization in Studio
 */
export interface DecompositionTree {
  planId: string;
  rootTask: string;
  depth: number;
  steps: DecompositionTreeNode[];
  totalSteps: number;
  successfulSteps: number;
  executionTime: number;
}

export interface DecompositionTreeNode {
  id: string;
  type: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  children?: DecompositionTreeNode[];
  executionTime?: number;
}

/**
 * Decomposition Pattern - Learned from Context Graph
 */
export interface DecompositionPattern {
  patternId: string;
  taskType: string;
  taskSimilarity: number;           // Cosine similarity score
  structure: {
    steps: Array<{
      type: string;
      description: string;
      dependencies?: string[];
    }>;
    executionMode: string;
    synthesisStrategy: string;
  };
  successRate: number;              // Historical success rate
  avgExecutionTime: number;
  usageCount: number;
  lastUsed: Date;
}
```

---

## 3. Journal Schema Extensions for RLM

```typescript
/**
 * Extend JournalEntry to support decomposition tracking
 */
export type RLMJournalEntry = 
  | DecompositionStartEntry
  | DecompositionPlanEntry
  | DecompositionStepStartEntry
  | DecompositionStepCompleteEntry
  | DecompositionCompleteEntry
  | RecursiveCallEntry
  | ActorMessageSentEntry
  | ActorMessageReceivedEntry
  | WasmExecutionEntry;

export interface DecompositionStartEntry extends JournalEntry {
  type: 'decomposition_start';
  task: string;
  depth: number;
  parentActorId?: string;
}

export interface DecompositionPlanEntry extends JournalEntry {
  type: 'decomposition_plan';
  plan: DecompositionPlan;
  llmResponse?: string;
}

export interface DecompositionStepStartEntry extends JournalEntry {
  type: 'decomposition_step_start';
  stepId: string;
  stepType: string;
  depth: number;
  timestamp: number;
}

export interface DecompositionStepCompleteEntry extends JournalEntry {
  type: 'decomposition_step_complete';
  stepId: string;
  result: any;
  timestamp: number;
  executionTime?: number;
}

export interface DecompositionCompleteEntry extends JournalEntry {
  type: 'decomposition_complete';
  decompositionTree: DecompositionTree;
  finalResult: any;
  timestamp: number;
}

export interface RecursiveCallEntry extends JournalEntry {
  type: 'recursive_call';
  childActorId: string;
  task: string;
  depth: number;
}

export interface ActorMessageSentEntry extends JournalEntry {
  type: 'actor_message_sent';
  targetActorId: string;
  messageId: string;
  messageType: string;
  payload: any;
}

export interface ActorMessageReceivedEntry extends JournalEntry {
  type: 'actor_message_received';
  sourceActorId: string;
  messageId: string;
  response: any;
}

export interface WasmExecutionEntry extends JournalEntry {
  type: 'wasm_execution';
  wasmActorType: string;
  input: any;
  output: any;
  executionTime: number;
}
```

---

## 4. Context Graph Integration for Pattern Learning

```typescript
/**
 * DecompositionContextGraph - Specialized graph for decomposition patterns
 * 
 * Extends ActorMemory to store and retrieve decomposition patterns
 */
export class DecompositionContextGraph extends ActorMemory {
  private embeddingService?: EmbeddingService;
  private patternCache: Map<string, DecompositionPattern> = new Map();

  /**
   * Store a decomposition pattern with embedding
   */
  async storePattern(
    task: string,
    plan: DecompositionPlan,
    successRate: number,
    executionTime: number
  ): Promise<string> {
    const patternId = `pattern-${Date.now()}-${Math.random()}`;
    
    // Generate embedding for semantic search
    let embedding: number[] | undefined;
    if (this.embeddingService) {
      const searchText = this.serializePattern(task, plan);
      embedding = await this.embeddingService.embed(searchText);
    }

    // Store pattern as entity
    await this.addEntity(patternId, 'decomposition_pattern', plan.description, {
      embedding,
      metadata: {
        taskType: task,
        successRate,
        executionTime,
        stepCount: plan.steps.length,
        executionMode: plan.executionMode
      }
    });

    // Store detailed structure as fact
    await this.addFact(
      patternId,
      'has_structure',
      patternId,
      JSON.stringify(plan),
      { confidence: successRate }
    );

    // Cache the pattern
    this.patternCache.set(patternId, {
      patternId,
      taskType: task,
      taskSimilarity: 1.0,
      structure: {
        steps: plan.steps.map(s => ({
          type: s.type,
          description: s.description,
          dependencies: s.dependencies
        })),
        executionMode: plan.executionMode,
        synthesisStrategy: plan.synthesisStrategy
      },
      successRate,
      avgExecutionTime: executionTime,
      usageCount: 1,
      lastUsed: new Date()
    });

    return patternId;
  }

  /**
   * Find patterns for a given task using semantic search
   */
  async findPatterns(
    task: string,
    limit: number = 5,
    minSimilarity: number = 0.7
  ): Promise<DecompositionPattern[]> {
    if (!this.embeddingService) {
      return [];
    }

    // Generate embedding for query
    const queryEmbedding = await this.embeddingService.embed(task);

    // Search for similar patterns
    const facts = await this.searchSemantic(queryEmbedding, limit * 2);

    // Filter to pattern entities
    const entities = await this.getEntities();
    const patternEntities = entities.filter(e => e.type === 'decomposition_pattern');

    // Extract patterns from facts
    const patterns: DecompositionPattern[] = [];
    
    for (const fact of facts) {
      const patternEntity = patternEntities.find(e => e.id === fact.sourceEntityId);
      if (!patternEntity) continue;

      // Get structure fact
      const structureFacts = await this.getCurrentFacts();
      const structureFact = structureFacts.find(
        f => f.sourceEntityId === patternEntity.id && f.relation === 'has_structure'
      );

      if (!structureFact) continue;

      try {
        const plan = JSON.parse(structureFact.text) as DecompositionPlan;
        const metadata = (patternEntity as any).metadata || {};

        patterns.push({
          patternId: patternEntity.id,
          taskType: metadata.taskType || task,
          taskSimilarity: fact.confidence || 0.5,
          structure: {
            steps: plan.steps.map(s => ({
              type: s.type,
              description: s.description,
              dependencies: s.dependencies
            })),
            executionMode: plan.executionMode,
            synthesisStrategy: plan.synthesisStrategy
          },
          successRate: metadata.successRate || 0.5,
          avgExecutionTime: metadata.executionTime || 0,
          usageCount: metadata.usageCount || 1,
          lastUsed: new Date(metadata.lastUsed || Date.now())
        });
      } catch (e) {
        console.warn('Failed to parse pattern:', e);
      }
    }

    // Filter by minimum similarity
    return patterns
      .filter(p => p.taskSimilarity >= minSimilarity)
      .slice(0, limit);
  }

  /**
   * Update pattern effectiveness after execution
   */
  async updatePatternEffectiveness(
    patternId: string,
    success: boolean,
    executionTime: number
  ): Promise<void> {
    const pattern = this.patternCache.get(patternId);
    if (!pattern) return;

    // Update success rate (moving average)
    const newUsageCount = pattern.usageCount + 1;
    const newSuccessRate = 
      (pattern.successRate * pattern.usageCount + (success ? 1 : 0)) / newUsageCount;

    // Update execution time (moving average)
    const newAvgTime = 
      (pattern.avgExecutionTime * pattern.usageCount + executionTime) / newUsageCount;

    // Update pattern in graph
    await this.invalidateFact(patternId);
    await this.addFact(
      patternId,
      'has_effectiveness',
      patternId,
      `Pattern ${patternId} has success rate ${newSuccessRate}`,
      {
        confidence: newSuccessRate,
        metadata: {
          successRate: newSuccessRate,
          avgExecutionTime: newAvgTime,
          usageCount: newUsageCount,
          lastUsed: Date.now()
        }
      }
    );

    // Update cache
    pattern.successRate = newSuccessRate;
    pattern.avgExecutionTime = newAvgTime;
    pattern.usageCount = newUsageCount;
    pattern.lastUsed = new Date();
  }

  private serializePattern(task: string, plan: DecompositionPlan): string {
    return [
      `Task: ${task}`,
      `Description: ${plan.description}`,
      `Steps: ${plan.steps.map(s => s.description).join(', ')}`,
      `Execution Mode: ${plan.executionMode}`,
      `Synthesis: ${plan.synthesisStrategy}`
    ].join(' | ');
  }
}
```

---

## 5. WASM Actor Selection Strategy

```typescript
/**
 * WASM Actor Registry - Maps task types to WASM actors
 */
export class WasmActorRegistry {
  private registry: Map<string, WasmActorMetadata> = new Map();

  constructor() {
    this.registerDefaultActors();
  }

  private registerDefaultActors(): void {
    // Numerical computation
    this.register({
      taskPattern: /calculate|compute|math|numeric|finance/i,
      actorType: 'calculator-actor',
      wasmPath: 'calculator-actor.wasm',
      capabilities: ['arithmetic', 'financial', 'statistical']
    });

    // Data transformation
    this.register({
      taskPattern: /transform|convert|parse|format/i,
      actorType: 'transformer-actor',
      wasmPath: 'transformer-actor.wasm',
      capabilities: ['data_transformation', 'format_conversion']
    });

    // String processing
    this.register({
      taskPattern: /text|string|parse|extract/i,
      actorType: 'text-processor',
      wasmPath: 'text-processor.wasm',
      capabilities: ['text_processing', 'pattern_matching']
    });

    // Data aggregation
    this.register({
      taskPattern: /aggregate|summarize|reduce|collect/i,
      actorType: 'aggregator-actor',
      wasmPath: 'aggregator-actor.wasm',
      capabilities: ['aggregation', 'summarization']
    });
  }

  register(metadata: WasmActorMetadata): void {
    this.registry.set(metadata.actorType, metadata);
  }

  /**
   * Select best WASM actor for a task
   */
  selectActor(task: string, context?: any): string | null {
    for (const [actorType, metadata] of this.registry.entries()) {
      if (metadata.taskPattern.test(task)) {
        return actorType;
      }
    }
    return null;
  }

  getMetadata(actorType: string): WasmActorMetadata | undefined {
    return this.registry.get(actorType);
  }
}

export interface WasmActorMetadata {
  taskPattern: RegExp;
  actorType: string;
  wasmPath: string;
  capabilities: string[];
  schema?: {
    input: any;    // JSON schema
    output: any;   // JSON schema
  };
}
```

---

## 6. Prompt Engineering for Decomposition

```typescript
/**
 * DecompositionPromptBuilder - Generates prompts for LLM decomposition
 */
export class DecompositionPromptBuilder {
  buildDecompositionPrompt(
    task: string,
    context: string,
    precedents: DecompositionPattern[]
  ): string {
    return `You are a task decomposition expert. Your job is to break down complex tasks into smaller, executable steps.

## Task
${task}

## Available Context
${context}

${precedents.length > 0 ? this.formatPrecedents(precedents) : ''}

## Available Execution Primitives

1. **recursive_decompose**: Break this step into further sub-tasks
   - Use when: Step is still too complex to execute directly
   - Creates: Child RLM actor with increased depth

2. **wasm_compute**: Execute computational task in WASM sandbox
   - Use when: Numerical computation, data transformation, pure functions
   - Available actors: calculator, transformer, text-processor, aggregator
   - Provides: Fast, isolated, deterministic execution

3. **actor_message**: Send message to another Loom actor
   - Use when: Need to interact with stateful actor or external system
   - Supports: Any registered actor type
   - Returns: Actor's response

4. **gather_context**: Fetch data from external system
   - Use when: Need information from APIs, databases, or services
   - Supports: REST APIs, GraphQL, databases
   - Returns: Fetched data

5. **llm_query**: Call LLM for analysis, summarization, or decision
   - Use when: Need natural language understanding or generation
   - Use cases: Summarization, classification, extraction
   - Returns: LLM response

## Output Format

Respond with a JSON object containing:

\`\`\`json
{
  "task": "High-level task description",
  "description": "Brief explanation of decomposition strategy",
  "executionMode": "sequential" | "parallel" | "pipeline",
  "synthesisStrategy": "llm" | "reduce" | "aggregate" | "none",
  "steps": [
    {
      "id": "step-1",
      "type": "wasm_compute",
      "description": "What this step does",
      "wasmActorType": "calculator-actor",
      "input": { /* Input data */ },
      "dependencies": []
    },
    {
      "id": "step-2",
      "type": "llm_query",
      "description": "Summarize results",
      "input": { "prompt": "..." },
      "dependencies": ["step-1"]
    }
  ]
}
\`\`\`

## Guidelines

- **Keep steps atomic**: Each step should do one thing well
- **Minimize dependencies**: Prefer parallel execution when possible
- **Use WASM for computation**: Offload heavy computation to WASM actors
- **Use LLM for reasoning**: Use LLM queries for analysis and synthesis
- **Specify clear inputs**: Each step must have well-defined input/output
- **Consider precedents**: Learn from similar past decompositions

Generate the decomposition plan now:`;
  }

  private formatPrecedents(precedents: DecompositionPattern[]): string {
    return `## Similar Past Decompositions

${precedents.map((p, i) => `
### Precedent ${i + 1} (${(p.taskSimilarity * 100).toFixed(1)}% similar, ${(p.successRate * 100).toFixed(0)}% success rate)
- Task Type: ${p.taskType}
- Steps: ${p.structure.steps.length}
- Execution Mode: ${p.structure.executionMode}
- Average Time: ${(p.avgExecutionTime / 1000).toFixed(2)}s
- Structure: ${JSON.stringify(p.structure.steps.map(s => ({ type: s.type, description: s.description })), null, 2)}
`).join('\n')}`;
  }

  buildSynthesisPrompt(plan: DecompositionPlan, results: Map<string, any>): string {
    return `Synthesize the results from decomposed task execution.

## Original Task
${plan.task}

## Decomposition Strategy
${plan.description}

## Step Results

${Array.from(results.entries()).map(([stepId, result]) => {
  const step = plan.steps.find(s => s.id === stepId);
  return `### Step: ${step?.description || stepId}
Type: ${step?.type}
Result: ${JSON.stringify(result, null, 2)}
`;
}).join('\n')}

## Your Task

Synthesize these results into a final, coherent answer to the original task. Format your response as JSON:

\`\`\`json
{
  "answer": "Final synthesized answer",
  "summary": "Brief summary of how results were combined",
  "confidence": 0.95,
  "supporting_evidence": ["Key point 1", "Key point 2"]
}
\`\`\``;
  }
}
```

---

## 7. Studio Visualization Components

### Decomposition Tree View

```typescript
/**
 * React component for visualizing decomposition trees in Studio
 */
export const DecompositionTreeView: React.FC<{
  tree: DecompositionTree;
}> = ({ tree }) => {
  return (
    <div className="decomposition-tree">
      <div className="tree-header">
        <h3>{tree.rootTask}</h3>
        <div className="tree-stats">
          <span>Depth: {tree.depth}</span>
          <span>Steps: {tree.successfulSteps}/{tree.totalSteps}</span>
          <span>Time: {(tree.executionTime / 1000).toFixed(2)}s</span>
        </div>
      </div>
      
      <div className="tree-visualization">
        <TreeNode node={tree} />
      </div>
    </div>
  );
};

const TreeNode: React.FC<{ node: DecompositionTreeNode }> = ({ node }) => {
  const [expanded, setExpanded] = useState(true);
  
  return (
    <div className="tree-node">
      <div className={`node-content node-${node.status}`}>
        <button onClick={() => setExpanded(!expanded)}>
          {expanded ? '▼' : '▶'}
        </button>
        
        <div className="node-info">
          <span className="node-type">{node.type}</span>
          <span className="node-description">{node.description}</span>
        </div>
        
        <div className="node-status">
          {node.status === 'completed' && '✓'}
          {node.status === 'failed' && '✗'}
          {node.status === 'running' && '⟳'}
        </div>
      </div>
      
      {expanded && node.children && node.children.length > 0 && (
        <div className="node-children">
          {node.children.map(child => (
            <TreeNode key={child.id} node={child} />
          ))}
        </div>
      )}
      
      {expanded && node.result && (
        <div className="node-result">
          <pre>{JSON.stringify(node.result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};
```

### Actor Call Hierarchy View

```typescript
/**
 * Shows the flow of actor messages during decomposition
 */
export const ActorHierarchyView: React.FC<{
  decomposition: DecompositionTree;
  journal: RLMJournalEntry[];
}> = ({ decomposition, journal }) => {
  const actorCalls = extractActorCalls(journal);
  
  return (
    <div className="actor-hierarchy">
      <h3>Actor Communication Flow</h3>
      
      <div className="hierarchy-graph">
        {actorCalls.map(call => (
          <ActorCallNode key={call.id} call={call} />
        ))}
      </div>
    </div>
  );
};
```

### Context Evolution Timeline

```typescript
/**
 * Shows how context graph evolves during decomposition
 */
export const ContextEvolutionView: React.FC<{
  decompositionId: string;
  contextGraph: ActorMemory;
}> = ({ decompositionId, contextGraph }) => {
  const [facts, setFacts] = useState<Fact[]>([]);
  
  useEffect(() => {
    loadContextEvolution();
  }, [decompositionId]);
  
  const loadContextEvolution = async () => {
    const facts = await contextGraph.getCurrentFacts();
    setFacts(facts.filter(f => 
      f.metadata?.decompositionId === decompositionId
    ));
  };
  
  return (
    <div className="context-evolution">
      <h3>Knowledge Graph Evolution</h3>
      
      <Timeline>
        {facts.map(fact => (
          <TimelineEvent key={fact.id} fact={fact} />
        ))}
      </Timeline>
    </div>
  );
};
```

---

## 8. Implementation Roadmap

### Phase 1: Core RLM Actor (Week 1-2)
- [ ] Implement `RecursiveDecompositionActor`
- [ ] Add RLM journal entry types
- [ ] Create decomposition data structures
- [ ] Build prompt engineering utilities
- [ ] Write unit tests

### Phase 2: WASM Integration (Week 2-3)
- [ ] Implement `WasmActorRegistry`
- [ ] Create WASM actor selection logic
- [ ] Build WASM actor adapters for common tasks
- [ ] Test WASM execution within decomposition

### Phase 3: Context Graph Integration (Week 3-4)
- [ ] Extend `ActorMemory` with decomposition patterns
- [ ] Implement pattern storage and retrieval
- [ ] Add semantic search for patterns
- [ ] Build pattern effectiveness tracking

### Phase 4: Actor Messaging (Week 4-5)
- [ ] Implement actor message routing
- [ ] Add correlation tracking for responses
- [ ] Build timeout and retry logic
- [ ] Test actor-to-actor communication

### Phase 5: Studio Visualization (Week 5-6)
- [ ] Build decomposition tree component
- [ ] Create actor hierarchy visualizer
- [ ] Implement context evolution timeline
- [ ] Add interactive debugging tools

### Phase 6: LLM Client Integration (Week 6-7)
- [ ] Integrate with OpenAI/Anthropic APIs
- [ ] Add prompt caching
- [ ] Implement streaming responses
- [ ] Build cost tracking

### Phase 7: Examples & Documentation (Week 7-8)
- [ ] Create example RLM actors
- [ ] Write integration guide
- [ ] Build tutorial notebooks
- [ ] Document best practices

---

## 9. Key Advantages Over RLM's Approach

1. **True Sandboxing**: WASM actors provide memory-safe, isolated execution (vs Python exec())
2. **Distributed by Default**: Actors can run anywhere in the mesh
3. **Type Safety**: TypeScript/AssemblyScript provide compile-time guarantees
4. **Durability**: Every decomposition is journaled and replay-able
5. **Pattern Learning**: Context Graph learns from past decompositions
6. **Multi-Language**: Not limited to Python execution
7. **Production-Ready**: Built on proven actor model + WASM
8. **Verifiable**: Decomposition traces provide full audit trail
9. **Scalable**: Actor messaging enables horizontal scaling
10. **Studio Integration**: Rich visualization and debugging tools

---

## 10. Example Usage

```typescript
// Create RLM actor
const rlmActor = new RecursiveDecompositionActor(context, {
  llmClient: new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY }),
  contextGraph: new DecompositionContextGraph(actorId, storage, clock),
  decisionMemory: new DecisionMemory(actorId, storage, clock),
  maxDepth: 5
});

// Execute complex task
await rlmActor.execute({
  task: "Analyze customer churn across 100k records, identify patterns, and generate retention strategy",
  context: {
    dataSource: "s3://customer-data/churn.csv",
    constraints: {
      maxExecutionTime: 300000, // 5 minutes
      budget: 100 // tokens
    }
  }
});

// Get result with decomposition trace
const result = rlmActor.getState();
console.log('Result:', result.result);
console.log('Decomposition:', result.decompositionTrace);

// View in Studio
// - Decomposition tree shows 3-level breakdown
// - Actor hierarchy shows message flow
// - Context graph shows learned patterns
// - Decision trace shows why each step was chosen
```

---

## Next Steps

Let me know if you'd like me to:
1. **Start implementation** - Begin with RecursiveDecompositionActor
2. **Create examples** - Build specific use cases
3. **Design prompts** - Craft decomposition prompt templates
4. **Build visualizers** - Create Studio components
5. **Write tests** - Create comprehensive test suite
