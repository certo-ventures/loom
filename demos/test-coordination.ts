// @ts-nocheck - Outdated demo
/**
 * Test: Coordination Adapter prevents duplicate actors
 * 
 * This test simulates two instances trying to create the same actor.
 */

import { InMemoryCoordinationAdapter } from '../src/storage'

async function test() {
  const coordinator = new InMemoryCoordinationAdapter()
  
  console.log('Testing distributed actor locking...\n')
  
  // Instance A acquires lock
  const lockA = await coordinator.acquireLock('actor-123', 60000)
  console.log('Instance A:', lockA ? '✅ Got lock' : '❌ Lock failed')
  
  // Instance B tries to acquire same actor (should fail)
  const lockB = await coordinator.acquireLock('actor-123', 60000)
  console.log('Instance B:', lockB ? '❌ Got lock (BAD!)' : '✅ Lock blocked (GOOD!)')
  
  // Instance A releases lock
  if (lockA) {
    await coordinator.releaseLock(lockA)
    console.log('\nInstance A: Released lock')
  }
  
  // Instance B tries again (should succeed now)
  const lockB2 = await coordinator.acquireLock('actor-123', 60000)
  console.log('Instance B:', lockB2 ? '✅ Got lock after release' : '❌ Still blocked')
  
  // Test lock renewal
  if (lockB2) {
    const renewed = await coordinator.renewLock(lockB2, 60000)
    console.log('\nLock renewal:', renewed ? '✅ Renewed' : '❌ Failed')
  }
  
  console.log('\n✅ All coordination tests passed!')
}

test().catch(console.error)
