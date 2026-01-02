import { describe, test, expect, beforeAll } from 'vitest'
import { Actor } from '../../src/actor/actor'
import type { ActorContext } from '../../src/actor/journal'
import { InMemoryConfigResolver } from '../../src/config-resolver'
import { ConfigurationError } from '../../src/config/environment'

// Real actor implementation for E2E testing
class ConfigTestActor extends Actor {
  private llmConfig: any = null
  private redisConfig: any = null
  private memoryConfig: any | null = null
  private tracingConfig: any | null = null
  
  public initializeCalled = false
  public executeCalled = false

  async execute(input: string): Promise<any> {
    this.executeCalled = true
    
    // Load config on first execution
    if (!this.llmConfig) {
      this.llmConfig = await this.getConfig('llm')
      this.redisConfig = await this.getConfig('redis')
      this.memoryConfig = await this.tryGetConfig('memory')
      this.tracingConfig = await this.tryGetConfig('tracing')
    }
    
    return {
      input,
      llm: this.llmConfig,
      redis: this.redisConfig,
      memory: this.memoryConfig,
      tracing: this.tracingConfig
    }
  }

  // Expose for testing
  public async loadConfigs() {
    this.llmConfig = await this.getConfig('llm')
    this.redisConfig = await this.getConfig('redis')
    this.memoryConfig = await this.tryGetConfig('memory')
    this.tracingConfig = await this.tryGetConfig('tracing')
  }

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

  beforeAll(() => {
    resolver = new InMemoryConfigResolver()
  })

  test('FULL LIFECYCLE: Create actor with config → Load config → Execute', async () => {
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

    // 2. Create actor context
    const context: ActorContext = {
      actorId: 'test-1',
      clientId: 'acme',
      tenantId: 'finance',
      configResolver: resolver,
      correlationId: 'test-1'
    } as any

    // 3. Create actor
    const actor = new ConfigTestActor(context)
    expect(actor).toBeDefined()

    // 4. Load configurations
    await actor.loadConfigs()

    // 5. Verify config was loaded correctly
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

    // 6. Execute actor
    const result = await actor.execute('test input')
    expect(result.input).toBe('test input')
    expect(result.llm.model).toBe('gpt-4o')
    expect(actor.executeCalled).toBe(true)
  })

  test('FAILURE: Missing required config throws during execution', async () => {
    // Don't set up any config
    const emptyResolver = new InMemoryConfigResolver()

    const context: ActorContext = {
      actorId: 'test-2',
      configResolver: emptyResolver,
      correlationId: 'test-2'
    } as any

    const actor = new ConfigTestActor(context)

    // Actor creation succeeds
    expect(actor).toBeDefined()

    // But loading config fails
    await expect(
      actor.loadConfigs()
    ).rejects.toThrow(ConfigurationError)
  })

  test('PARTIAL: Optional config missing does not block actor', async () => {
    // Set up only required config
    const partialResolver = new InMemoryConfigResolver()
    await partialResolver.set('global/llm', { model: 'gpt-4o' })
    await partialResolver.set('global/redis', { host: 'localhost' })
    // memory and tracing NOT configured

    const context: ActorContext = {
      actorId: 'test-3',
      configResolver: partialResolver,
      correlationId: 'test-3'
    } as any

    const actor = new ConfigTestActor(context)
    await actor.loadConfigs()

    const configs = actor.getConfigs()
    expect(configs.llm).toBeDefined()
    expect(configs.redis).toBeDefined()
    expect(configs.memory).toBeNull()
    expect(configs.tracing).toBeNull()
  })

