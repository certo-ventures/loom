/**
 * LoomMesh Service Configuration
 * 
 * Configuration interface for the LoomMesh service, which wraps GUN for
 * distributed state synchronization across Loom nodes.
 * 
 * ============================================================================
 * CONFIGURATION ARCHITECTURE (NO YAML FOR APPLICATION CONFIG)
 * ============================================================================
 * 
 * Loom uses ConfigResolver for ALL application configuration:
 * 
 * 1. **Production Configuration Storage:**
 *    - Cosmos DB (via CosmosConfigResolver)
 *    - Supports hierarchical resolution: global → tenant → environment → actor
 *    - Runtime configuration updates (no deployments needed)
 *    - Example: configResolver.get('services/loommesh')
 * 
 * 2. **YAML Usage (BOOTSTRAP ONLY):**
 *    - ONLY for finding infrastructure: Cosmos endpoint, Redis endpoint
 *    - Example bootstrap.yaml: { cosmos: { endpoint: "...", database: "..." } }
 *    - NOT for application config (actor settings, service config, etc.)
 * 
 * 3. **Configuration Loading Pattern:**
 *    ```typescript
 *    // Step 1: Bootstrap - load Cosmos/Redis connection info from YAML/Env
 *    const bootstrap = loadBootstrapConfig() // YAML or env vars
 *    
 *    // Step 2: Initialize ConfigResolver with Cosmos
 *    const cosmos = new CosmosClient({ endpoint: bootstrap.cosmos.endpoint })
 *    const container = cosmos.database('loom').container('config')
 *    const configResolver = new CosmosConfigResolver({ container })
 *    
 *    // Step 3: Load application config from Cosmos
 *    const meshConfig = await loadLoomMeshConfig({
 *      configResolver,
 *      context: { environment: 'production' }
 *    })
 *    ```
 * 
 * 4. **Configuration Storage:**
 *    ```typescript
 *    // Store config in Cosmos (one-time setup or via admin tool)
 *    await saveLoomMeshConfig(
 *      { configResolver },
 *      AzureConfig.createRelayConfig({ storagePath: '/mnt/loom-data' })
 *    )
 *    ```
 * 
 * 5. **Context-Aware Configuration:**
 *    ```typescript
 *    // Different config per environment
 *    await loadLoomMeshConfig({
 *      configResolver,
 *      context: { environment: 'production' }  // vs 'dev', 'staging'
 *    })
 *    
 *    // Different config per tenant
 *    await loadLoomMeshConfig({
 *      configResolver,
 *      context: { tenantId: 'acme-corp', environment: 'production' }
 *    })
 *    ```
 * 
 * ============================================================================
 */

import type { ConfigResolver, ConfigContext } from '../../config-resolver/index.js'

/**
 * Configuration loader options
 */
export interface ConfigLoaderOptions {
  /** ConfigResolver instance for loading configuration */
  configResolver: ConfigResolver
  
  /** Configuration key path (default: 'services/loommesh') */
  configKey?: string
  
  /** Optional context for context-aware config resolution */
  context?: ConfigContext
}

/**
 * Storage adapter configuration
 */
export interface StorageConfig {
  /**
   * Storage adapter type
   * - 'memory': In-memory storage (default, ephemeral)
   * - 'disk': Persistent disk storage
   * - 'azure-files': Azure Files storage (for Azure Container Apps)
   * - 'custom': Custom storage adapter
   */
  type: 'memory' | 'disk' | 'azure-files' | 'custom'
  
  /**
   * File path for disk storage or Azure Files mount point
   * Example: '/mnt/loom-data' for Azure Files
   */
  path?: string
  
  /**
   * Custom storage adapter factory
   */
  adapter?: any
  
  /**
   * Storage options passed to the adapter
   */
  options?: Record<string, any>
}

/**
 * Peer connection configuration
 */
export interface PeerConfig {
  /**
   * List of peer URLs to connect to
   * Format: ws://hostname:port or wss://hostname:port
   * 
   * For Azure Container Apps:
   * - Relay: wss://loommesh-relay.internal.example.com:8765
   * - Direct peers: wss://loom-node-1.internal.example.com:8765
   */
  peers?: string[]
  
  /**
   * Maximum retry attempts for peer connections
   * Default: 5
   */
  maxRetries?: number
  
  /**
   * Retry delay in milliseconds
   * Default: 1000 (1 second)
   */
  retryDelay?: number
  
