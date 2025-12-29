# Dynamic Configuration

Load tenant and actor-specific configuration from Cosmos DB instead of static YAML files.

## Why Dynamic Config?

- **Per-Tenant Settings:** Different clients get different configurations
- **Per-Actor Settings:** Specific actor types can have custom settings
- **Hot Reload:** Update config without redeploying
- **Priority-Based:** Higher priority configs override lower ones
- **Cached:** 5-minute cache for performance

## Quick Start

```typescript
import { DynamicConfigService } from './config/dynamic-config'

const configService = new DynamicConfigService({
  cosmosEndpoint: process.env.COSMOS_ENDPOINT,
  // Uses DefaultAzureCredential (managed identity) by default
  databaseId: 'loom',
  containerId: 'configs',
  cacheTTL: 300000, // 5 minutes
})

await configService.initialize()
```

## Configuration Hierarchy

Configs are merged by priority (higher wins):

```
1. Actor-specific config (priority 200)
   ↓
2. Tenant-wide config (priority 100)
   ↓
3. Default config (priority 0)
```

## Examples

### Tenant-Level Config
```typescript
await configService.saveConfig({
  tenantId: 'wells-fargo',
  memory: {
    enabled: true,
    deduplicationThreshold: 0.95,
  },
  llm: {
    provider: 'azure-openai',
    model: 'gpt-4',
    temperature: 0.7,
  },
  priority: 100,
})
```

### Actor-Specific Override
```typescript
await configService.saveConfig({
  tenantId: 'wells-fargo',
  actorType: 'CriteriaReviewer',
  memory: {
    semanticCacheTTL: 7200, // 2 hours
  },
  llm: {
    temperature: 0.3, // More deterministic for criteria
  },
  priority: 200,
})
```

### Disable Memory for Specific Actor
```typescript
await configService.saveConfig({
  tenantId: 'wells-fargo',
  actorType: 'DataProcessor',
  memory: {
    enabled: false, // No memory for this actor
  },
  priority: 250,
})
```

## Loading Config in Actor

```typescript
class MyActor {
  async initialize() {
    const config = await configService.getConfig(
      this.context.tenantId,
      this.context.actorType
    )
    
    if (config.memory?.enabled) {
      // Setup memory
    }
    
    if (config.llm) {
      // Use LLM settings
    }
  }
}
```

## Cache Management

```typescript
// Invalidate specific tenant/actor
configService.invalidateCache('wells-fargo', 'CriteriaReviewer')

// Clear all cached configs
configService.clearCache()
```

## Schema

```typescript
interface DynamicConfig {
  id: string
  tenantId: string
  actorType?: string // Optional: applies only to this actor
  
  memory?: {
    enabled: boolean
    deduplicationEnabled?: boolean
    deduplicationThreshold?: number
    semanticCacheEnabled?: boolean
    semanticCacheThreshold?: number
    semanticCacheTTL?: number
  }
  
  llm?: {
    provider: string
    model: string
    temperature?: number
    maxTokens?: number
  }
  
  settings?: Record<string, any> // Custom settings
  
  priority: number // Higher overrides lower
}
```

## Best Practices

1. **Use Priority Wisely:**
   - Tenant defaults: 100
   - Actor-specific: 200
   - Temporary overrides: 300+

2. **Cache TTL:**
   - Development: 60 seconds
   - Production: 5 minutes
   - Critical updates: invalidateCache()

3. **Graceful Degradation:**
   - Always have defaults
   - Don't fail if config missing
   - Log config errors

4. **Testing:**
   - Use separate config container for tests
   - Clear cache between tests
   - Mock configService in unit tests
