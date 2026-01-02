/**
 * ArgumentGraph - Track arguments, counter-arguments, and evidence in structured format
 * 
 * Part of Phase 7A Week 3: Group Decision & Collaboration System
 * 
 * Features:
 * - Argument chains (supports/opposes relationships)
 * - Evidence linking with reliability scoring
 * - Credibility scoring for arguments
 * - Consensus convergence tracking
 * - Dissent recording
 */

import { ActorMemory } from './actor-memory';
import { MemoryStorage } from './types';
import { LamportClock } from '../../timing/lamport-clock';

/**
 * Types of evidence that can support arguments
 */
export type EvidenceType = 'data' | 'precedent' | 'policy' | 'expert_opinion' | 'external_source';

/**
 * Argument position relative to the topic
 */
export type ArgumentPosition = 'for' | 'against' | 'neutral';

/**
 * Evidence attached to an argument
 */
export interface Evidence {
  id: string;
  type: EvidenceType;
  content: string;
  source: string;
  reliability: number; // 0-1 scale
  attachedBy: string; // actorId
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * A structured argument in the graph
 */
export interface Argument {
  id: string;
  authorId: string;
  topicId: string; // Links to deliberation room or decision
  position: ArgumentPosition;
  content: string;
  evidence: Evidence[];
  supportsArgumentId?: string; // Supporting another argument
  opposesArgumentId?: string; // Counter-arguing another argument
  credibilityScore: number; // 0-1 scale
  timestamp: number;
  updatedAt?: number;
  metadata?: Record<string, any>;
}

/**
 * Topic for argument discussion
 */
export interface ArgumentTopic {
  id: string;
  title: string;
  description: string;
  createdBy: string;
  createdAt: number;
  status: 'open' | 'closed' | 'archived';
  metadata?: Record<string, any>;
}

/**
 * Configuration for topic creation
 */
export interface TopicConfig {
  title: string;
  description: string;
  metadata?: Record<string, any>;
}

/**
 * Analysis of argument quality
 */
export interface ArgumentQuality {
  argumentId: string;
  evidenceCount: number;
  averageReliability: number;
  hasCounterArguments: boolean;
  supportingArgumentCount: number;
  opposingArgumentCount: number;
  credibilityScore: number;
}

/**
 * Consensus analysis for a topic
 */
export interface ConsensusAnalysis {
  topicId: string;
  totalArguments: number;
  forArguments: number;
  againstArguments: number;
  neutralArguments: number;
  averageCredibility: number;
  convergenceScore: number; // 0-1, higher = more consensus
  hasUnresolvedConflicts: boolean;
  dominantPosition: ArgumentPosition | 'none';
}

/**
 * Dissenting opinion record
 */
export interface DissentRecord {
  id: string;
  topicId: string;
  actorId: string;
  argumentId: string;
  reason: string;
  timestamp: number;
  resolved: boolean;
  resolvedAt?: number;
}

/**
 * ArgumentGraph manages structured argumentation for group decisions
 */
export class ArgumentGraph extends ActorMemory {
  private topicCache: Map<string, ArgumentTopic> = new Map();
  private argumentCache: Map<string, Argument> = new Map();

  constructor(
    actorId: string,
    storage: MemoryStorage,
    lamportClock: LamportClock
  ) {
    super(actorId, storage, lamportClock);
  }

