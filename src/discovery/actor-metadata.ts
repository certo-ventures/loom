/**
 * Production-ready actor metadata structure for discovery, governance, and AI orchestration
 */

/**
 * JSON Schema type for input/output validation
 */
export interface JSONSchema {
  $schema?: string
  type: string
  properties?: Record<string, any>
  required?: string[]
  additionalProperties?: boolean
  definitions?: Record<string, any>
  [key: string]: any
}

/**
 * Actor security policies and access control
 */
export interface ActorPolicies {
  /** Required authentication level */
  authentication?: 'none' | 'basic' | 'jwt' | 'mtls' | 'custom'
  
  /** Authorization requirements */
  authorization?: {
    roles?: string[]
    scopes?: string[]
    customPolicies?: string[]
  }
  
  /** Rate limiting policy */
  rateLimit?: {
    requestsPerMinute?: number
    requestsPerHour?: number
    burstSize?: number
  }
  
  /** Data governance */
  dataClassification?: 'public' | 'internal' | 'confidential' | 'restricted'
  piiHandling?: boolean
  dataRetention?: string  // e.g., "30d", "1y"
  
  /** Network policies */
  allowedNetworks?: string[]  // CIDR ranges
  egressAllowed?: boolean
}

/**
 * Required permissions for actor execution
 */
export interface ActorPermissions {
  /** Required system permissions */
  system?: string[]  // e.g., ['fs:read', 'network:http', 'env:read']
  
  /** Required cloud/service permissions */
  cloud?: {
    provider: 'aws' | 'azure' | 'gcp' | 'cloudflare'
    permissions: string[]  // e.g., ['s3:GetObject', 'lambda:InvokeFunction']
  }[]
  
  /** Required database/storage permissions */
  storage?: {
    type: 'redis' | 'postgres' | 'mongodb' | 's3' | 'blob'
    operations: ('read' | 'write' | 'delete' | 'admin')[]
  }[]
  
  /** Required API access */
  apis?: {
    service: string
    scopes: string[]
  }[]
}

/**
 * AI-specific context and capabilities
 */
export interface AIContext {
  /** Human-readable description of what the actor does */
  purpose: string
  
  /** When and why to use this actor */
  usageGuidelines: string
  
  /** Available tools/capabilities this actor provides */
  capabilities: {
    name: string
    description: string
    parameters?: JSONSchema
    returns?: JSONSchema
  }[]
  
  /** Suggested prompts or usage patterns */
  examples?: {
    scenario: string
    input: any
    expectedOutput?: any
    explanation: string
  }[]
  
  /** Constraints and limitations */
  limitations?: string[]
  
  /** Best practices for using this actor */
  bestPractices?: string[]
  
  /** Related actors that work well together */
  relatedActors?: string[]
  
  /** Cost estimation (for AI orchestration) */
  estimatedCost?: {
    unit: 'tokens' | 'compute' | 'api-calls'
    approximate: number
  }
}

/**
 * Actor dependencies
 */
export interface ActorDependency {
  type: 'actor' | 'service' | 'package' | 'wasm-module'
  name: string
  version?: string
  optional?: boolean
  purpose?: string
}

/**
 * Configuration schema for actor
 */
export interface ConfigurationSchema {
  /** Environment variables required */
  environmentVariables?: {
    name: string
    description: string
    required: boolean
    default?: string
    secret?: boolean
    validation?: string  // regex or JSON schema
  }[]
  
  /** Configuration file schema */
  configFile?: JSONSchema
  
  /** Runtime configuration */
  runtime?: {
    memoryLimit?: string  // e.g., "512MB"
    timeout?: number      // milliseconds
    concurrency?: number
  }
}

/**
 * Performance characteristics
 */
export interface PerformanceCharacteristics {
  /** Expected latency */
  latency?: {
    p50?: number
    p95?: number
    p99?: number
    unit: 'ms' | 's'
  }
  
  /** Throughput capacity */
  throughput?: {
    requestsPerSecond?: number
    maxConcurrency?: number
  }
  
  /** Resource requirements */
  resources?: {
    cpu?: string       // e.g., "1 core", "500m"
    memory?: string    // e.g., "512MB", "2GB"
    storage?: string   // e.g., "10GB"
    gpu?: boolean
  }
  
