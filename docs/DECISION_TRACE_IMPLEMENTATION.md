# Decision Trace System - Phase 1 Implementation

## Overview

The Decision Trace System captures **WHY decisions were made**, not just WHAT happened. This transforms Loom from an "actor runtime" into a "decision lineage system" - positioning it as infrastructure for the emerging "systems of agents" category.

**Inspired by**: Foundation Capital's Context Graph article - traditional systems capture state (what happened), but miss decision traces (why it happened).

## Architecture: Hybrid LLM Approach

We implement a **hybrid approach** that balances speed, cost, and insight quality:

### 1. Basic Traces (Always)
- Developer-written rationale (required)
- Zero latency, no cost
- Captures: inputs, outcome, policy, precedents, approvers
- Stored in journal for replay

### 2. LLM Enrichment (Optional, Async)
- Deep analysis by LLM critic
- +200-500ms latency (async, doesn't block)
- ~$0.001-0.01 per decision
- Auto-enriches: exceptions, approvals, synthesis
- Adds: deeper rationale, risk assessment, alternative analysis

### Configuration-Driven
```yaml
decisionTraces:
  llmEnrichment:
    mode: 'hybrid'  # never | hybrid | always
    autoEnrichOn: [exception, approval, synthesis]
    async: true  # Don't block
    timeout: 5000
  budgets:
    maxEnrichmentsPerDay: 10000
    maxCostPerDay: 50
```

## Core Concepts

### DecisionTrace
Captures the complete context of a decision:
```typescript
interface DecisionTrace {
  decisionId: string
  timestamp: number
  actorId: string
  actorType: string
  
  // Classification
  decisionType: 'exception' | 'approval' | 'escalation' | 'override' | 'policy_application' | 'synthesis'
  
  // The WHY (developer-provided, always required)
  rationale: string
  reasoning?: string[]
  
  // The WHAT
  inputs: DecisionInput[]
  outcome: any
  
  // Policy & Precedent
  policy?: { id: string; version: string; rule: string }
  precedents?: string[]
  isException: boolean
  
  // The WHO
  approvers?: Array<{ userId: string; role: string; approvedAt: number }>
  
  // Context
  context: Record<string, any>
  
  // LLM Enrichment (optional, async)
  llmAnalysis?: LLMDecisionAnalysis
}
```

### DecisionInput
Tracks which systems were consulted and why:
```typescript
interface DecisionInput {
  system: string  // 'salesforce', 'zendesk', etc.
  entity: string  // 'account', 'ticket'
  query: string   // What we asked
  result: any     // What we got
  relevance: string  // Why this mattered
  retrievedAt: number
}
```

## Actor Methods

### recordDecision()
Core primitive for capturing decisions:
```typescript
protected async recordDecision(params: {
  decisionType: 'exception' | 'approval' | ...
  rationale: string  // WHY (required)
  reasoning?: string[]  // Step-by-step logic
  inputs: DecisionInput[]  // All context gathered
  outcome: any  // What was decided
  policy?: { id: string; version: string; rule: string }
  precedents?: string[]  // Prior decisions referenced
  isException: boolean
  approvers?: Array<{ userId, role, approvedAt, comment }>
  context?: Record<string, any>
  enrichWithLLM?: 'always' | 'never'  // Override config
}): Promise<string>
```

**Example**:
```typescript
await this.recordDecision({
  decisionType: 'exception',
  rationale: 'Healthcare customer with service issues deserves discount',
  reasoning: [
    'Customer ARR: $500k',
    'Industry: healthcare (precedent exists)',
    '3 open SEV-1 tickets',
    'VP approval obtained'
  ],
  inputs: [salesforceData, zendeskData],
  outcome: { approved: true, discount: 0.15 },
  isException: true,
  exceptionReason: 'Above 10% policy limit'
})
```

### gatherContext()
Track which systems were consulted:
```typescript
protected async gatherContext<T>(params: {
  system: string
  entity: string
  query: string
  relevance: string  // Why this matters
  fetcher: () => Promise<T>
  decisionId?: string
}): Promise<T>
```

**Example**:
```typescript
const customer = await this.gatherContext({
  system: 'salesforce',
  entity: 'account',
  query: 'SELECT ARR, Industry FROM Account WHERE Id = "123"',
  relevance: 'Customer ARR determines approval threshold',
  fetcher: async () => await salesforce.query(...)
})
```

### findPrecedents()
Query past decisions (stub - full implementation in Phase 2):
```typescript
protected async findPrecedents(params: {
  decisionType?: 'exception' | 'approval' | ...
  contextSimilarity?: Record<string, any>
  timeRange?: { start: number; end: number }
  limit?: number
}): Promise<DecisionTrace[]>
```

### requestApproval()
Capture approval chains:
```typescript
protected async requestApproval(params: {
  approvalType: string
  reason: string
  data: any
  requiredRole?: string
}): Promise<{
  approved: boolean
  approver?: { userId: string; role: string; comment?: string }
  approvedAt?: number
}>
```

## Complete Example: Discount Approval Agent

See [examples/discount-approval-agent.ts](../examples/discount-approval-agent.ts) for a complete implementation showing:

1. **Gather context** from Salesforce (customer profile) and Zendesk (support health)
2. **Search precedents** for similar healthcare customers
3. **Apply policy** or request VP approval for exceptions
4. **Record decision** with full context (WHY + WHAT)

```typescript
class DiscountApprovalAgent extends Actor {
  async execute(request: DiscountRequest) {
    // 1. Gather context from multiple systems
    const customer = await this.gatherContext({
      system: 'salesforce',
      entity: 'account',
      query: `SELECT ARR, Industry FROM Account`,
      relevance: 'Customer profile determines approval',
      fetcher: async () => this.fetchCustomer(request.customerId)
    })
    
    const supportHealth = await this.gatherContext({
      system: 'zendesk',
      entity: 'tickets',
      query: `SELECT COUNT(*) WHERE Severity = "SEV-1"`,
      relevance: 'Service issues may justify exception',
      fetcher: async () => this.fetchSupport(request.customerId)
    })
    
    // 2. Search precedents
    const precedents = await this.findPrecedents({
      decisionType: 'exception',
      contextSimilarity: { industry: customer.industry }
    })
    
    // 3. Apply policy + context
    const decision = this.evaluateDiscount(request, customer, supportHealth)
    
    // 4. Request approval if needed
    if (decision.requiresApproval) {
      await this.requestApproval({
        approvalType: 'discount_exception',
        reason: decision.reason,
        data: { discount: decision.discount }
      })
    }
    
    // 5. Record decision trace
    await this.recordDecision({
      decisionType: isException ? 'exception' : 'policy_application',
      rationale: decision.reason,
      reasoning: [
        `Customer ARR: $${customer.ARR}`,
        `Industry: ${customer.industry}`,
        `Policy limit: 10%`,
        `Approved: ${decision.discount * 100}%`,
        precedents.length > 0 ? `${precedents.length} precedents found` : ''
      ],
      inputs: [customerInput, supportInput],
      outcome: decision,
      precedents: precedents.map(p => p.decisionId),
      isException
    })
    
    return decision
  }
}
```

## Journal Integration

Decision traces are stored as journal entries for deterministic replay:

### DecisionJournalEntry
```typescript
{
  type: 'decision_made'
  decisionId: string
  timestamp: number
  decisionType: 'exception' | 'approval' | ...
  rationale: string
  reasoning?: string[]
  inputs: DecisionInput[]
  outcome: any
  policy?: { id, version, rule }
  precedents?: string[]
  isException: boolean
  approvers?: Array<{ userId, role, approvedAt }>
  context: Record<string, any>
}
```

### ContextGatheredEntry
```typescript
{
  type: 'context_gathered'
  decisionId: string
  system: string
  entity: string
  query: string
  result: any
  relevance: string
  retrievedAt: number
}
```

### PrecedentReferencedEntry
```typescript
{
  type: 'precedent_referenced'
  decisionId: string
  precedentId: string
  relevance: string
  retrievedAt: number
}
```

## LLM Enrichment Details

### When It Runs
- **Async** (doesn't block decision recording)
- **Configurable** triggers (exception, approval, synthesis)
- **Budget-controlled** (max per day)
- **Timeout-protected** (5s default)
- **Gracefully fails** (basic trace always preserved)

### LLM Critic Prompt
```
You are analyzing a decision made by an AI agent. Explain WHY this decision was made.

DECISION: [type] - [rationale]

INPUTS:
- salesforce.account: Customer ARR determines threshold
  Result: { ARR: 500000, Industry: "Healthcare" }
- zendesk.tickets: Service issues justify exception
  Result: { sev1Count: 3 }

OUTCOME: { approved: true, discount: 0.15 }

POLICY: Max 10% discount
EXCEPTION: Yes - Above standard limit
PRECEDENTS: 3 similar decisions found

TASK: Provide JSON analysis:
{
  "deeperRationale": "...",
  "criticalFactors": [{ factor, impact, reasoning }],
  "riskAssessment": { level, factors, mitigation },
  "alternativeAnalysis": [{ alternative, whyRejected }]
}
```

### LLMDecisionAnalysis
```typescript
interface LLMDecisionAnalysis {
  deeperRationale: string
  criticalFactors: Array<{
    factor: string
    impact: 'high' | 'medium' | 'low'
    reasoning: string
  }>
  riskAssessment: {
    level: 'low' | 'medium' | 'high'
    factors: string[]
    mitigation: string
  }
  alternativeAnalysis: Array<{
    alternative: string
    pros: string[]
    cons: string[]
    whyRejected: string
  }>
  generatedAt: number
  model: string
  confidence: number
}
```

## Cost Analysis

### Basic Traces (Always)
- **Latency**: <1ms overhead
- **Cost**: $0
- **Quality**: Developer-written (shallow but fast)

### LLM Enrichment (Optional)
- **Latency**: +200-500ms (async)
- **Cost**: ~$0.001-0.01 per decision (gpt-4o-mini)
- **Quality**: Rich explanations with risk assessment

### Budget Example
```
Daily limits:
- 10,000 enrichments/day
- $50/day budget

At $0.005 per enrichment:
- Can afford 10,000 decisions/day
- 416 decisions/hour
- ~7 decisions/minute

Plenty for most workloads!
```

## Testing

All core functionality is tested:
```bash
npm test tests/unit/decision-trace/
```

**Test Coverage**:
- ✓ Record basic policy application (12 passing)
- ✓ Record exception with full context
- ✓ Gather context from multiple systems
- ✓ Find precedents (stub)
- ✓ Request approval
- ✓ Complete decision workflow
- ✓ LLM enrichment configuration
- ✓ Budget limits

## Configuration

See [loom.config.decision-traces.yaml](../loom.config.decision-traces.yaml) for complete configuration example.

**Key settings**:
- `decisionTraces.llmEnrichment.mode`: 'never' | 'hybrid' | 'always'
- `decisionTraces.llmEnrichment.autoEnrichOn`: Which types to enrich
- `decisionTraces.budgets`: Cost controls
- `critic-llm`: LLM API configuration

## What's Next?

**Phase 1 (COMPLETE)**: Decision Trace Foundation
- ✓ Core types defined
- ✓ Journal integration
- ✓ Actor methods implemented
- ✓ Hybrid LLM approach
- ✓ Tests passing
- ✓ Example agent

**Phase 2 (Weeks 3-4)**: Precedent Search & Memory Integration
- DecisionMemory class (extends GraphMemory)
- Vector search for similar decisions
- Exception pattern detection
- Decision graph construction

**Phase 3 (Weeks 5-6)**: Policy Evolution
- Analyze exception patterns
- Generate policy recommendations
- Auto-generate rule code
- Impact estimation

**Phase 4 (Week 7)**: Observability & Analytics
- Decision quality metrics
- Policy drift detection
- Dashboard integration
- Anomaly alerts

## Strategic Value

This positions Loom as infrastructure for the "systems of agents" category:

1. **Capture decision lineage** - Why decisions were made, not just what happened
2. **Searchable precedent** - "Show me similar healthcare exceptions"
3. **Policy evolution** - "15 similar exceptions → promote to rule"
4. **Audit trail** - Complete context for every decision
5. **Learning system** - Patterns emerge and inform future decisions

**Competitive advantage**: Incumbents (Salesforce, Workday) can't do this - they capture current state, not decision traces. Systems of agents startups can capture context at decision time because they sit in the orchestration path.
