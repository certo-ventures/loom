import { randomUUID } from 'crypto';
import { ActorMemory } from './actor-memory';
import type { LamportClock } from '../../timing/lamport-clock';
import type { MemoryStorage } from './types';

/**
 * Voting mechanism types
 */
export type VotingMechanism = 
  | 'unanimous'        // All voters must agree
  | 'majority'         // >50% must agree
  | 'supermajority'    // Configurable threshold (e.g., 66%, 75%)
  | 'weighted'         // Votes have different weights
  | 'ranked-choice'    // Voters rank options
  | 'approval'         // Voters approve multiple options
  | 'threshold';       // Custom threshold percentage

/**
 * Vote options
 */
export type VoteOption = 'approve' | 'reject' | 'abstain';

/**
 * Vote weight basis
 */
export type WeightBasis = 'equal' | 'role' | 'expertise' | 'stake' | 'custom';

/**
 * Consensus configuration
 */
export interface ConsensusConfig {
  name: string;
  description: string;
  votingMechanism: VotingMechanism;
  eligibleVoters: string[];  // Actor IDs who can vote
  threshold?: number;        // For supermajority/threshold (0-1)
  weights?: Record<string, number>;  // Actor ID -> weight
  weightBasis?: WeightBasis;
  quorum?: number;          // Minimum participation (0-1)
  deadline?: number;        // Timestamp when voting closes
  allowAbstain?: boolean;
  allowChangeVote?: boolean;
  requireReason?: boolean;  // Require explanation for votes
  options?: string[];       // For ranked-choice/approval voting
}

/**
 * Individual vote
 */
export interface Vote {
  id: string;
  consensusId: string;
  voterId: string;
  option: VoteOption;
  weight: number;
  reason?: string;
  timestamp: number;
  rankedChoices?: string[];  // For ranked-choice voting
  approvedOptions?: string[];  // For approval voting
}

/**
 * Voting session
 */
export interface ConsensusSession {
  id: string;
  config: ConsensusConfig;
  status: 'open' | 'closed' | 'expired';
  createdAt: number;
  closedAt?: number;
  votes: Vote[];
  result?: ConsensusResult;
}

/**
 * Consensus result
 */
export interface ConsensusResult {
  consensus: 'reached' | 'not-reached' | 'tie' | 'no-quorum';
  outcome: VoteOption | string;  // The winning option or outcome
  voteBreakdown: {
    approve: number;
    reject: number;
    abstain: number;
  };
  weightedBreakdown?: {
    approve: number;
    reject: number;
    abstain: number;
  };
  participation: number;  // Percentage of eligible voters who voted
  threshold?: number;
  winner?: string;  // For ranked-choice/approval voting
  finalizedBy?: string;
  finalizedAt: number;
  summary: string;
}

/**
 * ConsensusEngine - Manages voting, consensus building, and decision finalization
 * 
 * Supports multiple voting mechanisms:
 * - Unanimous: All voters must agree
 * - Majority: >50% must agree
 * - Supermajority: Configurable threshold (e.g., 66%, 75%)
 * - Weighted: Different vote weights by role/expertise/stake
 * - Ranked Choice: Voters rank multiple options
 * - Approval: Voters can approve multiple options
 * 
 * Features:
 * - Quorum enforcement
 * - Vote change allowance
 * - Deadline management
 * - Vote history tracking
 * - Audit trail
 */
export class ConsensusEngine extends ActorMemory {
  private sessions: Map<string, ConsensusSession>;  // Cache for performance

  constructor(
    actorId: string,
    storage: MemoryStorage,
    clock: LamportClock
  ) {
    super(actorId, storage, clock);
    this.sessions = new Map();
  }

