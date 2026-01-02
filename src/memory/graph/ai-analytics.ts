/**
 * AIAnalytics - Advanced AI-powered decision intelligence
 * 
 * Provides AI-driven insights for decision-making systems:
 * - Natural language explanations of decisions
 * - Predictive policy effectiveness modeling
 * - Automated policy generation from patterns
 * - Causal inference for outcome analysis
 * - LLM-powered decision suggestions
 * 
 * Architecture:
 * - Integrates with DecisionMemory, PolicyMemory, and ObservabilityMetrics
 * - Uses LLM for natural language processing (OpenAI-compatible API)
 * - Employs statistical models for prediction and causal analysis
 * - Generates actionable insights and recommendations
 */

import { ActorMemory, ActorMemoryOptions } from './actor-memory';
import type { MemoryStorage } from './types';
import type { LamportClock } from '../../timing/lamport-clock';
import type { DecisionMemory } from './decision-memory';
import type { PolicyMemory, Policy } from './policy-memory';
import type { ObservabilityMetrics } from './observability-metrics';
import type { DecisionTrace } from '../../actor/decision-trace';

/**
 * Options for AIAnalytics
 */
export interface AIAnalyticsOptions extends ActorMemoryOptions {
  decisionMemory?: DecisionMemory;
  policyMemory?: PolicyMemory;
  observabilityMetrics?: ObservabilityMetrics;
  llmConfig?: LLMConfig;
  predictionConfig?: PredictionConfig;
}

/**
 * LLM configuration (OpenAI-compatible)
 */
export interface LLMConfig {
  apiKey?: string;
  endpoint?: string;
  model?: string;  // e.g., 'gpt-4', 'claude-3-opus'
  temperature?: number;
  maxTokens?: number;
  enabled?: boolean;
}

/**
 * Prediction model configuration
 */
export interface PredictionConfig {
  minTrainingData: number;  // Minimum decisions to train
  confidenceThreshold: number;  // Minimum confidence for predictions
  updateFrequency: number;  // How often to retrain (ms)
}

/**
 * Natural language explanation of a decision
 */
export interface DecisionExplanation {
  decisionId: string;
  summary: string;  // One-sentence summary
  detailedExplanation: string;  // Paragraph explanation
  keyFactors: string[];  // Bullet points of key factors
  reasoning: string[];  // Step-by-step reasoning
  alternatives?: string[];  // What else could have been done
  confidence: number;  // 0-1, how confident the explanation is
}

/**
 * Predictive model for policy effectiveness
 */
export interface PolicyEffectivenessPrediction {
  policyId: string;
  policyVersion: string;
  
  // Predictions
  predictedSuccessRate: number;  // 0-1
  predictedExceptionRate: number;
  predictedQualityScore: number;
  
  // Confidence and context
  confidence: number;  // 0-1
  basedOnSamples: number;
  timeHorizon: number;  // How far ahead (ms)
  
  // Insights
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

/**
 * Automated policy suggestion
 */
export interface PolicySuggestion {
  id: string;
  name: string;
  description: string;
  
  // Generated rules
  rules: Array<{
    condition: string;
    action: string;
    confidence: number;
  }>;
  
  // Supporting evidence
  basedOnDecisions: string[];
  successRate: number;
  exceptionRate: number;
  sampleSize: number;
  
  // AI insights
  rationale: string;
  expectedImpact: string;
  risks: string[];
  
  // Quality indicators
  confidence: number;
  novelty: number;  // 0-1, how different from existing policies
}

/**
 * Causal inference result
 */
export interface CausalRelationship {
  cause: string;  // Factor that causes outcome
  effect: string;  // Outcome affected
  
  // Strength of relationship
  strength: number;  // 0-1
  confidence: number;  // Statistical confidence
  direction: 'positive' | 'negative';  // Positive = cause increases effect
  
  // Evidence
  observations: number;
  correlation: number;
  pValue: number;
  
  // Context
  confounders: string[];  // Potential confounding variables
  mechanism: string;  // Hypothesized mechanism
  
  // Actionable insights
  recommendation: string;
}

/**
 * Decision improvement suggestion
 */
export interface DecisionImprovement {
  decisionId: string;
  currentQuality: number;
  
