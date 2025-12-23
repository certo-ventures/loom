// @ts-nocheck - Outdated demo, needs API updates
/**
 * REAL Actor-Based Mortgage Appraisal Review System
 * 
 * NOTE: This demo is currently OUT OF DATE and needs to be updated
 * to match the current ActorRuntime API. The registerActorType API has changed.
 * 
 * Uses:
 * - ActorRuntime for long-lived actor management
 * - BullMQ for message passing between actors
 * - Redis for shared memory coordination
 * - Event-driven workflow (NO hard-coded orchestration)
 * - Support for TypeScript AND WASM actors
 * 
 * @deprecated - Needs update to current ActorRuntime API
 */

import Redis from 'ioredis';
import { BullMQMessageQueue } from '../../src/storage/bullmq-message-queue';
import { RedisSharedMemory } from '../../src/shared-memory/redis-shared-memory';
import { InMemoryBlobStore } from '../../src/storage/in-memory-blob-store';
import { InMemoryStateStore } from '../../src/storage/in-memory-state-store';
import { ActorRuntime } from '../../src/runtime/actor-runtime';
import type { Message, TraceContext } from '../../src/types';
import { DocumentExtractorActor } from './actors/document-extractor';
import { CriteriaReviewerActor } from './actors/criteria-reviewer';
import { ReviewConsolidatorActor } from './actors/review-consolidator';
import type { ChecklistItem, AppraisalReviewReport } from './types';
import * as fs from 'fs';
import * as path from 'path';

const __dirname = __filename;

/**
 * Queue Names
 */
const QUEUES = {
  EXTRACTION: 'appraisal-extraction',
  REVIEW: 'appraisal-review',
  CONSOLIDATION: 'appraisal-consolidation',
  COMPLETION: 'appraisal-completion',
};

/**
 * Real Actor System - Long-lived actors with message-driven workflow
 */
export class ActorBasedAppraisalSystem {
  private redis: Redis;
  private messageQueue: BullMQMessageQueue;
  private sharedMemory: RedisSharedMemory;
  private blobStore: InMemoryBlobStore;
  private stateStore: InMemoryStateStore;
  private actorRuntime: ActorRuntime;
  private checklist: ChecklistItem[] = [];

  constructor() {
    // Connect to Redis
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = parseInt(process.env.REDIS_PORT || '6379');
    
    this.redis = new Redis({
      host: redisHost,
      port: redisPort,
      maxRetriesPerRequest: null, // Required for BullMQ
    });

    this.messageQueue = new BullMQMessageQueue(this.redis);
    this.sharedMemory = new RedisSharedMemory(this.redis);
    this.blobStore = new InMemoryBlobStore();
    this.stateStore = new InMemoryStateStore();
    
    // Create LongLivedActorRuntime with storage abstractions + state persistence
    this.actorRuntime = new LongLivedActorRuntime({
      blobStore: this.blobStore,
      stateStore: this.stateStore,  // Enable state + journal persistence!
      maxPoolSize: 100,        // Keep up to 100 actors in memory
      maxIdleTime: 5 * 60 * 1000, // Evict after 5 minutes idle
    });
  }

  /**
   * Initialize the system - register actor types and workers
   */
  async initialize(): Promise<void> {
    console.log('🚀 Initializing Actor System with Long-Lived Actors...\n');

    // Register actor types with runtime
    this.actorRuntime.registerActorType('DocumentExtractor', {
      name: 'DocumentExtractor',
      version: '1.0.0',
      type: 'typescript',
      actorClass: DocumentExtractorActor,
    });

    this.actorRuntime.registerActorType('CriteriaReviewer', {
      name: 'CriteriaReviewer',
      version: '1.0.0',
      type: 'typescript',
      actorClass: CriteriaReviewerActor,
    });

    this.actorRuntime.registerActorType('ReviewConsolidator', {
      name: 'ReviewConsolidator',
      version: '1.0.0',
      type: 'typescript',
      actorClass: ReviewConsolidatorActor,
    });

    // Optional: Register WASM actors (advanced feature)
    // this.actorRuntime.registerActorType('CriteriaReviewer-WASM', {
    //   name: 'CriteriaReviewer-WASM',
    //   version: '1.0.0',
    //   type: 'wasm',
    //   blobPath: 'actors/reviewer.wasm',
    // });

    // Register workers - they route to ActorRuntime
    this.messageQueue.registerWorker(
      QUEUES.EXTRACTION,
      async (message: Message) => await this.handleExtraction(message),
      1
    );

    this.messageQueue.registerWorker(
      QUEUES.REVIEW,
      async (message: Message) => await this.handleReview(message),
      5 // 5 concurrent workers sharing actor pool
    );

    this.messageQueue.registerWorker(
      QUEUES.CONSOLIDATION,
      async (message: Message) => await this.handleConsolidation(message),
      1
    );

    this.messageQueue.registerWorker(
      QUEUES.COMPLETION,
      async (message: Message) => await this.handleCompletion(message),
      1
    );

    console.log('✅ Long-lived actors registered');
    console.log(`   Actor pool size: ${this.actorRuntime.getStats().maxPoolSize}`);
    console.log(`   Idle eviction: ${this.actorRuntime.getStats().maxIdleTime / 1000}s\n`);
  }

