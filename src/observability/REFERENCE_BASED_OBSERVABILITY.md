# Reference-Based Observability: Integration with Loom's Durable Execution

## The Problem I Misunderstood

**WRONG Approach (What I Did)**: Store full payloads/state in trace events
- Duplicates data already in journals
- Duplicates data already in StateStore
- Duplicates messages already in BullMQ
- Wastes storage and money

**RIGHT Approach (What You Want)**: Store REFERENCES in trace events
- Point to existing journal entries
- Point to existing state snapshots
- Point to existing messages
- Reconstruct by following references

---

## Part 1: Understanding Loom's Existing State Management

### What Loom Already Saves

```typescript
// 1. JOURNALS - Already stored per actor
interface Journal {
  entries: JournalEntry[]  // Every action the actor took
  cursor: number
}

type JournalEntry =
  | { type: 'state_updated'; state: Record<string, unknown> }
  | { type: 'activity_scheduled'; activityId: string; name: string; input: unknown }
  | { type: 'activity_completed'; activityId: string; result: unknown }
  | { type: 'activity_failed'; activityId: string; error: string }
  | { type: 'child_spawned'; childId: string; actorType: string; input: unknown }
  | { type: 'event_received'; eventType: string; data: unknown }
  | { type: 'suspended'; reason: string }

// 2. STATE SNAPSHOTS - Already stored in CosmosDB via StateStore
interface ActorState {
  id: string
  partitionKey: string
  actorType: string
  status: 'active' | 'suspended' | 'completed' | 'failed'
  state: Record<string, unknown>  // Current state
  correlationId: string
  createdAt: string
  lastActivatedAt: string
  metadata?: Record<string, unknown>
}

// 3. MESSAGES - Already in BullMQ
interface Message {
  messageId: string
  actorId: string
  messageType: string
  correlationId: string
  payload: Record<string, unknown>  // Full payload
  metadata: { timestamp: string; /* ... */ }
}
```

**Key Insight**: All the data ALREADY EXISTS. We just need to REFERENCE it.

---

## Part 2: Reference-Based Event Schema

### Updated TraceEvent with References

```typescript
interface TraceEvent {
  // Core trace fields (same as before)
  trace_id: string
  span_id: string
  parent_span_id?: string
  event_type: string
  timestamp: string
  status?: 'success' | 'failed' | 'pending'
  tags?: string[]
  
  // ✅ REFERENCES instead of data duplication
  refs?: {
    // Reference to actor state snapshot
    actor_state?: {
      actor_id: string
      state_version: string  // e.g., timestamp or sequence number
      container: 'actor-states'
      partition_key: string
    }
    
    // Reference to journal entry
    journal_entry?: {
      actor_id: string
      entry_index: number  // Position in journal.entries array
      entry_type: string   // 'state_updated', 'activity_completed', etc.
    }
    
    // Reference to message
    message?: {
      message_id: string
      queue_name: string
      correlation_id: string
    }
    
    // Reference to CosmosDB document
    document?: {
      container: string
      id: string
      partition_key: string
    }
    
    // Reference to BlobStore object
    blob?: {
      container: string
      blob_name: string
    }
  }
  
  // ✅ LIGHTWEIGHT metadata (not full data)
  metadata?: {
    actor_type?: string
    message_type?: string
    error?: string  // Error messages are small, store inline
    duration_ms?: number
    ru_consumed?: number
    [key: string]: any  // Other small metadata
  }
}
```

---

## Part 3: Emitting Events with References

### Example 1: Actor Activation with State Reference

```typescript
// src/runtime/actor-worker.ts
private async processMessage(message: Message): Promise<void> {
  const { trace } = message
  const span_id = generateId()
  
  // ✅ Emit with REFERENCES, not data
  await tracer.emit({
    trace_id: trace.trace_id,
    span_id,
    parent_span_id: trace.span_id,
    event_type: 'message:received',
    timestamp: new Date().toISOString(),
    
    // ✅ Reference to message (already in BullMQ)
    refs: {
      message: {
        message_id: message.messageId,
        queue_name: this.queueName,
        correlation_id: message.correlationId
      }
    },
    
    // ✅ Lightweight metadata only
    metadata: {
      actor_type: this.actorType,
      actor_id: message.actorId,
      message_type: message.messageType
    }
  })
  
  try {
    // Activate actor (loads state from StateStore)
    const actor = await this.runtime.activateActor(
      message.actorId,
      this.actorType,
      actorContext
    )
    
    // Execute
    await actor.handleMessage(message)
    
    // ✅ Emit completion with state reference
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      event_type: 'message:completed',
      timestamp: new Date().toISOString(),
      status: 'success',
      
      // ✅ Reference to final state snapshot
      refs: {
        actor_state: {
          actor_id: message.actorId,
          state_version: new Date().toISOString(),  // Or use sequence number
          container: 'actor-states',
          partition_key: message.actorId
        }
      },
      
      metadata: {
        duration_ms: Date.now() - startTime
      }
    })
    
  } catch (error) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      event_type: 'message:failed',
      timestamp: new Date().toISOString(),
      status: 'failed',
      metadata: {
        error: error.message,
        error_type: error.constructor.name
      }
    })
  }
}
```

