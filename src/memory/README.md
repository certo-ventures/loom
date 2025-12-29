# Loom Memory Layer

Semantic memory storage with vector search, deduplication, and caching for AI agents.

## Quick Start

### Option 1: Actor Integration (Recommended)

```typescript
import { createMemoryHelpers } from '../actor/memory-helpers'
import { MemoryFactory } from './memory'
import { DynamicConfigService } from '../config/dynamic-config'

class MyActor {
  private memory: MemoryHelpers
  
  async initialize() {
    // Load dynamic config
    const config = await configService.getConfig(
      this.context.tenantId,
      this.context.actorType
    )
    
    // Setup memory if enabled
    if (config.memory?.enabled) {
      const adapter = await MemoryFactory.createAdapterFromEnv()
      this.memory = createMemoryHelpers(adapter, this.context)
    }
  }
  
  async execute() {
    // Use memory (no-op if not configured)
    const cached = await this.memory.checkCache(query)
    const similar = await this.memory.recall(query)
    await this.memory.remember({ memory: result })
  }
}
```

### Option 2: Direct Usage

```typescript
import { MemoryFactory } from './memory'

// From environment variables
const adapter = await MemoryFactory.createAdapterFromEnv()

// Or from config
const adapter = await MemoryFactory.createAdapter({
  config: {
    cosmosEndpoint: process.env.COSMOS_ENDPOINT,
    cosmosKey: process.env.COSMOS_KEY,
    databaseId: 'loom',
    containerId: 'memories',
    embeddingProvider: 'openai',
    embeddingApiKey: process.env.OPENAI_API_KEY,
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
  }
})
```

## Core Features

### 1. Store Memories
```typescript
const memoryId = await adapter.addMemory({
  tenantId: 'my-org',
  threadId: 'conversation-1',
  turnIndex: 0,
  memory: 'User prefers detailed explanations',
  category: 'user-preference'
})
```

### 2. Semantic Search
```typescript
const results = await adapter.searchMemories('user preferences', {
  tenantId: 'my-org',
  limit: 5
})
```

### 3. Automatic Deduplication
```typescript
// Similar memories are automatically merged
await adapter.addMemory({ memory: 'Foundation is excellent' })
await adapter.addMemory({ memory: 'Foundation is great' })
// ^ Returns same ID, increments occurrence count
```

### 4. Semantic Caching (Save LLM Costs)
```typescript
// Check cache before LLM call
const cached = await adapter.checkSemanticCache(query, tenantId)
if (cached) {
  return cached.response // 💰 Save $0.002-0.02
}

// Call LLM
const response = await callLLM(query)

// Store in cache
await adapter.addToCache(query, response, tenantId, {
  ttl: 3600 // 1 hour
})
```

### 5. Recent Memories
```typescript
// Get last 10 turns
const recent = await adapter.getRecentMemories(tenantId, threadId, 10)
```

## Environment Variables

```bash
COSMOS_ENDPOINT=https://your-cosmos.documents.azure.com:443/
COSMOS_KEY=your-key
COSMOS_DATABASE_ID=loom
COSMOS_MEMORY_CONTAINER=memories

OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

DEDUPLICATION_ENABLED=true
DEDUPLICATION_THRESHOLD=0.95
SEMANTIC_CACHE_ENABLED=true
SEMANTIC_CACHE_THRESHOLD=0.98
SEMANTIC_CACHE_TTL=3600
```

## Architecture

```
MemoryFactory → SemanticMemoryService → CosmosDB
     ↓               ↓
CosmosMemoryAdapter  EmbeddingService → OpenAI
     ↓
Actor System
```

## ROI

- **Cache Hit Rate:** 40-60%
- **LLM Cost Savings:** $240/month
- **Infrastructure Cost:** $40-60/month
- **Net Benefit:** +$180-200/month

## Examples

See [examples/memory-example.ts](../../examples/memory-example.ts) for complete usage examples.

## Testing

```bash
# Set credentials
export COSMOS_ENDPOINT=...
export COSMOS_KEY=...
export OPENAI_API_KEY=...

# Run tests
npm test tests/memory
```

## Opt-In Design

Memory is **completely optional**:
- Actors work normally without memory
- Memory helpers return empty/null if not configured
- Zero overhead if disabled
- Per-tenant and per-actor control via dynamic config

## Configuration

### Static (Environment Variables)
```bash
COSMOS_ENDPOINT=...
OPENAI_API_KEY=...
```

### Dynamic (Cosmos DB)
```typescript
// Enable memory for specific tenant
await configService.saveConfig({
  tenantId: 'wells-fargo',
  memory: { enabled: true },
  priority: 100
})

// Disable for specific actor
await configService.saveConfig({
  tenantId: 'wells-fargo',
  actorType: 'DataProcessor',
  memory: { enabled: false },
  priority: 200
})
```

## Documentation

- [Architecture](../../docs/MEMORY_LAYER_ARCHITECTURE.md)
- [Use Cases](../../docs/MEMORY_LAYER_ARCHITECTURE.md#4-use-cases--implementation)
- [Dynamic Configuration](../config/README.md)
- [Actor Integration Example](../../examples/actor-with-memory.ts)
