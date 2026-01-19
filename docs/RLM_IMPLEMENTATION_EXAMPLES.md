# RLM Implementation Examples

## Example 1: Customer Data Analysis (Multi-Step Decomposition)

### Task
"Analyze 50,000 customer records, identify churn risk patterns, and generate personalized retention strategies"

### RLM Decomposition

```typescript
// Step 1: LLM generates this plan
const plan: DecompositionPlan = {
  id: "plan-customer-analysis",
  task: "Customer churn analysis",
  description: "Break analysis into parallel data processing chunks",
  executionMode: "pipeline",
  synthesisStrategy: "llm",
  steps: [
    {
      id: "step-1-chunk",
      type: "wasm_compute",
      description: "Split 50k records into 50 chunks of 1000",
      wasmActorType: "data-chunker",
      input: {
        dataSource: "s3://customer-data/records.csv",
        chunkSize: 1000
      },
      dependencies: []
    },
    {
      id: "step-2-analyze",
      type: "recursive_decompose",  // Spawn 50 child RLM actors
      description: "Analyze each chunk in parallel for churn indicators",
      task: "Identify churn risk factors in customer segment",
      context: { chunkIds: "from step-1" },
      dependencies: ["step-1-chunk"]
    },
    {
      id: "step-3-aggregate",
      type: "wasm_compute",
      description: "Aggregate churn indicators across all chunks",
      wasmActorType: "aggregator-actor",
      input: { results: "from step-2" },
      dependencies: ["step-2-analyze"]
    },
    {
      id: "step-4-patterns",
      type: "llm_query",
      description: "Extract common patterns from aggregated data",
      input: {
        prompt: "Analyze these churn indicators and identify top 5 patterns:\n{{aggregated_data}}"
      },
      dependencies: ["step-3-aggregate"]
    },
    {
      id: "step-5-strategies",
      type: "llm_query",
      description: "Generate retention strategies for each pattern",
      input: {
        prompt: "For each churn pattern, suggest 3 concrete retention strategies:\n{{patterns}}"
      },
      dependencies: ["step-4-patterns"]
    }
  ],
  depth: 0
};
```

### Execution Flow

```
RLM Actor (Depth 0)
├─ Step 1: WASM Chunker
│  └─ Output: [chunk-1, chunk-2, ..., chunk-50]
│
├─ Step 2: Recursive Decompose (Depth 1)
│  ├─ Child RLM Actor 1 (chunk-1)
│  │  ├─ WASM: Parse customer data
│  │  ├─ WASM: Calculate churn score
│  │  └─ LLM: Identify risk factors
│  │
│  ├─ Child RLM Actor 2 (chunk-2)
│  │  └─ ... (same steps)
│  │
│  └─ ... (48 more)
│
├─ Step 3: WASM Aggregator
│  └─ Combines 50 child results
│
├─ Step 4: LLM Pattern Extraction
│  └─ Identifies top 5 churn patterns
│
└─ Step 5: LLM Strategy Generation
   └─ Creates retention playbook
```

### Code

```typescript
// Main execution
async function analyzeCustomerChurn() {
  const rlmActor = new RecursiveDecompositionActor(context, {
    llmClient: anthropicClient,
    contextGraph: customerContextGraph,
    decisionMemory: churnDecisionMemory,
    maxDepth: 3
  });

  await rlmActor.execute({
    task: "Analyze 50k customer records for churn risk and generate retention strategies",
    context: {
      dataSource: "s3://customer-data/records.csv",
      recordCount: 50000
    },
    depth: 0
  });

  const result = rlmActor.getState().result;
  
  // Result structure:
  // {
  //   patterns: [
  //     { pattern: "Price sensitivity", affectedCustomers: 12000, severity: "high" },
  //     { pattern: "Poor onboarding", affectedCustomers: 8500, severity: "medium" },
  //     ...
  //   ],
  //   strategies: {
  //     "Price sensitivity": [
  //       "Introduce tiered pricing",
  //       "Offer loyalty discounts",
  //       "Create annual commitment discounts"
  //     ],
  //     ...
  //   }
  // }
}
```

---

## Example 2: Document Processing Pipeline (Sequential + Parallel)

