// @ts-nocheck - Outdated demo, needs API updates
/**
 * Example: Adding distributed coordination to ActorBasedAppraisalSystem
 * 
 * This shows how to enable distributed locking for horizontal scaling.
 * Uncomment the coordinationAdapter line to enable it.
 */

import Redis from 'ioredis'
import { RedisCoordinationAdapter } from '@loom/coordination'
// import { InMemoryCoordinationAdapter } from '@loom/coordination'
import { LongLivedActorRuntime } from '@loom/actor/actor-runtime'

// Example 1: Add Redis coordination for production
const redis = new Redis({ host: 'localhost', port: 6379 })
const coordinator = new RedisCoordinationAdapter(redis)

const runtime = new LongLivedActorRuntime({
  blobStore: myBlobStore,
  stateStore: myStateStore,
  coordinationAdapter: coordinator, // <-- ADD THIS LINE
  maxPoolSize: 100,
  maxIdleTime: 5 * 60 * 1000,
})

// Example 2: Run demo with coordination
// In demos/mortgage-appraisal/actor-system.ts constructor:
/*
this.actorRuntime = new LongLivedActorRuntime({
  blobStore: this.blobStore,
  stateStore: this.stateStore,
  coordinationAdapter: new RedisCoordinationAdapter(this.redis), // Enable distributed locking
  maxPoolSize: 100,
  maxIdleTime: 5 * 60 * 1000,
})
*/

// Now you can run multiple instances safely!
// Instance A will acquire lock on "actor-123"
// Instance B will get Error: "Actor actor-123 locked by another instance"
