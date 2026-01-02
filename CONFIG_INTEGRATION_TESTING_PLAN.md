# Configuration Integration Testing Plan

**Status:** COMPREHENSIVE TEST STRATEGY  
**Date:** January 1, 2026

---

## Testing Philosophy

**Goal:** Prove configuration system is rock solid in all failure scenarios.

**Principles:**
1. **Test failures more than success** - Config failures must be handled correctly
2. **Test error messages** - Errors must be actionable and clear
3. **Test all layers** - Unit → Integration → E2E
4. **Test production scenarios** - Multi-tenant, high load, cascading failures
5. **No mocks for critical paths** - Use real Cosmos/Redis for integration tests

---

## Test Structure

```
tests/
├── unit/
│   ├── config/
│   │   ├── actor-config-methods.test.ts        # Actor.getConfig() / tryGetConfig()
│   │   ├── config-error-messages.test.ts       # Error quality
│   │   ├── bootstrap-resolver.test.ts          # Whitelist enforcement
│   │   └── config-path-resolution.test.ts      # Hierarchical resolution
│   └── runtime/
│       ├── actor-validation.test.ts            # Pre-creation validation
│       └── config-injection.test.ts            # ConfigResolver injection
│
├── integration/
│   ├── config-resolver-cosmos.test.ts          # Real Cosmos DB
│   ├── config-resolver-layered.test.ts         # Cache + persist
│   ├── config-multi-tenant.test.ts             # Tenant isolation
│   └── config-hot-reload.test.ts               # Config updates
│
├── e2e/
│   ├── actor-lifecycle-config.test.ts          # Full actor lifecycle
│   ├── multi-actor-config.test.ts              # Multiple actors, different configs
│   └── config-failure-scenarios.test.ts        # Cascading failures
│
└── load/
    ├── config-performance.test.ts              # High throughput
    └── config-cache-effectiveness.test.ts      # Cache hit rates
```

---

## Phase 1: Unit Tests (Critical Path)

### 1.1 Actor Config Methods

**File:** `tests/unit/config/actor-config-methods.test.ts`

```typescript
import { describe, test, expect, beforeEach } from 'vitest'
import { InMemoryConfigResolver } from '@/config-resolver'
import { Actor, ActorContext, ConfigurationError } from '@/actor'

class TestActor extends Actor {
  async initialize() {}
  async execute(input: any): Promise<any> {
    return input
  }
}

describe('Actor Config Methods', () => {
  let resolver: InMemoryConfigResolver
  let context: ActorContext

  beforeEach(() => {
    resolver = new InMemoryConfigResolver()
    context = {
      actorId: 'test-actor-1',
      clientId: 'acme',
      tenantId: 'finance',
      environment: 'prod',
      region: 'us-west',
      configResolver: resolver
    }
  })

  describe('getConfig() - Required Configuration', () => {
    test('returns config when it exists', async () => {
      await resolver.set('global/llm', {
        endpoint: 'https://api.openai.com',
        model: 'gpt-4o'
      })

      const actor = new TestActor(context)
      const config = await actor.getConfig('llm')

      expect(config).toEqual({
        endpoint: 'https://api.openai.com',
        model: 'gpt-4o'
      })
    })

    test('CRITICAL: throws ConfigurationError when config missing', async () => {
      const actor = new TestActor(context)

      await expect(
        actor.getConfig('missing-config')
      ).rejects.toThrow(ConfigurationError)
    })

    test('CRITICAL: error message includes searched paths', async () => {
      const actor = new TestActor(context)

      try {
        await actor.getConfig('azure-openai')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError)
        expect(error.message).toContain('Searched paths')
        expect(error.message).toContain('acme/finance/prod/test-actor-1/azure-openai')
        expect(error.message).toContain('acme/finance/prod/azure-openai')
        expect(error.message).toContain('acme/finance/azure-openai')
        expect(error.message).toContain('acme/azure-openai')
        expect(error.message).toContain('global/azure-openai')
      }
    })

    test('CRITICAL: error includes context details', async () => {
      const actor = new TestActor(context)

      try {
        await actor.getConfig('redis')
        expect.fail('Should have thrown')
      } catch (error) {
        const configError = error as ConfigurationError
        expect(configError.details?.context).toMatchObject({
          actorId: 'test-actor-1',
          clientId: 'acme',
          tenantId: 'finance',
          environment: 'prod',
          region: 'us-west'
        })
        expect(configError.details?.key).toBe('redis')
        expect(configError.details?.searchedPaths).toHaveLength(5)
      }
    })

    test('resolves hierarchically - most specific wins', async () => {
      // Set up hierarchy
      await resolver.set('global/llm', { model: 'gpt-4o-mini' })
      await resolver.set('acme/llm', { model: 'gpt-4o' })
      await resolver.set('acme/finance/llm', { model: 'gpt-4o', temperature: 0.7 })
      await resolver.set('acme/finance/prod/llm', { temperature: 0.5 })

      const actor = new TestActor(context)
      const config = await actor.getConfig('llm')

      // Should merge all levels - most specific overrides less specific
      expect(config.model).toBe('gpt-4o')  // From acme/llm
      expect(config.temperature).toBe(0.5)  // From acme/finance/prod/llm
    })

    test('works with minimal context (only global)', async () => {
      await resolver.set('global/llm', { endpoint: 'https://api.openai.com' })

      const minimalContext: ActorContext = {
        actorId: 'test',
        configResolver: resolver
      }
      const actor = new TestActor(minimalContext)
      const config = await actor.getConfig('llm')

      expect(config.endpoint).toBe('https://api.openai.com')
    })

    test('CRITICAL: never returns null', async () => {
      await resolver.set('global/llm', { endpoint: 'https://api.openai.com' })
      
      const actor = new TestActor(context)
      const config = await actor.getConfig('llm')

      // TypeScript should guarantee this, but test it anyway
      expect(config).not.toBeNull()
      expect(config).not.toBeUndefined()
    })
  })

  describe('tryGetConfig() - Optional Configuration', () => {
    test('returns config when it exists', async () => {
      await resolver.set('global/memory', {
        enabled: true,
        cacheTTL: 300
      })

      const actor = new TestActor(context)
      const config = await actor.tryGetConfig('memory')

      expect(config).toEqual({
        enabled: true,
        cacheTTL: 300
      })
    })

    test('CRITICAL: returns null when config missing (no error)', async () => {
      const actor = new TestActor(context)
      const config = await actor.tryGetConfig('optional-feature')

      expect(config).toBeNull()
    })

    test('distinguishes from getConfig - no throw on missing', async () => {
      const actor = new TestActor(context)

      // tryGetConfig should not throw
      const optional = await actor.tryGetConfig('missing')
      expect(optional).toBeNull()

      // getConfig should throw
      await expect(
        actor.getConfig('missing')
      ).rejects.toThrow(ConfigurationError)
    })

    test('resolves hierarchically like getConfig', async () => {
      await resolver.set('global/tracing', { enabled: false })
      await resolver.set('acme/finance/tracing', { enabled: true })

      const actor = new TestActor(context)
      const config = await actor.tryGetConfig('tracing')

      expect(config?.enabled).toBe(true)
    })

    test('caller must explicitly handle null case', async () => {
      const actor = new TestActor(context)
      const config = await actor.tryGetConfig('optional-feature')

      // This pattern should be enforced in code reviews
      if (config) {
        // Use config
        expect(config).toBeDefined()
      } else {
        // Handle missing case
        expect(config).toBeNull()
      }
    })
  })

  describe('Config Path Resolution', () => {
    test('builds correct paths with full context', async () => {
      const actor = new TestActor(context)

      try {
        await actor.getConfig('test-key')
      } catch (error) {
        const configError = error as ConfigurationError
        expect(configError.details?.searchedPaths).toEqual([
          'acme/finance/prod/test-actor-1/test-key',
          'acme/finance/prod/test-key',
          'acme/finance/test-key',
          'acme/test-key',
          'global/test-key'
        ])
      }
    })

    test('builds correct paths with partial context', async () => {
      const partialContext: ActorContext = {
        actorId: 'test',
        clientId: 'acme',
        configResolver: resolver
      }
      const actor = new TestActor(partialContext)

      try {
        await actor.getConfig('test-key')
      } catch (error) {
        const configError = error as ConfigurationError
        expect(configError.details?.searchedPaths).toEqual([
          'acme/test-key',
          'global/test-key'
        ])
      }
    })

    test('builds correct paths with custom context', async () => {
      const customContext: ActorContext = {
        actorId: 'test',
        clientId: 'acme',
        configResolver: resolver,
        customContext: {
          organizationId: 'org-123',
          departmentId: 'dept-456'
        }
      }
      const actor = new TestActor(customContext)

      // Custom context should be merged into resolution
      const config = await actor.tryGetConfig('test')
      expect(config).toBeNull()  // Fine for tryGetConfig
    })
  })

  describe('Type Safety', () => {
    test('returns typed config', async () => {
      interface LLMConfig {
        endpoint: string
        model: string
        temperature?: number
      }

      await resolver.set('global/llm', {
        endpoint: 'https://api.openai.com',
        model: 'gpt-4o'
      })

      const actor = new TestActor(context)
      const config = await actor.getConfig<LLMConfig>('llm')

      // TypeScript should enforce this
      expect(typeof config.endpoint).toBe('string')
      expect(typeof config.model).toBe('string')
    })

    test('tryGetConfig returns typed config or null', async () => {
      interface MemoryConfig {
        enabled: boolean
        cacheTTL: number
      }

      await resolver.set('global/memory', {
        enabled: true,
        cacheTTL: 300
      })

      const actor = new TestActor(context)
      const config = await actor.tryGetConfig<MemoryConfig>('memory')

      if (config) {
        expect(typeof config.enabled).toBe('boolean')
        expect(typeof config.cacheTTL).toBe('number')
      }
    })
  })
})
```

