# Loom Platform Packaging Strategy

Internal organization packaging for maximum reusability across projects.

## Package Structure

```
@certoai/loom/
├── @certoai/loom-core              # Core actor runtime
├── @certoai/loom-pipelines         # Pipeline orchestration
├── @certoai/loom-storage           # Storage adapters
├── @certoai/loom-discovery         # Service discovery
├── @certoai/loom-observability     # Tracing & monitoring
└── @certoai/loom-config            # Configuration management
```

## Package Breakdown

### 1. `@certoai/loom-core`
**Core actor runtime and message passing**

```typescript
// Exports
export { Actor, ActorContext } from './actor'
export { Message, MessageEnvelope } from './message'
export { ActorWorker } from './actor-worker'
export { ActorRegistry } from './registry'
```

**Dependencies**: None (zero deps)
**Size**: ~50KB

### 2. `@certoai/loom-pipelines`
**Workflow orchestration with all patterns**

```typescript
// Exports
export { PipelineOrchestrator } from './orchestrator'
export { PipelineDefinition, StageDefinition } from './dsl'
export { CircuitBreaker } from './circuit-breaker'
export { SagaCoordinator } from './saga'
export { HumanApprovalExecutor } from './human-approval'
export { IdempotencyManager } from './idempotency'
```

**Dependencies**:
- `@certoai/loom-core`
- `@certoai/loom-storage`
- `@certoai/loom-observability`

**Size**: ~200KB

### 3. `@certoai/loom-storage`
**Storage adapters and message queues**

```typescript
// Exports
export { MessageQueue } from './message-queue'
export { BullMQMessageQueue } from './bullmq-message-queue'
export { CosmosDBActorRegistry } from './cosmosdb-actor-registry'
export { OutboxPattern } from './outbox'
```

**Dependencies**:
- `bullmq`
- `@azure/cosmos` (peer dependency)
- `ioredis` (peer dependency)

**Size**: ~100KB

### 4. `@certoai/loom-discovery`
**Service discovery and actor metadata**

```typescript
// Exports
export { ActorRegistry } from './registry'
export { ActorMetadata } from './actor-metadata'
export { ActorConfigLoader } from './config-loader'
export { ServiceDiscovery } from './service-discovery'
```

**Dependencies**:
- `@certoai/loom-core`
- `js-yaml`

**Size**: ~80KB

### 5. `@certoai/loom-observability`
**Comprehensive execution tracing**

```typescript
// Exports
export { ExecutionTraceRecorder } from './execution-trace'
export { PipelineTracer } from './pipeline-tracer'
export { ExecutionSpan, ExecutionSummary } from './execution-trace'
export { TraceQueryFilter } from './execution-trace'
```

**Dependencies**:
- `@azure/cosmos` (peer dependency)
- `@certoai/loom-core`

**Size**: ~120KB

### 6. `@certoai/loom-config`
**Configuration management**

```typescript
// Exports
export { LoomConfig } from './config'
export { loadConfig } from './loader'
export { ConfigSchema } from './schema'
```

**Dependencies**:
- `js-yaml`
- `joi` or `zod`

**Size**: ~40KB

## Monorepo Structure

```
loom/
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── src/
│   │   ├── tests/
│   │   └── README.md
│   ├── pipelines/
│   │   ├── package.json
│   │   ├── src/
│   │   ├── tests/
│   │   └── README.md
│   ├── storage/
│   ├── discovery/
│   ├── observability/
│   └── config/
├── examples/              # Integration examples
├── docs/                  # Documentation
├── scripts/               # Build scripts
├── package.json           # Root package (workspaces)
├── tsconfig.json          # Shared TypeScript config
└── lerna.json or pnpm-workspace.yaml
```

## Installation Patterns

### Full Platform
```bash
npm install @certoai/loom
```

### Individual Packages
```bash
npm install @certoai/loom-core
npm install @certoai/loom-pipelines
npm install @certoai/loom-observability
```

### With Peer Dependencies
```bash
npm install @certoai/loom-storage ioredis bullmq @azure/cosmos
```

## Usage Patterns

### Pattern 1: Full Platform
```typescript
import { Loom } from '@certoai/loom'

const loom = new Loom({
  redis: { host: 'localhost', port: 6379 },
  cosmos: {
    endpoint: process.env.COSMOS_ENDPOINT,
    // Uses Managed Identity - no key needed!
  }
})

await loom.initialize()

// Register actors
loom.registerActor('pdf-extractor', PDFExtractor)

// Execute pipeline
const result = await loom.executePipeline(pipelineDef, input)
```

### Pattern 2: Selective Imports
```typescript
import { PipelineOrchestrator } from '@certoai/loom-pipelines'
import { BullMQMessageQueue } from '@certoai/loom-storage'
import { ExecutionTraceRecorder } from '@certoai/loom-observability'

// Build custom configuration
const queue = new BullMQMessageQueue(redis, redisConfig)
const tracer = new ExecutionTraceRecorder(cosmosClient)
const orchestrator = new PipelineOrchestrator(queue, registry, redis, tracer)
```