  /**
   * Load checklist from file
   */
  async loadChecklist(templateName: string): Promise<void> {
    const checklistPath = path.join(__dirname, 'data', 'checklist-templates', `${templateName}.json`);
    const content = fs.readFileSync(checklistPath, 'utf-8');
    const template = JSON.parse(content);
    this.checklist = template.items;
    
    console.log(`📋 Loaded checklist: ${template.checklistName} (${this.checklist.length} criteria)\n`);
  }

  /**
   * Start appraisal review - send initial message to extraction queue
   */
  async startReview(
    reviewId: string,
    pdfContent: string,
    llmModels: string[] = ['gpt-4', 'gpt-4', 'gpt-4']
  ): Promise<void> {
    console.log(`🏠 Starting appraisal review: ${reviewId}\n`);

    // Store config in shared memory
    await this.sharedMemory.write(`review:${reviewId}:config`, {
      reviewId,
      llmModels,
      checklistCount: this.checklist.length,
      startTime: new Date().toISOString(),
    });

    // Store checklist
    await this.sharedMemory.write(`review:${reviewId}:checklist`, this.checklist);

    // Send extraction message
    const extractionMessage: Message = {
      messageId: `${reviewId}-extract`,
      actorId: `extractor-${reviewId}`,
      messageType: 'execute',
      correlationId: reviewId,
      payload: {
        reviewId,
        pdfContent,
        pdfType: 'text',
      },
      metadata: {
        timestamp: new Date().toISOString(),
        sender: 'coordinator',
        priority: 1,
      },
    };

    await this.messageQueue.enqueue(QUEUES.EXTRACTION, extractionMessage);
    console.log(`📤 Sent extraction message to queue\n`);
  }

  /**
   * Handle extraction - route to long-lived actor via runtime
   */
  private async handleExtraction(message: Message): Promise<void> {
    const { reviewId, pdfContent, pdfType } = message.payload;
    
    console.log(`📄 [${message.actorId}] Processing extraction with long-lived actor...`);

    // Get long-lived actor from runtime (reuses existing or creates new)
    const actor = await this.actorRuntime.getActor(
      message.actorId,
      'DocumentExtractor',
      {
        actorId: message.actorId,
        actorType: 'DocumentExtractor',
        correlationId: message.correlationId,
        sharedMemory: this.sharedMemory,
      }
    );

    await actor.execute({ pdfContent, pdfType, schemaHints: [] });

    // Get extracted data from actor state
    const state = (actor as any).state;
    
    if (!state.success) {
      console.error(`❌ Extraction failed: ${state.error}`);
      return;
    }

    // Store extracted data in shared memory
    await this.sharedMemory.write(`review:${reviewId}:extracted`, state.extractedData);
    
    console.log(`✅ Extraction complete (actor reused from pool)\n`);

    // Trigger reviews for each criterion
    const checklist = await this.sharedMemory.read<ChecklistItem[]>(`review:${reviewId}:checklist`);
    const config = await this.sharedMemory.read<any>(`review:${reviewId}:config`);

    for (const criterion of checklist!) {
      for (let i = 0; i < config!.llmModels.length; i++) {
        const reviewMessage: Message = {
          messageId: `${reviewId}-review-${criterion.id}-${i}`,
          actorId: `reviewer-${criterion.id}-${i}`,
          messageType: 'execute',
          correlationId: reviewId as string,
          payload: {
            reviewId,
            criterionId: criterion.id,
            agentIndex: i,
            llmModel: config!.llmModels[i],
          },
          metadata: {
            timestamp: new Date().toISOString(),
            sender: message.actorId,
            priority: criterion.importance === 'critical' ? 1 : 2,
          },
        };

        await this.messageQueue.enqueue(QUEUES.REVIEW, reviewMessage);
      }
    }

    console.log(`📤 Sent ${checklist!.length * config!.llmModels.length} review messages to queue\n`);
  }