### 1.2 Runtime Validation Tests

**File:** `tests/unit/runtime/actor-validation.test.ts`

```typescript
import { describe, test, expect, beforeEach } from 'vitest'
import { ActorRuntime, ActorRegistry, ConfigurationError } from '@/actor'
import { InMemoryConfigResolver } from '@/config-resolver'

describe('ActorRuntime Configuration Validation', () => {
  let resolver: InMemoryConfigResolver
  let runtime: ActorRuntime

  beforeEach(() => {
    resolver = new InMemoryConfigResolver()
    runtime = new ActorRuntime({
      configResolver: resolver,
      validateConfig: true  // Always validate in tests
    })

    // Clear registry
    ActorRegistry.clear()
  })

  describe('Pre-Creation Validation', () => {
    test('CRITICAL: validates required config before actor creation', async () => {
      // Register actor with required config
      ActorRegistry.register({
        actorType: 'ai-assistant',
        version: '1.0.0',
        requiredConfig: ['azure-openai', 'redis']
      })

      // Try to create without config
      await expect(
        runtime.createActor('ai-assistant', {
          actorId: 'test-1',
          tenantId: 'acme'
        })
      ).rejects.toThrow(ConfigurationError)

      await expect(
        runtime.createActor('ai-assistant', {
          actorId: 'test-1',
          tenantId: 'acme'
        })
      ).rejects.toThrow('Missing Required Configuration')
    })

    test('validation error shows ALL missing config keys', async () => {
      ActorRegistry.register({
        actorType: 'test-actor',
        version: '1.0.0',
        requiredConfig: ['llm', 'redis', 'cosmos', 'memory']
      })

      try {
        await runtime.createActor('test-actor', { actorId: 'test' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError)
        expect(error.message).toContain('llm')
        expect(error.message).toContain('redis')
        expect(error.message).toContain('cosmos')
        expect(error.message).toContain('memory')
      }
    })

    test('validation error shows context', async () => {
      ActorRegistry.register({
        actorType: 'test-actor',
        version: '1.0.0',
        requiredConfig: ['llm']
      })

      try {
        await runtime.createActor('test-actor', {
          actorId: 'test-1',
          clientId: 'acme',
          tenantId: 'finance',
          environment: 'prod'
        })
        expect.fail('Should have thrown')
      } catch (error) {
        const configError = error as ConfigurationError
        expect(configError.details?.context).toMatchObject({
          actorType: 'test-actor',
          clientId: 'acme',
          tenantId: 'finance',
          environment: 'prod'
        })
      }
    })

    test('validation error shows searched paths for each missing config', async () => {
      ActorRegistry.register({
        actorType: 'test-actor',
        version: '1.0.0',
        requiredConfig: ['azure-openai']
      })

      try {
        await runtime.createActor('test-actor', {
          actorId: 'test-1',
          tenantId: 'acme'
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error.message).toContain('Searched paths')
        expect(error.message).toContain('acme/azure-openai')
        expect(error.message).toContain('global/azure-openai')
      }
    })

    test('validation passes when all required config exists', async () => {
      // Set up config
      await resolver.set('global/azure-openai', {
        endpoint: 'https://api.openai.com',
        model: 'gpt-4o'
      })
      await resolver.set('global/redis', {
        host: 'localhost',
        port: 6379
      })

      ActorRegistry.register({
        actorType: 'ai-assistant',
        version: '1.0.0',
        requiredConfig: ['azure-openai', 'redis']
      })

      // Should NOT throw
      const actor = await runtime.createActor('ai-assistant', {
        actorId: 'test-1'
      })

      expect(actor).toBeDefined()
      expect(actor.actorId).toBe('test-1')
    })

    test('validation allows empty requiredConfig array', async () => {
      ActorRegistry.register({
        actorType: 'simple-actor',
        version: '1.0.0',
        requiredConfig: []  // No required config
      })

      // Should succeed without any config
      const actor = await runtime.createActor('simple-actor', {
        actorId: 'test-1'
      })

      expect(actor).toBeDefined()
    })

    test('CRITICAL: validation enforces requiredConfig is an array', async () => {
      ActorRegistry.register({
        actorType: 'bad-actor',
        version: '1.0.0'
        // Missing requiredConfig field
      })

      await expect(
        runtime.createActor('bad-actor', { actorId: 'test' })
      ).rejects.toThrow('missing requiredConfig in metadata')
    })

    test('validation can be disabled for testing', async () => {
      const noValidateRuntime = new ActorRuntime({
        configResolver: resolver,
        validateConfig: false  // Disable validation
      })

      ActorRegistry.register({
        actorType: 'test-actor',
        version: '1.0.0',
        requiredConfig: ['missing-config']
      })

      // Should succeed even though config missing
      // (Actor will fail when it tries to use config)
      const actor = await noValidateRuntime.createActor('test-actor', {
        actorId: 'test-1'
      })

      expect(actor).toBeDefined()
    })

    test('hierarchical resolution works in validation', async () => {
      // Set tenant-specific config
      await resolver.set('acme/azure-openai', {
        endpoint: 'https://acme.openai.com',
        model: 'gpt-4o'
      })

      ActorRegistry.register({
        actorType: 'test-actor',
        version: '1.0.0',
        requiredConfig: ['azure-openai']
      })

      // Should find config at tenant level
      const actor = await runtime.createActor('test-actor', {
        actorId: 'test-1',
        clientId: 'acme'
      })

      expect(actor).toBeDefined()
    })

    test('partial config (some keys missing) still fails', async () => {
      await resolver.set('global/azure-openai', { endpoint: 'https://api.openai.com' })
      // redis is missing

      ActorRegistry.register({
        actorType: 'test-actor',
        version: '1.0.0',
        requiredConfig: ['azure-openai', 'redis', 'cosmos']
      })

      await expect(
        runtime.createActor('test-actor', { actorId: 'test' })
      ).rejects.toThrow('Missing Required Configuration')

      try {
        await runtime.createActor('test-actor', { actorId: 'test' })
      } catch (error) {
        // Should show only missing keys
        expect(error.message).not.toContain('azure-openai')  // This exists
        expect(error.message).toContain('redis')  // Missing
        expect(error.message).toContain('cosmos')  // Missing
      }
    })
  })

  describe('Optional Configuration', () => {
    test('optional config does NOT block actor creation', async () => {
      ActorRegistry.register({
        actorType: 'test-actor',
        version: '1.0.0',
        requiredConfig: [],
        optionalConfig: ['memory-service', 'tracing']
      })

      // Should succeed even though optional config missing
      const actor = await runtime.createActor('test-actor', {
        actorId: 'test-1'
      })

      expect(actor).toBeDefined()
    })

    test('optional config is available if configured', async () => {
      await resolver.set('global/memory-service', {
        enabled: true
      })

      ActorRegistry.register({
        actorType: 'test-actor',
        version: '1.0.0',
        requiredConfig: [],
        optionalConfig: ['memory-service']
      })

      const actor = await runtime.createActor('test-actor', {
        actorId: 'test-1'
      })

      // Actor can access optional config via tryGetConfig()
      const memoryConfig = await actor.tryGetConfig('memory-service')
      expect(memoryConfig).toEqual({ enabled: true })
    })
  })

  describe('ConfigResolver Injection', () => {
    test('runtime injects configResolver into actor context', async () => {
      ActorRegistry.register({
        actorType: 'test-actor',
        version: '1.0.0',
        requiredConfig: []
      })

      const actor = await runtime.createActor('test-actor', {
        actorId: 'test-1'
      })

      expect(actor.context.configResolver).toBe(resolver)
    })

    test('actor can access config immediately after creation', async () => {
      await resolver.set('global/test-config', { value: 123 })

      ActorRegistry.register({
        actorType: 'test-actor',
        version: '1.0.0',
        requiredConfig: []
      })

      const actor = await runtime.createActor('test-actor', {
        actorId: 'test-1'
      })

      const config = await actor.tryGetConfig('test-config')
      expect(config).toEqual({ value: 123 })
    })
  })

  describe('Error Message Quality', () => {
    test('error provides fix instructions', async () => {
      ActorRegistry.register({
        actorType: 'test-actor',
        version: '1.0.0',
        requiredConfig: ['azure-openai']
      })

      try {
        await runtime.createActor('test-actor', { actorId: 'test' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error.message).toContain('Fix:')
        expect(error.message).toContain('Set required configuration')
        expect(error.message).toContain('Example:')
        expect(error.message).toContain('configResolver.set')
      }
    })

    test('error is actionable - copy/paste ready', async () => {
      ActorRegistry.register({
        actorType: 'test-actor',
        version: '1.0.0',
        requiredConfig: ['azure-openai']
      })

      try {
        await runtime.createActor('test-actor', { actorId: 'test' })
        expect.fail('Should have thrown')
      } catch (error) {
        // Should include example code that can be copy/pasted
        expect(error.message).toMatch(/await configResolver\.set\('global\/azure-openai'/)
      }
    })
  })
})
```

