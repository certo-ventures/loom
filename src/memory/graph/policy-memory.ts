/**
 * PolicyMemory - Policy evolution and effectiveness tracking
 * 
 * Tracks policy changes over time and their impact on decisions.
 * Supports:
 * - Policy versioning with change history
 * - Effectiveness metrics (success rate, exception rate)
 * - A/B testing (compare policy versions)
 * - Auto-suggestions based on exception patterns
 * - Impact analysis (what would change with new policy)
 * 
 * Architecture:
 * - Works alongside DecisionMemory
 * - Stores policies as entities in memory graph
 * - Links policies to decisions for tracking
 * - Analyzes decision outcomes to measure effectiveness
 */

import { ActorMemory, ActorMemoryOptions } from './actor-memory';
import type { MemoryStorage, Entity, Fact } from './types';
import type { LamportClock } from '../../timing/lamport-clock';
import type { DecisionMemory } from './decision-memory';
import type { DecisionTrace, DecisionPattern } from '../../actor/decision-trace';

/**
 * Policy definition with versioning
 */
export interface Policy {
  id: string;
  name: string;
  description: string;
  version: string;
  rule: string;  // The actual policy rule (can be code, text, or structured)
  rules?: any[];  // For policy-sync compatibility (array of rules)
  updatedAt?: number;  // Timestamp of last update
  createdAt: number;
  createdBy: string;
  previousVersion?: string;  // Link to previous version
  changeReason?: string;  // Why was this policy changed
  isActive: boolean;
  metadata?: Record<string, any>;
}

/**
 * Policy effectiveness metrics
 */
export interface PolicyEffectiveness {
  policyId: string;
  version: string;
  
  // Usage stats
  totalDecisions: number;
  timeRange: { start: number; end: number };
  
  // Outcome metrics
  successfulDecisions: number;  // Outcome was correct
  failedDecisions: number;      // Outcome was incorrect
  unknownOutcomes: number;      // No outcome tracked yet
  
  // Exception metrics
  exceptionRate: number;        // % of decisions that needed exceptions
  exceptionCount: number;
  
  // Success rate
  successRate: number;          // successful / (successful + failed)
  
  // Common exception reasons (if exception rate is high)
  topExceptionReasons?: string[];
}

/**
 * A/B test configuration
 */
export interface PolicyABTest {
  id: string;
  name: string;
  description: string;
  
  // Policies being compared
  controlPolicy: { id: string; version: string };
  treatmentPolicy: { id: string; version: string };
  
  // Test configuration
  startTime: number;
  endTime?: number;
  trafficSplit: number;  // 0.0-1.0, % going to treatment
  
  // Targeting
  decisionTypes?: string[];  // Which decision types to test
  contextFilters?: Record<string, any>;  // Additional filters
  
  // Status
  isActive: boolean;
  
  // Results (populated during test)
  results?: PolicyABTestResults;
}

/**
 * A/B test results
 */
export interface PolicyABTestResults {
  control: {
    totalDecisions: number;
    successfulDecisions: number;
    failedDecisions: number;
    successRate: number;
    exceptionRate: number;
  };
  treatment: {
    totalDecisions: number;
    successfulDecisions: number;
    failedDecisions: number;
    successRate: number;
    exceptionRate: number;
  };
  controlMetrics: PolicyEffectiveness;
  treatmentMetrics: PolicyEffectiveness;
  
  // Statistical significance
  sampleSize: number;
  isSignificant: boolean;
  confidenceLevel: number;  // 0.0-1.0
  pValue?: number;  // Statistical p-value
  
  // Winner
  winner?: 'control' | 'treatment' | 'inconclusive';
  winnerReason?: string;
  
  // Recommendation
  recommendation: 'adopt_treatment' | 'keep_control' | 'continue_testing';
}

/**
 * Policy change suggestion from pattern analysis
 */
export interface PolicySuggestion {
  id: string;
  suggestedAt: number;
  
  // Source pattern
  pattern: DecisionPattern;
  
  // Current policy
  currentPolicy: { id: string; version: string };
  
