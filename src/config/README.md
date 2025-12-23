# Configuration Resolution System

Generic, hierarchical configuration for all actors. Context-aware resolution with automatic fallback.

## Philosophy

- **Generic**: Works for any config (LLM, database, API keys, feature flags)
- **Hierarchical**: Automatic fallback from specific → general → global
- **Pluggable**: Memory, Redis, CosmosDB, Azure App Config backends
- **Admin-friendly**: Import/export, bulk operations, validation

## Quick Start

```typescript
import { InMemoryConfigResolver, ConfigAdmin } from '@loom/config'

// Initialize resolver
const config = new InMemoryConfigResolver()

// Set configuration
await config.set('acme/finance/prod/azure-openai', {
  apiKey: 'sk-...',
  endpoint: 'https://acme-openai.azure.com',
  deployment: 'gpt-4o'
})

await config.set('global/azure-openai', {
  apiKey: 'sk-global-...',
  endpoint: 'https://global-openai.azure.com',
  deployment: 'gpt-4o-mini'
})

// Context-aware get (with automatic fallback)
const llmConfig = await config.getWithContext('azure-openai', {
  clientId: 'acme',
  tenantId: 'finance',
  environment: 'prod'
})
// Returns: acme/finance/prod/azure-openai

// If not found at specific level, falls back
const devConfig = await config.getWithContext('azure-openai', {
  clientId: 'acme',
  tenantId: 'finance',
  environment: 'dev'  // No dev config exists
})
// Returns: global/azure-openai (fallback)
```

## Hierarchical Key Pattern

```
{clientId}/{tenantId}/{environment}/{component}/{key}

Examples:
- acme-corp/finance/prod/azure-openai/api-key
- acme-corp/finance/prod/database/connection-string
- acme-corp/hr/dev/redis/host
- global/default/email-service/api-key
```

## Resolution Strategy

Most specific → Least specific → Global

```typescript
getWithContext("azure-openai", {
  clientId: "acme",
  tenantId: "finance", 
  environment: "prod"
})

// Tries in order:
1. acme/finance/prod/azure-openai  ✅ FOUND
2. acme/finance/azure-openai
3. acme/prod/azure-openai
4. acme/azure-openai
5. prod/azure-openai
6. azure-openai
7. global/azure-openai
```

## Actor Integration

```typescript
import { Actor } from '@loom/actor'
import type { LLMConfig } from '@loom/ai'

class MyAIActor extends Actor {
  async execute() {
    // Get config using actor's context
    const llmConfig = await this.getConfig<LLMConfig>('azure-openai')
    
    // Config automatically resolved based on:
    // - this.context.clientId
    // - this.context.tenantId
    // - this.context.environment
    
    // Use it
    this.initializeLLM(llmConfig)
  }
}
```

## Administrative Operations

```typescript
import { ConfigAdmin } from '@loom/config'

const admin = new ConfigAdmin(config)

// Import from JSON
await admin.importConfig({
  acme: {
    finance: {
      prod: {
        'azure-openai': {
          apiKey: 'sk-...',
          endpoint: 'https://...',
          deployment: 'gpt-4o'
        },
        database: {
          connectionString: 'mongodb://...'
        }
      }
    }
  }
})

// Export to JSON (for backup)
const backup = await admin.exportConfig('acme/finance')

// Copy config (e.g., dev → staging)
await admin.copyConfig('acme/finance/dev', 'acme/finance/staging')

// Delete all config for client
await admin.deletePrefix('acme')

// Validate required config exists
const validation = await admin.validateStructure([
  'acme/finance/prod/azure-openai',
  'acme/finance/prod/database'
])
```

## Backend Implementations

### In-Memory (Current)
```typescript
const config = new InMemoryConfigResolver()
```
**Use:** Development, testing, single-instance

### Redis (Coming Soon)
```typescript
const config = new RedisConfigResolver(redisClient)
```
**Use:** Production cache layer, fast lookups

### CosmosDB (Coming Soon)
```typescript
const config = new CosmosDBConfigResolver(cosmosClient)
```
**Use:** Persistent, distributed, multi-region