### Pattern 3: Core Only (Minimal)
```typescript
import { Actor, ActorWorker } from '@certoai/loom-core'

class MyActor extends Actor {
  async onReceive(message: any) {
    // Handle message
  }
}

const worker = new ActorWorker('my-worker')
worker.registerActor('my-actor', MyActor)
await worker.start()
```

## Package.json Configuration

### Root package.json
```json
{
  "name": "@certoai/loom",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "lerna run build",
    "test": "lerna run test",
    "publish": "lerna publish"
  },
  "devDependencies": {
    "lerna": "^8.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}
```

### Individual package (e.g., pipelines/package.json)
```json
{
  "name": "@certoai/loom-pipelines",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "dependencies": {
    "@certoai/loom-core": "^1.0.0",
    "@certoai/loom-storage": "^1.0.0",
    "@certoai/loom-observability": "^1.0.0"
  },
  "peerDependencies": {
    "ioredis": "^5.0.0"
  },
  "publishConfig": {
    "registry": "https://your-internal-registry.com"
  }
}
```

## Internal Registry Setup

### Using npm private registry
```bash
# .npmrc
registry=https://your-internal-registry.com
@certoai:registry=https://your-internal-registry.com
```

### Using GitHub Packages
```bash
# .npmrc
@certoai:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

### Using Azure Artifacts
```bash
# .npmrc
@certoai:registry=https://pkgs.dev.azure.com/yourorg/_packaging/yourfeed/npm/registry/
```

## Migration Guide

### From Old Code to Loom

**Before (Custom Code)**
```typescript
// Old: Manual actor management
const actors = new Map()
actors.set('processor', new DocumentProcessor())

// Old: Manual message routing
redis.subscribe('tasks', async (message) => {
  const actor = actors.get(message.actorType)
  await actor.process(message)
})
```

**After (Loom Platform)**
```typescript
// New: Platform handles everything
import { Loom } from '@certoai/loom'

const loom = new Loom(config)
loom.registerActor('processor', DocumentProcessor)

await loom.executePipeline({
  stages: [
    { id: 'process', actor: 'processor', mode: 'execute' }
  ]
}, input)
```

## Version Management

### Semantic Versioning
- **Major**: Breaking API changes
- **Minor**: New features, backward compatible
- **Patch**: Bug fixes

### Package Interdependencies
```
core@1.x.x
├── No dependencies

pipelines@1.x.x
├── core@^1.0.0
├── storage@^1.0.0
└── observability@^1.0.0

storage@1.x.x
└── core@^1.0.0

discovery@1.x.x
└── core@^1.0.0

observability@1.x.x
└── core@^1.0.0
```

## Build & Publish Workflow

```bash
# Build all packages
npm run build

# Test all packages
npm run test

# Version bump
lerna version minor

# Publish to internal registry
lerna publish --registry https://your-internal-registry.com
```

## Integration Examples

### Example 1: Document Processing App
```typescript
// package.json
{
  "dependencies": {
    "@certoai/loom-pipelines": "^1.0.0",
    "@certoai/loom-storage": "^1.0.0",
    "@certoai/loom-observability": "^1.0.0"
  }
}

// app.ts
import { Loom } from '@certoai/loom-pipelines'
import pipeline from './workflows/document-processing.json'

const loom = new Loom(config)
const result = await loom.executePipeline(pipeline, { documentUrl })
```

### Example 2: AI Agent Platform
```typescript
// package.json
{
  "dependencies": {
    "@certoai/loom": "^1.0.0"  // Full platform
  }
}

// agents.ts
import { Loom } from '@certoai/loom'

const loom = new Loom(config)

// Register AI agents
loom.registerActor('researcher', ResearchAgent)
loom.registerActor('writer', WritingAgent)
loom.registerActor('reviewer', ReviewAgent)

// Execute AI workflow with human-in-loop
await loom.executePipeline(aiWorkflow, input)
```

### Example 3: Microservice Integration
```typescript
// Each microservice uses minimal packages
import { ActorWorker } from '@certoai/loom-core'
import { BullMQMessageQueue } from '@certoai/loom-storage'

// Lightweight actor deployment
const worker = new ActorWorker('payment-service')
worker.registerActor('payment-processor', PaymentProcessor)
await worker.start()
```

## Benefits of This Structure

1. **Selective Installation**: Only install what you need
2. **Clear Dependencies**: Each package has explicit deps
3. **Independent Versioning**: Update packages independently
4. **Tree-Shaking**: Bundlers can eliminate unused code
5. **Parallel Development**: Teams work on different packages
6. **Testing Isolation**: Test packages independently
7. **Documentation**: Each package has its own README
8. **Migration Path**: Gradual adoption possible

## Next Steps

1. Set up internal npm registry
2. Configure CI/CD for package publishing
3. Create migration scripts for existing apps
4. Write package-specific documentation
5. Set up automated testing pipeline
6. Create example projects for each use case
