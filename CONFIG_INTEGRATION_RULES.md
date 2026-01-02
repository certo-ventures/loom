# Configuration Integration Rules

**Status:** CRITICAL PRODUCTION REQUIREMENTS  
**Date:** January 1, 2026

---

## ⚠️ CRITICAL RULE: NO SILENT FALLBACKS OR DEFAULTS

**This is non-negotiable for production systems.**

###❌ FORBIDDEN PATTERNS

```typescript
// ❌ DEADLY - Silent fallback hides missing config
const endpoint = config?.endpoint ?? 'http://localhost:8000'
const model = config?.model || 'gpt-4o-mini'
const config = await this.getConfigWithDefault('azure-openai', { /* default */ })

// ❌ DEADLY - Catching and hiding errors
try {
  const config = await this.getConfig('azure-openai')
  this.llm = createLLM(config)
} catch {
  this.llm = null  // Silent failure!
}

// ❌ DEADLY - Optional when it's actually required
@ActorRegistration({
  optionalConfig: ['azure-openai']  // Wrong - actor won't work without this!
})
```

### ✅ CORRECT PATTERNS

```typescript
// ✅ Fail fast - throws clear error if missing
const config = await this.getConfig<LLMConfig>('azure-openai')
this.llm = createLLM(config)

// ✅ Explicitly handle optional config
const memoryConfig = await this.tryGetConfig<MemoryConfig>('memory-service')
if (memoryConfig) {
  this.memory = createMemoryAdapter(memoryConfig)
  this.logger.info('Memory enabled')
} else {
  this.logger.info('Memory NOT configured - running without it')
}

// ✅ Clear declaration of requirements
@ActorRegistration({
  requiredConfig: ['azure-openai', 'redis'],  // Must exist
  optionalConfig: ['memory-service']  // Truly optional
})
```

---

## Configuration API

### Actor Base Class Methods

**`getConfig<T>(key: string): Promise<T>`**
- **Purpose:** Get REQUIRED configuration
- **Behavior:** THROWS ConfigurationError if config not found
- **Use for:** Config that actor absolutely needs to function
- **Never returns:** null

**`tryGetConfig<T>(key: string): Promise<T | null>`**
- **Purpose:** Get OPTIONAL configuration
- **Behavior:** Returns null if not found (no error)
- **Use for:** Features actor can work without
- **Caller MUST:** Explicitly handle null case

**❌ REMOVED: `getConfigWithDefault()`**
- **Why:** Silent fallbacks mask configuration errors
- **Use instead:** Explicit checks in code if you need defaults

### Actor Metadata

```typescript
export interface ActorMetadata {
  actorType: string
  version: string
  
  /**
   * REQUIRED configuration keys.
   * Runtime validates BEFORE actor creation.
   * Actor will NOT be created if any missing.
   */
  requiredConfig: string[]  // NOT optional - must be array (can be empty)
  
  /**
   * OPTIONAL configuration keys.
   * Features actor supports but can work without.
   */
  optionalConfig?: string[]
}
```

---

## Philosophy

**Fail Fast > Silent Failure**
- Better to crash on startup than run with wrong config
- Better to show clear error than hide problem  
- Better to require explicit handling than assume defaults

**Why No Silent Fallbacks?**

1. **Production Debugging Nightmare**
   - Silent fallback uses localhost in production
   - No logs, no errors, just broken functionality
   - Hours wasted finding why prod uses wrong endpoint

2. **Configuration Drift**
   - "It works on my machine" because of different fallbacks
   - Prod/dev parity broken
   - No way to know actual vs intended config

3. **Security Risks**
   - Wrong endpoints expose data
   - Wrong credentials cause breaches
   - No audit trail of what config was used

4. **Cascading Failures**
   - One missing config causes actor to start
   - Actor makes wrong calls
   - Entire system in undefined state

**The Fix: Fail Fast**
- Missing config? Stop startup immediately
- Show clear error with searched paths
- Force explicit configuration
- No surprises in production

---

## Examples

### Example 1: AI Assistant Actor (Correct)

```typescript
@ActorRegistration({
  actorType: 'ai-assistant',
  version: '1.0.0',
  requiredConfig: ['azure-openai', 'redis'],
  optionalConfig: ['memory-service', 'tracing']
})
class AIAssistantActor extends Actor {
  private llm!: LLMProvider    // Required
  private redis!: RedisClient  // Required
  private memory?: MemoryAdapter  // Optional
  private tracing?: TraceStore    // Optional
  
  async initialize() {
    // REQUIRED - getConfig() throws if missing
    const llmConfig = await this.getConfig<LLMConfig>('azure-openai')
    this.llm = createLLMProvider(llmConfig)
    
    const redisConfig = await this.getConfig<RedisConfig>('redis')
    this.redis = createRedisClient(redisConfig)
    
    // OPTIONAL - tryGetConfig() returns null if missing
    const memoryConfig = await this.tryGetConfig<MemoryConfig>('memory-service')
    if (memoryConfig) {
      this.memory = createMemoryAdapter(memoryConfig)
      this.logger.info('Memory service enabled')
    } else {
      this.logger.info('Running without memory service')
    }
    
    const traceConfig = await this.tryGetConfig<TraceConfig>('tracing')
    if (traceConfig) {
      this.tracing = createTraceStore(traceConfig)
    }
  }
  
  async execute(input: string): Promise<string> {
    // Required config - safe to use directly
    const response = await this.llm.complete(input)
    await this.redis.set(`response:${this.actorId}`, response)
    
    // Optional config - check before using
    if (this.memory) {
      await this.memory.store(input, response)
    }
    
    if (this.tracing) {
      await this.tracing.record({ input, response })
    }
    
    return response
  }
}
```

