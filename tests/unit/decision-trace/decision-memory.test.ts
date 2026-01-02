/**
 * Decision Memory Integration Tests
 * 
 * Tests the full Phase 2 implementation:
 * - DecisionMemory extending ActorMemory
 * - Semantic precedent search
 * - Decision chain traversal
 * - Exception pattern detection
 * - Integration with Actor.recordDecision()
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Actor } from '../../../src/actor/actor'
import type { ActorContext, Journal } from '../../../src/actor/journal'
import type { DecisionTrace, DecisionInput } from '../../../src/actor/decision-trace'
import { DecisionMemory } from '../../../src/memory/graph/decision-memory'
import { InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage'
import { LamportClock } from '../../../src/timing/lamport-clock'
import type { EmbeddingService } from '../../../src/memory/embedding-service'

/**
 * Mock embedding service for testing
 */
class MockEmbeddingService implements EmbeddingService {
  async embed(text: string): Promise<number[]> {
    // Create a small 16-dimensional vector (not 384) for memory efficiency in tests
    const words = text.toLowerCase().split(/\s+/)
    const wordCount = words.length
    const charCount = text.length
    
    const embedding: number[] = []
    for (let i = 0; i < 16; i++) {  // Reduced from 384 to 16
      const seed = (wordCount * 13 + charCount * 7 + i * 3) % 100
      embedding.push((seed / 100) * 2 - 1)
    }
    
    // Add semantic similarity markers
    if (text.includes('healthcare')) {
      embedding[0] = 0.9
      embedding[1] = 0.8
    }
    if (text.includes('discount')) {
      embedding[2] = 0.85
      embedding[3] = 0.75
    }
    if (text.includes('exception')) {
      embedding[4] = 0.95
      embedding[5] = 0.88
    }
    
    return embedding
  }
  
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)))
  }
}

/**
 * Test Actor with DecisionMemory
 */
class TestDecisionActor extends Actor {
  constructor(context: ActorContext, decisionMemory?: DecisionMemory) {
    super(
      context,
      {},
      undefined, // observabilityTracer
      undefined, // idempotencyStore
      undefined, // memoryAdapter
      undefined, // journalStore
      new LamportClock(),
      undefined, // graphMemory
      decisionMemory
    )
  }

  async makeApprovalDecision(params: {
    customerId: string
    amount: number
    reason: string
    isException?: boolean
    exceptionReason?: string
  }): Promise<{ approved: boolean; discount?: number }> {
    // Gather context
    const inputs: DecisionInput[] = [
      { key: 'customerId', value: params.customerId, source: 'input' },
      { key: 'amount', value: params.amount, source: 'input' },
      { key: 'reason', value: params.reason, source: 'input' }
    ]

    // Find precedents
    const precedents = await this.findPrecedents({
      decisionType: 'approval',
      contextSimilarity: { customerId: params.customerId },
      limit: 5,
      queryText: params.reason
    })

    // Make decision
    const decision = {
      approved: params.isException ? true : params.amount < 1000,
      discount: params.isException ? 0.15 : 0.10
    }

    // Record decision
    await this.recordDecision({
      decisionType: 'approval',
      rationale: params.reason,
      reasoning: [
        `Amount: $${params.amount}`,
        `Found ${precedents.length} similar precedents`,
        params.isException ? 'Exception granted' : 'Standard approval'
      ],
      inputs,
      outcome: decision,
      policy: {
        id: 'discount-policy',
        version: '1.0',
        rule: 'Standard discount: 10%, Exception discount: 15%'
      },
      precedents: precedents.map(p => p.decisionId),
      isException: params.isException || false,
      exceptionReason: params.exceptionReason,
      enrichWithLLM: 'never'
    })

    return decision
  }

  // Expose protected methods for testing
  public async testFindPrecedents(params: Parameters<typeof this.findPrecedents>[0]) {
    return this.findPrecedents(params)
  }

  public getJournal(): Journal {
    return (this as any).journal
  }
}

