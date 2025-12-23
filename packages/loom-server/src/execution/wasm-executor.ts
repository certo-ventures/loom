/**
 * WASM Execution Engine - Extism-based actor runtime
 */

import { createPlugin, type Plugin } from '@extism/extism';
import type { DataStore } from '../registry/data-store';
import type { ActorMetadata, ExecuteRequest, ExecutionResult } from '../types';
import Ajv from 'ajv';
import { LRUCache } from 'lru-cache';
import { v4 as uuidv4 } from 'uuid';

const ajv = new Ajv({ allErrors: true });

export interface WasmExecutorConfig {
  maxCacheSize: number;  // Max WASM modules in cache
  maxMemoryMB: number;   // Max memory per WASM instance
  timeoutMs: number;     // Default timeout
}

export class WasmExecutor {
  private moduleCache: LRUCache<string, Buffer>;
  private pluginCache: LRUCache<string, Plugin>;
  private config: WasmExecutorConfig;

  constructor(
    private dataStore: DataStore,
    config?: Partial<WasmExecutorConfig>
  ) {
    this.config = {
      maxCacheSize: config?.maxCacheSize || 100,
      maxMemoryMB: config?.maxMemoryMB || 256,
      timeoutMs: config?.timeoutMs || 60000,
    };

    this.moduleCache = new LRUCache({
      max: this.config.maxCacheSize,
      ttl: 1000 * 60 * 10, // 10 minutes
    });

    this.pluginCache = new LRUCache({
      max: this.config.maxCacheSize,
      ttl: 1000 * 60 * 5, // 5 minutes
      dispose: (plugin: Plugin) => plugin.close(),
    });
  }

  /**
   * Set metrics collector (optional)
   */
  setMetricsCollector(collector: any): void {
    (this as any).metricsCollector = collector;
  }

  /**
   * Execute an actor
   */
  async execute(request: ExecuteRequest): Promise<ExecutionResult> {
    const executionId = uuidv4();
    const startTime = Date.now();

    // Record execution start
    const metricsCollector = (this as any).metricsCollector;
    if (metricsCollector) {
      metricsCollector.recordExecutionStart(executionId, request.actorType, {
        actorVersion: request.version,
      });
    }

    try {
      // Get actor metadata
      const metadata = await this.dataStore.getActorMetadata(
        request.actorType,
        request.version
      );

      if (!metadata) {
        throw new Error(`Actor not found: ${request.actorType}`);
      }

      // Validate input against schema
      const validateInput = ajv.compile(metadata.inputSchema);
      if (!validateInput(request.input)) {
        throw new Error(
          `Input validation failed: ${JSON.stringify(validateInput.errors)}`
        );
      }

      // Get or load WASM plugin
      const plugin = await this.getPlugin(metadata);

      // Execute with timeout
      const timeout = request.timeout || metadata.maxExecutionTime || this.config.timeoutMs;
      const result = await this.executeWithTimeout(plugin, request.input, timeout);

      // Validate output against schema
      const validateOutput = ajv.compile(metadata.outputSchema);
      if (!validateOutput(result)) {
        throw new Error(
          `Output validation failed: ${JSON.stringify(validateOutput.errors)}`
        );
      }

      const duration = Date.now() - startTime;
      
      // Record success
      if (metricsCollector) {
        metricsCollector.recordExecutionComplete(executionId, duration, true);
      }

      return {
        executionId,
        actorId: metadata.actorId,
        status: 'completed',
        result,
        duration,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      // Record failure
      if (metricsCollector) {
        metricsCollector.recordExecutionComplete(executionId, duration, false, error.message);
      }

      return {
        executionId,
        actorId: request.actorType,
        status: 'failed',
        error: {
          message: error.message || 'Unknown error',
          code: error.code || 'EXECUTION_ERROR',
          details: error.stack,
        },
        duration,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Get or create Extism plugin
   */
  private async getPlugin(metadata: ActorMetadata): Promise<Plugin> {
    const cacheKey = `${metadata.actorId}:${metadata.version}`;

    // Check cache
    let plugin = this.pluginCache.get(cacheKey);
    if (plugin) {
      return plugin;
    }

    // Get WASM module
    let wasmModule = this.moduleCache.get(cacheKey);
    if (!wasmModule) {
      wasmModule = await this.dataStore.getWasmModule(
        metadata.actorId,
        metadata.version
      );
      if (!wasmModule) {
        throw new Error(`WASM module not found: ${cacheKey}`);
      }
      this.moduleCache.set(cacheKey, wasmModule);
    }

    // Create Extism plugin with manifest format
    // Extism expects { wasm: [{ data: Buffer }] } format
    const manifest = {
      wasm: [{ data: wasmModule }],
      memory: {
        max: (this.config.maxMemoryMB * 1024 * 1024), // Max bytes (not pages)
      },
      config: {
        actorId: metadata.actorId,
        version: metadata.version,
      },
    };

    // Create plugin - Extism provides all necessary host functions for AssemblyScript PDK
    plugin = await createPlugin(manifest, {
      useWasi: true,
      allowedPaths: {}, // Sandbox: no filesystem access
    });

    this.pluginCache.set(cacheKey, plugin!);
    return plugin!;
  }

  /**
   * Execute plugin with timeout
   */
  private async executeWithTimeout(
    plugin: Plugin,
    input: any,
    timeoutMs: number
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      plugin
        .call('execute', JSON.stringify(input))
        .then((output: any) => {
          clearTimeout(timer);
          const result = output?.text?.() || output?.toString() || '{}';
          resolve(JSON.parse(result));
        })
        .catch((error: any) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Clear caches
   */
  clearCaches() {
    this.moduleCache.clear();
    this.pluginCache.clear();
  }
}
