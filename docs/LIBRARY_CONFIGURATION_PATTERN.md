# Library Configuration Pattern

## Overview

Loom is designed as a **library**, not a standalone application. As such, it should not directly read from `process.env` or make assumptions about where configuration comes from. Instead, implementing platforms inject configuration through dependency injection.

## Design Principles

1. **Environment Agnostic**: Library code doesn't know about environment variables, config files, or Key Vault
2. **Dependency Injection**: Configuration is provided to services through constructor parameters
3. **Platform Responsibility**: The implementing platform (e.g., loom-server, custom applications) controls configuration sources
4. **Flexible Authentication**: Supports both managed identity (TokenCredential) and API keys

## Configuration Types

### Core Configuration Interfaces

Located in [`src/config/types.ts`](../src/config/types.ts):

```typescript
import type { TokenCredential } from '@azure/identity'

// Cosmos DB connection configuration
export interface CosmosConfig {
  endpoint: string
  databaseId: string
  credential?: TokenCredential // Managed identity (preferred)
}

// Azure OpenAI configuration
export interface AzureOpenAIConfig {
  endpoint: string
  deploymentName: string
  credential?: TokenCredential // Managed identity (preferred)
  apiKey?: string // Alternative to credential
  apiVersion?: string // Default: '2023-05-15'
}

// Standard OpenAI configuration
export interface OpenAIConfig {
  apiKey: string
  model: string
}

// Embedding service configuration
export type EmbeddingConfig = 
  | { provider: 'azure-openai'; azure: AzureOpenAIConfig; dimensions: number }
  | { provider: 'openai'; openai: OpenAIConfig; dimensions: number }

// Memory service configuration
export interface MemoryServiceConfig {
  cosmos: CosmosConfig & { containerId: string }
  embedding: EmbeddingConfig
  deduplicationEnabled?: boolean
  deduplicationThreshold?: number
  semanticCacheEnabled?: boolean
  semanticCacheThreshold?: number
  semanticCacheTTL?: number
}

// Dynamic configuration service configuration
export interface DynamicConfigServiceConfig {
  cosmos: CosmosConfig & { containerId: string }
  cacheTTL?: number
}
```

## Usage Pattern

### Step 1: Platform Loads Configuration

The implementing platform loads configuration from **its** sources:

```typescript
// Platform-specific configuration loading
async function loadPlatformConfiguration() {
  // Option A: Environment variables (simple)
  if (process.env.CONFIG_SOURCE === 'env') {
    return {
      cosmosEndpoint: process.env.COSMOS_ENDPOINT,
      cosmosDatabaseId: process.env.COSMOS_DATABASE_ID || 'loom',
      openaiEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
      openaiDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
      credential: new DefaultAzureCredential(),
    }
  }

  // Option B: Azure Key Vault (production)
  if (process.env.CONFIG_SOURCE === 'keyvault') {
    const client = new SecretClient(process.env.KEY_VAULT_URL, new DefaultAzureCredential())
    return {
      cosmosEndpoint: await client.getSecret('cosmos-endpoint'),
      openaiEndpoint: await client.getSecret('openai-endpoint'),
      // ...
    }
  }

  // Option C: Configuration file (development)
  if (process.env.CONFIG_SOURCE === 'file') {
    const config = JSON.parse(await fs.readFile('./config.json', 'utf-8'))
    return {
      cosmosEndpoint: config.cosmos.endpoint,
      // ...
    }
  }

  // Option D: Kubernetes secrets
  if (process.env.CONFIG_SOURCE === 'k8s') {
    return {
      cosmosEndpoint: await fs.readFile('/var/secrets/cosmos-endpoint', 'utf-8'),
      // ...
    }
  }
}
```

### Step 2: Platform Creates Configuration Objects

```typescript
const platformConfig = await loadPlatformConfiguration()

// Configuration for dynamic config service
const dynamicConfigServiceConfig: DynamicConfigServiceConfig = {
  cosmos: {
    endpoint: platformConfig.cosmosEndpoint,
    databaseId: platformConfig.cosmosDatabaseId,
    containerId: 'configs',
    credential: platformConfig.credential,
  },
  cacheTTL: 300000, // 5 minutes
}

// Configuration for memory service
const memoryServiceConfig: MemoryServiceConfig = {
  cosmos: {
    endpoint: platformConfig.cosmosEndpoint,
    databaseId: platformConfig.cosmosDatabaseId,
    containerId: 'memories',
    credential: platformConfig.credential,
  },
  embedding: {
    provider: 'azure-openai',
    azure: {
      endpoint: platformConfig.openaiEndpoint,
      deploymentName: platformConfig.openaiDeployment,
      credential: platformConfig.credential, // Reuse credential
      apiVersion: '2023-05-15',
    },
    dimensions: 1536,
  },
  deduplicationEnabled: true,
  deduplicationThreshold: 0.95,
}
```

### Step 3: Platform Initializes Library Services

