import { describe, it, expect, beforeEach } from 'vitest';
import { ConsensusEngine, ConsensusConfig, VoteOption } from '../../../src/memory/graph/consensus-engine';
import { InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage';
import { LamportClock } from '../../../src/timing/lamport-clock';

describe('ConsensusEngine - Voting & Consensus Building', () => {
  let storage: InMemoryGraphStorage;
  let clock: LamportClock;
  let engine: ConsensusEngine;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    clock = new LamportClock();
    engine = new ConsensusEngine('system', storage, clock);
  });

  describe('Session Creation', () => {
    it('should create a consensus session with majority voting', async () => {
      const config: ConsensusConfig = {
        name: 'Board Vote',
        description: 'Vote on Q4 budget approval',
        votingMechanism: 'majority',
        eligibleVoters: ['alice', 'bob', 'charlie']
      };

      const sessionId = await engine.createSession(config);
      
      expect(sessionId).toMatch(/^consensus:/);
      
      const session = await engine.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.config.votingMechanism).toBe('majority');
      expect(session?.status).toBe('open');
      expect(session?.votes.length).toBe(0);
    });

    it('should create session with supermajority threshold', async () => {
      const config: ConsensusConfig = {
        name: 'Constitutional Amendment',
        description: 'Requires 2/3 approval',
        votingMechanism: 'supermajority',
        threshold: 0.67,
        eligibleVoters: ['alice', 'bob', 'charlie', 'diana']
      };

      const sessionId = await engine.createSession(config);
      const session = await engine.getSession(sessionId);
      
      expect(session?.config.threshold).toBe(0.67);
    });

    it('should create session with quorum requirement', async () => {
      const config: ConsensusConfig = {
        name: 'Board Meeting',
        description: 'Requires 75% participation',
        votingMechanism: 'majority',
        quorum: 0.75,
        eligibleVoters: ['alice', 'bob', 'charlie', 'diana']
      };

      const sessionId = await engine.createSession(config);
      const session = await engine.getSession(sessionId);
      
      expect(session?.config.quorum).toBe(0.75);
    });

    it('should reject invalid configuration', async () => {
      const config: ConsensusConfig = {
        name: 'Bad Config',
        description: 'Invalid threshold',
        votingMechanism: 'threshold',
        threshold: 1.5,  // Invalid: > 1
        eligibleVoters: ['alice']
      };

      await expect(engine.createSession(config)).rejects.toThrow('Threshold must be between 0 and 1');
    });
  });

  describe('Vote Casting', () => {
    it('should cast an approval vote', async () => {
      const config: ConsensusConfig = {
        name: 'Simple Vote',
        description: 'Yes/No vote',
        votingMechanism: 'majority',
        eligibleVoters: ['alice', 'bob', 'charlie']
      };

      const sessionId = await engine.createSession(config);
      
      const voteId = await engine.castVote(sessionId, 'alice', 'approve');
      
      expect(voteId).toMatch(/^vote:/);
      
      const vote = await engine.getVote(sessionId, 'alice');
      expect(vote).toBeDefined();
      expect(vote?.option).toBe('approve');
      expect(vote?.voterId).toBe('alice');
    });

    it('should cast votes with reasons', async () => {
      const config: ConsensusConfig = {
        name: 'Documented Vote',
        description: 'Requires explanation',
        votingMechanism: 'majority',
        eligibleVoters: ['alice', 'bob'],
        requireReason: true
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve', {
        reason: 'Strong financial fundamentals support this decision'
      });
      
      const vote = await engine.getVote(sessionId, 'alice');
      expect(vote?.reason).toBe('Strong financial fundamentals support this decision');
    });

    it('should reject vote without reason when required', async () => {
      const config: ConsensusConfig = {
        name: 'Documented Vote',
        description: 'Requires explanation',
        votingMechanism: 'majority',
        eligibleVoters: ['alice'],
        requireReason: true
      };

      const sessionId = await engine.createSession(config);
      
      await expect(
        engine.castVote(sessionId, 'alice', 'approve')
      ).rejects.toThrow('Vote reason is required');
    });

    it('should reject vote from ineligible voter', async () => {
      const config: ConsensusConfig = {
        name: 'Restricted Vote',
        description: 'Only board members',
        votingMechanism: 'majority',
        eligibleVoters: ['alice', 'bob']
      };

      const sessionId = await engine.createSession(config);
      
      await expect(
        engine.castVote(sessionId, 'charlie', 'approve')
      ).rejects.toThrow('not eligible to vote');
    });

    it('should reject duplicate votes when not allowed', async () => {
      const config: ConsensusConfig = {
        name: 'One Vote Only',
        description: 'No vote changes',
        votingMechanism: 'majority',
        eligibleVoters: ['alice'],
        allowChangeVote: false
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve');
      
      await expect(
        engine.castVote(sessionId, 'alice', 'reject')
      ).rejects.toThrow('already voted');
    });

    it('should allow vote changes when enabled', async () => {
      const config: ConsensusConfig = {
        name: 'Changeable Vote',
        description: 'Can change mind',
        votingMechanism: 'majority',
        eligibleVoters: ['alice'],
        allowChangeVote: true
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.castVote(sessionId, 'alice', 'reject');
      
      const vote = await engine.getVote(sessionId, 'alice');
      expect(vote?.option).toBe('reject');
      
      const session = await engine.getSession(sessionId);
      expect(session?.votes.length).toBe(1);  // Only one vote, replaced
    });
  });

  describe('Majority Voting', () => {
    it('should reach consensus with simple majority', async () => {
      const config: ConsensusConfig = {
        name: 'Majority Vote',
        description: 'Simple majority',
        votingMechanism: 'majority',
        eligibleVoters: ['alice', 'bob', 'charlie']
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.castVote(sessionId, 'bob', 'approve');
      await engine.castVote(sessionId, 'charlie', 'reject');
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      expect(result.consensus).toBe('reached');
      expect(result.outcome).toBe('approve');
      expect(result.voteBreakdown.approve).toBe(2);
      expect(result.voteBreakdown.reject).toBe(1);
    });

    it('should reject with majority against', async () => {
      const config: ConsensusConfig = {
        name: 'Majority Rejection',
        description: 'Most vote no',
        votingMechanism: 'majority',
        eligibleVoters: ['alice', 'bob', 'charlie']
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'reject');
      await engine.castVote(sessionId, 'bob', 'reject');
      await engine.castVote(sessionId, 'charlie', 'approve');
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      expect(result.consensus).toBe('reached');
      expect(result.outcome).toBe('reject');
    });

    it('should handle tie votes', async () => {
      const config: ConsensusConfig = {
        name: 'Tied Vote',
        description: 'Even split',
        votingMechanism: 'majority',
        eligibleVoters: ['alice', 'bob']
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.castVote(sessionId, 'bob', 'reject');
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      expect(result.consensus).toBe('tie');
      expect(result.outcome).toBe('tie');
    });
  });

  describe('Unanimous Voting', () => {
    it('should reach consensus when all approve', async () => {
      const config: ConsensusConfig = {
        name: 'Unanimous Vote',
        description: 'All must agree',
        votingMechanism: 'unanimous',
        eligibleVoters: ['alice', 'bob', 'charlie']
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.castVote(sessionId, 'bob', 'approve');
      await engine.castVote(sessionId, 'charlie', 'approve');
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      expect(result.consensus).toBe('reached');
      expect(result.outcome).toBe('approve');
      expect(result.summary).toContain('Unanimous');
    });

    it('should not reach consensus with one dissent', async () => {
      const config: ConsensusConfig = {
        name: 'Almost Unanimous',
        description: 'One dissenter',
        votingMechanism: 'unanimous',
        eligibleVoters: ['alice', 'bob', 'charlie']
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.castVote(sessionId, 'bob', 'approve');
      await engine.castVote(sessionId, 'charlie', 'reject');
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      expect(result.consensus).toBe('not-reached');
    });
  });

  describe('Supermajority/Threshold Voting', () => {
    it('should reach consensus meeting threshold', async () => {
      const config: ConsensusConfig = {
        name: '2/3 Supermajority',
        description: 'Requires 67% approval',
        votingMechanism: 'supermajority',
        threshold: 0.67,
        eligibleVoters: ['alice', 'bob', 'charlie', 'diana']
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.castVote(sessionId, 'bob', 'approve');
      await engine.castVote(sessionId, 'charlie', 'approve');
      await engine.castVote(sessionId, 'diana', 'reject');
      // 3/4 = 75% > 67%
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      expect(result.consensus).toBe('reached');
      expect(result.outcome).toBe('approve');
      expect(result.threshold).toBe(0.67);
    });

    it('should not reach consensus below threshold', async () => {
      const config: ConsensusConfig = {
        name: '3/4 Supermajority',
        description: 'Requires 75% approval',
        votingMechanism: 'supermajority',
        threshold: 0.75,
        eligibleVoters: ['alice', 'bob', 'charlie', 'diana']
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.castVote(sessionId, 'bob', 'approve');
      await engine.castVote(sessionId, 'charlie', 'reject');
      await engine.castVote(sessionId, 'diana', 'reject');
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      expect(result.consensus).toBe('not-reached');
    });
  });

  describe('Weighted Voting', () => {
    it('should apply custom vote weights', async () => {
      const config: ConsensusConfig = {
        name: 'Weighted Board Vote',
        description: 'CEO has more weight',
        votingMechanism: 'weighted',
        threshold: 0.5,
        eligibleVoters: ['ceo', 'cfo', 'cto'],
        weights: {
          'ceo': 2,
          'cfo': 1,
          'cto': 1
        }
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'ceo', 'approve');  // 2 points
      await engine.castVote(sessionId, 'cfo', 'reject');   // 1 point
      await engine.castVote(sessionId, 'cto', 'reject');   // 1 point
      
      const tally = await engine.getTally(sessionId);
      
      expect(tally.weightedBreakdown?.approve).toBe(2);
      expect(tally.weightedBreakdown?.reject).toBe(2);
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      // With equal weights, would be rejected. But CEO's double weight makes it tie or pass depending on threshold
      expect(result.weightedBreakdown?.approve).toBe(2);
      expect(result.weightedBreakdown?.reject).toBe(2);
    });
  });

  describe('Ranked Choice Voting', () => {
    it('should select winner by ranked choice', async () => {
      const config: ConsensusConfig = {
        name: 'Vendor Selection',
        description: 'Choose between 3 vendors',
        votingMechanism: 'ranked-choice',
        eligibleVoters: ['alice', 'bob', 'charlie'],
        options: ['VendorA', 'VendorB', 'VendorC']
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve', {
        rankedChoices: ['VendorA', 'VendorB', 'VendorC']
      });
      
      await engine.castVote(sessionId, 'bob', 'approve', {
        rankedChoices: ['VendorB', 'VendorA', 'VendorC']
      });
      
      await engine.castVote(sessionId, 'charlie', 'approve', {
        rankedChoices: ['VendorA', 'VendorC', 'VendorB']
      });
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      expect(result.consensus).toBe('reached');
      expect(result.winner).toBe('VendorA');  // Has majority of first-choice votes
    });
  });

  describe('Approval Voting', () => {
    it('should select most approved option', async () => {
      const config: ConsensusConfig = {
        name: 'Feature Selection',
        description: 'Approve multiple features',
        votingMechanism: 'approval',
        eligibleVoters: ['alice', 'bob', 'charlie'],
        options: ['FeatureX', 'FeatureY', 'FeatureZ']
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve', {
        approvedOptions: ['FeatureX', 'FeatureY']
      });
      
      await engine.castVote(sessionId, 'bob', 'approve', {
        approvedOptions: ['FeatureX', 'FeatureZ']
      });
      
      await engine.castVote(sessionId, 'charlie', 'approve', {
        approvedOptions: ['FeatureX']
      });
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      expect(result.consensus).toBe('reached');
      expect(result.winner).toBe('FeatureX');  // Approved by all 3
    });
  });

  describe('Quorum Requirements', () => {
    it('should reject when quorum not met', async () => {
      const config: ConsensusConfig = {
        name: 'High Quorum',
        description: 'Needs 75% participation',
        votingMechanism: 'majority',
        quorum: 0.75,
        eligibleVoters: ['alice', 'bob', 'charlie', 'diana']
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.castVote(sessionId, 'bob', 'approve');
      // Only 2/4 voted (50%), need 75%
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      expect(result.consensus).toBe('no-quorum');
      expect(result.summary).toContain('Quorum not met');
    });

    it('should pass when quorum met', async () => {
      const config: ConsensusConfig = {
        name: 'Achievable Quorum',
        description: 'Needs 50% participation',
        votingMechanism: 'majority',
        quorum: 0.5,
        eligibleVoters: ['alice', 'bob', 'charlie', 'diana']
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.castVote(sessionId, 'bob', 'approve');
      // 2/4 = 50%, meets quorum
      
      const quorumMet = await engine.isQuorumMet(sessionId);
      expect(quorumMet).toBe(true);
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      expect(result.consensus).not.toBe('no-quorum');
    });
  });

  describe('Session Management', () => {
    it('should list all sessions', async () => {
      const config1: ConsensusConfig = {
        name: 'Session 1',
        description: 'First session',
        votingMechanism: 'majority',
        eligibleVoters: ['alice']
      };
      
      const config2: ConsensusConfig = {
        name: 'Session 2',
        description: 'Second session',
        votingMechanism: 'unanimous',
        eligibleVoters: ['bob']
      };

      await engine.createSession(config1);
      await engine.createSession(config2);
      
      const sessions = await engine.listSessions();
      
      expect(sessions.length).toBe(2);
    });

    it('should filter sessions by status', async () => {
      const config: ConsensusConfig = {
        name: 'Closeable Session',
        description: 'Will be closed',
        votingMechanism: 'majority',
        eligibleVoters: ['alice']
      };

      const sessionId = await engine.createSession(config);
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.finalizeConsensus(sessionId, 'system');
      
      const openSessions = await engine.listSessions('open');
      const closedSessions = await engine.listSessions('closed');
      
      expect(closedSessions.length).toBeGreaterThan(0);
      expect(closedSessions[0].status).toBe('closed');
    });

    it('should get current tally without finalizing', async () => {
      const config: ConsensusConfig = {
        name: 'Ongoing Vote',
        description: 'Check progress',
        votingMechanism: 'majority',
        eligibleVoters: ['alice', 'bob', 'charlie']
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.castVote(sessionId, 'bob', 'reject');
      
      const tally = await engine.getTally(sessionId);
      
      expect(tally.breakdown.approve).toBe(1);
      expect(tally.breakdown.reject).toBe(1);
      expect(tally.participation).toBeCloseTo(2/3, 2);
      
      const session = await engine.getSession(sessionId);
      expect(session?.status).toBe('open');  // Still open
    });

    it('should prevent voting on closed session', async () => {
      const config: ConsensusConfig = {
        name: 'Closed Session',
        description: 'Already finalized',
        votingMechanism: 'majority',
        eligibleVoters: ['alice', 'bob']
      };

      const sessionId = await engine.createSession(config);
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.finalizeConsensus(sessionId, 'system');
      
      await expect(
        engine.castVote(sessionId, 'bob', 'approve')
      ).rejects.toThrow('closed');
    });

    it('should handle abstain votes', async () => {
      const config: ConsensusConfig = {
        name: 'With Abstentions',
        description: 'Allow abstaining',
        votingMechanism: 'majority',
        eligibleVoters: ['alice', 'bob', 'charlie'],
        allowAbstain: true
      };

      const sessionId = await engine.createSession(config);
      
      await engine.castVote(sessionId, 'alice', 'approve');
      await engine.castVote(sessionId, 'bob', 'reject');
      await engine.castVote(sessionId, 'charlie', 'abstain');
      
      const result = await engine.finalizeConsensus(sessionId, 'system');
      
      expect(result.voteBreakdown.abstain).toBe(1);
      expect(result.voteBreakdown.approve).toBe(1);
      expect(result.voteBreakdown.reject).toBe(1);
    });
  });
});
