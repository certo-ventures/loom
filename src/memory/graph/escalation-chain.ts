/**
 * EscalationChain - Route decisions through organizational hierarchies
 * 
 * Part of Phase 7A Week 3: Group Decision & Collaboration System
 * 
 * Features:
 * - Define escalation paths by authority level
 * - Automatic escalation triggers (amount, risk, complexity)
 * - Timeout handling
 * - Override permissions
 * - Appeal mechanisms
 */

import { ActorMemory } from './actor-memory';
import { MemoryStorage } from './types';
import { LamportClock } from '../../timing/lamport-clock';

/**
 * Escalation trigger type
 */
export type EscalationTrigger = 'amount' | 'risk' | 'complexity' | 'timeout' | 'appeal' | 'manual';

/**
 * Decision status in escalation chain
 */
export type EscalationStatus = 'pending' | 'approved' | 'rejected' | 'escalated' | 'overridden' | 'expired';

/**
 * A level in the escalation chain
 */
export interface EscalationLevel {
  level: number;
  actorId: string; // Single actor or committee ID
  title: string; // e.g., "Loan Officer", "Manager", "Board"
  maxAmount?: number; // Authority limit for financial decisions
  maxRiskScore?: number; // Authority limit for risk decisions
  timeoutMs?: number; // Time allowed before auto-escalation
  canOverride: boolean; // Can override lower-level decisions
  requiresEvidence: boolean; // Must provide evidence for decision
}

/**
 * Configuration for creating an escalation chain
 */
export interface ChainConfig {
  name: string;
  description: string;
  levels: Omit<EscalationLevel, 'level'>[];
  metadata?: Record<string, any>;
}

/**
 * An escalation chain definition
 */
export interface EscalationChainDefinition {
  id: string;
  name: string;
  description: string;
  levels: EscalationLevel[];
  createdBy: string;
  createdAt: number;
  active: boolean;
  metadata?: Record<string, any>;
}

/**
 * A decision in the escalation process
 */
export interface EscalationDecision {
  id: string;
  chainId: string;
  currentLevel: number;
  status: EscalationStatus;
  decisionData: any; // The actual decision being made
  amount?: number; // For financial decisions
  riskScore?: number; // For risk-based decisions
  complexityScore?: number; // For complexity-based decisions
  submittedBy: string;
  submittedAt: number;
  history: EscalationHistoryEntry[];
  metadata?: Record<string, any>;
}

/**
 * History entry for escalation decision
 */
export interface EscalationHistoryEntry {
  level: number;
  actorId: string;
  action: 'approved' | 'rejected' | 'escalated' | 'overridden' | 'appealed' | 'timeout';
  reason?: string;
  evidence?: string[];
  timestamp: number;
}

/**
 * Request to submit a decision for escalation
 */
export interface EscalationRequest {
  chainId: string;
  decisionData: any;
  amount?: number;
  riskScore?: number;
  complexityScore?: number;
  metadata?: Record<string, any>;
}

/**
 * Appeal request
 */
export interface AppealRequest {
  decisionId: string;
  reason: string;
  targetLevel?: number; // Optional: skip to specific level
  evidence?: string[];
}

/**
 * Override request
 */
export interface OverrideRequest {
  decisionId: string;
  reason: string;
  evidence?: string[];
}

/**
 * EscalationChain manages decision routing through organizational hierarchies
 */
