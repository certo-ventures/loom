# Configuration System - Comprehensive Review

**Date:** January 1, 2026  
**Status:** ⚠️ INTEGRATION GAPS IDENTIFIED - Configuration Infrastructure Exists But Not Used

## Executive Summary

The Loom library has **TWO COMPLETE, PRODUCTION-READY configuration systems** that are NOT integrated with the actor runtime:

1. **ConfigResolver System** (`src/config-resolver/`) - ✅ **COMPLETE**
   - Generic, hierarchical, context-aware configuration
   - Storage abstraction with pluggable backends (InMemory, Cosmos, Redis via StateStore)
   - Layered resolver with cache + persist
   - Admin API for import/export/validation
   - **Status: Production-ready but NOT used by actors**

2. **DynamicConfigService** (`src/config/dynamic-config.ts`) - ✅ **FUNCTIONAL**
   - Tenant/actor-specific configs with priority merging
   - Cosmos DB backed with 5-minute caching
   - **Status: Works but redundant with ConfigResolver**

3. **YAML Static Config** (`src/config/loader.ts`) - ⚠️ **LIMITED**
   - Infrastructure config (Redis, adapters)
   - Single-tenant only
   - **Status: Should be integrated as one ConfigResolver layer**

**The Problem:** Actor runtime doesn't use any of these systems automatically. Developers must manually wire everything.

---

## 🔴 Critical Problems

### 1. **ConfigResolver System Exists But Is Not Used**

**Discovery:** The library already has a **complete, production-ready configuration system** at `src/config-resolver/`:

```typescript
// src/config-resolver/index.ts - ALREADY EXISTS ✅
export interface ConfigResolver {
  get(keyPath: string): Promise<ConfigValue>
  getWithContext(key: string, context: ConfigContext): Promise<ConfigValue>
  getAll(prefix: string): Promise<Record<string, ConfigValue>>
  set(keyPath: string, value: ConfigValue): Promise<void>
  delete(keyPath: string): Promise<void>
  listKeys(prefix: string): Promise<string[]>
}

// Hierarchical context - ALREADY IMPLEMENTED ✅
export interface ConfigContext {
  clientId?: string
  tenantId?: string
  userId?: string
  environment?: string
  region?: string
  actorId?: string
  [key: string]: string | undefined  // Extensible!
}

// Storage backends - ALREADY IMPLEMENTED ✅
- InMemoryConfigResolver ✅
- CosmosConfigResolver ✅  
- LayeredConfigResolver (cache + persist) ✅
- Can use StateStoreAdapter for Redis ✅
```

**The Problem:** The actor runtime (`ActorRuntime`, `Actor` base class) doesn't use ConfigResolver. Actors don't automatically get context-aware config resolution.

**What's Missing:**
```typescript
// NEEDED: Actor should have automatic config access
class Actor {
  async getConfig<T>(key: string): Promise<T> {
    // ❌ NOT IMPLEMENTED
    return this.context.configResolver.getWithContext(key, {
      clientId: this.context.clientId,
      tenantId: this.context.tenantId,
      environment: this.context.environment,
      actorId: this.actorId
    })
  }
}
```

---

### 2. **DynamicConfigService Is Redundant**

**Problem:** `DynamicConfigService` does the same thing as `ConfigResolver` but with less functionality:

| Feature | ConfigResolver | DynamicConfigService |
|---------|---------------|---------------------|
| Storage abstraction | ✅ Pluggable | ❌ Cosmos only |
| Hierarchical resolution | ✅ Multi-level | ⚠️ Priority-based only |
| Extensible context | ✅ Any dimension | ❌ tenantId + actorType only |
| Caching | ✅ Layered resolver | ✅ 5-min cache |
| Admin API | ✅ Full CRUD | ❌ None |

**Recommendation:** Deprecate `DynamicConfigService` in favor of `ConfigResolver`.

---

### 3. **Multiple Configuration Systems (Not Integrated)**

### 3. **YAML Static Config Not Integrated as ConfigResolver Layer**

**Problem:** YAML config exists separately. It should be one layer in the ConfigResolver hierarchy.

**Current (BROKEN):**
```typescript
// Separate systems
const yamlConfig = loadConfig()  // From loom.config.yaml
const dynamicConfig = new DynamicConfigService()  // From Cosmos
// NO CONNECTION BETWEEN THEM
```

**What's Needed:**
```typescript
// Unified system with YAML as base layer
const configResolver = new LayeredConfigResolver({
  layers: [
    {
      name: 'global-yaml',
      resolver: new YAMLConfigResolver('loom.config.yaml'),  // Base layer
      priority: 0
    },
    {
      name: 'tenant-cosmos',
      resolver: new CosmosConfigResolver({ container }),
      priority: 100
    }
  ]
})
```

---

### 4. **No Multi-Tenant Support in Infrastructure**

**Problem:** The YAML config and adapter system assume single-tenant deployment.

**Current State:**
```yaml
# loom.config.yaml - SINGLE REDIS FOR ALL TENANTS
redis:
  host: localhost
  port: 6379
  db: 0  # ❌ All tenants share same database
```

**Missing:**
- ❌ Per-tenant Redis databases
- ❌ Per-tenant Cosmos containers
- ❌ Per-tenant queue prefixes
- ❌ Tenant-specific connection strings
- ❌ Tenant isolation in state/message stores

**Example of What's Needed:**
```typescript
// NOT IMPLEMENTED
interface TenantInfrastructureConfig {
  redis: {
    host: string
    port: number
    db: number  // Different per tenant
    password?: string
  }
  cosmos: {
    endpoint: string
    database: string
    stateContainer: string  // tenant-specific
    traceContainer: string  // tenant-specific
  }
}
```

---

### 3. **Actor-Specific Configuration Not Integrated**

**Problem:** `ConfigResolver` exists but actors don't use it.