  /**
   * Handle review - route to long-lived actor via runtime
   */
  private async handleReview(message: Message): Promise<void> {
    const { reviewId, criterionId, agentIndex, llmModel } = message.payload;
    
    console.log(`🤖 [${message.actorId}] Reviewing criterion: ${criterionId} with ${llmModel} (long-lived)...`);

    // Get data from shared memory
    const extractedData = await this.sharedMemory.read(`review:${reviewId}:extracted`);
    const checklist = await this.sharedMemory.read<ChecklistItem[]>(`review:${reviewId}:checklist`);
    const criterion = checklist!.find(c => c.id === criterionId)!;

    // Get long-lived actor from pool
    const actor = await this.actorRuntime.getActor(
      message.actorId,
      'CriteriaReviewer',
      {
        actorId: message.actorId,
        actorType: 'CriteriaReviewer',
        correlationId: message.correlationId,
        sharedMemory: this.sharedMemory,
      }
    );

    await actor.execute({
      appraisalData: extractedData,
      criterion,
      agentName: `Agent-${agentIndex as number + 1}`,
      llmModel: llmModel as string,
    });

    // Store review in shared memory (append to list)
    const state = (actor as any).state;
    if (state.success) {
      await this.sharedMemory.append(`review:${reviewId}:reviews`, state.review);
      
      // Check if all reviews complete for this criterion
      await this.checkConsolidationReady(reviewId as string, criterionId as string);
    }
  }

  /**
   * Check if all reviews done for a criterion, trigger consolidation
   */
  private async checkConsolidationReady(reviewId: string, criterionId: string): Promise<void> {
    const allReviews = await this.sharedMemory.readList(`review:${reviewId}:reviews`);
    const config = await this.sharedMemory.read<any>(`review:${reviewId}:config`);
    
    const criterionReviews = allReviews.filter((r: any) => r.criterionId === criterionId);
    
    // If all agents reviewed this criterion, consolidate
    if (criterionReviews.length === config!.llmModels.length) {
      const consolidationMessage: Message = {
        messageId: `${reviewId}-consolidate-${criterionId}`,
        actorId: `consolidator-${criterionId}`,
        messageType: 'execute',
        correlationId: reviewId,
        payload: {
          reviewId,
          criterionId,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          sender: 'review-worker',
          priority: 1,
        },
      };

      await this.messageQueue.enqueue(QUEUES.CONSOLIDATION, consolidationMessage);
      console.log(`📤 Sent consolidation message for ${criterionId}\n`);
    }
  }

  /**
   * Handle consolidation - actor reconciles multiple reviews
   */
  private async handleConsolidation(message: Message): Promise<void> {
    const { reviewId, criterionId } = message.payload;
    
    console.log(`📊 [${message.actorId}] Consolidating reviews for ${criterionId}...`);

    // Get reviews from shared memory
    const allReviews = await this.sharedMemory.readList(`review:${reviewId}:reviews`);
    const criterionReviews = allReviews.filter((r: any) => r.criterionId === criterionId);

    // Create and execute consolidator actor
    const actor = new ReviewConsolidatorActor(
      {
        actorId: message.actorId,
        actorType: 'ReviewConsolidator',
        correlationId: message.correlationId,
        sharedMemory: this.sharedMemory,
      },
      {}
    );

    await actor.execute({
      criterionId: criterionId as string,
      reviews: criterionReviews,
      requireConsensus: false,
    });

    // Store consolidated review
    const state = (actor as any).state;
    if (state.success) {
      await this.sharedMemory.append(`review:${reviewId}:consolidated`, state.consolidatedReview);
      
      // Check if all criteria consolidated
      await this.checkCompletionReady(reviewId as string);
    }
  }

