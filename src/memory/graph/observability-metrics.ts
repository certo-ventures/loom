/**
 * ObservabilityMetrics - Decision quality scoring and analytics
 * 
 * Provides observability into decision-making patterns:
 * - Decision quality scoring (0-1 based on multiple factors)
 * - Time-series metrics aggregation (for Grafana/Prometheus)
 * - Trend analysis (improving/degrading/stable)
 * - Anomaly detection (outliers from baseline)
 * - Compliance reporting (audit trail summaries)
 * 
 * Architecture:
 * - Works alongside DecisionMemory and PolicyMemory
 * - Analyzes decisions to generate actionable insights
 * - Provides metrics in dashboard-friendly formats
 * - Non-blocking: doesn't slow down decision execution
 */

import { ActorMemory, ActorMemoryOptions } from './actor-memory';
import type { MemoryStorage } from './types';
import type { LamportClock } from '../../timing/lamport-clock';
import type { DecisionMemory } from './decision-memory';
import type { PolicyMemory } from './policy-memory';
import type { DecisionTrace } from '../../actor/decision-trace';

/**
 * Options for ObservabilityMetrics
 */
export interface ObservabilityMetricsOptions extends ActorMemoryOptions {
  decisionMemory?: DecisionMemory;
  policyMemory?: PolicyMemory;
  qualityThresholds?: QualityThresholds;
  anomalyDetection?: AnomalyDetectionConfig;
}

/**
 * Thresholds for decision quality scoring
 */
export interface QualityThresholds {
  minSuccessRate: number;  // Below this = low quality (default: 0.7)
  maxExceptionRate: number;  // Above this = low quality (default: 0.2)
  minConfidence: number;  // Below this = uncertain (default: 0.6)
}

/**
 * Anomaly detection configuration
 */
export interface AnomalyDetectionConfig {
  enabled: boolean;
  standardDeviations: number;  // How many std devs = anomaly (default: 2)
  minSampleSize: number;  // Minimum samples for baseline (default: 30)
}

/**
 * Decision quality score (0-1)
 */
export interface DecisionQualityScore {
  decisionId: string;
  overallScore: number;  // 0-1, higher is better
  
  // Component scores
  outcomeScore: number;  // Based on wasCorrect
  confidenceScore: number;  // Based on confidence if available
  policyAlignmentScore: number;  // How well it followed policy
  exceptionPenalty: number;  // Penalty if exception was needed
  
  // Factors
  factors: {
    hadPrecedents: boolean;
    usedPolicy: boolean;
    requiredException: boolean;
    hadOutcome: boolean;
    outcomeCorrect?: boolean;
  };
  
  // Quality tier
  tier: 'excellent' | 'good' | 'acceptable' | 'poor';
  
  // Recommendations
  recommendations?: string[];
}

/**
 * Time-series metrics bucket
 */
export interface MetricsBucket {
  timestamp: number;  // Bucket start time
  duration: number;  // Bucket duration (ms)
  
  // Volume metrics
  totalDecisions: number;
  decisionsByType: Record<string, number>;
  
  // Quality metrics
  averageQualityScore: number;
  successRate: number;
  exceptionRate: number;
  
  // Performance metrics
  averageDecisionTime?: number;
  
  // Policy metrics
  policiesUsed: number;
  policySuccessRate: number;
  
  // Trend indicators
  trend: 'improving' | 'stable' | 'degrading';
  trendConfidence: number;  // 0-1
}

/**
 * Trend analysis result
 */
export interface TrendAnalysis {
  metric: string;
  timeRange: { start: number; end: number };
  
  // Trend direction
  direction: 'improving' | 'stable' | 'degrading';
  confidence: number;  // 0-1
  
  // Statistical measures
  slope: number;  // Rate of change
  rSquared: number;  // Goodness of fit (0-1)
  
  // Data points
  samples: Array<{ timestamp: number; value: number }>;
  
  // Insights
  summary: string;
  recommendation?: string;
}

/**
 * Anomaly detection result
 */
export interface Anomaly {
  id: string;
  detectedAt: number;
  