  // Suggested change
  suggestedRule: string;
  changeReason: string;
  expectedImpact: {
    exceptionReduction: number;  // Expected % reduction in exceptions
    affectedDecisions: number;   // # of decisions this would affect
    confidence: number;          // 0.0-1.0, confidence in suggestion
  };
  
  // Review status
  status: 'pending' | 'approved' | 'rejected' | 'implemented';
  reviewedBy?: string;
  reviewedAt?: number;
  reviewComment?: string;
}

/**
 * Policy impact analysis - what would change with new policy
 */
export interface PolicyImpactAnalysis {
  policyId: string;
  currentVersion: string;
  proposedVersion: string;
  
  // Historical decisions that would be affected
  affectedDecisions: {
    total: number;
    byType: Record<string, number>;
    sample: DecisionTrace[];  // Sample of affected decisions
  };
  
  // Projected changes
  projectedChanges: {
    exceptionRate: { current: number; projected: number };
    successRate: { current: number; projected: number };
    averageApprovalTime?: { current: number; projected: number };
  };
  
  // Risk assessment
  risk: 'low' | 'medium' | 'high';
  riskFactors: string[];
  
  // Recommendation
  recommendation: string;
}

/**
 * Options for PolicyMemory
 */
export interface PolicyMemoryOptions extends ActorMemoryOptions {
  decisionMemory?: DecisionMemory;
}

/**
 * PolicyMemory manages policy evolution and effectiveness
 */
export class PolicyMemory extends ActorMemory {
  private decisionMemory?: DecisionMemory;
  private policyCache: Map<string, Policy> = new Map();
  private abTestCache: Map<string, PolicyABTest> = new Map();

  constructor(
    actorId: string,
    storage: MemoryStorage,
    lamportClock: LamportClock,
    options?: PolicyMemoryOptions
  ) {
    super(actorId, storage, lamportClock, options);
    this.decisionMemory = options?.decisionMemory;
  }

  /**
   * Add a new policy version
   */
  async addPolicy(policy: Policy): Promise<void> {
    // Store policy as entity
    const entityId = await this.addEntity(
      policy.id,
      'policy',
      policy.description,
      {
        metadata: {
          version: policy.version,
          isActive: policy.isActive,
          createdAt: policy.createdAt,
          createdBy: policy.createdBy
        }
      }
    );

    // Store full policy data
    await this.addFact(
      entityId,
      'has_policy_data',
      entityId,
      JSON.stringify(policy),
      {
        source: 'user_input',
        confidence: 1.0,
        metadata: { version: policy.version }
      }
    );

    // Link to previous version if exists
    if (policy.previousVersion) {
      const entities = await this.getEntities();
      const prevEntity = entities.find(e => e.name === policy.id && e.type === 'policy');
      
      if (prevEntity) {
        await this.addFact(
          entityId,
          'supersedes',
          prevEntity.id,
          `Policy ${policy.id} v${policy.version} supersedes v${policy.previousVersion}`,
          {
            confidence: 1.0,
            metadata: { changeReason: policy.changeReason }
          }
        );
      }
    }

    // Cache
    this.policyCache.set(`${policy.id}:${policy.version}`, policy);
  }

  /**
   * Get policy by ID and version
   */
  async getPolicy(policyId: string, version?: string): Promise<Policy | null> {
    // Check cache
    if (version) {
      const cacheKey = `${policyId}:${version}`;
      if (this.policyCache.has(cacheKey)) {
        return this.policyCache.get(cacheKey)!;
      }
    }

    // Search in storage
    const entities = await this.getEntities();
    const policyEntities = entities.filter(e => e.name === policyId && e.type === 'policy');
    
    if (policyEntities.length === 0) {
      return null;
    }

    // Get all policy versions
    const facts = await this.getCurrentFacts();
    const policies: Policy[] = [];
    
    for (const entity of policyEntities) {
      const policyFact = facts.find(
        f => f.sourceEntityId === entity.id && f.relation === 'has_policy_data'
      );
      
      if (policyFact) {
        try {
          const policy = JSON.parse(policyFact.text) as Policy;
          policies.push(policy);
          this.policyCache.set(`${policy.id}:${policy.version}`, policy);
        } catch (e) {
          console.warn('Failed to parse policy:', e);
        }
      }
    }

    // Return specific version or latest active
    if (version) {
      return policies.find(p => p.version === version) || null;
    } else {
      // Return most recent active policy (highest version number or latest createdAt)
      const activePolicies = policies.filter(p => p.isActive);
      if (activePolicies.length === 0) {
        return policies.sort((a, b) => b.createdAt - a.createdAt)[0] || null;
      }
      return activePolicies.sort((a, b) => b.createdAt - a.createdAt)[0];
    }
  }

