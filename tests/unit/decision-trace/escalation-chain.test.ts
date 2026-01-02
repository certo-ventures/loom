/**
 * Tests for EscalationChain
 * Part of Phase 7A Week 3: Group Decision & Collaboration System
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EscalationChain } from '../../../src/memory/graph/escalation-chain';
import { InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage';
import { LamportClock } from '../../../src/timing/lamport-clock';

describe('EscalationChain', () => {
  let chain: EscalationChain;
  let storage: InMemoryGraphStorage;
  let clock: LamportClock;

  beforeEach(() => {
    storage = new InMemoryGraphStorage();
    clock = new LamportClock('test-node');
    chain = new EscalationChain('test-actor', storage, clock);
  });

  afterEach(() => {
    chain.cleanup();
  });

  describe('Chain Definition', () => {
    it('should define a new escalation chain', async () => {
      const chainId = await chain.defineChain({
        name: 'Loan Approval',
        description: 'Loan approval escalation chain',
        levels: [
          {
            actorId: 'loan-officer',
            title: 'Loan Officer',
            maxAmount: 10000,
            canOverride: false,
            requiresEvidence: false
          },
          {
            actorId: 'manager',
            title: 'Manager',
            maxAmount: 100000,
            canOverride: true,
            requiresEvidence: true
          },
          {
            actorId: 'committee',
            title: 'Loan Committee',
            canOverride: true,
            requiresEvidence: true
          }
        ]
      });

      expect(chainId).toMatch(/^chain_/);

      const chainDef = await chain.getChain(chainId);
      expect(chainDef).toBeDefined();
      expect(chainDef!.name).toBe('Loan Approval');
      expect(chainDef!.levels).toHaveLength(3);
      expect(chainDef!.levels[0].level).toBe(1);
      expect(chainDef!.levels[1].level).toBe(2);
      expect(chainDef!.levels[2].level).toBe(3);
      expect(chainDef!.active).toBe(true);
    });

    it('should create chain with metadata', async () => {
      const chainId = await chain.defineChain({
        name: 'Risk Assessment',
        description: 'Risk-based escalation',
        levels: [
          {
            actorId: 'analyst',
            title: 'Risk Analyst',
            maxRiskScore: 0.5,
            canOverride: false,
            requiresEvidence: true
          }
        ],
        metadata: { department: 'risk', version: '1.0' }
      });

      const chainDef = await chain.getChain(chainId);
      expect(chainDef!.metadata).toEqual({ department: 'risk', version: '1.0' });
    });

    it('should deactivate a chain', async () => {
      const chainId = await chain.defineChain({
        name: 'Test Chain',
        description: 'Test',
        levels: [
          { actorId: 'actor1', title: 'Level 1', canOverride: false, requiresEvidence: false }
        ]
      });

      await chain.deactivateChain(chainId);

      const chainDef = await chain.getChain(chainId);
      expect(chainDef!.active).toBe(false);
    });
  });

  describe('Decision Submission', () => {
    let chainId: string;

    beforeEach(async () => {
      chainId = await chain.defineChain({
        name: 'Loan Approval',
        description: 'Test chain',
        levels: [
          {
            actorId: 'loan-officer',
            title: 'Loan Officer',
            maxAmount: 10000,
            canOverride: false,
            requiresEvidence: false
          },
          {
            actorId: 'manager',
            title: 'Manager',
            maxAmount: 100000,
            canOverride: true,
            requiresEvidence: true
          },
          {
            actorId: 'committee',
            title: 'Committee',
            canOverride: true,
            requiresEvidence: true
          }
        ]
      });
    });

    it('should submit decision at correct level based on amount', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { applicantId: '12345' },
        amount: 5000
      });

      const decision = await chain.getDecision(decisionId);
      expect(decision).toBeDefined();
      expect(decision!.currentLevel).toBe(1); // Starts at loan officer
      expect(decision!.status).toBe('pending');
      expect(decision!.amount).toBe(5000);
    });

    it('should start at higher level for large amounts', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { applicantId: '12345' },
        amount: 50000 // Exceeds loan officer limit
      });

      const decision = await chain.getDecision(decisionId);
      expect(decision!.currentLevel).toBe(2); // Starts at manager
    });

    it('should start at highest level for very large amounts', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { applicantId: '12345' },
        amount: 500000 // Exceeds manager limit
      });

      const decision = await chain.getDecision(decisionId);
      expect(decision!.currentLevel).toBe(3); // Starts at committee
    });

    it('should reject submission to inactive chain', async () => {
      await chain.deactivateChain(chainId);

      await expect(
        chain.submitDecision({
          chainId,
          decisionData: { test: 'data' }
        })
      ).rejects.toThrow('is not active');
    });
  });

  describe('Decision Approval', () => {
    let chainId: string;
    let loanOfficerChain: EscalationChain;

    beforeEach(async () => {
      chainId = await chain.defineChain({
        name: 'Test Chain',
        description: 'Test',
        levels: [
          {
            actorId: 'loan-officer',
            title: 'Loan Officer',
            maxAmount: 10000,
            canOverride: false,
            requiresEvidence: false
          },
          {
            actorId: 'manager',
            title: 'Manager',
            canOverride: true,
            requiresEvidence: true
          }
        ]
      });

      loanOfficerChain = new EscalationChain('loan-officer', storage, clock);
    });

    afterEach(() => {
      loanOfficerChain.cleanup();
    });

    it('should approve decision', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' },
        amount: 5000
      });

      await loanOfficerChain.approve(decisionId, {
        reason: 'All criteria met'
      });

      const decision = await chain.getDecision(decisionId);
      expect(decision!.status).toBe('approved');
      expect(decision!.history).toHaveLength(1);
      expect(decision!.history[0].action).toBe('approved');
      expect(decision!.history[0].actorId).toBe('loan-officer');
    });

    it('should require evidence when configured', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' },
        amount: 50000 // Goes to manager
      });

      const managerChain = new EscalationChain('manager', storage, clock);

      await expect(
        managerChain.approve(decisionId)
      ).rejects.toThrow('Evidence is required');

      managerChain.cleanup();
    });

    it('should approve with evidence', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' },
        amount: 50000
      });

      const managerChain = new EscalationChain('manager', storage, clock);

      await managerChain.approve(decisionId, {
        reason: 'Approved based on review',
        evidence: ['credit-report.pdf', 'income-verification.pdf']
      });

      const decision = await chain.getDecision(decisionId);
      expect(decision!.status).toBe('approved');
      expect(decision!.history[0].evidence).toHaveLength(2);

      managerChain.cleanup();
    });

    it('should reject unauthorized approval', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' },
        amount: 5000
      });

      await expect(
        chain.approve(decisionId) // Wrong actor
      ).rejects.toThrow('does not have authority');
    });

    it('should reject approval of non-pending decision', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' },
        amount: 5000
      });

      await loanOfficerChain.approve(decisionId);

      await expect(
        loanOfficerChain.approve(decisionId)
      ).rejects.toThrow('is not pending');
    });
  });

  describe('Decision Rejection', () => {
    let chainId: string;
    let loanOfficerChain: EscalationChain;

    beforeEach(async () => {
      chainId = await chain.defineChain({
        name: 'Test Chain',
        description: 'Test',
        levels: [
          {
            actorId: 'loan-officer',
            title: 'Loan Officer',
            canOverride: false,
            requiresEvidence: false
          }
        ]
      });

      loanOfficerChain = new EscalationChain('loan-officer', storage, clock);
    });

    afterEach(() => {
      loanOfficerChain.cleanup();
    });

    it('should reject decision', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      await loanOfficerChain.reject(decisionId, 'Insufficient credit history');

      const decision = await chain.getDecision(decisionId);
      expect(decision!.status).toBe('rejected');
      expect(decision!.history[0].action).toBe('rejected');
      expect(decision!.history[0].reason).toBe('Insufficient credit history');
    });

    it('should reject with evidence', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      await loanOfficerChain.reject(decisionId, 'Credit score too low', [
        'credit-report.pdf'
      ]);

      const decision = await chain.getDecision(decisionId);
      expect(decision!.history[0].evidence).toHaveLength(1);
    });
  });

  describe('Escalation', () => {
    let chainId: string;
    let loanOfficerChain: EscalationChain;

    beforeEach(async () => {
      chainId = await chain.defineChain({
        name: 'Test Chain',
        description: 'Test',
        levels: [
          {
            actorId: 'loan-officer',
            title: 'Loan Officer',
            maxAmount: 10000,
            canOverride: false,
            requiresEvidence: false
          },
          {
            actorId: 'manager',
            title: 'Manager',
            maxAmount: 100000,
            canOverride: true,
            requiresEvidence: false
          },
          {
            actorId: 'committee',
            title: 'Committee',
            canOverride: true,
            requiresEvidence: false
          }
        ]
      });

      loanOfficerChain = new EscalationChain('loan-officer', storage, clock);
    });

    afterEach(() => {
      loanOfficerChain.cleanup();
    });

    it('should escalate to next level', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      await loanOfficerChain.escalate(decisionId, 'Requires higher authority');

      const decision = await chain.getDecision(decisionId);
      expect(decision!.currentLevel).toBe(2);
      expect(decision!.status).toBe('pending');
      expect(decision!.history[0].action).toBe('escalated');
    });

    it('should reject escalation beyond highest level', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' },
        amount: 999999 // Starts at level 3
      });

      const committeeChain = new EscalationChain('committee', storage, clock);

      await expect(
        committeeChain.escalate(decisionId, 'Test')
      ).rejects.toThrow('No higher level available');

      committeeChain.cleanup();
    });

    it('should maintain escalation history', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      await loanOfficerChain.escalate(decisionId, 'Escalating to manager');

      const managerChain = new EscalationChain('manager', storage, clock);
      await managerChain.escalate(decisionId, 'Escalating to committee');

      const decision = await chain.getDecision(decisionId);
      expect(decision!.history).toHaveLength(2);
      expect(decision!.history[0].level).toBe(1);
      expect(decision!.history[1].level).toBe(2);

      managerChain.cleanup();
    });
  });

  describe('Override', () => {
    let chainId: string;
    let managerChain: EscalationChain;

    beforeEach(async () => {
      chainId = await chain.defineChain({
        name: 'Test Chain',
        description: 'Test',
        levels: [
          {
            actorId: 'loan-officer',
            title: 'Loan Officer',
            maxAmount: 10000,
            canOverride: false,
            requiresEvidence: false
          },
          {
            actorId: 'manager',
            title: 'Manager',
            maxAmount: 100000,
            canOverride: true,
            requiresEvidence: false
          }
        ]
      });

      managerChain = new EscalationChain('manager', storage, clock);
    });

    afterEach(() => {
      managerChain.cleanup();
    });

    it('should allow higher authority to override', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      await managerChain.override({
        decisionId,
        reason: 'Overriding due to special circumstances',
        evidence: ['override-justification.pdf']
      });

      const decision = await chain.getDecision(decisionId);
      expect(decision!.status).toBe('overridden');
      expect(decision!.currentLevel).toBe(2);
      expect(decision!.history[0].action).toBe('overridden');
    });

    it('should reject override without permission', async () => {
      const chainId2 = await chain.defineChain({
        name: 'No Override Chain',
        description: 'Test',
        levels: [
          {
            actorId: 'actor1',
            title: 'Actor 1',
            canOverride: false,
            requiresEvidence: false
          }
        ]
      });

      const decisionId = await chain.submitDecision({
        chainId: chainId2,
        decisionData: { test: 'data' }
      });

      const actor1Chain = new EscalationChain('actor1', storage, clock);

      await expect(
        actor1Chain.override({ decisionId, reason: 'Test' })
      ).rejects.toThrow('does not have override permission');

      actor1Chain.cleanup();
    });

    it('should reject override from lower or same level', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' },
        amount: 50000 // Starts at manager level
      });

      await expect(
        managerChain.override({ decisionId, reason: 'Test' })
      ).rejects.toThrow('higher authority level');
    });
  });

  describe('Appeals', () => {
    let chainId: string;

    beforeEach(async () => {
      chainId = await chain.defineChain({
        name: 'Test Chain',
        description: 'Test',
        levels: [
          {
            actorId: 'loan-officer',
            title: 'Loan Officer',
            canOverride: false,
            requiresEvidence: false
          },
          {
            actorId: 'manager',
            title: 'Manager',
            canOverride: true,
            requiresEvidence: false
          },
          {
            actorId: 'committee',
            title: 'Committee',
            canOverride: true,
            requiresEvidence: false
          }
        ]
      });
    });

    it('should appeal rejected decision', async () => {
      const loanOfficerChain = new EscalationChain('loan-officer', storage, clock);

      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      await loanOfficerChain.reject(decisionId, 'Initial rejection');

      await chain.appeal({
        decisionId,
        reason: 'New evidence available',
        evidence: ['new-evidence.pdf']
      });

      const decision = await chain.getDecision(decisionId);
      expect(decision!.status).toBe('pending');
      expect(decision!.currentLevel).toBe(2); // Escalated to next level
      expect(decision!.history).toHaveLength(2);
      expect(decision!.history[1].action).toBe('appealed');

      loanOfficerChain.cleanup();
    });

    it('should appeal to specific level', async () => {
      const loanOfficerChain = new EscalationChain('loan-officer', storage, clock);

      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      await loanOfficerChain.reject(decisionId, 'Rejection');

      await chain.appeal({
        decisionId,
        reason: 'Appealing to committee',
        targetLevel: 3
      });

      const decision = await chain.getDecision(decisionId);
      expect(decision!.currentLevel).toBe(3);

      loanOfficerChain.cleanup();
    });

    it('should reject appeal of non-rejected decision', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      await expect(
        chain.appeal({
          decisionId,
          reason: 'Test'
        })
      ).rejects.toThrow('Can only appeal rejected decisions');
    });

    it('should reject appeal to invalid level', async () => {
      const loanOfficerChain = new EscalationChain('loan-officer', storage, clock);

      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      await loanOfficerChain.reject(decisionId, 'Rejection');

      await expect(
        chain.appeal({
          decisionId,
          reason: 'Test',
          targetLevel: 1 // Same as current
        })
      ).rejects.toThrow('must be higher than current level');

      loanOfficerChain.cleanup();
    });
  });

  describe('Pending Decisions', () => {
    let chainId: string;

    beforeEach(async () => {
      chainId = await chain.defineChain({
        name: 'Test Chain',
        description: 'Test',
        levels: [
          {
            actorId: 'loan-officer',
            title: 'Loan Officer',
            maxAmount: 10000,
            canOverride: false,
            requiresEvidence: false
          },
          {
            actorId: 'manager',
            title: 'Manager',
            maxAmount: 100000,
            canOverride: false,
            requiresEvidence: false
          }
        ]
      });
    });

    it('should get pending decisions for actor', async () => {
      await chain.submitDecision({
        chainId,
        decisionData: { test: 'decision1' }
      });

      await chain.submitDecision({
        chainId,
        decisionData: { test: 'decision2' }
      });

      const loanOfficerChain = new EscalationChain('loan-officer', storage, clock);
      const pending = await loanOfficerChain.getPendingDecisions('loan-officer');

      expect(pending).toHaveLength(2);

      loanOfficerChain.cleanup();
    });

    it('should not include approved decisions in pending', async () => {
      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      const loanOfficerChain = new EscalationChain('loan-officer', storage, clock);
      await loanOfficerChain.approve(decisionId);

      const pending = await loanOfficerChain.getPendingDecisions('loan-officer');
      expect(pending).toHaveLength(0);

      loanOfficerChain.cleanup();
    });

    it('should filter pending by actor authority', async () => {
      await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' },
        amount: 5000 // Level 1
      });

      await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' },
        amount: 50000 // Level 2
      });

      const loanOfficerChain = new EscalationChain('loan-officer', storage, clock);
      const pending = await loanOfficerChain.getPendingDecisions('loan-officer');
      expect(pending).toHaveLength(1); // Only level 1 decision

      loanOfficerChain.cleanup();
    });
  });

  describe('Timeouts', () => {
    it('should handle decision timeout', async () => {
      vi.useFakeTimers();

      const chainId = await chain.defineChain({
        name: 'Timeout Chain',
        description: 'Test',
        levels: [
          {
            actorId: 'loan-officer',
            title: 'Loan Officer',
            timeoutMs: 1000,
            canOverride: false,
            requiresEvidence: false
          },
          {
            actorId: 'manager',
            title: 'Manager',
            canOverride: false,
            requiresEvidence: false
          }
        ]
      });

      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      // Fast-forward time
      await vi.advanceTimersByTimeAsync(1100);

      const decision = await chain.getDecision(decisionId);
      expect(decision!.currentLevel).toBe(2); // Escalated
      expect(decision!.history).toHaveLength(1);
      expect(decision!.history[0].action).toBe('timeout');

      vi.useRealTimers();
    });

    it('should mark as expired if no higher level', async () => {
      vi.useFakeTimers();

      const chainId = await chain.defineChain({
        name: 'Timeout Chain',
        description: 'Test',
        levels: [
          {
            actorId: 'loan-officer',
            title: 'Loan Officer',
            timeoutMs: 1000,
            canOverride: false,
            requiresEvidence: false
          }
        ]
      });

      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      await vi.advanceTimersByTimeAsync(1100);

      const decision = await chain.getDecision(decisionId);
      expect(decision!.status).toBe('expired');

      vi.useRealTimers();
    });

    it('should clear timeout on approval', async () => {
      vi.useFakeTimers();

      const chainId = await chain.defineChain({
        name: 'Timeout Chain',
        description: 'Test',
        levels: [
          {
            actorId: 'loan-officer',
            title: 'Loan Officer',
            timeoutMs: 1000,
            canOverride: false,
            requiresEvidence: false
          }
        ]
      });

      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      const loanOfficerChain = new EscalationChain('loan-officer', storage, clock);
      await loanOfficerChain.approve(decisionId);

      await vi.advanceTimersByTimeAsync(1100);

      const decision = await chain.getDecision(decisionId);
      expect(decision!.status).toBe('approved'); // Still approved, not escalated

      loanOfficerChain.cleanup();
      vi.useRealTimers();
    });
  });

  describe('Decision History', () => {
    let chainId: string;

    beforeEach(async () => {
      chainId = await chain.defineChain({
        name: 'Test Chain',
        description: 'Test',
        levels: [
          {
            actorId: 'loan-officer',
            title: 'Loan Officer',
            canOverride: false,
            requiresEvidence: false
          },
          {
            actorId: 'manager',
            title: 'Manager',
            canOverride: false,
            requiresEvidence: false
          }
        ]
      });
    });

    it('should track complete decision history', async () => {
      const loanOfficerChain = new EscalationChain('loan-officer', storage, clock);
      const managerChain = new EscalationChain('manager', storage, clock);

      const decisionId = await chain.submitDecision({
        chainId,
        decisionData: { test: 'data' }
      });

      await loanOfficerChain.escalate(decisionId, 'Need manager approval');
      await managerChain.approve(decisionId, { reason: 'Looks good' });

      const history = await chain.getDecisionHistory(decisionId);
      expect(history).toHaveLength(2);
      expect(history[0].action).toBe('escalated');
      expect(history[1].action).toBe('approved');

      loanOfficerChain.cleanup();
      managerChain.cleanup();
    });
  });
});