  /**
   * Connection timeout in milliseconds
   * Default: 10000 (10 seconds)
   */
  timeout?: number
  
  /**
   * Enable peer discovery via DNS
   * Useful for Azure Container Apps service discovery
   * Default: false
   */
  enableDnsDiscovery?: boolean
  
  /**
   * DNS service name for discovery
   * Example: 'loom-node.internal.example.com'
   */
  dnsServiceName?: string
}

/**
 * WebSocket server configuration
 */
export interface WebSocketConfig {
  /**
   * WebSocket server port
   * Default: 8765
   */
  port?: number
  
  /**
   * Host to bind to
   * Default: '0.0.0.0' (all interfaces)
   */
  host?: string
  
  /**
   * Enable WebSocket server
   * Set to false if only acting as a client
   * Default: true
   */
  enabled?: boolean
  
  /**
   * TLS configuration for WSS
   */
  tls?: {
    /**
     * Path to TLS certificate
     */
    certPath?: string
    
    /**
     * Path to TLS private key
     */
    keyPath?: string
  }
}

/**
 * LoomMesh service configuration
 */
export interface LoomMeshConfig {
  /**
   * Service name
   * Default: 'loommesh'
   */
  name?: string
  
  /**
   * Storage configuration
   */
  storage: StorageConfig
  
  /**
   * Peer connection configuration
   */
  peers?: PeerConfig
  
  /**
   * WebSocket server configuration
   */
  webSocket?: WebSocketConfig
  
  /**
   * GUN options passed directly to the GUN instance
   * See: https://gun.eco/docs/API
   */
  gunOptions?: {
    /**
     * Enable localStorage persistence in browser environments
     */
    localStorage?: boolean
    
    /**
     * Enable IndexedDB persistence in browser environments
     */
    indexedDB?: boolean
    
    /**
     * Radix tree configuration
     */
    radix?: boolean
    
    /**
     * Custom GUN options
     */
    [key: string]: any
  }
  
  /**
   * Metrics collection interval in milliseconds
   * Default: 5000 (5 seconds)
   */
  metricsInterval?: number
  
  /**
   * Enable debug logging
   * Default: false
   */
  debug?: boolean
}

/**
 * Azure Container Apps specific configuration helpers
 * 
 * These helpers create configuration objects programmatically.
 * In production, configuration should be stored in ConfigResolver (Cosmos DB).
 * Use these helpers to:
 * 1. Generate initial config during setup
 * 2. Create config for testing/development
 * 3. Bootstrap before ConfigResolver is available
 */
export namespace AzureConfig {
  /**
   * Create LoomMesh configuration for Azure Container Apps relay node
   * This creates a config object. Store it via: saveLoomMeshConfig()
   */
  export function createRelayConfig(options?: {
    storagePath?: string
    port?: number
  }): LoomMeshConfig {
    return {
      name: 'loommesh-relay',
      storage: {
        type: 'azure-files',
        path: options?.storagePath || '/mnt/loom-data'
      },
      webSocket: {
        enabled: true,
        port: options?.port || 8765,
        host: '0.0.0.0'
      },
      peers: {
        // Relay doesn't connect to other peers, it waits for connections
        peers: [],
        maxRetries: 0
      }
    }
  }
  
  /**
   * Create LoomMesh configuration for Azure Container Apps Loom node
   */
  export function createNodeConfig(options: {
    relayUrl: string
    storagePath?: string
    port?: number
    enableDnsDiscovery?: boolean
    dnsServiceName?: string
  }): LoomMeshConfig {
    return {
      name: 'loommesh',
      storage: {
        type: 'azure-files',
        path: options.storagePath || '/mnt/loom-data'
      },
      webSocket: {
        enabled: true,
        port: options.port || 8765,
        host: '0.0.0.0'
      },
      peers: {
        peers: [options.relayUrl],
        maxRetries: 5,
        retryDelay: 1000,
        timeout: 10000,
        enableDnsDiscovery: options.enableDnsDiscovery,
        dnsServiceName: options.dnsServiceName
      }
    }
  }
  
  /**
   * Create LoomMesh configuration for local development
   */
  export function createLocalConfig(options?: {
    port?: number
    storagePath?: string
  }): LoomMeshConfig {
    return {
      name: 'loommesh-local',
      storage: {
        type: 'disk',
        path: options?.storagePath || './data/loommesh'
      },
      webSocket: {
        enabled: true,
        port: options?.port || 8765,
        host: 'localhost'
      },
      peers: {
        peers: [],
        maxRetries: 3
      },
      debug: true
    }
  }
}

