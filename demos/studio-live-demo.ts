/**
 * Live Studio Demo - Appraisal Review for Loom Studio
 */

const STUDIO_SERVER = 'http://localhost:9090';

async function reportToStudio(endpoint: string, data: any) {
  try {
    await fetch(`${STUDIO_SERVER}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (error) {
    // Server might not be running
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processAppraisal(reviewId: string) {
  console.log(`\n🏠 Processing Appraisal ${reviewId}`);
  
  // 1. Document Extractor
  const extractorId = 'doc-extractor-001';
  await reportToStudio('actor/update', {
    id: extractorId,
    status: 'active',
    lastActiveAt: new Date().toISOString(),
    messageCount: 1,
  });
  
  await reportToStudio(`journal/${extractorId}`, {
    entry: {
      sequence: 1,
      timestamp: new Date().toISOString(),
      type: 'ACTIVITY_STARTED',
      activityId: `extract-${reviewId}`,
      details: { reviewId, action: 'Extracting data from PDF' },
    },
  });
  
  console.log('📄 [doc-extractor-001] Extracting...');
  await delay(1500);
  
  await reportToStudio(`journal/${extractorId}`, {
    entry: {
      sequence: 2,
      timestamp: new Date().toISOString(),
      type: 'ACTIVITY_COMPLETED',
      activityId: `extract-${reviewId}`,
      result: { property: '123 Main St', value: '$425,000' },
    },
  });
  
  await reportToStudio('actor/update', { id: extractorId, status: 'idle', messageCount: 2 });
  console.log('✅ [doc-extractor-001] Complete');
  
  // 2. Technical reviewers (parallel)
  const techReviewers = ['tech-reviewer-001', 'tech-reviewer-002'];
  const techPromises = techReviewers.map(async (reviewerId, idx) => {
    await reportToStudio('actor/update', { id: reviewerId, status: 'active', lastActiveAt: new Date().toISOString(), messageCount: 1 });
    await reportToStudio(`journal/${reviewerId}`, {
      entry: { sequence: 1, timestamp: new Date().toISOString(), type: 'ACTIVITY_STARTED',
        activityId: `tech-review-${reviewId}-${idx}`, details: { reviewId, criterion: 'technical', llm: idx === 0 ? 'gpt-4' : 'claude-3' } },
    });
    
    console.log(`🔍 [${reviewerId}] Reviewing...`);
    await delay(2000 + Math.random() * 1000);
    
    const score = 0.85 + Math.random() * 0.15;
    await reportToStudio(`journal/${reviewerId}`, {
      entry: { sequence: 2, timestamp: new Date().toISOString(), type: 'ACTIVITY_COMPLETED',
        activityId: `tech-review-${reviewId}-${idx}`, result: { score, status: score > 0.9 ? 'PASS' : 'ACCEPTABLE' } },
    });
    
    await reportToStudio('actor/update', { id: reviewerId, status: 'idle', messageCount: 2 });
    console.log(`✅ [${reviewerId}] Complete (${score.toFixed(2)})`);
  });
  
  // 3. Compliance reviewers (parallel)
  const complianceReviewers = ['compliance-reviewer-001', 'compliance-reviewer-002'];
  const compliancePromises = complianceReviewers.map(async (reviewerId, idx) => {
    await reportToStudio('actor/update', { id: reviewerId, status: 'active', lastActiveAt: new Date().toISOString(), messageCount: 1 });
    await reportToStudio(`journal/${reviewerId}`, {
      entry: { sequence: 1, timestamp: new Date().toISOString(), type: 'ACTIVITY_STARTED',
        activityId: `compliance-review-${reviewId}-${idx}`, details: { reviewId, criterion: idx === 0 ? 'USPAP' : 'state_regs' } },
    });
    
    console.log(`📋 [${reviewerId}] Reviewing...`);
    await delay(1800 + Math.random() * 800);
    
    const score = 0.88 + Math.random() * 0.12;
    await reportToStudio(`journal/${reviewerId}`, {
      entry: { sequence: 2, timestamp: new Date().toISOString(), type: 'ACTIVITY_COMPLETED',
        activityId: `compliance-review-${reviewId}-${idx}`, result: { criterion: idx === 0 ? 'USPAP' : 'state_regs', score, status: 'PASS' } },
    });
    
    await reportToStudio('actor/update', { id: reviewerId, status: 'idle', messageCount: 2 });
    console.log(`✅ [${reviewerId}] Complete (${score.toFixed(2)})`);
  });
  
  // 4. Quality reviewer
  const qualityId = 'quality-reviewer-001';
  await reportToStudio('actor/update', { id: qualityId, status: 'active', lastActiveAt: new Date().toISOString(), messageCount: 1 });
  await reportToStudio(`journal/${qualityId}`, {
    entry: { sequence: 1, timestamp: new Date().toISOString(), type: 'ACTIVITY_STARTED',
      activityId: `quality-review-${reviewId}`, details: { reviewId, criterion: 'completeness' } },
  });
  
  console.log('⭐ [quality-reviewer-001] Assessing...');
  await delay(1600);
  
  await reportToStudio(`journal/${qualityId}`, {
    entry: { sequence: 2, timestamp: new Date().toISOString(), type: 'ACTIVITY_COMPLETED',
      activityId: `quality-review-${reviewId}`, result: { score: 0.92, status: 'PASS' } },
  });
  
  await reportToStudio('actor/update', { id: qualityId, status: 'idle', messageCount: 2 });
  console.log('✅ [quality-reviewer-001] Complete (0.92)');
  
  // Wait for all parallel reviews
  await Promise.all([...techPromises, ...compliancePromises]);
  
  // 5. Consolidator
  const consolidatorId = 'consolidator-001';
  await reportToStudio('actor/update', { id: consolidatorId, status: 'active', lastActiveAt: new Date().toISOString(), messageCount: 1 });
  await reportToStudio(`journal/${consolidatorId}`, {
    entry: { sequence: 1, timestamp: new Date().toISOString(), type: 'ACTIVITY_STARTED',
      activityId: `consolidate-${reviewId}`, details: { reviewId, action: 'Aggregating reviews' } },
  });
  
  console.log('📊 [consolidator-001] Consolidating...');
  await delay(1200);
  
  await reportToStudio(`journal/${consolidatorId}`, {
    entry: { sequence: 2, timestamp: new Date().toISOString(), type: 'ACTIVITY_COMPLETED',
      activityId: `consolidate-${reviewId}`, result: { reviewId, overallScore: 0.91, status: 'APPROVED' } },
  });
  
  await reportToStudio('actor/update', { id: consolidatorId, status: 'idle', messageCount: 2 });
  console.log('✅ [consolidator-001] APPROVED (0.91)\n');
  
  // Report metrics
  await reportToStudio('metrics', {
    timestamp: new Date().toISOString(),
    actorPools: { totalActors: 7, activeActors: 0, idleActors: 7, poolUtilization: 0 },
    messageQueues: { messagesPerSecond: 2.4, pendingMessages: 0, avgLatency: 45 },
  });
}

async function runDemo() {
  console.log('🏠 Appraisal Review Demo for Loom Studio');
  console.log('📡 Studio Server: http://localhost:9090');
  console.log('🖥️  Studio UI: http://localhost:3000\n');
  
  // Register actors
  const actors = [
    { id: 'doc-extractor-001', type: 'DocumentExtractor' },
    { id: 'tech-reviewer-001', type: 'TechnicalReviewer' },
    { id: 'tech-reviewer-002', type: 'TechnicalReviewer' },
    { id: 'compliance-reviewer-001', type: 'ComplianceReviewer' },
    { id: 'compliance-reviewer-002', type: 'ComplianceReviewer' },
    { id: 'quality-reviewer-001', type: 'QualityReviewer' },
    { id: 'consolidator-001', type: 'ReviewConsolidator' },
  ];
  
  for (const actor of actors) {
    await reportToStudio('actor/register', {
      id: actor.id,
      type: actor.type,
      status: 'idle',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      messageCount: 0,
      queueDepth: 0,
    });
  }
  
  console.log(`✅ Registered ${actors.length} actors\n`);
  
  let reviewCounter = 1;
  const processNext = async () => {
    const reviewId = `APR-${String(reviewCounter++).padStart(4, '0')}`;
    try {
      await processAppraisal(reviewId);
      console.log(`✅ ${reviewId} complete\n`);
    } catch (error: any) {
      console.error(`❌ ${reviewId} failed:`, error.message);
    }
  };
  
  await processNext();
  setInterval(() => processNext().catch(console.error), 20000);
  
  console.log('🔄 Demo running - Processing appraisals every 20s');
  console.log('🌐 Open http://localhost:3000 for Loom Studio!');
  console.log('🎯 Click any actor to see its journal\n');
}

runDemo().catch(console.error);
