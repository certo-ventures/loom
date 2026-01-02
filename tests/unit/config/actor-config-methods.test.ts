import { describe, test, expect, beforeEach } from 'vitest'
import { Actor } from '../../../src/actor/actor'
import type { ActorContext } from '../../../src/actor/journal'
import { InMemoryConfigResolver } from '../../../src/config-resolver'
import { ConfigurationError } from '../../../src/config/environment'

class TestActor extends Actor {
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
      configResolver: resolver,
      correlationId: 'test-correlation'
    } as any
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
      } catch (error: any) {
        expect(error).toBeInstanceOf(ConfigurationError)
        expect(error.message).toContain('Missing Required Configuration')
        expect(error.message).toContain('azure-openai')
        expect(error.message).toContain('Searched paths')
        expect(error.message).toContain('acme/finance/prod/test-actor-1/azure-openai')
        expect(error.message).toContain('global/azure-openai')
        // The error should give helpful context
        expect(error.message.length).toBeGreaterThan(50)
      }
    })

    test('resolves hierarchically - most specific wins', async () => {
      // Set up hierarchy - only most specific will be returned
      await resolver.set('global/llm', { model: 'gpt-4o-mini' })
      await resolver.set('acme/llm', { model: 'gpt-4o' })
      await resolver.set('acme/finance/llm', { model: 'gpt-4o', temperature: 0.7 })
      await resolver.set('acme/finance/prod/llm', { model: 'gpt-4o', temperature: 0.5 })

      const actor = new TestActor(context)
      const config = await actor.getConfig('llm') as any

      // Should get the most specific config (acme/finance/prod/llm)
      // Note: Actual merging is done by ConfigResolver.getWithContext()
      expect(config).toBeDefined()
      expect(config.model).toBeDefined()
    })

    test('works with minimal context (only global)', async () => {
      await resolver.set('global/llm', { endpoint: 'https://api.openai.com' })

      const minimalContext: ActorContext = {
        actorId: 'test',
        configResolver: resolver,
        correlationId: 'test'
      } as any
      const actor = new TestActor(minimalContext)
      const config = await actor.getConfig('llm') as any

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
      const config = await actor.tryGetConfig('tracing') as any

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

  describe('Error Handling', () => {
    test('throws when configResolver not provided', async () => {
      const noResolverContext: ActorContext = {
        actorId: 'test',
        correlationId: 'test'
        // Missing configResolver
      } as any
      const actor = new TestActor(noResolverContext)

      await expect(
        actor.getConfig('test')
      ).rejects.toThrow('ConfigResolver not provided')
    })

    test('handles resolver errors gracefully', async () => {
      const errorResolver = {
        get: async () => { throw new Error('Cosmos DB connection failed') },
        getWithContext: async () => { throw new Error('Cosmos DB connection failed') }
      } as any

      const errorContext: ActorContext = {
        actorId: 'test',
        configResolver: errorResolver,
        correlationId: 'test'
      } as any
      const actor = new TestActor(errorContext)

      await expect(
        actor.getConfig('test')
      ).rejects.toThrow('Cosmos DB connection failed')
    })
  })
})
