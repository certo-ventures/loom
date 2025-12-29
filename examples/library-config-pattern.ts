/**
 * Library Configuration Example
 * Shows how implementing platforms should inject configuration
 */

import { DefaultAzureCredential } from '@azure/identity'
import { DynamicConfigService } from '../src/config/dynamic-config.js'
import { SemanticMemoryService } from '../src/memory/semantic-memory-service.js'
import { CosmosMemoryAdapter } from '../src/memory/memory-adapter.js'
import type { DynamicConfigServiceConfig, MemoryServiceConfig } from '../src/config/types.js'

/**
 * Example: Platform loads configuration from environment, config files, Key Vault, etc.
 * The library services receive configuration through dependency injection
 */
async function platformSetup() {
  // Platform gets config from wherever it stores configuration
  // This could be: environment variables, config files, Azure Key Vault, 
  // Kubernetes secrets, database, etc.
  const platformConfig = await loadPlatformConfiguration()

  // Create configuration objects for library services
  const dynamicConfigServiceConfig: DynamicConfigServiceConfig = {
    cosmos: {
      endpoint: platformConfig.cosmosEndpoint,
      databaseId: platformConfig.cosmosDatabaseId,
      containerId: 'configs',
      credential: platformConfig.credential, // Platform provides the credential
    },
    cacheTTL: platformConfig.configCacheTTL,
  }

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
        deploymentName: platformConfig.openaiEmbeddingDeployment,
        credential: platformConfig.credential, // Reuse same credential
        apiVersion: '2023-05-15',
      },
      dimensions: 1536,
    },
    deduplicationEnabled: true,
    deduplicationThreshold: 0.95,
    semanticCacheEnabled: true,
    semanticCacheThreshold: 0.95,
    semanticCacheTTL: 3600,
  }

  // Initialize services with injected configuration
  const configService = new DynamicConfigService(dynamicConfigServiceConfig)
  await configService.initialize()

  const memoryService = new SemanticMemoryService(memoryServiceConfig)
  await memoryService.initialize()

  const memoryAdapter = new CosmosMemoryAdapter(memoryService)

  return {
    configService,
    memoryAdapter,
  }
}

/**
 * Platform-specific configuration loading
 * Each platform implements this differently
 */
async function loadPlatformConfiguration() {
  // Example 1: From environment variables (simple deployment)
  if (process.env.CONFIG_SOURCE === 'env') {
    return {
      cosmosEndpoint: process.env.COSMOS_ENDPOINT!,
      cosmosDatabaseId: process.env.COSMOS_DATABASE_ID || 'loom',
      openaiEndpoint: process.env.AZURE_OPENAI_ENDPOINT!,
      openaiEmbeddingDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT!,
      credential: new DefaultAzureCredential(),
      configCacheTTL: 300000, // 5 minutes
    }
  }

  // Example 2: From Azure Key Vault (production)
  if (process.env.CONFIG_SOURCE === 'keyvault') {
    const { SecretClient } = await import('@azure/keyvault-secrets')
    const credential = new DefaultAzureCredential()
    const vaultUrl = process.env.KEY_VAULT_URL!
    const client = new SecretClient(vaultUrl, credential)

    const cosmosEndpoint = await client.getSecret('cosmos-endpoint')
    const openaiEndpoint = await client.getSecret('openai-endpoint')
    const openaiDeployment = await client.getSecret('openai-embedding-deployment')

    return {
      cosmosEndpoint: cosmosEndpoint.value!,
      cosmosDatabaseId: 'loom',
      openaiEndpoint: openaiEndpoint.value!,
      openaiEmbeddingDeployment: openaiDeployment.value!,
      credential,
      configCacheTTL: 300000,
    }
  }

  // Example 3: From configuration file (development)
  if (process.env.CONFIG_SOURCE === 'file') {
    const fs = await import('fs/promises')
    const configFile = await fs.readFile('./platform-config.json', 'utf-8')
    const config = JSON.parse(configFile)

    return {
      cosmosEndpoint: config.cosmos.endpoint,
      cosmosDatabaseId: config.cosmos.databaseId,
      openaiEndpoint: config.openai.endpoint,
      openaiEmbeddingDeployment: config.openai.embeddingDeployment,
      credential: new DefaultAzureCredential(),
      configCacheTTL: config.cache?.ttl || 300000,
    }
  }

  // Example 4: From Kubernetes secrets (K8s deployment)
  if (process.env.CONFIG_SOURCE === 'k8s') {
    // Kubernetes mounts secrets as files
    const fs = await import('fs/promises')
    
    return {
      cosmosEndpoint: await fs.readFile('/var/secrets/cosmos-endpoint', 'utf-8'),
      cosmosDatabaseId: await fs.readFile('/var/secrets/cosmos-database-id', 'utf-8'),
      openaiEndpoint: await fs.readFile('/var/secrets/openai-endpoint', 'utf-8'),
      openaiEmbeddingDeployment: await fs.readFile('/var/secrets/openai-deployment', 'utf-8'),
      credential: new DefaultAzureCredential(),
      configCacheTTL: 300000,
    }
  }

  throw new Error('CONFIG_SOURCE not specified or invalid')
}

/**
 * Example: Using the services in an actor
 */
async function exampleActorUsage() {
  const { configService, memoryAdapter } = await platformSetup()

  // Get tenant-specific configuration
  const config = await configService.getConfig('tenant-123', 'CriteriaReviewerActor')

  // Create actor with memory if enabled
  let actorMemoryAdapter = undefined
  if (config.memory?.enabled) {
    actorMemoryAdapter = memoryAdapter
  }

  // Actor now uses the memory adapter
  // const actor = new CriteriaReviewerActor({ memoryAdapter: actorMemoryAdapter })

  console.log('✓ Services configured via dependency injection')
  console.log('✓ Platform controls configuration source')
  console.log('✓ Library is environment-agnostic')
}

// Run example
if (import.meta.url === `file://${process.argv[1]}`) {
  exampleActorUsage().catch(console.error)
}

export { platformSetup, loadPlatformConfiguration }
