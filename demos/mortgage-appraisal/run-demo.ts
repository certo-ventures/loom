// @ts-nocheck - Outdated demo
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { ActorBasedAppraisalSystem } from './actor-system';

dotenv.config();

const __dirname = __filename;

async function main() {
  console.log('MORTGAGE APPRAISAL REVIEW - REAL ACTOR SYSTEM');
  console.log('Using BullMQ + Redis for message passing\n');

  console.log('Redis Host:', process.env.REDIS_HOST || 'localhost');
  console.log('Redis Port:', process.env.REDIS_PORT || '6379\n');

  const samplePdfPath = path.join(__dirname, 'data', 'sample-appraisals', 'sample-appraisal-text.txt');
  const pdfContent = fs.readFileSync(samplePdfPath, 'utf-8');

  const system = new ActorBasedAppraisalSystem();
  
  try {
    await system.initialize();
    await system.loadChecklist('fnma-1004');

    const reviewId = `review-${Date.now()}`;
    await system.startReview(reviewId, pdfContent, ['gpt-4', 'gpt-4', 'gpt-4']);

    console.log('Review workflow started!');
    console.log('Actors communicating via message queues...');
    console.log('Wait 2-3 minutes for real LLM processing...\n');

    await new Promise(resolve => setTimeout(resolve, 180000));

    console.log('\nDemo complete!\n');

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await system.close();
  }
}

main().catch(console.error);