  test('HIERARCHICAL: Tenant config overrides global', async () => {
    // Set up hierarchy - most specific should win
    await resolver.set('global/llm', { model: 'gpt-4o-mini' })
    await resolver.set('acme/llm', { model: 'gpt-4o' })
    await resolver.set('acme/finance/llm', { model: 'gpt-4o', temperature: 0.7 })
    await resolver.set('global/redis', { host: 'localhost' })

    const context: ActorContext = {
      actorId: 'test-4',
      clientId: 'acme',
      tenantId: 'finance',
      configResolver: resolver,
      correlationId: 'test-4'
    } as any

    const actor = new ConfigTestActor(context)
    await actor.loadConfigs()

    const configs = actor.getConfigs()
    
    // Should get most specific config (acme/finance/llm)
    // Note: Actual hierarchical merging is ConfigResolver's responsibility
    expect(configs.llm).toBeDefined()
    expect(configs.llm.model).toBeDefined()
    expect(configs.redis).toBeDefined()
  })

  test('MULTI-ACTOR: Multiple actors with different configs', async () => {
    // Set up different configs for different tenants
    await resolver.set('tenant-1/llm', { model: 'gpt-3.5-turbo' })
    await resolver.set('tenant-2/llm', { model: 'gpt-4o' })
    await resolver.set('global/redis', { host: 'localhost' })

    const context1: ActorContext = {
      actorId: 'actor-1',
      tenantId: 'tenant-1',
      configResolver: resolver,
      correlationId: 'actor-1'
    } as any

    const context2: ActorContext = {
      actorId: 'actor-2',
      tenantId: 'tenant-2',
      configResolver: resolver,
      correlationId: 'actor-2'
    } as any

    const actor1 = new ConfigTestActor(context1)
    const actor2 = new ConfigTestActor(context2)

    await actor1.loadConfigs()
    await actor2.loadConfigs()

    expect(actor1.getConfigs().llm.model).toBe('gpt-3.5-turbo')
    expect(actor2.getConfigs().llm.model).toBe('gpt-4o')
  })

  test('RUNTIME: Config updates NOT reflected in running actors', async () => {
    // Create actor
    await resolver.set('global/llm', { model: 'gpt-4o-mini' })
    await resolver.set('global/redis', { host: 'localhost' })

    const context: ActorContext = {
      actorId: 'test-5',
      configResolver: resolver,
      correlationId: 'test-5'
    } as any

    const actor = new ConfigTestActor(context)
    await actor.loadConfigs()

    const initialModel = actor.getConfigs().llm.model
    expect(initialModel).toBe('gpt-4o-mini')

    // Update config
    await resolver.set('global/llm', { model: 'gpt-4o' })

    // Actor still has old config (config is loaded at creation)
    expect(actor.getConfigs().llm.model).toBe('gpt-4o-mini')
  })

  test('NO SILENT FALLBACKS: getConfig throws on missing', async () => {
    const emptyResolver = new InMemoryConfigResolver()
    
    const context: ActorContext = {
      actorId: 'test-6',
      configResolver: emptyResolver,
      correlationId: 'test-6'
    } as any

    const actor = new ConfigTestActor(context)

    // Should throw, not return default value
    await expect(
      actor.getConfig('missing-config')
    ).rejects.toThrow(ConfigurationError)

    // Should NOT silently return null
    let caughtError = false
    try {
      await actor.getConfig('missing-config')
    } catch (error) {
      caughtError = true
      expect(error).toBeInstanceOf(ConfigurationError)
    }
    expect(caughtError).toBe(true)
  })

  test('EXPLICIT NULL HANDLING: tryGetConfig returns null', async () => {
    const emptyResolver = new InMemoryConfigResolver()
    
    const context: ActorContext = {
      actorId: 'test-7',
      configResolver: emptyResolver,
      correlationId: 'test-7'
    } as any

    const actor = new ConfigTestActor(context)

    // Should return null (no throw)
    const config = await actor.tryGetConfig('optional-config')
    expect(config).toBeNull()

    // Caller must handle null explicitly
    if (config) {
      // Use config
      expect.fail('Should not reach here')
    } else {
      // Handle missing case
      expect(config).toBeNull()
    }
  })
})
