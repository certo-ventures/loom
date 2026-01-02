# Decision Trace & Context Graph Implementation Plan

**Status:** PROPOSED  
**Date:** January 1, 2026  
**Inspired by:** Foundation Capital article on Context Graphs

---

## Executive Summary

**Goal:** Transform Loom from an actor runtime into a decision lineage system that captures not just *what* happened, but *why* it happened, enabling agents to learn from precedent and evolve policy from exceptions.

**Strategic Value:**
- Position Loom as the infrastructure for "systems of agents"
- Enable agents to query past decisions as precedent
- Turn exceptions into learnable patterns
- Provide audit trail for autonomous decision-making

**Core Insight:** We already have 80% of the foundation (journals, memory graphs, observability). We need to extend it to capture decision traces as first-class entities.

---

## Architecture Overview

### Current Foundation (✅ Already Have)
```
┌─────────────────────────────────────────────────────────┐
│                   Current Loom Stack                     │
├─────────────────────────────────────────────────────────┤
│ Actors with Journal Replay      │ Event-sourced state   │
│ GraphMemory + Temporal Reasoning │ Entity relationships  │
│ Lamport Clocks                   │ Logical time          │
│ TraceWriter + Observability      │ Request tracing       │
│ ConfigResolver                   │ Hierarchical config   │
└─────────────────────────────────────────────────────────┘
```

### New Layer (🎯 To Build)
```
┌─────────────────────────────────────────────────────────┐
│                   Decision Layer                         │
├─────────────────────────────────────────────────────────┤
│ Decision Traces         │ Why decisions were made        │
│ Precedent Search        │ Query past decisions           │
│ Exception Patterns      │ Learn from repeated overrides  │
│ Policy Evolution        │ Convert exceptions → rules     │
│ Context Synthesis       │ Track cross-system lookups     │
└─────────────────────────────────────────────────────────┘
```

### Integration Points
```
Actor Journal → Store decision traces
GraphMemory   → Index decisions for search
Config System → Link decisions to policy versions
Observability → Track decision quality metrics
```

---

## Phase 1: Decision Trace Foundation
**Timeline:** Week 1-2  
**Goal:** Capture decision context as durable artifacts

### 1.1 Core Types (Day 1)

**File:** `src/actor/decision-trace.ts`
```typescript
/**
 * Decision Trace - The "why" behind an action
 * 
 * This is the missing layer from traditional systems of record.
 * Captures not just what happened, but why it was allowed to happen.
 */
export interface DecisionTrace {
  // Identity
  decisionId: string
  timestamp: number
  actorId: string
  actorType: string
  
  // Classification
  decisionType: 'exception' | 'approval' | 'escalation' | 'override' | 'policy_application' | 'synthesis'
  
  // The WHY (critical!)
  rationale: string
  reasoning?: string[]  // Step-by-step logic
  
  // The WHAT
  inputs: DecisionInput[]
  outcome: any
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
    [key: string]: any
  }
  
  // Lineage
  parentDecisionId?: string  // If this decision triggered others
  childDecisionIds?: string[]
}

/**
 * Input gathered from external system
 */
export interface DecisionInput {
  system: string  // 'salesforce', 'zendesk', 'pagerduty', etc.
  entity: string  // 'account', 'ticket', 'incident'
  query: string   // What we asked for
  result: any     // What we got back
  relevance: string  // Why this mattered
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
```

### 1.2 Journal Integration (Day 2-3)

**File:** `src/actor/journal.ts`
```typescript
// Add new journal entry type
export interface DecisionJournalEntry extends JournalEntry {
  type: 'decision_made'
  decision: DecisionTrace
}

export interface ContextGatheredEntry extends JournalEntry {
  type: 'context_gathered'
  system: string
  query: string
  rationale: string
  result: any
  durationMs: number
}

export interface PrecedentReferencedEntry extends JournalEntry {
  type: 'precedent_referenced'
  decisionId: string
  precedentId: string
  similarity: number
  applicability: string
}
```

### 1.3 Actor Methods (Day 3-4)