  /**
   * Create a new consensus session
   */
  async createSession(config: ConsensusConfig): Promise<string> {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const sessionId = `consensus:${timestamp}:${random}`;
    
    // Validate configuration
    this.validateConfig(config);

    const session: ConsensusSession = {
      id: sessionId,
      config,
      status: 'open',
      createdAt: timestamp,
      votes: []
    };

    // Store in memory graph
    const entityId = await this.addEntity(
      sessionId,
      'consensus-session',
      config.description,
      {
        metadata: {
          votingMechanism: config.votingMechanism,
          eligibleVoters: config.eligibleVoters.length,
          deadline: config.deadline
        }
      }
    );

    await this.addFact(
      entityId,
      'has_session_data',
      entityId,
      JSON.stringify(session),
      {
        source: 'consensus-system' as any,
        confidence: 1.0,
        metadata: { status: 'open' }
      }
    );

    // Cache the session
    this.sessions.set(sessionId, session);

    return sessionId;
  }

  /**
   * Cast a vote
   */
  async castVote(
    sessionId: string,
    voterId: string,
    option: VoteOption,
    voteOptions?: {
      reason?: string;
      rankedChoices?: string[];
      approvedOptions?: string[];
    }
  ): Promise<string> {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      throw new Error(`Consensus session ${sessionId} not found`);
    }

    if (session.status !== 'open') {
      throw new Error(`Consensus session ${sessionId} is ${session.status}`);
    }

    // Check deadline
    if (session.config.deadline && Date.now() > session.config.deadline) {
      session.status = 'expired';
      await this.updateSessionInStorage(session);
      throw new Error(`Consensus session ${sessionId} has expired`);
    }

    // Validate voter eligibility
    if (!session.config.eligibleVoters.includes(voterId)) {
      throw new Error(`Actor ${voterId} is not eligible to vote in session ${sessionId}`);
    }

    // Check if voter already voted
    const existingVote = session.votes.find(v => v.voterId === voterId);
    if (existingVote && !session.config.allowChangeVote) {
      throw new Error(`Actor ${voterId} has already voted in session ${sessionId}`);
    }

    // Check if reason is required
    if (session.config.requireReason && !voteOptions?.reason) {
      throw new Error('Vote reason is required for this consensus session');
    }

    // Calculate vote weight
    const weight = this.calculateVoteWeight(session, voterId);

    const vote: Vote = {
      id: `vote:${sessionId}:${voterId}:${Date.now()}`,
      consensusId: sessionId,
      voterId,
      option,
      weight,
      reason: voteOptions?.reason,
      timestamp: Date.now(),
      rankedChoices: voteOptions?.rankedChoices,
      approvedOptions: voteOptions?.approvedOptions
    };

    // Update or add vote
    if (existingVote) {
      const index = session.votes.indexOf(existingVote);
      session.votes[index] = vote;
    } else {
      session.votes.push(vote);
    }

    // Update in storage
    await this.updateSessionInStorage(session);

    // Store vote as fact
    const entities = await this.getEntities();
    const sessionEntity = entities.find(e => e.name === sessionId);
    
    if (sessionEntity) {
      await this.addFact(
        sessionEntity.id,
        'has_vote',
        voterId,
        JSON.stringify(vote),
        {
          source: 'user_input' as any,
          confidence: 1.0,
          metadata: { 
            option,
            weight,
            timestamp: vote.timestamp
          }
        }
      );
    }

