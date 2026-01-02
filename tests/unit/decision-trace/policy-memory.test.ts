import { describe, it, expect, beforeEach, vi } from 'vitest'
import { InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage'
import { PolicyMemory, Policy, PolicyABTest } from '../../../src/memory/graph/policy-memory'
import { DecisionMemory } from '../../../src/memory/graph/decision-memory'
import { ActorContext } from '../../../src/actor/actor-context'
import type { LamportClock } from '../../../src/timing/lamport-clock'

describe('PolicyMemory', () => {
  let storage: InMemoryGraphStorage
  let policyMemory: PolicyMemory
  let decisionMemory: DecisionMemory
  let context: ActorContext

  beforeEach(() => {
    storage = new InMemoryGraphStorage()
    
    // Create mock context
    context = {
      actorId: 'test-actor',
      requestId: 'test-request',
      timestamp: Date.now(),
      recordEvent: vi.fn(),
      recordMetric: vi.fn()
    } as any

    // Mock embedding service (16D for tests)
    const mockEmbeddingService = {
      embed: async (text: string) => {
        return Array.from({ length: 16 }, () => Math.random())
      }
    }

    // Mock lamport clock
    const mockClock = {
      tick: (remoteTime?: number) => 1,
      getTime: () => 1
    } as any

    decisionMemory = new DecisionMemory(
      'test-actor',
      storage,
      mockClock,
      {
        embeddingService: mockEmbeddingService,
        enableEmbeddings: true
      }
    )

    policyMemory = new PolicyMemory(
      'test-actor',
      storage,
      mockClock,
      { decisionMemory }
    )
  })

  describe('Policy Versioning', () => {
    it('should add a policy', async () => {
      const policy: Policy = {
        id: 'discount-policy',
        name: 'Standard Discount Policy',
        version: '1.0',
        rule: 'If customer tier is gold, apply 15% discount',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      }

      await policyMemory.addPolicy(policy)

      const stored = await policyMemory.getPolicy('discount-policy')
      expect(stored).toBeTruthy()
      expect(stored?.version).toBe('1.0')
      expect(stored?.rule).toContain('15% discount')
    })

    it('should add policy version with change tracking', async () => {
      // Add v1.0
      const v1: Policy = {
        id: 'discount-policy',
        name: 'Standard Discount Policy',
        version: '1.0',
        rule: 'If customer tier is gold, apply 15% discount',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      }
      await policyMemory.addPolicy(v1)

      // Add v2.0 with reference to v1.0
      const v2: Policy = {
        id: 'discount-policy',
        name: 'Standard Discount Policy',
        version: '2.0',
        rule: 'If customer tier is gold, apply 20% discount',
        previousVersion: '1.0',
        changeReason: 'Increase retention by offering higher discount',
        isActive: true,
        createdAt: Date.now() + 1000,
        createdBy: 'admin'
      }
      await policyMemory.addPolicy(v2)

      const current = await policyMemory.getPolicy('discount-policy')
      expect(current?.version).toBe('2.0')
      expect(current?.previousVersion).toBe('1.0')
      expect(current?.changeReason).toContain('retention')
    })

    it('should get specific policy version', async () => {
      const v1: Policy = {
        id: 'discount-policy',
        name: 'Standard Discount Policy',
        version: '1.0',
        rule: '15% discount',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      }
      await policyMemory.addPolicy(v1)

      const v2: Policy = {
        id: 'discount-policy',
        name: 'Standard Discount Policy',
        version: '2.0',
        rule: '20% discount',
        previousVersion: '1.0',
        isActive: true,
        createdAt: Date.now() + 1000,
        createdBy: 'admin'
      }
      await policyMemory.addPolicy(v2)

      const oldVersion = await policyMemory.getPolicy('discount-policy', '1.0')
      expect(oldVersion?.version).toBe('1.0')
      expect(oldVersion?.rule).toContain('15%')
    })

    it('should retrieve full policy history', async () => {
      // Add 3 versions
      for (let i = 1; i <= 3; i++) {
        const policy: Policy = {
          id: 'discount-policy',
          name: 'Standard Discount Policy',
          version: `${i}.0`,
          rule: `Apply ${10 + i * 5}% discount`,
          previousVersion: i > 1 ? `${i - 1}.0` : undefined,
          changeReason: i > 1 ? `Update to v${i}.0` : undefined,
          isActive: i === 3,
          createdAt: Date.now() + i * 1000,
          createdBy: 'admin'
        }
        await policyMemory.addPolicy(policy)
      }

      const history = await policyMemory.getPolicyHistory('discount-policy')
      expect(history.length).toBe(3)
      expect(history[0].version).toBe('1.0')
      expect(history[1].version).toBe('2.0')
      expect(history[2].version).toBe('3.0')
    })
  })

  describe('Effectiveness Tracking', () => {
    it('should calculate policy effectiveness', async () => {
      // Add policy
      const policy: Policy = {
        id: 'approval-policy',
        name: 'Loan Approval Policy',
        version: '1.0',
        rule: 'Approve if credit score > 700',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      }
      await policyMemory.addPolicy(policy)

      // Add decisions that reference this policy
      const baseTime = Date.now()
      const decisions = [
        {
          decisionId: 'd1',
          policy: { id: 'approval-policy', version: '1.0' },
          outcome: { wasCorrect: true },
          timestamp: baseTime
        },
        {
          decisionId: 'd2',
          policy: { id: 'approval-policy', version: '1.0' },
          outcome: { wasCorrect: true },
          timestamp: baseTime + 1000
        },
        {
          decisionId: 'd3',
          policy: { id: 'approval-policy', version: '1.0' },
          outcome: { wasCorrect: false },
          isException: true,
          exceptionReason: 'Credit score borderline',
          timestamp: baseTime + 2000
        },
        {
          decisionId: 'd4',
          policy: { id: 'approval-policy', version: '1.0' },
          outcome: { wasCorrect: true },
          timestamp: baseTime + 3000
        }
      ]

      for (const dec of decisions) {
        await decisionMemory.addDecisionTrace({
          decisionId: dec.decisionId,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'approval',
          decision: { approved: true },
          context: {},
          reasoning: ['Policy applied'],
          rationale: 'Policy applied',
          timestamp: dec.timestamp,
          policy: dec.policy,
          isException: dec.isException || false,
          exceptionReason: dec.exceptionReason,
          inputs: [],
          outcome: { wasCorrect: dec.outcome?.wasCorrect }
        })
      }

      // Calculate effectiveness
      const effectiveness = await policyMemory.calculatePolicyEffectiveness(
        'approval-policy',
        '1.0',
        { start: baseTime - 1000, end: baseTime + 10000 }
      )

      expect(effectiveness.totalDecisions).toBe(4)
      expect(effectiveness.successfulDecisions).toBe(3)
      expect(effectiveness.failedDecisions).toBe(1)
      expect(effectiveness.successRate).toBeCloseTo(0.75, 2)
      expect(effectiveness.exceptionRate).toBeCloseTo(0.25, 2)
      expect(effectiveness.topExceptionReasons.length).toBeGreaterThan(0)
    })

    it('should handle policy with no decisions', async () => {
      const policy: Policy = {
        id: 'new-policy',
        name: 'New Policy',
        version: '1.0',
        rule: 'Some rule',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      }
      await policyMemory.addPolicy(policy)

      const effectiveness = await policyMemory.calculatePolicyEffectiveness(
        'new-policy',
        '1.0',
        { start: Date.now() - 1000, end: Date.now() + 1000 }
      )

      expect(effectiveness.totalDecisions).toBe(0)
      expect(effectiveness.successRate).toBe(0)
      expect(effectiveness.exceptionRate).toBe(0)
    })
  })

  describe('A/B Testing', () => {
    it('should create A/B test', async () => {
      // Add control and treatment policies
      await policyMemory.addPolicy({
        id: 'discount-policy',
        name: 'Discount Policy',
        version: '1.0',
        rule: 'Apply 15% discount',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      })

      await policyMemory.addPolicy({
        id: 'discount-policy',
        name: 'Discount Policy',
        version: '2.0',
        rule: 'Apply 20% discount',
        previousVersion: '1.0',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      })

      // Create A/B test
      const test: PolicyABTest = {
        id: 'ab-test-1',
        name: 'Discount Increase Test',
        controlPolicy: { id: 'discount-policy', version: '1.0' },
        treatmentPolicy: { id: 'discount-policy', version: '2.0' },
        trafficSplit: 0.5,
        startTime: Date.now(),
        isActive: true,
        createdBy: 'admin'
      }

      await policyMemory.createABTest(test)

      const stored = await policyMemory.getABTest('ab-test-1')
      expect(stored).toBeTruthy()
      expect(stored?.trafficSplit).toBe(0.5)
      expect(stored?.controlPolicy.version).toBe('1.0')
      expect(stored?.treatmentPolicy.version).toBe('2.0')
    })

    it('should calculate A/B test results', async () => {
      // Setup policies
      await policyMemory.addPolicy({
        id: 'approval-policy',
        name: 'Approval Policy',
        version: '1.0',
        rule: 'Credit score > 700',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      })

      await policyMemory.addPolicy({
        id: 'approval-policy',
        name: 'Approval Policy',
        version: '2.0',
        rule: 'Credit score > 650',
        previousVersion: '1.0',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      })

      // Create test
      const test: PolicyABTest = {
        id: 'ab-test-approval',
        name: 'Approval Threshold Test',
        controlPolicy: { id: 'approval-policy', version: '1.0' },
        treatmentPolicy: { id: 'approval-policy', version: '2.0' },
        trafficSplit: 0.5,
        startTime: Date.now(),
        isActive: true,
        createdBy: 'admin'
      }
      await policyMemory.createABTest(test)

      // Add decisions for control group (v1.0)
      const baseTime = Date.now()
      for (let i = 0; i < 10; i++) {
        await decisionMemory.addDecisionTrace({
          decisionId: `control-${i}`,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'approval',
          decision: { approved: i < 7 }, // 70% approved
          context: {},
          reasoning: ['Control group'],
          rationale: 'Control group',
          timestamp: baseTime + i * 100,
          policy: { id: 'approval-policy', version: '1.0' },
          abTest: { testId: 'ab-test-approval', variant: 'control' },
          inputs: [],
          isException: false,
          outcome: { wasCorrect: i < 7 } // 70% success
        })
      }

      // Add decisions for treatment group (v2.0)
      for (let i = 0; i < 10; i++) {
        await decisionMemory.addDecisionTrace({
          decisionId: `treatment-${i}`,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'approval',
          decision: { approved: i < 9 }, // 90% approved
          context: {},
          reasoning: ['Treatment group'],
          rationale: 'Treatment group',
          timestamp: baseTime + i * 100,
          policy: { id: 'approval-policy', version: '2.0' },
          abTest: { testId: 'ab-test-approval', variant: 'treatment' },
          inputs: [],
          isException: false,
          outcome: { wasCorrect: i < 9 } // 90% success
        })
      }

      // Calculate results
      const results = await policyMemory.calculateABTestResults('ab-test-approval')
      
      expect(results).toBeTruthy()
      expect(results?.control.totalDecisions).toBe(10)
      expect(results?.treatment.totalDecisions).toBe(10)
      expect(results?.control.successRate).toBeCloseTo(0.7, 1)
      expect(results?.treatment.successRate).toBeCloseTo(0.9, 1)
      expect(results?.isSignificant).toBeDefined()
      expect(results?.winner).toBeDefined()
    })

    it('should handle test with no data', async () => {
      await policyMemory.addPolicy({
        id: 'test-policy',
        name: 'Test Policy',
        version: '1.0',
        rule: 'Rule 1',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      })

      await policyMemory.addPolicy({
        id: 'test-policy',
        name: 'Test Policy',
        version: '2.0',
        rule: 'Rule 2',
        previousVersion: '1.0',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      })

      const test: PolicyABTest = {
        id: 'empty-test',
        name: 'Empty Test',
        controlPolicy: { id: 'test-policy', version: '1.0' },
        treatmentPolicy: { id: 'test-policy', version: '2.0' },
        trafficSplit: 0.5,
        startTime: Date.now(),
        isActive: true,
        createdBy: 'admin'
      }
      await policyMemory.createABTest(test)

      const results = await policyMemory.calculateABTestResults('empty-test')
      expect(results).toBeTruthy()
      expect(results?.control.totalDecisions).toBe(0)
      expect(results?.treatment.totalDecisions).toBe(0)
    })
  })

  describe('Policy Suggestions', () => {
    it('should generate policy suggestions from exception patterns', async () => {
      // Add policy
      const policy: Policy = {
        id: 'approval-policy',
        name: 'Approval Policy',
        version: '1.0',
        rule: 'Approve if credit score > 700',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      }
      await policyMemory.addPolicy(policy)

      // Add decisions with recurring exception pattern
      const baseTime = Date.now()
      for (let i = 0; i < 10; i++) {
        await decisionMemory.addDecisionTrace({
          decisionId: `d-${i}`,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'approval',
          decision: { approved: false },
          context: { creditScore: 680 + i }, // All near 700 threshold
          reasoning: ['Below threshold'],
          rationale: 'Below threshold',
          timestamp: baseTime + i * 100,
          policy: { id: 'approval-policy', version: '1.0' },
          isException: true,
          exceptionReason: 'Credit score 680-690 range requires manual review',
          inputs: [],
          outcome: { approved: false }
        })
      }

      // Generate suggestions
      const suggestions = await policyMemory.generatePolicySuggestions(
        'approval-policy',
        3 // Min frequency
      )

      expect(Array.isArray(suggestions)).toBe(true)
      if (suggestions.length > 0) {
        expect(suggestions[0].pattern).toBeDefined()
        expect(suggestions[0].pattern.commonFactors.length).toBeGreaterThan(0)
        expect(suggestions[0].pattern.frequency).toBeGreaterThanOrEqual(3)
        expect(suggestions[0].suggestedRule).toBeDefined()
        expect(suggestions[0].changeReason).toBeDefined()
      }
    })

    it('should filter suggestions by minimum frequency', async () => {
      const policy: Policy = {
        id: 'discount-policy',
        name: 'Discount Policy',
        version: '1.0',
        rule: 'Standard discount',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      }
      await policyMemory.addPolicy(policy)

      // Add low-frequency exceptions
      for (let i = 0; i < 3; i++) {
        await decisionMemory.addDecisionTrace({
          decisionId: `d-${i}`,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'discount',
          decision: { discount: 0 },
          context: {},
          reasoning: ['No discount'],
          rationale: 'No discount',
          timestamp: Date.now() + i * 100,
          policy: { id: 'discount-policy', version: '1.0' },
          isException: true,
          exceptionReason: `Rare case ${i}`,
          inputs: [],
          outcome: { discount: 0 }
        })
      }

      const suggestions = await policyMemory.generatePolicySuggestions(
        'discount-policy',
        10 // High min frequency
      )

      expect(suggestions.length).toBe(0) // No patterns meet threshold
    })
  })

  describe('Impact Analysis', () => {
    it('should analyze policy impact', async () => {
      // Add policies
      await policyMemory.addPolicy({
        id: 'approval-policy',
        name: 'Approval Policy',
        version: '1.0',
        rule: 'Credit score > 700',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      })

      await policyMemory.addPolicy({
        id: 'approval-policy',
        name: 'Approval Policy',
        version: '2.0',
        rule: 'Credit score > 650',
        previousVersion: '1.0',
        isActive: false,
        createdAt: Date.now(),
        createdBy: 'admin'
      })

      // Add historical decisions
      const baseTime = Date.now()
      for (let i = 0; i < 20; i++) {
        const creditScore = 600 + i * 10 // Range: 600-790
        await decisionMemory.addDecisionTrace({
          decisionId: `hist-${i}`,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'approval',
          decision: { approved: creditScore > 700 },
          context: { creditScore },
          reasoning: ['Historical decision'],
          rationale: 'Historical decision',
          timestamp: baseTime + i * 100,
          policy: { id: 'approval-policy', version: '1.0' },
          inputs: [],
          isException: false,
          outcome: { approved: creditScore > 700 }
        })
      }

      // Analyze impact of v1.0 -> v2.0
      const impact = await policyMemory.analyzePolicyImpact(
        'approval-policy',
        '1.0',
        '2.0'
      )

      expect(impact.affectedDecisions.total).toBeGreaterThan(0)
      expect(impact.projectedChanges).toBeDefined()
      expect(impact.risk).toBeDefined()
      expect(['low', 'medium', 'high']).toContain(impact.risk)
    })

    it('should handle impact analysis with no historical data', async () => {
      await policyMemory.addPolicy({
        id: 'new-policy',
        name: 'New Policy',
        version: '1.0',
        rule: 'Rule 1',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'admin'
      })

      await policyMemory.addPolicy({
        id: 'new-policy',
        name: 'New Policy',
        version: '2.0',
        rule: 'Rule 2',
        previousVersion: '1.0',
        isActive: false,
        createdAt: Date.now(),
        createdBy: 'admin'
      })

      const impact = await policyMemory.analyzePolicyImpact(
        'new-policy',
        '1.0',
        '2.0'
      )

      expect(impact.affectedDecisions.total).toBe(0)
      expect(impact.risk).toBe('low')
    })
  })

  describe('Actor Integration', () => {
    it('should work with Actor.getActivePolicy()', async () => {
      // This test verifies the integration point
      // In real usage, Actor would call policyMemory.getPolicy()
      
      const policy: Policy = {
        id: 'actor-policy',
        name: 'Actor Policy',
        version: '1.0',
        rule: 'Actor rule',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'system'
      }
      await policyMemory.addPolicy(policy)

      const retrieved = await policyMemory.getPolicy('actor-policy')
      expect(retrieved).toBeTruthy()
      expect(retrieved?.id).toBe('actor-policy')
      expect(retrieved?.isActive).toBe(true)
    })

    it('should support A/B test variant selection', async () => {
      // Setup A/B test
      await policyMemory.addPolicy({
        id: 'actor-policy',
        name: 'Actor Policy',
        version: '1.0',
        rule: 'Version 1',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'system'
      })

      await policyMemory.addPolicy({
        id: 'actor-policy',
        name: 'Actor Policy',
        version: '2.0',
        rule: 'Version 2',
        previousVersion: '1.0',
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'system'
      })

      const test: PolicyABTest = {
        id: 'actor-test',
        name: 'Actor A/B Test',
        controlPolicy: { id: 'actor-policy', version: '1.0' },
        treatmentPolicy: { id: 'actor-policy', version: '2.0' },
        trafficSplit: 0.5,
        startTime: Date.now(),
        isActive: true,
        createdBy: 'system'
      }
      await policyMemory.createABTest(test)

      // Actor.getActivePolicy() would check for active tests
      const activeTest = await policyMemory.getABTest('actor-test')
      expect(activeTest).toBeTruthy()
      expect(activeTest?.isActive).toBe(true)

      // Could get either control or treatment
      const controlPolicy = await policyMemory.getPolicy(
        activeTest!.controlPolicy.id,
        activeTest!.controlPolicy.version
      )
      expect(controlPolicy?.version).toBe('1.0')

      const treatmentPolicy = await policyMemory.getPolicy(
        activeTest!.treatmentPolicy.id,
        activeTest!.treatmentPolicy.version
      )
      expect(treatmentPolicy?.version).toBe('2.0')
    })
  })
})