```typescript
// Initialize services with injected configuration
const configService = new DynamicConfigService(dynamicConfigServiceConfig)
await configService.initialize()

const memoryService = new SemanticMemoryService(memoryServiceConfig)
await memoryService.initialize()

const memoryAdapter = new CosmosMemoryAdapter(memoryService)
```

### Step 4: Platform Uses Services

```typescript
// Check tenant configuration
const config = await configService.getConfig('tenant-123', 'CriteriaReviewerActor')

// Create actor with memory if enabled
let actorMemoryAdapter = undefined
if (config.memory?.enabled) {
  actorMemoryAdapter = memoryAdapter
}

const actor = new CriteriaReviewerActor({ memoryAdapter: actorMemoryAdapter })
```

## Benefits

### 1. Environment Agnostic

The library works in **any** environment:
- Cloud (Azure, AWS, GCP)
- On-premises
- Development machines
- CI/CD pipelines
- Edge devices

### 2. Flexible Configuration Sources

Platforms can load configuration from:
- Environment variables
- Configuration files (JSON, YAML, TOML)
- Azure Key Vault
- AWS Secrets Manager
- HashiCorp Vault
- Kubernetes secrets
- etcd
- Consul
- Custom databases

### 3. Easy Testing

Mock configurations for testing:

```typescript
const mockConfig: MemoryServiceConfig = {
  cosmos: {
    endpoint: 'https://mock.cosmos.azure.com',
    databaseId: 'test-db',
    containerId: 'test-memories',
    credential: mockCredential,
  },
  embedding: {
    provider: 'openai',
    openai: {
      apiKey: 'mock-key',
      model: 'text-embedding-ada-002',
    },
    dimensions: 1536,
  },
}

const service = new SemanticMemoryService(mockConfig)
```

### 4. Multiple Deployment Scenarios

Same library code works in:

```typescript
// Scenario 1: Development (local environment variables)
const devConfig = loadFromEnv()

// Scenario 2: Staging (Azure Key Vault)
const stagingConfig = await loadFromKeyVault()

// Scenario 3: Production (Kubernetes secrets)
const prodConfig = await loadFromK8sSecrets()

// Scenario 4: Multi-cloud (custom config service)
const multiCloudConfig = await loadFromCustomService()
```

## Migration from process.env

### Before (Direct environment access)

❌ **Library reads from environment**:

```typescript
export class SemanticMemoryService {
  async initialize() {
    const client = new CosmosClient({
      endpoint: process.env.COSMOS_ENDPOINT,  // ❌ Hardcoded to env
      key: process.env.COSMOS_KEY,
    })
  }
}
```

### After (Dependency injection)

✅ **Platform provides configuration**:

```typescript
export class SemanticMemoryService {
  constructor(private config: MemoryServiceConfig) {}
  
  async initialize() {
    const client = new CosmosClient({
      endpoint: this.config.cosmos.endpoint,  // ✅ Injected by platform
      aadCredentials: this.config.cosmos.credential,
    })
  }
}
```

## Examples

See complete examples in:
- [`examples/library-config-pattern.ts`](../examples/library-config-pattern.ts) - Comprehensive pattern guide
- [`examples/updated-memory-demo.ts`](../examples/updated-memory-demo.ts) - Working demo with dependency injection

## Best Practices

1. **Use TokenCredential over API keys** when possible (managed identity)
2. **Validate configuration** at platform level before passing to library
3. **Reuse credentials** across services (same DefaultAzureCredential instance)
4. **Provide defaults** for optional configuration (e.g., cacheTTL, apiVersion)
5. **Document required vs optional** configuration in platform documentation
6. **Consider configuration validation schemas** (e.g., Zod, Joi) at platform level

## Platform Implementation Checklist

When implementing a platform using Loom library:

- [ ] Create platform-specific configuration loader
- [ ] Choose configuration source (env, Key Vault, config files, etc.)
- [ ] Create configuration objects for library services
- [ ] Initialize services with injected configuration
- [ ] Handle configuration validation and errors
- [ ] Document configuration requirements for platform users
- [ ] Provide example configuration files/env templates
- [ ] Consider configuration hot-reloading if needed
- [ ] Implement configuration secrets management
- [ ] Test with different configuration sources

## Security Considerations

1. **Never commit credentials** to source control
2. **Use managed identity** in production (Azure, AWS, GCP)
3. **Rotate secrets** regularly
4. **Validate configuration** before use
5. **Log configuration loading** (but not secrets)
6. **Use least-privilege** credentials
7. **Consider configuration encryption** at rest
8. **Audit configuration access**

## Summary

**Library responsibilities:**
- Define configuration interfaces
- Accept configuration through constructors
- Validate configuration structure
- Use provided configuration

**Platform responsibilities:**
- Load configuration from appropriate sources
- Create configuration objects
- Manage credentials and secrets
- Initialize library services
- Handle configuration errors
- Provide configuration documentation to end users