  /**
   * Create a new argument topic
   */
  async createTopic(config: TopicConfig): Promise<string> {
    const topicId = `topic_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();

    const topic: ArgumentTopic = {
      id: topicId,
      title: config.title,
      description: config.description,
      createdBy: this.actorId,
      createdAt: timestamp,
      status: 'open',
      metadata: config.metadata
    };

    // Store as entity + fact
    // Entity created via inherited addEntity

    await this.addFact(
      topicId,
      'has_topic_data',
      topicId,
      JSON.stringify(topic),
      {
        confidence: 1.0,
        source: 'auto_extracted'
      }
    );

    this.topicCache.set(topicId, topic);
    return topicId;
  }

  /**
   * Submit an argument to a topic
   */
  async submitArgument(
    topicId: string,
    position: ArgumentPosition,
    content: string,
    options?: {
      supportsArgumentId?: string;
      opposesArgumentId?: string;
      evidence?: Omit<Evidence, 'id' | 'attachedBy' | 'timestamp'>[];
      metadata?: Record<string, any>;
    }
  ): Promise<string> {
    const argumentId = `arg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();

    // Convert evidence
    const evidence: Evidence[] = (options?.evidence || []).map(ev => ({
      ...ev,
      id: `ev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      attachedBy: this.actorId,
      timestamp
    }));

    // Calculate initial credibility based on evidence
    const credibilityScore = this.calculateCredibility(evidence);

    const argument: Argument = {
      id: argumentId,
      authorId: this.actorId,
      topicId,
      position,
      content,
      evidence,
      supportsArgumentId: options?.supportsArgumentId,
      opposesArgumentId: options?.opposesArgumentId,
      credibilityScore,
      timestamp,
      metadata: options?.metadata
    };

    // Store as entity + fact
    // Entity created via inherited addEntity

    await this.addFact(
      topicId,
      'has_argument',
      argumentId,
      JSON.stringify(argument),
      {
        confidence: credibilityScore,
        source: 'user_input'
      }
    );

    this.argumentCache.set(argumentId, argument);
    return argumentId;
  }

  /**
   * Attach evidence to an existing argument
   */
  async attachEvidence(
    argumentId: string,
    evidence: Omit<Evidence, 'id' | 'attachedBy' | 'timestamp'>
  ): Promise<string> {
    const argument = await this.getArgument(argumentId);
    if (!argument) {
      throw new Error(`Argument ${argumentId} not found`);
    }

    const timestamp = Date.now();
    const evidenceId = `ev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const newEvidence: Evidence = {
      ...evidence,
      id: evidenceId,
      attachedBy: this.actorId,
      timestamp
    };

    argument.evidence.push(newEvidence);
    argument.updatedAt = timestamp;
    argument.credibilityScore = this.calculateCredibility(argument.evidence);

    // Update storage
    await this.addFact(
      argument.topicId,
      'has_argument',
      argumentId,
      JSON.stringify(argument),
      {
        confidence: argument.credibilityScore,
        source: 'user_input'
      }
    );

    this.argumentCache.set(argumentId, argument);
    return evidenceId;
  }

  /**
   * Get a specific argument
   */
  async getArgument(argumentId: string): Promise<Argument | null> {
    // Check cache first
    if (this.argumentCache.has(argumentId)) {
      return this.argumentCache.get(argumentId)!;
    }

    // Query storage
    const facts = await this.storage.searchFacts({
      actorId: this.actorId,
      object: argumentId,
      relation: 'has_argument',
      limit: 1
    } as any);

    if (facts.length === 0) {
      return null;
    }

    const argument = JSON.parse(facts[0].text) as Argument;
    this.argumentCache.set(argumentId, argument);
    return argument;
  }

  /**
   * Get all arguments for a topic
   */
  async getTopicArguments(topicId: string): Promise<Argument[]> {
    const facts = await this.storage.searchFacts({
      actorId: this.actorId,
      subject: topicId,
      relation: 'has_argument'
    } as any);

    const args = facts.map(f => JSON.parse(f.text) as Argument);
    
    // Update cache
    args.forEach(arg => this.argumentCache.set(arg.id, arg));

    return args;
  }

  /**
   * Get arguments that support a specific argument
   */
  async getSupportingArguments(argumentId: string): Promise<Argument[]> {
    const argument = await this.getArgument(argumentId);
    if (!argument) return [];

    const allArguments = await this.getTopicArguments(argument.topicId);
    return allArguments.filter(arg => arg.supportsArgumentId === argumentId);
  }

  /**
   * Get arguments that oppose a specific argument
   */
  async getOpposingArguments(argumentId: string): Promise<Argument[]> {
    const argument = await this.getArgument(argumentId);
    if (!argument) return [];

    const allArguments = await this.getTopicArguments(argument.topicId);
    return allArguments.filter(arg => arg.opposesArgumentId === argumentId);
  }

  /**
   * Analyze argument quality
   */
  async analyzeArgumentQuality(argumentId: string): Promise<ArgumentQuality> {
    const argument = await this.getArgument(argumentId);
    if (!argument) {
      throw new Error(`Argument ${argumentId} not found`);
    }

    const supporting = await this.getSupportingArguments(argumentId);
    const opposing = await this.getOpposingArguments(argumentId);

    const averageReliability = argument.evidence.length > 0
      ? argument.evidence.reduce((sum, ev) => sum + ev.reliability, 0) / argument.evidence.length
      : 0;

    return {
      argumentId,
      evidenceCount: argument.evidence.length,
      averageReliability,
      hasCounterArguments: opposing.length > 0,
      supportingArgumentCount: supporting.length,
      opposingArgumentCount: opposing.length,
      credibilityScore: argument.credibilityScore
    };
  }

  /**
   * Analyze consensus for a topic
   */
  async analyzeConsensus(topicId: string): Promise<ConsensusAnalysis> {
    const args = await this.getTopicArguments(topicId);

    if (args.length === 0) {
      return {
        topicId,
        totalArguments: 0,
        forArguments: 0,
        againstArguments: 0,
        neutralArguments: 0,
        averageCredibility: 0,
        convergenceScore: 0,
        hasUnresolvedConflicts: false,
        dominantPosition: 'none'
      };
    }

    const forArgs = args.filter(a => a.position === 'for');
    const againstArgs = args.filter(a => a.position === 'against');
    const neutralArgs = args.filter(a => a.position === 'neutral');

    const averageCredibility = args.reduce((sum, arg) => sum + arg.credibilityScore, 0) / args.length;

    // Calculate convergence: how aligned are the positions?
    const maxPosition = Math.max(forArgs.length, againstArgs.length, neutralArgs.length);
    const convergenceScore = maxPosition / args.length;

    // Check for unresolved conflicts (opposing arguments without supporting counter-arguments)
    let hasUnresolvedConflicts = false;
    for (const arg of args) {
      const opposing = await this.getOpposingArguments(arg.id);
      if (opposing.length > 0) {
        const supporting = await this.getSupportingArguments(arg.id);
        if (supporting.length === 0) {
          hasUnresolvedConflicts = true;
          break;
        }
      }
    }

    let dominantPosition: ArgumentPosition | 'none' = 'none';
    if (convergenceScore > 0.5) {
      if (forArgs.length === maxPosition) dominantPosition = 'for';
      else if (againstArgs.length === maxPosition) dominantPosition = 'against';
      else if (neutralArgs.length === maxPosition) dominantPosition = 'neutral';
    }

    return {
      topicId,
      totalArguments: args.length,
      forArguments: forArgs.length,
      againstArguments: againstArgs.length,
      neutralArguments: neutralArgs.length,
      averageCredibility,
      convergenceScore,
      hasUnresolvedConflicts,
      dominantPosition
    };
  }

  /**
   * Record a dissenting opinion
   */
  async recordDissent(
    topicId: string,
    argumentId: string,
    reason: string
  ): Promise<string> {
    const timestamp = Date.now();
    const dissentId = `dissent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const dissent: DissentRecord = {
      id: dissentId,
      topicId,
      actorId: this.actorId,
      argumentId,
      reason,
      timestamp,
      resolved: false
    };

    await this.addFact(
      topicId,
      'has_dissent',
      dissentId,
      JSON.stringify(dissent),
      {
        confidence: 1.0,
        source: 'user_input'
      }
    );

    return dissentId;
  }

  /**
   * Get all dissents for a topic
   */
  async getTopicDissents(topicId: string, includeResolved = false): Promise<DissentRecord[]> {
    const facts = await this.storage.searchFacts({
      actorId: this.actorId,
      subject: topicId,
      relation: 'has_dissent'
    } as any);

    // Group facts by dissent ID and get latest version of each
    const dissentMap = new Map<string, DissentRecord>();
    for (const fact of facts) {
      const dissent = JSON.parse(fact.text) as DissentRecord;
      const existing = dissentMap.get(dissent.id);
      // Keep the one with higher lamport_ts (latest version)
      if (!existing || fact.lamport_ts > (facts.find(f => JSON.parse(f.text).id === existing.id)?.lamport_ts || 0)) {
        dissentMap.set(dissent.id, dissent);
      }
    }

    const dissents = Array.from(dissentMap.values());

    if (!includeResolved) {
      return dissents.filter(d => !d.resolved);
    }

    return dissents;
  }

  /**
   * Resolve a dissent
   */
  async resolveDissent(dissentId: string): Promise<void> {
    const facts = await this.storage.searchFacts({
      actorId: this.actorId,
      object: dissentId,
      relation: 'has_dissent'
    } as any);

    if (facts.length === 0) {
      throw new Error(`Dissent ${dissentId} not found`);
    }

    // Get the most recent version
    const latestFact = facts.reduce((latest, current) => 
      current.lamport_ts > latest.lamport_ts ? current : latest
    );
    const dissent = JSON.parse(latestFact.text) as DissentRecord;
    dissent.resolved = true;
    dissent.resolvedAt = Date.now();

    await this.addFact(
      dissent.topicId,
      'has_dissent',
      dissentId,
      JSON.stringify(dissent),
      {
        confidence: 1.0,
        source: 'user_input'
      }
    );
  }

  /**
   * Get a topic
   */
  async getTopic(topicId: string): Promise<ArgumentTopic | null> {
    if (this.topicCache.has(topicId)) {
      return this.topicCache.get(topicId)!;
    }

    const facts = await this.storage.searchFacts({
      actorId: this.actorId,
      subject: topicId,
      relation: 'has_topic_data',
      limit: 1
    } as any);

    if (facts.length === 0) {
      return null;
    }

    const topic = JSON.parse(facts[0].text) as ArgumentTopic;
    this.topicCache.set(topicId, topic);
    return topic;
  }

  /**
   * Close a topic
   */
  async closeTopic(topicId: string): Promise<void> {
    const topic = await this.getTopic(topicId);
    if (!topic) {
      throw new Error(`Topic ${topicId} not found`);
    }

    topic.status = 'closed';
    const timestamp = Date.now();

    await this.addFact(
      topicId,
      'has_topic_data',
      topicId,
      JSON.stringify(topic),
      {
        confidence: 1.0,
        source: 'auto_extracted'
      }
    );

    this.topicCache.set(topicId, topic);
  }

  /**
   * Get argument chain (supporting and opposing arguments recursively)
   */
  async getArgumentChain(argumentId: string, depth = 3): Promise<{
    argument: Argument;
    supporting: Array<{ argument: Argument; children: any[] }>;
    opposing: Array<{ argument: Argument; children: any[] }>;
  }> {
    const argument = await this.getArgument(argumentId);
    if (!argument || depth === 0) {
      return { argument: argument!, supporting: [], opposing: [] };
    }

    const supporting = await this.getSupportingArguments(argumentId);
    const opposing = await this.getOpposingArguments(argumentId);

    const supportingChains = await Promise.all(
      supporting.map(async arg => {
        const chain = await this.getArgumentChain(arg.id, depth - 1);
        return { argument: arg, children: [chain] };
      })
    );

    const opposingChains = await Promise.all(
      opposing.map(async arg => {
        const chain = await this.getArgumentChain(arg.id, depth - 1);
        return { argument: arg, children: [chain] };
      })
    );

    return {
      argument,
      supporting: supportingChains,
      opposing: opposingChains
    };
  }

  /**
   * Calculate credibility score based on evidence
   */
  private calculateCredibility(evidence: Evidence[]): number {
    if (evidence.length === 0) return 0.3; // Base score without evidence

    const avgReliability = evidence.reduce((sum, ev) => sum + ev.reliability, 0) / evidence.length;
    
    // More evidence increases credibility, but with diminishing returns
    const evidenceBonus = Math.min(evidence.length * 0.1, 0.3);
    
    const score = (avgReliability * 0.7) + evidenceBonus;
    return Math.min(score, 1.0);
  }
}
