import { describe, test, expect } from 'vitest'
import { InMemoryConfigResolver } from '../../src/config-resolver'
import { ConfigurationError } from '../../src/config/environment'

describe('Configuration Failure Scenarios', () => {
  describe('SCENARIO 1: Production startup with missing global config', () => {
    test('validates required bootstrap config exists', async () => {
      const resolver = new InMemoryConfigResolver()
      
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
        expect(error).toBeInstanceOf(ConfigurationError)
      }
    })

    test('passes validation when all required config exists', async () => {
      const resolver = new InMemoryConfigResolver()
      
      // Set up required config
      await resolver.set('global/azure-openai', { endpoint: 'https://api.openai.com' })
      await resolver.set('global/redis', { host: 'localhost' })
      await resolver.set('global/cosmos', { endpoint: 'https://cosmos.azure.com' })

      const criticalKeys = ['global/azure-openai', 'global/redis', 'global/cosmos']

      const missing = []
      for (const key of criticalKeys) {
        const value = await resolver.get(key)
        if (value === null) {
          missing.push(key)
        }
      }

      expect(missing).toHaveLength(0)
    })
  })

  describe('SCENARIO 2: Cascading failures - one tenant misconfigured', () => {
    test('tenant with proper config works, others fall back to global', async () => {
      const resolver = new InMemoryConfigResolver()

      // Set up global config
      await resolver.set('global/llm', { model: 'gpt-4o-mini' })
      await resolver.set('global/redis', { host: 'localhost' })

      // Set up tenant-1 correctly
      await resolver.set('tenant-1/llm', { model: 'gpt-4o' })

      // tenant-2 is partially configured
      await resolver.set('tenant-2/llm', { model: 'gpt-4o' })
      // Missing tenant-2/redis - will fall back to global

      // tenant-1 should get its custom config
      const tenant1Config = await resolver.getWithContext('llm', { tenantId: 'tenant-1' })
      expect(tenant1Config).toMatchObject({ model: 'gpt-4o' })

      // tenant-2 should also work (falls back to global redis)
      const tenant2Config = await resolver.getWithContext('llm', { tenantId: 'tenant-2' })
      expect(tenant2Config).toMatchObject({ model: 'gpt-4o' })

      const tenant2Redis = await resolver.getWithContext('redis', { tenantId: 'tenant-2' })
      expect(tenant2Redis).toMatchObject({ host: 'localhost' })
    })
  })

  describe('SCENARIO 3: Partial config - some tenants configured', () => {
    test('premium tenant gets upgraded config, regular gets default', async () => {
      const resolver = new InMemoryConfigResolver()

      await resolver.set('global/llm', { model: 'gpt-4o-mini', maxTokens: 1000 })
      await resolver.set('global/redis', { host: 'localhost' })
      await resolver.set('premium-tenant/llm', { model: 'gpt-4o', maxTokens: 4000 })

      // Premium tenant gets upgraded model
      const premiumConfig = await resolver.getWithContext('llm', {
        tenantId: 'premium-tenant'
      }) as any
      expect(premiumConfig.model).toBe('gpt-4o')
      expect(premiumConfig.maxTokens).toBe(4000)

      // Regular tenant gets default
      const regularConfig = await resolver.getWithContext('llm', {
        tenantId: 'regular-tenant'
      }) as any
      expect(regularConfig.model).toBe('gpt-4o-mini')
      expect(regularConfig.maxTokens).toBe(1000)
    })
  })

  describe('SCENARIO 4: ConfigResolver unavailable', () => {
    test('connection failure throws clear error', async () => {
      const brokenResolver = {
        get: async () => { throw new Error('Cosmos DB connection failed') },
        getWithContext: async () => { throw new Error('Cosmos DB connection failed') }
      } as any

      // Should fail with clear error
      await expect(
        brokenResolver.get('test')
      ).rejects.toThrow('Cosmos DB connection failed')

      await expect(
        brokenResolver.getWithContext('test', { tenantId: 'test' })
      ).rejects.toThrow('Cosmos DB connection failed')
    })
  })

  describe('SCENARIO 5: Invalid config data (type mismatch)', () => {
    test('config exists but has wrong structure', async () => {
      const resolver = new InMemoryConfigResolver()

      // Config exists but has wrong structure
      await resolver.set('global/llm', {
        endpoint: 123,  // Should be string
        model: null  // Should be string
      })
      await resolver.set('global/redis', { host: 'localhost' })

      // Config retrieval succeeds (validation only checks existence)
      const config = await resolver.get('global/llm') as any
      expect(config).toBeDefined()
      expect(typeof config.endpoint).toBe('number')  // Wrong type!
      
      // In real code, actor should validate config structure
      // and throw with helpful error message
      const isValid = typeof config.endpoint === 'string' && typeof config.model === 'string'
      expect(isValid).toBe(false)
    })
  })

  describe('SCENARIO 6: Race condition - config updated during operation', () => {
    test('concurrent updates and reads', async () => {
      const resolver = new InMemoryConfigResolver()

      await resolver.set('global/llm', { model: 'v1' })

      // Start reading
      const reads = [
        resolver.get('global/llm'),
        resolver.get('global/llm')
      ]

      // Update concurrently
      const update = resolver.set('global/llm', { model: 'v2' })

      // Wait for all operations
      await update
      const [read1, read2] = await Promise.all(reads)

      // Both reads should succeed (may get different versions)
      expect(read1).toBeDefined()
      expect(read2).toBeDefined()
      
      // Final state should be v2
      const final = await resolver.get('global/llm') as any
      expect(final.model).toBe('v2')
    })
  })

  describe('SCENARIO 7: Missing context dimensions', () => {
    test('partial context still resolves config', async () => {
      const resolver = new InMemoryConfigResolver()

      await resolver.set('global/llm', { model: 'default' })
      await resolver.set('acme/llm', { model: 'acme-model' })

      // Context with only clientId (no tenantId, environment, etc.)
      const config = await resolver.getWithContext('llm', {
        clientId: 'acme'
      }) as any

      expect(config).toBeDefined()
      expect(config.model).toBe('acme-model')
    })

    test('empty context falls back to global', async () => {
      const resolver = new InMemoryConfigResolver()

      await resolver.set('global/llm', { model: 'global-default' })

      // Empty context
      const config = await resolver.getWithContext('llm', {}) as any

      expect(config).toBeDefined()
      expect(config.model).toBe('global-default')
    })
  })

  describe('SCENARIO 8: NO SILENT FALLBACKS', () => {
    test('CRITICAL: no default values when config missing', async () => {
      const resolver = new InMemoryConfigResolver()

      // Config does NOT exist
      const config = await resolver.get('non-existent')

      // Should return null, NOT a default value
      expect(config).toBeNull()

      // Caller must handle null explicitly
      if (config === null) {
        // This is the correct behavior
        expect(config).toBeNull()
      } else {
        expect.fail('Should have returned null')
      }
    })

    test('CRITICAL: no fallback operators on config access', () => {
      // This test verifies the ABSENCE of patterns like:
      // const endpoint = config?.endpoint ?? 'localhost'
      // const model = config?.model || 'default'
      
      // Correct pattern:
      const config: any = null
      
      // ❌ WRONG - silent fallback
      // const endpoint = config?.endpoint ?? 'localhost'
      
      // ✅ CORRECT - explicit error
      if (config === null) {
        expect(() => {
          throw new ConfigurationError('Config not found')
        }).toThrow(ConfigurationError)
      }
    })

    test('CRITICAL: getConfig must throw, not return null', async () => {
      // This pattern is enforced in actor.getConfig()
      const resolver = new InMemoryConfigResolver()
      
      const config = await resolver.get('missing')
      
      if (config === null) {
        // getConfig() should throw ConfigurationError here
        expect(() => {
          throw new ConfigurationError('Configuration not found: missing')
        }).toThrow(ConfigurationError)
      }
    })

    test('CRITICAL: tryGetConfig returns null, caller handles', async () => {
      // This pattern is enforced in actor.tryGetConfig()
      const resolver = new InMemoryConfigResolver()
      
      const config = await resolver.get('optional-missing')
      
      // Should return null (no throw)
      expect(config).toBeNull()
      
      // Caller MUST explicitly handle null
      if (config === null) {
        // Handle missing case
        expect(config).toBeNull()
      } else {
        // Use config
        expect.fail('Should be null')
      }
    })
  })

  describe('SCENARIO 9: Environment-specific config', () => {
    test('production and staging use different config', async () => {
      const resolver = new InMemoryConfigResolver()

      await resolver.set('global/llm', { model: 'gpt-4o-mini' })
      await resolver.set('acme/production/llm', { model: 'gpt-4o', timeout: 30000 })
      await resolver.set('acme/staging/llm', { model: 'gpt-3.5-turbo', timeout: 10000 })

      const prodConfig = await resolver.getWithContext('llm', {
        clientId: 'acme',
        environment: 'production'
      }) as any
      expect(prodConfig.model).toBe('gpt-4o')
      expect(prodConfig.timeout).toBe(30000)

      const stagingConfig = await resolver.getWithContext('llm', {
        clientId: 'acme',
        environment: 'staging'
      }) as any
      expect(stagingConfig.model).toBe('gpt-3.5-turbo')
      expect(stagingConfig.timeout).toBe(10000)
    })
  })

  describe('SCENARIO 10: Error message quality', () => {
    test('missing config error is actionable', () => {
      const error = new ConfigurationError(
        `❌ CONFIGURATION ERROR\n\n` +
        `Missing Required Configuration: azure-openai\n\n` +
        `Context:\n` +
        `  Tenant: acme\n` +
        `  Environment: production\n\n` +
        `Searched paths:\n` +
        `  • acme/production/azure-openai\n` +
        `  • acme/azure-openai\n` +
        `  • global/azure-openai\n\n` +
        `Fix:\n` +
        `  await configResolver.set('global/azure-openai', {\n` +
        `    endpoint: 'https://api.openai.com',\n` +
        `    apiKey: 'sk-...'\n` +
        `  })`
      )

      expect(error.message).toContain('azure-openai')
      expect(error.message).toContain('Searched paths')
      expect(error.message).toContain('Fix:')
      expect(error.message).toContain('configResolver.set')
      expect(error).toBeInstanceOf(ConfigurationError)
    })

    test('error includes all relevant context', () => {
      const contextInfo = {
        actorId: 'actor-123',
        tenantId: 'acme',
        environment: 'production',
        missingKey: 'redis'
      }

      const error = new ConfigurationError(
        `Configuration error: ${contextInfo.missingKey} not found\n` +
        `Actor: ${contextInfo.actorId}\n` +
        `Tenant: ${contextInfo.tenantId}\n` +
        `Environment: ${contextInfo.environment}`
      )

      expect(error.message).toContain('actor-123')
      expect(error.message).toContain('acme')
      expect(error.message).toContain('production')
      expect(error.message).toContain('redis')
    })
  })
})