### Task
"Extract entities from 1000 legal documents, build knowledge graph, find contradictions"

### RLM Decomposition

```typescript
const plan: DecompositionPlan = {
  id: "plan-legal-docs",
  task: "Legal document analysis",
  description: "Extract entities in parallel, then build graph and analyze",
  executionMode: "pipeline",
  synthesisStrategy: "aggregate",
  steps: [
    {
      id: "step-1-extract",
      type: "recursive_decompose",
      description: "Extract entities from each document (parallel)",
      task: "Extract legal entities from document",
      context: { documentIds: "all 1000 docs" },
      dependencies: []
    },
    {
      id: "step-2-graph",
      type: "actor_message",
      description: "Build knowledge graph from entities",
      targetActorId: "graph-builder-actor",
      messageType: "execute",
      input: { entities: "from step-1" },
      dependencies: ["step-1-extract"]
    },
    {
      id: "step-3-contradictions",
      type: "recursive_decompose",
      description: "Find contradictions in graph sections",
      task: "Identify contradictory claims in subgraph",
      context: { graphPartition: "from step-2" },
      dependencies: ["step-2-graph"]
    },
    {
      id: "step-4-report",
      type: "llm_query",
      description: "Generate executive summary",
      input: {
        prompt: "Summarize key findings and contradictions:\n{{all_results}}"
      },
      dependencies: ["step-3-contradictions"]
    }
  ],
  depth: 0
};
```

### Actor Hierarchy

```
RLM Actor (root)
│
├─ Step 1: Recursive Decompose (1000 child actors in parallel)
│  ├─ Child 1 (doc-1)
│  │  ├─ WASM: Parse PDF
│  │  ├─ LLM: Extract entities (people, companies, clauses)
│  │  └─ WASM: Structure entities as JSON
│  │
│  ├─ Child 2 (doc-2)
│  │  └─ ... (same)
│  │
│  └─ ... (998 more)
│
├─ Step 2: Actor Message → Graph Builder
│  └─ Stateful actor builds knowledge graph from 1000 entity sets
│
├─ Step 3: Recursive Decompose (10 child actors, one per graph partition)
│  ├─ Child 1 (partition-1)
│  │  └─ LLM: Find contradictory claims within partition
│  │
│  └─ ... (9 more)
│
└─ Step 4: LLM Synthesis
   └─ Generate executive report
```

---

## Example 3: Real-Time Data Aggregation (WASM-Heavy)

### Task
"Aggregate metrics from 10,000 IoT sensors every minute, detect anomalies, alert if threshold exceeded"

### RLM Decomposition

```typescript
const plan: DecompositionPlan = {
  id: "plan-iot-monitoring",
  task: "IoT sensor monitoring",
  description: "Fast WASM aggregation with anomaly detection",
  executionMode: "parallel",
  synthesisStrategy: "reduce",
  steps: [
    {
      id: "step-1-fetch",
      type: "gather_context",
      description: "Fetch sensor readings from time-series DB",
      input: {
        source: "influxdb",
        query: "SELECT * FROM sensors WHERE time > now() - 1m"
      },
      dependencies: []
    },
    {
      id: "step-2-aggregate",
      type: "wasm_compute",
      description: "Calculate statistics (WASM for speed)",
      wasmActorType: "stats-aggregator",
      input: { readings: "from step-1" },
      dependencies: ["step-1-fetch"]
    },
    {
      id: "step-3-anomaly",
      type: "wasm_compute",
      description: "Detect anomalies using statistical methods",
      wasmActorType: "anomaly-detector",
      input: { 
        stats: "from step-2",
        thresholds: { zscore: 3.0 }
      },
      dependencies: ["step-2-aggregate"]
    },
    {
      id: "step-4-llm-classify",
      type: "llm_query",
      description: "Classify severity of anomalies",
      input: {
        prompt: "Classify these sensor anomalies by severity:\n{{anomalies}}"
      },
      dependencies: ["step-3-anomaly"]
    },
    {
      id: "step-5-alert",
      type: "actor_message",
      description: "Send alerts for critical anomalies",
      targetActorId: "alert-manager",
      messageType: "execute",
      input: { 
        alerts: "from step-4",
        channels: ["pagerduty", "slack"]
      },
      dependencies: ["step-4-llm-classify"]
    }
  ],
  depth: 0
};
```

