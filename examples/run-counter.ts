/**
 * Example: Running the Counter Actor
 */

import Redis from 'ioredis'
import { ActorRuntime } from '../src/runtime'
import { BullMQMessageQueue, RedisLockManager } from '../src/storage'
import { CounterActor } from './counter-actor'

// Simple in-memory state store for demo
class InMemoryStateStore {
  private store = new Map()
  async save(id: string, state: any) { this.store.set(id, state) }
  async load(id: string) { return this.store.get(id) || null }
  async delete(id: string) { this.store.delete(id) }
  async query() { return [] }
}

async function main() {
  // Setup infrastructure
  const redis = new Redis({ host: 'localhost', port: 6379 })
  const stateStore = new InMemoryStateStore()
  const messageQueue = new BullMQMessageQueue(redis)
  const lockManager = new RedisLockManager(redis)

  // Create runtime
  const runtime = new ActorRuntime(stateStore, messageQueue, lockManager)

  // Register actor type
  runtime.registerActorType('counter', (ctx, state) => new CounterActor(ctx, state))

  console.log('🚀 Loom Runtime Started')

  // Activate actor
  const counter = await runtime.activateActor('counter-1', 'counter')
  console.log('✅ Counter activated, initial state:', counter.getState())

  // Execute: Increment
  await counter.execute({ operation: 'increment', value: 5 })
  console.log('✅ After increment:', counter.getState())

  // Execute: Increment again
  await counter.execute({ operation: 'increment', value: 3 })
  console.log('✅ After second increment:', counter.getState())

  // Deactivate (saves state)
  await runtime.deactivateActor('counter-1')
  console.log('💾 Counter deactivated and state saved')

  // Reactivate (loads state)
  const counter2 = await runtime.activateActor('counter-1', 'counter')
  console.log('✅ Counter reactivated, state restored:', counter2.getState())

  // Execute: Decrement
  await counter2.execute({ operation: 'decrement', value: 2 })
  console.log('✅ After decrement:', counter2.getState())

  // Cleanup
  await runtime.shutdown()
  await messageQueue.close()
  await redis.quit()
  
  console.log('👋 Done!')
}

main().catch(console.error)
