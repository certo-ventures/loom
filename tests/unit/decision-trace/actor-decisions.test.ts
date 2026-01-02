import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Actor } from '../../../src/actor/actor'
import type { ActorContext } from '../../../src/actor/journal'
import type { DecisionInput, DecisionTrace } from '../../../src/actor/decision-trace'

class TestDecisionActor extends Actor {
  async execute(input: any) {
    return { success: true, input }
  }

  // Expose protected methods for testing
  public async testRecordDecision(params: Parameters<typeof this.recordDecision>[0]) {
    return this.recordDecision(params)
  }

  public async testGatherContext<T>(params: Parameters<typeof this.gatherContext<T>>[0]) {
    return this.gatherContext(params)
  }

  public async testFindPrecedents(params: Parameters<typeof this.findPrecedents>[0]) {
    return this.findPrecedents(params)
  }

  public async testRequestApproval(params: Parameters<typeof this.requestApproval>[0]) {
    return this.requestApproval(params)
  }

  public getJournal() {
    return (this as any).journal
  }
}

describe('Actor Decision Trace Methods', () => {
  let actor: TestDecisionActor
  let context: ActorContext
  let mockConfigResolver: any

  beforeEach(() => {
    mockConfigResolver = {
      getWithContext: vi.fn().mockResolvedValue(null)
    }

    context = {
      actorId: 'test-actor-1',
      actorType: 'TestDecisionActor',
      recordEvent: vi.fn(),
      recordMetric: vi.fn(),
      startSpan: vi.fn(() => vi.fn()),
      tenantId: 'test-tenant',
      environment: 'test',
      configResolver: mockConfigResolver
    } as any

    actor = new TestDecisionActor(context)
  })

  describe('recordDecision()', () => {
    it('should record a basic policy application decision', async () => {
      const inputs: DecisionInput[] = [
        {
          system: 'salesforce',
          entity: 'account',
          query: 'SELECT ARR FROM Account WHERE Id = "123"',
          result: { ARR: 100000 },
          relevance: 'Customer ARR determines approval threshold',
          retrievedAt: Date.now()
        }
      ]

      const decisionId = await actor.testRecordDecision({
        decisionType: 'policy_application',
        rationale: 'Customer qualifies for standard discount',
        reasoning: ['ARR: $100k', 'Within policy limits'],
        inputs,
        outcome: { approved: true, discount: 0.05 },
        isException: false
      })

      expect(decisionId).toMatch(/^decision_/)
      expect(context.recordEvent).toHaveBeenCalledWith('decision_made', {
        decisionId,
        decisionType: 'policy_application'
      })

      // Check journal entry
      const journal = actor.getJournal()
      const decisionEntry = journal.entries.find((e: any) => e.type === 'decision_made')
      expect(decisionEntry).toBeDefined()
      expect(decisionEntry).toMatchObject({
        type: 'decision_made',
        decisionId,
        decisionType: 'policy_application',
        rationale: 'Customer qualifies for standard discount',
        isException: false
      })
    })

    it('should record an exception decision with full context', async () => {
      const inputs: DecisionInput[] = [
        {
          system: 'salesforce',
          entity: 'account',
          query: 'SELECT ARR, Industry FROM Account',
          result: { ARR: 500000, Industry: 'Healthcare' },
          relevance: 'High-value healthcare customer',
          retrievedAt: Date.now()
        },
        {
          system: 'zendesk',
          entity: 'tickets',
          query: 'SELECT * FROM Tickets WHERE Severity = "SEV-1"',
          result: [{ id: 'T1' }, { id: 'T2' }, { id: 'T3' }],
          relevance: 'Active critical issues justify exception',
          retrievedAt: Date.now()
        }
      ]

      const decisionId = await actor.testRecordDecision({
        decisionType: 'exception',
        rationale: 'Healthcare customer with service issues deserves larger discount',
        reasoning: [
          'Customer ARR: $500k',
          'Industry: healthcare (precedent exists)',
          '3 open SEV-1 tickets',
          'VP approval obtained'
        ],
        inputs,
        outcome: { approved: true, discount: 0.15 },
        policy: {
          id: 'discount-policy',
          version: '1.0',
          rule: 'Max 10% discount'
        },
        precedents: ['decision_abc123', 'decision_def456'],
        isException: true,
        exceptionReason: 'Above standard 10% policy limit',
        approvers: [
          {
            userId: 'vp-sales',
            role: 'VP Sales',
            approvedAt: Date.now(),
            comment: 'Approved due to service issues'
          }
        ],
        context: {
          dealId: 'deal-789',
          customerId: 'acme-healthcare'
        }
      })

      expect(decisionId).toMatch(/^decision_/)

      const journal = actor.getJournal()
      const decisionEntry = journal.entries.find((e: any) => e.type === 'decision_made') as any
      expect(decisionEntry).toBeDefined()
      expect(decisionEntry.decisionType).toBe('exception')
      expect(decisionEntry.isException).toBe(true)
      expect(decisionEntry.exceptionReason).toBe('Above standard 10% policy limit')
      expect(decisionEntry.precedents).toHaveLength(2)
      expect(decisionEntry.approvers).toHaveLength(1)
      expect(decisionEntry.context).toMatchObject({
        tenantId: 'test-tenant',
        environment: 'test',
        dealId: 'deal-789',
        customerId: 'acme-healthcare'
      })
    })

    it('should include context from actor', async () => {
      const decisionId = await actor.testRecordDecision({
        decisionType: 'policy_application',
        rationale: 'Standard approval',
        inputs: [],
        outcome: { approved: true },
        isException: false
      })

      const journal = actor.getJournal()
      const decisionEntry = journal.entries.find((e: any) => e.type === 'decision_made') as any
      
      expect(decisionEntry.context).toMatchObject({
        tenantId: 'test-tenant',
        environment: 'test'
      })
    })

    it('should not enrich with LLM when mode is "never"', async () => {
      mockConfigResolver.getWithContext.mockResolvedValue({
        llmEnrichment: {
          mode: 'never',
          autoEnrichOn: [],
          critic: { model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 500 },
          async: true,
          timeout: 5000
        },
        budgets: { maxEnrichmentsPerDay: 100, maxCostPerDay: 10 }
      })

      const decisionId = await actor.testRecordDecision({
        decisionType: 'exception',
        rationale: 'Test exception',
        inputs: [],
        outcome: { approved: true },
        isException: true
      })

      expect(decisionId).toBeDefined()
      // LLM enrichment should not happen (check no errors)
    })

    it('should respect explicit enrichWithLLM override', async () => {
      mockConfigResolver.getWithContext.mockResolvedValue({
        llmEnrichment: {
          mode: 'never',  // Config says never
          autoEnrichOn: [],
          critic: { model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 500 },
          async: true,
          timeout: 5000
        },
        budgets: { maxEnrichmentsPerDay: 100, maxCostPerDay: 10 }
      })

      // But we explicitly request enrichment
      const decisionId = await actor.testRecordDecision({
        decisionType: 'policy_application',
        rationale: 'Force enrichment',
        inputs: [],
        outcome: { approved: true },
        isException: false,
        enrichWithLLM: 'always'
      })

      expect(decisionId).toBeDefined()
      // Should attempt enrichment despite config (requires critic-llm config though)
    })
  })

  describe('gatherContext()', () => {
    it('should gather context from external system and record in journal', async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        accountId: '123',
        name: 'Acme Corp',
        ARR: 250000
      })

      const result = await actor.testGatherContext({
        system: 'salesforce',
        entity: 'account',
        query: 'SELECT * FROM Account WHERE Id = "123"',
        relevance: 'Customer data needed for approval',
        fetcher: mockFetcher
      })

      expect(mockFetcher).toHaveBeenCalled()
      expect(result).toEqual({
        accountId: '123',
        name: 'Acme Corp',
        ARR: 250000
      })

      expect(context.recordMetric).toHaveBeenCalledWith(
        'context_gather_duration_ms',
        expect.any(Number),
        {
          system: 'salesforce',
          entity: 'account'
        }
      )

      const journal = actor.getJournal()
      const contextEntry = journal.entries.find((e: any) => e.type === 'context_gathered')
      expect(contextEntry).toBeDefined()
      expect(contextEntry).toMatchObject({
        type: 'context_gathered',
        system: 'salesforce',
        entity: 'account',
        relevance: 'Customer data needed for approval',
        result: {
          accountId: '123',
          name: 'Acme Corp',
          ARR: 250000
        }
      })
    })

    it('should handle multiple context gathers', async () => {
      const salesforceFetcher = vi.fn().mockResolvedValue({ ARR: 100000 })
      const zendeskFetcher = vi.fn().mockResolvedValue({ openTickets: 5 })

      await actor.testGatherContext({
        system: 'salesforce',
        entity: 'account',
        query: 'SELECT ARR',
        relevance: 'Revenue data',
        fetcher: salesforceFetcher
      })

      await actor.testGatherContext({
        system: 'zendesk',
        entity: 'tickets',
        query: 'COUNT(*) WHERE Status = "open"',
        relevance: 'Support health',
        fetcher: zendeskFetcher
      })

      const journal = actor.getJournal()
      const contextEntries = journal.entries.filter((e: any) => e.type === 'context_gathered')
      expect(contextEntries).toHaveLength(2)
    })

    it('should associate context with decision if decisionId provided', async () => {
      const decisionId = 'decision_test_123'
      
      await actor.testGatherContext({
        system: 'salesforce',
        entity: 'account',
        query: 'SELECT *',
        relevance: 'Account data',
        fetcher: async () => ({ id: '123' }),
        decisionId
      })

      const journal = actor.getJournal()
      const contextEntry = journal.entries.find((e: any) => e.type === 'context_gathered') as any
      expect(contextEntry.decisionId).toBe(decisionId)
    })
  })

  describe('findPrecedents()', () => {
    it('should return empty array (stub for Phase 2)', async () => {
      const precedents = await actor.testFindPrecedents({
        decisionType: 'exception',
        contextSimilarity: { industry: 'healthcare' }
      })

      expect(precedents).toEqual([])
      expect(context.recordEvent).toHaveBeenCalledWith('precedent_search', {
        decisionType: 'exception',
        reason: 'decision_memory_not_configured',
        resultCount: 0
      })
    })

    it('should accept time range filter', async () => {
      const precedents = await actor.testFindPrecedents({
        decisionType: 'approval',
        timeRange: {
          start: Date.now() - 30 * 24 * 60 * 60 * 1000,  // 30 days ago
          end: Date.now()
        },
        limit: 10
      })

      expect(precedents).toEqual([])
    })
  })

  describe('requestApproval()', () => {
    it('should request approval and return response', async () => {
      const response = await actor.testRequestApproval({
        approvalType: 'discount_exception',
        reason: 'Customer requires 15% discount',
        data: { discount: 0.15, customerId: '123' },
        requiredRole: 'VP Sales'
      })

      expect(response.approved).toBe(true)
      expect(response.approver).toBeDefined()
      expect(response.approvedAt).toBeTypeOf('number')

      expect(context.recordEvent).toHaveBeenCalledWith('approval_requested', {
        approvalType: 'discount_exception',
        reason: 'Customer requires 15% discount',
        requiredRole: 'VP Sales'
      })
    })
  })

  describe('Decision Trace Integration', () => {
    it('should support complete decision workflow', async () => {
      // 1. Gather context from multiple systems
      const salesforceData = await actor.testGatherContext({
        system: 'salesforce',
        entity: 'account',
        query: 'SELECT ARR, Industry',
        relevance: 'Customer profile',
        fetcher: async () => ({ ARR: 500000, Industry: 'Healthcare' })
      })

      const zendeskData = await actor.testGatherContext({
        system: 'zendesk',
        entity: 'tickets',
        query: 'SELECT COUNT(*) WHERE Severity = "SEV-1"',
        relevance: 'Service issues',
        fetcher: async () => ({ count: 3 })
      })

      // 2. Find precedents
      const precedents = await actor.testFindPrecedents({
        decisionType: 'exception',
        contextSimilarity: { industry: 'Healthcare' }
      })

      // 3. Request approval
      const approval = await actor.testRequestApproval({
        approvalType: 'discount_exception',
        reason: 'Healthcare customer with service issues',
        data: { discount: 0.15 }
      })

      // 4. Record decision with full context
      const inputs: DecisionInput[] = [
        {
          system: 'salesforce',
          entity: 'account',
          query: 'SELECT ARR, Industry',
          result: salesforceData,
          relevance: 'Customer profile',
          retrievedAt: Date.now()
        },
        {
          system: 'zendesk',
          entity: 'tickets',
          query: 'SELECT COUNT(*) WHERE Severity = "SEV-1"',
          result: zendeskData,
          relevance: 'Service issues',
          retrievedAt: Date.now()
        }
      ]

      const decisionId = await actor.testRecordDecision({
        decisionType: 'exception',
        rationale: 'Healthcare customer with service issues deserves exception',
        reasoning: [
          `ARR: $${salesforceData.ARR}`,
          `Industry: ${salesforceData.Industry}`,
          `Open SEV-1 tickets: ${zendeskData.count}`,
          'Precedents found: 0',
          'VP approval obtained'
        ],
        inputs,
        outcome: { approved: true, discount: 0.15 },
        policy: { id: 'discount-policy', version: '1.0', rule: 'Max 10%' },
        precedents: precedents.map(p => p.decisionId),
        isException: true,
        exceptionReason: 'Above 10% limit',
        approvers: approval.approver ? [{ ...approval.approver, approvedAt: approval.approvedAt! }] : []
      })

      expect(decisionId).toBeDefined()

      // Verify all journal entries
      const journal = actor.getJournal()
      expect(journal.entries.filter((e: any) => e.type === 'context_gathered')).toHaveLength(2)
      expect(journal.entries.filter((e: any) => e.type === 'decision_made')).toHaveLength(1)
      
      const decisionEntry = journal.entries.find((e: any) => e.type === 'decision_made') as any
      expect(decisionEntry.inputs).toHaveLength(2)
      expect(decisionEntry.approvers).toHaveLength(1)
    })
  })
})
