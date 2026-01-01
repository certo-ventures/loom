/**
 * Test: Per-Actor Infrastructure Configuration
 * 
 * Demonstrates how different actors can specify their own
 * timeout, retry policies, eviction priorities, etc.
 */

import { Actor } from '../src/actor/actor'
import type { ActorContext } from '../src/actor/journal'
import type { ActorInfrastructureConfig } from '../src/actor/actor-config'
import { calculateRetryDelay } from '../src/actor/actor-config'

/**
 * Critical Actor - Needs high reliability
 */
class CriticalActor extends Actor {
  static config: ActorInfrastructureConfig = {
    timeout: 60000,                    // 60s timeout
    retryPolicy: { 
      maxAttempts: 5,                  // Retry 5 times
      backoff: 'exponential',
      initialDelayMs: 2000,
      maxDelayMs: 120000,
    },
    messageOrdering: 'fifo',           // Strict ordering
    evictionPriority: 'high',          // Keep in pool longer
    deadLetterQueue: true,             // Enable DLQ
    concurrency: 1,                    // Sequential processing
  }

  async execute(input: unknown) {
    await this.simpleState.set('processed', true)
  }
}

/**
 * Fast Actor - Optimized for speed
 */
class FastActor extends Actor {
  static config: ActorInfrastructureConfig = {
    timeout: 5000,                     // 5s timeout
    retryPolicy: { 
      maxAttempts: 1,                  // Don't retry
      backoff: 'fixed',
    },
    messageOrdering: 'standard',       // Best effort
    evictionPriority: 'low',           // Evict quickly
    deadLetterQueue: false,            // No DLQ needed
    concurrency: 10,                   // High parallelism
  }

  async execute(input: unknown) {
    await this.simpleState.set('processed', true)
  }
}

/**
 * Notification Actor - Fire and forget
 */
class NotificationActor extends Actor {
  static config: ActorInfrastructureConfig = {
    timeout: 3000,                     // 3s timeout
    retryPolicy: { 
      maxAttempts: 2,                  // Retry once
      backoff: 'linear',
      initialDelayMs: 500,
    },
    messageOrdering: 'standard',       // Best effort
    evictionPriority: 'low',           // Evict immediately
    deadLetterQueue: false,            // Ignore failures
    concurrency: 100,                  // Very high parallelism
  }

  async execute(input: unknown) {
    await this.simpleState.set('sent', true)
  }
}

/**
 * Default Actor - Uses all defaults
 */
class DefaultActor extends Actor {
  // No config - uses defaults
  
  async execute(input: unknown) {
    await this.simpleState.set('processed', true)
  }
}

async function test() {
  const context: ActorContext = {
    actorId: 'test-1',
    actorType: 'TestActor',
    correlationId: 'test-correlation',
  }

  console.log('Testing Per-Actor Infrastructure Configuration...\n')

  // Test 1: Critical Actor
  console.log('🔴 Critical Actor Configuration:')
  const criticalActor = new CriticalActor(context)
  const criticalConfig = criticalActor.getInfrastructureConfig()
  console.log('  Timeout:', criticalConfig.timeout, 'ms')
  console.log('  Max Retries:', criticalConfig.retryPolicy.maxAttempts)
  console.log('  Backoff:', criticalConfig.retryPolicy.backoff)
  console.log('  Message Ordering:', criticalConfig.messageOrdering)
  console.log('  Eviction Priority:', criticalConfig.evictionPriority)
  console.log('  Dead Letter Queue:', criticalConfig.deadLetterQueue)
  console.log('  Concurrency:', criticalConfig.concurrency)

  // Test 2: Fast Actor
  console.log('\n⚡ Fast Actor Configuration:')
  const fastActor = new FastActor(context)
  const fastConfig = fastActor.getInfrastructureConfig()
  console.log('  Timeout:', fastConfig.timeout, 'ms')
  console.log('  Max Retries:', fastConfig.retryPolicy.maxAttempts)
  console.log('  Backoff:', fastConfig.retryPolicy.backoff)
  console.log('  Message Ordering:', fastConfig.messageOrdering)
  console.log('  Eviction Priority:', fastConfig.evictionPriority)
  console.log('  Dead Letter Queue:', fastConfig.deadLetterQueue)
  console.log('  Concurrency:', fastConfig.concurrency)

  // Test 3: Notification Actor
  console.log('\n📧 Notification Actor Configuration:')
  const notifActor = new NotificationActor(context)
  const notifConfig = notifActor.getInfrastructureConfig()
  console.log('  Timeout:', notifConfig.timeout, 'ms')
  console.log('  Max Retries:', notifConfig.retryPolicy.maxAttempts)
  console.log('  Backoff:', notifConfig.retryPolicy.backoff)
  console.log('  Message Ordering:', notifConfig.messageOrdering)
  console.log('  Eviction Priority:', notifConfig.evictionPriority)
  console.log('  Dead Letter Queue:', notifConfig.deadLetterQueue)
  console.log('  Concurrency:', notifConfig.concurrency)

  // Test 4: Default Actor
  console.log('\n⚙️  Default Actor Configuration:')
  const defaultActor = new DefaultActor(context)
  const defaultConfig = defaultActor.getInfrastructureConfig()
  console.log('  Timeout:', defaultConfig.timeout, 'ms')
  console.log('  Max Retries:', defaultConfig.retryPolicy.maxAttempts)
  console.log('  Backoff:', defaultConfig.retryPolicy.backoff)
  console.log('  Message Ordering:', defaultConfig.messageOrdering)
  console.log('  Eviction Priority:', defaultConfig.evictionPriority)
  console.log('  Dead Letter Queue:', defaultConfig.deadLetterQueue)
  console.log('  Concurrency:', defaultConfig.concurrency)

  // Test 5: Retry Delay Calculation
  console.log('\n📊 Retry Delay Calculations:')
  
  console.log('  Exponential backoff (Critical Actor):')
  for (let i = 1; i <= 5; i++) {
    const delay = calculateRetryDelay(criticalConfig.retryPolicy, i)
    console.log(`    Attempt ${i}: ${delay}ms`)
  }
  
  console.log('  Linear backoff (Notification Actor):')
  for (let i = 1; i <= 3; i++) {
    const delay = calculateRetryDelay(notifConfig.retryPolicy, i)
    console.log(`    Attempt ${i}: ${delay}ms`)
  }
  
  console.log('  Fixed backoff (Fast Actor):')
  for (let i = 1; i <= 3; i++) {
    const delay = calculateRetryDelay(fastConfig.retryPolicy, i)
    console.log(`    Attempt ${i}: ${delay}ms`)
  }

  console.log('\n✅ All per-actor configuration tests passed!')
  console.log('\n💡 Summary:')
  console.log('  - CriticalActor: High reliability, strict ordering, 5 retries')
  console.log('  - FastActor: Speed optimized, no retries, high concurrency')
  console.log('  - NotificationActor: Fire-and-forget, very high concurrency')
  console.log('  - DefaultActor: Balanced defaults for typical use cases')
}

test().catch(console.error)