### Performance Characteristics

```
10,000 sensors × 5 metrics = 50,000 data points
│
├─ Step 1 (Fetch): 100ms        (I/O bound)
├─ Step 2 (WASM Agg): 5ms       (WASM is FAST)
├─ Step 3 (WASM Anomaly): 10ms  (Pure computation)
├─ Step 4 (LLM): 500ms          (API call)
└─ Step 5 (Alert): 50ms         (I/O bound)
                                 
Total: ~665ms (real-time capable!)
```

### Why WASM Matters

```typescript
// Traditional Python (RLM's approach)
# 50k data points × loop in Python = ~500ms

// WASM approach (Loom)
// 50k data points × WASM loop = ~5ms
// 100x faster! ⚡
```

---

## Example 4: Context Graph Pattern Learning

### Scenario
After executing the customer churn analysis 50 times, the system learns patterns.

### Learned Pattern Example

```typescript
const learnedPattern: DecompositionPattern = {
  patternId: "pattern-customer-churn-analysis",
  taskType: "customer churn analysis",
  taskSimilarity: 0.95,
  structure: {
    steps: [
      { type: "wasm_compute", description: "Chunk data into 1000-record segments" },
      { type: "recursive_decompose", description: "Analyze chunks in parallel" },
      { type: "wasm_compute", description: "Aggregate results" },
      { type: "llm_query", description: "Extract patterns" },
      { type: "llm_query", description: "Generate strategies" }
    ],
    executionMode: "pipeline",
    synthesisStrategy: "llm"
  },
  successRate: 0.92,  // 92% of executions completed successfully
  avgExecutionTime: 12500,  // 12.5 seconds
  usageCount: 50,
  lastUsed: new Date()
};
```

### Pattern Reuse

```typescript
// On 51st request
await rlmActor.execute({
  task: "Analyze customer churn across 60k records",
  context: { dataSource: "s3://new-customers.csv" }
});

// RLM finds cached pattern
// ✅ Skips LLM decomposition generation (saves 2-3 seconds + $0.10)
// ✅ Directly executes learned pattern with new parameters
// ✅ Updates pattern effectiveness based on outcome
```

### Context Graph Storage

```cypher
// Pattern stored as graph
(pattern:DecompositionPattern {
  id: "pattern-customer-churn-analysis",
  successRate: 0.92,
  usageCount: 50
})

(pattern)-[:SOLVES_TASK_TYPE {similarity: 0.95}]->
(task:TaskType {name: "customer churn analysis"})

(pattern)-[:HAS_STEP {order: 1}]->
(step1:Step {type: "wasm_compute", description: "Chunk data"})

(pattern)-[:HAS_STEP {order: 2}]->
(step2:Step {type: "recursive_decompose", description: "Analyze chunks"})

// ... more steps

(pattern)-[:USED_BY {timestamp: 1705680000}]->
(execution:Execution {result: "success", time: 11800})
```

---

## Example 5: Decision Trace Integration

### Decomposition with Decision Recording

```typescript
async execute(input: RLMRequest): Promise<void> {
  // ... decomposition logic ...

  // Record decomposition as decision
  await this.recordDecision({
    decisionType: 'synthesis',
    rationale: `Decomposed "${input.task}" into ${plan.steps.length} steps based on task complexity and resource availability`,
    reasoning: [
      `Task complexity score: ${this.calculateComplexity(input.task)}`,
      `Available WASM actors: ${this.listAvailableWasmActors().join(', ')}`,
      `Found ${precedents.length} similar precedents with avg success rate ${avgSuccessRate}`,
      `Selected ${plan.executionMode} execution mode for optimal throughput`
    ],
    inputs: [
      {
        system: 'context-graph',
        entity: 'precedent',
        data: precedents,
        confidence: 0.85
      },
      {
        system: 'llm',
        entity: 'decomposition-plan',
        data: plan,
        confidence: 0.90
      }
    ],
    outcome: {
      planId: plan.id,
      steps: plan.steps.length,
      estimatedTime: this.estimateExecutionTime(plan),
      estimatedCost: this.estimateCost(plan)
    },
    policy: {
      id: 'rlm-decomposition-v1',
      version: '1.2.0',
      rule: 'Decompose complex tasks into WASM-executable primitives with LLM synthesis'
    },
    precedents: precedents.map(p => p.patternId)
  });

  // Execute plan
  const results = await this.executePlan(plan, depth);

  // Record outcome
  await this.recordDecisionOutcome(decompositionId, {
    wasCorrect: this.evaluateSuccess(results),
    actualResult: results,
    feedback: this.generateFeedback(results),
    trackedAt: Date.now(),
    trackedBy: 'system'
  });
}
```