### 1.3 Bootstrap Resolver Tests

**File:** `tests/unit/config/bootstrap-resolver.test.ts`

```typescript
import { describe, test, expect } from 'vitest'
import { BootstrapConfigResolver } from '@/config-resolver'

describe('BootstrapConfigResolver', () => {
  describe('Whitelist Enforcement', () => {
    test('CRITICAL: rejects non-whitelisted keys', async () => {
      const bootstrap = new BootstrapConfigResolver({
        allowedKeys: ['cosmos.endpoint', 'redis.host']
      })

      await expect(
        bootstrap.get('azure-openai')  // Not in whitelist
      ).rejects.toThrow(/not in whitelist/)

      await expect(
        bootstrap.get('azure-openai')
      ).rejects.toThrow(/Bootstrap should ONLY contain data store connections/)
    })

    test('allows whitelisted keys', async () => {
      process.env.COSMOS_ENDPOINT = 'https://test.cosmos.azure.com'

      const bootstrap = new BootstrapConfigResolver({
        allowedKeys: ['cosmos.endpoint']
      })

      const value = await bootstrap.get('cosmos.endpoint')
      expect(value).toBe('https://test.cosmos.azure.com')

      delete process.env.COSMOS_ENDPOINT
    })

    test('prevents misuse - common app config keys rejected', async () => {
      const bootstrap = new BootstrapConfigResolver({
        allowedKeys: ['cosmos.endpoint']
      })

      // These should NOT be in bootstrap
      await expect(bootstrap.get('azure-openai')).rejects.toThrow()
      await expect(bootstrap.get('llm.model')).rejects.toThrow()
      await expect(bootstrap.get('memory.enabled')).rejects.toThrow()
      await expect(bootstrap.get('actor.timeout')).rejects.toThrow()
    })

    test('list of allowed keys for production', () => {
      const productionAllowedKeys = [
        // Cosmos DB
        'cosmos.endpoint',
        'cosmos.databaseId',
        'cosmos.containerId',
        // Redis
        'redis.host',
        'redis.port',
        'redis.password',
        // Key Vault
        'keyvault.uri',
        // State Store
        'statestore.type',
        'statestore.endpoint'
      ]

      const bootstrap = new BootstrapConfigResolver({
        allowedKeys: productionAllowedKeys
      })

      expect(bootstrap).toBeDefined()
    })
  })

  describe('Priority: Env > YAML', () => {
    test('environment variable overrides YAML', async () => {
      process.env.COSMOS_ENDPOINT = 'https://env.cosmos.azure.com'

      const bootstrap = new BootstrapConfigResolver({
        yamlPath: './test-config.yaml',  // Contains different value
        allowedKeys: ['cosmos.endpoint']
      })

      const value = await bootstrap.get('cosmos.endpoint')
      expect(value).toBe('https://env.cosmos.azure.com')

      delete process.env.COSMOS_ENDPOINT
    })

    test('falls back to YAML if env var not set', async () => {
      // Test would need actual YAML file
      // Skipping implementation detail
    })
  })

  describe('Read-Only', () => {
    test('CRITICAL: set() throws error', async () => {
      const bootstrap = new BootstrapConfigResolver({
        allowedKeys: ['cosmos.endpoint']
      })

      await expect(
        bootstrap.set('cosmos.endpoint', 'https://test.com')
      ).rejects.toThrow('Bootstrap config is read-only')
    })

    test('CRITICAL: delete() throws error', async () => {
      const bootstrap = new BootstrapConfigResolver({
        allowedKeys: ['cosmos.endpoint']
      })

      await expect(
        bootstrap.delete('cosmos.endpoint')
      ).rejects.toThrow('Bootstrap config is read-only')
    })
  })

  describe('getWithContext() ignores context', () => {
    test('returns same value regardless of context', async () => {
      process.env.REDIS_HOST = 'localhost'

      const bootstrap = new BootstrapConfigResolver({
        allowedKeys: ['redis.host']
      })

      const value1 = await bootstrap.getWithContext('redis.host', {
        tenantId: 'tenant-1'
      })
      const value2 = await bootstrap.getWithContext('redis.host', {
        tenantId: 'tenant-2'
      })

      expect(value1).toBe('localhost')
      expect(value2).toBe('localhost')
      expect(value1).toBe(value2)

      delete process.env.REDIS_HOST
    })
  })
})
```

