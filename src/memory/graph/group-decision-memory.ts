/**
 * GroupDecisionMemory - Track group dynamics and multi-actor decision-making
 * 
 * Part of Phase 7A Week 3: Group Decision & Collaboration System
 * 
 * Extends DecisionMemory to add:
 * - Who voted how tracking
 * - Opinion changes over time
 * - Minority opinions
 * - Time to consensus
 * - Group effectiveness metrics
 */

import { DecisionMemory, DecisionMemoryOptions } from './decision-memory';
import { MemoryStorage } from './types';
import { LamportClock } from '../../timing/lamport-clock';
import { DecisionTrace } from '../../actor/decision-trace';

/**
 * A vote cast by an actor
 */
export interface Vote {
  actorId: string;
  position: 'for' | 'against' | 'abstain';
  reason?: string;
  confidence: number; // 0-1 scale
  timestamp: number;
}

/**
 * Opinion change tracking
 */
export interface OpinionChange {
  actorId: string;
  decisionId: string;
  before: Vote;
  after: Vote;
  reason?: string;
  timestamp: number;
}

/**
 * Minority opinion record
 */
export interface MinorityOpinion {
  actorId: string;
  decisionId: string;
  position: 'for' | 'against';
  reason: string;
  evidence?: string[];
  timestamp: number;
}

/**
 * Group decision with voting details
 */
export interface GroupDecision extends DecisionTrace {
  roomId?: string; // Link to deliberation room
  votes: Vote[];
  minorityOpinions: MinorityOpinion[];
  consensusTime: number; // Milliseconds to reach consensus
  participantCount: number;
  quorumMet: boolean;
}

/**
 * Group dynamics analysis
 */
export interface GroupDynamics {
  roomId: string;
  participantIds: string[];
  decisionCount: number;
  averageConsensusTime: number;
  opinionChangeRate: number; // % of participants who changed opinion
  unanimousDecisions: number;
  splitDecisions: number;
  participationRate: number; // % who actively voted
  influencers: Array<{ actorId: string; influenceScore: number }>;
}

/**
 * Group effectiveness metrics
 */
export interface EffectivenessMetrics {
  groupId: string;
  actorIds: string[];
  decisionCount: number;
  averageConsensusTime: number;
  averageDecisionQuality: number; // 0-1 based on outcomes
  collaborationScore: number; // 0-1 based on interaction patterns
  diversityScore: number; // 0-1 based on opinion variance
  efficiencyScore: number; // 0-1 based on time and quality
  successRate: number; // % of decisions with positive outcomes
}

/**
 * Participation tracking
 */
export interface ParticipationMetrics {
  actorId: string;
  decisionsParticipated: number;
  votesFor: number;
  votesAgainst: number;
  abstentions: number;
  opinionChanges: number;
  averageConfidence: number;
  influenceScore: number;
}

/**
 * GroupDecisionMemory extends DecisionMemory with group dynamics tracking
 */
export class GroupDecisionMemory extends DecisionMemory {
  private voteCache: Map<string, Vote[]> = new Map();
  private opinionChangeCache: Map<string, OpinionChange[]> = new Map();

  constructor(
    actorId: string,
    storage: MemoryStorage,
    lamportClock: LamportClock,
    options?: DecisionMemoryOptions
  ) {
    super(actorId, storage, lamportClock, options);
  }

  /**
   * Record a group decision with votes
   */
  async recordGroupDecision(decision: GroupDecision): Promise<void> {
    const timestamp = Date.now();

    // Store base decision trace
    await this.addDecisionTrace(decision);

    // Store group-specific data
    const groupData = {
      decisionId: decision.decisionId,  // Include decisionId for retrieval
      roomId: decision.roomId,
      votes: decision.votes,
      minorityOpinions: decision.minorityOpinions,
      consensusTime: decision.consensusTime,
      participantCount: decision.participantCount,
      quorumMet: decision.quorumMet
    };

    await this.addFact(
      decision.decisionId,
      'has_group_data',
      decision.decisionId,
      JSON.stringify(groupData),
      {
        confidence: 1.0,
        source: 'auto_extracted'
      }
    );

    // Store individual votes
    for (const vote of decision.votes) {
      await this.addFact(
        decision.decisionId,
        'has_vote',
        vote.actorId,
        JSON.stringify(vote),
        {
          confidence: vote.confidence,
          source: 'user_input'
        }
      );
    }

    // Store minority opinions as separate facts
    if (decision.minorityOpinions && decision.minorityOpinions.length > 0) {
      for (const opinion of decision.minorityOpinions) {
        await this.addFact(
          decision.decisionId,
          'has_minority_opinion',
          opinion.actorId,
          JSON.stringify(opinion),
          {
            confidence: 1.0,
            source: 'user_input'
          }
        );
      }
    }

    this.voteCache.set(decision.decisionId, decision.votes);
  }