  /**
   * Check if all criteria consolidated, trigger completion
   */
  private async checkCompletionReady(reviewId: string): Promise<void> {
    const consolidated = await this.sharedMemory.readList(`review:${reviewId}:consolidated`);
    const config = await this.sharedMemory.read<any>(`review:${reviewId}:config`);
    
    if (consolidated.length === config!.checklistCount) {
      const completionMessage: Message = {
        messageId: `${reviewId}-complete`,
        actorId: `completer-${reviewId}`,
        messageType: 'execute',
        correlationId: reviewId,
        payload: { reviewId },
        metadata: {
          timestamp: new Date().toISOString(),
          sender: 'consolidation-worker',
          priority: 1,
        },
      };

      await this.messageQueue.enqueue(QUEUES.COMPLETION, completionMessage);
      console.log(`📤 Sent completion message\n`);
    }
  }

  /**
   * Handle completion - generate final report
   */
  private async handleCompletion(message: Message): Promise<void> {
    const { reviewId } = message.payload;
    
    console.log(`📋 [${message.actorId}] Generating final report...`);

    const extractedData = await this.sharedMemory.read(`review:${reviewId}:extracted`);
    const checklist = await this.sharedMemory.readList(`review:${reviewId}:checklist`);
    const allReviews = await this.sharedMemory.readList(`review:${reviewId}:reviews`);
    const consolidated = await this.sharedMemory.readList(`review:${reviewId}:consolidated`);

    const report: AppraisalReviewReport = {
      appraisalId: reviewId as string,
      propertyAddress: (extractedData as any).propertyAddress,
      extractedData: extractedData as any,
      checklist: checklist as any,
      individualReviews: allReviews as any,
      consolidatedReviews: consolidated as any,
      overallStatus: this.determineOverallStatus(consolidated),
      criticalIssues: this.extractCriticalIssues(consolidated, checklist as any),
      recommendations: this.generateRecommendations(consolidated),
      reviewedAt: new Date().toISOString(),
    };

    // Store final report
    await this.sharedMemory.write(`review:${reviewId}:report`, report);
    
    this.printReport(report);
    
    console.log(`\n✅ Review complete! Report stored in shared memory: review:${reviewId}:report\n`);
  }

  private determineOverallStatus(consolidated: any[]): 'approved' | 'rejected' | 'requires-review' {
    const failed = consolidated.filter(c => c.finalEvaluation === 'fail').length;
    const needsReview = consolidated.filter(c => c.finalEvaluation === 'needs-human-review').length;
    
    if (failed > 0) return 'rejected';
    if (needsReview > 0) return 'requires-review';
    return 'approved';
  }

  private extractCriticalIssues(consolidated: any[], checklist: ChecklistItem[]): string[] {
    const issues: string[] = [];
    const critical = checklist.filter(c => c.importance === 'critical');
    
    for (const criterion of critical) {
      const review = consolidated.find(c => c.criterionId === criterion.id);
      if (review && review.finalEvaluation !== 'pass') {
        issues.push(`${criterion.criterion}: ${review.consolidatedReasoning.substring(0, 150)}...`);
      }
    }
    
    return issues;
  }

  private generateRecommendations(consolidated: any[]): string[] {
    return consolidated
      .filter(c => c.finalEvaluation !== 'pass')
      .map(c => c.recommendedAction);
  }

  private printReport(report: AppraisalReviewReport): void {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║     APPRAISAL REVIEW REPORT SUMMARY    ║');
    console.log('╚════════════════════════════════════════╝\n');

    console.log(`📍 Property: ${report.propertyAddress}`);
    console.log(`💰 Appraised Value: $${report.extractedData.appraisedValue.toLocaleString()}`);
    console.log(`📊 Overall Status: ${report.overallStatus.toUpperCase()}\n`);

    const passCount = report.consolidatedReviews.filter(r => r.finalEvaluation === 'pass').length;
    const failCount = report.consolidatedReviews.filter(r => r.finalEvaluation === 'fail').length;
    const reviewCount = report.consolidatedReviews.filter(r => r.finalEvaluation === 'needs-human-review').length;

    console.log(`📋 Review Results:`);
    console.log(`   ✅ Pass: ${passCount}`);
    console.log(`   ❌ Fail: ${failCount}`);
    console.log(`   ⚠️  Needs Review: ${reviewCount}\n`);
  }

  /**
   * Cleanup
   */
  async close(): Promise<void> {
    await this.messageQueue.close();
    await this.redis.quit();
  }
}