### Decision Trace Enables

1. **Why was this decomposition chosen?**
   - Rationale shows reasoning
   - Precedents show learned patterns
   - Inputs show context used

2. **What happened during execution?**
   - Full journal of steps
   - Actor messages logged
   - WASM executions recorded

3. **How effective was the decomposition?**
   - Success rate tracked
   - Execution time measured
   - Cost calculated

4. **Can we improve?**
   - Failed steps identified
   - Bottlenecks highlighted
   - Alternative strategies suggested

---

## Example 6: Studio Visualization

### Decomposition Tree View

```
📊 Decomposition: Customer Churn Analysis
├─ ✅ Step 1: Chunk Data (WASM)                [5ms]
│  └─ Result: 50 chunks created
│
├─ ✅ Step 2: Analyze Chunks (Recursive)       [8.2s]
│  ├─ ✅ Child 1: Chunk 1-1000                 [160ms]
│  │  ├─ ✅ Parse records (WASM)               [5ms]
│  │  ├─ ✅ Calculate scores (WASM)            [10ms]
│  │  └─ ✅ Extract factors (LLM)              [145ms]
│  │
│  ├─ ✅ Child 2: Chunk 1001-2000               [165ms]
│  │  └─ ... (same structure)
│  │
│  └─ ... (48 more children)
│
├─ ✅ Step 3: Aggregate Results (WASM)         [15ms]
│  └─ Result: Aggregated 50 chunk analyses
│
├─ ✅ Step 4: Extract Patterns (LLM)           [890ms]
│  └─ Result: 5 churn patterns identified
│
└─ ✅ Step 5: Generate Strategies (LLM)        [1.2s]
   └─ Result: 15 retention strategies created

⏱️ Total Time: 10.3 seconds
💰 Total Cost: $0.23
✅ Success Rate: 100%
```

### Actor Call Hierarchy

```
RecursiveDecompositionActor (root)
│
├─ sendMessage → data-chunker-wasm
│  └─ response: [chunk-1, chunk-2, ..., chunk-50]
│
├─ spawnChild → RLM-child-1
│  ├─ sendMessage → record-parser-wasm
│  │  └─ response: parsed records
│  ├─ sendMessage → score-calculator-wasm
│  │  └─ response: churn scores
│  └─ llmQuery → "Extract risk factors"
│     └─ response: [factor-1, factor-2, factor-3]
│
├─ spawnChild → RLM-child-2
│  └─ ... (same structure)
│
├─ sendMessage → aggregator-wasm
│  └─ response: aggregated data
│
├─ llmQuery → "Extract patterns"
│  └─ response: [pattern-1, ..., pattern-5]
│
└─ llmQuery → "Generate strategies"
   └─ response: strategy playbook
```

### Context Graph Evolution

```
Before Decomposition:
─────────────────────
Entities: 3
Facts: 8
Patterns: 2

After Decomposition:
────────────────────
Entities: 58 (+55)
  - 1 decomposition pattern
  - 50 customer segments
  - 5 churn patterns
  - 2 retention strategies

Facts: 173 (+165)
  - 50 "segment_analyzed"
  - 50 "has_churn_score"
  - 50 "has_risk_factors"
  - 5 "pattern_identified"
  - 10 "strategy_recommended"

Patterns: 3 (+1)
  - "customer-churn-analysis" pattern learned
```

---

## Example 7: Error Handling & Recovery

### Failed Step Handling

