/**
 * DecisionMemory - Specialized memory for decision traces
 * 
 * Extends ActorMemory to provide decision-specific capabilities:
 * - Store decisions with embeddings for semantic search
 * - Find similar decisions (precedent search)
 * - Traverse decision chains (parent/child relationships)
 * - Detect exception patterns
 * - Build decision lineage graphs
 * 
 * Architecture:
 * - Reuses ActorMemory's vector search infrastructure (no duplication)
 * - Stores decisions as entities in the memory graph
 * - Links decisions via precedent/policy edges
 * - Generates embeddings from decision context
 */

import { ActorMemory, ActorMemoryOptions } from './actor-memory';
import type { MemoryStorage, Entity, Fact } from './types';
import type { LamportClock } from '../../timing/lamport-clock';
import type { EmbeddingService } from '../embedding-service';
import type { 
  DecisionTrace, 
  DecisionInput,
  LLMDecisionAnalysis 
} from '../../actor/decision-trace';

export interface DecisionMemoryOptions extends ActorMemoryOptions {
  embeddingService?: EmbeddingService;
  enableEmbeddings?: boolean;  // Default: true if embeddingService provided
}

export interface DecisionSearchQuery {
  // Text matching
  decisionType?: DecisionTrace['decisionType'];
  isException?: boolean;
  actorType?: string;
  
  // Semantic search
  queryText?: string;
  similarTo?: DecisionTrace;  // Find decisions similar to this one
  
  // Context filters
  contextFilters?: Record<string, any>;
  
  // Time range
  startTime?: number;
  endTime?: number;
  
  // Result options
  limit?: number;
  minSimilarity?: number;  // 0-1, for semantic search
}

export interface DecisionPattern {
  patternType: 'exception' | 'approval' | 'escalation';
  frequency: number;
  decisions: DecisionTrace[];
  commonFactors: string[];
  recommendedPolicy?: string;
}

/**
 * DecisionMemory extends ActorMemory with decision-specific capabilities
 */
export class DecisionMemory extends ActorMemory {
  private embeddingService?: EmbeddingService;
  private enableEmbeddings: boolean;
  private decisionCache: Map<string, DecisionTrace> = new Map();

  constructor(
    actorId: string,
    storage: MemoryStorage,
    lamportClock: LamportClock,
    options?: DecisionMemoryOptions
  ) {
    super(actorId, storage, lamportClock, options);
    this.embeddingService = options?.embeddingService;
    this.enableEmbeddings = options?.enableEmbeddings ?? (!!this.embeddingService);
  }

  /**
   * Store a decision trace in memory with embedding
   */
  async addDecisionTrace(trace: DecisionTrace): Promise<void> {
    // Generate embedding if enabled
    let embedding: number[] | undefined;
    if (this.enableEmbeddings && this.embeddingService) {
      const searchText = this.serializeForSearch(trace);
      embedding = await this.embeddingService.embed(searchText);
    }

    // Store decision as entity in graph
    const entityId = await this.addEntity(
      trace.decisionId,
      'decision',
      trace.rationale,
      { 
        embedding,
        metadata: {
          decisionType: trace.decisionType,
          isException: trace.isException,
          timestamp: trace.timestamp,
          actorType: trace.actorType,
        }
      }
    );

    // Store the full trace in a separate fact for retrieval
    await this.addFact(
      entityId,
      'has_trace_data',
      entityId,
      JSON.stringify(trace),
      {
        source: 'user_input',
        confidence: 1.0,
      }
    );

    // Add precedent links
    if (trace.precedents && trace.precedents.length > 0) {
      for (const precedentId of trace.precedents) {
        // Find precedent entity
        const precedentEntities = await this.getEntities();
        const precedentEntity = precedentEntities.find(e => e.name === precedentId);
        
        if (precedentEntity) {
          await this.addFact(
            entityId,
            'references_precedent',
            precedentEntity.id,
            `Decision ${trace.decisionId} referenced precedent ${precedentId}`,
            { confidence: 1.0 }
          );
        }
      }
    }

    // Add policy link
    if (trace.policy) {
      // Create or find policy entity
      const policyEntities = await this.getEntities();
      let policyEntity = policyEntities.find(
        e => e.type === 'policy' && e.name === trace.policy!.id
      );
      
      if (!policyEntity) {
        const policyEntityId = await this.addEntity(
          trace.policy.id,
          'policy',
          trace.policy.rule
        );
        policyEntity = { id: policyEntityId } as Entity;
      }

      await this.addFact(
        entityId,
        'applied_policy',
        policyEntity.id,
        `Decision applied policy ${trace.policy.id} v${trace.policy.version}`,
        { 
          confidence: 1.0,
          metadata: { policyVersion: trace.policy.version }
        }
      );
    }

    // Add parent/child links
    if (trace.parentDecisionId) {
      const parentEntities = await this.getEntities();
      const parentEntity = parentEntities.find(e => e.name === trace.parentDecisionId);
      
      if (parentEntity) {
        await this.addFact(
          entityId,
          'child_of',
          parentEntity.id,
          `Decision ${trace.decisionId} is child of ${trace.parentDecisionId}`,
          { confidence: 1.0 }
        );
      }
    }

    // Cache the trace
    this.decisionCache.set(trace.decisionId, trace);
  }