    return vote.id;
  }

  /**
   * Finalize consensus and calculate result
   */
  async finalizeConsensus(
    sessionId: string,
    finalizedBy: string
  ): Promise<ConsensusResult> {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      throw new Error(`Consensus session ${sessionId} not found`);
    }

    if (session.status === 'closed') {
      throw new Error(`Consensus session ${sessionId} is already closed`);
    }

    // Calculate result based on voting mechanism
    const result = this.calculateResult(session);
    
    session.result = {
      ...result,
      finalizedBy,
      finalizedAt: Date.now()
    };
    session.status = 'closed';
    session.closedAt = Date.now();

    // Update in storage
    await this.updateSessionInStorage(session);

    // Record finalization fact
    const entities = await this.getEntities();
    const sessionEntity = entities.find(e => e.name === sessionId);
    
    if (sessionEntity) {
      await this.addFact(
        sessionEntity.id,
        'consensus_finalized',
        sessionEntity.id,
        JSON.stringify(result),
        {
          source: 'user_input' as any,
          confidence: 1.0,
          metadata: { 
            consensus: result.consensus,
            outcome: result.outcome,
            finalizedAt: result.finalizedAt
          }
        }
      );
    }

    return result;
  }

  /**
   * Get current vote tally (without finalizing)
   */
  async getTally(sessionId: string): Promise<{
    breakdown: ConsensusResult['voteBreakdown'];
    weightedBreakdown?: ConsensusResult['weightedBreakdown'];
    participation: number;
  }> {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      throw new Error(`Consensus session ${sessionId} not found`);
    }

    const breakdown = this.calculateBreakdown(session);
    const weightedBreakdown = this.calculateWeightedBreakdown(session);
    const participation = session.votes.length / session.config.eligibleVoters.length;

    return {
      breakdown,
      weightedBreakdown,
      participation
    };
  }

  /**
   * Get consensus session by ID
   */
  async getSession(sessionId: string): Promise<ConsensusSession | null> {
    // Check cache first
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    // Load from storage
    const entities = await this.getEntities();
    const sessionEntity = entities.find(e => e.name === sessionId && e.type === 'consensus-session');
    
    if (!sessionEntity) {
      return null;
    }

    const facts = await this.getCurrentFacts();
    const sessionFacts = facts.filter(
      f => f.relation === 'has_session_data' && f.sourceEntityId === sessionEntity.id
    ).sort((a, b) => b.lamport_ts - a.lamport_ts);

    if (sessionFacts.length === 0) {
      return null;
    }

    try {
      const session = JSON.parse(sessionFacts[0].text);
      this.sessions.set(sessionId, session);
      return session;
    } catch {
      return null;
    }
  }

  /**
   * List all consensus sessions
   */
  async listSessions(status?: 'open' | 'closed' | 'expired'): Promise<ConsensusSession[]> {
    const entities = await this.getEntities();
    const sessionEntities = entities.filter(e => e.type === 'consensus-session');
    
    const facts = await this.getCurrentFacts();
    const sessions: ConsensusSession[] = [];

    for (const entity of sessionEntities) {
      const sessionFacts = facts.filter(
        f => f.relation === 'has_session_data' && f.sourceEntityId === entity.id
      ).sort((a, b) => b.lamport_ts - a.lamport_ts);

      if (sessionFacts.length > 0) {
        try {
          const session = JSON.parse(sessionFacts[0].text);
          if (!status || session.status === status) {
            sessions.push(session);
          }
        } catch {
          // Skip invalid data
        }
      }
    }

    return sessions;
  }

  /**
   * Get voter's vote in a session
   */
  async getVote(sessionId: string, voterId: string): Promise<Vote | null> {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      return null;
    }

    return session.votes.find(v => v.voterId === voterId) || null;
  }

  /**
   * Check if quorum is met
   */
  async isQuorumMet(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      return false;
    }

    if (!session.config.quorum) {
      return true;  // No quorum requirement
    }

    const participation = session.votes.length / session.config.eligibleVoters.length;
    return participation >= session.config.quorum;
  }

  /**
   * Calculate result based on voting mechanism
   */
  private calculateResult(session: ConsensusSession): ConsensusResult {
    const breakdown = this.calculateBreakdown(session);
    const weightedBreakdown = this.calculateWeightedBreakdown(session);
    const participation = session.votes.length / session.config.eligibleVoters.length;

    // Check quorum
    if (session.config.quorum && participation < session.config.quorum) {
      return {
        consensus: 'no-quorum',
        outcome: 'rejected',
        voteBreakdown: breakdown,
        weightedBreakdown,
        participation,
        threshold: session.config.quorum,
        finalizedAt: Date.now(),
        summary: `Quorum not met. Required: ${(session.config.quorum * 100).toFixed(0)}%, Actual: ${(participation * 100).toFixed(0)}%`
      };
    }

    switch (session.config.votingMechanism) {
      case 'unanimous':
        return this.calculateUnanimous(session, breakdown, weightedBreakdown, participation);
      
      case 'majority':
        return this.calculateMajority(session, breakdown, weightedBreakdown, participation);
      
      case 'supermajority':
      case 'threshold':
        return this.calculateThreshold(session, breakdown, weightedBreakdown, participation);
      
      case 'weighted':
        return this.calculateWeighted(session, breakdown, weightedBreakdown, participation);
      
      case 'ranked-choice':
        return this.calculateRankedChoice(session, breakdown, weightedBreakdown, participation);
      
      case 'approval':
        return this.calculateApproval(session, breakdown, weightedBreakdown, participation);
      
      default:
        throw new Error(`Unknown voting mechanism: ${session.config.votingMechanism}`);
    }
  }

  /**
   * Calculate unanimous result
   */
  private calculateUnanimous(
    session: ConsensusSession,
    breakdown: ConsensusResult['voteBreakdown'],
    weightedBreakdown: ConsensusResult['weightedBreakdown'],
    participation: number
  ): ConsensusResult {
    const total = breakdown.approve + breakdown.reject;
    
    if (breakdown.approve === total && total === session.config.eligibleVoters.length) {
      return {
        consensus: 'reached',
        outcome: 'approve',
        voteBreakdown: breakdown,
        weightedBreakdown,
        participation,
        finalizedAt: Date.now(),
        summary: 'Unanimous approval achieved'
      };
    }
    
    return {
      consensus: 'not-reached',
      outcome: 'reject',
      voteBreakdown: breakdown,
      weightedBreakdown,
      participation,
      finalizedAt: Date.now(),
      summary: 'Unanimous consensus not reached'
    };
  }

  /**
   * Calculate majority result
   */
  private calculateMajority(
    session: ConsensusSession,
    breakdown: ConsensusResult['voteBreakdown'],
    weightedBreakdown: ConsensusResult['weightedBreakdown'],
    participation: number
  ): ConsensusResult {
    const total = breakdown.approve + breakdown.reject;
    const approvalRate = total > 0 ? breakdown.approve / total : 0;
    
    if (approvalRate > 0.5) {
      return {
        consensus: 'reached',
        outcome: 'approve',
        voteBreakdown: breakdown,
        weightedBreakdown,
        participation,
        threshold: 0.5,
        finalizedAt: Date.now(),
        summary: `Majority approval: ${(approvalRate * 100).toFixed(1)}%`
      };
    } else if (approvalRate < 0.5) {
      return {
        consensus: 'reached',
        outcome: 'reject',
        voteBreakdown: breakdown,
        weightedBreakdown,
        participation,
        threshold: 0.5,
        finalizedAt: Date.now(),
        summary: `Majority rejection: ${((1 - approvalRate) * 100).toFixed(1)}%`
      };
    } else {
      return {
        consensus: 'tie',
        outcome: 'tie',
        voteBreakdown: breakdown,
        weightedBreakdown,
        participation,
        threshold: 0.5,
        finalizedAt: Date.now(),
        summary: 'Vote resulted in a tie'
      };
    }
  }

  /**
   * Calculate threshold/supermajority result
   */
  private calculateThreshold(
    session: ConsensusSession,
    breakdown: ConsensusResult['voteBreakdown'],
    weightedBreakdown: ConsensusResult['weightedBreakdown'],
    participation: number
  ): ConsensusResult {
    const threshold = session.config.threshold || 0.66;
    const total = breakdown.approve + breakdown.reject;
    const approvalRate = total > 0 ? breakdown.approve / total : 0;
    
    if (approvalRate >= threshold) {
      return {
        consensus: 'reached',
        outcome: 'approve',
        voteBreakdown: breakdown,
        weightedBreakdown,
        participation,
        threshold,
        finalizedAt: Date.now(),
        summary: `Threshold met: ${(approvalRate * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(0)}%`
      };
    }
    
    return {
      consensus: 'not-reached',
      outcome: 'reject',
      voteBreakdown: breakdown,
      weightedBreakdown,
      participation,
      threshold,
      finalizedAt: Date.now(),
      summary: `Threshold not met: ${(approvalRate * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}%`
    };
  }

  /**
   * Calculate weighted result
   */
  private calculateWeighted(
    session: ConsensusSession,
    breakdown: ConsensusResult['voteBreakdown'],
    weightedBreakdown: ConsensusResult['weightedBreakdown'],
    participation: number
  ): ConsensusResult {
    if (!weightedBreakdown) {
      throw new Error('Weighted breakdown required for weighted voting');
    }

    const totalWeight = weightedBreakdown.approve + weightedBreakdown.reject;
    const approvalRate = totalWeight > 0 ? weightedBreakdown.approve / totalWeight : 0;
    const threshold = session.config.threshold || 0.5;
    
    if (approvalRate >= threshold) {
      return {
        consensus: 'reached',
        outcome: 'approve',
        voteBreakdown: breakdown,
        weightedBreakdown,
        participation,
        threshold,
        finalizedAt: Date.now(),
        summary: `Weighted approval: ${(approvalRate * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(0)}%`
      };
    }
    
    return {
      consensus: 'not-reached',
      outcome: 'reject',
      voteBreakdown: breakdown,
      weightedBreakdown,
      participation,
      threshold,
      finalizedAt: Date.now(),
      summary: `Weighted approval: ${(approvalRate * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}%`
    };
  }

  /**
   * Calculate ranked-choice result
   */
  private calculateRankedChoice(
    session: ConsensusSession,
    breakdown: ConsensusResult['voteBreakdown'],
    weightedBreakdown: ConsensusResult['weightedBreakdown'],
    participation: number
  ): ConsensusResult {
    if (!session.config.options || session.config.options.length === 0) {
      throw new Error('Options required for ranked-choice voting');
    }

    // Implement instant-runoff voting
    const options = [...session.config.options];
    let rounds = 0;
    const maxRounds = options.length - 1;

    while (options.length > 1 && rounds < maxRounds) {
      const firstChoiceVotes = new Map<string, number>();
      
      // Count first-choice votes for remaining options
      for (const vote of session.votes) {
        if (!vote.rankedChoices || vote.rankedChoices.length === 0) continue;
        
        // Find first choice that's still in the race
        const firstChoice = vote.rankedChoices.find(choice => options.includes(choice));
        if (firstChoice) {
          firstChoiceVotes.set(firstChoice, (firstChoiceVotes.get(firstChoice) || 0) + 1);
        }
      }

      // Check if any option has majority
      const totalVotes = Array.from(firstChoiceVotes.values()).reduce((a, b) => a + b, 0);
      for (const [option, votes] of firstChoiceVotes) {
        if (votes / totalVotes > 0.5) {
          return {
            consensus: 'reached',
            outcome: option,
            winner: option,
            voteBreakdown: breakdown,
            weightedBreakdown,
            participation,
            finalizedAt: Date.now(),
            summary: `Winner by ranked-choice: ${option} (${(votes / totalVotes * 100).toFixed(1)}%)`
          };
        }
      }

      // Eliminate option with fewest first-choice votes
      let minVotes = Infinity;
      let toEliminate = '';
      for (const [option, votes] of firstChoiceVotes) {
        if (votes < minVotes) {
          minVotes = votes;
          toEliminate = option;
        }
      }
      
      const index = options.indexOf(toEliminate);
      if (index > -1) {
        options.splice(index, 1);
      }
      
      rounds++;
    }

    // If we get here, return the last remaining option
    const winner = options[0] || session.config.options[0];
    return {
      consensus: 'reached',
      outcome: winner,
      winner,
      voteBreakdown: breakdown,
      weightedBreakdown,
      participation,
      finalizedAt: Date.now(),
      summary: `Winner by ranked-choice: ${winner}`
    };
  }

  /**
   * Calculate approval voting result
   */
  private calculateApproval(
    session: ConsensusSession,
    breakdown: ConsensusResult['voteBreakdown'],
    weightedBreakdown: ConsensusResult['weightedBreakdown'],
    participation: number
  ): ConsensusResult {
    if (!session.config.options || session.config.options.length === 0) {
      throw new Error('Options required for approval voting');
    }

    // Count approvals for each option
    const approvals = new Map<string, number>();
    for (const option of session.config.options) {
      approvals.set(option, 0);
    }

    for (const vote of session.votes) {
      if (!vote.approvedOptions) continue;
      
      for (const option of vote.approvedOptions) {
        if (approvals.has(option)) {
          approvals.set(option, approvals.get(option)! + 1);
        }
      }
    }

    // Find option with most approvals
    let maxApprovals = 0;
    let winner = session.config.options[0];
    
    for (const [option, count] of approvals) {
      if (count > maxApprovals) {
        maxApprovals = count;
        winner = option;
      }
    }

    const approvalRate = session.votes.length > 0 ? maxApprovals / session.votes.length : 0;

    return {
      consensus: 'reached',
      outcome: winner,
      winner,
      voteBreakdown: breakdown,
      weightedBreakdown,
      participation,
      finalizedAt: Date.now(),
      summary: `Winner by approval voting: ${winner} (${maxApprovals} approvals, ${(approvalRate * 100).toFixed(1)}%)`
    };
  }

  /**
   * Calculate vote breakdown
   */
  private calculateBreakdown(session: ConsensusSession): ConsensusResult['voteBreakdown'] {
    const breakdown = {
      approve: 0,
      reject: 0,
      abstain: 0
    };

    for (const vote of session.votes) {
      breakdown[vote.option]++;
    }

    return breakdown;
  }

  /**
   * Calculate weighted vote breakdown
   */
  private calculateWeightedBreakdown(session: ConsensusSession): ConsensusResult['weightedBreakdown'] {
    const breakdown = {
      approve: 0,
      reject: 0,
      abstain: 0
    };

    for (const vote of session.votes) {
      breakdown[vote.option] += vote.weight;
    }

    return breakdown;
  }

  /**
   * Calculate vote weight for a voter
   */
  private calculateVoteWeight(session: ConsensusSession, voterId: string): number {
    // Check for custom weights
    if (session.config.weights && session.config.weights[voterId] !== undefined) {
      return session.config.weights[voterId];
    }

    // For now, default to equal weight of 1
    // In future, could implement role-based, expertise-based, or stake-based weights
    return 1;
  }

  /**
   * Validate consensus configuration
   */
  private validateConfig(config: ConsensusConfig): void {
    if (config.eligibleVoters.length === 0) {
      throw new Error('At least one eligible voter is required');
    }

    if (config.threshold !== undefined && (config.threshold < 0 || config.threshold > 1)) {
      throw new Error('Threshold must be between 0 and 1');
    }

    if (config.quorum !== undefined && (config.quorum < 0 || config.quorum > 1)) {
      throw new Error('Quorum must be between 0 and 1');
    }

    if (config.votingMechanism === 'ranked-choice' || config.votingMechanism === 'approval') {
      if (!config.options || config.options.length < 2) {
        throw new Error(`At least 2 options required for ${config.votingMechanism} voting`);
      }
    }
  }

  /**
   * Update session in storage
   */
  private async updateSessionInStorage(session: ConsensusSession): Promise<void> {
    const entities = await this.getEntities();
    const sessionEntity = entities.find(e => e.name === session.id);
    
    if (sessionEntity) {
      await this.addFact(
        sessionEntity.id,
        'has_session_data',
        sessionEntity.id,
        JSON.stringify(session),
        {
          source: 'consensus-system' as any,
          confidence: 1.0,
          metadata: { 
            status: session.status,
            updatedAt: Date.now()
          }
        }
      );
    }

    // Update cache
    this.sessions.set(session.id, session);
  }
}
