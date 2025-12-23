/**
 * ReviewConsolidatorActor - Consolidates multiple agent reviews
 * 
 * This actor receives multiple reviews from different agents for the same
 * criterion and reconciles them into a single consolidated decision.
 */

import { Actor } from '../../../src/actor/actor';
import type { ActorContext } from '../../../src/actor/journal';
import { ReviewResult, ConsolidatedReview } from '../types';

export interface ConsolidatorInput {
  criterionId: string;
  reviews: ReviewResult[];
  requireConsensus: boolean;
}

export interface ConsolidatorState extends Record<string, unknown> {
  success: boolean;
  consolidatedReview?: ConsolidatedReview;
  error?: string;
}

export class ReviewConsolidatorActor extends Actor {
  constructor(context: ActorContext, initialState?: Record<string, unknown>) {
    super(context, initialState);
  }

  protected getDefaultState(): Record<string, unknown> {
    return {
      success: false,
    };
  }

  async execute(input: unknown): Promise<void> {
    const typedInput = input as ConsolidatorInput;
    try {
      console.log(
        `[${this.context.actorId}] Consolidating ${typedInput.reviews.length} reviews for criterion ${typedInput.criterionId}`
      );

      // Analyze review agreement
      const agreement = this.analyzeAgreement(typedInput.reviews);

      // Determine final evaluation
      const finalEvaluation = this.determineFinalEvaluation(
        typedInput.reviews,
        agreement,
        typedInput.requireConsensus
      );

      // Build consolidated reasoning
      const consolidatedReasoning = this.buildConsolidatedReasoning(
        typedInput.reviews,
        agreement
      );

      // Identify conflicts
      const conflictingOpinions = agreement.hasConflict
        ? this.identifyConflicts(typedInput.reviews)
        : undefined;

      // Generate recommendation
      const recommendedAction = this.generateRecommendation(
        finalEvaluation,
        agreement,
        typedInput.reviews
      );

      const consolidatedReview: ConsolidatedReview = {
        criterionId: typedInput.criterionId,
        finalEvaluation,
        consolidatedReasoning,
        agentAgreement: agreement.hasConsensus,
        conflictingOpinions,
        recommendedAction,
        timestamp: new Date().toISOString(),
      };

      console.log(
        `[${this.context.actorId}] Consolidation complete: ${finalEvaluation} (agreement: ${agreement.hasConsensus})`
      );

      this.state.success = true;
      this.state.consolidatedReview = consolidatedReview;
    } catch (error) {
      console.log(`[${this.context.actorId}] Consolidation error: ${error}`);
      this.state.success = false;
      this.state.error = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  private analyzeAgreement(reviews: ReviewResult[]): {
    hasConsensus: boolean;
    hasConflict: boolean;
    passCount: number;
    failCount: number;
    cannotEvaluateCount: number;
    averageConfidence: number;
  } {
    const evaluations = reviews.map(r => r.evaluation);
    const passCount = evaluations.filter(e => e === 'pass').length;
    const failCount = evaluations.filter(e => e === 'fail').length;
    const cannotEvaluateCount = evaluations.filter(e => e === 'cannot-evaluate').length;

    const hasConsensus = passCount === reviews.length || failCount === reviews.length;
    const hasConflict = passCount > 0 && failCount > 0;

    const averageConfidence =
      reviews.reduce((sum, r) => sum + r.confidence, 0) / reviews.length;

    return {
      hasConsensus,
      hasConflict,
      passCount,
      failCount,
      cannotEvaluateCount,
      averageConfidence,
    };
  }

  private determineFinalEvaluation(
    reviews: ReviewResult[],
    agreement: ReturnType<typeof this.analyzeAgreement>,
    requireConsensus: boolean
  ): 'pass' | 'fail' | 'needs-human-review' {
    // If consensus required and not achieved, needs review
    if (requireConsensus && !agreement.hasConsensus) {
      return 'needs-human-review';
    }

    // If there's a conflict, needs review
    if (agreement.hasConflict) {
      return 'needs-human-review';
    }

    // If most reviews are "cannot-evaluate", needs review
    if (agreement.cannotEvaluateCount >= reviews.length / 2) {
      return 'needs-human-review';
    }

    // If consensus on pass
    if (agreement.passCount === reviews.length) {
      return 'pass';
    }

    // If consensus on fail
    if (agreement.failCount === reviews.length) {
      return 'fail';
    }

    // Majority rule
    if (agreement.passCount > agreement.failCount) {
      return agreement.averageConfidence >= 0.7 ? 'pass' : 'needs-human-review';
    } else if (agreement.failCount > agreement.passCount) {
      return 'fail';
    }

    return 'needs-human-review';
  }

  private buildConsolidatedReasoning(
    reviews: ReviewResult[],
    agreement: ReturnType<typeof this.analyzeAgreement>
  ): string {
    const parts: string[] = [];

    parts.push(
      `Based on ${reviews.length} agent reviews (average confidence: ${agreement.averageConfidence.toFixed(2)}):`
    );

    if (agreement.hasConsensus) {
      parts.push(`\nAll agents agree on the evaluation.`);
      // Combine key reasoning points
      const keyPoints = reviews
        .map((r, idx) => `\n- Agent ${idx + 1} (${r.llmModel}): ${r.reasoning}`)
        .join('');
      parts.push(keyPoints);
    } else {
      parts.push(
        `\nVotes: ${agreement.passCount} pass, ${agreement.failCount} fail, ${agreement.cannotEvaluateCount} cannot evaluate.`
      );
      reviews.forEach((r, idx) => {
        parts.push(
          `\n- Agent ${idx + 1} (${r.agentName}, ${r.llmModel}): ${r.evaluation} - ${r.reasoning}`
        );
      });
    }

    return parts.join('');
  }

  private identifyConflicts(reviews: ReviewResult[]): string[] {
    const conflicts: string[] = [];

    const passReviews = reviews.filter(r => r.evaluation === 'pass');
    const failReviews = reviews.filter(r => r.evaluation === 'fail');

    if (passReviews.length > 0 && failReviews.length > 0) {
      conflicts.push(
        `${passReviews.length} agent(s) voted PASS while ${failReviews.length} voted FAIL`
      );

      // Highlight specific disagreements
      passReviews.forEach(pr => {
        conflicts.push(`${pr.agentName} (${pr.llmModel}): PASS - ${pr.reasoning.substring(0, 100)}...`);
      });

      failReviews.forEach(fr => {
        conflicts.push(`${fr.agentName} (${fr.llmModel}): FAIL - ${fr.reasoning.substring(0, 100)}...`);
      });
    }

    return conflicts;
  }

  private generateRecommendation(
    finalEvaluation: 'pass' | 'fail' | 'needs-human-review',
    agreement: ReturnType<typeof this.analyzeAgreement>,
    reviews: ReviewResult[]
  ): string {
    if (finalEvaluation === 'pass' && agreement.hasConsensus) {
      return 'Approve - All agents agree this criterion is satisfied.';
    }

    if (finalEvaluation === 'fail') {
      const issues = reviews.flatMap(r => r.flaggedIssues);
      if (issues.length > 0) {
        return `Reject - Issues identified: ${issues.join(', ')}. Require remediation before approval.`;
      }
      return 'Reject - Criterion not satisfied based on majority evaluation.';
    }

    if (agreement.hasConflict) {
      return 'Escalate to human reviewer - Conflicting opinions from agents require expert judgment.';
    }

    if (agreement.averageConfidence < 0.7) {
      return 'Escalate to human reviewer - Low confidence in automated evaluation.';
    }

    return 'Escalate to human reviewer - Unable to reach definitive conclusion.';
  }
}
