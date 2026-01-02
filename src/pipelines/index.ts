/**
 * Pipeline/Workflow System Exports
 * 
 * Use this for building workflow orchestration systems
 */

// Core pipeline definitions
export * from './pipeline-dsl'
export * from './pipeline-orchestrator'
export * from './pipeline-actor-worker'
export { RedisPipelineStateStore } from './pipeline-state-store'

// Pluggable executors
export * from './stage-executor'
export * from './builtin-executors'
export * from './human-approval-executor'

// Transactional outbox pattern
export * from './outbox'

// Resilience patterns
export * from './circuit-breaker'
export * from './saga-coordinator'