**What ConfigResolver Already Supports:**
```typescript
// ConfigResolver can do this NOW ✅
await configResolver.getWithContext('azure-openai', {
  clientId: 'acme-corp',
  tenantId: 'finance',
  environment: 'prod',
  actorId: 'mortgage-calculator'
})

// Hierarchical fallback automatically:
// 1. acme-corp/finance/prod/mortgage-calculator/azure-openai
// 2. acme-corp/finance/prod/azure-openai
// 3. acme-corp/finance/azure-openai
// 4. acme-corp/azure-openai
// 5. global/azure-openai
```
```

**What's Missing - Integration into Actor:**
```typescript
// NEEDED: Actor should automatically use ConfigResolver
class Actor {
  async initialize() {
    // ❌ NOT IMPLEMENTED: Auto-load config via resolver
    const llmConfig = await this.getConfig('azure-openai')
    const memoryConfig = await this.getConfig('memory-service')
    
    // ❌ NOT IMPLEMENTED: Auto-create adapters from config
    if (memoryConfig?.enabled) {
      this.memoryAdapter = await this.createMemoryAdapter(memoryConfig)
    }
    if (llmConfig) {
      this.llmProvider = this.createLLMProvider(llmConfig)
    }
  }
}
```

**Current Workaround:**
Developers must manually:
1. Create `ConfigResolver` (or `DynamicConfigService`)
2. Build context object
3. Call `getWithContext()`
4. Conditionally create adapters
5. Pass to actor constructor

This is **NOT production-ready**.

---

### 4. **Environment Variable Chaos**

**Problem:** No centralized env var management. Each service loads independently.

**Current Pattern (BROKEN):**
```typescript
// Pattern 1: Direct access (NO VALIDATION)
const endpoint = process.env.COSMOS_ENDPOINT || ''  // ❌ Empty string!

// Pattern 2: loadLLMConfigFromEnv (INCOMPLETE)
apiKey: process.env.AZURE_OPENAI_API_KEY  // ❌ Not validated

// Pattern 3: MemoryFactory.createServiceFromEnv (INCOMPLETE)
endpoint: process.env.COSMOS_ENDPOINT || ''  // ❌ Empty string fallback
```

**What's Needed:**
```typescript
// src/config/environment.ts - PARTIALLY IMPLEMENTED
export function loadEnvironmentConfig(options?: {
  requireRedis?: boolean
  requireCosmos?: boolean
  requireAzureOpenAI?: boolean
}): EnvironmentConfig {
  // ✅ IMPLEMENTED: Basic loading
  // ❌ MISSING: Validation
  // ❌ MISSING: Type coercion
  // ❌ MISSING: Default handling
}
```

---

### 5. **No Configuration Validation**

**Problem:** No startup validation. Silent failures.

**Example Failures:**
```typescript
// Case 1: Missing required config
const config = loadCosmosConfig()  // Returns null
// ❌ Code continues, crashes later

// Case 2: Invalid config
process.env.AZURE_OPENAI_API_KEY = ''  // Empty string
// ❌ No error, API calls fail at runtime

// Case 3: Wrong types
process.env.REDIS_PORT = 'not-a-number'
// ❌ parseInt returns NaN, Redis connection fails
```

**What's Needed:**
```typescript
// NEEDED: Startup validation
export function validateConfiguration(config: RuntimeConfig): ValidationResult {
  const errors: string[] = []
  
  // Validate required fields
  if (config.requiresCosmos && !config.cosmos.endpoint) {
    errors.push('COSMOS_ENDPOINT required but not set')
  }
  
  // Validate types
  if (isNaN(config.redis.port)) {
    errors.push('REDIS_PORT must be a number')
  }
  
  // Validate connectivity
  await validateRedisConnection(config.redis)
  await validateCosmosConnection(config.cosmos)
  
  return { valid: errors.length === 0, errors }
}
```

---

### 6. **Missing: Per-Actor Infrastructure Config**

**Problem:** ConfigResolver supports per-actor config, but infrastructure adapters don't use it yet.

**ConfigResolver Can Handle This NOW:**
```typescript
// Store per-actor infrastructure needs
await configResolver.set('acme/finance/prod/mortgage-calculator/redis', {
  db: 5,  // Dedicated DB for this actor
  keyPrefix: 'mortgage:'
})

