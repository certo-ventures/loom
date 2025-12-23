/**
 * Loom Server Types
 */

import type { JSONSchemaType } from 'ajv';

/**
 * Actor metadata stored in registry
 */
export interface ActorMetadata {
  actorId: string;
  version: string;
  displayName: string;
  description?: string;
  
  // Validation schemas (JSON Schema)
  inputSchema: Record<string, any>;
  outputSchema: Record<string, any>;
  
  // WASM module reference
  wasmModule: string;  // URI: cosmosdb://, s3://, http://
  
  // Optional policy
  policy?: string;  // URI: opa://policies/...
  
  // Lifecycle
  ttl?: number;  // Seconds to keep alive when idle (default: 300)
  maxExecutionTime?: number;  // Max seconds per execution (default: 60)
  
  // Metadata
  tags?: string[];
  author?: string;
  createdAt: string;
  updatedAt: string;
  
  // Multi-tenancy
  tenantId?: string;
  public?: boolean;
}

/**
 * Execution request
 */
export interface ExecuteRequest {
  actorType: string;
  version?: string;  // If omitted, use latest
  input: any;  // Validated against actor's inputSchema
  
  // Callback options
  callbackUrl?: string;  // ws://, queue://, http://
  correlationId?: string;  // For tracing
  
  // Execution options
  timeout?: number;  // Override actor's maxExecutionTime
  priority?: number;  // Queue priority (0-10)
}

/**
 * Execution response
 */
export interface ExecuteResponse {
  executionId: string;
  actorId: string;
  status: 'queued' | 'executing' | 'completed' | 'failed';
  timestamp: string;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  executionId: string;
  actorId: string;
  status: 'completed' | 'failed';
  result?: any;  // Validated against actor's outputSchema
  error?: {
    message: string;
    code: string;
    details?: any;
  };
  duration: number;  // Milliseconds
  timestamp: string;
}

/**
 * Actor registry filter
 */
export interface ActorFilter {
  tenantId?: string;
  tags?: string[];
  public?: boolean;
  search?: string;  // Search in displayName, description
}

/**
 * Health check result
 */
export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  components: {
    redis: ComponentHealth;
    cosmos: ComponentHealth;
    wasmCache: ComponentHealth;
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  latency?: number;  // Milliseconds
}

/**
 * Server configuration
 */
export interface ServerConfig {
  port: number;
  host: string;
  
  // Redis
  redis: {
    url: string;
  };
  
  // CosmosDB (optional, falls back to in-memory)
  cosmos?: {
    endpoint: string;
    key: string;
    database: string;
  };
  
  // Security
  jwt: {
    secret: string;
    expiresIn?: string;
  };
  
  // Rate limiting
  rateLimit: {
    max: number;
    timeWindow: string;  // e.g., '1 minute'
  };
  
  // Worker pool
  workers: {
    poolSize: number;
    maxQueueSize: number;
  };
  
  // WASM cache
  wasmCache: {
    maxSize: number;  // Bytes
    maxAge: number;   // Seconds
  };
  
  // Logging
  log: {
    level: 'debug' | 'info' | 'warn' | 'error';
    pretty?: boolean;
  };
}