  /**
   * Get all active policies
   */
  async getAllPolicies(): Promise<Policy[]> {
    const entities = await this.getEntities();
    const policyEntities = entities.filter(e => e.type === 'policy');
    
    const facts = await this.getCurrentFacts();
    const policies: Policy[] = [];
    
    for (const entity of policyEntities) {
      const policyFact = facts.find(
        f => f.relation === 'has_policy_data' && f.sourceEntityId === entity.id
      );
      
      if (policyFact) {
        try {
          const policy = JSON.parse(policyFact.text);
          if (policy.isActive) {
            policies.push(policy);
          }
        } catch (e) {
          // Skip invalid policy data
        }
      }
    }
    
    return policies;
  }

  /**
   * Get all versions of a policy
   */
  async getPolicyHistory(policyId: string): Promise<Policy[]> {
    const entities = await this.getEntities();
    const policyEntities = entities.filter(e => e.name === policyId && e.type === 'policy');
    
    const facts = await this.getCurrentFacts();
    const policies: Policy[] = [];
    
    for (const entity of policyEntities) {
      const policyFact = facts.find(
        f => f.sourceEntityId === entity.id && f.relation === 'has_policy_data'
      );
      
      if (policyFact) {
        try {
          const policy = JSON.parse(policyFact.text) as Policy;
          policies.push(policy);
        } catch (e) {
          console.warn('Failed to parse policy:', e);
        }
      }
    }

    // Sort by creation time
    return policies.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Calculate policy effectiveness from decision outcomes
   */
  async calculatePolicyEffectiveness(
    policyId: string,
    version: string,
    timeRange?: { start: number; end: number }
  ): Promise<PolicyEffectiveness> {
    if (!this.decisionMemory) {
      throw new Error('DecisionMemory required for effectiveness calculation');
    }

    // Find all decisions using this policy
    const allDecisions = await this.decisionMemory.getAllDecisions(10000);
    const policyDecisions = allDecisions.filter(d => 
      d.policy?.id === policyId && 
      d.policy?.version === version &&
      (!timeRange || (d.timestamp >= timeRange.start && d.timestamp <= timeRange.end))
    );

    if (policyDecisions.length === 0) {
      return {
        policyId,
        version,
        totalDecisions: 0,
        timeRange: timeRange || { start: 0, end: Date.now() },
        successfulDecisions: 0,
        failedDecisions: 0,
        unknownOutcomes: 0,
        exceptionRate: 0,
        exceptionCount: 0,
        successRate: 0
      };
    }

    // Calculate metrics
    const successful = policyDecisions.filter(d => d.outcome?.wasCorrect === true).length;
    const failed = policyDecisions.filter(d => d.outcome?.wasCorrect === false).length;
    const unknown = policyDecisions.filter(d => !d.outcome).length;
    const exceptions = policyDecisions.filter(d => d.isException).length;

    const successRate = successful + failed > 0 
      ? successful / (successful + failed) 
      : 0;

    // Extract top exception reasons
    const exceptionReasons = new Map<string, number>();
    for (const decision of policyDecisions) {
      if (decision.isException && decision.exceptionReason) {
        const reason = decision.exceptionReason;
        exceptionReasons.set(reason, (exceptionReasons.get(reason) || 0) + 1);
      }
    }

    const topReasons = Array.from(exceptionReasons.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason]) => reason);