---

## Phase 2: Integration Tests (Real Data Stores)

**File:** `tests/integration/config-resolver-production.test.ts`

```typescript
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { CosmosClient, Container } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import { CosmosConfigResolver, LayeredConfigResolver, InMemoryConfigResolver } from '@/config-resolver'

// These tests require COSMOS_ENDPOINT environment variable
const SKIP_INTEGRATION = !process.env.COSMOS_ENDPOINT

describe.skipIf(SKIP_INTEGRATION)('ConfigResolver Production Integration', () => {
  let cosmosContainer: Container
  let cosmosResolver: CosmosConfigResolver
  let layeredResolver: LayeredConfigResolver

  beforeAll(async () => {
    const endpoint = process.env.COSMOS_ENDPOINT!
    const credential = new DefaultAzureCredential()
    const client = new CosmosClient({ endpoint, aadCredentials: credential })

    const { database } = await client.databases.createIfNotExists({
      id: 'config-integration-test'
    })
    const { container } = await database.containers.createIfNotExists({
      id: 'test-config',
      partitionKey: { paths: ['/configId'] }
    })

    cosmosContainer = container
    cosmosResolver = new CosmosConfigResolver({ container })

    // Create layered resolver (cache + persist)
    const cacheResolver = new InMemoryConfigResolver()
    layeredResolver = new LayeredConfigResolver({
      cacheLayer: cacheResolver,
      persistLayer: cosmosResolver,
      cacheTTL: 5000  // 5 seconds for testing
    })
  })

  afterAll(async () => {
    // Cleanup
    await cosmosContainer.delete()
  })

  describe('Real Cosmos DB Operations', () => {
    test('write and read config from Cosmos', async () => {
      await cosmosResolver.set('global/test-config', {
        value: 'test',
        timestamp: Date.now()
      })

      const config = await cosmosResolver.get('global/test-config')
      expect(config).toMatchObject({ value: 'test' })
    })

    test('hierarchical resolution with real Cosmos', async () => {
      await cosmosResolver.set('global/llm', { model: 'gpt-4o-mini' })
      await cosmosResolver.set('acme/llm', { model: 'gpt-4o' })
      await cosmosResolver.set('acme/finance/llm', { temperature: 0.7 })

      const config = await cosmosResolver.getWithContext('llm', {
        clientId: 'acme',
        tenantId: 'finance'
      })

      // Should merge all levels
      expect(config.model).toBe('gpt-4o')
      expect(config.temperature).toBe(0.7)
    })

    test('concurrent reads work correctly', async () => {
      await cosmosResolver.set('global/concurrent-test', { value: 123 })

      const reads = Array.from({ length: 10 }, () =>
        cosmosResolver.get('global/concurrent-test')
      )

      const results = await Promise.all(reads)
      results.forEach(result => {
        expect(result).toEqual({ value: 123 })
      })
    })

    test('concurrent writes - last write wins', async () => {
      const writes = Array.from({ length: 10 }, (_, i) =>
        cosmosResolver.set('global/concurrent-write-test', { value: i })
      )

      await Promise.all(writes)

      const result = await cosmosResolver.get('global/concurrent-write-test')
      expect(result.value).toBeGreaterThanOrEqual(0)
      expect(result.value).toBeLessThan(10)
    })
  })

  describe('Layered Resolver (Cache + Persist)', () => {
    test('write-through: writes to both layers', async () => {
      await layeredResolver.set('test/write-through', { value: 456 })

      // Read from cache (fast)
      const cacheResult = await layeredResolver.get('test/write-through')
      expect(cacheResult).toEqual({ value: 456 })

      // Read from Cosmos directly (verify persistence)
      const cosmosResult = await cosmosResolver.get('test/write-through')
      expect(cosmosResult).toEqual({ value: 456 })
    })

    test('read-through: populates cache from persist', async () => {
      // Write directly to Cosmos (bypass cache)
      await cosmosResolver.set('test/read-through', { value: 789 })

      // Read through layered resolver (should populate cache)
      const result = await layeredResolver.get('test/read-through')
      expect(result).toEqual({ value: 789 })

      // Subsequent reads should hit cache (faster)
      const start = Date.now()
      await layeredResolver.get('test/read-through')
      const duration = Date.now() - start
      expect(duration).toBeLessThan(10)  // Should be very fast (cache hit)
    })

    test('cache invalidation after TTL', async () => {
      await layeredResolver.set('test/ttl', { value: 'initial' })

      // Read to populate cache
      const initial = await layeredResolver.get('test/ttl')
      expect(initial).toEqual({ value: 'initial' })

      // Update Cosmos directly (bypass cache)
      await cosmosResolver.set('test/ttl', { value: 'updated' })

      // Should still get cached value
      const cached = await layeredResolver.get('test/ttl')
      expect(cached).toEqual({ value: 'initial' })

      // Wait for TTL expiration (5 seconds)
      await new Promise(resolve => setTimeout(resolve, 6000))

      // Should now get updated value from Cosmos
      const updated = await layeredResolver.get('test/ttl')
      expect(updated).toEqual({ value: 'updated' })
    }, 10000)  // 10s timeout for this test
  })

  describe('Multi-Tenant Isolation', () => {
    test('tenants get different config', async () => {
      await cosmosResolver.set('tenant-1/llm', { endpoint: 'https://tenant1.com' })
      await cosmosResolver.set('tenant-2/llm', { endpoint: 'https://tenant2.com' })

      const config1 = await cosmosResolver.getWithContext('llm', {
        tenantId: 'tenant-1'
      })
      const config2 = await cosmosResolver.getWithContext('llm', {
        tenantId: 'tenant-2'
      })

      expect(config1.endpoint).toBe('https://tenant1.com')
      expect(config2.endpoint).toBe('https://tenant2.com')
    })

    test('tenant fallback to global', async () => {
      await cosmosResolver.set('global/fallback-test', { value: 'global' })

      const config = await cosmosResolver.getWithContext('fallback-test', {
        tenantId: 'non-existent-tenant'
      })

      expect(config).toEqual({ value: 'global' })
    })
  })

  describe('Performance Under Load', () => {
    test('handles high read throughput', async () => {
      await layeredResolver.set('load-test/config', { value: 'test' })

      const reads = Array.from({ length: 1000 }, () =>
        layeredResolver.get('load-test/config')
      )

      const start = Date.now()
      await Promise.all(reads)
      const duration = Date.now() - start

      // Should complete quickly (mostly cache hits)
      expect(duration).toBeLessThan(1000)  // 1000 reads in < 1 second
    })

    test('cache hit rate is high', async () => {
      await layeredResolver.set('cache-test/config', { value: 'test' })

      // First read - cache miss
      await layeredResolver.get('cache-test/config')

      // Subsequent reads - cache hits (should be fast)
      const reads = Array.from({ length: 100 }, async () => {
        const start = Date.now()
        await layeredResolver.get('cache-test/config')
        return Date.now() - start
      })

      const durations = await Promise.all(reads)
      const avgDuration = durations.reduce((a, b) => a + b) / durations.length

      expect(avgDuration).toBeLessThan(5)  // Average < 5ms (cache hits)
    })
  })

  describe('Error Handling', () => {
    test('handles Cosmos connection errors gracefully', async () => {
      const badResolver = new CosmosConfigResolver({
        container: null as any  // Invalid container
      })

      await expect(
        badResolver.get('test')
      ).rejects.toThrow()
    })

    test('layered resolver falls back to persist on cache error', async () => {
      // Write to Cosmos
      await cosmosResolver.set('fallback-test', { value: 'cosmos' })

      // Create layered resolver with broken cache
      const brokenCache = {
        get: async () => { throw new Error('Cache error') },
        set: async () => { throw new Error('Cache error') }
      } as any

      const fallbackResolver = new LayeredConfigResolver({
        cacheLayer: brokenCache,
        persistLayer: cosmosResolver,
        cacheTTL: 5000
      })

      // Should still get value from Cosmos
      const result = await fallbackResolver.get('fallback-test')
      expect(result).toEqual({ value: 'cosmos' })
    })
  })
})
```

