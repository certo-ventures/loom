/**
 * Tests for GroupDecisionMemory
 * Part of Phase 7A Week 3: Group Decision & Collaboration System
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GroupDecisionMemory, Vote, GroupDecision } from '../../../src/memory/graph/group-decision-memory';
import { InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage';
import { LamportClock } from '../../../src/timing/lamport-clock';

describe('GroupDecisionMemory', () => {
  let memory: GroupDecisionMemory;
  let storage: InMemoryGraphStorage;
  let clock: LamportClock;

  beforeEach(() => {
    storage = new InMemoryGraphStorage();
    clock = new LamportClock('test-node');
    memory = new GroupDecisionMemory('test-actor', storage, clock);
  });

  describe('Group Decision Recording', () => {
    it('should record a group decision with votes', async () => {
      const votes: Vote[] = [
        { actorId: 'actor1', position: 'for', confidence: 0.9, timestamp: Date.now() },
        { actorId: 'actor2', position: 'for', confidence: 0.85, timestamp: Date.now() },
        { actorId: 'actor3', position: 'against', confidence: 0.7, timestamp: Date.now() }
      ];

      const decision: GroupDecision = {
        decisionId: 'decision1',
        decisionType: 'loan_approval',
        context: { applicantId: '12345' },
        inputs: [{ system: 'credit', entity: 'score', result: '780' }],
        rationale: 'Majority approved',
        outcome: 'approved',
        confidence: 0.88,
        timestamp: Date.now(),
        actorId: 'committee',
        roomId: 'room1',
        votes,
        minorityOpinions: [],
        consensusTime: 3600000, // 1 hour
        participantCount: 3,
        quorumMet: true
      };

      await memory.recordGroupDecision(decision);

      const retrievedVotes = await memory.getVotes('decision1');
      expect(retrievedVotes).toHaveLength(3);
      expect(retrievedVotes[0].actorId).toBe('actor1');
    });

    it('should record decision with minority opinions', async () => {
      const decision: GroupDecision = {
        decisionId: 'decision2',
        decisionType: 'investment',
        context: { dealId: 'deal1' },
        inputs: [],
        rationale: 'Approved with dissent',
        outcome: 'approved',
        confidence: 0.7,
        timestamp: Date.now(),
        actorId: 'board',
        roomId: 'room2',
        votes: [
          { actorId: 'member1', position: 'for', confidence: 0.8, timestamp: Date.now() },
          { actorId: 'member2', position: 'for', confidence: 0.75, timestamp: Date.now() },
          { actorId: 'member3', position: 'against', confidence: 0.9, timestamp: Date.now() }
        ],
        minorityOpinions: [
          {
            actorId: 'member3',
            decisionId: 'decision2',
            position: 'against',
            reason: 'Too risky given market conditions',
            evidence: ['market-analysis.pdf'],
            timestamp: Date.now()
          }
        ],
        consensusTime: 7200000,
        participantCount: 3,
        quorumMet: true
      };

      await memory.recordGroupDecision(decision);

      const opinions = await memory.getMinorityOpinions('decision2');
      expect(opinions).toHaveLength(1);
      expect(opinions[0].reason).toBe('Too risky given market conditions');
    });
  });

  describe('Vote Tracking', () => {
    it('should retrieve votes for a decision', async () => {
      const decision: GroupDecision = {
        decisionId: 'decision3',
        decisionType: 'approval',
        context: {},
        inputs: [],
        rationale: 'Test',
        outcome: 'approved',
        confidence: 0.8,
        timestamp: Date.now(),
        actorId: 'test',
        votes: [
          { actorId: 'voter1', position: 'for', confidence: 0.9, timestamp: Date.now() },
          { actorId: 'voter2', position: 'against', confidence: 0.8, timestamp: Date.now() }
        ],
        minorityOpinions: [],
        consensusTime: 1000,
        participantCount: 2,
        quorumMet: true
      };

      await memory.recordGroupDecision(decision);

      const votes = await memory.getVotes('decision3');
      expect(votes).toHaveLength(2);
      expect(votes.find(v => v.actorId === 'voter1')?.position).toBe('for');
      expect(votes.find(v => v.actorId === 'voter2')?.position).toBe('against');
    });

    it('should handle abstentions', async () => {
      const decision: GroupDecision = {
        decisionId: 'decision4',
        decisionType: 'approval',
        context: {},
        inputs: [],
        rationale: 'Test',
        outcome: 'approved',
        confidence: 0.7,
        timestamp: Date.now(),
        actorId: 'test',
        votes: [
          { actorId: 'voter1', position: 'for', confidence: 0.9, timestamp: Date.now() },
          { actorId: 'voter2', position: 'abstain', confidence: 0.5, timestamp: Date.now() }
        ],
        minorityOpinions: [],
        consensusTime: 1000,
        participantCount: 2,
        quorumMet: true
      };

      await memory.recordGroupDecision(decision);

      const votes = await memory.getVotes('decision4');
      const abstention = votes.find(v => v.position === 'abstain');
      expect(abstention).toBeDefined();
      expect(abstention!.actorId).toBe('voter2');
    });
  });

  describe('Opinion Change Tracking', () => {
    it('should track opinion change', async () => {
      const before: Vote = {
        actorId: 'test-actor',
        position: 'against',
        confidence: 0.6,
        timestamp: Date.now()
      };

      const after: Vote = {
        actorId: 'test-actor',
        position: 'for',
        confidence: 0.8,
        timestamp: Date.now() + 1000
      };

      await memory.trackOpinionChange(
        'decision5',
        before,
        after,
        'Convinced by new evidence'
      );

      const changes = await memory.getOpinionChanges('decision5');
      expect(changes).toHaveLength(1);
      expect(changes[0].before.position).toBe('against');
      expect(changes[0].after.position).toBe('for');
      expect(changes[0].reason).toBe('Convinced by new evidence');
    });

    it('should track multiple opinion changes', async () => {
      const vote1 = { actorId: 'test-actor', position: 'against' as const, confidence: 0.6, timestamp: Date.now() };
      const vote2 = { actorId: 'test-actor', position: 'for' as const, confidence: 0.7, timestamp: Date.now() + 1000 };
      const vote3 = { actorId: 'test-actor', position: 'abstain' as const, confidence: 0.5, timestamp: Date.now() + 2000 };

      await memory.trackOpinionChange('decision6', vote1, vote2, 'First change');
      await memory.trackOpinionChange('decision6', vote2, vote3, 'Second change');

      const changes = await memory.getOpinionChanges('decision6');
      expect(changes).toHaveLength(2);
    });
  });

  describe('Dissent Recording', () => {
    it('should record dissenting opinion', async () => {
      await memory.recordDissent(
        'decision7',
        'against',
        'I believe this decision is too risky',
        ['risk-analysis.pdf', 'financial-model.xlsx']
      );

      const opinions = await memory.getMinorityOpinions('decision7');
      expect(opinions).toHaveLength(1);
      expect(opinions[0].position).toBe('against');
      expect(opinions[0].evidence).toHaveLength(2);
    });

    it('should record multiple dissents', async () => {
      const memory2 = new GroupDecisionMemory('actor2', storage, clock);
      const memory3 = new GroupDecisionMemory('actor3', storage, clock);

      await memory.recordDissent('decision8', 'against', 'Reason 1');
      await memory2.recordDissent('decision8', 'against', 'Reason 2');
      await memory3.recordDissent('decision8', 'for', 'Actually I support this');

      const opinions = await memory.getMinorityOpinions('decision8');
      expect(opinions).toHaveLength(3);
    });
  });

  describe('Group Dynamics Analysis', () => {
    beforeEach(async () => {
      // Create multiple decisions for a room
      const decisions: GroupDecision[] = [
        {
          decisionId: 'room1_decision1',
          decisionType: 'approval',
          context: {},
          inputs: [],
          rationale: 'Unanimous approval',
          outcome: 'approved',
          confidence: 0.95,
          timestamp: Date.now(),
          actorId: 'committee',
          roomId: 'room1',
          votes: [
            { actorId: 'member1', position: 'for', confidence: 0.95, timestamp: Date.now() },
            { actorId: 'member2', position: 'for', confidence: 0.9, timestamp: Date.now() },
            { actorId: 'member3', position: 'for', confidence: 0.95, timestamp: Date.now() }
          ],
          minorityOpinions: [],
          consensusTime: 1800000,
          participantCount: 3,
          quorumMet: true
        },
        {
          decisionId: 'room1_decision2',
          decisionType: 'approval',
          context: {},
          inputs: [],
          rationale: 'Split decision',
          outcome: 'approved',
          confidence: 0.7,
          timestamp: Date.now(),
          actorId: 'committee',
          roomId: 'room1',
          votes: [
            { actorId: 'member1', position: 'for', confidence: 0.8, timestamp: Date.now() },
            { actorId: 'member2', position: 'against', confidence: 0.7, timestamp: Date.now() },
            { actorId: 'member3', position: 'for', confidence: 0.65, timestamp: Date.now() }
          ],
          minorityOpinions: [],
          consensusTime: 3600000,
          participantCount: 3,
          quorumMet: true
        }
      ];

      for (const decision of decisions) {
        await memory.recordGroupDecision(decision);
      }
    });

    it('should analyze group dynamics', async () => {
      const dynamics = await memory.getGroupDynamics('room1');

      expect(dynamics.roomId).toBe('room1');
      expect(dynamics.participantIds).toHaveLength(3);
      expect(dynamics.decisionCount).toBe(2);
      expect(dynamics.unanimousDecisions).toBe(1);
      expect(dynamics.splitDecisions).toBe(1);
      expect(dynamics.participationRate).toBe(1.0); // All voted in both
    });

    it('should calculate average consensus time', async () => {
      const dynamics = await memory.getGroupDynamics('room1');
      expect(dynamics.averageConsensusTime).toBe((1800000 + 3600000) / 2);
    });

    it('should identify influencers', async () => {
      const dynamics = await memory.getGroupDynamics('room1');
      expect(dynamics.influencers).toBeDefined();
      expect(dynamics.influencers.length).toBeGreaterThan(0);
      expect(dynamics.influencers[0]).toHaveProperty('actorId');
      expect(dynamics.influencers[0]).toHaveProperty('influenceScore');
    });
  });

  describe('Group Effectiveness Metrics', () => {
    beforeEach(async () => {
      const decision: GroupDecision = {
        decisionId: 'effectiveness_test',
        decisionType: 'approval',
        context: {},
        inputs: [],
        rationale: 'Test',
        outcome: 'approved',
        confidence: 0.85,
        timestamp: Date.now(),
        actorId: 'group',
        votes: [
          { actorId: 'actor1', position: 'for', confidence: 0.9, timestamp: Date.now() },
          { actorId: 'actor2', position: 'for', confidence: 0.8, timestamp: Date.now() }
        ],
        minorityOpinions: [],
        consensusTime: 1800000,
        participantCount: 2,
        quorumMet: true
      };

      await memory.recordGroupDecision(decision);
    });

    it('should analyze group effectiveness', async () => {
      const metrics = await memory.analyzeGroupEffectiveness(['actor1', 'actor2']);

      expect(metrics.actorIds).toEqual(['actor1', 'actor2']);
      expect(metrics.decisionCount).toBe(1);
      expect(metrics.averageConsensusTime).toBe(1800000);
      expect(metrics.averageDecisionQuality).toBeGreaterThan(0);
      expect(metrics.successRate).toBeGreaterThanOrEqual(0);
      expect(metrics.successRate).toBeLessThanOrEqual(1);
    });

    it('should calculate collaboration score', async () => {
      const metrics = await memory.analyzeGroupEffectiveness(['actor1', 'actor2']);
      expect(metrics.collaborationScore).toBeGreaterThanOrEqual(0);
      expect(metrics.collaborationScore).toBeLessThanOrEqual(1);
    });

    it('should calculate efficiency score', async () => {
      const metrics = await memory.analyzeGroupEffectiveness(['actor1', 'actor2']);
      expect(metrics.efficiencyScore).toBeGreaterThanOrEqual(0);
      expect(metrics.efficiencyScore).toBeLessThanOrEqual(1);
    });
  });

  describe('Participation Metrics', () => {
    beforeEach(async () => {
      const decisions: GroupDecision[] = [
        {
          decisionId: 'participation1',
          decisionType: 'approval',
          context: {},
          inputs: [],
          rationale: 'Test',
          outcome: 'approved',
          confidence: 0.8,
          timestamp: Date.now(),
          actorId: 'group',
          votes: [
            { actorId: 'participant1', position: 'for', confidence: 0.9, timestamp: Date.now() }
          ],
          minorityOpinions: [],
          consensusTime: 1000,
          participantCount: 1,
          quorumMet: true
        },
        {
          decisionId: 'participation2',
          decisionType: 'approval',
          context: {},
          inputs: [],
          rationale: 'Test',
          outcome: 'rejected',
          confidence: 0.8,
          timestamp: Date.now(),
          actorId: 'group',
          votes: [
            { actorId: 'participant1', position: 'against', confidence: 0.85, timestamp: Date.now() }
          ],
          minorityOpinions: [],
          consensusTime: 1000,
          participantCount: 1,
          quorumMet: true
        },
        {
          decisionId: 'participation3',
          decisionType: 'approval',
          context: {},
          inputs: [],
          rationale: 'Test',
          outcome: 'deferred',
          confidence: 0.5,
          timestamp: Date.now(),
          actorId: 'group',
          votes: [
            { actorId: 'participant1', position: 'abstain', confidence: 0.5, timestamp: Date.now() }
          ],
          minorityOpinions: [],
          consensusTime: 1000,
          participantCount: 1,
          quorumMet: false
        }
      ];

      for (const decision of decisions) {
        await memory.recordGroupDecision(decision);
      }
    });

    it('should calculate participation metrics', async () => {
      const metrics = await memory.getParticipationMetrics('participant1');

      expect(metrics.actorId).toBe('participant1');
      expect(metrics.decisionsParticipated).toBe(3);
      expect(metrics.votesFor).toBe(1);
      expect(metrics.votesAgainst).toBe(1);
      expect(metrics.abstentions).toBe(1);
    });

    it('should calculate average confidence', async () => {
      const metrics = await memory.getParticipationMetrics('participant1');
      expect(metrics.averageConfidence).toBeCloseTo((0.9 + 0.85 + 0.5) / 3, 2);
    });

    it('should calculate influence score', async () => {
      const metrics = await memory.getParticipationMetrics('participant1');
      expect(metrics.influenceScore).toBeGreaterThanOrEqual(0);
      expect(metrics.influenceScore).toBeLessThanOrEqual(1);
    });
  });

  describe('Similar Group Decisions', () => {
    beforeEach(async () => {
      const decisions: GroupDecision[] = [
        {
          decisionId: 'similar1',
          decisionType: 'loan_approval',
          context: {},
          inputs: [],
          rationale: 'Test',
          outcome: 'approved',
          confidence: 0.8,
          timestamp: Date.now(),
          actorId: 'committee',
          votes: [
            { actorId: 'member1', position: 'for', confidence: 0.9, timestamp: Date.now() },
            { actorId: 'member2', position: 'for', confidence: 0.8, timestamp: Date.now() }
          ],
          minorityOpinions: [],
          consensusTime: 3600000,
          participantCount: 2,
          quorumMet: true
        },
        {
          decisionId: 'similar2',
          decisionType: 'loan_approval',
          context: {},
          inputs: [],
          rationale: 'Test',
          outcome: 'approved',
          confidence: 0.85,
          timestamp: Date.now(),
          actorId: 'committee',
          votes: [
            { actorId: 'member1', position: 'for', confidence: 0.9, timestamp: Date.now() },
            { actorId: 'member2', position: 'for', confidence: 0.85, timestamp: Date.now() }
          ],
          minorityOpinions: [],
          consensusTime: 3500000,
          participantCount: 2,
          quorumMet: true
        },
        {
          decisionId: 'dissimilar',
          decisionType: 'loan_approval',
          context: {},
          inputs: [],
          rationale: 'Test',
          outcome: 'rejected',
          confidence: 0.9,
          timestamp: Date.now(),
          actorId: 'committee',
          votes: [
            { actorId: 'member3', position: 'against', confidence: 0.9, timestamp: Date.now() },
            { actorId: 'member4', position: 'against', confidence: 0.85, timestamp: Date.now() }
          ],
          minorityOpinions: [],
          consensusTime: 7200000,
          participantCount: 2,
          quorumMet: true
        }
      ];

      for (const decision of decisions) {
        await memory.recordGroupDecision(decision);
      }
    });

    it('should find similar group decisions', async () => {
      const similar = await memory.findSimilarGroupDecisions('similar1', {
        limit: 5,
        minSimilarity: 0.5
      });

      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0].similarity).toBeGreaterThan(0.5);
    });

    it('should rank by similarity', async () => {
      const similar = await memory.findSimilarGroupDecisions('similar1', { limit: 5 });

      if (similar.length > 1) {
        expect(similar[0].similarity).toBeGreaterThanOrEqual(similar[1].similarity);
      }
    });

    it('should filter by minimum similarity threshold', async () => {
      const similar = await memory.findSimilarGroupDecisions('similar1', {
        minSimilarity: 0.9
      });

      for (const result of similar) {
        expect(result.similarity).toBeGreaterThanOrEqual(0.9);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle decision with no votes', async () => {
      const decision: GroupDecision = {
        decisionId: 'no_votes',
        decisionType: 'approval',
        context: {},
        inputs: [],
        rationale: 'Auto-approved',
        outcome: 'approved',
        confidence: 1.0,
        timestamp: Date.now(),
        actorId: 'system',
        votes: [],
        minorityOpinions: [],
        consensusTime: 0,
        participantCount: 0,
        quorumMet: false
      };

      await memory.recordGroupDecision(decision);

      const votes = await memory.getVotes('no_votes');
      expect(votes).toHaveLength(0);
    });

    it('should handle group with single participant', async () => {
      const decision: GroupDecision = {
        decisionId: 'single_participant',
        decisionType: 'approval',
        context: {},
        inputs: [],
        rationale: 'Solo decision',
        outcome: 'approved',
        confidence: 0.9,
        timestamp: Date.now(),
        actorId: 'solo',
        votes: [
          { actorId: 'solo', position: 'for', confidence: 0.9, timestamp: Date.now() }
        ],
        minorityOpinions: [],
        consensusTime: 100,
        participantCount: 1,
        quorumMet: true
      };

      await memory.recordGroupDecision(decision);

      const metrics = await memory.analyzeGroupEffectiveness(['solo']);
      expect(metrics.decisionCount).toBe(1);
      expect(metrics.actorIds).toEqual(['solo']);
    });

    it('should handle empty actor list for effectiveness', async () => {
      const metrics = await memory.analyzeGroupEffectiveness([]);
      expect(metrics.decisionCount).toBe(0);
      expect(metrics.successRate).toBe(0);
    });
  });
});
