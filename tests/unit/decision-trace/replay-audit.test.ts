import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Actor } from '../../../src/actor/actor'
import type { ActorContext } from '../../../src/actor/journal'

class TestReplayActor extends Actor {
  async execute(input: any) {
    return { success: true, input }
  }

  // Expose protected methods for testing
  public async testRecordDecision(params: Parameters<typeof this.recordDecision>[0]) {
    return this.recordDecision(params)
  }

  public async testGetDecisionExplanation(decisionId: string) {
    return this.getDecisionExplanation(decisionId)
  }

  public async testReplayDecision(decisionId: string) {
    return this.replayDecision(decisionId)
  }

  public async testTrackDecisionOutcome(decisionId: string, outcome: Parameters<typeof this.trackDecisionOutcome>[1]) {
    return this.trackDecisionOutcome(decisionId, outcome)
  }

  public testGetDecisionsFromJournal(filter?: Parameters<typeof this.getDecisionsFromJournal>[0]) {
    return this.getDecisionsFromJournal(filter)
  }

  public getJournal() {
    return (this as any).journal
  }
}

describe('Decision Replay & Audit', () => {
  let actor: TestReplayActor
  let context: ActorContext
  let mockConfigResolver: any

  beforeEach(() => {
    mockConfigResolver = {
      getWithContext: vi.fn().mockResolvedValue(null)
    }

    context = {
      actorId: 'test-actor-1',
      actorType: 'TestReplayActor',
      recordEvent: vi.fn(),
      recordMetric: vi.fn(),
      startSpan: vi.fn(() => vi.fn()),
      tenantId: 'test-tenant',
      environment: 'test',
      userId: 'test-user-123',
      configResolver: mockConfigResolver
    } as any

    actor = new TestReplayActor(context)
  })

  describe('getDecisionExplanation()', () => {
    it('should return complete audit trail for a decision', async () => {
      // Record a decision
      const decisionId = await actor.testRecordDecision({
        decisionType: 'exception',
        rationale: 'Healthcare customer with service issues',
        reasoning: ['ARR: $500k', 'Industry: Healthcare', '3 SEV-1 tickets'],
        inputs: [
          {
            system: 'salesforce',
            entity: 'account',
            query: 'SELECT ARR, Industry',
            result: { ARR: 500000, Industry: 'Healthcare' },
            relevance: 'Customer profile',
            retrievedAt: Date.now()
          },
          {
            system: 'zendesk',
            entity: 'tickets',
            query: 'SELECT COUNT(*) WHERE Severity = "SEV-1"',
            result: { count: 3 },
            relevance: 'Service issues',
            retrievedAt: Date.now()
          }
        ],
        outcome: { approved: true, discount: 0.15 },
        policy: {
          id: 'discount-policy',
          version: '1.0',
          rule: 'Max 10% discount'
        },
        precedents: ['dec-123', 'dec-456'],
        isException: true,
        exceptionReason: 'Above 10% limit',
        approvers: [
          {
            userId: 'vp-sales',
            role: 'VP Sales',
            approvedAt: Date.now(),
            comment: 'Approved due to service issues'
          }
        ],
        context: { dealId: 'deal-789' }
      })

      // Get explanation
      const explanation = await actor.testGetDecisionExplanation(decisionId)

      expect(explanation.decision).toBeDefined()
      expect(explanation.decision.decisionId).toBe(decisionId)
      expect(explanation.decision.rationale).toBe('Healthcare customer with service issues')

      expect(explanation.inputDetails).toHaveLength(2)
      expect(explanation.inputDetails[0].system).toBe('salesforce')
      expect(explanation.inputDetails[1].system).toBe('zendesk')

      expect(explanation.policyDetails).toBeDefined()
      expect(explanation.policyDetails.id).toBe('discount-policy')
      expect(explanation.policyDetails.version).toBe('1.0')

      expect(explanation.approvalChain).toHaveLength(1)
      expect(explanation.approvalChain[0].userId).toBe('vp-sales')
      expect(explanation.approvalChain[0].role).toBe('VP Sales')

      expect(explanation.timeline).toBeDefined()
      expect(explanation.timeline.length).toBeGreaterThan(0)
      expect(explanation.timeline.some(t => t.event === 'decision_made')).toBe(true)
    })

    it('should throw error if decision not found', async () => {
      await expect(
        actor.testGetDecisionExplanation('non-existent-id')
      ).rejects.toThrow('Decision non-existent-id not found in journal')
    })

    it('should handle decision without policy', async () => {
      const decisionId = await actor.testRecordDecision({
        decisionType: 'policy_application',
        rationale: 'Standard approval',
        inputs: [],
        outcome: { approved: true },
        isException: false
      })

      const explanation = await actor.testGetDecisionExplanation(decisionId)

      expect(explanation.policyDetails.id).toBe('none')
      expect(explanation.policyDetails.rule).toBe('No policy applied')
    })
  })

  describe('replayDecision()', () => {
    it('should replay decision and detect policy changes', async () => {
      // Mock original policy
      mockConfigResolver.getWithContext.mockResolvedValueOnce({
        maxDiscount: 0.10,
        rules: 'Max 10% discount'
      })

      const decisionId = await actor.testRecordDecision({
        decisionType: 'exception',
        rationale: 'Test exception',
        inputs: [],
        outcome: { approved: true, discount: 0.15 },
        policy: {
          id: 'discount-policy',
          version: '1.0',
          rule: 'Max 10% discount'
        },
        isException: true
      })

      // Mock changed policy
      mockConfigResolver.getWithContext.mockResolvedValue({
        maxDiscount: 0.15,
        rules: 'Max 15% discount'  // Policy changed!
      })

      const replay = await actor.testReplayDecision(decisionId)

      expect(replay.originalDecision.decisionId).toBe(decisionId)
      expect(replay.policyChanged).toBe(true)
      expect(replay.currentPolicy).toBeDefined()
      expect(replay.wouldDecideDifferently).toBe(true)
      expect(replay.differences.length).toBeGreaterThan(0)
      expect(replay.differences.some(d => d.aspect === 'policy')).toBe(true)

      expect(context.recordEvent).toHaveBeenCalledWith('decision_replayed', {
        decisionId,
        policyChanged: true,
        wouldDecideDifferently: true
      })
    })

    it('should handle unchanged policy', async () => {
      const policyValue = {
        maxDiscount: 0.10,
        rules: 'Max 10% discount'
      }

      mockConfigResolver.getWithContext.mockResolvedValue(policyValue)

      const decisionId = await actor.testRecordDecision({
        decisionType: 'policy_application',
        rationale: 'Standard approval',
        inputs: [],
        outcome: { approved: true },
        policy: {
          id: 'discount-policy',
          version: '1.0',
          rule: JSON.stringify(policyValue)
        },
        isException: false
      })

      const replay = await actor.testReplayDecision(decisionId)

      expect(replay.policyChanged).toBe(false)
      expect(replay.wouldDecideDifferently).toBe(false)
    })

    it('should handle decision without policy', async () => {
      const decisionId = await actor.testRecordDecision({
        decisionType: 'policy_application',
        rationale: 'No policy',
        inputs: [],
        outcome: { approved: true },
        isException: false
      })

      const replay = await actor.testReplayDecision(decisionId)

      expect(replay.policyChanged).toBe(false)
      expect(replay.currentPolicy).toBeUndefined()
    })
  })

  describe('trackDecisionOutcome()', () => {
    it('should track successful outcome', async () => {
      const decisionId = await actor.testRecordDecision({
        decisionType: 'policy_application',
        rationale: 'Approved discount',
        inputs: [],
        outcome: { approved: true, discount: 0.05 },
        isException: false
      })

      await actor.testTrackDecisionOutcome(decisionId, {
        wasCorrect: true,
        actualResult: { customerAccepted: true },
        feedback: 'Customer was satisfied'
      })

      const journal = actor.getJournal()
      const outcomeEntry = journal.entries.find(
        (e: any) => e.type === 'decision_outcome_tracked' && e.decisionId === decisionId
      )

      expect(outcomeEntry).toBeDefined()
      expect((outcomeEntry as any).wasCorrect).toBe(true)
      expect((outcomeEntry as any).feedback).toBe('Customer was satisfied')
      expect((outcomeEntry as any).trackedBy).toBe('test-user-123')

      expect(context.recordEvent).toHaveBeenCalledWith('decision_outcome_tracked', {
        decisionId,
        wasCorrect: true
      })

      expect(context.recordMetric).toHaveBeenCalledWith('decision_accuracy', 1, {
        decisionId,
        actorType: 'TestReplayActor'
      })
    })

    it('should track failed outcome', async () => {
      const decisionId = await actor.testRecordDecision({
        decisionType: 'exception',
        rationale: 'Large discount',
        inputs: [],
        outcome: { approved: true, discount: 0.20 },
        isException: true
      })

      await actor.testTrackDecisionOutcome(decisionId, {
        wasCorrect: false,
        actualResult: { customerRejected: true },
        feedback: 'Discount was too high, customer suspicious'
      })

      const journal = actor.getJournal()
      const outcomeEntry = journal.entries.find(
        (e: any) => e.type === 'decision_outcome_tracked' && e.decisionId === decisionId
      )

      expect(outcomeEntry).toBeDefined()
      expect((outcomeEntry as any).wasCorrect).toBe(false)

      expect(context.recordMetric).toHaveBeenCalledWith('decision_accuracy', 0, {
        decisionId,
        actorType: 'TestReplayActor'
      })
    })

    it('should include outcome in decision explanation', async () => {
      const decisionId = await actor.testRecordDecision({
        decisionType: 'policy_application',
        rationale: 'Test decision',
        inputs: [],
        outcome: { approved: true },
        isException: false
      })

      await actor.testTrackDecisionOutcome(decisionId, {
        wasCorrect: true,
        feedback: 'Great decision'
      })

      const explanation = await actor.testGetDecisionExplanation(decisionId)

      expect(explanation.outcome).toBeDefined()
      expect(explanation.outcome?.wasCorrect).toBe(true)
      expect(explanation.outcome?.feedback).toBe('Great decision')
    })
  })

  describe('getDecisionsFromJournal()', () => {
    beforeEach(async () => {
      // Create multiple decisions
      await actor.testRecordDecision({
        decisionType: 'policy_application',
        rationale: 'Standard approval 1',
        inputs: [],
        outcome: { approved: true },
        isException: false
      })

      await actor.testRecordDecision({
        decisionType: 'exception',
        rationale: 'Exception 1',
        inputs: [],
        outcome: { approved: true },
        isException: true
      })

      await actor.testRecordDecision({
        decisionType: 'policy_application',
        rationale: 'Standard approval 2',
        inputs: [],
        outcome: { approved: true },
        isException: false
      })

      await actor.testRecordDecision({
        decisionType: 'approval',
        rationale: 'Approval request',
        inputs: [],
        outcome: { approved: true },
        isException: false
      })
    })

    it('should return all decisions without filter', () => {
      const decisions = actor.testGetDecisionsFromJournal()
      expect(decisions).toHaveLength(4)
    })

    it('should filter by decision type', () => {
      const exceptions = actor.testGetDecisionsFromJournal({
        decisionType: 'exception'
      })

      expect(exceptions).toHaveLength(1)
      expect(exceptions[0].rationale).toBe('Exception 1')
    })

    it('should filter by isException flag', () => {
      const exceptions = actor.testGetDecisionsFromJournal({
        isException: true
      })

      expect(exceptions).toHaveLength(1)

      const nonExceptions = actor.testGetDecisionsFromJournal({
        isException: false
      })

      expect(nonExceptions).toHaveLength(3)
    })

    it('should filter by time range', () => {
      const now = Date.now()
      const decisions = actor.testGetDecisionsFromJournal({
        startTime: 0,  // From beginning of time
        endTime: now + 10000  // To future
      })

      expect(decisions).toHaveLength(4)  // All recent
    })

    it('should combine filters', () => {
      const decisions = actor.testGetDecisionsFromJournal({
        decisionType: 'policy_application',
        isException: false
      })

      expect(decisions).toHaveLength(2)
      expect(decisions.every(d => d.decisionType === 'policy_application')).toBe(true)
      expect(decisions.every(d => !d.isException)).toBe(true)
    })
  })
})
