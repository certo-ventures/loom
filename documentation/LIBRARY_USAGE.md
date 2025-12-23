# Loom - Internal Library Usage Guide

## Installation

### Option 1: From GitHub Packages (Recommended)

```bash
# Configure npm to use GitHub Packages for @your-org scope
npm config set @your-org:registry https://npm.pkg.github.com

# Install the package
npm install @your-org/loom
```

### Option 2: From Local Path (Development)

```bash
# In your project
npm install ../path/to/loom

# Or using npm link
cd /path/to/loom
npm link
cd /path/to/your-project
npm link @your-org/loom
```

### Option 3: From Git URL

```bash
npm install git+https://github.com/your-org/loom.git#main
```

## Quick Start

### Core Actors & Workflows

```typescript
import { 
  Actor, 
  Workflow, 
  InMemoryStateStore 
} from '@your-org/loom'

// Create an actor
class MyActor extends Actor {
  async execute(input: any) {
    return { result: 'processed' }
  }
}

// Use in workflow
const workflow = new Workflow(new InMemoryStateStore())
```

### Pipeline/Workflow Orchestration (NEW!)

```typescript
import { 
  PipelineOrchestrator,
  PipelineActorWorker,
  BullMQMessageQueue,
  type PipelineDefinition 
} from '@your-org/loom/pipelines'

import { InMemoryActorRegistry } from '@your-org/loom/discovery'
import { Redis } from 'ioredis'

// Define your workflow declaratively
const workflow: PipelineDefinition = {
  name: 'my-workflow',
  stages: [
    {
      name: 'process-files',
      mode: 'scatter',  // Pluggable executor
      actor: 'FileProcessor',
      scatter: {
        input: '$.trigger.files',
        as: 'file'
      },
      executorConfig: {
        maxParallel: 5
      }
    },
    {
      name: 'consolidate',
      mode: 'gather',  // Barrier + grouping
      actor: 'Consolidator',
      gather: {
        stage: 'process-files',
        groupBy: '$.type'
      }
    }
  ]
}

// Setup infrastructure
const redis = new Redis('redis://localhost:6379')
const messageQueue = new BullMQMessageQueue(redis)
const orchestrator = new PipelineOrchestrator(
  messageQueue,
  new InMemoryActorRegistry(),
  redis
)
const worker = new PipelineActorWorker(messageQueue)

// Register your business logic actors
worker.registerActor('FileProcessor', FileProcessorClass)
worker.registerActor('Consolidator', ConsolidatorClass)
worker.startWorker('FileProcessor', 5)
worker.startWorker('Consolidator', 2)

// Execute the workflow
const pipelineId = await orchestrator.execute(workflow, {
  files: [/* ... */]
})
```

## Module Structure

### Main Module (`@your-org/loom`)
Core functionality:
- `Actor`, `Workflow`, `Activity`
- `InMemoryStateStore`, `CosmosDBStateStore`
- `Observability`, `Tracing`

### Pipelines Module (`@your-org/loom/pipelines`)
Workflow orchestration:
- `PipelineOrchestrator` - Execute workflows
- `PipelineActorWorker` - Worker pool management
- `PipelineDefinition` - Declarative workflow DSL
- Built-in executors: `scatter`, `gather`, `single`, `broadcast`, `fork-join`
- Custom executor interface: `StageExecutor`

### Discovery Module (`@your-org/loom/discovery`)
Service discovery:
- `InMemoryActorRegistry`
- `ConsulDiscovery` (if configured)

### Storage Module (`@your-org/loom/storage`)
Persistence:
- `BullMQMessageQueue` - Redis-backed message queue
- `InMemoryStateStore`
- `CosmosDBStateStore`

## Pluggable Executors

Create custom execution patterns:

```typescript
import { 
  BaseStageExecutor, 
  type ExecutionContext 
} from '@your-org/loom/pipelines'

class RateLimitedExecutor extends BaseStageExecutor {
  getName() { return 'rate-limited' }
  
  async execute(context: ExecutionContext) {
    // Custom execution logic
    const config = this.getConfig(context.stage)
    // Apply rate limiting...
    return { expectedTasks: 1 }
  }
  
  validate(stage: any) { return true }
}

// Register it
orchestrator.registerExecutor(new RateLimitedExecutor())

// Use in pipeline
{
  name: 'api-call',
  mode: 'rate-limited',  // Your custom executor!
  actor: 'APIClient',
  executorConfig: {
    requestsPerSecond: 10
  }
}
```

## Examples

See the `/examples` directory for:
- `document-processing-workflow.ts` - Full document processing pipeline
- `contract-analysis-pipeline.ts` - Multi-stage analysis with grouping
- `workflow-demo.ts` - Basic workflow patterns
- `observability-demo.ts` - Tracing and monitoring

## TypeScript Support

Full TypeScript definitions included:

```typescript
import type { 
  PipelineDefinition,
  StageDefinition,
  StageExecutor,
  ExecutionContext 
} from '@your-org/loom/pipelines'
```

## Dependencies

Required peer dependencies:
- `ioredis` - For BullMQ/Redis
- `bullmq` - Message queue (if using pipelines)

Optional dependencies:
- `@azure/cosmos` - For CosmosDB state store
- `@anthropic-ai/sdk` or `openai` - For AI actors

## Support

Internal documentation: [Link to your internal docs]
Issues: [Link to your issue tracker]