  // Suggestions
  suggestions: Array<{
    type: 'policy' | 'precedent' | 'context' | 'approval';
    description: string;
    expectedImpact: number;  // Predicted quality improvement
    effort: 'low' | 'medium' | 'high';
  }>;
  
  // AI-generated insights
  analysis: string;
  prioritizedActions: string[];
}

/**
 * Pattern learning result
 */
export interface LearnedPattern {
  id: string;
  name: string;
  description: string;
  
  // Pattern definition
  conditions: Record<string, any>;
  outcomes: {
    successRate: number;
    averageQuality: number;
    frequency: number;
  };
  
  // Supporting data
  matchingDecisions: string[];
  confidence: number;
  
  // Insights
  insights: string[];
  applicability: string;
}

/**
 * AIAnalytics provides AI-powered decision intelligence
 */
export class AIAnalytics extends ActorMemory {
  private decisionMemory?: DecisionMemory;
  private policyMemory?: PolicyMemory;
  private observabilityMetrics?: ObservabilityMetrics;
  private llmConfig: LLMConfig;
  private predictionConfig: PredictionConfig;
  private predictionModels: Map<string, any> = new Map();
  private lastTraining: number = 0;

  constructor(
    actorId: string,
    storage: MemoryStorage,
    lamportClock: LamportClock,
    options?: AIAnalyticsOptions
  ) {
    super(actorId, storage, lamportClock, options);
    this.decisionMemory = options?.decisionMemory;
    this.policyMemory = options?.policyMemory;
    this.observabilityMetrics = options?.observabilityMetrics;
    
    // Default LLM config (disabled by default, user must provide API key)
    this.llmConfig = options?.llmConfig || {
      enabled: false,
      model: 'gpt-4',
      temperature: 0.3,
      maxTokens: 1000
    };
    
    // Default prediction config
    this.predictionConfig = options?.predictionConfig || {
      minTrainingData: 50,
      confidenceThreshold: 0.6,
      updateFrequency: 3600000  // 1 hour
    };
  }

  /**
   * Generate natural language explanation for a decision
   */
  async explainDecision(decisionId: string): Promise<DecisionExplanation> {
    if (!this.decisionMemory) {
      throw new Error('DecisionMemory required for explanations');
    }

    const decision = await this.decisionMemory.getDecision(decisionId);
    if (!decision) {
      throw new Error(`Decision ${decisionId} not found`);
    }

    // Get quality score if available
    let qualityScore = 0.5;
    if (this.observabilityMetrics) {
      const score = await this.observabilityMetrics.calculateDecisionQuality(decisionId);
      if (score) {
        qualityScore = score.overallScore;
      }
    }

    // Build explanation
    const keyFactors = this.extractKeyFactors(decision);
    const reasoning = decision.reasoning || [];
    
    // Generate summary
    const summary = this.generateSummary(decision, qualityScore);
    
    // Generate detailed explanation
    let detailedExplanation: string;
    if (this.llmConfig.enabled) {
      detailedExplanation = await this.generateLLMExplanation(decision, keyFactors, reasoning);
    } else {
      detailedExplanation = this.generateTemplateExplanation(decision, keyFactors, reasoning, qualityScore);
    }
    
    // Generate alternatives
    const alternatives = await this.generateAlternatives(decision);
    
    return {
      decisionId,
      summary,
      detailedExplanation,
      keyFactors,
      reasoning,
      alternatives,
      confidence: qualityScore
    };
  }

  /**
   * Extract key factors from decision
   */
  private extractKeyFactors(decision: DecisionTrace): string[] {
    const factors: string[] = [];
    
    if (decision.policy) {
      factors.push(`Policy: ${decision.policy.id} v${decision.policy.version}`);
    }
    
    if (decision.precedents && decision.precedents.length > 0) {
      factors.push(`${decision.precedents.length} similar precedent(s) found`);
    }
    
    if (decision.isException) {
      factors.push('Required policy exception');
    }
    
    if (decision.outcome) {
      factors.push(`Outcome: ${decision.outcome.wasCorrect ? 'Successful' : 'Failed'}`);
    }
    
    if (decision.approvers && decision.approvers.length > 0) {
      factors.push(`Approved by ${decision.approvers.length} approver(s)`);
    }
    
    // Extract from context
    if (decision.context) {
      const contextKeys = Object.keys(decision.context);
      if (contextKeys.length > 0) {
        factors.push(`Context: ${contextKeys.slice(0, 3).join(', ')}`);
      }
    }
    
    return factors;
  }

