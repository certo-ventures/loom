/**
 * Mortgage Appraisal Review Demo - Type Definitions
 * 
 * This file defines all data structures used in the mortgage appraisal review workflow.
 */

/**
 * Extracted appraisal data from PDF
 */
export interface AppraisalData {
  propertyAddress: string;
  appraisedValue: number;
  effectiveDate: string;
  appraiserName: string;
  appraiserLicense: string;
  propertyType: string;
  yearBuilt: number;
  squareFootage: number;
  lotSize: string;
  condition: string;
  comparableSales: ComparableSale[];
  [key: string]: any; // Allow additional extracted fields
}

/**
 * Comparable sale used in appraisal
 */
export interface ComparableSale {
  address: string;
  salePrice: number;
  saleDate: string;
  squareFootage: number;
  adjustments: number;
}

/**
 * Checklist item to validate
 */
export interface ChecklistItem {
  id: string;
  category: string;
  criterion: string;
  description: string;
  importance: 'critical' | 'high' | 'medium' | 'low';
  guidelines: string;
}

/**
 * Review result from a single agent
 */
export interface ReviewResult {
  criterionId: string;
  agentName: string;
  llmModel: string;
  evaluation: 'pass' | 'fail' | 'cannot-evaluate';
  reasoning: string;
  confidence: number; // 0-1
  flaggedIssues: string[];
  timestamp: string;
}

/**
 * Consolidated review after reconciliation
 */
export interface ConsolidatedReview {
  criterionId: string;
  finalEvaluation: 'pass' | 'fail' | 'needs-human-review';
  consolidatedReasoning: string;
  agentAgreement: boolean;
  conflictingOpinions?: string[];
  recommendedAction: string;
  timestamp: string;
}

/**
 * Complete appraisal review report
 */
export interface AppraisalReviewReport {
  appraisalId: string;
  propertyAddress: string;
  extractedData: AppraisalData;
  checklist: ChecklistItem[];
  individualReviews: ReviewResult[];
  consolidatedReviews: ConsolidatedReview[];
  overallStatus: 'approved' | 'rejected' | 'requires-review';
  criticalIssues: string[];
  recommendations: string[];
  reviewedAt: string;
}

/**
 * Configuration for multi-agent review
 */
export interface ReviewConfiguration {
  llmModels: string[]; // Multiple LLMs for comparison
  parallelReviews: boolean;
  requireConsensus: boolean;
  confidenceThreshold: number;
}