```typescript
private async executeStep(
  step: DecompositionStep,
  existingResults: Map<string, any>,
  depth: number
): Promise<any> {
  try {
    return await this.executeStepInternal(step, existingResults, depth);
  } catch (error) {
    // Record failure
    this.journal.entries.push({
      type: 'decomposition_step_failed',
      stepId: step.id,
      error: error.message,
      timestamp: Date.now()
    });

    // Decision: Should we retry, skip, or abort?
    const decision = await this.decideOnFailure(step, error, depth);

    await this.recordDecision({
      decisionType: 'escalation',
      rationale: `Step ${step.id} failed: ${error.message}. Decided to ${decision.action}`,
      reasoning: [
        `Error type: ${error.constructor.name}`,
        `Step criticality: ${step.criticality || 'medium'}`,
        `Retry count: ${step.retryCount || 0}`,
        `Alternative available: ${decision.hasAlternative}`
      ],
      inputs: [
        { system: 'error', entity: 'exception', data: error, confidence: 1.0 },
        { system: 'plan', entity: 'step', data: step, confidence: 1.0 }
      ],
      outcome: decision
    });

    if (decision.action === 'retry') {
      step.retryCount = (step.retryCount || 0) + 1;
      return await this.executeStep(step, existingResults, depth);
    } else if (decision.action === 'skip') {
      return { skipped: true, reason: error.message };
    } else if (decision.action === 'alternative') {
      return await this.executeAlternativeStep(decision.alternativeStep, existingResults, depth);
    } else {
      throw error;  // Abort decomposition
    }
  }
}
```

### Compensation Pattern

```typescript
// If Step 5 fails, compensate Steps 1-4
async compensateDecomposition(
  plan: DecompositionPlan,
  failedStepId: string,
  completedResults: Map<string, any>
): Promise<void> {
  const failedStepIndex = plan.steps.findIndex(s => s.id === failedStepId);
  
  // Compensate in reverse order
  for (let i = failedStepIndex - 1; i >= 0; i--) {
    const step = plan.steps[i];
    const result = completedResults.get(step.id);
    
    if (result && this.isCompensatable(step)) {
      await this.compensateStep(step, result);
    }
  }
}
```

---

## Example 8: Cost Optimization

### Intelligent Caching

```typescript
private async llmQuery(
  step: DecompositionStep,
  existingResults: Map<string, any>
): Promise<any> {
  // Build prompt
  const prompt = this.buildPrompt(step, existingResults);
  
  // Check cache (Context Graph) for identical prompt
  const cachedResponse = await this.contextGraph.search(prompt);
  
  if (cachedResponse && this.isCacheValid(cachedResponse)) {
    console.log(`💰 Cache HIT: Saved LLM call ($0.05)`);
    return cachedResponse.data;
  }
  
  // Cache MISS: Call LLM
  const response = await this.llmClient.completion(prompt);
  
  // Store in cache
  await this.contextGraph.addFact(
    'llm-cache',
    'has_response',
    prompt,
    JSON.stringify(response),
    { confidence: 1.0, metadata: { timestamp: Date.now(), cost: 0.05 } }
  );
  
  return response;
}
```

### Execution Plan Optimization

```typescript
// Before: Sequential execution
Step 1 → Step 2 → Step 3 → Step 4 → Step 5
  2s      3s      1s      4s      2s
Total: 12s

// After: Parallel + Pipeline
Step 1 (2s) ─┬─→ Step 2 (3s) ─┐
             │                 ├─→ Step 4 (4s) ─→ Step 5 (2s)
             └─→ Step 3 (1s) ─┘
Total: 2s + max(3s, 1s) + 4s + 2s = 11s (8% improvement)

// LLM optimizes execution mode based on dependencies
```

---

## Summary

These examples demonstrate:

1. **Actor-native decomposition** - No Python REPL needed
2. **WASM for compute** - 100x faster than interpreted code
3. **Pattern learning** - Context Graph enables reuse
4. **Decision tracing** - Full auditability
5. **Studio visualization** - Rich debugging tools
6. **Error recovery** - Intelligent retry and compensation
7. **Cost optimization** - Caching and parallel execution

**Next Steps**: Let's implement the `RecursiveDecompositionActor` and start with a simple example!
