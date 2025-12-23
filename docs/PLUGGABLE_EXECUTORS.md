# Pluggable Executor System

## Problem with Hardcoded Patterns

**Before** (Hardcoded):
```typescript
switch (stage.mode) {
  case 'single': await this.executeSingleStage(...)
  case 'scatter': await this.executeScatterStage(...)
  case 'gather': await this.executeGatherStage(...)
}
```

**Limitations**:
- ❌ New patterns require modifying orchestrator code
- ❌ Cannot extend without editing core
- ❌ Not reusable across projects
- ❌ Hard to test patterns in isolation

## Solution: Pluggable Executors

**Now** (Pluggable):
```typescript
// Get executor dynamically
const executor = this.executors.get(stage.mode)
await executor.execute(context)
```

**Benefits**:
- ✅ Add new patterns without modifying orchestrator
- ✅ Executors registered like actors (same pattern!)
- ✅ Third-party executor libraries possible
- ✅ Test each pattern independently
- ✅ Configure per-stage via `executorConfig`

## Executor Interface

```typescript
export interface StageExecutor {
  /**
   * Execute the stage pattern
   */
  execute(context: ExecutionContext): Promise<ExecutionResult>
  
  /**
   * Validate stage configuration
   */
  validate(stage: StageDefinition): boolean
  
  /**
   * Get executor name/type
   */
  getName(): string
}
```

### ExecutionContext

```typescript
interface ExecutionContext {
  pipelineId: string
  stage: StageDefinition
  pipelineContext: any  // Previous stage outputs
  messageQueue: BullMQMessageQueue  // For enqueueing tasks
  redis: any  // For state management
}
```

### ExecutionResult

```typescript
interface ExecutionResult {
  expectedTasks: number  // For barrier synchronization
  metadata?: any
}
```

## Built-in Executors

### 1. SingleExecutor
Executes one actor instance.

```typescript
{
  name: 'process',
  mode: 'single',
  actor: 'DataProcessor',
  input: { data: '$.trigger.payload' }
}
```

### 2. ScatterExecutor (Fan-Out)
Distributes work across multiple actors in parallel.

```typescript
{
  name: 'process-files',
  mode: 'scatter',
  actor: 'FileProcessor',
  scatter: {
    input: '$.trigger.files',  // JSONPath to array
    as: 'file'                  // Variable name
  },
  input: {
    filepath: '$.file.path'
  },
  executorConfig: {
    maxParallel: 10,  // ← Limit concurrent tasks
    batchSize: 100
  }
}
```

**Config**:
- `maxParallel?: number` - Limit concurrent execution
- `batchSize?: number` - Process in batches

### 3. GatherExecutor (Barrier Sync)
Waits for all tasks to complete, optionally groups results.

```typescript
{
  name: 'consolidate',
  mode: 'gather',
  actor: 'Consolidator',
  gather: {
    stage: 'process-files',     // Wait for this stage
    groupBy: '$.documentType'   // ← Optional grouping
  },
  input: {
    group: '$.group'  // { key, items }
  },
  executorConfig: {
    timeout: 30000,    // ← Max wait time
    minResults: 1      // Minimum results required
  }
}
```

**Config**:
- `timeout?: number` - Max wait time in ms
- `minResults?: number` - Minimum results required

**Barrier**: Orchestrator waits for `completedTasks >= expectedTasks`

### 4. BroadcastExecutor
Sends same input to multiple actor types.

```typescript
{
  name: 'notify-all',
  mode: 'broadcast',
  actor: 'unused',
  input: { message: '$.result' },
  executorConfig: {
    actors: ['EmailNotifier', 'SlackNotifier', 'WebhookNotifier'],
    waitForAll: true  // ← Barrier on all
  }
}
```

**Config**:
- `actors: string[]` - Actor types to broadcast to
- `waitForAll?: boolean` - Wait for all to complete (default: true)

### 5. ForkJoinExecutor
Parallel branches with different actors.

```typescript
{
  name: 'parallel-processing',
  mode: 'fork-join',
  actor: 'unused',
  input: { data: '$.trigger' },
  executorConfig: {
    branches: [
      {
        name: 'extract',
        actor: 'DataExtractor',
        input: { source: '$.data.source' }
      },
      {
        name: 'validate',
        actor: 'Validator',
        input: { rules: '$.data.rules' }
      },
      {
        name: 'transform',
        actor: 'Transformer',
        input: { schema: '$.data.schema' }
      }
    ]
  }
}
```

