/**
 * Tests for AIAnalytics - Advanced AI-powered decision intelligence
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AIAnalytics } from '../../../src/memory/graph/ai-analytics';
import { DecisionMemory } from '../../../src/memory/graph/decision-memory';
import { PolicyMemory } from '../../../src/memory/graph/policy-memory';
import { ObservabilityMetrics } from '../../../src/memory/graph/observability-metrics';
import { InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage';
import { LamportClock } from '../../../src/timing/lamport-clock';
import type { DecisionTrace } from '../../../src/actor/decision-trace';
import type { Policy } from '../../../src/memory/graph/policy-memory';

describe('AIAnalytics', () => {
  let storage: InMemoryGraphStorage;
  let clock: LamportClock;
  let decisionMemory: DecisionMemory;
  let policyMemory: PolicyMemory;
  let observabilityMetrics: ObservabilityMetrics;
  let aiAnalytics: AIAnalytics;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    clock = new LamportClock();
    decisionMemory = new DecisionMemory('test-actor', storage, clock);
    policyMemory = new PolicyMemory('test-actor', storage, clock, { decisionMemory });
    observabilityMetrics = new ObservabilityMetrics('test-actor', storage, clock, {
      decisionMemory,
      policyMemory
    });
    
    aiAnalytics = new AIAnalytics('test-actor', storage, clock, {
      decisionMemory,
      policyMemory,
      observabilityMetrics,
      llmConfig: {
        enabled: false  // Disable LLM for tests
      },
      predictionConfig: {
        minTrainingData: 20,
        confidenceThreshold: 0.6,
        updateFrequency: 3600000
      }
    });
  });

  describe('Natural Language Explanations', () => {
    it('should generate explanation for successful decision with policy', async () => {
      const decision: DecisionTrace = {
        decisionId: 'decision-1',
        actorId: 'test-actor',
        timestamp: Date.now(),
        decisionType: 'approval',
        decision: { action: 'approve', amount: 1000 },
        context: { userId: 'user1', amount: 1000 },
        rationale: 'Approved based on policy',
        reasoning: ['Amount within limits', 'User has good history'],
        policy: { id: 'policy-1', version: '1.0', rules: [] },
        precedents: [
          { decisionId: 'prev-1', similarity: 0.9, outcome: { wasCorrect: true, verifiedAt: Date.now() } }
        ],
        outcome: { wasCorrect: true, verifiedAt: Date.now() },
        isException: false
      };

      await decisionMemory.addDecisionTrace(decision);
      const explanation = await aiAnalytics.explainDecision('decision-1');

      expect(explanation.decisionId).toBe('decision-1');
      expect(explanation.summary).toContain('approval decision');
      expect(explanation.summary).toContain('policy-1');
      expect(explanation.detailedExplanation).toContain('policy-1');
      expect(explanation.detailedExplanation).toContain('1 similar precedents');
      expect(explanation.keyFactors.length).toBeGreaterThan(0);
      expect(explanation.keyFactors).toContain('Policy: policy-1 v1.0');
      expect(explanation.reasoning).toEqual(decision.reasoning);
      expect(explanation.confidence).toBeGreaterThan(0.5);
    });

    it('should explain decision requiring exception', async () => {
      const decision: DecisionTrace = {
        decisionId: 'decision-2',
        actorId: 'test-actor',
        timestamp: Date.now(),
        decisionType: 'exception',
        decision: { action: 'approve', amount: 10000 },
        context: { userId: 'user2' },
        rationale: 'Exception granted for special case',
        reasoning: ['Amount exceeds normal limits', 'Approved by manager'],
        isException: true,
        approvers: [
          { actorId: 'manager-1', approvedAt: Date.now(), reasoning: 'Special case approved' }
        ],
        outcome: { wasCorrect: true, verifiedAt: Date.now() }
      };

      await decisionMemory.addDecisionTrace(decision);
      const explanation = await aiAnalytics.explainDecision('decision-2');

      expect(explanation.summary).toContain('exception');
      expect(explanation.detailedExplanation).toContain('policy exception');
      expect(explanation.keyFactors).toContain('Required policy exception');
      expect(explanation.keyFactors).toContain('Approved by 1 approver(s)');
      expect(explanation.alternatives).toBeDefined();
      expect(explanation.alternatives).toContain('Update policy to handle this case without exception');
    });

    it('should generate alternatives for sub-optimal decisions', async () => {
      const decision: DecisionTrace = {
        decisionId: 'decision-3',
        actorId: 'test-actor',
        timestamp: Date.now(),
        decisionType: 'approval',
        decision: { action: 'approve' },
        context: {},
        rationale: 'Quick approval',
        reasoning: [],
        isException: false
      };

      await decisionMemory.addDecisionTrace(decision);
      const explanation = await aiAnalytics.explainDecision('decision-3');

      expect(explanation.alternatives).toBeDefined();
      expect(explanation.alternatives!.length).toBeGreaterThan(0);
      expect(explanation.alternatives).toContain('Use an existing policy for consistency');
      expect(explanation.alternatives).toContain('Search for similar precedents before deciding');
    });
  });

  describe('Predictive Policy Effectiveness', () => {
    it('should predict policy effectiveness based on historical data', async () => {
      // Create policy
      const policy: Policy = {
        id: 'policy-1',
        version: '1.0',
        name: 'Test Policy',
        rules: [],
        createdAt: Date.now(),
        isActive: true
      };
      await policyMemory.addPolicy(policy);

      // Create 30 decisions with 80% success rate
      for (let i = 0; i < 30; i++) {
        await decisionMemory.addDecisionTrace({
          decisionId: `decision-${i}`,
          actorId: 'test-actor',
          timestamp: Date.now() - (i * 60000),
          decisionType: 'approval',
          decision: { action: 'approve' },
          context: {},
          rationale: 'Decision',
          reasoning: [],
          policy: { id: 'policy-1', version: '1.0', rules: [] },
          outcome: { wasCorrect: i < 24, verifiedAt: Date.now() },  // 80% success
          isException: false
        });
      }

      const prediction = await aiAnalytics.predictPolicyEffectiveness('policy-1', '1.0');

      expect(prediction.policyId).toBe('policy-1');
      expect(prediction.policyVersion).toBe('1.0');
      expect(prediction.predictedSuccessRate).toBeGreaterThan(0.7);
      expect(prediction.predictedSuccessRate).toBeLessThanOrEqual(1);
      expect(prediction.predictedQualityScore).toBeGreaterThan(0);
      expect(prediction.confidence).toBeGreaterThan(0.5);
      expect(prediction.basedOnSamples).toBe(30);
      expect(prediction.strengths.length).toBeGreaterThan(0);
    });

    it('should have low confidence with insufficient data', async () => {
      const policy: Policy = {
        id: 'policy-2',
        version: '1.0',
        name: 'New Policy',
        rules: [],
        createdAt: Date.now(),
        isActive: true
      };
      await policyMemory.addPolicy(policy);

      // Only 5 decisions
      for (let i = 0; i < 5; i++) {
        await decisionMemory.addDecisionTrace({
          decisionId: `decision-${i}`,
          actorId: 'test-actor',
          timestamp: Date.now(),
          decisionType: 'approval',
          decision: { action: 'approve' },
          context: {},
          rationale: 'Decision',
          reasoning: [],
          policy: { id: 'policy-2', version: '1.0', rules: [] },
          outcome: { wasCorrect: true, verifiedAt: Date.now() },
          isException: false
        });
      }

      const prediction = await aiAnalytics.predictPolicyEffectiveness('policy-2', '1.0');

      expect(prediction.confidence).toBeLessThan(0.5);
      expect(prediction.weaknesses).toContain('Limited training data (5 decisions)');
      expect(prediction.recommendations).toContain('Collect more decision data for better predictions');
    });

    it('should identify weaknesses in high-exception policies', async () => {
      const policy: Policy = {
        id: 'policy-3',
        version: '1.0',
        name: 'Strict Policy',
        rules: [],
        createdAt: Date.now(),
        isActive: true
      };
      await policyMemory.addPolicy(policy);

      // 25 decisions with 40% requiring exceptions
      for (let i = 0; i < 25; i++) {
        await decisionMemory.addDecisionTrace({
          decisionId: `decision-${i}`,
          actorId: 'test-actor',
          timestamp: Date.now(),
          decisionType: i < 10 ? 'exception' : 'approval',
          decision: { action: 'approve' },
          context: {},
          rationale: 'Decision',
          reasoning: [],
          policy: { id: 'policy-3', version: '1.0', rules: [] },
          outcome: { wasCorrect: true, verifiedAt: Date.now() },
          isException: i < 10
        });
      }

      const prediction = await aiAnalytics.predictPolicyEffectiveness('policy-3', '1.0');

      expect(prediction.predictedExceptionRate).toBeGreaterThan(0.3);
      expect(prediction.weaknesses.some(w => w.includes('exception rate'))).toBe(true);
      expect(prediction.recommendations.some(r => r.includes('exception'))).toBe(true);
    });
  });

  describe('Automated Policy Generation', () => {
    it('should generate policy suggestions from successful patterns', async () => {
      // Create 30 successful approval decisions
      for (let i = 0; i < 30; i++) {
        await decisionMemory.addDecisionTrace({
          decisionId: `approval-${i}`,
          actorId: 'test-actor',
          timestamp: Date.now() - (i * 60000),
          decisionType: 'approval',
          decision: { action: 'approve', amount: 1000 },
          context: { amount: 1000 },
          rationale: 'Standard approval',
          reasoning: ['Within limits'],
          precedents: [{ decisionId: `prev-${i}`, similarity: 0.8 }],
          outcome: { wasCorrect: true, verifiedAt: Date.now() },
          isException: false
        });
      }

      const suggestions = await aiAnalytics.generatePolicySuggestions(20, 0.8);

      expect(suggestions.length).toBeGreaterThan(0);
      const topSuggestion = suggestions[0];
      expect(topSuggestion.name).toContain('approval');
      expect(topSuggestion.rules.length).toBeGreaterThan(0);
      expect(topSuggestion.successRate).toBeGreaterThan(0.8);
      expect(topSuggestion.sampleSize).toBeGreaterThanOrEqual(20);
      expect(topSuggestion.confidence).toBeGreaterThan(0);
      expect(topSuggestion.rationale).toBeDefined();
      expect(topSuggestion.expectedImpact).toBeDefined();
    });

    it('should not suggest policies with insufficient data', async () => {
      // Only 10 decisions
      for (let i = 0; i < 10; i++) {
        await decisionMemory.addDecisionTrace({
          decisionId: `decision-${i}`,
          actorId: 'test-actor',
          timestamp: Date.now(),
          decisionType: 'approval',
          decision: { action: 'approve' },
          context: {},
          rationale: 'Approval',
          reasoning: [],
          outcome: { wasCorrect: true, verifiedAt: Date.now() },
          isException: false
        });
      }

      const suggestions = await aiAnalytics.generatePolicySuggestions(20, 0.8);

      expect(suggestions.length).toBe(0);  // Not enough samples
    });

    it('should include precedent rules in suggestions', async () => {
      // 25 decisions with precedents
      for (let i = 0; i < 25; i++) {
        await decisionMemory.addDecisionTrace({
          decisionId: `decision-${i}`,
          actorId: 'test-actor',
          timestamp: Date.now(),
          decisionType: 'approval',
          decision: { action: 'approve' },
          context: {},
          rationale: 'Approval',
          reasoning: [],
          precedents: [
            { decisionId: `prev-${i}`, similarity: 0.9 }
          ],
          outcome: { wasCorrect: true, verifiedAt: Date.now() },
          isException: false
        });
      }

      const suggestions = await aiAnalytics.generatePolicySuggestions(20, 0.8);

      expect(suggestions.length).toBeGreaterThan(0);
      const suggestion = suggestions[0];
      const precedentRule = suggestion.rules.find(r => r.condition.includes('precedent'));
      expect(precedentRule).toBeDefined();
      expect(precedentRule!.confidence).toBeGreaterThan(0.6);
    });
  });

  describe('Causal Inference', () => {
    it('should detect positive correlation between policy usage and success', async () => {
      // 40 decisions: 20 with policy (90% success), 20 without (50% success)
      for (let i = 0; i < 40; i++) {
        const hasPolicy = i < 20;
        const isSuccessful = hasPolicy ? (i < 18) : (i < 30);
        
        await decisionMemory.addDecisionTrace({
          decisionId: `decision-${i}`,
          actorId: 'test-actor',
          timestamp: Date.now(),
          decisionType: 'approval',
          decision: { action: 'approve' },
          context: {},
          rationale: 'Decision',
          reasoning: [],
          policy: hasPolicy ? { id: 'policy-1', version: '1.0', rules: [] } : undefined,
          outcome: { wasCorrect: isSuccessful, verifiedAt: Date.now() },
          isException: false
        });
      }

      const relationship = await aiAnalytics.analyzeCausalRelationships('has_policy', 'success', 30);

      expect(relationship).toBeDefined();
      expect(relationship!.cause).toBe('has_policy');
      expect(relationship!.effect).toBe('success');
      expect(relationship!.direction).toBe('positive');
      expect(relationship!.strength).toBeGreaterThan(0);
      expect(relationship!.observations).toBe(40);
      expect(relationship!.mechanism).toContain('policy');
      expect(relationship!.recommendation).toContain('encouraging');
    });

    it('should detect negative correlation between exceptions and success', async () => {
      // 40 decisions: 20 exceptions (40% success), 20 normal (80% success)
      for (let i = 0; i < 40; i++) {
        const isException = i < 20;
        const isSuccessful = isException ? (i < 8) : (i < 36);
        
        await decisionMemory.addDecisionTrace({
          decisionId: `decision-${i}`,
          actorId: 'test-actor',
          timestamp: Date.now(),
          decisionType: isException ? 'exception' : 'approval',
          decision: { action: 'approve' },
          context: {},
          rationale: 'Decision',
          reasoning: [],
          outcome: { wasCorrect: isSuccessful, verifiedAt: Date.now() },
          isException
        });
      }

      const relationship = await aiAnalytics.analyzeCausalRelationships('is_exception', 'success', 30);

      expect(relationship).toBeDefined();
      expect(relationship!.direction).toBe('negative');
      expect(relationship!.recommendation).toContain('reducing');
    });

    it('should return null with insufficient data', async () => {
      // Only 10 decisions
      for (let i = 0; i < 10; i++) {
        await decisionMemory.addDecisionTrace({
          decisionId: `decision-${i}`,
          actorId: 'test-actor',
          timestamp: Date.now(),
          decisionType: 'approval',
          decision: { action: 'approve' },
          context: {},
          rationale: 'Decision',
          reasoning: [],
          outcome: { wasCorrect: true, verifiedAt: Date.now() },
          isException: false
        });
      }

      const relationship = await aiAnalytics.analyzeCausalRelationships('has_policy', 'success', 30);

      expect(relationship).toBeNull();
    });

    it('should identify potential confounders', async () => {
      // Create decisions for causal analysis
      for (let i = 0; i < 40; i++) {
        await decisionMemory.addDecisionTrace({
          decisionId: `decision-${i}`,
          actorId: 'test-actor',
          timestamp: Date.now(),
          decisionType: 'approval',
          decision: { action: 'approve' },
          context: {},
          rationale: 'Decision',
          reasoning: [],
          policy: i < 20 ? { id: 'policy-1', version: '1.0', rules: [] } : undefined,
          precedents: i % 2 === 0 ? [{ decisionId: `prev-${i}`, similarity: 0.8 }] : undefined,
          outcome: { wasCorrect: i < 30, verifiedAt: Date.now() },
          isException: false
        });
      }

      const relationship = await aiAnalytics.analyzeCausalRelationships('has_policy', 'success', 30);

      expect(relationship).toBeDefined();
      expect(relationship!.confounders.length).toBeGreaterThan(0);
    });
  });

  describe('Decision Improvement Suggestions', () => {
    it('should suggest improvements for low-quality decisions', async () => {
      const decision: DecisionTrace = {
        decisionId: 'decision-poor',
        actorId: 'test-actor',
        timestamp: Date.now(),
        decisionType: 'approval',
        decision: { action: 'approve' },
        context: {},
        rationale: 'Quick decision',
        reasoning: [],
        isException: false
        // No policy, no precedents, no outcome
      };

      await decisionMemory.addDecisionTrace(decision);
      const improvements = await aiAnalytics.suggestDecisionImprovements('decision-poor');

      expect(improvements.decisionId).toBe('decision-poor');
      expect(improvements.currentQuality).toBeLessThan(0.7);
      expect(improvements.suggestions.length).toBeGreaterThan(0);
      
      const policySuggestion = improvements.suggestions.find(s => s.type === 'policy');
      expect(policySuggestion).toBeDefined();
      expect(policySuggestion!.expectedImpact).toBeGreaterThan(0);
      
      const precedentSuggestion = improvements.suggestions.find(s => s.type === 'precedent');
      expect(precedentSuggestion).toBeDefined();
      
      expect(improvements.analysis).toContain('quality');
      expect(improvements.prioritizedActions.length).toBeGreaterThan(0);
    });

    it('should have few suggestions for high-quality decisions', async () => {
      const decision: DecisionTrace = {
        decisionId: 'decision-good',
        actorId: 'test-actor',
        timestamp: Date.now(),
        decisionType: 'approval',
        decision: { action: 'approve' },
        context: {},
        rationale: 'Well-documented decision',
        reasoning: ['Clear rationale', 'Followed policy'],
        policy: { id: 'policy-1', version: '1.0', rules: [] },
        precedents: [{ decisionId: 'prev-1', similarity: 0.9 }],
        outcome: { wasCorrect: true, verifiedAt: Date.now() },
        isException: false
      };

      await decisionMemory.addDecisionTrace(decision);
      const improvements = await aiAnalytics.suggestDecisionImprovements('decision-good');

      expect(improvements.suggestions.length).toBeLessThan(2);
      expect(improvements.analysis).toContain('best practices');
    });

    it('should suggest approval for exceptions without approvers', async () => {
      const decision: DecisionTrace = {
        decisionId: 'decision-exception',
        actorId: 'test-actor',
        timestamp: Date.now(),
        decisionType: 'exception',
        decision: { action: 'approve' },
        context: {},
        rationale: 'Exception needed',
        reasoning: [],
        isException: true,
        outcome: { wasCorrect: true, verifiedAt: Date.now() }
        // No approvers
      };

      await decisionMemory.addDecisionTrace(decision);
      const improvements = await aiAnalytics.suggestDecisionImprovements('decision-exception');

      const approvalSuggestion = improvements.suggestions.find(s => s.type === 'approval');
      expect(approvalSuggestion).toBeDefined();
      expect(approvalSuggestion!.description).toContain('approval');
    });

    it('should prioritize high-impact low-effort suggestions', async () => {
      const decision: DecisionTrace = {
        decisionId: 'decision-multi',
        actorId: 'test-actor',
        timestamp: Date.now(),
        decisionType: 'approval',
        decision: { action: 'approve' },
        context: {},
        rationale: 'Decision',
        reasoning: [],
        isException: false
      };

      await decisionMemory.addDecisionTrace(decision);
      const improvements = await aiAnalytics.suggestDecisionImprovements('decision-multi');

      // First suggestion should be highest impact/effort ratio
      const first = improvements.suggestions[0];
      const prioritized = improvements.prioritizedActions;
      
      expect(prioritized.length).toBeGreaterThan(0);
      expect(prioritized[0]).toBe(first.description);
    });
  });
});