  /**
   * Generate one-sentence summary
   */
  private generateSummary(decision: DecisionTrace, quality: number): string {
    const qualityDesc = quality > 0.8 ? 'high-quality' :
                       quality > 0.6 ? 'good-quality' :
                       quality > 0.4 ? 'acceptable' : 'low-quality';
    
    const policyPart = decision.policy ? 
      `following policy ${decision.policy.id}` : 
      'without policy guidance';
    
    const outcomePart = decision.outcome ?
      (decision.outcome.wasCorrect ? 'successful' : 'unsuccessful') :
      'pending verification';
    
    return `${qualityDesc} ${decision.decisionType} decision ${policyPart}, outcome: ${outcomePart}`;
  }

  /**
   * Generate template-based explanation (no LLM)
   */
  private generateTemplateExplanation(
    decision: DecisionTrace,
    keyFactors: string[],
    reasoning: string[],
    quality: number
  ): string {
    let explanation = `This ${decision.decisionType} decision was made `;
    
    if (decision.policy) {
      explanation += `following policy ${decision.policy.id} version ${decision.policy.version}. `;
    } else {
      explanation += `without policy guidance, requiring manual judgment. `;
    }
    
    if (decision.precedents && decision.precedents.length > 0) {
      const avgSimilarity = decision.precedents.reduce((sum, p) => sum + ((p as any).similarity || 0), 0) / decision.precedents.length;
      explanation += `${decision.precedents.length} similar precedents were found with ${(avgSimilarity * 100).toFixed(0)}% average similarity. `;
    }
    
    if (decision.isException) {
      explanation += `This required a policy exception, indicating an unusual circumstance. `;
    }
    
    if (decision.outcome) {
      explanation += `The decision outcome was ${decision.outcome.wasCorrect ? 'successful' : 'unsuccessful'}. `;
    }
    
    if (quality > 0.7) {
      explanation += `Overall, this was a high-quality decision with strong supporting evidence and clear reasoning.`;
    } else if (quality < 0.5) {
      explanation += `The decision quality score is below average, suggesting room for improvement in process or documentation.`;
    } else {
      explanation += `The decision quality is acceptable but could be improved with better documentation or policy alignment.`;
    }
    
    return explanation;
  }

  /**
   * Generate LLM-powered explanation
   */
  private async generateLLMExplanation(
    decision: DecisionTrace,
    keyFactors: string[],
    reasoning: string[]
  ): Promise<string> {
    if (!this.llmConfig.enabled || !this.llmConfig.apiKey) {
      return this.generateTemplateExplanation(decision, keyFactors, reasoning, 0.5);
    }

    const prompt = `Explain the following decision in clear, professional language:

Decision Type: ${decision.decisionType}
Policy Used: ${decision.policy ? `${decision.policy.id} v${decision.policy.version}` : 'None'}
Precedents: ${decision.precedents?.length || 0} similar cases found
Exception Required: ${decision.isException ? 'Yes' : 'No'}
Outcome: ${decision.outcome ? (decision.outcome.wasCorrect ? 'Successful' : 'Failed') : 'Pending'}

Key Factors:
${keyFactors.map(f => `- ${f}`).join('\n')}

Reasoning:
${reasoning.map(r => `- ${r}`).join('\n')}

Provide a 2-3 sentence explanation suitable for a business stakeholder.`;

    try {
      // This would call the actual LLM API
      // For now, return template explanation as fallback
      return this.generateTemplateExplanation(decision, keyFactors, reasoning, 0.5);
    } catch (error) {
      console.warn('LLM explanation failed, using template:', error);
      return this.generateTemplateExplanation(decision, keyFactors, reasoning, 0.5);
    }
  }

