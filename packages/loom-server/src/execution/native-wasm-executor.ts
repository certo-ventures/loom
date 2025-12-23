import type { ActorMetadata, ExecuteRequest, ExecutionResult } from '../types';
import type { DataStore } from '../registry/data-store';
import type { MetricsCollector } from '../observability/metrics-collector';
import Ajv from 'ajv';
import { v4 as uuidv4 } from 'uuid';

const ajv = new Ajv();

export class NativeWasmExecutor {
  private moduleCache = new Map<string, WebAssembly.Module>();
  private instanceCache = new Map<string, WebAssembly.Instance>();

  constructor(
    private dataStore: DataStore,
    private metricsCollector: MetricsCollector
  ) {}

  async execute(request: ExecuteRequest): Promise<ExecutionResult> {
    const executionId = uuidv4();
    const startTime = Date.now();

    try {
      const metadata = await this.dataStore.getActor(request.actorType);
      if (!metadata) {
        throw new Error(`Actor not found: ${request.actorType}`);
      }

      const wasmBuffer = await this.dataStore.getWasmModule(request.actorType);
      if (!wasmBuffer) {
        throw new Error(`WASM module not found: ${request.actorType}`);
      }

      const instance = await this.getOrCreateInstance(request.actorType, wasmBuffer);
      const executeFunc = instance.exports.execute as CallableFunction;
      if (!executeFunc) {
        throw new Error('No execute function');
      }

      const result = executeFunc();
      
      // Just return whatever we get
      const output = { result: result };

      const duration = Date.now() - startTime;
      this.metricsCollector.recordExecution({
        executionId,
        actorId: request.actorType,
        duration,
        status: 'success',
        timestamp: new Date(),
      });

      return {
        executionId,
        actorId: request.actorType,
        output,
        status: 'success',
        duration,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.metricsCollector.recordExecution({
        executionId,
        actorId: request.actorType,
        duration,
        status: 'failed',
        error: error.message,
        timestamp: new Date(),
      });

      return {
        executionId,
        actorId: request.actorType,
        status: 'failed',
        error: {
          message: error.message,
          code: 'EXECUTION_ERROR',
          details: error.stack,
        },
        duration,
        timestamp: new Date().toISOString(),
      };
    }
  }

  private async getOrCreateInstance(
    actorType: string,
    wasmBuffer: Buffer
  ): Promise<WebAssembly.Instance> {
    if (this.instanceCache.has(actorType)) {
      return this.instanceCache.get(actorType)!;
    }

    let module: WebAssembly.Module;
    if (this.moduleCache.has(actorType)) {
      module = this.moduleCache.get(actorType)!;
    } else {
      module = await WebAssembly.compile(wasmBuffer);
      this.moduleCache.set(actorType, module);
    }

    const memory = new WebAssembly.Memory({ initial: 1 });
    const imports = {
      env: {
        memory,
        abort: () => {},
        seed: () => Date.now(),
      },
    };

    const instance = await WebAssembly.instantiate(module, imports);
    this.instanceCache.set(actorType, instance);
    return instance;
  }

  clearCache(actorType?: string) {
    if (actorType) {
      this.moduleCache.delete(actorType);
      this.instanceCache.delete(actorType);
    } else {
      this.moduleCache.clear();
      this.instanceCache.clear();
    }
  }
}
