/**
 * Decision Trace System
 * 
 * Captures not just WHAT happened, but WHY it happened.
 * This is the missing layer from traditional systems of record.
 * 
 * Inspired by: Foundation Capital's Context Graph article
 * Core insight: Decision traces become searchable precedent
 * 
 * Phase 3: Policy Evolution - tracks policy changes and effectiveness
 */

// Re-export policy types for convenience
export type {
  Policy,
  PolicyEffectiveness,
  PolicyABTest,
  PolicyABTestResults,
  PolicySuggestion,
  PolicyImpactAnalysis
} from '../memory/graph/policy-memory';

/**
 * Decision Trace - The "why" behind an action
 * 
 * Captures the full context, reasoning, and outcome of a decision.
 * Can be enriched with LLM analysis for deeper insights.
 */
export interface DecisionTrace {
  // Identity
  decisionId: string
  timestamp: number
  actorId: string
  actorType: string
  
  // Classification
  decisionType: 'exception' | 'approval' | 'escalation' | 'override' | 'policy_application' | 'synthesis'
  
  // The WHY (developer-provided, always required)
  rationale: string
  reasoning?: string[]  // Step-by-step logic
  
  // The WHAT
  inputs: DecisionInput[]
  alternativesConsidered?: Array<{ option: string; rejectedBecause: string }>
  
  // Policy & Precedent
  policy?: {
    id: string
    version: string
    rule: string
  }
  precedents?: string[]  // IDs of prior decisions referenced
  isException: boolean
  exceptionReason?: string
  
  // The WHO
  approvers?: Array<{
    userId: string
    role: string
    approvedAt: number
    comment?: string
  }>
  
  // Context
  context: {
    tenantId?: string
    customerId?: string
    dealId?: string
    environment?: string
    [key: string]: any
  }
  
  // Lineage
  parentDecisionId?: string  // If this decision triggered others
  childDecisionIds?: string[]
  
  // LLM Enrichment (optional, added asynchronously)
  llmAnalysis?: LLMDecisionAnalysis  
  
  // Outcome tracking (added later)
  outcome?: DecisionOutcome
  
  // A/B testing (optional)
  abTest?: {
    testId: string
    variant: 'control' | 'treatment'
  }
  
  // Vector embedding for semantic search (generated from context)
  embedding?: number[]
}

/**
 * LLM-generated deep analysis of a decision
 * Added asynchronously after basic trace is recorded
 */
export interface LLMDecisionAnalysis {
  // Deeper explanation
  deeperRationale: string
  
  // Critical factors identified by LLM
  criticalFactors: Array<{
    factor: string
    impact: 'high' | 'medium' | 'low'
    reasoning: string
  }>
  
  // Risk assessment
  riskAssessment: {
    level: 'low' | 'medium' | 'high'
    factors: string[]
    mitigation: string
  }
  
  // Alternative analysis
  alternativeAnalysis: Array<{
    alternative: string
    pros: string[]
    cons: string[]
    whyRejected: string
  }>
  
  // Precedent relevance
  precedentRelevance?: string
  
  // Metadata
  generatedAt: number
  model: string  // Which LLM model generated this
  confidence: number  // 0-1: LLM's confidence in analysis
}

/**
 * Decision outcome tracking (for measuring accuracy over time)
 */
export interface DecisionOutcome {
  wasCorrect: boolean
  actualResult?: any
  feedback?: string
  trackedAt: number
  trackedBy: string  // userId or 'system'
}

/**
 * Decision replay result (what-if analysis)
 */
export interface DecisionReplayResult {
  originalDecision: DecisionTrace
  replayedAt: number
  
  // Current policy vs original
  policyChanged: boolean
  currentPolicy?: { id: string; version: string; rule: string }
  policyDiff?: string
  
  // Simulated outcome with current policy
  simulatedOutcome?: any
  wouldDecideDifferently: boolean
  
  // Comparison
  differences: Array<{
    aspect: string  // 'policy', 'precedents', 'outcome'
    original: any
    current: any
    reason: string
  }>
}

/**
 * Complete decision explanation (for audit trail)
 */
export interface DecisionExplanation {
  decision: DecisionTrace
  
  // Full context
  inputDetails: DecisionInput[]
  precedents: Array<{
    decisionId: string
    rationale: string
    similarity?: number
    relevance: string
  }>
  policyDetails: {
    id: string
    version: string
    rule: string
    source: string  // Where policy came from
  }
  
  // Approval chain
  approvalChain: Array<{
    step: number
    userId: string
    role: string
    approvedAt: number
    comment?: string
    decision: 'approved' | 'rejected' | 'escalated'
  }>
  
  // Timeline of events
  timeline: Array<{
    timestamp: number
    event: string
    description: string
    metadata?: any
  }>
  
  // Outcome if tracked
  outcome?: DecisionOutcome
}

/**
 * Input gathered from external system
 */
export interface DecisionInput {
  system: string  // 'salesforce', 'zendesk', 'pagerduty', etc.
  entity: string  // 'account', 'ticket', 'incident'
  query: string   // What we asked for
  result: any     // What we got back
  relevance: string  // Why this mattered to the decision
  retrievedAt: number
}

/**
 * Exception pattern - emerges from repeated exceptions
 */
export interface ExceptionPattern {
  patternId: string
  policyId: string
  exceptionType: string
  
  // Frequency
  occurrences: number
  firstSeen: number
  lastSeen: number
  
  // Common factors across exceptions
  commonFactors: Record<string, any>
  
  // Should this become a rule?
  confidence: number  // 0-1: how consistent is this pattern?
  suggestedRule?: string
  shouldPromoteToPolicy: boolean
}

/**
 * Alias for backward compatibility
 */
export type DecisionPattern = ExceptionPattern;

/**
 * Configuration for decision trace enrichment
 */
export interface DecisionTraceConfig {
  // When to use LLM enrichment
  llmEnrichment: {
    mode: 'never' | 'hybrid' | 'always'
    
    // Auto-enrich these decision types
    autoEnrichOn: Array<DecisionTrace['decisionType']>
    
    // LLM configuration
    critic: {
      model: string
      temperature: number
      maxTokens: number
    }
    
    // Performance
    async: boolean  // Don't block decision recording
    timeout: number  // Max time for enrichment (ms)
  }
  
  // Cost controls
  budgets: {
    maxEnrichmentsPerDay: number
    maxCostPerDay: number  // USD
  }
}

/**
 * Default configuration
 */
export const DEFAULT_DECISION_TRACE_CONFIG: DecisionTraceConfig = {
  llmEnrichment: {
    mode: 'hybrid',
    autoEnrichOn: ['exception', 'approval', 'synthesis'],
    critic: {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 500
    },
    async: true,
    timeout: 5000
  },
  budgets: {
    maxEnrichmentsPerDay: 10000,
    maxCostPerDay: 50
  }
}