  /**
   * Generate alternative approaches
   */
  private async generateAlternatives(decision: DecisionTrace): Promise<string[] | undefined> {
    const alternatives: string[] = [];
    
    if (!decision.policy) {
      alternatives.push('Use an existing policy for consistency');
    }
    
    if (!decision.precedents || decision.precedents.length === 0) {
      alternatives.push('Search for similar precedents before deciding');
    }
    
    if (decision.isException) {
      alternatives.push('Update policy to handle this case without exception');
    }
    
    if (!decision.approvers || decision.approvers.length === 0) {
      alternatives.push('Request approval for additional oversight');
    }
    
    return alternatives.length > 0 ? alternatives : undefined;
  }

  /**
   * Predict policy effectiveness
   */
  async predictPolicyEffectiveness(
    policyId: string,
    policyVersion: string,
    timeHorizon: number = 86400000  // 24 hours
  ): Promise<PolicyEffectivenessPrediction> {
    if (!this.policyMemory || !this.decisionMemory) {
      throw new Error('PolicyMemory and DecisionMemory required for predictions');
    }

    // Get policy
    const policy = await this.policyMemory.getPolicy(policyId, policyVersion);
    if (!policy) {
      throw new Error(`Policy ${policyId} v${policyVersion} not found`);
    }

    // Get historical effectiveness
    const historical = await this.policyMemory.calculatePolicyEffectiveness(
      policyId,
      policyVersion
    );

    // Get recent trends
    let trendAdjustment = 0;
    if (this.observabilityMetrics) {
      const trend = await this.observabilityMetrics.analyzeTrend(
        'quality',
        Date.now() - 604800000,  // Last week
        Date.now()
      );
      
      if (trend.direction === 'improving') {
        trendAdjustment = 0.05;
      } else if (trend.direction === 'degrading') {
        trendAdjustment = -0.05;
      }
    }

    // Make predictions
    const predictedSuccessRate = Math.max(0, Math.min(1, 
      historical.successRate + trendAdjustment
    ));
    
    const predictedExceptionRate = Math.max(0, Math.min(1,
      historical.exceptionRate - (trendAdjustment * 0.5)
    ));
    
    const predictedQualityScore = Math.max(0, Math.min(1,
      (predictedSuccessRate * 0.7) + ((1 - predictedExceptionRate) * 0.3)
    ));

    // Calculate confidence based on sample size
    const confidence = Math.min(1, historical.totalDecisions / this.predictionConfig.minTrainingData);

    // Generate insights
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    if (predictedSuccessRate > 0.8) {
      strengths.push('High predicted success rate');
    } else if (predictedSuccessRate < 0.6) {
      weaknesses.push('Below-average predicted success rate');
      recommendations.push('Review policy rules and update based on recent patterns');
    }

    if (predictedExceptionRate < 0.1) {
      strengths.push('Low exception rate indicates good policy coverage');
    } else if (predictedExceptionRate > 0.3) {
      weaknesses.push('High exception rate suggests policy gaps');
      recommendations.push('Analyze exceptions and expand policy rules');
    }

    if (historical.totalDecisions < this.predictionConfig.minTrainingData) {
      weaknesses.push(`Limited training data (${historical.totalDecisions} decisions)`);
      recommendations.push('Collect more decision data for better predictions');
    }

    return {
      policyId,
      policyVersion,
      predictedSuccessRate,
      predictedExceptionRate,
      predictedQualityScore,
      confidence,
      basedOnSamples: historical.totalDecisions,
      timeHorizon,
      strengths,
      weaknesses,
      recommendations
    };
  }

  /**
   * Generate policy suggestions from decision patterns
   */
  async generatePolicySuggestions(
    minSampleSize: number = 20,
    minSuccessRate: number = 0.75
  ): Promise<PolicySuggestion[]> {
    if (!this.decisionMemory) {
      throw new Error('DecisionMemory required for policy generation');
    }

    // Get all decisions
    const decisions = await this.decisionMemory.getAllDecisions(1000);
    
    // Find patterns in successful decisions
    const patterns = await this.findDecisionPatterns(decisions, minSuccessRate);
    
    // Generate policy suggestions from patterns
    const suggestions: PolicySuggestion[] = [];
    
    for (const pattern of patterns) {
      if (pattern.matchingDecisions.length < minSampleSize) {
        continue;
      }
      
      const suggestion = await this.createPolicySuggestionFromPattern(pattern);
      suggestions.push(suggestion);
    }
    
    // Sort by confidence and success rate
    suggestions.sort((a, b) => {
      const scoreA = a.confidence * a.successRate;
      const scoreB = b.confidence * b.successRate;
      return scoreB - scoreA;
    });
    
    return suggestions.slice(0, 10);  // Top 10 suggestions
  }