  // Anomaly details
  metric: string;
  actualValue: number;
  expectedValue: number;
  deviation: number;  // Number of standard deviations
  
  // Severity
  severity: 'critical' | 'warning' | 'info';
  
  // Context
  affectedDecisions: string[];
  timeWindow: { start: number; end: number };
  
  // Description
  description: string;
  possibleCauses?: string[];
  recommendedActions?: string[];
}

/**
 * Compliance report
 */
export interface ComplianceReport {
  generatedAt: number;
  timeRange: { start: number; end: number };
  
  // Summary
  totalDecisions: number;
  decisionsWithAuditTrail: number;
  decisionsWithOutcomes: number;
  complianceRate: number;  // % with complete audit trail
  
  // Policy compliance
  policyAdherence: {
    totalWithPolicy: number;
    policySuccessRate: number;
    exceptionsRate: number;
    topPolicies: Array<{ id: string; version: string; count: number }>;
  };
  
  // Approval tracking
  approvalTracking: {
    decisionsRequiringApproval: number;
    approved: number;
    rejected: number;
    pending: number;
  };
  
  // Quality assurance
  qualityMetrics: {
    averageQualityScore: number;
    decisionsBelowThreshold: number;
    topIssues: string[];
  };
  
  // Anomalies
  anomaliesDetected: number;
  criticalAnomalies: number;
  
  // Recommendations
  recommendations: string[];
}

/**
 * Dashboard-friendly metrics summary
 */
export interface MetricsSummary {
  // Current period
  current: {
    totalDecisions: number;
    averageQualityScore: number;
    successRate: number;
    exceptionRate: number;
    anomaliesDetected: number;
  };
  
  // Comparison with previous period
  comparison: {
    decisionsChange: number;  // % change
    qualityChange: number;
    successRateChange: number;
    exceptionRateChange: number;
  };
  
  // Trends
  trends: {
    quality: 'improving' | 'stable' | 'degrading';
    volume: 'increasing' | 'stable' | 'decreasing';
    exceptions: 'increasing' | 'stable' | 'decreasing';
  };
  
  // Top insights
  insights: string[];
}

/**
 * ObservabilityMetrics manages decision quality and analytics
 */
export class ObservabilityMetrics extends ActorMemory {
  private decisionMemory?: DecisionMemory;
  private policyMemory?: PolicyMemory;
  private qualityThresholds: QualityThresholds;
  private anomalyConfig: AnomalyDetectionConfig;
  private baselineCache: Map<string, { mean: number; stdDev: number; samples: number }> = new Map();

  constructor(
    actorId: string,
    storage: MemoryStorage,
    lamportClock: LamportClock,
    options?: ObservabilityMetricsOptions
  ) {
    super(actorId, storage, lamportClock, options);
    this.decisionMemory = options?.decisionMemory;
    this.policyMemory = options?.policyMemory;
    
    // Default quality thresholds
    this.qualityThresholds = options?.qualityThresholds || {
      minSuccessRate: 0.7,
      maxExceptionRate: 0.2,
      minConfidence: 0.6
    };
    
    // Default anomaly detection config
    this.anomalyConfig = options?.anomalyDetection || {
      enabled: true,
      standardDeviations: 2,
      minSampleSize: 30
    };
  }