### Example 2: What Happens When Config Missing

**Scenario: Required config missing**

```typescript
// Runtime attempts to create actor
const runtime = new ActorRuntime({ configResolver })

await runtime.createActor('ai-assistant', {
  actorId: 'test-1',
  tenantId: 'acme'
})

// Runtime validates BEFORE creating actor
// ❌ THROWS ConfigurationError:
//
// ❌ CONFIGURATION ERROR: Cannot create actor 'ai-assistant'
//
// Context:
//   Client: none
//   Tenant: acme
//   Environment: production
//   Actor ID: test-1
//
// Missing Required Configuration:
//   - azure-openai
//     Searched paths:
//       • acme/production/test-1/azure-openai
//       • acme/production/azure-openai
//       • acme/azure-openai
//       • global/azure-openai
//
// Fix:
//   1. Set required configuration in ConfigResolver
//   2. Ensure at least global defaults exist
//   3. If config is optional, remove from requiredConfig array
//
// Example:
//   await configResolver.set('global/azure-openai', { 
//     endpoint: '...',
//     deployment: 'gpt-4o'
//   })
```

**Result:** Actor is NOT created. Error is clear. Developer knows exactly what to fix.

---

## Migration Guide

### From DynamicConfigService

```typescript
// ❌ OLD - Hidden failures
const configService = new DynamicConfigService({ cosmos })
const config = await configService.getConfig(tenantId, actorType)
const endpoint = config?.llm?.endpoint || 'http://localhost:8000'  // Silent fallback!

// ✅ NEW - Explicit and safe
const resolver = new CosmosConfigResolver({ container })
const llmConfig = await resolver.getWithContext('azure-openai', { tenantId })
if (!llmConfig) {
  throw new Error('azure-openai config required but not found')
}
const endpoint = llmConfig.endpoint  // Safe - validated
```

### From Manual Config Loading

```typescript
// ❌ OLD - Each actor loads config manually
class MyActor extends Actor {
  async execute(input) {
    const config = loadEnvConfig()  // Ad-hoc
    const endpoint = config.AZURE_OPENAI_ENDPOINT || 'localhost'  // Silent fallback!
    // ...
  }
}

// ✅ NEW - Runtime provides config automatically
@ActorRegistration({
  requiredConfig: ['azure-openai']
})
class MyActor extends Actor {
  async initialize() {
    const config = await this.getConfig<LLMConfig>('azure-openai')  // Validated
    this.llm = createLLM(config)
  }
  
  async execute(input) {
    return this.llm.complete(input)  // Safe - llm guaranteed to exist
  }
}
```

---

## Testing Requirements

### Unit Tests Must Verify

1. **Required config throws when missing**
```typescript
test('getConfig throws if config missing', async () => {
  const actor = new TestActor(context)
  
  await expect(
    actor.getConfig('missing-key')
  ).rejects.toThrow(ConfigurationError)
  
  await expect(
    actor.getConfig('missing-key')
  ).rejects.toThrow(/Searched paths/)
})
```

2. **Optional config returns null**
```typescript
test('tryGetConfig returns null for missing optional config', async () => {
  const actor = new TestActor(context)
  
  const config = await actor.tryGetConfig('optional-key')
  expect(config).toBeNull()
})
```

3. **Runtime validates before actor creation**
```typescript
test('runtime validates required config before creating actor', async () => {
  ActorRegistry.register({
    actorType: 'test-actor',
    requiredConfig: ['azure-openai']
  })
  
  const runtime = new ActorRuntime({ configResolver })
  
  await expect(
    runtime.createActor('test-actor', { actorId: 'test' })
  ).rejects.toThrow('Missing Required Configuration')
})
```

---

## Checklist: Configuration Integration

### Phase 1: Core Integration ✅
- [ ] Remove `getConfigWithDefault()` from Actor class
- [ ] `getConfig()` throws ConfigurationError if missing (no null returns)
- [ ] Add `tryGetConfig()` for truly optional config (returns null)
- [ ] ActorMetadata.requiredConfig is required field (array, can be empty)
- [ ] Runtime validates requiredConfig BEFORE actor creation
- [ ] ConfigurationError shows all searched paths

### Phase 2: No Silent Fallbacks ✅
- [ ] No `??` operators with default values on config
- [ ] No `||` operators with default values on config
- [ ] No try/catch hiding config errors
- [ ] All config access uses `getConfig()` or `tryGetConfig()`
- [ ] Optional config explicitly checked before use

### Phase 3: Clear Errors ✅
- [ ] ConfigurationError shows context (tenant, environment, actor)
- [ ] ConfigurationError shows all searched paths
- [ ] ConfigurationError shows fix instructions
- [ ] ConfigurationError includes example code

### Phase 4: Testing ✅
- [ ] Test getConfig() throws on missing required config
- [ ] Test tryGetConfig() returns null on missing optional config
- [ ] Test runtime validation prevents actor creation
- [ ] Test error messages include searched paths
- [ ] Test no silent fallbacks in codebase

---

## Summary

**NO SILENT FALLBACKS OR DEFAULTS - EVER**

This is the #1 rule for production-ready configuration.

If config is required → Use `getConfig()` → Throws if missing → Good!  
If config is optional → Use `tryGetConfig()` → Returns null → Explicitly handle!  
If config is wrong → Fail fast → Show clear error → Force fix!

**Fail Fast > Silent Failure**  
**Clear Error > Hidden Problem**  
**Explicit Handling > Assumed Defaults**

This plan is **ROCK SOLID** and **PRODUCTION READY**. ✅
