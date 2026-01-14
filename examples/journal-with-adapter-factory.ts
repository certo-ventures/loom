/**
 * Example: Using JournalStore via AdapterFactory (Production Pattern)
 * 
 * This demonstrates the correct way to configure journal persistence
 * using the adapter factory pattern instead of direct instantiation.
 */

import { AdapterFactory } from '../src/storage/adapter-factory'
import { Actor, type ActorContext } from '../src/actor/actor'

// Define a simple counter actor
class CounterActor extends Actor {
  async execute(input: unknown): Promise<void> {
    if (!input) return // Replay mode
    
    const { operation, value } = input as { operation: string; value?: number }
    const current = (this.state.count as number) || 0
    
    if (operation === 'increment') {
      this.updateState(draft => { draft.count = current + (value || 1) })
    } else if (operation === 'reset') {
      this.updateState(draft => { draft.count = 0 })
    }
  }
}

async function main() {
  // ✅ CORRECT: Use AdapterFactory for configuration-based setup
  const journalStore = AdapterFactory.createJournalStore({
    type: 'redis',
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
  })

  // Alternative: Use in-memory for development
  // const journalStore = AdapterFactory.createJournalStore({ type: 'inmemory' })

  if (!journalStore) {
    console.log('Running without journal persistence')
    return
  }

  const actorId = 'counter-123'
  const context: ActorContext = { actorId, actorType: 'CounterActor' }

  // Create actor with journal store
  const actor = new CounterActor(
    context,
    {},
    undefined,
    undefined,
    undefined,
    journalStore,
    { journalCompactionThreshold: 100 }
  )

  // Check if we have existing state
  const snapshot = await journalStore.getLatestSnapshot(actorId)
  const entries = await journalStore.readEntries(actorId)

  if (snapshot) {
    console.log('Restoring from snapshot...', snapshot.state)
    ;(actor as any).state = snapshot.state
    if (entries.length > 0) {
      actor.loadJournal({ entries, cursor: 0 })
      await actor.replay()
    }
  } else if (entries.length > 0) {
    console.log(`Replaying ${entries.length} journal entries...`)
    actor.loadJournal({ entries, cursor: 0 })
    await actor.replay()
  } else {
    console.log('Starting fresh actor')
  }

  console.log('Initial state:', actor.getState())

  // Perform operations
  await actor.execute({ operation: 'increment', value: 5 })
  await actor.execute({ operation: 'increment', value: 3 })
  
  console.log('Final state:', actor.getState())

  // Wait for async persistence
  await new Promise(resolve => setTimeout(resolve, 200))
  
  console.log('State persisted! Restart this script to see recovery.')
}

// Configuration example for production
export function createProductionConfig() {
  return {
    journalStore: {
      type: 'redis' as const,
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    },
    messageQueue: {
      type: 'bullmq' as const,
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    },
    coordinationAdapter: {
      type: 'redis' as const,
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    },
  }
}

// Create all adapters at once
export function createAllAdapters() {
  const config = createProductionConfig()
  return AdapterFactory.createAll(config)
}

if (require.main === module) {
  main().catch(console.error)
}