  /**
   * Calculate quality score for a decision
   */
  async calculateDecisionQuality(decisionId: string): Promise<DecisionQualityScore | null> {
    if (!this.decisionMemory) {
      throw new Error('DecisionMemory required for quality scoring');
    }

    const decision = await this.decisionMemory.getDecision(decisionId);
    if (!decision) {
      return null;
    }

    // Calculate component scores
    const outcomeScore = this.calculateOutcomeScore(decision);
    const confidenceScore = this.calculateConfidenceScore(decision);
    const policyAlignmentScore = this.calculatePolicyAlignmentScore(decision);
    const exceptionPenalty = decision.isException ? 0.2 : 0;

    // Overall score (weighted average)
    const overallScore = Math.max(0, Math.min(1,
      (outcomeScore * 0.4) +
      (confidenceScore * 0.2) +
      (policyAlignmentScore * 0.3) +
      (0.1) -  // Base score
      exceptionPenalty
    ));

    // Determine tier
    let tier: DecisionQualityScore['tier'];
    if (overallScore >= 0.8) tier = 'excellent';
    else if (overallScore >= 0.6) tier = 'good';
    else if (overallScore >= 0.4) tier = 'acceptable';
    else tier = 'poor';

    // Generate recommendations
    const recommendations: string[] = [];
    if (!decision.outcome) {
      recommendations.push('Track outcome to improve quality assessment');
    }
    if (!decision.policy) {
      recommendations.push('Use policy guidance for consistency');
    }
    if (decision.isException) {
      recommendations.push('Review exception reason and update policy if pattern emerges');
    }
    if (!decision.precedents || decision.precedents.length === 0) {
      recommendations.push('Search for similar precedents before deciding');
    }

    return {
      decisionId,
      overallScore,
      outcomeScore,
      confidenceScore,
      policyAlignmentScore,
      exceptionPenalty,
      factors: {
        hadPrecedents: (decision.precedents?.length || 0) > 0,
        usedPolicy: !!decision.policy,
        requiredException: decision.isException,
        hadOutcome: !!decision.outcome,
        outcomeCorrect: decision.outcome?.wasCorrect
      },
      tier,
      recommendations: recommendations.length > 0 ? recommendations : undefined
    };
  }

  /**
   * Calculate outcome score component
   */
  private calculateOutcomeScore(decision: DecisionTrace): number {
    if (!decision.outcome) {
      return 0.5;  // Neutral if no outcome yet
    }
    return decision.outcome.wasCorrect ? 1.0 : 0.0;
  }