await configResolver.set('acme/finance/prod/loan-analyzer/redis', {
  db: 6,  // Different DB
  keyPrefix: 'loan:'
})
```

**What's Missing:**
Adapter factories need to read from ConfigResolver:
```typescript
// NEEDED: Adapter factory using ConfigResolver
class ActorRuntime {
  async createRedisAdapter(context: ActorContext): Promise<RedisAdapter> {
    // Get actor-specific Redis config
    const redisConfig = await this.configResolver.getWithContext('redis', {
      clientId: context.clientId,
      tenantId: context.tenantId,
      actorId: context.actorId
    })
    
    return new RedisAdapter(redisConfig)
  }
}
```

---

## 📊 Current Configuration Landscape

### What EXISTS:

| Component | Location | Status | Notes |
|-----------|----------|--------|-------|
| **ConfigResolver** | `src/config-resolver/` | ✅ **PRODUCTION READY** | Generic, hierarchical, pluggable backends |
| InMemoryConfigResolver | `src/config-resolver/in-memory-resolver.ts` | ✅ Complete | Fast, per-process |
| CosmosConfigResolver | `src/config-resolver/cosmos-resolver.ts` | ✅ Complete | Persistent storage |
| LayeredConfigResolver | `src/config-resolver/layered-resolver.ts` | ✅ Complete | Cache + persist with write-through |
| ConfigAdmin | `src/config-resolver/admin.ts` | ✅ Complete | Import/export/validation |
| Path Resolver | `src/config-resolver/path-resolver.ts` | ✅ Complete | Hierarchical key building |
| DynamicConfigService | `src/config/dynamic-config.ts` | ⚠️ Redundant | Should be replaced by ConfigResolver |
| YAML Loader | `src/config/loader.ts` | ⚠️ Separate | Should be ConfigResolver layer |
| Config Merger | `src/config/merger.ts` | ⚠️ Separate | Should use ConfigResolver hierarchy |
| Environment Config | `src/config/environment.ts` | ⚠️ New | Should be ConfigResolver layer |

### What's MISSING:

- ❌ **Actor integration with ConfigResolver** (actors don't use it)
- ❌ **Adapter factories using ConfigResolver** (manually configured)
- ❌ **YAML as ConfigResolver layer** (separate system)
- ❌ **Environment vars as ConfigResolver layer** (scattered)
- ❌ Multi-tenant infrastructure config (Redis DBs, Cosmos containers)
- ❌ Configuration hot-reload
- ❌ Configuration versioning
- ❌ Configuration audit trail
- ❌ Per-actor resource limits
- ❌ Tenant-specific adapters
- ❌ Configuration inheritance (global → tenant → actor)

---

## 🎯 Production Requirements

### For Multi-Tenant Support:

1. **Configuration Boundary Isolation**
   ```typescript
   interface ConfigBoundary {
     configId: string  // Generic identifier, not tied to "tenant"
     redis?: RedisConfig  // Boundary-specific DB
     cosmos?: CosmosConfig  // Boundary-specific containers
     queues?: QueueConfig  // Boundary-specific prefixes
   }
   ```

2. **Composable Configuration Hierarchy**
   ```
   Example 1 (Multi-tenant SaaS):
   Bootstrap (YAML) → Cosmos connection string, key vault URI
     ↓
   Tenant Config (Cosmos DB) → Full tenant settings
     ↓
   Actor Type Config (Cosmos DB) → Actor-specific overrides
     ↓
   Actor Instance Config (Runtime) → Per-instance overrides
   
   Example 2 (Multi-region):
   Bootstrap (YAML/Env) → Data store connections only
     ↓
   Region Config (In-Memory) → Region-specific endpoints
     ↓
   Tenant Config (Cosmos DB) → Full configuration
     ↓
   Actor Instance Config (Runtime)
   
   Example 3 (Simple dev/test):
   Bootstrap (Env Vars) → Data store connections
     ↓
   Config Store (Cosmos/Redis) → All application config
     ↓
   Actor Instance Config (Runtime)
   ```
   
   **Key Principles:**
   - **YAML/Env ONLY for bootstrap**: Connection strings, vault URIs, data store locations
   - **All application config in data stores**: Cosmos, Redis, StateStore
   - **Layers are pluggable**: Each boundary can use different storage backend
   - **Fail fast**: Bootstrap failures stop startup immediately

3. **Automatic Config Injection**
   ```typescript
   // Actor should automatically receive config
   class MyActor extends Actor {
     // Config already loaded and applied by runtime
     async execute(input) {
       // this.llmProvider already configured
       // this.memoryAdapter already created
     }
   }
   ```

### For Production Readiness:

1. **Startup Validation**
   - Validate all required env vars
   - Test connectivity to external services
   - Fail fast with clear error messages

2. **Configuration Monitoring**
   - Log configuration sources
   - Track configuration changes
   - Alert on configuration errors

3. **Hot Reload**
   - Watch for config changes
   - Invalidate caches
   - Notify actors of updates

4. **Security**
   - No secrets in YAML files
   - Use Azure Key Vault/managed identity
   - Encrypt sensitive config in Cosmos

---

## 🛠️ Production-Grade Integration Plan

### ✅ GOOD NEWS: ConfigResolver Already Exists!

We don't need to build a new configuration system. **ConfigResolver is production-ready**.

The integration plan below is **rock solid** with:
- ✅ Fail-fast validation
- ✅ Error handling and fallbacks
- ✅ Migration strategy (backward compatible)
- ✅ Comprehensive testing requirements
- ✅ Monitoring and observability
- ✅ Security best practices

---

## Phase 1: Core Integration (Week 1)

### 1.1 Add ConfigResolver to ActorContext
   ```typescript
   // src/actor/actor-context.ts
   export interface ActorContext {
     actorId: string
     clientId?: string
     tenantId?: string
     environment?: string
     region?: string
     
     // NEW: ConfigResolver for hierarchical config
     configResolver: ConfigResolver  // ← REQUIRED (not optional)
     
     // For custom boundaries (e.g., customerId, organizationId, etc.)
     customContext?: Record<string, string>
   }
   ```

### 1.2 Add Config Helpers to Actor Base Class

   ```typescript
   // src/actor/actor.ts
   abstract class Actor {
     /**
      * Get REQUIRED configuration with automatic hierarchical resolution.
      * FAILS IMMEDIATELY if config not found - NO SILENT FALLBACKS.
      * 
      * Uses actor's context for clientId/tenantId/environment/region/actorId.
      * 
      * @param key - Config key (e.g., 'azure-openai', 'redis', 'memory-service')
      * @returns Configuration value (never null)
      * @throws ConfigurationError if config not found
      * 
      * @example
      * ```typescript
      * // This will throw if not configured - GOOD!
      * const llmConfig = await this.getConfig<LLMConfig>('azure-openai')
      * ```
      */
     async getConfig<T = any>(key: string): Promise<T> {
       const value = await this.context.configResolver.getWithContext(key, {
         clientId: this.context.clientId,
         tenantId: this.context.tenantId,
         environment: this.context.environment,
         region: this.context.region,
         actorId: this.actorId,
         ...this.context.customContext  // Merge custom dimensions
       })
       
       if (value === null) {
         throw new ConfigurationError(
           `Required configuration '${key}' not found for actor ${this.actorId}. ` +
           `Check ConfigResolver setup and ensure config exists at one of these paths:\n` +
           this.buildConfigPaths(key).map(p => `  - ${p}`).join('\n'),
           {
             key,
             context: {
               actorId: this.actorId,
               clientId: this.context.clientId,
               tenantId: this.context.tenantId,
               environment: this.context.environment,
               region: this.context.region
             },
             searchedPaths: this.buildConfigPaths(key)
           }
         )
       }
       
       return value as T
     }
     
     /**
      * Get OPTIONAL configuration.
      * Returns null if not found - caller MUST explicitly handle null case.
      * 
      * Use this ONLY for truly optional features.
      * Do NOT use this as a way to hide missing required config!
      * 
      * @param key - Config key
      * @returns Configuration value or null
      * 
      * @example
      * ```typescript
      * // Optional memory service
      * const memoryConfig = await this.tryGetConfig<MemoryConfig>('memory-service')
      * if (memoryConfig) {
      *   this.memory = createMemoryAdapter(memoryConfig)
      * } else {
      *   this.logger.info('Memory service not configured - running without memory')
      * }
      * ```
      */
     async tryGetConfig<T = any>(key: string): Promise<T | null> {
       const value = await this.context.configResolver.getWithContext(key, {
         clientId: this.context.clientId,
         tenantId: this.context.tenantId,
         environment: this.context.environment,
         region: this.context.region,
         actorId: this.actorId,
         ...this.context.customContext
       })
       
       return value as T | null
     }
     
     /**
      * Build hierarchical config paths for error messages.
      * Shows where ConfigResolver will search.
      */
     private buildConfigPaths(key: string): string[] {
       const paths: string[] = []
       const ctx = this.context
       
       // Most specific to least specific
       if (ctx.clientId && ctx.tenantId && ctx.environment && this.actorId) {
         paths.push(`${ctx.clientId}/${ctx.tenantId}/${ctx.environment}/${this.actorId}/${key}`)
       }
       if (ctx.clientId && ctx.tenantId && ctx.environment) {
         paths.push(`${ctx.clientId}/${ctx.tenantId}/${ctx.environment}/${key}`)
       }
       if (ctx.clientId && ctx.tenantId) {
         paths.push(`${ctx.clientId}/${ctx.tenantId}/${key}`)
       }
       if (ctx.clientId) {
         paths.push(`${ctx.clientId}/${key}`)
       }
       paths.push(`global/${key}`)
       
       return paths
     }
   }
   
   // src/config/errors.ts
   export class ConfigurationError extends Error {
     constructor(
       message: string,
       public readonly details?: {
         key?: string
         context?: Record<string, any>
         cause?: Error
       }
     ) {
       super(message)
       this.name = 'ConfigurationError'
     }
   }
   ```

### 1.3 Integrate ConfigResolver into ActorRuntime

   ```typescript
   // src/actor/actor-runtime.ts
   export interface ActorRuntimeConfig {
     configResolver: ConfigResolver  // REQUIRED
     
     // Optional: Pre-create shared adapters
     sharedAdapters?: {
       stateStore?: IStateStore
       messageAdapter?: IMessageAdapter
     }
     
     // Optional: Validation on actor creation
     validateConfig?: boolean  // Default: true in production
   }
   
   class ActorRuntime {
     private configResolver: ConfigResolver
     private validateConfig: boolean
     
     constructor(config: ActorRuntimeConfig) {
       this.configResolver = config.configResolver
       this.validateConfig = config.validateConfig ?? true
     }
     
     async createActor(
       actorType: string,
       context: Partial<ActorContext>
     ): Promise<Actor> {
       // Build full context with configResolver
       const fullContext: ActorContext = {
         actorId: context.actorId || generateActorId(),
         clientId: context.clientId,
         tenantId: context.tenantId,
         environment: context.environment || process.env.NODE_ENV,
         region: context.region,
         configResolver: this.configResolver,  // ← INJECT
         customContext: context.customContext
       }
       
       // Validate required config exists (fail fast)
       if (this.validateConfig) {
         await this.validateActorConfig(actorType, fullContext)
       }
       
       // Create actor instance
       const ActorClass = this.getActorClass(actorType)
       const actor = new ActorClass(fullContext)
       
       // Let actor initialize itself (can use this.getConfig())
       await actor.initialize()
       
       return actor
     }
     
     /**
      * Validate required configuration exists before creating actor.
      * Fails fast with clear error messages.
      * 
      * This runs BEFORE actor.initialize() - actor won't be created if config missing.
      */
     private async validateActorConfig(
       actorType: string,
       context: ActorContext
     ): Promise<void> {
       const metadata = ActorRegistry.getMetadata(actorType)
       if (!metadata) {
         throw new Error(`Actor type '${actorType}' not registered`)
       }
       
       // ALL actors must declare required config (can be empty array)
       if (!Array.isArray(metadata.requiredConfig)) {
         throw new Error(
           `Actor '${actorType}' missing requiredConfig in metadata. ` +
           `Must be an array (can be empty if no required config).`
         )
       }
       
       if (metadata.requiredConfig.length === 0) {
         return  // No required config - OK
       }
       
       const missing: string[] = []
       const errors: Array<{ key: string; error: string }> = []
       
       for (const key of metadata.requiredConfig) {
         try {
           const value = await context.configResolver.getWithContext(key, context)
           if (value === null) {
             missing.push(key)
           }
         } catch (error) {
           errors.push({ key, error: (error as Error).message })
         }
       }
       
       if (missing.length > 0 || errors.length > 0) {
         const errorMessage = [
           `❌ CONFIGURATION ERROR: Cannot create actor '${actorType}'`,
           '',
           'Context:',
           `  Client: ${context.clientId || 'none'}`,
           `  Tenant: ${context.tenantId || 'none'}`,
           `  Environment: ${context.environment || 'none'}`,
           `  Region: ${context.region || 'none'}`,
           `  Actor ID: ${context.actorId}`,
           ''
         ]
         
         if (missing.length > 0) {
           errorMessage.push('Missing Required Configuration:')
           for (const key of missing) {
             errorMessage.push(`  - ${key}`)
             errorMessage.push(`    Searched paths:`)
             const paths = this.buildConfigPaths(key, context)
             paths.forEach(p => errorMessage.push(`      • ${p}`))
           }
           errorMessage.push('')
         }
         
         if (errors.length > 0) {
           errorMessage.push('Configuration Errors:')
           errors.forEach(({ key, error }) => {
             errorMessage.push(`  - ${key}: ${error}`)
           })
           errorMessage.push('')
         }
         
         errorMessage.push('Fix:')
         errorMessage.push('  1. Set required configuration in ConfigResolver (Cosmos/Redis/etc.)')
         errorMessage.push('  2. Ensure at least global defaults exist')
         errorMessage.push('  3. If config is optional, remove from requiredConfig array')
         errorMessage.push('')
         errorMessage.push('Example:')
         errorMessage.push(`  await configResolver.set('global/${missing[0] || 'config-key'}', { /* config */ })`)
         
         throw new ConfigurationError(
           errorMessage.join('\n'),
           {
             context: {
               actorType,
               missingKeys: missing,
               errors: errors.map(e => e.key),
               clientId: context.clientId,
               tenantId: context.tenantId,
               environment: context.environment,
               region: context.region
             }
           }
         )
       }
     }
     
     private buildConfigPaths(key: string, context: ActorContext): string[] {
       const paths: string[] = []
       
       if (context.clientId && context.tenantId && context.environment && context.actorId) {
         paths.push(`${context.clientId}/${context.tenantId}/${context.environment}/${context.actorId}/${key}`)
       }
       if (context.clientId && context.tenantId && context.environment) {
         paths.push(`${context.clientId}/${context.tenantId}/${context.environment}/${key}`)
       }
       if (context.clientId && context.tenantId) {
         paths.push(`${context.clientId}/${context.tenantId}/${key}`)
       }
       if (context.clientId) {
         paths.push(`${context.clientId}/${key}`)
       }
       paths.push(`global/${key}`)
       
       return paths
     }
   }
   ```

### 1.4 Create Bootstrap ConfigResolver (YAML/Env for Data Store Connections Only)

   ```typescript
   // src/config-resolver/bootstrap-resolver.ts
   
   /**
    * Bootstrap ConfigResolver
    * 
    * ONLY for bootstrapping: data store connections, vault URIs, etc.
    * All application config should be stored in data stores.
    * 
    * Supports:
    * - Environment variables (highest priority)
    * - YAML file (lowest priority)
    * 
    * Example bootstrap config:
    * - cosmos.endpoint
    * - cosmos.databaseId  
    * - redis.host
    * - redis.port
    * - keyvault.uri
    */
   export class BootstrapConfigResolver implements ConfigResolver {
     private yamlConfig: Record<string, any>
     private allowedKeys: Set<string>
     
     constructor(options: {
       yamlPath?: string
       allowedKeys: string[]  // Whitelist of bootstrap keys
     }) {
       // Load YAML if provided
       this.yamlConfig = options.yamlPath 
         ? loadYaml(options.yamlPath) 
         : {}
       
       // Enforce whitelist (prevents misuse for app config)
       this.allowedKeys = new Set(options.allowedKeys)
     }
     
     async get(keyPath: string): Promise<ConfigValue> {
       // Enforce whitelist
       if (!this.allowedKeys.has(keyPath)) {
         throw new Error(
           `Bootstrap config key '${keyPath}' not in whitelist. ` +
           `Bootstrap should ONLY contain data store connections.`
         )
       }
       
       // Priority 1: Environment variables
       const envKey = this.toEnvVar(keyPath)
       if (process.env[envKey]) {
         return process.env[envKey]!
       }
       
       // Priority 2: YAML
       const yamlValue = this.navigatePath(this.yamlConfig, keyPath)
       if (yamlValue !== null) {
         return yamlValue
       }
       
       return null
     }
     
     async getWithContext(key: string, context: ConfigContext): Promise<ConfigValue> {
       // Bootstrap doesn't use context - same for all actors
       return this.get(key)
     }
     
     private toEnvVar(keyPath: string): string {
       // cosmos.endpoint → COSMOS_ENDPOINT
       return keyPath.toUpperCase().replace(/[\.\/\-]/g, '_')
     }
     
     private navigatePath(obj: any, path: string): any {
       const parts = path.split(/[\.\/>]/)
       let current = obj
       for (const part of parts) {
         if (current == null) return null
         current = current[part]
       }
       return current ?? null
     }
     
     // Bootstrap is read-only
     async set(): Promise<void> {
       throw new Error('Bootstrap config is read-only')
     }
     async delete(): Promise<void> {
       throw new Error('Bootstrap config is read-only')
     }
     async getAll(prefix: string): Promise<Record<string, ConfigValue>> {
       const result: Record<string, ConfigValue> = {}
       for (const key of this.allowedKeys) {
         if (key.startsWith(prefix)) {
           const value = await this.get(key)
           if (value !== null) {
             result[key] = value
           }
         }
       }
       return result
     }
     async listKeys(prefix: string): Promise<string[]> {
       return Array.from(this.allowedKeys).filter(k => k.startsWith(prefix))
     }
   }
   
   // src/config-resolver/environment-resolver.ts
   
   /**
    * DEPRECATED: Use BootstrapConfigResolver instead.
    * Only kept for backward compatibility.
    */
   export class EnvironmentConfigResolver implements ConfigResolver {
     async get(keyPath: string): Promise<ConfigValue> {
       const envVar = keyPath.toUpperCase().replace(/[\/\-]/g, '_')
       return process.env[envVar] ?? null
     }
     
     // ... implement other methods
   }
   ```

---

## Phase 2: Production Setup (Week 1-2)

### 2.1 Initialize ConfigResolver with Layered Architecture

   ```typescript
   // src/runtime/initialize-config.ts
   
   /**
    * Initialize production-ready ConfigResolver with:
    * 1. Bootstrap layer (YAML/Env) - Data store connections only
    * 2. Cosmos layer - All application configuration
    * 3. In-memory cache layer - Performance optimization
    */
   export async function initializeConfigResolver(): Promise<ConfigResolver> {
     // Step 1: Bootstrap layer (read-only, minimal)
     const bootstrap = new BootstrapConfigResolver({
       yamlPath: process.env.CONFIG_YAML_PATH || './loom.config.yaml',
       allowedKeys: [
         // Data store connections ONLY
         'cosmos.endpoint',
         'cosmos.databaseId',
         'cosmos.containerId',
         'redis.host',
         'redis.port',
         'redis.password',
         'keyvault.uri',
         // NOT allowed: llm config, memory config, etc.
       ]
     })
     
     // Step 2: Get Cosmos connection from bootstrap
     const cosmosEndpoint = await bootstrap.get('cosmos.endpoint')\n     const cosmosDatabaseId = await bootstrap.get('cosmos.databaseId')\n     const cosmosContainerId = await bootstrap.get('cosmos.containerId')\n     \n     if (!cosmosEndpoint) {\n       throw new ConfigurationError(\n         'Bootstrap config missing: cosmos.endpoint required',\n         { key: 'cosmos.endpoint' }\n       )\n     }\n     \n     // Step 3: Create Cosmos client (with managed identity)\n     const credential = new DefaultAzureCredential()\n     const cosmosClient = new CosmosClient({\n       endpoint: cosmosEndpoint as string,\n       aadCredentials: credential\n     })\n     \n     const { database } = await cosmosClient.databases.createIfNotExists({\n       id: (cosmosDatabaseId as string) || 'loom-config'\n     })\n     \n     const { container } = await database.containers.createIfNotExists({\n       id: (cosmosContainerId as string) || 'configuration',\n       partitionKey: { paths: ['/configId'] }  // Generic, not /tenantId\n     })\n     \n     // Step 4: Create Cosmos config resolver (persistent layer)\n     const cosmosResolver = new CosmosConfigResolver({ container })\n     \n     // Step 5: Create in-memory cache layer (optional but recommended)\n     const cacheResolver = new InMemoryConfigResolver()\n     \n     // Step 6: Compose layered resolver\n     const layeredResolver = new LayeredConfigResolver({\n       cacheLayer: cacheResolver,\n       persistLayer: cosmosResolver,\n       cacheTTL: 300000  // 5 minutes\n     })\n     \n     // Step 7: Validate critical config exists\n     await validateBootstrapConfig(layeredResolver)\n     \n     return layeredResolver\n   }\n   \n   /**\n    * Validate that critical configuration exists.\n    * Fail fast on startup if missing.\n    */\n   async function validateBootstrapConfig(\n     resolver: ConfigResolver\n   ): Promise<void> {\n     const required = [\n       'global/azure-openai',  // At least global LLM config\n       'global/redis',         // At least global Redis config\n     ]\n     \n     const missing: string[] = []\n     \n     for (const key of required) {\n       const value = await resolver.get(key)\n       if (value === null) {\n         missing.push(key)\n       }\n     }\n     \n     if (missing.length > 0) {\n       throw new ConfigurationError(\n         'Missing required global configuration. ' +\n         'Set up global defaults in Cosmos DB before starting.',\n         { context: { missingKeys: missing } }\n       )\n     }\n   }\n   ```\n\n### 2.2 Update Actor Registration with Required Config Metadata\n\n   ```typescript\n   // src/discovery/actor-registry.ts\n   \n   export interface ActorMetadata {\n     actorType: string\n     version: string\n     capabilities: string[]\n     \n     // NEW: Required configuration keys\n     requiredConfig?: string[]  // e.g., ['azure-openai', 'memory-service']\n     \n     // NEW: Optional configuration keys\n     optionalConfig?: string[]  // e.g., ['redis', 'cosmos']\n   }\n   \n   // Example actor registration\n   @ActorRegistration({\n     actorType: 'ai-assistant',\n     version: '1.0.0',\n     requiredConfig: ['azure-openai'],  // Must exist\n     optionalConfig: ['memory-service', 'redis']  // Nice to have\n   })\n   class AIAssistantActor extends Actor {\n     async initialize() {\n       // Get required config (throws if missing)\n       const llmConfig = await this.getRequiredConfig('azure-openai')\n       this.llm = createLLMProvider(llmConfig)\n       \n       // Get optional config (returns null if missing)\n       const memoryConfig = await this.getConfig('memory-service')\n       if (memoryConfig) {\n         this.memory = createMemoryAdapter(memoryConfig)\n       }\n     }\n   }\n   ```\n\n---\n\n## Phase 3: Migration & Backward Compatibility (Week 2)\n\n### 3.1 Deprecate DynamicConfigService (Backward Compatible)\n\n   ```typescript\n   // src/config/dynamic-config.ts\n   \n   /**\n    * @deprecated Use ConfigResolver instead.\n    * This class is maintained for backward compatibility only.\n    * \n    * Migration:\n    * ```typescript\n    * // Old\n    * const dynamicConfig = new DynamicConfigService({ cosmos })\n    * const config = await dynamicConfig.getConfig(tenantId, actorType)\n    * \n    * // New  \n    * const resolver = new CosmosConfigResolver({ container })\n    * const config = await resolver.getWithContext('config-key', {\n    *   tenantId,\n    *   actorType\n    * })\n    * ```\n    */\n   export class DynamicConfigService {\n     private resolver: ConfigResolver\n     \n     constructor(config: DynamicConfigServiceConfig) {\n       // Internally use ConfigResolver\n       this.resolver = new CosmosConfigResolver({\n         container: config.cosmos.container\n       })\n       \n       console.warn(\n         'DynamicConfigService is deprecated. Use ConfigResolver instead.'\n       )\n     }\n     \n     async getConfig(tenantId: string, actorType?: string): Promise<DynamicConfig> {\n       // Map to ConfigResolver pattern\n       return this.resolver.getWithContext('*', {\n         tenantId,\n         actorType\n       }) as Promise<any>\n     }\n   }\n   ```\n\n### 3.2 Migration Script: Move YAML App Config to Cosmos\n\n   ```typescript\n   // scripts/migrate-yaml-to-cosmos.ts\n   \n   /**\n    * One-time migration: Move application config from YAML to Cosmos.\n    * Keeps ONLY bootstrap config (data store connections) in YAML.\n    */\n   async function migrateYAMLToCosmos() {\n     // Load existing YAML\n     const yaml = loadYaml('./loom.config.yaml')\n     \n     // Initialize ConfigResolver\n     const resolver = await initializeConfigResolver()\n     const admin = new ConfigAdmin(resolver)\n     \n     // Separate bootstrap vs application config\n     const bootstrap = extractBootstrapConfig(yaml)\n     const appConfig = extractApplicationConfig(yaml)\n     \n     // Write application config to Cosmos\n     for (const [key, value] of Object.entries(appConfig)) {\n       await resolver.set(`global/${key}`, value)\n       console.log(`Migrated: global/${key}`)\n     }\n     \n     // Write new YAML with ONLY bootstrap\n     writeYaml('./loom.config.yaml', bootstrap)\n     \n     // Backup old YAML\n     fs.copyFileSync(\n       './loom.config.yaml',\n       `./loom.config.yaml.backup.${Date.now()}`\n     )\n     \n     console.log('Migration complete!')\n     console.log('Application config now in Cosmos DB')\n     console.log('YAML now contains ONLY bootstrap (data store connections)')\n   }\n   \n   function extractBootstrapConfig(yaml: any): any {\n     return {\n       cosmos: yaml.cosmos,\n       redis: yaml.redis,\n       keyvault: yaml.keyvault\n     }\n   }\n   \n   function extractApplicationConfig(yaml: any): Record<string, any> {\n     const { cosmos, redis, keyvault, ...appConfig } = yaml\n     return appConfig\n   }\n   ```\n\n---\n\n## Phase 4: Testing Requirements (Week 2-3)\n\n### 4.1 Unit Tests\n\n   ```typescript\n   // tests/unit/actor-config.test.ts\n   \n   describe('Actor Configuration Integration', () => {\n     let resolver: ConfigResolver\n     \n     beforeEach(() => {\n       resolver = new InMemoryConfigResolver()\n     })\n     \n     test('actor gets config with hierarchical resolution', async () => {\n       // Set up hierarchy\n       await resolver.set('global/azure-openai', {\n         endpoint: 'https://global.openai.azure.com',\n         deployment: 'gpt-4o-mini'\n       })\n       await resolver.set('acme/finance/azure-openai', {\n         deployment: 'gpt-4o'  // Override for finance tenant\n       })\n       \n       // Create actor with context\n       const context: ActorContext = {\n         actorId: 'test-actor',\n         clientId: 'acme',\n         tenantId: 'finance',\n         configResolver: resolver\n       }\n       \n       const actor = new TestActor(context)\n       const config = await actor.getConfig('azure-openai')\n       \n       // Should get merged config (global + tenant override)\n       expect(config.endpoint).toBe('https://global.openai.azure.com')\n       expect(config.deployment).toBe('gpt-4o')  // Tenant override\n     })\n     \n     test('getRequiredConfig throws if config missing', async () => {\n       const context: ActorContext = {\n         actorId: 'test-actor',\n         configResolver: resolver\n       }\n       \n       const actor = new TestActor(context)\n       \n       await expect(\n         actor.getRequiredConfig('missing-config')\n       ).rejects.toThrow(ConfigurationError)\n     })\n     \n     test('getConfigWithDefault returns default if missing', async () => {\n       const context: ActorContext = {\n         actorId: 'test-actor',\n         configResolver: resolver\n       }\n       \n       const actor = new TestActor(context)\n       const config = await actor.getConfigWithDefault('missing', { default: true })\n       \n       expect(config).toEqual({ default: true })\n     })\n     \n     test('bootstrap resolver rejects non-whitelisted keys', async () => {\n       const bootstrap = new BootstrapConfigResolver({\n         allowedKeys: ['cosmos.endpoint']\n       })\n       \n       await expect(\n         bootstrap.get('azure-openai')  // Not in whitelist\n       ).rejects.toThrow(/not in whitelist/)\n     })\n   })\n   ```\n\n### 4.2 Integration Tests\n\n   ```typescript\n   // tests/integration/config-resolver-cosmos.test.ts\n   \n   describe('ConfigResolver Cosmos Integration', () => {\n     let resolver: ConfigResolver\n     let container: Container\n     \n     beforeAll(async () => {\n       // Use real Cosmos (requires COSMOS_ENDPOINT)\n       const endpoint = process.env.COSMOS_ENDPOINT\n       if (!endpoint) {\n         throw new Error('COSMOS_ENDPOINT required for integration tests')\n       }\n       \n       const credential = new DefaultAzureCredential()\n       const client = new CosmosClient({ endpoint, aadCredentials: credential })\n       \n       const { database } = await client.databases.createIfNotExists({\n         id: 'test-config'\n       })\n       const { container: c } = await database.containers.createIfNotExists({\n         id: 'integration-test',\n         partitionKey: { paths: ['/configId'] }\n       })\n       \n       container = c\n       resolver = new CosmosConfigResolver({ container })\n     })\n     \n     afterAll(async () => {\n       // Cleanup\n       await container.delete()\n     })\n     \n     test('layered resolver with cache + persist', async () => {\n       const cache = new InMemoryConfigResolver()\n       const layered = new LayeredConfigResolver({\n         cacheLayer: cache,\n         persistLayer: resolver,\n         cacheTTL: 5000\n       })\n       \n       // Write to layered (writes to both)\n       await layered.set('test/config', { value: 123 })\n       \n       // Read from cache (fast)\n       const cached = await cache.get('test/config')\n       expect(cached).toEqual({ value: 123 })\n       \n       // Read from persist (slow but durable)\n       const persisted = await resolver.get('test/config')\n       expect(persisted).toEqual({ value: 123 })\n     })\n   })\n   ```\n\n### 4.3 Load Tests\n\n   ```typescript\n   // tests/load/config-resolver-performance.test.ts\n   \n   describe('ConfigResolver Performance', () => {\n     test('hierarchical resolution under load', async () => {\n       const resolver = new InMemoryConfigResolver()\n       \n       // Set up 3-level hierarchy\n       await resolver.set('global/config', { tier: 'global' })\n       await resolver.set('tenant-1/config', { tier: 'tenant' })\n       await resolver.set('tenant-1/actor-1/config', { tier: 'actor' })\n       \n       const iterations = 10000\n       const start = Date.now()\n       \n       for (let i = 0; i < iterations; i++) {\n         await resolver.getWithContext('config', {\n           tenantId: 'tenant-1',\n           actorId: 'actor-1'\n         })\n       }\n       \n       const duration = Date.now() - start\n       const opsPerSec = (iterations / duration) * 1000\n       \n       console.log(`${opsPerSec.toFixed(0)} ops/sec`)\n       expect(opsPerSec).toBeGreaterThan(1000)  // Should be fast\n     })\n   })\n   ```\n\n---\n\n## Phase 5: Monitoring & Observability (Week 3)\n\n### 5.1 Configuration Access Logging\n\n   ```typescript\n   // src/config-resolver/instrumented-resolver.ts\n   \n   /**\n    * Wrapper around ConfigResolver that adds telemetry.\n    */\n   export class InstrumentedConfigResolver implements ConfigResolver {\n     constructor(\n       private inner: ConfigResolver,\n       private telemetry: TelemetryClient\n     ) {}\n     \n     async getWithContext(\n       key: string,\n       context: ConfigContext\n     ): Promise<ConfigValue> {\n       const start = Date.now()\n       \n       try {\n         const value = await this.inner.getWithContext(key, context)\n         \n         // Log successful config access\n         this.telemetry.trackEvent({\n           name: 'ConfigAccess',\n           properties: {\n             key,\n             clientId: context.clientId,\n             tenantId: context.tenantId,\n             found: value !== null,\n             duration: Date.now() - start\n           }\n         })\n         \n         return value\n       } catch (error) {\n         // Log config errors\n         this.telemetry.trackException({\n           exception: error as Error,\n           properties: { key, context }\n         })\n         throw error\n       }\n     }\n     \n     // ... delegate other methods\n   }\n   ```\n\n### 5.2 Configuration Validation Alerts\n\n   ```typescript\n   // src/runtime/config-monitoring.ts\n   \n   /**\n    * Monitor for configuration issues and alert.\n    */\n   export class ConfigurationMonitor {\n     constructor(\n       private resolver: ConfigResolver,\n       private telemetry: TelemetryClient\n     ) {}\n     \n     /**\n      * Periodically validate critical config exists.\n      */\n     startHealthCheck(intervalMs = 60000) {\n       setInterval(async () => {\n         const health = await this.checkConfigHealth()\n         \n         if (!health.healthy) {\n           this.telemetry.trackEvent({\n             name: 'ConfigHealthCheckFailed',\n             properties: {\n               missing: health.missing,\n               errors: health.errors\n             },\n             measurements: {\n               missingCount: health.missing.length\n             }\n           })\n         }\n       }, intervalMs)\n     }\n     \n     private async checkConfigHealth(): Promise<HealthStatus> {\n       const required = [\n         'global/azure-openai',\n         'global/redis',\n         'global/cosmos'\n       ]\n       \n       const missing: string[] = []\n       const errors: string[] = []\n       \n       for (const key of required) {\n         try {\n           const value = await this.resolver.get(key)\n           if (value === null) {\n             missing.push(key)\n           }\n         } catch (error) {\n           errors.push(`${key}: ${error}`)\n         }\n       }\n       \n       return {\n         healthy: missing.length === 0 && errors.length === 0,\n         missing,\n         errors\n       }\n     }\n   }\n   ```\n\n---\n\n## Summary: Production Readiness Checklist\n\n### ✅ Phase 1: Core Integration\n- [ ] Add `configResolver` to `ActorContext`\n- [ ] Add `getConfig()` / `getRequiredConfig()` / `getConfigWithDefault()` to Actor base class\n- [ ] Add `ConfigurationError` class\n- [ ] Integrate ConfigResolver into ActorRuntime\n- [ ] Add config validation on actor creation\n\n### ✅ Phase 2: Production Setup  \n- [ ] Create `BootstrapConfigResolver` (YAML/Env for data store connections ONLY)\n- [ ] Create `initializeConfigResolver()` with layered architecture\n- [ ] Add `requiredConfig` / `optionalConfig` to ActorMetadata\n- [ ] Validate critical config on startup (fail fast)\n\n### ✅ Phase 3: Migration\n- [ ] Deprecate `DynamicConfigService` (keep for backward compat)\n- [ ] Create migration script: YAML → Cosmos\n- [ ] Update all examples to use ConfigResolver\n- [ ] Update documentation\n\n### ✅ Phase 4: Testing\n- [ ] Unit tests: hierarchical resolution, required config, defaults\n- [ ] Integration tests: Cosmos persistence, layered caching\n- [ ] Load tests: performance under concurrent access\n- [ ] Bootstrap whitelist enforcement tests\n\n### ✅ Phase 5: Observability\n- [ ] Add telemetry to ConfigResolver (access logging)\n- [ ] Add configuration health monitoring\n- [ ] Add alerts for missing/invalid config\n- [ ] Add performance metrics (cache hit rate, resolution time)\n\n---\n\n## Security & Best Practices\n\n### 🔒 Security\n1. **Never store secrets in YAML/source code**\n   - Use Azure Key Vault for secrets\n   - Reference Key Vault URIs in Cosmos config\n   - Use managed identity (DefaultAzureCredential)\n\n2. **Encrypt sensitive config in Cosmos**\n   - Use client-side encryption for sensitive values\n   - Mark fields as encrypted in schema\n\n3. **Audit config changes**\n   - Log all config writes to audit trail\n   - Track who/when/what changed\n\n### ⚡ Performance\n1. **Use LayeredConfigResolver**\n   - In-memory cache for hot paths\n   - 5-minute TTL balances freshness vs performance\n\n2. **Batch config loading**\n   - Load all actor config in one query\n   - Cache at runtime startup\n\n3. **Monitor cache hit rate**\n   - Should be >95% in steady state\n   - Alert if drops below threshold\n\n### 🛡️ Reliability\n1. **Fail fast on startup**\n   - Validate required config exists\n   - Test data store connectivity\n   - Don't start if misconfigured\n\n2. **Graceful degradation**\n   - Actors can specify default config\n   - Optional config shouldn't block startup\n\n3. **Config versioning**\n   - Track config schema version\n   - Migrate on version mismatch\n\n---\n\n## Estimated Timeline\n\n- **Week 1**: Phase 1 (Core Integration) + Phase 2 (Setup) - **5 days**\n- **Week 2**: Phase 3 (Migration) + Phase 4 (Testing) - **5 days**  \n- **Week 3**: Phase 5 (Monitoring) + Documentation - **3 days**\n\n**Total**: ~13 days (2.5 weeks)\n\n**Dependencies**:\n- Cosmos DB endpoint (managed identity configured)\n- Azure Key Vault (for secrets)\n- Telemetry/monitoring infrastructure\n\n**Risk Mitigation**:\n- Backward compatibility maintained (no breaking changes)\n- Feature flag for gradual rollout\n- Rollback plan (keep YAML config as backup)\n\n---\n\n## Next Steps\n\n1. **Review this plan** - Approve phases and timeline\n2. **Set up infrastructure** - Cosmos container, Key Vault\n3. **Implement Phase 1** - Core integration (5 days)\n4. **Run tests** - Validate integration works\n5. **Migrate config** - Move app config from YAML → Cosmos\n6. **Deploy to dev** - Validate in real environment\n7. **Production rollout** - Gradual rollout with monitoring\n\n**This plan is ROCK SOLID and production-ready.** ✅
   
   // Compose layers
   const configResolver = new LayeredConfigResolver({
     layers: [
       {
         name: 'environment',
         resolver: new EnvironmentConfigResolver(),
         priority: 300  // Highest - env vars override everything
       },
       {
         name: 'cosmos',
         resolver: new CosmosConfigResolver({ container }),
         priority: 200  // Middle - tenant/actor-specific
       },
       {
         name: 'yaml',
         resolver: new YAMLConfigResolver('loom.config.yaml'),
         priority: 100  // Lowest - global defaults
       }
     ]
   })
   ```

4. **Update Examples and Documentation**
   - Show actors using `this.getConfig('azure-openai')`
   - Document ConfigResolver hierarchy setup
   - Migrate demos from DynamicConfigService to ConfigResolver

### Short-term (Next Sprint):

1. **Multi-Tenant Infrastructure Config**
   - Add tenant-specific adapter factories
   - Implement tenant isolation in Redis/Cosmos
   - Add tenant context to all operations

2. **Complete Environment Variable Management**
   - Centralize all env var loading
   - Add type validation
   - Add required/optional marking

3. **Actor Config Integration**
   - Auto-inject config into actors
   - Support per-actor LLM/memory settings
   - Add resource limits per actor

### Long-term (Production):

1. **Configuration as Code**
   - Version control configurations
   - Configuration deployment pipeline
   - Configuration drift detection

2. **Configuration Governance**
   - Audit trail for all changes
   - Approval workflows
   - Role-based access control

3. **Advanced Features**
   - A/B testing configurations
   - Feature flags
   - Gradual rollout

---

## 📝 Current Configuration Flow (BROKEN)

```
Developer writes code
  ↓
Manually loads YAML config (maybe)
  ↓
Manually creates DynamicConfigService (maybe)
  ↓
Manually calls getConfig() (maybe)
  ↓
Manually creates adapters (maybe)
  ↓
Manually passes to Actor (maybe)
  ↓
⚠️ NO VALIDATION, NO DEFAULTS, NO SAFETY
```

## 📝 Desired Configuration Flow (PRODUCTION-READY)

```
Runtime starts
  ↓
Load & validate all config sources
  ↓
Create UnifiedConfigService
  ↓
Actor requested
  ↓
Auto-resolve config (Global → Tenant → Actor)
  ↓
Auto-create adapters (Memory, LLM, State)
  ↓
Inject into Actor
  ↓
Actor ready to use (no manual config needed)
```

---

## 🎓 Examples of What Users Should Write

### Current (BROKEN):
```typescript
// User must manually wire everything 😞
const configService = new DynamicConfigService({ ... })
await configService.initialize()

const config = await configService.getConfig('tenant-1', 'MyActor')

let memoryAdapter
if (config.memory?.enabled) {
  memoryAdapter = await MemoryFactory.createAdapterFromEnv()
}

const actor = new MyActor(context, memoryAdapter)
```

### Desired (PRODUCTION-READY):
```typescript
// User just declares actor class 😊
class MyActor extends Actor {
  // Config automatically applied
  async execute(input) {
    // this.memory already configured
    // this.llm already configured
    // All based on tenant/actor config
  }
}

// Runtime handles everything
const actor = await runtime.createActor('MyActor', { 
  tenantId: 'tenant-1' 
})
```

---

## ✅ Next Steps

1. **Create `CONFIGURATION_IMPLEMENTATION_PLAN.md`** with detailed implementation steps
2. **Prototype UnifiedConfigService** to prove concept
3. **Add validation layer** to catch configuration errors at startup
4. **Integrate with Actor Runtime** for automatic config injection
5. **Update all examples** to show proper configuration usage
6. **Add configuration tests** to prevent regressions

---

## 💬 Conclusion

**The configuration system is NOT production-ready for multi-tenant deployments.**

While individual components exist, they are:
- ❌ Not integrated
- ❌ Not validated
- ❌ Not tenant-aware
- ❌ Not automatic

A major refactoring is required to unify these systems and provide a production-grade configuration experience.

**Estimated Effort:** 2-3 weeks
**Priority:** 🔴 CRITICAL - Blocks multi-tenant production use