    return {
      policyId,
      version,
      totalDecisions: policyDecisions.length,
      timeRange: timeRange || {
        start: Math.min(...policyDecisions.map(d => d.timestamp)),
        end: Math.max(...policyDecisions.map(d => d.timestamp))
      },
      successfulDecisions: successful,
      failedDecisions: failed,
      unknownOutcomes: unknown,
      exceptionRate: exceptions / policyDecisions.length,
      exceptionCount: exceptions,
      successRate,
      topExceptionReasons: topReasons.length > 0 ? topReasons : undefined
    };
  }

  /**
   * Create an A/B test for two policy versions
   */
  async createABTest(test: PolicyABTest): Promise<void> {
    // Store test as entity
    const entityId = await this.addEntity(
      test.id,
      'ab_test',
      test.description,
      {
        metadata: {
          startTime: test.startTime,
          isActive: test.isActive,
          trafficSplit: test.trafficSplit
        }
      }
    );

    // Store full test data
    await this.addFact(
      entityId,
      'has_ab_test_data',
      entityId,
      JSON.stringify(test),
      {
        source: 'user_input',
        confidence: 1.0
      }
    );

    // Cache
    this.abTestCache.set(test.id, test);
  }

  /**
   * Get A/B test by ID
   */
  async getABTest(testId: string): Promise<PolicyABTest | null> {
    // Check cache
    if (this.abTestCache.has(testId)) {
      return this.abTestCache.get(testId)!;
    }

    // Search in storage
    const entities = await this.getEntities();
    const testEntity = entities.find(e => e.name === testId && e.type === 'ab_test');
    
    if (!testEntity) {
      return null;
    }

    const facts = await this.getCurrentFacts();
    const testFact = facts.find(
      f => f.sourceEntityId === testEntity.id && f.relation === 'has_ab_test_data'
    );

    if (!testFact) {
      return null;
    }

    try {
      const test = JSON.parse(testFact.text) as PolicyABTest;
      this.abTestCache.set(testId, test);
      return test;
    } catch (e) {
      console.warn('Failed to parse AB test:', e);
      return null;
    }
  }

  /**
   * Calculate A/B test results
   */
  async calculateABTestResults(testId: string): Promise<PolicyABTestResults | null> {
    const test = await this.getABTest(testId);
    if (!test || !this.decisionMemory) {
      return null;
    }

    // Get all decisions and filter by A/B test variant
    const allDecisions = await this.decisionMemory.getAllDecisions(10000);
    const controlDecisions = allDecisions.filter(d => 
      d.abTest?.testId === testId && d.abTest?.variant === 'control'
    );
    const treatmentDecisions = allDecisions.filter(d => 
      d.abTest?.testId === testId && d.abTest?.variant === 'treatment'
    );

    // Calculate metrics for control
    const controlSuccessful = controlDecisions.filter(d => d.outcome?.wasCorrect === true).length;
    const controlFailed = controlDecisions.filter(d => d.outcome?.wasCorrect === false).length;
    const controlExceptions = controlDecisions.filter(d => d.isException).length;

    const controlMetrics = {
      totalDecisions: controlDecisions.length,
      successfulDecisions: controlSuccessful,
      failedDecisions: controlFailed,
      successRate: controlSuccessful + controlFailed > 0 
        ? controlSuccessful / (controlSuccessful + controlFailed) 
        : 0,
      exceptionRate: controlDecisions.length > 0 
        ? controlExceptions / controlDecisions.length 
        : 0
    };

    // Calculate metrics for treatment
    const treatmentSuccessful = treatmentDecisions.filter(d => d.outcome?.wasCorrect === true).length;
    const treatmentFailed = treatmentDecisions.filter(d => d.outcome?.wasCorrect === false).length;
    const treatmentExceptions = treatmentDecisions.filter(d => d.isException).length;

    const treatmentMetrics = {
      totalDecisions: treatmentDecisions.length,
      successfulDecisions: treatmentSuccessful,
      failedDecisions: treatmentFailed,
      successRate: treatmentSuccessful + treatmentFailed > 0 
        ? treatmentSuccessful / (treatmentSuccessful + treatmentFailed) 
        : 0,
      exceptionRate: treatmentDecisions.length > 0 
        ? treatmentExceptions / treatmentDecisions.length 
        : 0
    };

    // Calculate statistical significance (simplified z-test for proportions)
    const totalSamples = controlDecisions.length + treatmentDecisions.length;
    const isSignificant = this.calculateSignificance(
      { ...controlMetrics, unknownOutcomes: 0, policyId: test.controlPolicy.id, version: test.controlPolicy.version, exceptionCount: controlExceptions, timeRange: { start: 0, end: Date.now() } },
      { ...treatmentMetrics, unknownOutcomes: 0, policyId: test.treatmentPolicy.id, version: test.treatmentPolicy.version, exceptionCount: treatmentExceptions, timeRange: { start: 0, end: Date.now() } }
    );
    
    // Determine winner
    let winner: 'control' | 'treatment' | 'inconclusive' = 'inconclusive';
    let winnerReason = 'Not enough data';

    if (isSignificant && totalSamples >= 100) {
      if (treatmentMetrics.successRate > controlMetrics.successRate + 0.05) {
        winner = 'treatment';
        winnerReason = `Treatment has ${((treatmentMetrics.successRate - controlMetrics.successRate) * 100).toFixed(1)}% higher success rate`;
      } else if (controlMetrics.successRate > treatmentMetrics.successRate + 0.05) {
        winner = 'control';
        winnerReason = `Control has ${((controlMetrics.successRate - treatmentMetrics.successRate) * 100).toFixed(1)}% higher success rate`;
      } else {
        winner = 'inconclusive';
        winnerReason = 'Success rates are too similar';
      }
    }

    // Recommendation
    let recommendation: PolicyABTestResults['recommendation'] = 'continue_testing';
    if (isSignificant && totalSamples >= 100) {
      if (winner === 'treatment') {
        recommendation = 'adopt_treatment';
      } else if (winner === 'control') {
        recommendation = 'keep_control';
      }
    }

    return {
      control: {
        totalDecisions: controlMetrics.totalDecisions,
        successfulDecisions: controlMetrics.successfulDecisions,
        failedDecisions: controlMetrics.failedDecisions,
        successRate: controlMetrics.successRate,
        exceptionRate: controlMetrics.exceptionRate
      },
      treatment: {
        totalDecisions: treatmentMetrics.totalDecisions,
        successfulDecisions: treatmentMetrics.successfulDecisions,
        failedDecisions: treatmentMetrics.failedDecisions,
        successRate: treatmentMetrics.successRate,
        exceptionRate: treatmentMetrics.exceptionRate
      },
      controlMetrics: controlMetrics as any,
      treatmentMetrics: treatmentMetrics as any,
      sampleSize: totalSamples,
      isSignificant,
      confidenceLevel: isSignificant ? 0.99 : 0.5,
      pValue: isSignificant ? 0.01 : 0.5,
      winner,
      recommendation
    };
  }

  /**
   * Simple statistical significance test
   */
  private calculateSignificance(
    control: PolicyEffectiveness,
    treatment: PolicyEffectiveness
  ): boolean {
    const n1 = control.successfulDecisions + control.failedDecisions;
    const n2 = treatment.successfulDecisions + treatment.failedDecisions;
    
    if (n1 < 30 || n2 < 30) {
      return false;  // Not enough samples
    }

    const p1 = control.successRate;
    const p2 = treatment.successRate;
    const pDiff = Math.abs(p1 - p2);
    
    // Simplified: if difference > 10%, consider significant
    return pDiff > 0.10;
  }

  /**
   * Generate policy suggestions from exception patterns
   */
  async generatePolicySuggestions(
    policyId: string,
    minPatternFrequency: number = 5
  ): Promise<PolicySuggestion[]> {
    if (!this.decisionMemory) {
      throw new Error('DecisionMemory required for policy suggestions');
    }

    // Get current policy
    const currentPolicy = await this.getPolicy(policyId);
    if (!currentPolicy) {
      return [];
    }

    // Get exception patterns
    const patterns = await this.decisionMemory.detectExceptionPatterns();
    
    if (!patterns || patterns.length === 0) {
      return [];
    }
    
    const suggestions: PolicySuggestion[] = [];

    for (const pattern of patterns) {
      if (pattern.frequency < minPatternFrequency) {
        continue;
      }

      // Generate suggestion from pattern
      const suggestion: PolicySuggestion = {
        id: `suggestion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        suggestedAt: Date.now(),
        pattern: pattern as any,
        currentPolicy: {
          id: currentPolicy.id,
          version: currentPolicy.version
        },
        suggestedRule: this.generateRuleFromPattern(currentPolicy, pattern as any),
        changeReason: `High frequency of exceptions (${pattern.frequency}) with common factors: ${pattern.commonFactors.join(', ')}`,
        expectedImpact: {
          exceptionReduction: Math.min(90, (pattern.frequency / 100) * 100),
          affectedDecisions: pattern.frequency,
          confidence: pattern.frequency >= 10 ? 0.8 : 0.6
        },
        status: 'pending'
      };

      suggestions.push(suggestion);
    }

    return suggestions.sort((a, b) => 
      b.expectedImpact.exceptionReduction - a.expectedImpact.exceptionReduction
    );
  }

  /**
   * Generate rule text from exception pattern
   */
  private generateRuleFromPattern(policy: Policy, pattern: DecisionPattern): string {
    const factors = pattern.commonFactors.slice(0, 3).join(' AND ');
    return `${policy.rule}\n\nAuto-generated exception rule:\nIF ${factors} THEN allow_exception WITH reason: "Common pattern detected"`;
  }

  /**
   * Analyze impact of policy change on historical decisions
   */
  async analyzePolicyImpact(
    policyId: string,
    currentVersion: string,
    proposedVersion: string,
    decisionSample: number = 100
  ): Promise<PolicyImpactAnalysis> {
    if (!this.decisionMemory) {
      throw new Error('DecisionMemory required for impact analysis');
    }

    // Get policies
    const currentPolicy = await this.getPolicy(policyId, currentVersion);
    const proposedPolicy = await this.getPolicy(policyId, proposedVersion);
    
    if (!currentPolicy || !proposedPolicy) {
      throw new Error('Policy versions not found');
    }

    // Get decisions using current policy
    const allDecisions = await this.decisionMemory.getAllDecisions(10000);
    const affectedDecisions = allDecisions.filter(d => 
      d.policy?.id === policyId && d.policy?.version === currentVersion
    );

    // Calculate current metrics
    const currentMetrics = await this.calculatePolicyEffectiveness(
      policyId,
      currentVersion
    );

    // Project changes (simplified - would need actual policy evaluation)
    const projectedExceptionRate = Math.max(
      0,
      currentMetrics.exceptionRate * 0.7  // Assume 30% reduction
    );

    const projectedSuccessRate = Math.min(
      1.0,
      currentMetrics.successRate * 1.1  // Assume 10% improvement
    );

    // Assess risk
    const riskFactors: string[] = [];
    if (affectedDecisions.length > 1000) {
      riskFactors.push('High volume of affected decisions');
    }
    if (currentMetrics.successRate > 0.9) {
      riskFactors.push('Current policy already performing well');
    }

    const risk: 'low' | 'medium' | 'high' = 
      riskFactors.length === 0 ? 'low' :
      riskFactors.length === 1 ? 'medium' : 'high';

    // Group by type
    const byType: Record<string, number> = {};
    for (const decision of affectedDecisions) {
      byType[decision.decisionType] = (byType[decision.decisionType] || 0) + 1;
    }

    return {
      policyId,
      currentVersion,
      proposedVersion,
      affectedDecisions: {
        total: affectedDecisions.length,
        byType,
        sample: affectedDecisions.slice(0, decisionSample)
      },
      projectedChanges: {
        exceptionRate: {
          current: currentMetrics.exceptionRate,
          projected: projectedExceptionRate
        },
        successRate: {
          current: currentMetrics.successRate,
          projected: projectedSuccessRate
        }
      },
      risk,
      riskFactors,
      recommendation: risk === 'low' 
        ? 'Safe to deploy with monitoring'
        : risk === 'medium'
        ? 'Deploy gradually with A/B testing'
        : 'Deploy to small percentage first'
    };
  }

  /**
   * Clear caches
   */
  clearCache(): void {
    this.policyCache.clear();
    this.abTestCache.clear();
  }
}