### Example 2: Journal Entry Reference

```typescript
// src/actor/actor.ts
protected updateState(updates: Record<string, unknown>): void {
  this.state = { ...this.state, ...updates }
  
  if (!this.isReplaying) {
    // ✅ Already saving to journal (existing code)
    const entryIndex = this.journal.entries.length
    this.journal.entries.push({
      type: 'state_updated',
      state: this.state,
    })
    
    // ✅ Emit trace event with reference to journal entry
    if (this.context.trace) {
      await tracer.emit({
        trace_id: this.context.trace.trace_id,
        span_id: generateId(),
        parent_span_id: this.context.trace.span_id,
        event_type: 'actor:state_changed',
        timestamp: new Date().toISOString(),
        
        // ✅ Point to journal entry (don't duplicate state)
        refs: {
          journal_entry: {
            actor_id: this.context.actorId,
            entry_index: entryIndex,
            entry_type: 'state_updated'
          }
        },
        
        // ✅ Lightweight metadata about the change
        metadata: {
          actor_type: this.constructor.name,
          changed_keys: Object.keys(updates)  // Just the keys, not values
        }
      })
    }
  }
}
```

### Example 3: CosmosDB Operation Reference

```typescript
// src/storage/cosmos-state-store.ts
async save(actorId: string, state: ActorState, trace?: TraceContext): Promise<void> {
  // ✅ Save to Cosmos (existing code - data lives here)
  const response = await this.container.items.upsert(state)
  
  // ✅ Emit trace event with reference (not duplicate)
  if (trace) {
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id: generateId(),
      parent_span_id: trace.span_id,
      event_type: 'cosmosdb:write',
      timestamp: new Date().toISOString(),
      
      // ✅ Reference to document (already in Cosmos)
      refs: {
        document: {
          container: this.container.id,
          id: state.id,
          partition_key: state.partitionKey
        }
      },
      
      // ✅ Metadata only
      metadata: {
        operation: 'upsert',
        actor_type: state.actorType,
        ru_consumed: response.requestCharge,
        document_size_bytes: JSON.stringify(state).length
      }
    })
  }
}
```

---

## Part 4: Query & Reconstruction

### Fetching Referenced Data