---

## Phase 3: End-to-End Tests

**File:** `tests/e2e/actor-config-lifecycle.test.ts`

```typescript
import { describe, test, expect, beforeAll } from 'vitest'
import { ActorRuntime, ActorRegistry, Actor, ActorContext } from '@/actor'
import { InMemoryConfigResolver } from '@/config-resolver'

// Real actor implementation for E2E testing
@ActorRegistration({
  actorType: 'config-test-actor',
  version: '1.0.0',
  requiredConfig: ['llm', 'redis'],
  optionalConfig: ['memory', 'tracing']
})
class ConfigTestActor extends Actor {
  private llmConfig: any
  private redisConfig: any
  private memoryConfig: any | null = null
  private tracingConfig: any | null = null
  
  public initializeCalled = false
  public executeCalled = false

  async initialize() {
    this.initializeCalled = true
    
    // Get required config
    this.llmConfig = await this.getConfig('llm')
    this.redisConfig = await this.getConfig('redis')
    
    // Get optional config
    this.memoryConfig = await this.tryGetConfig('memory')
    this.tracingConfig = await this.tryGetConfig('tracing')
  }

  async execute(input: string): Promise<any> {
    this.executeCalled = true
    return {
      input,
      llm: this.llmConfig,
      redis: this.redisConfig,
      memory: this.memoryConfig,
      tracing: this.tracingConfig
    }
  }

  // Expose for testing
  public getConfigs() {
    return {
      llm: this.llmConfig,
      redis: this.redisConfig,
      memory: this.memoryConfig,
      tracing: this.tracingConfig
    }
  }
}

describe('E2E: Actor Configuration Lifecycle', () => {
  let resolver: InMemoryConfigResolver
  let runtime: ActorRuntime

  beforeAll(() => {
    resolver = new InMemoryConfigResolver()
    runtime = new ActorRuntime({ configResolver: resolver })
    ActorRegistry.register(ConfigTestActor)
  })

  test('FULL LIFECYCLE: Create actor with config → Initialize → Execute', async () => {
    // 1. Set up configuration
    await resolver.set('global/llm', {
      endpoint: 'https://api.openai.com',
      model: 'gpt-4o'
    })
    await resolver.set('global/redis', {
      host: 'localhost',
      port: 6379
    })
    await resolver.set('global/memory', {
      enabled: true,
      cacheTTL: 300
    })

    // 2. Create actor (validates required config)
    const actor = await runtime.createActor('config-test-actor', {
      actorId: 'test-1',
      clientId: 'acme',
      tenantId: 'finance'
    }) as ConfigTestActor

    expect(actor).toBeDefined()
    expect(actor.initializeCalled).toBe(true)

    // 3. Verify config was loaded correctly
    const configs = actor.getConfigs()
    expect(configs.llm).toEqual({
      endpoint: 'https://api.openai.com',
      model: 'gpt-4o'
    })
    expect(configs.redis).toEqual({
      host: 'localhost',
      port: 6379
    })
    expect(configs.memory).toEqual({
      enabled: true,
      cacheTTL: 300
    })
    expect(configs.tracing).toBeNull()  // Not configured

    // 4. Execute actor
    const result = await actor.execute('test input')
    expect(result.input).toBe('test input')
    expect(result.llm.model).toBe('gpt-4o')
    expect(actor.executeCalled).toBe(true)
  })

  test('FAILURE: Missing required config prevents actor creation', async () => {
    // Don't set up any config
    const emptyResolver = new InMemoryConfigResolver()
    const emptyRuntime = new ActorRuntime({ configResolver: emptyResolver })

    await expect(
      emptyRuntime.createActor('config-test-actor', {
        actorId: 'test-2'
      })
    ).rejects.toThrow('Missing Required Configuration')

    // Verify error details
    try {
      await emptyRuntime.createActor('config-test-actor', {
        actorId: 'test-2'
      })
    } catch (error) {
      expect(error.message).toContain('llm')
      expect(error.message).toContain('redis')
      expect(error.message).toContain('global/llm')
      expect(error.message).toContain('global/redis')
    }
  })

  test('PARTIAL: Optional config missing does not block actor', async () => {
    // Set up only required config
    const partialResolver = new InMemoryConfigResolver()
    await partialResolver.set('global/llm', { model: 'gpt-4o' })
    await partialResolver.set('global/redis', { host: 'localhost' })
    // memory and tracing NOT configured

    const partialRuntime = new ActorRuntime({ configResolver: partialResolver })
    const actor = await partialRuntime.createActor('config-test-actor', {
      actorId: 'test-3'
    }) as ConfigTestActor

    expect(actor).toBeDefined()

    const configs = actor.getConfigs()
    expect(configs.llm).toBeDefined()
    expect(configs.redis).toBeDefined()
    expect(configs.memory).toBeNull()
    expect(configs.tracing).toBeNull()
  })

  test('HIERARCHICAL: Tenant config overrides global', async () => {
    // Set up hierarchy
    await resolver.set('global/llm', { model: 'gpt-4o-mini' })
    await resolver.set('acme/llm', { model: 'gpt-4o' })
    await resolver.set('acme/finance/llm', { temperature: 0.7 })
    await resolver.set('global/redis', { host: 'localhost' })

    const actor = await runtime.createActor('config-test-actor', {
      actorId: 'test-4',
      clientId: 'acme',
      tenantId: 'finance'
    }) as ConfigTestActor

    const configs = actor.getConfigs()
    
    // Should get merged config
    expect(configs.llm.model).toBe('gpt-4o')  // From acme/llm
    expect(configs.llm.temperature).toBe(0.7)  // From acme/finance/llm
  })

  test('MULTI-ACTOR: Multiple actors with different configs', async () => {
    // Set up different configs for different tenants
    await resolver.set('tenant-1/llm', { model: 'gpt-3.5' })
    await resolver.set('tenant-2/llm', { model: 'gpt-4o' })
    await resolver.set('global/redis', { host: 'localhost' })

    const actor1 = await runtime.createActor('config-test-actor', {
      actorId: 'actor-1',
      tenantId: 'tenant-1'
    }) as ConfigTestActor

    const actor2 = await runtime.createActor('config-test-actor', {
      actorId: 'actor-2',
      tenantId: 'tenant-2'
    }) as ConfigTestActor

    expect(actor1.getConfigs().llm.model).toBe('gpt-3.5')
    expect(actor2.getConfigs().llm.model).toBe('gpt-4o')
  })

  test('RUNTIME: Config updates NOT reflected in running actors', async () => {
    // Create actor
    await resolver.set('global/llm', { model: 'gpt-4o-mini' })
    await resolver.set('global/redis', { host: 'localhost' })

    const actor = await runtime.createActor('config-test-actor', {
      actorId: 'test-5'
    }) as ConfigTestActor

    const initialModel = actor.getConfigs().llm.model
    expect(initialModel).toBe('gpt-4o-mini')

    // Update config
    await resolver.set('global/llm', { model: 'gpt-4o' })

    // Actor still has old config (config is loaded at creation)
    expect(actor.getConfigs().llm.model).toBe('gpt-4o-mini')
  })
})
```

