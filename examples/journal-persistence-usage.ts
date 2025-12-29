import Redis from 'ioredis'
import { Actor, ActorContext, ActorRuntime } from '@certo-ventures/loom'
import { RedisJournalStore, InMemoryJournalStore } from '@certo-ventures/loom/storage'

/**
 * Journal Persistence Usage Example
 * 
 * This example demonstrates how to use the new journal persistence feature
 * to make actor journals durable across crashes and restarts.
 */

// ============================================================================
// 1. Create a JournalStore instance
// ============================================================================

// For production: Use Redis Streams for durable, append-only storage
const redis = new Redis({
  host: 'localhost',
  port: 6379,
})
const journalStore = new RedisJournalStore(redis, {
  keyPrefix: 'loom:journal', // Optional: customize key prefix
})

// For testing: Use in-memory store
const testJournalStore = new InMemoryJournalStore()

// ============================================================================
// 2. Define your actor (same as before)
// ============================================================================

class OrderActor extends Actor {
  async execute(input: unknown): Promise<void> {
    const { action, orderId, items } = input as any
    
    if (action === 'create') {
      this.updateState({ orderId, items, status: 'pending' })
      
      // Call activity to process payment
      const paymentResult = await this.callActivity('processPayment', {
        orderId,
        amount: items.reduce((sum: number, i: any) => sum + i.price, 0),
      })
      
      this.updateState({ paymentId: paymentResult, status: 'paid' })
    }
  }
}

// ============================================================================
// 3. Pass JournalStore to ActorRuntime
// ============================================================================

const runtime = new ActorRuntime(
  stateStore,
  messageQueue,
  lockManager,
  tracer,        // Optional: TraceWriter for observability
  journalStore   // NEW: JournalStore for journal persistence
)

runtime.registerActorType('order', (ctx) => new OrderActor(ctx))

// ============================================================================
// 4. That's it! Journal is now persisted automatically
// ============================================================================

// Activate actor - journal will be loaded from store if it exists
const actor = await runtime.activateActor('order-123', 'order')

// Execute - all journal entries are persisted as they happen
await actor.execute({
  action: 'create',
  orderId: 'order-123',
  items: [{ name: 'Widget', price: 29.99 }],
})

// If the process crashes, on restart:
// 1. Actor will load journal from journalStore
// 2. State will be restored from last snapshot (if any)
// 3. Remaining journal entries will be replayed
// 4. Actor resumes from last state

// ============================================================================
// 5. Automatic Compaction
// ============================================================================

// Journals are automatically compacted every 100 entries:
// - Snapshot of current state is saved
// - Old entries before snapshot are trimmed
// - Replay time stays fast even for long-running actors

// You can also manually compact:
await actor.compactJournal()

// ============================================================================
// 6. Benefits
// ============================================================================

/**
 * ✅ No data loss on crash - journal persisted incrementally
 * ✅ Fast recovery - actors resume from last state
 * ✅ Bounded memory - automatic compaction prevents unbounded growth
 * ✅ Deterministic replay - same inputs always produce same state
 * ✅ Opt-in - pass journalStore to enable, omit for in-memory only
 */

// ============================================================================
// 7. Configuration Options
// ============================================================================

// Adjust compaction threshold by modifying the check in Actor.updateState:
// Default: compact every 100 entries
// Change to 1000: if ((entryIndex + 1) % 1000 === 0)

// Monitor journal size:
const stats = await journalStore.getStats()
console.log('Journal stats:', stats)
// { totalStreams: 10, totalSnapshots: 5, sampleActorEntryCount: 42 }