```typescript
class TraceReconstructor {
  constructor(
    private cosmosClient: CosmosClient,
    private stateStore: StateStore,
    private messageQueue: MessageQueue
  ) {}
  
  /**
   * Reconstruct complete trace with all referenced data
   */
  async reconstruct(trace_id: string): Promise<ReconstructedTrace> {
    // 1. Fetch lightweight trace events (just references)
    const reader = new TraceReader(this.traceContainer)
    const events = await reader.getTrace(trace_id)
    
    // 2. Follow references to get actual data
    const enriched = await Promise.all(
      events.map(event => this.enrichEvent(event))
    )
    
    return {
      trace_id,
      events: enriched,
      timeline: this.buildTimeline(enriched),
      dataFlow: this.buildDataFlow(enriched)
    }
  }
  
  /**
   * Enrich event by fetching referenced data
   */
  private async enrichEvent(event: TraceEvent): Promise<EnrichedEvent> {
    const enriched: EnrichedEvent = { ...event, data: {} }
    
    // Fetch actor state if referenced
    if (event.refs?.actor_state) {
      const state = await this.stateStore.load(event.refs.actor_state.actor_id)
      enriched.data.actor_state = state?.state
    }
    
    // Fetch journal entry if referenced
    if (event.refs?.journal_entry) {
      const journal = await this.loadJournal(event.refs.journal_entry.actor_id)
      const entry = journal?.entries[event.refs.journal_entry.entry_index]
      enriched.data.journal_entry = entry
    }
    
    // Fetch message if referenced
    if (event.refs?.message) {
      const message = await this.loadMessage(event.refs.message.message_id)
      enriched.data.message = message
    }
    
    // Fetch document if referenced
    if (event.refs?.document) {
      const doc = await this.loadDocument(
        event.refs.document.container,
        event.refs.document.id,
        event.refs.document.partition_key
      )
      enriched.data.document = doc
    }
    
    return enriched
  }
  
  /**
   * Load journal from wherever journals are stored
   */
  private async loadJournal(actorId: string): Promise<Journal | null> {
    // Journals might be stored in:
    // - Actor's state (state.metadata.journal)
    // - Separate journal container
    // - Actor's memory if still active
    const state = await this.stateStore.load(actorId)
    return state?.metadata?.journal as Journal | null
  }
  
  /**
   * Load message from BullMQ or message archive
   */
  private async loadMessage(messageId: string): Promise<Message | null> {
    // Messages might be in:
    // - BullMQ (if recent)
    // - Message archive container (if completed)
    try {
      return await this.messageQueue.getMessage(messageId)
    } catch {
      // Fallback to archive
      return await this.loadArchivedMessage(messageId)
    }
  }
  
  /**
   * Load document from CosmosDB
   */
  private async loadDocument(
    container: string,
    id: string,
    partitionKey: string
  ): Promise<any> {
    const cont = this.cosmosClient.database('loom').container(container)
    const { resource } = await cont.item(id, partitionKey).read()
    return resource
  }
}
```

### Query Example: Full Data Flow Reconstruction

```typescript
async function showFullDataFlow(trace_id: string) {
  const reconstructor = new TraceReconstructor(cosmosClient, stateStore, messageQueue)
  const trace = await reconstructor.reconstruct(trace_id)
  
  console.log('\n📦 COMPLETE DATA FLOW RECONSTRUCTION\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  
  trace.events.forEach((event, i) => {
    console.log(`${i + 1}. ${event.event_type} [${new Date(event.timestamp).toLocaleTimeString()}]`)
    
    // Show references (lightweight)
    if (event.refs) {
      console.log('   📎 References:')
      if (event.refs.message) {
        console.log(`      Message: ${event.refs.message.message_id}`)
      }
      if (event.refs.actor_state) {
        console.log(`      State: ${event.refs.actor_state.actor_id}@${event.refs.actor_state.state_version}`)
      }
      if (event.refs.journal_entry) {
        console.log(`      Journal: ${event.refs.journal_entry.actor_id}[${event.refs.journal_entry.entry_index}]`)
      }
    }
    
    // Show fetched data (only when needed)
    if (event.data?.message) {
      console.log('   📥 Message Payload:')
      console.log('      ' + JSON.stringify(event.data.message.payload, null, 2)
        .split('\n').map(l => '      ' + l).join('\n'))
    }
    
    if (event.data?.actor_state) {
      console.log('   🗂️  Actor State:')
      console.log('      ' + JSON.stringify(event.data.actor_state, null, 2)
        .split('\n').map(l => '      ' + l).join('\n'))
    }
    
    if (event.data?.journal_entry) {
      console.log('   📓 Journal Entry:')
      console.log('      ' + JSON.stringify(event.data.journal_entry, null, 2)
        .split('\n').map(l => '      ' + l).join('\n'))
    }
    
    console.log()
  })
}
```

### Output Example

```
📦 COMPLETE DATA FLOW RECONSTRUCTION

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. message:received [10:15:23]
   📎 References:
      Message: msg-abc123
      State: loan-proc-1@2025-12-22T10:15:23Z
   📥 Message Payload:
      {
        "applicant_name": "John Doe",
        "amount": 250000,
        "credit_score": 720
      }

2. actor:state_changed [10:15:24]
   📎 References:
      Journal: loan-proc-1[5]
      State: loan-proc-1@2025-12-22T10:15:24Z
   📓 Journal Entry:
      {
        "type": "state_updated",
        "state": {
          "processed_count": 43,
          "current_loan": {
            "applicant": "John Doe",
            "amount": 250000
          }
        }
      }

3. cosmosdb:write [10:15:24]
   📎 References:
      Document: actor-states/loan-proc-1
   🗂️  Actor State:
      {
        "id": "loan-proc-1",
        "actorType": "LoanProcessor",
        "state": {
          "processed_count": 43,
          "current_loan": { ... }
        }
      }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Part 5: Storage Savings

### Cost Comparison

**OLD Approach (Duplicate Data)**:
```typescript
// Trace event: ~5KB (full payload + state + metadata)
{
  trace_id: "...",
  span_id: "...",
  event_type: "message:received",
  data: {
    payload: { /* 2KB of loan data */ },
    state: { /* 2KB of actor state */ },
    metadata: { /* 1KB */ }
  }
}