  /**
   * Convert decision trace to searchable text
   */
  private serializeForSearch(trace: DecisionTrace): string {
    const parts: string[] = [];

    // Core decision info
    parts.push(`Decision Type: ${trace.decisionType}`);
    parts.push(`Rationale: ${trace.rationale}`);
    
    if (trace.reasoning) {
      parts.push(`Reasoning: ${trace.reasoning.join('; ')}`);
    }

    // Inputs
    if (trace.inputs && trace.inputs.length > 0) {
      const inputSummary = trace.inputs
        .map(i => `${i.system}/${i.entity}: ${JSON.stringify(i.result)}`)
        .join(', ');
      parts.push(`Inputs: ${inputSummary}`);
    }

    // Exception context
    if (trace.isException && trace.exceptionReason) {
      parts.push(`Exception Reason: ${trace.exceptionReason}`);
    }

    // Policy
    if (trace.policy) {
      parts.push(`Policy: ${trace.policy.rule}`);
    }

    // Context
    if (trace.context) {
      const contextStr = Object.entries(trace.context)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      parts.push(`Context: ${contextStr}`);
    }

    // LLM analysis
    if (trace.llmAnalysis) {
      parts.push(`Analysis: ${trace.llmAnalysis.deeperRationale}`);
      if (trace.llmAnalysis.criticalFactors) {
        parts.push(`Key Factors: ${trace.llmAnalysis.criticalFactors.map(f => f.factor).join(', ')}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Search for decisions matching query
   */
  async searchDecisions(query: DecisionSearchQuery): Promise<DecisionTrace[]> {
    let facts: Fact[] = [];

    // Semantic search if query text or similarTo provided
    if ((query.queryText || query.similarTo) && this.enableEmbeddings && this.embeddingService) {
      let embedding: number[];
      
      if (query.similarTo) {
        const searchText = this.serializeForSearch(query.similarTo);
        embedding = await this.embeddingService.embed(searchText);
      } else {
        embedding = await this.embeddingService.embed(query.queryText!);
      }

      // Use inherited searchHybrid or searchSemantic
      if (query.queryText) {
        facts = await this.searchHybrid(query.queryText, embedding, query.limit || 10);
      } else {
        facts = await this.searchSemantic(embedding, query.limit || 10);
      }
    } else if (query.queryText) {
      // Text-only search
      facts = await this.search(query.queryText, query.limit || 10);
    } else {
      // Get all facts if no search criteria
      facts = await this.getCurrentFacts();
    }

    // Filter to decision entities only
    const decisionEntities = await this.getEntities();
    const decisionEntityIds = new Set(
      decisionEntities
        .filter(e => e.type === 'decision')
        .map(e => e.id)
    );

    // Find facts that contain decision trace data
    const traceDataFacts = facts.filter(
      f => f.relation === 'has_trace_data' && decisionEntityIds.has(f.sourceEntityId)
    );

    // Parse decision traces
    const traces: DecisionTrace[] = [];
    for (const fact of traceDataFacts) {
      try {
        const trace = JSON.parse(fact.text) as DecisionTrace;
        
        // Apply filters
        if (query.decisionType && trace.decisionType !== query.decisionType) continue;
        if (query.isException !== undefined && trace.isException !== query.isException) continue;
        if (query.actorType && trace.actorType !== query.actorType) continue;
        if (query.startTime && trace.timestamp < query.startTime) continue;
        if (query.endTime && trace.timestamp > query.endTime) continue;
        
        // Context filters
        if (query.contextFilters) {
          let matchesContext = true;
          for (const [key, value] of Object.entries(query.contextFilters)) {
            if (trace.context[key] !== value) {
              matchesContext = false;
              break;
            }
          }
          if (!matchesContext) continue;
        }

        traces.push(trace);
      } catch (e) {
        // Skip invalid traces
        console.warn('Failed to parse decision trace:', e);
      }
    }

    return traces.slice(0, query.limit || 10);
  }

  /**
   * Find decisions similar to a given decision
   */
  async findSimilarDecisions(
    trace: DecisionTrace, 
    limit: number = 10,
    minSimilarity: number = 0.7
  ): Promise<DecisionTrace[]> {
    return this.searchDecisions({
      similarTo: trace,
      limit,
      minSimilarity
    });
  }

  /**
   * Get the full decision chain (ancestors and descendants)
   */
  async getDecisionChain(decisionId: string, visited: Set<string> = new Set()): Promise<{
    ancestors: DecisionTrace[];
    decision: DecisionTrace | null;
    descendants: DecisionTrace[];
  }> {
    // Prevent infinite recursion
    if (visited.has(decisionId)) {
      return { ancestors: [], decision: null, descendants: [] };
    }
    visited.add(decisionId);

    // Get the decision entity
    const entities = await this.getEntities();
    const decisionEntity = entities.find(e => e.name === decisionId && e.type === 'decision');
    
    if (!decisionEntity) {
      return { ancestors: [], decision: null, descendants: [] };
    }

    // Get the decision trace
    const traceFacts = await this.getCurrentFacts();
    const traceFact = traceFacts.find(
      f => f.sourceEntityId === decisionEntity.id && f.relation === 'has_trace_data'
    );
    
    const decision = traceFact ? JSON.parse(traceFact.text) as DecisionTrace : null;

    // Find ancestors (parent chain) - non-recursive
    const ancestors: DecisionTrace[] = [];
    if (decision?.parentDecisionId && !visited.has(decision.parentDecisionId)) {
      visited.add(decision.parentDecisionId);
      const parentChain = await this.getDecisionChain(decision.parentDecisionId, visited);
      if (parentChain.decision) {
        ancestors.push(parentChain.decision);
        // Add parent's ancestors too
        ancestors.push(...parentChain.ancestors);
      }
    }

    // Find descendants (children) - only direct children, no recursion
    const descendants: DecisionTrace[] = [];
    const childFacts = traceFacts.filter(
      f => f.targetEntityId === decisionEntity.id && f.relation === 'child_of'
    );
    
    for (const childFact of childFacts) {
      const childEntity = entities.find(e => e.id === childFact.sourceEntityId);
      if (childEntity && !visited.has(childEntity.name)) {
        const childTraceFact = traceFacts.find(
          f => f.sourceEntityId === childEntity.id && f.relation === 'has_trace_data'
        );
        if (childTraceFact) {
          try {
            const childTrace = JSON.parse(childTraceFact.text) as DecisionTrace;
            descendants.push(childTrace);
          } catch (e) {
            console.warn('Failed to parse child trace:', e);
          }
        }
      }
    }

    return { ancestors, decision, descendants };
  }

  /**
   * Detect patterns in exception decisions
   */
  async detectExceptionPatterns(): Promise<DecisionPattern[]> {
    // Get all exception decisions
    const exceptions = await this.searchDecisions({
      isException: true,
      limit: 1000  // Get many to analyze patterns
    });

    if (exceptions.length === 0) {
      return [];
    }

    // Group by decision type
    const byType = new Map<string, DecisionTrace[]>();
    for (const exception of exceptions) {
      const existing = byType.get(exception.decisionType) || [];
      existing.push(exception);
      byType.set(exception.decisionType, existing);
    }

    // Analyze each type for patterns
    const patterns: DecisionPattern[] = [];
    
    for (const [type, decisions] of byType.entries()) {
      if (decisions.length < 3) continue;  // Need at least 3 for a pattern

      // Find common factors in exception reasons
      const reasonWords = new Map<string, number>();
      for (const decision of decisions) {
        if (decision.exceptionReason) {
          const words = decision.exceptionReason.toLowerCase().split(/\s+/);
          for (const word of words) {
            if (word.length > 3) {  // Skip short words
              reasonWords.set(word, (reasonWords.get(word) || 0) + 1);
            }
          }
        }
      }

      // Find common factors (appear in >50% of exceptions)
      const threshold = decisions.length * 0.5;
      const commonFactors = Array.from(reasonWords.entries())
        .filter(([_, count]) => count >= threshold)
        .sort((a, b) => b[1] - a[1])
        .map(([word]) => word)
        .slice(0, 5);

      if (commonFactors.length > 0) {
        patterns.push({
          patternType: type as DecisionPattern['patternType'],
          frequency: decisions.length,
          decisions: decisions.slice(0, 10),  // Sample for pattern
          commonFactors,
          recommendedPolicy: this.generatePolicyRecommendation(type, commonFactors)
        });
      }
    }

    return patterns.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Generate policy recommendation from pattern
   */
  private generatePolicyRecommendation(
    decisionType: string, 
    commonFactors: string[]
  ): string {
    return `Consider adding policy rule for ${decisionType} when: ${commonFactors.join(', ')}`;
  }

  /**
   * Get decision by ID
   */
  async getDecision(decisionId: string): Promise<DecisionTrace | null> {
    // Check cache first
    if (this.decisionCache.has(decisionId)) {
      return this.decisionCache.get(decisionId)!;
    }

    // Search in memory
    const entities = await this.getEntities();
    const decisionEntity = entities.find(e => e.name === decisionId && e.type === 'decision');
    
    if (!decisionEntity) {
      return null;
    }

    const facts = await this.getCurrentFacts();
    const traceFact = facts.find(
      f => f.sourceEntityId === decisionEntity.id && f.relation === 'has_trace_data'
    );

    if (!traceFact) {
      return null;
    }

    try {
      const trace = JSON.parse(traceFact.text) as DecisionTrace;
      this.decisionCache.set(decisionId, trace);
      return trace;
    } catch (e) {
      console.warn('Failed to parse decision trace:', e);
      return null;
    }
  }

  /**
   * Get all decisions for an actor
   */
  async getAllDecisions(limit?: number): Promise<DecisionTrace[]> {
    return this.searchDecisions({ limit: limit || 100 });
  }

  /**
   * Clear decision cache
   */
  clearCache(): void {
    this.decisionCache.clear();
  }
}