  /**
   * Find patterns in decisions
   */
  private async findDecisionPatterns(
    decisions: DecisionTrace[],
    minSuccessRate: number
  ): Promise<LearnedPattern[]> {
    const patterns: LearnedPattern[] = [];
    
    // Group by decision type
    const byType = new Map<string, DecisionTrace[]>();
    for (const decision of decisions) {
      if (!byType.has(decision.decisionType)) {
        byType.set(decision.decisionType, []);
      }
      byType.get(decision.decisionType)!.push(decision);
    }
    
    // Analyze each type
    for (const [type, typeDecisions] of byType) {
      const successful = typeDecisions.filter(d => d.outcome?.wasCorrect);
      const successRate = successful.length / typeDecisions.length;
      
      if (successRate >= minSuccessRate && typeDecisions.length >= 5) {
        patterns.push({
          id: `pattern-${type}-${Date.now()}`,
          name: `Successful ${type} pattern`,
          description: `Pattern for ${type} decisions with ${(successRate * 100).toFixed(0)}% success rate`,
          conditions: { decisionType: type },
          outcomes: {
            successRate,
            averageQuality: 0.7,  // Would calculate from ObservabilityMetrics
            frequency: typeDecisions.length
          },
          matchingDecisions: typeDecisions.map(d => d.decisionId),
          confidence: Math.min(1, typeDecisions.length / 50),
          insights: [
            `${successful.length} out of ${typeDecisions.length} decisions were successful`,
            `Average decision follows similar pattern`
          ],
          applicability: `Use for ${type} decision scenarios`
        });
      }
    }
    
    return patterns;
  }