  /** Cost estimation */
  costPerInvocation?: {
    amount: number
    currency: string
  }
}

/**
 * Deployment information
 */
export interface DeploymentInfo {
  /** Where this actor can run */
  targets?: ('local' | 'edge' | 'cloud' | 'hybrid')[]
  
  /** Minimum platform requirements */
  requirements?: {
    nodeVersion?: string
    wasmRuntime?: string
    platform?: ('linux' | 'windows' | 'macos' | 'any')[]
  }
  
  /** Health check configuration */
  healthCheck?: {
    endpoint?: string
    interval?: number  // seconds
    timeout?: number   // milliseconds
    unhealthyThreshold?: number
  }
  
  /** Scaling configuration */
  scaling?: {
    min?: number
    max?: number
    metric?: 'cpu' | 'memory' | 'queue-depth' | 'latency'
    target?: number
  }
}

/**
 * Documentation links
 */
export interface DocumentationLinks {
  readme?: string
  apiDocs?: string
  examples?: string
  changelog?: string
  troubleshooting?: string
  external?: {
    title: string
    url: string
  }[]
}

/**
 * Actor usage example
 */
export interface ActorExample {
  title: string
  description: string
  code: string
  language?: 'typescript' | 'javascript' | 'yaml' | 'json'
  tags?: string[]
}

/**
 * Lifecycle and versioning metadata
 */
export interface LifecycleMetadata {
  /** Actor lifecycle stage */
  stage: 'experimental' | 'beta' | 'stable' | 'deprecated' | 'retired'
  
  /** Deprecation information */
  deprecated?: boolean
  deprecationDate?: string  // ISO 8601
  replacedBy?: string       // actorType of replacement
  retirementDate?: string   // ISO 8601
  deprecationReason?: string
  migrationGuide?: string   // URL to migration guide
  
  /** Version information */
  changelog?: string
  breakingChanges?: string[]
  backwardCompatible?: boolean
  
  /** Support information */
  supportEndsAt?: string    // ISO 8601
  securitySupport?: boolean
  
  /** Maturity indicators */
  stability?: 'unstable' | 'stable' | 'locked'
  productionReady?: boolean
  
  /** Timestamps */
  createdAt?: string   // ISO 8601
  updatedAt?: string   // ISO 8601
  releasedAt?: string  // ISO 8601
}

/**
 * Observability and monitoring
 */
export interface ObservabilityConfig {
  /** Metrics to emit */
  metrics?: {
    name: string
    type: 'counter' | 'gauge' | 'histogram'
    description: string
    labels?: string[]
  }[]
  
  /** Tracing configuration */
  tracing?: {
    enabled: boolean
    samplingRate?: number  // 0.0 to 1.0
    propagationFormat?: 'w3c' | 'b3' | 'jaeger'
  }
  
  /** Logging configuration */
  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error'
    structuredLogging?: boolean
    piiRedaction?: boolean
  }
}

/**
 * Complete actor metadata structure
 */
export interface ActorMetadata {
  // ===== Core Identity (1-6) =====
  
  /** Human-readable name */
  name: string
  
  /** Detailed description of the actor */
  description: string
  
  /** Actor implementation type */
  type: 'javascript' | 'wasm' | 'native' | 'remote' | 'container'
  
  /** Reference for dynamic loading (file path, URL, package name, container image) */
  reference: string
  
  /** Semantic version */
  version: string
  
  /** Actor author */
  author: string
  
  /** Team or organization owner */
  owner?: string
  
  /** Email contact for actor issues */
  contact?: string
  
  /** Repository URL */
  repository?: string
  
  /** License (SPDX identifier) */
  license?: string
  
  // ===== Security & Governance (7) =====
  
  /** Security policies and access control */
  policies?: ActorPolicies
  
  /** Required permissions for execution */
  permissions?: ActorPermissions
  
  // ===== AI Context (8) =====
  
  /** AI-specific context for orchestration */
  aiContext?: AIContext
  
  // ===== Data Contracts (9-10) =====
  
  /** Input message schema (JSON Schema) */
  inputSchema?: JSONSchema
  
  /** Output message schema (JSON Schema) */
  outputSchema?: JSONSchema
  
  // ===== Discovery & Organization =====
  
  /** Tags for filtering and discovery */
  tags?: string[]
  