**File:** `src/actor/actor.ts`
```typescript
/**
 * Record a decision with full context
 * This is the core primitive for building the context graph
 */
protected async recordDecision(params: {
  decisionType: DecisionTrace['decisionType']
  rationale: string
  reasoning?: string[]
  inputs: DecisionInput[]
  outcome: any
  policy?: { id: string; version: string; rule: string }
  precedents?: string[]
  isException?: boolean
  exceptionReason?: string
  approvers?: DecisionTrace['approvers']
  alternativesConsidered?: DecisionTrace['alternativesConsidered']
}): Promise<string> {
  const decisionId = `dec-${this.context.actorId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  
  const trace: DecisionTrace = {
    decisionId,
    timestamp: this.lamportClock.tick(),
    actorId: this.context.actorId,
    actorType: this.constructor.name,
    context: {
      tenantId: (this.context as any).tenantId,
      customerId: (this.context as any).customerId,
      ...(this.context as any).decisionContext
    },
    isException: params.isException ?? false,
    ...params
  }
  
  // Store in journal (event-sourced)
  const entry: DecisionJournalEntry = {
    type: 'decision_made',
    decision: trace
  }
  this.journal.entries.push(entry)
  await this.persistJournalEntry(entry)
  
  // Store in memory graph (searchable)
  if (this.graphMemory) {
    await this.graphMemory.addDecisionTrace(trace)
  }
  
  // Emit telemetry
  if (this.observabilityTracer) {
    this.observabilityTracer.recordDecision({
      decisionId,
      decisionType: params.decisionType,
      isException: trace.isException,
      policyId: params.policy?.id
    })
  }
  
  return decisionId
}

/**
 * Gather context from multiple systems
 * Explicitly tracks WHAT we looked up and WHY
 */
protected async gatherContext<T = any>(sources: Array<{
  system: string
  entity: string
  query: string | (() => Promise<any>)
  relevance: string  // Why this matters to the decision
}>): Promise<DecisionInput[]> {
  const inputs: DecisionInput[] = []
  
  for (const source of sources) {
    const startTime = Date.now()
    
    try {
      const result = typeof source.query === 'string'
        ? await this.executeQuery(source.system, source.query)
        : await source.query()
      
      const input: DecisionInput = {
        system: source.system,
        entity: source.entity,
        query: typeof source.query === 'string' ? source.query : 'custom',
        result,
        relevance: source.relevance,
        retrievedAt: this.lamportClock.tick()
      }
      
      inputs.push(input)
      
      // Record in journal
      this.journal.entries.push({
        type: 'context_gathered',
        system: source.system,
        query: source.query.toString(),
        rationale: source.relevance,
        result,
        durationMs: Date.now() - startTime
      })
      
    } catch (error) {
      console.warn(`Failed to gather context from ${source.system}:`, error)
      // Continue with partial context
    }
  }
  
  return inputs
}

/**
 * Find similar past decisions (precedent search)
 */
protected async findPrecedents(query: {
  decisionType?: string
  contextSimilarity?: Record<string, any>
  withinDays?: number
  mustHaveApproval?: boolean
}): Promise<DecisionTrace[]> {
  if (!this.graphMemory) {
    return []
  }
  
  const precedents = await this.graphMemory.searchDecisions({
    ...query,
    tenantId: (this.context as any).tenantId
  })
  
  // Record that we referenced precedents
  for (const precedent of precedents) {
    this.journal.entries.push({
      type: 'precedent_referenced',
      decisionId: 'pending',  // Will be set when decision is recorded
      precedentId: precedent.decisionId,
      similarity: 0.85,  // Would come from vector similarity
      applicability: 'Similar customer profile and request type'
    })
  }
  
  return precedents
}

/**
 * Request approval and record the approval chain
 */
