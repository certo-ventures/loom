/**
 * CriteriaReviewerActor - Reviews a single checklist criterion
 * 
 * This actor evaluates whether an appraisal meets a specific criterion
 * from the review checklist. Multiple instances with different LLMs can
 * provide diverse perspectives.
 */

import { Actor } from '../../../src/actor/actor';
import type { ActorContext } from '../../../src/actor/journal';
import { AppraisalData, ChecklistItem, ReviewResult } from '../types';

export interface CriteriaReviewerInput {
  appraisalData: AppraisalData;
  criterion: ChecklistItem;
  agentName: string;
  llmModel: string;
}

export interface CriteriaReviewerState extends Record<string, unknown> {
  success: boolean;
  review?: ReviewResult;
  error?: string;
}

export class CriteriaReviewerActor extends Actor {
  constructor(context: ActorContext, initialState?: Record<string, unknown>) {
    super(context, initialState);
  }

  protected getDefaultState(): Record<string, unknown> {
    return {
      success: false,
    };
  }

  async execute(input: unknown): Promise<void> {
    const typedInput = input as CriteriaReviewerInput;
    try {
      console.log(
        `[${this.context.actorId}] Agent ${typedInput.agentName} (${typedInput.llmModel}) reviewing criterion: ${typedInput.criterion.id}`
      );

      // 1. Check semantic cache (saves LLM call if hit)
      const cacheKey = `criterion:${typedInput.criterion.id}:property:${typedInput.appraisalData.propertyType}`;
      const cached = await this.memory.checkCache(cacheKey);
      
      if (cached) {
        console.log(`[${this.context.actorId}] 💾 Cache hit! Saved LLM call`);
        this.state.success = true;
        this.state.review = cached;
        return;
      }

      // 2. Recall similar past evaluations (adds context)
      const similarQuery = `${typedInput.criterion.criterion} ${typedInput.appraisalData.propertyType}`;
      const similarEvaluations = await this.memory.recall(similarQuery, {
        category: 'criterion-evaluation',
        limit: 3,
      });
      
      if (similarEvaluations.length > 0) {
        console.log(`[${this.context.actorId}] 📚 Found ${similarEvaluations.length} similar evaluations`);
      }

      // 3. Build review prompt (with context from memory)
      const prompt = this.buildReviewPrompt(typedInput, similarEvaluations);

      // 4. Call LLM to evaluate criterion
      const llmResponse = await this.callLLM(prompt, typedInput.llmModel);

      // 5. Parse review result
      const review = this.parseReviewResult(llmResponse, typedInput);

      console.log(
        `[${this.context.actorId}] ✅ Review completed: ${review.evaluation.toUpperCase()} (confidence: ${review.confidence.toFixed(2)})`
      );
      console.log(`[${this.context.actorId}] 💭 REASONING: ${review.reasoning.substring(0, 200)}...`);
      if (review.flaggedIssues.length > 0) {
        console.log(`[${this.context.actorId}] 🚩 ISSUES: ${review.flaggedIssues.join(', ')}`);
      }
      console.log('');

      // 6. Store in memory for future recall
      await this.memory.remember({
        memory: `Criterion ${review.criterionId}: ${review.evaluation}`,
        content: JSON.stringify(review),
      }, {
        importance: review.evaluation === 'fail' ? 'high' : 'medium',
        category: 'criterion-evaluation',
      });

      // 7. Cache for future similar queries
      await this.memory.cache(cacheKey, review, { ttl: 3600 });

      this.state.success = true;
      this.state.review = review;
    } catch (error) {
      console.log(`[${this.context.actorId}] Review error: ${error}`);
      this.state.success = false;
      this.state.error = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  private buildReviewPrompt(input: CriteriaReviewerInput, similarEvaluations: any[] = []): string {
    const { appraisalData, criterion } = input;

    let prompt = `You are a mortgage appraisal quality reviewer. Evaluate whether this appraisal meets the following criterion.

CRITERION:
Category: ${criterion.category}
Requirement: ${criterion.criterion}
Description: ${criterion.description}
Importance: ${criterion.importance}
Guidelines: ${criterion.guidelines}

APPRAISAL DATA:
Property: ${appraisalData.propertyAddress}
Appraised Value: $${appraisalData.appraisedValue.toLocaleString()}
Effective Date: ${appraisalData.effectiveDate}
Appraiser: ${appraisalData.appraiserName} (License: ${appraisalData.appraiserLicense})
Property Type: ${appraisalData.propertyType}
Year Built: ${appraisalData.yearBuilt}
Square Footage: ${appraisalData.squareFootage}
Lot Size: ${appraisalData.lotSize}
Condition: ${appraisalData.condition}

COMPARABLE SALES:
${appraisalData.comparableSales.map((comp, idx) => `
  ${idx + 1}. ${comp.address}
     Sale Price: $${comp.salePrice.toLocaleString()}
     Sale Date: ${comp.saleDate}
     Square Footage: ${comp.squareFootage}
     Adjustments: $${comp.adjustments.toLocaleString()}
`).join('\n')}
${similarEvaluations.length > 0 ? `

SIMILAR PAST EVALUATIONS (for context):
${similarEvaluations.slice(0, 2).map((mem: any, idx: number) => {
  try {
    const past = typeof mem.content === 'string' ? JSON.parse(mem.content) : mem.content;
    return `${idx + 1}. ${past.evaluation?.toUpperCase() || 'N/A'} - ${past.reasoning?.substring(0, 150) || mem.memory}`;
  } catch {
    return `${idx + 1}. ${mem.memory}`;
  }
}).join('\n')}
` : ''}

Evaluate this criterion and respond with JSON in this format:
{
  "evaluation": "pass" | "fail" | "cannot-evaluate",
  "reasoning": "Detailed explanation of your evaluation",
  "confidence": 0.0 to 1.0,
  "flaggedIssues": ["array", "of", "specific", "issues", "if", "any"]
}

Be thorough, objective, and cite specific data points from the appraisal in your reasoning.`;
    
    return prompt;
  }

  private async callLLM(prompt: string, model: string): Promise<string> {
    // Check if we should use real LLM or mock
    const useMock = process.env.USE_MOCK_LLM === 'true' || !process.env.AZURE_OPENAI_API_KEY;
    
    if (useMock) {
      // Mock implementation for testing without API keys
      console.log(`[${this.context.actorId}] Using MOCK ${model} for criterion review...`);
      await new Promise(resolve => setTimeout(resolve, 150));

      const mockResponses: { [key: string]: any } = {
        'gpt-4': {
          evaluation: 'pass',
          reasoning: 'The appraisal includes three comparable sales from the same market area within the last 6 months. All comparables are appropriately adjusted for differences in size, condition, and features. The valuation methodology is sound and well-documented.',
          confidence: 0.92,
          flaggedIssues: []
        },
        'claude-3': {
          evaluation: 'pass',
          reasoning: 'Property valuation is supported by recent comparable sales. The appraiser has properly documented adjustments and provided clear reasoning. The comparable properties are similar in size and location, making them appropriate references.',
          confidence: 0.88,
          flaggedIssues: []
        },
        'gpt-3.5': {
          evaluation: 'cannot-evaluate',
          reasoning: 'While comparable sales are present, I would need more detailed information about the adjustment methodology to fully evaluate the appropriateness of the valuation. The adjustments appear reasonable but lack detailed justification.',
          confidence: 0.65,
          flaggedIssues: ['Adjustment methodology not fully detailed']
        }
      };

      const response = mockResponses[model] || mockResponses['gpt-4'];
      return JSON.stringify(response);
    }

    // REAL LLM IMPLEMENTATION
    console.log(`[${this.context.actorId}] Calling REAL ${model} for criterion review...`);
    console.log(`[${this.context.actorId}] 📤 PROMPT (first 300 chars): ${prompt.substring(0, 300)}...`);
    
    const { createLLMService } = await import('../utils/llm-service');
    
    try {
      const llmService = createLLMService(model);
      
      const systemPrompt = 'You are a mortgage appraisal quality reviewer. Analyze the criterion and respond with ONLY valid JSON, no markdown formatting.';
      
      const response = await llmService.prompt(systemPrompt, prompt);
      
      console.log(`[${this.context.actorId}] 📥 LLM RESPONSE:\n${response}\n`);
      
      return response;
    } catch (error) {
      // If model not available, fall back to mock
      console.log(`[${this.context.actorId}] Model ${model} not available, using mock. Error: ${error}`);
      await new Promise(resolve => setTimeout(resolve, 150));
      
      return JSON.stringify({
        evaluation: 'cannot-evaluate',
        reasoning: `Model ${model} not configured. ${error}`,
        confidence: 0.5,
        flaggedIssues: ['LLM model not available']
      });
    }
  }

  private parseReviewResult(llmResponse: string, input: CriteriaReviewerInput): ReviewResult {
    // Remove markdown code blocks if present
    let jsonText = llmResponse.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.substring(7);
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.substring(3);
    }
    if (jsonText.endsWith('```')) {
      jsonText = jsonText.substring(0, jsonText.length - 3);
    }

    // Parse JSON
    const parsed = JSON.parse(jsonText.trim());

    // Build ReviewResult
    return {
      criterionId: input.criterion.id,
      agentName: input.agentName,
      llmModel: input.llmModel,
      evaluation: parsed.evaluation,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      flaggedIssues: parsed.flaggedIssues || [],
      timestamp: new Date().toISOString(),
    };
  }
}