  /**
   * Calculate confidence score component
   */
  private calculateConfidenceScore(decision: DecisionTrace): number {
    // Look for confidence in decision object or metadata
    const confidence = (decision.outcome as any)?.confidence || 
                      (decision as any).confidence || 
                      0.7;  // Default moderate confidence
    
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Calculate policy alignment score component
   */
  private calculatePolicyAlignmentScore(decision: DecisionTrace): number {
    if (!decision.policy) {
      return 0.5;  // Neutral if no policy used
    }
    
    // Higher score if policy was followed without exception
    if (decision.isException) {
      return 0.6;  // Followed policy but needed exception
    }
    
    return 1.0;  // Followed policy successfully
  }

  /**
   * Get time-series metrics aggregated into buckets
   */
  async getTimeSeriesMetrics(
    startTime: number,
    endTime: number,
    bucketSize: number = 3600000  // Default: 1 hour buckets
  ): Promise<MetricsBucket[]> {
    if (!this.decisionMemory) {
      throw new Error('DecisionMemory required for metrics');
    }

    const allDecisions = await this.decisionMemory.getAllDecisions(10000);
    const decisions = allDecisions.filter(d => 
      d.timestamp >= startTime && d.timestamp < endTime
    );

    // Create buckets
    const buckets: Map<number, DecisionTrace[]> = new Map();
    for (const decision of decisions) {
      const bucketStart = Math.floor(decision.timestamp / bucketSize) * bucketSize;
      if (!buckets.has(bucketStart)) {
        buckets.set(bucketStart, []);
      }
      buckets.get(bucketStart)!.push(decision);
    }

    // Calculate metrics for each bucket
    const metricsBuckets: MetricsBucket[] = [];
    const sortedBucketStarts = Array.from(buckets.keys()).sort((a, b) => a - b);

    for (let i = 0; i < sortedBucketStarts.length; i++) {
      const bucketStart = sortedBucketStarts[i];
      const bucketDecisions = buckets.get(bucketStart)!;

      // Calculate quality scores
      const qualityScores = await Promise.all(
        bucketDecisions.map(d => this.calculateDecisionQuality(d.decisionId))
      );
      const validScores = qualityScores.filter(s => s !== null) as DecisionQualityScore[];
      
      const averageQualityScore = validScores.length > 0
        ? validScores.reduce((sum, s) => sum + s.overallScore, 0) / validScores.length
        : 0;

      // Calculate success rate
      const decisionsWithOutcome = bucketDecisions.filter(d => d.outcome);
      const successRate = decisionsWithOutcome.length > 0
        ? decisionsWithOutcome.filter(d => d.outcome?.wasCorrect).length / decisionsWithOutcome.length
        : 0;

      // Calculate exception rate
      const exceptionRate = bucketDecisions.filter(d => d.isException).length / bucketDecisions.length;

      // Group by type
      const decisionsByType: Record<string, number> = {};
      for (const decision of bucketDecisions) {
        decisionsByType[decision.decisionType] = (decisionsByType[decision.decisionType] || 0) + 1;
      }

      // Policy metrics
      const decisionsWithPolicy = bucketDecisions.filter(d => d.policy);
      const policySuccessRate = decisionsWithPolicy.length > 0
        ? decisionsWithPolicy.filter(d => d.outcome?.wasCorrect).length / decisionsWithPolicy.length
        : 0;

      // Determine trend
      let trend: MetricsBucket['trend'] = 'stable';
      let trendConfidence = 0.5;
      
      if (i > 0 && validScores.length > 0) {
        const prevBucket = metricsBuckets[i - 1];
        const qualityDiff = averageQualityScore - prevBucket.averageQualityScore;
        
        if (qualityDiff > 0.05) {
          trend = 'improving';
          trendConfidence = Math.min(1, Math.abs(qualityDiff) * 10);
        } else if (qualityDiff < -0.05) {
          trend = 'degrading';
          trendConfidence = Math.min(1, Math.abs(qualityDiff) * 10);
        }
      }

      metricsBuckets.push({
        timestamp: bucketStart,
        duration: bucketSize,
        totalDecisions: bucketDecisions.length,
        decisionsByType,
        averageQualityScore,
        successRate,
        exceptionRate,
        policiesUsed: decisionsWithPolicy.length,
        policySuccessRate,
        trend,
        trendConfidence
      });
    }

    return metricsBuckets;
  }

  /**
   * Analyze trends for a specific metric
   */
  async analyzeTrend(
    metric: 'quality' | 'successRate' | 'exceptionRate' | 'volume',
    startTime: number,
    endTime: number,
    bucketSize: number = 3600000
  ): Promise<TrendAnalysis> {
    const buckets = await this.getTimeSeriesMetrics(startTime, endTime, bucketSize);
    
    if (buckets.length < 2) {
      return {
        metric,
        timeRange: { start: startTime, end: endTime },
        direction: 'stable',
        confidence: 0,
        slope: 0,
        rSquared: 0,
        samples: [],
        summary: 'Insufficient data for trend analysis'
      };
    }

    // Extract values based on metric
    const samples = buckets.map(b => ({
      timestamp: b.timestamp,
      value: metric === 'quality' ? b.averageQualityScore :
             metric === 'successRate' ? b.successRate :
             metric === 'exceptionRate' ? b.exceptionRate :
             b.totalDecisions
    }));

    // Calculate linear regression
    const { slope, rSquared } = this.calculateLinearRegression(samples);

    // Determine direction and confidence
    let direction: TrendAnalysis['direction'];
    let confidence: number;

    if (Math.abs(slope) < 0.001) {
      direction = 'stable';
      confidence = Math.min(1, rSquared);
    } else if (slope > 0) {
      direction = metric === 'exceptionRate' ? 'degrading' : 'improving';
      confidence = Math.min(1, rSquared * Math.abs(slope) * 100);
    } else {
      direction = metric === 'exceptionRate' ? 'improving' : 'degrading';
      confidence = Math.min(1, rSquared * Math.abs(slope) * 100);
    }

    // Generate summary and recommendation
    const metricName = metric === 'quality' ? 'Decision Quality' :
                      metric === 'successRate' ? 'Success Rate' :
                      metric === 'exceptionRate' ? 'Exception Rate' : 'Decision Volume';
    
    const summary = `${metricName} is ${direction} over the time period (${buckets.length} samples, R²=${rSquared.toFixed(2)})`;
    
    let recommendation: string | undefined;
    if (direction === 'degrading' && confidence > 0.6) {
      recommendation = metric === 'quality' ? 'Review recent decisions and policies for quality issues' :
                      metric === 'successRate' ? 'Investigate causes of decreased success rate' :
                      metric === 'exceptionRate' ? 'Review policy effectiveness and update rules' :
                      'Monitor for capacity or performance issues';
    }

    return {
      metric,
      timeRange: { start: startTime, end: endTime },
      direction,
      confidence,
      slope,
      rSquared,
      samples,
      summary,
      recommendation
    };
  }

  /**
   * Calculate linear regression for trend analysis
   */
  private calculateLinearRegression(samples: Array<{ timestamp: number; value: number }>): {
    slope: number;
    rSquared: number;
  } {
    const n = samples.length;
    if (n < 2) {
      return { slope: 0, rSquared: 0 };
    }

    // Normalize timestamps to x-coordinates (0, 1, 2, ...)
    const xValues = samples.map((_, i) => i);
    const yValues = samples.map(s => s.value);

    // Calculate means
    const xMean = xValues.reduce((sum, x) => sum + x, 0) / n;
    const yMean = yValues.reduce((sum, y) => sum + y, 0) / n;

    // Calculate slope
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (xValues[i] - xMean) * (yValues[i] - yMean);
      denominator += Math.pow(xValues[i] - xMean, 2);
    }
    const slope = denominator !== 0 ? numerator / denominator : 0;

    // Calculate R-squared
    const yPredicted = xValues.map(x => slope * (x - xMean) + yMean);
    const ssRes = yValues.reduce((sum, y, i) => sum + Math.pow(y - yPredicted[i], 2), 0);
    const ssTot = yValues.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
    const rSquared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;

    return { slope, rSquared };
  }