### Azure App Config (Coming Soon)
```typescript
const config = new AzureAppConfigResolver({
  connectionString: '...'
})
```
**Use:** Enterprise, managed service, feature flags

### Layered (Best for Production)
```typescript
const config = new LayeredConfigResolver(
  new RedisConfigResolver(redis),      // Fast cache
  new CosmosDBConfigResolver(cosmos)   // Persistent store
)
```

## Change Notifications

```typescript
const unsubscribe = config.onChange((event) => {
  console.log('Config changed:', event.keyPath)
  console.log('Old value:', event.oldValue)
  console.log('New value:', event.newValue)
  
  // Reload config in running actors
  actorRuntime.broadcast({
    type: 'config-changed',
    keyPath: event.keyPath
  })
})

// Later: unsubscribe()
```

## Context Dimensions

Standard dimensions:
- `clientId` - Top-level customer/organization
- `tenantId` - Sub-organization (department, subsidiary)
- `userId` - User-specific config
- `environment` - prod, dev, staging, test
- `region` - us-east-1, eu-west-1, etc.
- `actorId` - Actor-instance specific

Custom dimensions:
```typescript
await config.getWithContext('feature-flags', {
  clientId: 'acme',
  customDimension: 'value'  // Extensible!
})
```

## Best Practices

### 1. Structure by Specificity
```
✅ Good:
client/tenant/env/component
acme/finance/prod/azure-openai

❌ Avoid:
component/client/tenant/env  
azure-openai/acme/finance/prod
```

### 2. Use Global Defaults
```typescript
// Set sensible defaults
await config.set('global/azure-openai', defaultLLMConfig)
await config.set('global/database', defaultDBConfig)

// Override for specific clients
await config.set('premium-client/prod/azure-openai', premiumLLMConfig)
```

### 3. Version Your Config
```typescript
// Include version in config value
await config.set('acme/prod/api-config', {
  version: '2.0',
  endpoint: '...',
  // ...
})
```

### 4. Validate on Load
```typescript
const validation = await admin.validateStructure([
  'my-client/prod/azure-openai',
  'my-client/prod/database',
  'my-client/prod/redis'
])

if (!validation.valid) {
  throw new Error(`Missing config: ${validation.missing.join(', ')}`)
}
```

## Security Considerations

**Current implementation:** Config values stored in plain text

**Production requirements:**
- Encrypt sensitive values (API keys, secrets)
- Use Azure Key Vault for production secrets
- Implement access control per client/tenant
- Audit all config changes

**Coming soon:**
```typescript
// Encrypted values
await config.set('acme/prod/azure-openai/api-key', {
  encrypted: true,
  value: encryptedValue,
  keyVaultRef: 'azure://keyvault/secret/name'
})
```

## Examples

See:
- `examples/config-basic-usage.ts` - Basic operations
- `examples/config-actor-integration.ts` - Actor usage
- `examples/config-admin-operations.ts` - Administrative tasks

## API Reference

### ConfigResolver Interface
```typescript
interface ConfigResolver {
  get(keyPath: string): Promise<ConfigValue>
  getWithContext(key: string, context: ConfigContext): Promise<ConfigValue>
  getAll(prefix: string): Promise<Record<string, ConfigValue>>
  set(keyPath: string, value: ConfigValue): Promise<void>
  delete(keyPath: string): Promise<void>
  listKeys(prefix: string): Promise<string[]>
}
```

### ConfigContext Interface
```typescript
interface ConfigContext {
  clientId?: string
  tenantId?: string
  userId?: string
  environment?: string
  region?: string
  actorId?: string
  [key: string]: string | undefined
}
```

## Testing

```typescript
import { InMemoryConfigResolver } from '@loom/config'

describe('My Actor', () => {
  it('uses config correctly', async () => {
    const config = new InMemoryConfigResolver()
    await config.set('test/azure-openai', mockLLMConfig)
    
    const actor = new MyActor({
      ...context,
      configResolver: config,
      clientId: 'test'
    })
    
    // Actor will get config from test/azure-openai
  })
})
```