**Config**:
- `branches: Array<{ name, actor, input? }>` - Parallel branches

## Creating Custom Executors

```typescript
import { BaseStageExecutor, ExecutionContext, ExecutionResult } from './stage-executor'

export class RateLimitedExecutor extends BaseStageExecutor {
  getName() {
    return 'rate-limited'
  }
  
  validate(stage: StageDefinition): boolean {
    const config = this.getConfig<{ rateLimit: number }>(stage)
    return config.rateLimit > 0
  }
  
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { pipelineId, stage, pipelineContext, messageQueue } = context
    const config = this.getConfig<{ rateLimit: number }>(stage)
    
    // Get items to process
    let items = jp.query(pipelineContext, stage.scatter!.input)
    
    // Enqueue with rate limiting
    for (let i = 0; i < items.length; i++) {
      const input = this.resolveInput(stage.input, {
        ...pipelineContext,
        item: items[i]
      })
      
      const message = this.createMessage(
        pipelineId,
        stage.name,
        stage.actor,
        i,
        input
      )
      
      await messageQueue.enqueue(`actor-${stage.actor}`, message)
      
      // Rate limit: wait between enqueues
      if (i < items.length - 1) {
        await new Promise(r => setTimeout(r, 1000 / config.rateLimit))
      }
    }
    
    return { expectedTasks: items.length }
  }
}

// Register it
orchestrator.registerExecutor(new RateLimitedExecutor())

// Use in pipeline
{
  name: 'api-calls',
  mode: 'rate-limited',  // ← Custom executor!
  actor: 'APIClient',
  scatter: { input: '$.requests', as: 'request' },
  input: { url: '$.request.url' },
  executorConfig: {
    rateLimit: 10  // 10 requests per second
  }
}
```

## Usage in WDL-style DSL

```wdl
workflow DocumentProcessing {
  # Scatter with parallelism limit
  scatter (file in files) {
    call FileProcessor {
      input: filepath = file.path
      config: {
        maxParallel: 5
      }
    }
  }
  
  # Gather with grouping
  gather (page in FileProcessor.outputs) groupBy: page.documentType {
    call Consolidator {
      input: pages = gather.group.items
      config: {
        timeout: 30000
      }
    }
  }
  
  # Broadcast
  broadcast {
    call EmailNotifier { input: result = Consolidator.output }
    call SlackNotifier { input: result = Consolidator.output }
    call WebhookNotifier { input: result = Consolidator.output }
  }
  
  # Fork-Join
  parallel {
    branch extract: call DataExtractor
    branch validate: call Validator
    branch transform: call Transformer
  }
}
```

## Comparison: Actors vs Executors

| Aspect | Actors | Executors |
|--------|--------|-----------|
| **What** | Business logic | Orchestration patterns |
| **When** | Process data | Fan-out, gather, broadcast |
| **Registry** | `actorRegistry.register()` | `orchestrator.registerExecutor()` |
| **Instantiation** | Dynamic per task | One instance, reused |
| **Config** | Actor-specific input | `executorConfig` in stage |
| **Examples** | FileProcessor, Classifier | Scatter, Gather, Broadcast |

## Key Points

1. **Scatter** = Fan-out (parallel execution)
2. **Gather** = Barrier (wait for all) + optional grouping
3. **Barrier** = Wait until `completedTasks >= expectedTasks`
4. **Executors** are registered like actors (pluggable!)
5. **Config** per stage via `executorConfig`
6. **Extensible** - add custom patterns without modifying core

## Real-World Example

```typescript
// Register custom executor
orchestrator.registerExecutor(new RetryExecutor())
orchestrator.registerExecutor(new CircuitBreakerExecutor())

// Use in pipeline
const pipeline = {
  stages: [
    {
      name: 'fetch-data',
      mode: 'retry',  // ← Custom!
      actor: 'APIFetcher',
      executorConfig: {
        maxRetries: 3,
        backoff: 'exponential'
      }
    },
    {
      name: 'process',
      mode: 'circuit-breaker',  // ← Custom!
      actor: 'DataProcessor',
      executorConfig: {
        threshold: 5,
        timeout: 10000
      }
    }
  ]
}
```

**This is the power of pluggable executors** - extend the orchestrator without modifying it!