/**
 * Validate LoomMesh configuration
 */
export function validateConfig(config: LoomMeshConfig): void {
  // Validate storage
  if (!config.storage) {
    throw new Error('Storage configuration is required')
  }
  
  if (!['memory', 'disk', 'azure-files', 'custom'].includes(config.storage.type)) {
    throw new Error(`Invalid storage type: ${config.storage.type}`)
  }
  
  if ((config.storage.type === 'disk' || config.storage.type === 'azure-files') && !config.storage.path) {
    throw new Error(`Storage path is required for ${config.storage.type} storage`)
  }
  
  if (config.storage.type === 'custom' && !config.storage.adapter) {
    throw new Error('Custom storage adapter is required for custom storage type')
  }
  
  // Validate WebSocket
  if (config.webSocket?.enabled && config.webSocket.port) {
    if (config.webSocket.port < 1 || config.webSocket.port > 65535) {
      throw new Error(`Invalid WebSocket port: ${config.webSocket.port}`)
    }
  }
  
  // Validate peers
  if (config.peers?.peers) {
    for (const peer of config.peers.peers) {
      if (!peer.startsWith('ws://') && !peer.startsWith('wss://')) {
        throw new Error(`Invalid peer URL: ${peer}. Must start with ws:// or wss://`)
      }
    }
  }
  
  // Validate metrics interval
  if (config.metricsInterval !== undefined && config.metricsInterval < 1000) {
    throw new Error('Metrics interval must be at least 1000ms')
  }
}

/**
 * Apply default configuration values
 */
export function applyDefaults(config: LoomMeshConfig): Required<LoomMeshConfig> {
  return {
    name: config.name || 'loommesh',
    storage: config.storage,
    peers: {
      peers: config.peers?.peers || [],
      maxRetries: config.peers?.maxRetries ?? 5,
      retryDelay: config.peers?.retryDelay ?? 1000,
      timeout: config.peers?.timeout ?? 10000,
      enableDnsDiscovery: config.peers?.enableDnsDiscovery ?? false,
      dnsServiceName: config.peers?.dnsServiceName
    },
    webSocket: {
      port: config.webSocket?.port ?? 8765,
      host: config.webSocket?.host ?? '0.0.0.0',
      enabled: config.webSocket?.enabled ?? true,
      tls: config.webSocket?.tls
    },
    gunOptions: config.gunOptions || {},
    metricsInterval: config.metricsInterval ?? 5000,
    debug: config.debug ?? false
  }
}

/**
 * Load LoomMesh configuration from ConfigResolver
 * 
 * @example
 * ```typescript
 * // Load from Cosmos DB (via ConfigResolver)
 * const config = await loadLoomMeshConfig({
 *   configResolver: cosmosResolver,
 *   configKey: 'services/loommesh',
 *   context: { environment: 'production' }
 * })
 * ```
 */
export async function loadLoomMeshConfig(
  options: ConfigLoaderOptions
): Promise<LoomMeshConfig> {
  const configKey = options.configKey || 'services/loommesh'
  
  let rawConfig: any
  
  if (options.context) {
    // Context-aware resolution (e.g., per-tenant, per-environment)
    rawConfig = await options.configResolver.getWithContext(configKey, options.context)
  } else {
    // Global config
    rawConfig = await options.configResolver.get(configKey)
  }
  
  if (!rawConfig) {
    throw new Error(`LoomMesh configuration not found at key: ${configKey}`)
  }
  
  // Validate the loaded config
  validateConfig(rawConfig as LoomMeshConfig)
  
  return rawConfig as LoomMeshConfig
}

/**
 * Save LoomMesh configuration to ConfigResolver
 * 
 * @example
 * ```typescript
 * await saveLoomMeshConfig(
 *   { configResolver: cosmosResolver },
 *   config
 * )
 * ```
 */
export async function saveLoomMeshConfig(
  options: ConfigLoaderOptions,
  config: LoomMeshConfig
): Promise<void> {
  const configKey = options.configKey || 'services/loommesh'
  
  // Validate before saving
  validateConfig(config)
  
  await options.configResolver.set(configKey, config)
}

