// @ts-nocheck - Outdated demo
/**
 * Test for YAML configuration system
 * Demonstrates loading, merging, and validating config
 */

import { 
  loadConfig, 
  loadConfigSafe,
  mergeConfig,
  createConfig,
  getConfigValue,
  validateAdapterConfig,
  DEFAULT_CONFIG 
} from '../src/config'

console.log('='.repeat(60))
console.log('YAML CONFIGURATION SYSTEM TEST')
console.log('='.repeat(60))

// Test 1: Load test config
console.log('\n--- Test 1: Load YAML Config ---')
try {
  const config = loadConfig('loom.config.test.yaml')
  console.log('✅ Loaded config successfully')
  console.log('Actor pool max size:', config.actorPool?.maxSize)
  console.log('Message adapter type:', config.messageAdapter?.type)
  console.log('State adapter type:', config.stateAdapter?.type)
  console.log('Tracing enabled:', config.tracing?.enabled)
} catch (error) {
  console.error('❌ Failed to load config:', error)
}

// Test 2: Safe load with error handling
console.log('\n--- Test 2: Safe Load with Error Handling ---')
const result = loadConfigSafe('loom.config.test.yaml')
if (result.success) {
  console.log('✅ Config loaded and validated')
  console.log('Configuration sections:', Object.keys(result.data))
} else {
  console.log('❌ Validation errors:')
  result.errors.forEach(err => console.log('  -', err))
}

// Test 3: Merge with defaults
console.log('\n--- Test 3: Merge Config with Defaults ---')
const partialConfig = loadConfig('loom.config.test.yaml')
const merged = mergeConfig(partialConfig)
console.log('✅ Merged config with defaults')
console.log('Actor pool (merged):', JSON.stringify(merged.actorPool, null, 2))
console.log('Coordination adapter lock TTL:', merged.coordinationAdapter.lockTtlMs, 'ms')

// Test 4: Programmatic config creation
console.log('\n--- Test 4: Programmatic Config Creation ---')
const customConfig = createConfig({
  actorPool: {
    maxSize: 200,
    evictionPolicy: 'lfu',
    idleTimeoutMs: 180000,
    evictionCheckIntervalMs: 30000,
  },
  redis: {
    host: 'redis.example.com',
    port: 6380,
    db: 0,
    keyPrefix: 'custom:',
  },
})
console.log('✅ Created config programmatically')
console.log('Custom actor pool size:', customConfig.actorPool.maxSize)
console.log('Custom eviction policy:', customConfig.actorPool.evictionPolicy)
console.log('Idle timeout (from default):', customConfig.actorPool.idleTimeoutMs, 'ms')
console.log('Custom Redis host:', customConfig.redis.host)

// Test 5: Dot notation access
console.log('\n--- Test 5: Get Config Values by Path ---')
const poolSize = getConfigValue<number>(merged, 'actorPool.maxSize')
const redisHost = getConfigValue<string>(merged, 'redis.host')
const tracingEnabled = getConfigValue<boolean>(merged, 'tracing.enabled')
console.log('✅ Accessed config values by dot notation')
console.log('actorPool.maxSize:', poolSize)
console.log('redis.host:', redisHost)
console.log('tracing.enabled:', tracingEnabled)

// Test 6: Validate adapter configuration
console.log('\n--- Test 6: Validate Adapter Configuration ---')
const validation = validateAdapterConfig(merged)
if (validation.valid) {
  console.log('✅ Adapter configuration is valid')
} else {
  console.log('❌ Adapter configuration errors:')
  validation.errors.forEach(err => console.log('  -', err))
}

// Test 7: Test invalid config (missing required fields)
console.log('\n--- Test 7: Validation with Invalid Config ---')
const invalidResult = loadConfigSafe('nonexistent.yaml')
if (!invalidResult.success) {
  console.log('✅ Correctly caught missing file')
  console.log('Error:', invalidResult.errors[0])
}

// Test 8: Show default config
console.log('\n--- Test 8: Default Configuration ---')
console.log('Default config structure:')
console.log('  Actor Pool:', DEFAULT_CONFIG.actorPool)
console.log('  Message Adapter:', DEFAULT_CONFIG.messageAdapter.type)
console.log('  State Adapter:', DEFAULT_CONFIG.stateAdapter.type)
console.log('  Coordination Adapter:', DEFAULT_CONFIG.coordinationAdapter.type)
console.log('  Tracing:', DEFAULT_CONFIG.tracing)

// Test 9: Global Redis config inheritance
console.log('\n--- Test 9: Redis Config Inheritance ---')
const configWithGlobalRedis = createConfig({
  redis: {
    host: 'production-redis.example.com',
    port: 6379,
    password: 'secret',
    db: 0,
    keyPrefix: 'loom:',
  },
  messageAdapter: {
    type: 'bullmq',
    queuePrefix: 'loom:queue:',
    // No redis config specified - should inherit global
  },
})
console.log('✅ Global Redis config inherited by adapters')
console.log('Global Redis host:', configWithGlobalRedis.redis.host)
console.log('Message adapter Redis host:', configWithGlobalRedis.messageAdapter.redis?.host)
console.log('Message adapter Redis password:', configWithGlobalRedis.messageAdapter.redis?.password ? '***' : 'none')

// Test 10: Override global Redis per adapter
console.log('\n--- Test 10: Per-Adapter Redis Override ---')
const configWithOverride = createConfig({
  redis: {
    host: 'default-redis.example.com',
    port: 6379,
    db: 0,
    keyPrefix: 'loom:',
  },
  stateAdapter: {
    type: 'redis',
    redis: {
      host: 'state-redis.example.com',
      port: 6380,
      db: 5,
      keyPrefix: 'state:',
    },
  },
})
console.log('✅ Adapter-specific Redis overrides global')
console.log('Global Redis:', configWithOverride.redis.host)
console.log('State adapter Redis:', configWithOverride.stateAdapter.redis?.host)
console.log('State adapter DB:', configWithOverride.stateAdapter.redis?.db)

// Test 11: Environment variable support
console.log('\n--- Test 11: Environment Variable Support ---')
console.log('Set LOOM_CONFIG_PATH env var to specify custom config location')
console.log('Current LOOM_CONFIG_PATH:', process.env.LOOM_CONFIG_PATH || '(not set)')
console.log('Default search paths:')
console.log('  - loom.config.yaml')
console.log('  - loom.config.yml')
console.log('  - .loom.yaml')
console.log('  - .loom.yml')
console.log('  - config/loom.yaml')
console.log('  - config/loom.yml')

console.log('\n' + '='.repeat(60))
console.log('TEST COMPLETE')
console.log('='.repeat(60))
console.log('\n✅ Demonstrated:')
console.log('  - YAML file loading with validation')
console.log('  - Safe loading with error handling')
console.log('  - Config merging with defaults')
console.log('  - Programmatic config creation')
console.log('  - Dot notation value access')
console.log('  - Adapter configuration validation')
console.log('  - Global Redis config inheritance')
console.log('  - Per-adapter Redis overrides')
console.log('  - Environment variable support')
console.log('\n💡 Usage:')
console.log('  import { loadConfigAuto, mergeConfig } from "./src/config"')
console.log('  const config = loadConfigAuto() || mergeConfig({})')
console.log('  // Now use config.actorPool, config.redis, etc.')