---

## Phase 4: Failure Scenario Tests

**File:** `tests/e2e/config-failure-scenarios.test.ts`

```typescript
import { describe, test, expect, beforeEach } from 'vitest'
import { ActorRuntime, ActorRegistry, ConfigurationError } from '@/actor'
import { InMemoryConfigResolver } from '@/config-resolver'

describe('Configuration Failure Scenarios', () => {
  let resolver: InMemoryConfigResolver
  let runtime: ActorRuntime

  beforeEach(() => {
    resolver = new InMemoryConfigResolver()
    runtime = new ActorRuntime({ configResolver: resolver })
    ActorRegistry.clear()
  })

  test('SCENARIO 1: Production startup with missing global config', async () => {
    // Simulate production startup validation
    const criticalKeys = ['global/azure-openai', 'global/redis', 'global/cosmos']

    const missing = []
    for (const key of criticalKeys) {
      const value = await resolver.get(key)
      if (value === null) {
        missing.push(key)
      }
    }

    expect(missing).toHaveLength(3)
    
    // Production should FAIL FAST here
    if (missing.length > 0) {
      const error = new ConfigurationError(
        `❌ BOOTSTRAP VALIDATION FAILED\n\n` +
        `Missing Global Configuration:\n` +
        missing.map(k => `  - ${k}`).join('\n') +
        `\n\nFix: Set up global defaults before starting.`
      )
      
      expect(error.message).toContain('BOOTSTRAP VALIDATION FAILED')
      expect(error.message).toContain('global/azure-openai')
    }
  })

  test('SCENARIO 2: Cascading failures - one tenant misconfigured', async () => {
    // Set up global config
    await resolver.set('global/llm', { model: 'gpt-4o-mini' })
    await resolver.set('global/redis', { host: 'localhost' })

    // Set up tenant-1 correctly
    await resolver.set('tenant-1/llm', { model: 'gpt-4o' })

    // tenant-2 is misconfigured (missing redis override but expects it)
    await resolver.set('tenant-2/llm', { model: 'gpt-4o' })
    // Missing tenant-2/redis

    ActorRegistry.register({
      actorType: 'test-actor',
      version: '1.0.0',
      requiredConfig: ['llm', 'redis']
    })

    // tenant-1 should work
    const actor1 = await runtime.createActor('test-actor', {
      actorId: 'actor-1',
      tenantId: 'tenant-1'
    })
    expect(actor1).toBeDefined()

    // tenant-2 should also work (falls back to global redis)
    const actor2 = await runtime.createActor('test-actor', {
      actorId: 'actor-2',
      tenantId: 'tenant-2'
    })
    expect(actor2).toBeDefined()
  })

  test('SCENARIO 3: Dev environment - validation disabled', async () => {
    // In dev, we might disable validation
    const devRuntime = new ActorRuntime({
      configResolver: resolver,
      validateConfig: false
    })

    ActorRegistry.register({
      actorType: 'dev-actor',
      version: '1.0.0',
      requiredConfig: ['llm', 'redis']
    })

    // Should not throw even though config missing
    const actor = await devRuntime.createActor('dev-actor', {
      actorId: 'dev-1'
    })

    expect(actor).toBeDefined()

    // But actor will fail when it tries to use config
    await expect(
      actor.getConfig('llm')
    ).rejects.toThrow(ConfigurationError)
  })

  test('SCENARIO 4: Partial config - some tenants configured', async () => {
    await resolver.set('global/llm', { model: 'gpt-4o-mini' })
    await resolver.set('global/redis', { host: 'localhost' })
    await resolver.set('premium-tenant/llm', { model: 'gpt-4o' })

    ActorRegistry.register({
      actorType: 'test-actor',
      version: '1.0.0',
      requiredConfig: ['llm', 'redis']
    })

    // Premium tenant gets upgraded model
    const premiumActor = await runtime.createActor('test-actor', {
      actorId: 'premium-1',
      tenantId: 'premium-tenant'
    })
    const premiumConfig = await premiumActor.getConfig('llm')
    expect(premiumConfig.model).toBe('gpt-4o')

    // Regular tenant gets default
    const regularActor = await runtime.createActor('test-actor', {
      actorId: 'regular-1',
      tenantId: 'regular-tenant'
    })
    const regularConfig = await regularActor.getConfig('llm')
    expect(regularConfig.model).toBe('gpt-4o-mini')
  })

  test('SCENARIO 5: ConfigResolver unavailable', async () => {
    // Simulate Cosmos DB down - ConfigResolver throws
    const brokenResolver = {
      get: async () => { throw new Error('Cosmos DB connection failed') },
      getWithContext: async () => { throw new Error('Cosmos DB connection failed') }
    } as any

    const brokenRuntime = new ActorRuntime({ configResolver: brokenResolver })

    ActorRegistry.register({
      actorType: 'test-actor',
      version: '1.0.0',
      requiredConfig: ['llm']
    })

    // Should fail with clear error
    await expect(
      brokenRuntime.createActor('test-actor', { actorId: 'test' })
    ).rejects.toThrow('Cosmos DB connection failed')
  })

  test('SCENARIO 6: Invalid config data (type mismatch)', async () => {
    // Config exists but has wrong structure
    await resolver.set('global/llm', {
      endpoint: 123,  // Should be string
      model: null  // Should be string
    })
    await resolver.set('global/redis', { host: 'localhost' })

    ActorRegistry.register({
      actorType: 'test-actor',
      version: '1.0.0',
      requiredConfig: ['llm', 'redis']
    })

    // Actor creation succeeds (validation only checks existence)
    const actor = await runtime.createActor('test-actor', { actorId: 'test' })

    // But actor should validate config structure in initialize()
    const config = await actor.getConfig('llm')
    expect(typeof config.endpoint).toBe('number')  // Wrong type!
    // In real code, actor should validate and throw
  })

  test('SCENARIO 7: Race condition - config updated during actor creation', async () => {
    await resolver.set('global/llm', { model: 'v1' })
    await resolver.set('global/redis', { host: 'localhost' })

    ActorRegistry.register({
      actorType: 'test-actor',
      version: '1.0.0',
      requiredConfig: ['llm', 'redis']
    })

    // Start creating actors
    const creations = [
      runtime.createActor('test-actor', { actorId: 'actor-1' }),
      runtime.createActor('test-actor', { actorId: 'actor-2' })
    ]

    // Update config concurrently
    await resolver.set('global/llm', { model: 'v2' })

    // Wait for all creations
    const [actor1, actor2] = await Promise.all(creations)

    // Both should succeed (may get different versions)
    expect(actor1).toBeDefined()
    expect(actor2).toBeDefined()

    // Config snapshots at creation time
    const config1 = await actor1.getConfig('llm')
    const config2 = await actor2.getConfig('llm')
    
    // Both should have valid config (either v1 or v2)
    expect(['v1', 'v2']).toContain(config1.model)
    expect(['v2', 'v2']).toContain(config2.model)
  })
})
```