  /**
   * Track opinion change for an actor
   */
  async trackOpinionChange(
    decisionId: string,
    before: Vote,
    after: Vote,
    reason?: string
  ): Promise<void> {
    const timestamp = Date.now();

    const change: OpinionChange = {
      actorId: this.actorId,
      decisionId,
      before,
      after,
      reason,
      timestamp
    };

    await this.addFact(
      decisionId,
      'has_opinion_change',
      this.actorId,
      JSON.stringify(change),
      {
        confidence: 1.0,
        source: 'user_input'
      }
    );

    // Update cache
    if (!this.opinionChangeCache.has(decisionId)) {
      this.opinionChangeCache.set(decisionId, []);
    }
    this.opinionChangeCache.get(decisionId)!.push(change);
  }

  /**
   * Record a dissenting/minority opinion
   */
  async recordDissent(
    decisionId: string,
    position: 'for' | 'against',
    reason: string,
    evidence?: string[]
  ): Promise<void> {
    const timestamp = Date.now();

    const opinion: MinorityOpinion = {
      actorId: this.actorId,
      decisionId,
      position,
      reason,
      evidence,
      timestamp
    };

    await this.addFact(
      decisionId,
      'has_minority_opinion',
      this.actorId,
      JSON.stringify(opinion),
      {
        confidence: 1.0,
        source: 'user_input'
      }
    );
  }

  /**
   * Get all votes for a decision
   */
  async getVotes(decisionId: string): Promise<Vote[]> {
    // Check cache
    if (this.voteCache.has(decisionId)) {
      return this.voteCache.get(decisionId)!;
    }

    // Query storage
    const facts = await this.storage.searchFacts({
      actorId: this.actorId,
      subject: decisionId,
      relation: 'has_vote'
    } as any);

    const votes = facts.map(f => JSON.parse(f.text) as Vote);
    this.voteCache.set(decisionId, votes);
    return votes;
  }

  /**
   * Get opinion changes for a decision
   */
  async getOpinionChanges(decisionId: string): Promise<OpinionChange[]> {
    if (this.opinionChangeCache.has(decisionId)) {
      return this.opinionChangeCache.get(decisionId)!;
    }

    const facts = await this.storage.searchFacts({
      actorId: this.actorId,
      subject: decisionId,
      relation: 'has_opinion_change'
    } as any);

    const changes = facts.map(f => JSON.parse(f.text) as OpinionChange);
    this.opinionChangeCache.set(decisionId, changes);
    return changes;
  }

  /**
   * Get minority opinions for a decision
   */
  async getMinorityOpinions(decisionId: string): Promise<MinorityOpinion[]> {
    const facts = await this.storage.searchFacts({
      subject: decisionId,
      relation: 'has_minority_opinion'
    } as any);

    return facts.map(f => JSON.parse(f.text) as MinorityOpinion);
  }

  /**
   * Get full group decision data
   */
  async getGroupDecision(decisionId: string): Promise<GroupDecision | null> {
    // Get base decision
    const facts = await this.storage.searchFacts({
      actorId: this.actorId,
      subject: decisionId,
      relation: 'has_group_data',
      limit: 1
    } as any);

    if (facts.length === 0) {
      return null;
    }

    const groupData = JSON.parse(facts[0].text);

    // Get base decision trace (would need to fetch from base decision storage)
    // For now, return minimal structure
    return {
      ...groupData,
      decisionId,
      votes: await this.getVotes(decisionId),
      minorityOpinions: await this.getMinorityOpinions(decisionId)
    } as GroupDecision;
  }