  /**
   * Detect anomalies in decision metrics
   */
  async detectAnomalies(
    startTime: number,
    endTime: number,
    bucketSize: number = 3600000
  ): Promise<Anomaly[]> {
    if (!this.anomalyConfig.enabled) {
      return [];
    }

    const buckets = await this.getTimeSeriesMetrics(startTime, endTime, bucketSize);
    
    if (buckets.length < this.anomalyConfig.minSampleSize) {
      return [];  // Not enough data for baseline
    }

    const anomalies: Anomaly[] = [];

    // Check each metric for anomalies
    const metrics = [
      { name: 'quality', values: buckets.map(b => b.averageQualityScore) },
      { name: 'successRate', values: buckets.map(b => b.successRate) },
      { name: 'exceptionRate', values: buckets.map(b => b.exceptionRate) },
      { name: 'volume', values: buckets.map(b => b.totalDecisions) }
    ];

    for (const { name, values } of metrics) {
      const baseline = this.calculateBaseline(values);
      this.baselineCache.set(name, baseline);

      // Check recent values against baseline
      const recentCount = Math.min(5, Math.floor(values.length * 0.1));
      const recentValues = values.slice(-recentCount);

      for (let i = 0; i < recentValues.length; i++) {
        const value = recentValues[i];
        const deviation = Math.abs(value - baseline.mean) / baseline.stdDev;

        if (deviation > this.anomalyConfig.standardDeviations) {
          const bucketIndex = values.length - recentCount + i;
          const bucket = buckets[bucketIndex];

          anomalies.push({
            id: `anomaly_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            detectedAt: Date.now(),
            metric: name,
            actualValue: value,
            expectedValue: baseline.mean,
            deviation,
            severity: deviation > 3 ? 'critical' : deviation > 2.5 ? 'warning' : 'info',
            affectedDecisions: [],  // Could be populated if needed
            timeWindow: {
              start: bucket.timestamp,
              end: bucket.timestamp + bucket.duration
            },
            description: `${name} anomaly detected: ${value.toFixed(2)} vs expected ${baseline.mean.toFixed(2)} (${deviation.toFixed(1)}σ)`,
            possibleCauses: this.generatePossibleCauses(name, value, baseline.mean),
            recommendedActions: this.generateRecommendedActions(name, value, baseline.mean)
          });
        }
      }
    }

    return anomalies;
  }

  /**
   * Calculate statistical baseline
   */
  private calculateBaseline(values: number[]): { mean: number; stdDev: number; samples: number } {
    const n = values.length;
    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    return { mean, stdDev, samples: n };
  }

  /**
   * Generate possible causes for anomaly
   */
  private generatePossibleCauses(metric: string, actual: number, expected: number): string[] {
    const causes: string[] = [];
    const isHigher = actual > expected;

    if (metric === 'quality') {
      if (!isHigher) {
        causes.push('Policy changes without adequate testing');
        causes.push('Increased complexity in decision scenarios');
        causes.push('Reduced precedent availability');
      }
    } else if (metric === 'successRate') {
      if (!isHigher) {
        causes.push('Policy misalignment with actual scenarios');
        causes.push('Environmental changes affecting outcomes');
        causes.push('Data quality issues');
      }
    } else if (metric === 'exceptionRate') {
      if (isHigher) {
        causes.push('Policy rules too strict for current scenarios');
        causes.push('Unusual cases requiring manual review');
        causes.push('System or data changes');
      }
    } else if (metric === 'volume') {
      if (isHigher) {
        causes.push('Increased traffic or load');
        causes.push('New use cases or integrations');
      } else {
        causes.push('Service degradation or outages');
        causes.push('Upstream system issues');
      }
    }

    return causes;
  }

  /**
   * Generate recommended actions for anomaly
   */
  private generateRecommendedActions(metric: string, actual: number, expected: number): string[] {
    const actions: string[] = [];
    const isHigher = actual > expected;

    if (metric === 'quality' || metric === 'successRate') {
      if (!isHigher) {
        actions.push('Review recent policy changes');
        actions.push('Analyze failed decisions for patterns');
        actions.push('Consider A/B testing policy adjustments');
      }
    } else if (metric === 'exceptionRate') {
      if (isHigher) {
        actions.push('Review exception reasons');
        actions.push('Update policies to handle common exceptions');
        actions.push('Generate policy suggestions from patterns');
      }
    } else if (metric === 'volume') {
      if (isHigher) {
        actions.push('Monitor system resources');
        actions.push('Review capacity planning');
      } else {
        actions.push('Check upstream systems');
        actions.push('Review monitoring and alerting');
      }
    }

    actions.push('Continue monitoring for sustained pattern');

    return actions;
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(
    startTime: number,
    endTime: number
  ): Promise<ComplianceReport> {
    if (!this.decisionMemory) {
      throw new Error('DecisionMemory required for compliance reports');
    }

    const allDecisions = await this.decisionMemory.getAllDecisions(10000);
    const decisions = allDecisions.filter(d => 
      d.timestamp >= startTime && d.timestamp <= endTime
    );

    // Summary metrics
    const totalDecisions = decisions.length;
    const decisionsWithAuditTrail = decisions.filter(d => 
      d.rationale && d.reasoning
    ).length;
    const decisionsWithOutcomes = decisions.filter(d => d.outcome).length;
    const complianceRate = totalDecisions > 0 
      ? decisionsWithAuditTrail / totalDecisions 
      : 0;

    // Policy compliance
    const decisionsWithPolicy = decisions.filter(d => d.policy);
    const policySuccessful = decisionsWithPolicy.filter(d => 
      d.outcome?.wasCorrect
    ).length;
    const exceptions = decisions.filter(d => d.isException).length;

    const policyCount = new Map<string, number>();
    for (const decision of decisionsWithPolicy) {
      const key = `${decision.policy!.id}:${decision.policy!.version}`;
      policyCount.set(key, (policyCount.get(key) || 0) + 1);
    }
    const topPolicies = Array.from(policyCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => {
        const [id, version] = key.split(':');
        return { id, version, count };
      });

    // Approval tracking
    const decisionsWithApprovers = decisions.filter(d => d.approvers && d.approvers.length > 0);
    const approved = decisionsWithApprovers.filter(d =>
      d.approvers!.every(a => a.approvedAt)
    ).length;

    // Quality metrics
    const qualityScores = await Promise.all(
      decisions.map(d => this.calculateDecisionQuality(d.decisionId))
    );
    const validScores = qualityScores.filter(s => s !== null) as DecisionQualityScore[];
    const averageQualityScore = validScores.length > 0
      ? validScores.reduce((sum, s) => sum + s.overallScore, 0) / validScores.length
      : 0;
    const poorQuality = validScores.filter(s => s.tier === 'poor').length;

    // Top issues
    const topIssues: string[] = [];
    if (decisionsWithAuditTrail < totalDecisions * 0.9) {
      topIssues.push(`${totalDecisions - decisionsWithAuditTrail} decisions lack complete audit trail`);
    }
    if (poorQuality > totalDecisions * 0.1) {
      topIssues.push(`${poorQuality} decisions have poor quality scores`);
    }
    if (exceptions > totalDecisions * 0.2) {
      topIssues.push(`High exception rate: ${(exceptions / totalDecisions * 100).toFixed(1)}%`);
    }

    // Anomalies
    const anomalies = await this.detectAnomalies(startTime, endTime);
    const criticalAnomalies = anomalies.filter(a => a.severity === 'critical').length;

    // Recommendations
    const recommendations: string[] = [];
    if (complianceRate < 0.95) {
      recommendations.push('Improve audit trail completeness by ensuring all decisions include rationale and reasoning');
    }
    if (decisionsWithOutcomes < totalDecisions * 0.8) {
      recommendations.push('Track outcomes for more decisions to enable better quality assessment');
    }
    if (poorQuality > totalDecisions * 0.1) {
      recommendations.push('Review and improve decision quality - focus on precedent usage and policy alignment');
    }
    if (criticalAnomalies > 0) {
      recommendations.push(`Investigate ${criticalAnomalies} critical anomalies detected during this period`);
    }

    return {
      generatedAt: Date.now(),
      timeRange: { start: startTime, end: endTime },
      totalDecisions,
      decisionsWithAuditTrail,
      decisionsWithOutcomes,
      complianceRate,
      policyAdherence: {
        totalWithPolicy: decisionsWithPolicy.length,
        policySuccessRate: decisionsWithPolicy.length > 0 
          ? policySuccessful / decisionsWithPolicy.length 
          : 0,
        exceptionsRate: totalDecisions > 0 ? exceptions / totalDecisions : 0,
        topPolicies
      },
      approvalTracking: {
        decisionsRequiringApproval: decisionsWithApprovers.length,
        approved,
        rejected: 0,  // Would need rejected status tracking
        pending: decisionsWithApprovers.length - approved
      },
      qualityMetrics: {
        averageQualityScore,
        decisionsBelowThreshold: poorQuality,
        topIssues
      },
      anomaliesDetected: anomalies.length,
      criticalAnomalies,
      recommendations
    };
  }

  /**
   * Get dashboard-friendly metrics summary
   */
  async getMetricsSummary(
    currentStart: number,
    currentEnd: number,
    previousStart: number,
    previousEnd: number
  ): Promise<MetricsSummary> {
    if (!this.decisionMemory) {
      throw new Error('DecisionMemory required for metrics summary');
    }

    // Get decisions for both periods
    const allDecisions = await this.decisionMemory.getAllDecisions(10000);
    const currentDecisions = allDecisions.filter(d => 
      d.timestamp >= currentStart && d.timestamp <= currentEnd
    );
    const previousDecisions = allDecisions.filter(d => 
      d.timestamp >= previousStart && d.timestamp <= previousEnd
    );

    // Calculate current metrics
    const currentQualityScores = await Promise.all(
      currentDecisions.map(d => this.calculateDecisionQuality(d.decisionId))
    );
    const validCurrentScores = currentQualityScores.filter(s => s !== null) as DecisionQualityScore[];
    
    const currentQuality = validCurrentScores.length > 0
      ? validCurrentScores.reduce((sum, s) => sum + s.overallScore, 0) / validCurrentScores.length
      : 0;
    
    const currentSuccessRate = currentDecisions.filter(d => d.outcome).length > 0
      ? currentDecisions.filter(d => d.outcome?.wasCorrect).length / currentDecisions.filter(d => d.outcome).length
      : 0;
    
    const currentExceptionRate = currentDecisions.length > 0
      ? currentDecisions.filter(d => d.isException).length / currentDecisions.length
      : 0;

    // Calculate previous metrics
    const previousQualityScores = await Promise.all(
      previousDecisions.map(d => this.calculateDecisionQuality(d.decisionId))
    );
    const validPreviousScores = previousQualityScores.filter(s => s !== null) as DecisionQualityScore[];
    
    const previousQuality = validPreviousScores.length > 0
      ? validPreviousScores.reduce((sum, s) => sum + s.overallScore, 0) / validPreviousScores.length
      : 0;
    
    const previousSuccessRate = previousDecisions.filter(d => d.outcome).length > 0
      ? previousDecisions.filter(d => d.outcome?.wasCorrect).length / previousDecisions.filter(d => d.outcome).length
      : 0;
    
    const previousExceptionRate = previousDecisions.length > 0
      ? previousDecisions.filter(d => d.isException).length / previousDecisions.length
      : 0;

    // Calculate changes (percentage)
    const decisionsChange = previousDecisions.length > 0
      ? ((currentDecisions.length - previousDecisions.length) / previousDecisions.length) * 100
      : 0;
    
    const qualityChange = previousQuality > 0
      ? ((currentQuality - previousQuality) / previousQuality) * 100
      : 0;
    
    const successRateChange = previousSuccessRate > 0
      ? ((currentSuccessRate - previousSuccessRate) / previousSuccessRate) * 100
      : 0;
    
    const exceptionRateChange = previousExceptionRate > 0
      ? ((currentExceptionRate - previousExceptionRate) / previousExceptionRate) * 100
      : 0;

    // Determine trends
    const qualityTrend = Math.abs(qualityChange) < 5 ? 'stable' : 
                        qualityChange > 0 ? 'improving' : 'degrading';
    
    const volumeTrend = Math.abs(decisionsChange) < 10 ? 'stable' :
                       decisionsChange > 0 ? 'increasing' : 'decreasing';
    
    const exceptionsTrend = Math.abs(exceptionRateChange) < 10 ? 'stable' :
                           exceptionRateChange > 0 ? 'increasing' : 'decreasing';

    // Detect anomalies
    const anomalies = await this.detectAnomalies(currentStart, currentEnd);

    // Generate insights
    const insights: string[] = [];
    if (qualityTrend === 'improving') {
      insights.push(`Decision quality improved by ${Math.abs(qualityChange).toFixed(1)}%`);
    } else if (qualityTrend === 'degrading') {
      insights.push(`⚠️ Decision quality decreased by ${Math.abs(qualityChange).toFixed(1)}%`);
    }
    
    if (volumeTrend === 'increasing' && decisionsChange > 20) {
      insights.push(`Decision volume increased by ${decisionsChange.toFixed(1)}%`);
    }
    
    if (exceptionsTrend === 'increasing' && exceptionRateChange > 20) {
      insights.push(`⚠️ Exception rate increased by ${Math.abs(exceptionRateChange).toFixed(1)}%`);
    }
    
    if (anomalies.length > 0) {
      const critical = anomalies.filter(a => a.severity === 'critical').length;
      if (critical > 0) {
        insights.push(`🚨 ${critical} critical anomalies detected`);
      } else {
        insights.push(`${anomalies.length} anomalies detected`);
      }
    }

    if (currentQuality > 0.8) {
      insights.push('✓ Overall decision quality is excellent');
    }

    return {
      current: {
        totalDecisions: currentDecisions.length,
        averageQualityScore: currentQuality,
        successRate: currentSuccessRate,
        exceptionRate: currentExceptionRate,
        anomaliesDetected: anomalies.length
      },
      comparison: {
        decisionsChange,
        qualityChange,
        successRateChange,
        exceptionRateChange
      },
      trends: {
        quality: qualityTrend,
        volume: volumeTrend,
        exceptions: exceptionsTrend
      },
      insights
    };
  }
}