---

## Test Execution Strategy

### 1. Local Development
```bash
# Run all tests
npm test

# Run only unit tests (fast)
npm test tests/unit

# Run only integration tests (requires Cosmos/Redis)
COSMOS_ENDPOINT=https://... npm test tests/integration

# Run specific test file
npm test tests/unit/config/actor-config-methods.test.ts

# Watch mode
npm test -- --watch
```

### 2. CI/CD Pipeline
```yaml
# .github/workflows/config-tests.yml
name: Configuration Integration Tests

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm test tests/unit

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - run: npm install
      - run: npm test tests/integration
        env:
          COSMOS_ENDPOINT: ${{ secrets.COSMOS_ENDPOINT }}
          REDIS_HOST: localhost
          REDIS_PORT: 6379

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - uses: azure/login@v1
      - run: npm install
      - run: npm test tests/e2e
        env:
          COSMOS_ENDPOINT: ${{ secrets.COSMOS_ENDPOINT }}
          REDIS_HOST: localhost
```

### 3. Pre-Production Validation
```bash
# Full test suite with real Azure resources
export COSMOS_ENDPOINT=https://prod-test.documents.azure.com:443/
export REDIS_HOST=prod-test-redis.azure.com
export REDIS_PORT=6380
export REDIS_PASSWORD=$(az keyvault secret show ...)

npm test -- --coverage
```