protected async requestApproval(params: {
  requestType: string
  rationale: string
  requiredApprovers: Array<{ role: string; userId?: string }>
  context: any
}): Promise<{ approved: boolean; approvers: DecisionTrace['approvers'] }> {
  // Implementation would integrate with approval workflow
  // For now, this is the interface
  throw new Error('Not implemented - approval workflow integration needed')
}
```

### 1.4 Tests (Day 4-5)

**File:** `tests/unit/decision-trace/actor-decisions.test.ts`
```typescript
describe('Actor Decision Recording', () => {
  test('records decision with full context', async () => {
    const actor = new TestActor(context)
    
    const inputs = await actor['gatherContext']([
      {
        system: 'salesforce',
        entity: 'account',
        query: async () => ({ arr: 500000, industry: 'healthcare' }),
        relevance: 'Customer size determines approval level'
      }
    ])
    
    const decisionId = await actor['recordDecision']({
      decisionType: 'exception',
      rationale: 'Healthcare customer with high ARR deserves discount',
      inputs,
      outcome: { discount: 0.15 },
      isException: true,
      exceptionReason: 'Industry-specific discount policy'
    })
    
    expect(decisionId).toMatch(/^dec-/)
    
    // Verify in journal
    const journalEntries = actor['journal'].entries
    const decisionEntry = journalEntries.find(e => e.type === 'decision_made')
    expect(decisionEntry).toBeDefined()
    expect(decisionEntry.decision.rationale).toContain('healthcare')
  })
  
  test('captures context gathering', async () => {
    const actor = new TestActor(context)
    
    await actor['gatherContext']([
      {
        system: 'zendesk',
        entity: 'tickets',
        query: 'status:open priority:high',
        relevance: 'Check for active support issues'
      }
    ])
    
    const contextEntries = actor['journal'].entries.filter(
      e => e.type === 'context_gathered'
    )
    expect(contextEntries).toHaveLength(1)
    expect(contextEntries[0].system).toBe('zendesk')
  })
  
  test('finds precedents from past decisions', async () => {
    // Pre-populate memory with past decision
    await graphMemory.addDecisionTrace({
      decisionId: 'dec-past-1',
      decisionType: 'exception',
      rationale: 'Healthcare discount',
      context: { industry: 'healthcare' }
    })
    
    const actor = new TestActor(context)
    const precedents = await actor['findPrecedents']({
      decisionType: 'exception',
      contextSimilarity: { industry: 'healthcare' }
    })
    
    expect(precedents).toHaveLength(1)
    expect(precedents[0].decisionId).toBe('dec-past-1')
  })
})
```

**Success Criteria Phase 1:**
- ✅ DecisionTrace type defined and documented
- ✅ Decisions stored in journal (event-sourced)
- ✅ Context gathering tracked explicitly
- ✅ 15+ tests passing
- ✅ Example actor using decision recording

---

## Phase 2: Precedent Search & Memory Integration
**Timeline:** Week 3-4  
**Goal:** Make past decisions searchable

### 2.1 Decision Memory Extension (Day 6-8)

**File:** `src/memory/graph/decision-memory.ts`
```typescript
/**
 * Decision Memory - Makes decision traces searchable
 * Extends GraphMemory to handle decision lineage
 */
export class DecisionMemory {
  constructor(
    private storage: GraphStorage,
    private embeddings?: EmbeddingService
  ) {}
  
  /**
   * Add decision to searchable graph
   */
  async addDecisionTrace(trace: DecisionTrace): Promise<void> {
    // Store decision as node
    await this.storage.addNode({
      id: trace.decisionId,
      type: 'decision',
      properties: {
        decisionType: trace.decisionType,
        timestamp: trace.timestamp,
        actorId: trace.actorId,
        isException: trace.isException,
        policyId: trace.policy?.id,
        ...trace.context
      },
      embedding: this.embeddings 
        ? await this.embeddings.embed(this.serializeForSearch(trace))
        : undefined
    })
    
    // Link to precedents
    for (const precedentId of trace.precedents || []) {
      await this.storage.addEdge({
        from: trace.decisionId,
        to: precedentId,
        type: 'based_on_precedent',
        properties: {}
      })
    }
    
    // Link to policy
    if (trace.policy) {
      await this.storage.addEdge({
        from: trace.decisionId,
        to: `policy-${trace.policy.id}`,
        type: 'applied_policy',
        properties: { version: trace.policy.version }
      })
    }
    
    // Link to entities (customer, deal, etc.)
    for (const [key, value] of Object.entries(trace.context)) {
      if (key.endsWith('Id')) {
        await this.storage.addEdge({
          from: trace.decisionId,
          to: value as string,
          type: `decision_for_${key.replace('Id', '')}`,
          properties: {}
        })
      }
    }
  }
  