  /**
   * Analyze group dynamics for a room
   */
  async getGroupDynamics(roomId: string): Promise<GroupDynamics> {
    // Get all decisions for this room
    const roomFacts = await this.storage.searchFacts({
      actorId: this.actorId,
      relation: 'has_group_data'
    } as any);

    const roomDecisions = roomFacts
      .map(f => JSON.parse(f.text))
      .filter(data => data.roomId === roomId);

    if (roomDecisions.length === 0) {
      throw new Error(`No decisions found for room ${roomId}`);
    }

    // Collect all participant IDs
    const participantSet = new Set<string>();
    let totalConsensusTime = 0;
    let totalOpinionChanges = 0;
    let unanimousCount = 0;
    let splitCount = 0;
    let totalVotes = 0;
    let actualVotes = 0;

    for (const decision of roomDecisions) {
      const votes = await this.getVotes(decision.decisionId);
      const changes = await this.getOpinionChanges(decision.decisionId);

      votes.forEach(v => participantSet.add(v.actorId));
      totalConsensusTime += decision.consensusTime || 0;
      totalOpinionChanges += changes.length;

      // Check unanimity
      const forVotes = votes.filter(v => v.position === 'for').length;
      const againstVotes = votes.filter(v => v.position === 'against').length;
      
      if (forVotes === votes.length || againstVotes === votes.length) {
        unanimousCount++;
      } else if (Math.abs(forVotes - againstVotes) <= 1) {
        splitCount++;
      }

      totalVotes += decision.participantCount;
      actualVotes += votes.length;
    }

    const participantIds = Array.from(participantSet);
    const decisionCount = roomDecisions.length;

    // Calculate influence scores
    const influencers = await this.calculateInfluencers(participantIds, roomId);

    return {
      roomId,
      participantIds,
      decisionCount,
      averageConsensusTime: totalConsensusTime / decisionCount,
      opinionChangeRate: totalOpinionChanges / (decisionCount * participantIds.length),
      unanimousDecisions: unanimousCount,
      splitDecisions: splitCount,
      participationRate: actualVotes / totalVotes,
      influencers
    };
  }

  /**
   * Analyze group effectiveness
   */
  async analyzeGroupEffectiveness(actorIds: string[]): Promise<EffectivenessMetrics> {
    const groupId = actorIds.sort().join(',');

    // Find all decisions with these participants
    const allFacts = await this.storage.searchFacts({
      actorId: this.actorId,
      relation: 'has_vote'
    } as any);

    const relevantDecisions = new Set<string>();
    for (const fact of allFacts) {
      const vote = JSON.parse(fact.text) as Vote;
      if (actorIds.includes(vote.actorId)) {
        relevantDecisions.add(fact.sourceEntityId);
      }
    }

    if (relevantDecisions.size === 0) {
      return {
        groupId,
        actorIds,
        decisionCount: 0,
        averageConsensusTime: 0,
        averageDecisionQuality: 0,
        collaborationScore: 0,
        diversityScore: 0,
        efficiencyScore: 0,
        successRate: 0
      };
    }

    let totalConsensusTime = 0;
    let totalQuality = 0;
    let successfulDecisions = 0;
    let totalOpinionVariance = 0;

    for (const decisionId of relevantDecisions) {
      const groupData = await this.getGroupDecision(decisionId);
      if (!groupData) continue;

      totalConsensusTime += groupData.consensusTime;

      // Calculate quality based on votes
      const votes = await this.getVotes(decisionId);
      const avgConfidence = votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length;
      totalQuality += avgConfidence;

      // Calculate opinion variance (diversity)
      const forVotes = votes.filter(v => v.position === 'for').length;
      const againstVotes = votes.filter(v => v.position === 'against').length;
      const variance = Math.abs(forVotes - againstVotes) / votes.length;
      totalOpinionVariance += variance;

      // Check if decision was successful (would need outcome tracking)
      // For now, assume decisions with high confidence are successful
      if (avgConfidence > 0.7) {
        successfulDecisions++;
      }
    }

    const decisionCount = relevantDecisions.size;
    const avgConsensusTime = totalConsensusTime / decisionCount;
    const avgQuality = totalQuality / decisionCount;
    const diversityScore = totalOpinionVariance / decisionCount;

    // Calculate collaboration score (based on opinion changes)
    let totalChanges = 0;
    for (const decisionId of relevantDecisions) {
      const changes = await this.getOpinionChanges(decisionId);
      totalChanges += changes.length;
    }
    const collaborationScore = Math.min(totalChanges / decisionCount / actorIds.length, 1.0);

    // Calculate efficiency (quality / time normalized)
    const normalizedTime = Math.min(avgConsensusTime / 3600000, 1.0); // Normalize to 1 hour
    const efficiencyScore = avgQuality * (1 - normalizedTime);

    return {
      groupId,
      actorIds,
      decisionCount,
      averageConsensusTime: avgConsensusTime,
      averageDecisionQuality: avgQuality,
      collaborationScore,
      diversityScore,
      efficiencyScore,
      successRate: successfulDecisions / decisionCount
    };
  }