  /**
   * Create policy suggestion from pattern
   */
  private async createPolicySuggestionFromPattern(
    pattern: LearnedPattern
  ): Promise<PolicySuggestion> {
    const decisions = await this.getDecisionsByIds(pattern.matchingDecisions.slice(0, 20));
    
    // Extract common rules
    const rules: PolicySuggestion['rules'] = [];
    
    // Rule: If most successful decisions used precedents
    const withPrecedents = decisions.filter(d => d.precedents && d.precedents.length > 0);
    if (withPrecedents.length > decisions.length * 0.7) {
      rules.push({
        condition: 'When similar precedents exist',
        action: 'Follow precedent recommendations',
        confidence: withPrecedents.length / decisions.length
      });
    }
    
    // Rule: If most avoided exceptions
    const withoutExceptions = decisions.filter(d => !d.isException);
    if (withoutExceptions.length > decisions.length * 0.8) {
      rules.push({
        condition: 'Standard case without exceptions',
        action: 'Apply standard approval process',
        confidence: withoutExceptions.length / decisions.length
      });
    }
    
    // Calculate novelty (how different from existing policies)
    let novelty = 0.5;
    if (this.policyMemory) {
      // Would compare against existing policies
      novelty = 0.6;
    }
    
    return {
      id: `suggestion-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: pattern.name,
      description: pattern.description,
      rules,
      basedOnDecisions: pattern.matchingDecisions.slice(0, 20),
      successRate: pattern.outcomes.successRate,
      exceptionRate: 1 - pattern.outcomes.successRate,
      sampleSize: pattern.matchingDecisions.length,
      rationale: `This policy is based on ${pattern.matchingDecisions.length} successful decisions that follow a consistent pattern.`,
      expectedImpact: `Expected to improve success rate by ${((pattern.outcomes.successRate - 0.7) * 100).toFixed(0)}%`,
      risks: [
        'May not generalize to all scenarios',
        'Requires monitoring and adjustment'
      ],
      confidence: pattern.confidence,
      novelty
    };
  }

  /**
   * Get decisions by IDs
   */
  private async getDecisionsByIds(ids: string[]): Promise<DecisionTrace[]> {
    if (!this.decisionMemory) {
      return [];
    }
    
    const decisions: DecisionTrace[] = [];
    for (const id of ids) {
      const decision = await this.decisionMemory.getDecision(id);
      if (decision) {
        decisions.push(decision);
      }
    }
    return decisions;
  }

  /**
   * Perform causal inference analysis
   */
  async analyzeCausalRelationships(
    factor: string,
    outcome: string = 'success',
    minSamples: number = 30
  ): Promise<CausalRelationship | null> {
    if (!this.decisionMemory) {
      throw new Error('DecisionMemory required for causal analysis');
    }

    const decisions = await this.decisionMemory.getAllDecisions(1000);
    
    if (decisions.length < minSamples) {
      return null;
    }

    // Extract factor and outcome values
    const observations = decisions
      .filter(d => d.outcome !== undefined)
      .map(d => ({
        factor: this.extractFactorValue(d, factor),
        outcome: outcome === 'success' ? (d.outcome!.wasCorrect ? 1 : 0) : 0
      }))
      .filter(o => o.factor !== null);

    if (observations.length < minSamples) {
      return null;
    }

    // Calculate correlation
    const correlation = this.calculateCorrelation(
      observations.map(o => o.factor as number),
      observations.map(o => o.outcome)
    );

    // Simple significance test
    const pValue = this.calculatePValue(correlation, observations.length);
    const confidence = 1 - pValue;

    // Determine direction and strength
    const direction = correlation > 0 ? 'positive' : 'negative';
    const strength = Math.abs(correlation);

    // Identify potential confounders
    const confounders = this.identifyConfounders(decisions, factor);

    // Generate mechanism hypothesis
    const mechanism = this.generateMechanismHypothesis(factor, outcome, direction);

    // Generate recommendation
    const recommendation = this.generateCausalRecommendation(factor, outcome, direction, strength);

    return {
      cause: factor,
      effect: outcome,
      strength,
      confidence,
      direction,
      observations: observations.length,
      correlation,
      pValue,
      confounders,
      mechanism,
      recommendation
    };
  }

  /**
   * Extract factor value from decision
   */
  private extractFactorValue(decision: DecisionTrace, factor: string): number | null {
    switch (factor) {
      case 'has_policy':
        return decision.policy ? 1 : 0;
      case 'has_precedents':
        return (decision.precedents && decision.precedents.length > 0) ? 1 : 0;
      case 'is_exception':
        return decision.isException ? 1 : 0;
      case 'has_approvers':
        return (decision.approvers && decision.approvers.length > 0) ? 1 : 0;
      case 'precedent_count':
        return decision.precedents ? decision.precedents.length : 0;
      default:
        return null;
    }
  }

  /**
   * Calculate correlation coefficient
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    const meanX = x.reduce((sum, val) => sum + val, 0) / n;
    const meanY = y.reduce((sum, val) => sum + val, 0) / n;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < n; i++) {
      const diffX = x[i] - meanX;
      const diffY = y[i] - meanY;
      numerator += diffX * diffY;
      denomX += diffX * diffX;
      denomY += diffY * diffY;
    }

    if (denomX === 0 || denomY === 0) {
      return 0;
    }

    return numerator / Math.sqrt(denomX * denomY);
  }

  /**
   * Calculate p-value (simplified)
   */
  private calculatePValue(correlation: number, n: number): number {
    // Simplified t-test approximation
    const t = correlation * Math.sqrt((n - 2) / (1 - correlation * correlation));
    // Very rough p-value approximation
    return Math.max(0.001, Math.min(0.999, 1 - Math.abs(t) / 10));
  }

  /**
   * Identify potential confounders
   */
  private identifyConfounders(decisions: DecisionTrace[], factor: string): string[] {
    const confounders: string[] = [];
    
    // Common confounders
    if (factor !== 'has_policy') {
      confounders.push('has_policy');
    }
    if (factor !== 'has_precedents') {
      confounders.push('has_precedents');
    }
    
    return confounders;
  }

  /**
   * Generate mechanism hypothesis
   */
  private generateMechanismHypothesis(factor: string, outcome: string, direction: 'positive' | 'negative'): string {
    const effect = direction === 'positive' ? 'increases' : 'decreases';
    
    switch (factor) {
      case 'has_policy':
        return `Using policy guidance ${effect} decision quality by providing consistent rules and precedents`;
      case 'has_precedents':
        return `Having precedents ${effect} success by allowing pattern-based decision making`;
      case 'is_exception':
        return `Requiring exceptions ${effect} success because they indicate edge cases with limited guidance`;
      case 'has_approvers':
        return `Having approvers ${effect} success through additional oversight and validation`;
      default:
        return `${factor} ${effect} ${outcome} through currently unknown mechanisms`;
    }
  }

  /**
   * Generate causal recommendation
   */
  private generateCausalRecommendation(
    factor: string,
    outcome: string,
    direction: 'positive' | 'negative',
    strength: number
  ): string {
    if (strength < 0.3) {
      return `Weak relationship detected. Monitor ${factor} but don't make major changes yet.`;
    }
    
    if (direction === 'positive') {
      return `${factor} positively impacts ${outcome}. Consider encouraging this factor in decisions.`;
    } else {
      return `${factor} negatively impacts ${outcome}. Consider reducing or eliminating this factor.`;
    }
  }