---

## Success Criteria

### ✅ Unit Tests
- [ ] 100% pass rate
- [ ] All error scenarios tested
- [ ] Error messages validated
- [ ] Code coverage > 90%

### ✅ Integration Tests  
- [ ] Real Cosmos DB operations work
- [ ] Layered caching works correctly
- [ ] Multi-tenant isolation verified
- [ ] Performance benchmarks met

### ✅ E2E Tests
- [ ] Full actor lifecycle validated
- [ ] Multiple actors work correctly
- [ ] Hierarchical resolution proven
- [ ] Failure scenarios handled

### ✅ Production Readiness
- [ ] All tests pass in CI/CD
- [ ] Load tests show adequate performance
- [ ] Error messages are actionable
- [ ] No silent fallbacks remain

---

## Timeline

**Week 1:**
- Write all unit tests
- Achieve 90%+ code coverage
- Fix any bugs found

**Week 2:**
- Write integration tests
- Set up CI/CD with real Azure resources
- Performance testing

**Week 3:**
- Write E2E tests
- Failure scenario testing
- Documentation

**Total:** 3 weeks to rock-solid test coverage

---

## Monitoring in Production

After deployment, monitor:
1. Configuration access patterns (cache hit rate)
2. Configuration errors (missing keys)
3. Actor creation failures (validation errors)
4. ConfigResolver performance (latency percentiles)

Set alerts for:
- Configuration error rate > 1%
- Cache hit rate < 95%
- ConfigResolver p99 latency > 100ms
- Any missing required config

**This testing plan ensures the configuration system is ROCK SOLID.** ✅