// For 10-20 events: 50-100KB per trace
// For 1M traces/day: 50-100GB/day
// CosmosDB cost: ~$400-800/month
```

**NEW Approach (References Only)**:
```typescript
// Trace event: ~500 bytes (references + metadata)
{
  trace_id: "...",
  span_id: "...",
  event_type: "message:received",
  refs: {
    message: { message_id: "msg-123", queue_name: "loans" },
    actor_state: { actor_id: "loan-proc-1", state_version: "..." }
  },
  metadata: {
    actor_type: "LoanProcessor",
    message_type: "execute"
  }
}

// For 10-20 events: 5-10KB per trace (10x smaller)
// For 1M traces/day: 5-10GB/day
// CosmosDB cost: ~$40-80/month
```

**Savings: 90% reduction in storage costs!**

---

## Part 6: Integration with Journal System

### Where Journals Are Stored

```typescript
// Option 1: Journals in actor state metadata
interface ActorState {
  id: string
  state: Record<string, unknown>
  metadata: {
    journal: Journal  // ✅ Journal lives here
  }
}

// Option 2: Separate journal container (better for large journals)
// Container: 'actor-journals'
// Document: { actor_id, journal: Journal }

// Option 3: In-memory only (for transient actors)
// Journal lives in Actor instance, not persisted
```

### Querying Journal Entries

```typescript
async function getJournalEntry(actorId: string, entryIndex: number): Promise<JournalEntry | null> {
  // Load full actor state
  const state = await stateStore.load(actorId)
  
  // Extract journal
  const journal = state?.metadata?.journal as Journal
  
  // Return specific entry
  return journal?.entries[entryIndex] || null
}

// Usage in trace reconstruction:
const entry = await getJournalEntry('loan-proc-1', 5)
console.log('State at that point:', entry.state)
```

---

## Part 7: Benefits of Reference-Based Approach

### 1. No Data Duplication
✅ Data stored once (journal, state store, message queue)
✅ Traces just point to it
✅ 90% storage savings

### 2. Single Source of Truth
✅ State comes from StateStore (always accurate)
✅ Messages come from BullMQ/archive (original payloads)
✅ Journals come from actor state (complete history)

### 3. Lazy Loading
✅ Fetch references quickly (~10KB)
✅ Only load actual data when viewing trace
✅ Fast queries, detailed analysis when needed

### 4. Consistency with Durable Execution
✅ Leverages existing journal system
✅ Leverages existing state management
✅ No parallel tracking systems

### 5. Privacy & Security
✅ References can be access-controlled
✅ Don't copy sensitive data to trace container
✅ Audit trail without data exposure

---

## Summary

### What We Store in Trace Events

| Field | What It Is | Size |
|-------|-----------|------|
| `trace_id`, `span_id`, `parent_span_id` | Trace identifiers | ~100 bytes |
| `event_type`, `timestamp`, `status` | Event metadata | ~50 bytes |
| `refs.message` | Pointer to message in BullMQ | ~100 bytes |
| `refs.actor_state` | Pointer to state snapshot | ~100 bytes |
| `refs.journal_entry` | Pointer to journal entry | ~50 bytes |
| `refs.document` | Pointer to Cosmos document | ~100 bytes |
| `metadata` | Small metadata (types, counts) | ~100 bytes |
| **TOTAL** | **~500 bytes per event** | **10x smaller!** |

### What We DON'T Store (Already Exists)

| Data | Already Stored In | Retrieved By |
|------|------------------|--------------|
| Message payloads | BullMQ / message archive | `message_id` |
| Actor state | StateStore (CosmosDB) | `actor_id` + `state_version` |
| Journal entries | Actor state metadata | `actor_id` + `entry_index` |
| Documents | CosmosDB containers | `container` + `id` + `partition_key` |

**Result**: Lightweight traces that reference durable state, fully integrated with Loom's existing journal and state management system. No duplication, complete observability.