  /**
   * Search for similar decisions
   */
  async searchDecisions(query: {
    decisionType?: string
    contextSimilarity?: Record<string, any>
    withinDays?: number
    mustHaveApproval?: boolean
    tenantId?: string
    embedding?: number[]
  }): Promise<DecisionTrace[]> {
    // Build graph query
    const filters: any[] = []
    
    if (query.decisionType) {
      filters.push({ property: 'decisionType', value: query.decisionType })
    }
    if (query.mustHaveApproval) {
      filters.push({ property: 'approvers', exists: true })
    }
    if (query.tenantId) {
      filters.push({ property: 'tenantId', value: query.tenantId })
    }
    if (query.withinDays) {
      const cutoff = Date.now() - (query.withinDays * 24 * 60 * 60 * 1000)
      filters.push({ property: 'timestamp', greaterThan: cutoff })
    }
    
    // Vector search if embeddings available
    let nodes
    if (query.embedding && this.embeddings) {
      nodes = await this.storage.searchByEmbedding({
        embedding: query.embedding,
        filters,
        limit: 10
      })
    } else {
      nodes = await this.storage.findNodes({
        type: 'decision',
        filters,
        limit: 100
      })
    }
    
    // Reconstruct full traces
    return nodes.map(node => this.nodeToDecisionTrace(node))
  }
  
  /**
   * Get decision chain - decision + all its precedents
   */
  async getDecisionChain(decisionId: string): Promise<DecisionTrace[]> {
    const chain: DecisionTrace[] = []
    const visited = new Set<string>()
    
    const traverse = async (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      
      const node = await this.storage.getNode(id)
      if (!node) return
      
      const trace = this.nodeToDecisionTrace(node)
      chain.push(trace)
      
      // Follow precedent links
      const precedentEdges = await this.storage.getEdges({
        from: id,
        type: 'based_on_precedent'
      })
      
      for (const edge of precedentEdges) {
        await traverse(edge.to)
      }
    }
    
    await traverse(decisionId)
    return chain
  }
  