  /**
   * Get participation metrics for an actor
   */
  async getParticipationMetrics(actorId: string): Promise<ParticipationMetrics> {
    const voteFacts = await this.storage.searchFacts({
      actorId: this.actorId,
      relation: 'has_vote',
      object: actorId
    } as any);

    const votes = voteFacts.map(f => JSON.parse(f.text) as Vote);

    const forVotes = votes.filter(v => v.position === 'for').length;
    const againstVotes = votes.filter(v => v.position === 'against').length;
    const abstentions = votes.filter(v => v.position === 'abstain').length;

    const avgConfidence = votes.length > 0
      ? votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length
      : 0;

    // Count opinion changes
    const changeFacts = await this.storage.searchFacts({
      actorId: this.actorId,
      relation: 'has_opinion_change',
      object: actorId
    } as any);

    // Calculate influence score (simplified)
    const influenceScore = await this.calculateActorInfluence(actorId);

    return {
      actorId,
      decisionsParticipated: votes.length,
      votesFor: forVotes,
      votesAgainst: againstVotes,
      abstentions,
      opinionChanges: changeFacts.length,
      averageConfidence: avgConfidence,
      influenceScore
    };
  }

  /**
   * Find similar group decisions
   */
  async findSimilarGroupDecisions(
    decisionId: string,
    options?: { limit?: number; minSimilarity?: number }
  ): Promise<Array<{ decision: GroupDecision; similarity: number }>> {
    const decision = await this.getGroupDecision(decisionId);
    if (!decision) {
      throw new Error(`Decision ${decisionId} not found`);
    }

    // Get all group decisions
    const allFacts = await this.storage.searchFacts({
      actorId: this.actorId,
      relation: 'has_group_data'
    } as any);

    const similarities: Array<{ decision: GroupDecision; similarity: number }> = [];

    for (const fact of allFacts) {
      const otherData = JSON.parse(fact.text);
      if (otherData.decisionId === decisionId) continue;

      const otherDecision = await this.getGroupDecision(otherData.decisionId);
      if (!otherDecision) continue;

      // Calculate similarity based on participant overlap, vote patterns, etc.
      const similarity = this.calculateDecisionSimilarity(decision, otherDecision);

      if (similarity >= (options?.minSimilarity || 0.5)) {
        similarities.push({ decision: otherDecision, similarity });
      }
    }

    // Sort by similarity and limit
    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, options?.limit || 10);
  }

  /**
   * Calculate similarity between two group decisions
   */
  private calculateDecisionSimilarity(d1: GroupDecision, d2: GroupDecision): number {
    // Participant overlap
    const p1Set = new Set(d1.votes.map(v => v.actorId));
    const p2Set = new Set(d2.votes.map(v => v.actorId));
    const intersection = new Set([...p1Set].filter(x => p2Set.has(x)));
    const union = new Set([...p1Set, ...p2Set]);
    const participantSimilarity = intersection.size / union.size;

    // Vote distribution similarity
    const d1For = d1.votes.filter(v => v.position === 'for').length / d1.votes.length;
    const d2For = d2.votes.filter(v => v.position === 'for').length / d2.votes.length;
    const voteSimilarity = 1 - Math.abs(d1For - d2For);

    // Consensus time similarity
    const timeRatio = Math.min(d1.consensusTime, d2.consensusTime) / 
                      Math.max(d1.consensusTime, d2.consensusTime);

    // Weighted average
    return (participantSimilarity * 0.4) + (voteSimilarity * 0.4) + (timeRatio * 0.2);
  }

  /**
   * Calculate influence score for an actor
   */
  private async calculateActorInfluence(actorId: string): Promise<number> {
    const voteFacts = await this.storage.searchFacts({
      actorId: this.actorId,
      relation: 'has_vote',
      object: actorId
    } as any);

    if (voteFacts.length === 0) return 0;

    // Count how many times this actor's vote aligned with final decision
    let alignments = 0;
    const decisions = new Set(voteFacts.map(f => f.sourceEntityId));

    for (const decisionId of decisions) {
      const votes = await this.getVotes(decisionId);
      const actorVote = votes.find(v => v.actorId === actorId);
      if (!actorVote) continue;

      // Determine majority position
      const forVotes = votes.filter(v => v.position === 'for').length;
      const againstVotes = votes.filter(v => v.position === 'against').length;
      const majority = forVotes > againstVotes ? 'for' : 'against';

      if (actorVote.position === majority) {
        alignments++;
      }
    }

    // Influence is alignment rate weighted by confidence
    const votes = voteFacts.map(f => JSON.parse(f.text) as Vote);
    const avgConfidence = votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length;
    
    return (alignments / decisions.size) * avgConfidence;
  }

  /**
   * Calculate influencers for a room
   */
  private async calculateInfluencers(
    participantIds: string[],
    roomId: string
  ): Promise<Array<{ actorId: string; influenceScore: number }>> {
    const influencers: Array<{ actorId: string; influenceScore: number }> = [];

    for (const actorId of participantIds) {
      const score = await this.calculateActorInfluence(actorId);
      influencers.push({ actorId, influenceScore: score });
    }

    influencers.sort((a, b) => b.influenceScore - a.influenceScore);
    return influencers.slice(0, 5); // Top 5 influencers
  }
}