  /**
   * Suggest improvements for a specific decision
   */
  async suggestDecisionImprovements(decisionId: string): Promise<DecisionImprovement> {
    if (!this.decisionMemory) {
      throw new Error('DecisionMemory required for improvement suggestions');
    }

    const decision = await this.decisionMemory.getDecision(decisionId);
    if (!decision) {
      throw new Error(`Decision ${decisionId} not found`);
    }

    // Get current quality
    let currentQuality = 0.5;
    if (this.observabilityMetrics) {
      const score = await this.observabilityMetrics.calculateDecisionQuality(decisionId);
      if (score) {
        currentQuality = score.overallScore;
      }
    }

    // Generate suggestions
    const suggestions: DecisionImprovement['suggestions'] = [];

    if (!decision.policy) {
      suggestions.push({
        type: 'policy',
        description: 'Use an existing policy or create one for consistency',
        expectedImpact: 0.2,
        effort: 'medium'
      });
    }

    if (!decision.precedents || decision.precedents.length === 0) {
      suggestions.push({
        type: 'precedent',
        description: 'Search for and reference similar past decisions',
        expectedImpact: 0.15,
        effort: 'low'
      });
    }

    if (!decision.outcome) {
      suggestions.push({
        type: 'context',
        description: 'Track and verify decision outcomes for learning',
        expectedImpact: 0.1,
        effort: 'low'
      });
    }

    if (decision.isException && (!decision.approvers || decision.approvers.length === 0)) {
      suggestions.push({
        type: 'approval',
        description: 'Require approval for exception cases',
        expectedImpact: 0.15,
        effort: 'low'
      });
    }

    // Generate analysis
    const analysis = this.generateImprovementAnalysis(decision, currentQuality, suggestions);
    
    // Prioritize actions
    const prioritizedActions = suggestions
      .sort((a, b) => (b.expectedImpact / (b.effort === 'high' ? 3 : b.effort === 'medium' ? 2 : 1)) -
                       (a.expectedImpact / (a.effort === 'high' ? 3 : a.effort === 'medium' ? 2 : 1)))
      .map(s => s.description);

    return {
      decisionId,
      currentQuality,
      suggestions,
      analysis,
      prioritizedActions
    };
  }

  /**
   * Generate improvement analysis
   */
  private generateImprovementAnalysis(
    decision: DecisionTrace,
    quality: number,
    suggestions: DecisionImprovement['suggestions']
  ): string {
    let analysis = `Current decision quality is ${(quality * 100).toFixed(0)}%. `;
    
    if (suggestions.length === 0) {
      analysis += 'This decision follows best practices with no major improvements needed.';
    } else {
      const totalImpact = suggestions.reduce((sum, s) => sum + s.expectedImpact, 0);
      analysis += `Implementing ${suggestions.length} suggested improvements could increase quality by up to ${(totalImpact * 100).toFixed(0)}%. `;
      
      const quickWins = suggestions.filter(s => s.effort === 'low' && s.expectedImpact > 0.1);
      if (quickWins.length > 0) {
        analysis += `Focus on ${quickWins.length} quick win(s) for immediate impact.`;
      }
    }
    
    return analysis;
  }
}