  /**
   * Find exception patterns across decisions
   */
  async detectExceptionPatterns(): Promise<ExceptionPattern[]> {
    // Get all exceptions
    const exceptions = await this.storage.findNodes({
      type: 'decision',
      filters: [{ property: 'isException', value: true }]
    })
    
    // Group by policy + exception reason
    const groups = new Map<string, any[]>()
    
    for (const exception of exceptions) {
      const key = `${exception.properties.policyId}:${exception.properties.exceptionReason}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(exception)
    }
    
    // Analyze each group
    const patterns: ExceptionPattern[] = []
    
    for (const [key, group] of groups) {
      if (group.length < 3) continue  // Need multiple occurrences
      
      const [policyId, exceptionType] = key.split(':')
      
      // Find common factors
      const commonFactors = this.findCommonFactors(group)
      
      patterns.push({
        patternId: `pattern-${policyId}-${Date.now()}`,
        policyId,
        exceptionType,
        occurrences: group.length,
        firstSeen: Math.min(...group.map(g => g.properties.timestamp)),
        lastSeen: Math.max(...group.map(g => g.properties.timestamp)),
        commonFactors,
        confidence: this.calculateConfidence(group, commonFactors),
        shouldPromoteToPolicy: group.length > 10 && this.calculateConfidence(group, commonFactors) > 0.8
      })
    }
    
    return patterns.sort((a, b) => b.occurrences - a.occurrences)
  }
  
  private findCommonFactors(decisions: any[]): Record<string, any> {
    // Find properties that appear in >80% of decisions
    const counts = new Map<string, Map<any, number>>()
    
    for (const decision of decisions) {
      for (const [key, value] of Object.entries(decision.properties)) {
        if (!counts.has(key)) {
          counts.set(key, new Map())
        }
        const valueCount = counts.get(key)!.get(value) || 0
        counts.get(key)!.set(value, valueCount + 1)
      }
    }
    
    const common: Record<string, any> = {}
    const threshold = decisions.length * 0.8
    
    for (const [key, valueCounts] of counts) {
      for (const [value, count] of valueCounts) {
        if (count >= threshold) {
          common[key] = value
        }
      }
    }
    
    return common
  }
  
  private calculateConfidence(decisions: any[], commonFactors: Record<string, any>): number {
    const factorCount = Object.keys(commonFactors).length
    if (factorCount === 0) return 0
    
    // Confidence based on: frequency, consistency, recency
    const frequency = decisions.length / 100  // Normalized
    const consistency = factorCount / 5  // Assuming 5 is good
    const recency = 1 - (Date.now() - Math.max(...decisions.map(d => d.properties.timestamp))) / (90 * 24 * 60 * 60 * 1000)
    
    return Math.min(1, (frequency + consistency + recency) / 3)
  }
  
  private serializeForSearch(trace: DecisionTrace): string {
    return `${trace.decisionType} decision: ${trace.rationale}. Context: ${JSON.stringify(trace.context)}. Exception: ${trace.isException}`
  }
  
  private nodeToDecisionTrace(node: any): DecisionTrace {
    // Convert storage node back to DecisionTrace
    return node.properties as DecisionTrace
  }
}
```

### 2.2 Integration with ActorMemory (Day 9)

**File:** `src/memory/graph/actor-memory.ts`
```typescript
export class ActorMemory {
  private decisionMemory: DecisionMemory
  
  // Add decision methods
  async addDecisionTrace(trace: DecisionTrace): Promise<void> {
    return this.decisionMemory.addDecisionTrace(trace)
  }
  
  async searchDecisions(query: any): Promise<DecisionTrace[]> {
    return this.decisionMemory.searchDecisions(query)
  }
  
  async getDecisionChain(decisionId: string): Promise<DecisionTrace[]> {
    return this.decisionMemory.getDecisionChain(decisionId)
  }
  
  async detectExceptionPatterns(): Promise<ExceptionPattern[]> {
    return this.decisionMemory.detectExceptionPatterns()
  }
}
```

### 2.3 Tests (Day 10)

**File:** `tests/integration/decision-memory.test.ts`
```typescript
describe('Decision Memory Integration', () => {
  test('searches decisions by context similarity', async () => {
    // Add multiple decisions
    await decisionMemory.addDecisionTrace({
      decisionId: 'dec-1',
      decisionType: 'exception',
      rationale: 'Healthcare discount',
      context: { industry: 'healthcare', arr: 500000 }
    })
    
    await decisionMemory.addDecisionTrace({
      decisionId: 'dec-2',
      decisionType: 'exception',
      rationale: 'Healthcare SLA extension',
      context: { industry: 'healthcare', arr: 300000 }
    })
    
    // Search for healthcare exceptions
    const results = await decisionMemory.searchDecisions({
      contextSimilarity: { industry: 'healthcare' }
    })
    
    expect(results).toHaveLength(2)
  })
  
  test('detects exception patterns', async () => {
    // Add 15 similar exceptions
    for (let i = 0; i < 15; i++) {
      await decisionMemory.addDecisionTrace({
        decisionId: `dec-${i}`,
        decisionType: 'exception',
        isException: true,
        exceptionReason: 'healthcare_discount',
        policyId: 'discount-policy-v1',
        context: { industry: 'healthcare' }
      })
    }
    
    const patterns = await decisionMemory.detectExceptionPatterns()
    
    expect(patterns.length).toBeGreaterThan(0)
    expect(patterns[0].occurrences).toBe(15)
    expect(patterns[0].shouldPromoteToPolicy).toBe(true)
  })
})
```

**Success Criteria Phase 2:**
- ✅ Decisions searchable by context
- ✅ Vector search working (if embeddings configured)
- ✅ Decision chains reconstructable
- ✅ Exception pattern detection working
- ✅ 20+ integration tests passing

---

## Phase 3: Policy Evolution & Recommendations
**Timeline:** Week 5-6  
**Goal:** Learn from exceptions, suggest policy changes

### 3.1 Policy Evolution Service (Day 11-13)

**File:** `src/decision/policy-evolution.ts`
```typescript
/**
 * Policy Evolution Service
 * Analyzes exception patterns and recommends policy updates
 */
export class PolicyEvolutionService {
  constructor(
    private decisionMemory: DecisionMemory,
    private configResolver: ConfigResolver
  ) {}
  
  /**
   * Analyze exception patterns and generate recommendations
   */
  async analyzeExceptions(): Promise<PolicyRecommendation[]> {
    const patterns = await this.decisionMemory.detectExceptionPatterns()
    const recommendations: PolicyRecommendation[] = []
    
    for (const pattern of patterns) {
      if (pattern.shouldPromoteToPolicy) {
        recommendations.push({
          recommendationId: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          priority: 'high',
          pattern,
          proposedChange: this.generatePolicyChange(pattern),
          impact: await this.estimateImpact(pattern),
          confidence: pattern.confidence
        })
      }
    }
    
    return recommendations.sort((a, b) => b.confidence - a.confidence)
  }
  
  /**
   * Generate policy change from pattern
   */
  private generatePolicyChange(pattern: ExceptionPattern): PolicyChange {
    const conditions: string[] = []
    
    for (const [key, value] of Object.entries(pattern.commonFactors)) {
      conditions.push(`${key} === ${JSON.stringify(value)}`)
    }
    
    return {
      policyId: pattern.policyId,
      changeType: 'add_rule',
      description: `Add automatic approval for ${pattern.exceptionType}`,
      rule: {
        condition: conditions.join(' && '),
        action: pattern.exceptionType,
        rationale: `Pattern detected across ${pattern.occurrences} exceptions`
      },
      code: this.generateRuleCode(conditions, pattern.exceptionType)
    }
  }
  
  private generateRuleCode(conditions: string[], action: string): string {
    return `
// Auto-generated rule from exception pattern
if (${conditions.join(' && ')}) {
  // Automatically approve: ${action}
  return { approved: true, reason: 'Pattern-based auto-approval' }
}
`.trim()
  }
  
  /**
   * Estimate impact if this policy change is applied
   */
  private async estimateImpact(pattern: ExceptionPattern): Promise<PolicyImpact> {
    // Get recent decisions that would match this rule
    const recentDecisions = await this.decisionMemory.searchDecisions({
      withinDays: 30
    })
    
    let wouldAutoApprove = 0
    let wouldStillNeedApproval = 0
    
    for (const decision of recentDecisions) {
      const matches = Object.entries(pattern.commonFactors).every(
        ([key, value]) => decision.context[key] === value
      )
      
      if (matches) {
        wouldAutoApprove++
      } else {
        wouldStillNeedApproval++
      }
    }
    
    return {
      automationRate: wouldAutoApprove / recentDecisions.length,
      decisionsAffected: wouldAutoApprove,
      timesSaved: wouldAutoApprove * 5,  // Assume 5 min per approval
      riskLevel: wouldAutoApprove > 100 ? 'high' : 'medium'
    }
  }
}

export interface PolicyRecommendation {
  recommendationId: string
  priority: 'high' | 'medium' | 'low'
  pattern: ExceptionPattern
  proposedChange: PolicyChange
  impact: PolicyImpact
  confidence: number
}

export interface PolicyChange {
  policyId: string
  changeType: 'add_rule' | 'modify_rule' | 'remove_rule'
  description: string
  rule: {
    condition: string
    action: string
    rationale: string
  }
  code: string
}

export interface PolicyImpact {
  automationRate: number  // 0-1
  decisionsAffected: number
  timesSaved: number  // minutes
  riskLevel: 'low' | 'medium' | 'high'
}
```

### 3.2 Recommendation UI/API (Day 14)

**File:** `src/decision/recommendations-api.ts`
```typescript
/**
 * API for policy recommendations
 */
export class RecommendationsAPI {
  /**
   * GET /api/recommendations
   * List pending policy recommendations
   */
  async listRecommendations(): Promise<PolicyRecommendation[]> {
    const service = new PolicyEvolutionService(decisionMemory, configResolver)
    return service.analyzeExceptions()
  }
  
  /**
   * POST /api/recommendations/:id/approve
   * Approve and apply recommendation
   */
  async approveRecommendation(
    recommendationId: string,
    approvedBy: string
  ): Promise<void> {
    // Apply policy change to config
    // Track who approved and when
  }
  
  /**
   * POST /api/recommendations/:id/reject
   * Reject recommendation with reason
   */
  async rejectRecommendation(
    recommendationId: string,
    reason: string
  ): Promise<void> {
    // Record rejection
    // Don't suggest again
  }
}
```

**Success Criteria Phase 3:**
- ✅ Exception patterns detected automatically
- ✅ Policy recommendations generated
- ✅ Impact estimates provided
- ✅ Code generation for new rules
- ✅ Approval workflow defined

---

## Phase 4: Observability & Analytics
**Timeline:** Week 7  
**Goal:** Monitor decision quality, detect drift

### 4.1 Decision Metrics (Day 15-16)

**File:** `src/observability/decision-metrics.ts`
```typescript
/**
 * Decision Quality Metrics
 */
export class DecisionMetrics {
  /**
   * Track decision outcome quality over time
   */
  async trackDecisionOutcome(
    decisionId: string,
    outcome: 'success' | 'failure' | 'partial',
    feedback?: string
  ): Promise<void> {
    // Record actual outcome
    // Compare to predicted/expected outcome
  }
  
  /**
   * Calculate decision accuracy by type
   */
  async calculateAccuracy(params: {
    decisionType?: string
    actorType?: string
    timeWindow: number
  }): Promise<DecisionAccuracyReport> {
    // % of decisions with successful outcomes
    // Broken down by type, actor, time
  }
  
  /**
   * Detect policy drift
   * When actual decisions diverge from stated policy
   */
  async detectPolicyDrift(): Promise<PolicyDriftReport[]> {
    // Compare decisions to policy rules
    // Find systematic deviations
  }
  
  /**
   * Exception rate trends
   */
  async exceptionTrends(): Promise<ExceptionTrendReport> {
    // Are exceptions increasing?
    // Which policies have most exceptions?
  }
}
```

### 4.2 Dashboard Integration (Day 17)

Create visualization endpoints for:
- Decision volume over time
- Exception rates by policy
- Average decision latency
- Precedent usage frequency
- Policy recommendation queue

**Success Criteria Phase 4:**
- ✅ Decision quality tracked
- ✅ Policy drift detected
- ✅ Metrics dashboards available
- ✅ Alerts for anomalies

---

## Example: Real-World Usage

### Discount Approval Agent

```typescript
class DiscountApprovalAgent extends Actor {
  async execute(request: DiscountRequest): Promise<DiscountDecision> {
    // 1. Gather context from multiple systems
    const inputs = await this.gatherContext([
      {
        system: 'salesforce',
        entity: 'account',
        query: async () => this.salesforce.getAccount(request.accountId),
        relevance: 'Customer ARR and industry determine approval requirements'
      },
      {
        system: 'zendesk',
        entity: 'tickets',
        query: `account:${request.accountId} status:open priority:high`,
        relevance: 'Active support issues may justify higher discount'
      },
      {
        system: 'pagerduty',
        entity: 'incidents',
        query: async () => this.pagerduty.getIncidents({ customer: request.accountId }),
        relevance: 'Service incidents impact renewal negotiations'
      }
    ])
    
    // Extract gathered data
    const account = inputs[0].result
    const openTickets = inputs[1].result
    const incidents = inputs[2].result
    
    // 2. Check policy
    const policy = await this.getConfig('discount-policy')
    const maxDiscount = policy.baseMaxDiscount
    
    // 3. Search for precedents
    const precedents = await this.findPrecedents({
      decisionType: 'exception',
      contextSimilarity: {
        industry: account.industry,
        arrRange: this.getArrRange(account.arr)
      },
      withinDays: 90
    })
    
    // 4. Make decision
    let decision: DiscountDecision
    let isException = false
    let exceptionReason = ''
    
    if (request.requestedDiscount <= maxDiscount) {
      // Standard approval
      decision = {
        approved: true,
        discount: request.requestedDiscount,
        reason: 'Within policy limits'
      }
    } else if (
      account.industry === 'healthcare' &&
      precedents.length > 5 &&
      (openTickets.length > 2 || incidents.length > 0)
    ) {
      // Exception based on precedent + service issues
      decision = {
        approved: true,
        discount: request.requestedDiscount,
        reason: 'Healthcare exception with service issues (precedent established)'
      }
      isException = true
      exceptionReason = 'healthcare_service_exception'
    } else {
      // Needs VP approval
      const approval = await this.requestApproval({
        requestType: 'discount_exception',
        rationale: `Discount exceeds ${maxDiscount}. Customer: ${account.name}, Requested: ${request.requestedDiscount}`,
        requiredApprovers: [{ role: 'VP Sales' }],
        context: { account, openTickets, incidents }
      })
      
      decision = {
        approved: approval.approved,
        discount: approval.approved ? request.requestedDiscount : maxDiscount,
        reason: approval.approved ? 'VP approved exception' : 'Exceeds policy, not approved'
      }
      isException = approval.approved
      exceptionReason = 'manual_vp_approval'
    }
    
    // 5. Record decision with full context
    await this.recordDecision({
      decisionType: isException ? 'exception' : 'policy_application',
      rationale: decision.reason,
      reasoning: [
        `Customer ARR: ${account.arr}`,
        `Industry: ${account.industry}`,
        `Open tickets: ${openTickets.length}`,
        `Incidents: ${incidents.length}`,
        `Precedents found: ${precedents.length}`,
        `Policy max: ${maxDiscount}`,
        `Requested: ${request.requestedDiscount}`
      ],
      inputs,
      outcome: decision,
      policy: {
        id: 'discount-policy',
        version: policy.version,
        rule: `Max discount: ${maxDiscount}`
      },
      precedents: precedents.map(p => p.decisionId),
      isException,
      exceptionReason: isException ? exceptionReason : undefined
    })
    
    return decision
  }
}
```

---

## Testing Strategy

### Unit Tests
- Decision trace creation and serialization
- Context gathering with mocked systems
- Precedent search logic
- Exception pattern detection

### Integration Tests
- Full decision flow with real memory graph
- Cross-system context synthesis
- Policy evolution recommendations
- Decision chain reconstruction

### E2E Tests
- Real-world scenarios (discount, escalation, etc.)
- Multi-actor decision workflows
- Precedent application across tenants
- Policy drift detection

---

## Migration Path

### For Existing Actors
```typescript
// Before: Simple execution
async execute(input: any) {
  const result = await this.process(input)
  return result
}

// After: Decision-aware execution
async execute(input: any) {
  // Gather context
  const inputs = await this.gatherContext([...])
  
  // Check precedents
  const precedents = await this.findPrecedents({...})
  
  // Make decision
  const result = await this.process(input, inputs, precedents)
  
  // Record decision
  await this.recordDecision({
    decisionType: 'policy_application',
    rationale: '...',
    inputs,
    outcome: result,
    precedents: precedents.map(p => p.decisionId)
  })
  
  return result
}
```

---

## Success Metrics

**Technical:**
- [ ] 100% of critical decisions captured
- [ ] <100ms overhead for decision recording
- [ ] Precedent search <500ms p99
- [ ] Exception patterns detected within 24h

**Business:**
- [ ] 30% reduction in manual approvals (via learned policies)
- [ ] 50% faster decision time (precedent reuse)
- [ ] Zero decisions without audit trail
- [ ] 90% of exceptions become policies within 3 months

---

## Timeline Summary

| Phase | Timeline | Deliverable |
|-------|----------|-------------|
| Phase 1 | Week 1-2 | Decision trace foundation |
| Phase 2 | Week 3-4 | Precedent search |
| Phase 3 | Week 5-6 | Policy evolution |
| Phase 4 | Week 7 | Observability |
| **Total** | **7 weeks** | **Production-ready decision system** |

---

## Next Steps

1. **Review this plan** - Validate approach with team
2. **Prioritize phases** - Can we ship Phase 1 independently?
3. **Define first use case** - Which actor becomes the pilot?
4. **Start Phase 1** - Begin with decision trace types

Ready to start implementation? 🚀