  /** Category or domain */
  category?: 'data-processing' | 'ai-agent' | 'integration' | 'workflow' | 'transformation' | 'validation' | 'enrichment' | 'custom'
  
  // ===== Dependencies & Configuration =====
  
  /** Actor dependencies */
  dependencies?: ActorDependency[]
  
  /** Configuration schema */
  configuration?: ConfigurationSchema
  
  // ===== Performance & SLA =====
  
  /** Performance characteristics */
  performance?: PerformanceCharacteristics
  
  // ===== Deployment =====
  
  /** Deployment information */
  deployment?: DeploymentInfo
  
  // ===== Documentation =====
  
  /** Documentation links */
  documentation?: DocumentationLinks
  
  /** Usage examples */
  examples?: ActorExample[]
  
  // ===== Lifecycle =====
  
  /** Lifecycle and versioning */
  lifecycle?: LifecycleMetadata
  
  // ===== Observability =====
  
  /** Observability configuration */
  observability?: ObservabilityConfig
  
  // ===== Quality Metrics =====
  
  /** Code quality metrics */
  quality?: {
    testCoverage?: number     // 0-100
    codeComplexity?: number   // Cyclomatic complexity
    maintainabilityIndex?: number  // 0-100
    technicalDebt?: string    // e.g., "2h", "1d"
    lastAudit?: string        // ISO 8601
    auditStatus?: 'passed' | 'failed' | 'pending'
  }
  
  /** Security scan results */
  security?: {
    vulnerabilities?: {
      critical?: number
      high?: number
      medium?: number
      low?: number
    }
    lastScan?: string         // ISO 8601
    scanTool?: string
    compliant?: boolean
    certifications?: string[] // e.g., ["SOC2", "HIPAA"]
  }
  
  // ===== Business Metadata =====
  
  /** Business context */
  business?: {
    costCenter?: string
    budgetCode?: string
    businessOwner?: string
    businessUnit?: string
    serviceLevel?: 'critical' | 'high' | 'medium' | 'low'
    impactArea?: string[]
  }
  
  /** Usage constraints */
  constraints?: {
    maxConcurrentUsers?: number
    maxDataSize?: string      // e.g., "100MB"
    geographicRestrictions?: string[]
    regulatoryRequirements?: string[]
    approvalRequired?: boolean
  }
  
  // ===== Integration Metadata =====
  
  /** Integration points */
  integrations?: {
    upstream?: string[]       // Actors that call this
    downstream?: string[]     // Actors this calls
    eventEmits?: string[]     // Events this actor emits
    eventConsumes?: string[]  // Events this actor consumes
    apiEndpoints?: string[]   // External APIs used
  }
  
  /** Testing metadata */
  testing?: {
    unitTestsPass?: boolean
    integrationTestsPass?: boolean
    e2eTestsPass?: boolean
    lastTestRun?: string      // ISO 8601
    testFramework?: string
    mockDependencies?: string[]
  }
  
  // ===== Custom Extensions =====
  
  /** Custom metadata extensions */
  custom?: Record<string, any>
}

/**
 * Helper to validate actor metadata
 */
export function validateActorMetadata(metadata: Partial<ActorMetadata>): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  
  // Required fields
  if (!metadata.name) errors.push('name is required')
  if (!metadata.description) errors.push('description is required')
  if (!metadata.type) errors.push('type is required')
  if (!metadata.reference) errors.push('reference is required')
  if (!metadata.version) errors.push('version is required')
  if (!metadata.author) errors.push('author is required')
  
  // Version format validation (basic semver)
  if (metadata.version && !/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(metadata.version)) {
    errors.push('version must be valid semver (e.g., 1.0.0)')
  }
  
  // Type validation
  const validTypes = ['javascript', 'wasm', 'native', 'remote', 'container']
  if (metadata.type && !validTypes.includes(metadata.type)) {
    errors.push(`type must be one of: ${validTypes.join(', ')}`)
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Helper to create minimal actor metadata
 */
export function createMinimalMetadata(
  name: string,
  description: string,
  type: ActorMetadata['type'],
  reference: string,
  author: string,
  version: string = '1.0.0'
): ActorMetadata {
  return {
    name,
    description,
    type,
    reference,
    version,
    author,
    tags: [],
    lifecycle: {
      stage: 'experimental',
      createdAt: new Date().toISOString()
    }
  }
}