export class EscalationChain extends ActorMemory {
  private chainCache: Map<string, EscalationChainDefinition> = new Map();
  private decisionCache: Map<string, EscalationDecision> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    actorId: string,
    storage: MemoryStorage,
    lamportClock: LamportClock
  ) {
    super(actorId, storage, lamportClock);
  }

  /**
   * Define a new escalation chain
   */
  async defineChain(config: ChainConfig): Promise<string> {
    const chainId = `chain_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();

    // Assign level numbers
    const levels: EscalationLevel[] = config.levels.map((level, index) => ({
      ...level,
      level: index + 1
    }));

    const chain: EscalationChainDefinition = {
      id: chainId,
      name: config.name,
      description: config.description,
      levels,
      createdBy: this.actorId,
      createdAt: timestamp,
      active: true,
      metadata: config.metadata
    };

    // Store as entity + fact
    // Entity created via inherited addEntity

    await this.addFact(
      chainId,
      'has_chain_data',
      chainId,
      JSON.stringify(chain),
      {
        confidence: 1.0,
        source: 'auto_extracted'
      }
    );

    this.chainCache.set(chainId, chain);
    return chainId;
  }

  /**
   * Submit a decision for escalation
   */
  async submitDecision(request: EscalationRequest): Promise<string> {
    const chain = await this.getChain(request.chainId);
    if (!chain) {
      throw new Error(`Chain ${request.chainId} not found`);
    }

    if (!chain.active) {
      throw new Error(`Chain ${request.chainId} is not active`);
    }

    // Determine starting level based on decision parameters
    const startLevel = this.determineStartLevel(chain, request);

    const decisionId = `esc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();

    const decision: EscalationDecision = {
      id: decisionId,
      chainId: request.chainId,
      currentLevel: startLevel,
      status: 'pending',
      decisionData: request.decisionData,
      amount: request.amount,
      riskScore: request.riskScore,
      complexityScore: request.complexityScore,
      submittedBy: this.actorId,
      submittedAt: timestamp,
      history: [],
      metadata: request.metadata
    };

    await this.saveDecision(decision);

    // Set timeout if configured
    const level = chain.levels.find(l => l.level === startLevel);
    if (level?.timeoutMs) {
      this.scheduleTimeout(decisionId, level.timeoutMs);
    }

    return decisionId;
  }

  /**
   * Approve a decision at current level
   */
  async approve(
    decisionId: string,
    options?: { reason?: string; evidence?: string[] }
  ): Promise<void> {
    const decision = await this.getDecision(decisionId);
    if (!decision) {
      throw new Error(`Decision ${decisionId} not found`);
    }

    if (decision.status !== 'pending') {
      throw new Error(`Decision ${decisionId} is not pending`);
    }

    const chain = await this.getChain(decision.chainId);
    if (!chain) {
      throw new Error(`Chain ${decision.chainId} not found`);
    }

    const level = chain.levels.find(l => l.level === decision.currentLevel);
    if (!level) {
      throw new Error(`Level ${decision.currentLevel} not found`);
    }

    // Verify actor has authority
    if (level.actorId !== this.actorId) {
      throw new Error(`Actor ${this.actorId} does not have authority at level ${decision.currentLevel}`);
    }

    // Verify evidence if required
    if (level.requiresEvidence && (!options?.evidence || options.evidence.length === 0)) {
      throw new Error(`Evidence is required at level ${decision.currentLevel}`);
    }

    const timestamp = Date.now();

    decision.history.push({
      level: decision.currentLevel,
      actorId: this.actorId,
      action: 'approved',
      reason: options?.reason,
      evidence: options?.evidence,
      timestamp
    });

    decision.status = 'approved';
    this.clearTimeout(decisionId);

    await this.saveDecision(decision);
  }

  /**
   * Reject a decision at current level
   */
  async reject(
    decisionId: string,
    reason: string,
    evidence?: string[]
  ): Promise<void> {
    const decision = await this.getDecision(decisionId);
    if (!decision) {
      throw new Error(`Decision ${decisionId} not found`);
    }

    if (decision.status !== 'pending') {
      throw new Error(`Decision ${decisionId} is not pending`);
    }

    const chain = await this.getChain(decision.chainId);
    if (!chain) {
      throw new Error(`Chain ${decision.chainId} not found`);
    }

    const level = chain.levels.find(l => l.level === decision.currentLevel);
    if (!level) {
      throw new Error(`Level ${decision.currentLevel} not found`);
    }

    if (level.actorId !== this.actorId) {
      throw new Error(`Actor ${this.actorId} does not have authority at level ${decision.currentLevel}`);
    }

    const timestamp = Date.now();

    decision.history.push({
      level: decision.currentLevel,
      actorId: this.actorId,
      action: 'rejected',
      reason,
      evidence,
      timestamp
    });

    decision.status = 'rejected';
    this.clearTimeout(decisionId);

    await this.saveDecision(decision);
  }

  /**
   * Escalate a decision to next level
   */
  async escalate(
    decisionId: string,
    reason: string
  ): Promise<void> {
    const decision = await this.getDecision(decisionId);
    if (!decision) {
      throw new Error(`Decision ${decisionId} not found`);
    }

    if (decision.status !== 'pending') {
      throw new Error(`Decision ${decisionId} is not pending`);
    }

    const chain = await this.getChain(decision.chainId);
    if (!chain) {
      throw new Error(`Chain ${decision.chainId} not found`);
    }

    // Check if there's a next level
    const nextLevel = decision.currentLevel + 1;
    if (nextLevel > chain.levels.length) {
      throw new Error('No higher level available for escalation');
    }

    const timestamp = Date.now();

    decision.history.push({
      level: decision.currentLevel,
      actorId: this.actorId,
      action: 'escalated',
      reason,
      timestamp
    });

    decision.currentLevel = nextLevel;
    decision.status = 'pending';
    this.clearTimeout(decisionId);

    await this.saveDecision(decision);

    // Set timeout for new level
    const level = chain.levels.find(l => l.level === nextLevel);
    if (level?.timeoutMs) {
      this.scheduleTimeout(decisionId, level.timeoutMs);
    }
  }

  /**
   * Override a decision from higher authority
   */
  async override(request: OverrideRequest): Promise<void> {
    const decision = await this.getDecision(request.decisionId);
    if (!decision) {
      throw new Error(`Decision ${request.decisionId} not found`);
    }

    const chain = await this.getChain(decision.chainId);
    if (!chain) {
      throw new Error(`Chain ${decision.chainId} not found`);
    }

    // Find actor's level in chain
    const actorLevel = chain.levels.find(l => l.actorId === this.actorId);
    if (!actorLevel) {
      throw new Error(`Actor ${this.actorId} is not in chain ${decision.chainId}`);
    }

    if (!actorLevel.canOverride) {
      throw new Error(`Actor ${this.actorId} does not have override permission`);
    }

    // Must be higher level to override
    if (actorLevel.level <= decision.currentLevel) {
      throw new Error('Can only override from higher authority level');
    }

    const timestamp = Date.now();

    decision.history.push({
      level: actorLevel.level,
      actorId: this.actorId,
      action: 'overridden',
      reason: request.reason,
      evidence: request.evidence,
      timestamp
    });

    decision.status = 'overridden';
    decision.currentLevel = actorLevel.level;
    this.clearTimeout(request.decisionId);

    await this.saveDecision(decision);
  }

  /**
   * Appeal a rejected decision
   */
  async appeal(request: AppealRequest): Promise<void> {
    const decision = await this.getDecision(request.decisionId);
    if (!decision) {
      throw new Error(`Decision ${request.decisionId} not found`);
    }

    if (decision.status !== 'rejected') {
      throw new Error('Can only appeal rejected decisions');
    }

    const chain = await this.getChain(decision.chainId);
    if (!chain) {
      throw new Error(`Chain ${decision.chainId} not found`);
    }

    // Determine target level
    let targetLevel: number;
    if (request.targetLevel) {
      if (request.targetLevel <= decision.currentLevel) {
        throw new Error('Appeal target level must be higher than current level');
      }
      if (request.targetLevel > chain.levels.length) {
        throw new Error('Appeal target level does not exist');
      }
      targetLevel = request.targetLevel;
    } else {
      targetLevel = Math.min(decision.currentLevel + 1, chain.levels.length);
    }

    const timestamp = Date.now();

    decision.history.push({
      level: decision.currentLevel,
      actorId: this.actorId,
      action: 'appealed',
      reason: request.reason,
      evidence: request.evidence,
      timestamp
    });

    decision.currentLevel = targetLevel;
    decision.status = 'pending';

    await this.saveDecision(decision);

    // Set timeout for new level
    const level = chain.levels.find(l => l.level === targetLevel);
    if (level?.timeoutMs) {
      this.scheduleTimeout(request.decisionId, level.timeoutMs);
    }
  }

  /**
   * Get a decision
   */
  async getDecision(decisionId: string): Promise<EscalationDecision | null> {
    // Always fetch from storage to get latest version across actors
    const facts = await this.storage.searchFacts({
      object: decisionId,
      relation: 'has_decision_data'
    } as any);

    if (facts.length === 0) {
      return null;
    }

    // Get the most recent fact (highest lamport timestamp for ordering)
    const latestFact = facts.reduce((latest, current) => 
      current.lamport_ts > latest.lamport_ts ? current : latest
    );

    const decision = JSON.parse(latestFact.text) as EscalationDecision;
    this.decisionCache.set(decisionId, decision);
    return decision;
  }

  /**
   * Get a chain
   */
  async getChain(chainId: string): Promise<EscalationChainDefinition | null> {
    if (this.chainCache.has(chainId)) {
      return this.chainCache.get(chainId)!;
    }

    const facts = await this.storage.searchFacts({
      subject: chainId,
      relation: 'has_chain_data',
      limit: 1
    } as any);

    if (facts.length === 0) {
      return null;
    }

    const chain = JSON.parse(facts[0].text) as EscalationChainDefinition;
    this.chainCache.set(chainId, chain);
    return chain;
  }

  /**
   * Get all pending decisions for an actor
   */
  async getPendingDecisions(actorId: string): Promise<EscalationDecision[]> {
    const facts = await this.storage.searchFacts({
      relation: 'has_decision_data'
    } as any);

    // Group by decision ID and get latest version
    const decisionMap = new Map<string, { fact: any; decision: EscalationDecision }>();
    for (const fact of facts) {
      const decision = JSON.parse(fact.text) as EscalationDecision;
      const existing = decisionMap.get(decision.id);
      if (!existing || fact.lamport_ts > existing.fact.lamport_ts) {
        decisionMap.set(decision.id, { fact, decision });
      }
    }

    const decisions = Array.from(decisionMap.values()).map(v => v.decision);
    
    const pending: EscalationDecision[] = [];
    for (const decision of decisions) {
      if (decision.status !== 'pending') continue;

      const chain = await this.getChain(decision.chainId);
      if (!chain) continue;

      const level = chain.levels.find(l => l.level === decision.currentLevel);
      if (level && level.actorId === actorId) {
        pending.push(decision);
      }
    }

    return pending;
  }

  /**
   * Get decision history
   */
  async getDecisionHistory(decisionId: string): Promise<EscalationHistoryEntry[]> {
    const decision = await this.getDecision(decisionId);
    return decision?.history || [];
  }

  /**
   * Deactivate a chain
   */
  async deactivateChain(chainId: string): Promise<void> {
    const chain = await this.getChain(chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} not found`);
    }

    chain.active = false;
    const timestamp = Date.now();

    await this.addFact(
      chainId,
      'has_chain_data',
      chainId,
      JSON.stringify(chain),
      {
        confidence: 1.0,
        source: 'auto_extracted'
      }
    );

    this.chainCache.set(chainId, chain);
  }

  /**
   * Determine starting level based on decision parameters
   */
  private determineStartLevel(
    chain: EscalationChainDefinition,
    request: EscalationRequest
  ): number {
    // Start from lowest level and find first level that can handle the decision
    for (const level of chain.levels) {
      let canHandle = true;

      if (request.amount !== undefined && level.maxAmount !== undefined) {
        if (request.amount > level.maxAmount) {
          canHandle = false;
        }
      }

      if (request.riskScore !== undefined && level.maxRiskScore !== undefined) {
        if (request.riskScore > level.maxRiskScore) {
          canHandle = false;
        }
      }

      if (canHandle) {
        return level.level;
      }
    }

    // If no level can handle it, start at highest level
    return chain.levels.length;
  }

  /**
   * Save decision to storage
   */
  private async saveDecision(decision: EscalationDecision): Promise<void> {
    const timestamp = Date.now();

    await this.addFact(
      decision.chainId,
      'has_decision_data',
      decision.id,
      JSON.stringify(decision),
      {
        confidence: 1.0,
        source: 'user_input'
      }
    );

    this.decisionCache.set(decision.id, decision);
  }

  /**
   * Schedule timeout for decision
   */
  private scheduleTimeout(decisionId: string, timeoutMs: number): void {
    const timeout = setTimeout(async () => {
      await this.handleTimeout(decisionId);
    }, timeoutMs);

    this.timeouts.set(decisionId, timeout);
  }

  /**
   * Clear timeout for decision
   */
  private clearTimeout(decisionId: string): void {
    const timeout = this.timeouts.get(decisionId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(decisionId);
    }
  }

  /**
   * Handle decision timeout
   */
  private async handleTimeout(decisionId: string): Promise<void> {
    const decision = await this.getDecision(decisionId);
    if (!decision || decision.status !== 'pending') {
      return;
    }

    const chain = await this.getChain(decision.chainId);
    if (!chain) {
      return;
    }

    const timestamp = Date.now();

    decision.history.push({
      level: decision.currentLevel,
      actorId: 'system',
      action: 'timeout',
      reason: 'Decision timeout - auto-escalating',
      timestamp
    });

    // Try to escalate to next level
    if (decision.currentLevel < chain.levels.length) {
      decision.currentLevel++;
      decision.status = 'pending';

      const nextLevel = chain.levels.find(l => l.level === decision.currentLevel);
      if (nextLevel?.timeoutMs) {
        this.scheduleTimeout(decisionId, nextLevel.timeoutMs);
      }
    } else {
      // No higher level - mark as expired
      decision.status = 'expired';
    }

    await this.saveDecision(decision);
  }

  /**
   * Cleanup - clear all timeouts
   */
  cleanup(): void {
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
  }
}