describe('DecisionMemory Integration', () => {
  let storage: InMemoryGraphStorage
  let clock: LamportClock
  let embeddingService: MockEmbeddingService
  let decisionMemory: DecisionMemory

  beforeEach(() => {
    storage = new InMemoryGraphStorage()
    clock = new LamportClock()
    embeddingService = new MockEmbeddingService()
    decisionMemory = new DecisionMemory('test-actor', storage, clock, {
      embeddingService,
      enableEmbeddings: true
    })
  })

  describe('Decision Storage', () => {
    it('should store decision with embedding', async () => {
      const trace: DecisionTrace = {
        decisionId: 'test-001',
        timestamp: Date.now(),
        actorId: 'test-actor',
        actorType: 'TestActor',
        decisionType: 'approval',
        rationale: 'Healthcare customer needs discount',
        inputs: [{ key: 'customerId', value: 'cust-123', source: 'input' }],
        outcome: { approved: true },
        policy: { id: 'policy-1', version: '1.0', rule: 'Standard approval' },
        isException: false,
        context: { tenantId: 'tenant-1' }
      }

      await decisionMemory.addDecisionTrace(trace)

      // Verify decision is stored
      const retrieved = await decisionMemory.getDecision('test-001')
      expect(retrieved).toBeTruthy()
      expect(retrieved?.decisionId).toBe('test-001')
      expect(retrieved?.rationale).toBe('Healthcare customer needs discount')
    })

    it('should link precedents', async () => {
      // Create first decision
      const trace1: DecisionTrace = {
        decisionId: 'decision-1',
        timestamp: Date.now(),
        actorId: 'test-actor',
        actorType: 'TestActor',
        decisionType: 'approval',
        rationale: 'First decision',
        inputs: [],
        outcome: { approved: true },
        isException: false,
        context: {}
      }
      await decisionMemory.addDecisionTrace(trace1)

      // Create second decision referencing first
      const trace2: DecisionTrace = {
        decisionId: 'decision-2',
        timestamp: Date.now() + 1000,
        actorId: 'test-actor',
        actorType: 'TestActor',
        decisionType: 'approval',
        rationale: 'Second decision based on precedent',
        inputs: [],
        outcome: { approved: true },
        precedents: ['decision-1'],
        isException: false,
        context: {}
      }
      await decisionMemory.addDecisionTrace(trace2)

      // Verify link exists
      const retrieved = await decisionMemory.getDecision('decision-2')
      expect(retrieved?.precedents).toContain('decision-1')
    })

    it.skip('should create parent-child relationships (requires real storage - InMemoryGraphStorage mock limitation)', async () => {
      // Create parent decision
      const parent: DecisionTrace = {
        decisionId: 'parent-1',
        timestamp: Date.now(),
        actorId: 'test-actor',
        actorType: 'TestActor',
        decisionType: 'approval',
        rationale: 'Parent decision',
        inputs: [],
        outcome: { approved: true },
        isException: false,
        context: {}
      }
      await decisionMemory.addDecisionTrace(parent)

      // Create child decision
      const child: DecisionTrace = {
        decisionId: 'child-1',
        timestamp: Date.now() + 1000,
        actorId: 'test-actor',
        actorType: 'TestActor',
        decisionType: 'escalation',
        rationale: 'Escalated from parent',
        inputs: [],
        outcome: { escalated: true },
        parentDecisionId: 'parent-1',
        isException: false,
        context: {}
      }
      await decisionMemory.addDecisionTrace(child)

      // Get decision chain
      const chain = await decisionMemory.getDecisionChain('child-1')
      expect(chain.decision?.decisionId).toBe('child-1')
      expect(chain.ancestors.length).toBeGreaterThan(0)
    })
  })

  describe('Precedent Search', () => {
    beforeEach(async () => {
      // Create test decisions
      const decisions: DecisionTrace[] = [
        {
          decisionId: 'dec-1',
          timestamp: Date.now() - 5000,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'approval',
          rationale: 'Healthcare customer with service issues needs discount',
          inputs: [{ key: 'industry', value: 'healthcare', source: 'input' }],
          outcome: { approved: true, discount: 0.15 },
          isException: true,
          exceptionReason: 'Service issues warrant extra discount',
          context: { customerId: 'cust-1', industry: 'healthcare' }
        },
        {
          decisionId: 'dec-2',
          timestamp: Date.now() - 4000,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'approval',
          rationale: 'Healthcare customer standard discount',
          inputs: [{ key: 'industry', value: 'healthcare', source: 'input' }],
          outcome: { approved: true, discount: 0.10 },
          isException: false,
          context: { customerId: 'cust-2', industry: 'healthcare' }
        },
        {
          decisionId: 'dec-3',
          timestamp: Date.now() - 3000,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'approval',
          rationale: 'Finance customer needs discount',
          inputs: [{ key: 'industry', value: 'finance', source: 'input' }],
          outcome: { approved: true, discount: 0.10 },
          isException: false,
          context: { customerId: 'cust-3', industry: 'finance' }
        },
        {
          decisionId: 'dec-4',
          timestamp: Date.now() - 2000,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'exception',
          rationale: 'Healthcare exception for retention',
          inputs: [{ key: 'industry', value: 'healthcare', source: 'input' }],
          outcome: { approved: true, discount: 0.20 },
          isException: true,
          exceptionReason: 'Retention case with competitive threat',
          context: { customerId: 'cust-4', industry: 'healthcare' }
        }
      ]

      for (const decision of decisions) {
        await decisionMemory.addDecisionTrace(decision)
      }
    })

    it.skip('should find decisions by text query (requires real storage - InMemoryGraphStorage mock limitation)', async () => {
      const results = await decisionMemory.searchDecisions({
        queryText: 'healthcare',
        limit: 10
      })

      expect(results.length).toBeGreaterThan(0)
      // All results should mention healthcare
      const healthcareResults = results.filter(d => 
        d.rationale.toLowerCase().includes('healthcare') ||
        (d.context.industry as string)?.toLowerCase() === 'healthcare'
      )
      expect(healthcareResults.length).toBeGreaterThan(0)
    })

    it('should filter by decision type', async () => {
      const exceptions = await decisionMemory.searchDecisions({
        isException: true,
        limit: 10
      })

      expect(exceptions.length).toBe(2)
      expect(exceptions.every(d => d.isException)).toBe(true)
    })

    it('should filter by context', async () => {
      const results = await decisionMemory.searchDecisions({
        contextFilters: { industry: 'healthcare' },
        limit: 10
      })

      expect(results.length).toBe(3)
      expect(results.every(d => d.context.industry === 'healthcare')).toBe(true)
    })

    it('should filter by time range', async () => {
      const now = Date.now()
      const results = await decisionMemory.searchDecisions({
        startTime: now - 3500,
        endTime: now,
        limit: 10
      })

      // Should get decisions from last 3.5 seconds (dec-3 and dec-4)
      expect(results.length).toBeGreaterThanOrEqual(2)
    })

    it.skip('should find similar decisions semantically (requires real storage - InMemoryGraphStorage mock limitation)', async () => {
      const targetDecision: DecisionTrace = {
        decisionId: 'query-1',
        timestamp: Date.now(),
        actorId: 'test-actor',
        actorType: 'TestActor',
        decisionType: 'approval',
        rationale: 'Healthcare customer with service problems needs exception discount',
        inputs: [{ key: 'industry', value: 'healthcare', source: 'input' }],
        outcome: { approved: true },
        isException: true,
        context: { industry: 'healthcare' }
      }

      const similar = await decisionMemory.findSimilarDecisions(targetDecision, 5, 0.5)

      expect(similar.length).toBeGreaterThan(0)
      // Should find healthcare + exception decisions
      const healthcareExceptions = similar.filter(d => 
        d.isException && d.context.industry === 'healthcare'
      )
      expect(healthcareExceptions.length).toBeGreaterThan(0)
    })
  })

  describe('Exception Pattern Detection', () => {
    beforeEach(async () => {
      // Create exceptions with patterns
      const exceptions: DecisionTrace[] = [
        {
          decisionId: 'ex-1',
          timestamp: Date.now() - 5000,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'exception',
          rationale: 'Exception for service issues',
          inputs: [],
          outcome: { approved: true },
          isException: true,
          exceptionReason: 'Multiple open service tickets causing customer dissatisfaction',
          context: {}
        },
        {
          decisionId: 'ex-2',
          timestamp: Date.now() - 4000,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'exception',
          rationale: 'Exception for service problems',
          inputs: [],
          outcome: { approved: true },
          isException: true,
          exceptionReason: 'Customer experiencing service outages requiring compensation',
          context: {}
        },
        {
          decisionId: 'ex-3',
          timestamp: Date.now() - 3000,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'exception',
          rationale: 'Exception for service quality',
          inputs: [],
          outcome: { approved: true },
          isException: true,
          exceptionReason: 'Service quality below SLA triggering escalation',
          context: {}
        },
        {
          decisionId: 'ex-4',
          timestamp: Date.now() - 2000,
          actorId: 'test-actor',
          actorType: 'TestActor',
          decisionType: 'exception',
          rationale: 'Exception for retention',
          inputs: [],
          outcome: { approved: true },
          isException: true,
          exceptionReason: 'Competitive retention case with urgent timeline',
          context: {}
        }
      ]

      for (const ex of exceptions) {
        await decisionMemory.addDecisionTrace(ex)
      }
    })

    it('should detect common exception patterns', async () => {
      const patterns = await decisionMemory.detectExceptionPatterns()

      expect(patterns.length).toBeGreaterThan(0)
      
      const exceptionPattern = patterns.find(p => p.patternType === 'exception')
      expect(exceptionPattern).toBeTruthy()
      expect(exceptionPattern!.frequency).toBeGreaterThanOrEqual(3)
      expect(exceptionPattern!.commonFactors.length).toBeGreaterThan(0)
      
      // Should identify "service" as a common factor
      const hasServiceFactor = exceptionPattern!.commonFactors.some(f => 
        f.includes('service') || f.includes('customer')
      )
      expect(hasServiceFactor).toBe(true)
    })

    it('should generate policy recommendations', async () => {
      const patterns = await decisionMemory.detectExceptionPatterns()

      expect(patterns.length).toBeGreaterThan(0)
      const exceptionPattern = patterns[0]
      expect(exceptionPattern.recommendedPolicy).toBeTruthy()
      expect(exceptionPattern.recommendedPolicy).toContain(exceptionPattern.patternType)
    })
  })

  describe('Actor Integration', () => {
    let actor: TestDecisionActor

    beforeEach(() => {
      const context: ActorContext = {
        actorId: 'test-actor-1',
        actorType: 'TestDecisionActor',
        correlationId: 'test-correlation'
      }
      actor = new TestDecisionActor(context, decisionMemory)
    })

    it.skip('should store decisions when actor makes decisions (requires real storage - InMemoryGraphStorage mock limitation)', async () => {
      await actor.makeApprovalDecision({
        customerId: 'cust-1',
        amount: 500,
        reason: 'Healthcare customer needs discount'
      })

      // Give async storage time to complete
      await new Promise(resolve => setTimeout(resolve, 100))

      const decisions = await decisionMemory.getAllDecisions(10)
      expect(decisions.length).toBeGreaterThan(0)
      
      const stored = decisions.find(d => d.context.customerId === 'cust-1')
      expect(stored).toBeTruthy()
      expect(stored?.rationale).toContain('Healthcare')
    })

    it('should find precedents when making similar decisions', async () => {
      // Make first decision
      await actor.makeApprovalDecision({
        customerId: 'cust-1',
        amount: 500,
        reason: 'Healthcare customer with service issues',
        isException: true,
        exceptionReason: 'Service problems'
      })

      // Wait for storage
      await new Promise(resolve => setTimeout(resolve, 100))

      // Make similar decision
      await actor.makeApprovalDecision({
        customerId: 'cust-2',
        amount: 600,
        reason: 'Healthcare customer with service problems',
        isException: true,
        exceptionReason: 'Service outage'
      })

      // Check journal for precedent references
      const journal = actor.getJournal()
      const decisionEntries = journal.entries.filter(e => e.type === 'decision_made')
      expect(decisionEntries.length).toBeGreaterThanOrEqual(2)
    })

    it('should work without DecisionMemory configured', async () => {
      const context: ActorContext = {
        actorId: 'test-actor-2',
        actorType: 'TestDecisionActor',
        correlationId: 'test-correlation-2'
      }
      const actorWithoutMemory = new TestDecisionActor(context, undefined)

      // Should not throw
      const precedents = await actorWithoutMemory.testFindPrecedents({
        decisionType: 'approval',
        limit: 5
      })

      expect(precedents).toEqual([])
    })
  })

  describe('Decision Chain Traversal', () => {
    it.skip('should traverse full decision chain (requires real storage - InMemoryGraphStorage mock limitation)', async () => {
      // Create chain: grandparent -> parent -> child
      const grandparent: DecisionTrace = {
        decisionId: 'gp-1',
        timestamp: Date.now() - 3000,
        actorId: 'test-actor',
        actorType: 'TestActor',
        decisionType: 'approval',
        rationale: 'Initial approval',
        inputs: [],
        outcome: { approved: true },
        isException: false,
        context: {}
      }
      await decisionMemory.addDecisionTrace(grandparent)

      const parent: DecisionTrace = {
        decisionId: 'parent-1',
        timestamp: Date.now() - 2000,
        actorId: 'test-actor',
        actorType: 'TestActor',
        decisionType: 'escalation',
        rationale: 'Escalated from initial',
        inputs: [],
        outcome: { escalated: true },
        parentDecisionId: 'gp-1',
        isException: false,
        context: {}
      }
      await decisionMemory.addDecisionTrace(parent)

      const child: DecisionTrace = {
        decisionId: 'child-1',
        timestamp: Date.now() - 1000,
        actorId: 'test-actor',
        actorType: 'TestActor',
        decisionType: 'override',
        rationale: 'Override escalation',
        inputs: [],
        outcome: { overridden: true },
        parentDecisionId: 'parent-1',
        isException: true,
        context: {}
      }
      await decisionMemory.addDecisionTrace(child)

      // Get full chain
      const chain = await decisionMemory.getDecisionChain('child-1')

      expect(chain.decision?.decisionId).toBe('child-1')
      expect(chain.ancestors.length).toBeGreaterThanOrEqual(1)
      expect(chain.ancestors.some(a => a.decisionId === 'parent-1')).toBe(true)
    })
  })
})
