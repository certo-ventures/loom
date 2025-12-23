# Observability: Real Implementation Details

## Part 1: Actual Data Structures in CosmosDB

### Container 1: `trace-events` (Trace Events with References)

**Partition Key**: `/trace_id`

**Document Schema**:
```json
{
  "id": "span-1734883523145-abc123",
  "trace_id": "trace-1734883520000-xyz789",
  "span_id": "span-1734883523145-abc123",
  "parent_span_id": "span-1734883520100-def456",
  "event_type": "message:received",
  "timestamp": "2025-12-22T10:15:23.145Z",
  "status": "success",
  
  "refs": {
    "message": {
      "message_id": "msg-abc123",
      "queue_name": "actor:LoanProcessor",
      "correlation_id": "req-xyz789"
    },
    "actor_state": {
      "actor_id": "loan-proc-1",
      "state_version": "2025-12-22T10:15:23.145Z",
      "container": "actor-states",
      "partition_key": "loan-proc-1"
    }
  },
  
  "metadata": {
    "actor_type": "LoanProcessor",
    "message_type": "execute",
    "priority": 0
  },
  
  "tags": ["message", "actor"]
}
```

**Size**: ~800 bytes per document
**TTL**: 90 days (2592000 seconds)

**Indexes** (default is fine):
- `trace_id` - Partition key (automatic)
- `timestamp` - Range index (automatic)

---

### Container 2: `actor-states` (Actor State with Journal)

**Partition Key**: `/id` (same as actor ID)

**Document Schema**:
```json
{
  "id": "loan-proc-1",
  "partitionKey": "loan-proc-1",
  "actorType": "LoanProcessor",
  "status": "active",
  "correlationId": "req-xyz789",
  "createdAt": "2025-12-22T10:15:20.000Z",
  "lastActivatedAt": "2025-12-22T10:15:23.145Z",
  
  "state": {
    "processed_count": 43,
    "current_loan": {
      "applicant": "John Doe",
      "amount": 250000,
      "status": "approved"
    }
  },
  
  "metadata": {
    "journal": {
      "entries": [
        {
          "type": "state_updated",
          "state": {
            "processed_count": 42
          }
        },
        {
          "type": "activity_scheduled",
          "activityId": "act-0",
          "name": "checkCredit",
          "input": { "applicant": "John Doe" }
        },
        {
          "type": "activity_completed",
          "activityId": "act-0",
          "result": { "score": 720 }
        },
        {
          "type": "state_updated",
          "state": {
            "processed_count": 43,
            "current_loan": {
              "applicant": "John Doe",
              "amount": 250000,
              "status": "approved"
            }
          }
        }
      ],
      "cursor": 4
    },
    "state_version": "2025-12-22T10:15:26.500Z"
  }
}
```

**Size**: Varies (KB to MB depending on journal size)
**TTL**: None (persistent until actor deleted)

---

### Container 3: `message-archive` (Archived Messages)

**Partition Key**: `/correlationId`

**Document Schema**:
```json
{
  "id": "msg-abc123",
  "correlationId": "req-xyz789",
  "messageId": "msg-abc123",
  "actorId": "loan-proc-1",
  "messageType": "execute",
  
  "payload": {
    "applicant_name": "John Doe",
    "amount": 250000,
    "credit_score": 720,
    "income": 120000
  },
  
  "metadata": {
    "timestamp": "2025-12-22T10:15:23.000Z",
    "sender": "http-gateway",
    "priority": 0,
    "ttl": 3600000
  },
  
  "archived_at": "2025-12-22T10:20:00.000Z"
}
```

**Size**: Varies (KB to MB depending on payload)
**TTL**: 7 days (604800 seconds)

---

## Part 2: Where and When Trace Events Are Written

### Location 1: `src/runtime/actor-worker.ts`

**EXACTLY where to add code**:

```typescript
import type { Job } from 'bullmq'
import type { Message } from '../types'
import type { ActorRuntime } from '../actor/actor-runtime'

export class ActorWorker {
  private actorType: string
  private runtime: ActorRuntime
  private queueName: string
  
  // ═══════════════════════════════════════════════════════════
  // ADD: Import tracer
  // ═══════════════════════════════════════════════════════════
  private tracer?: TraceWriter
  
  constructor(
    actorType: string, 
    runtime: ActorRuntime,
    tracer?: TraceWriter  // ← ADD THIS
  ) {
    this.actorType = actorType
    this.runtime = runtime
    this.queueName = `actor:${actorType}`
    this.tracer = tracer  // ← ADD THIS
  }
  
  async start(): Promise<void> {
    // BullMQ worker setup (existing code)
    this.worker = new Worker(
      this.queueName,
      async (job: Job<Message>) => {
        await this.processMessage(job.data)
      },
      { connection: this.redisConnection }
    )
  }
  
  // ═══════════════════════════════════════════════════════════
  // MODIFY: processMessage method
  // ═══════════════════════════════════════════════════════════
  private async processMessage(message: Message): Promise<void> {
    const startTime = Date.now()
    const trace = message.trace  // Assuming trace added to Message interface
    
    if (!trace) {
      // No trace context, just process normally
      await this.processWithoutTrace(message)
      return
    }
    
    // Generate span for this message processing
    const span_id = `span-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // ═══════════════════════════════════════════════════════════
    // WRITE 1: message:received event
    // ═══════════════════════════════════════════════════════════
    if (this.tracer) {
      await this.tracer.container.items.create({
        id: span_id,
        trace_id: trace.trace_id,
        span_id: span_id,
        parent_span_id: trace.span_id,
        event_type: 'message:received',
        timestamp: new Date().toISOString(),
        
        refs: {
          message: {
            message_id: message.messageId,
            queue_name: this.queueName,
            correlation_id: message.correlationId
          }
        },
        
        metadata: {
          actor_id: message.actorId,
          actor_type: this.actorType,
          message_type: message.messageType,
          priority: message.metadata.priority
        },
        
        tags: ['message', 'actor']
      })
    }
    
    try {
      // Create actor context with trace
      const actorContext = {
        actorId: message.actorId,
        actorType: this.actorType,
        correlationId: message.correlationId,
        trace: {
          trace_id: trace.trace_id,
          span_id: span_id
        }
      }
      
      // Activate actor
      const actor = await this.runtime.activateActor(
        message.actorId,
        this.actorType,
        actorContext
      )
      
      // Execute
      await actor.handleMessage(message)
      
      // ═══════════════════════════════════════════════════════════
      // WRITE 2: message:completed event
      // ═══════════════════════════════════════════════════════════
      if (this.tracer) {
        const state_version = new Date().toISOString()
        
        await this.tracer.container.items.create({
          id: `span-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          trace_id: trace.trace_id,
          span_id: span_id,
          parent_span_id: trace.span_id,
          event_type: 'message:completed',
          timestamp: new Date().toISOString(),
          status: 'success',
          
          refs: {
            actor_state: {
              actor_id: message.actorId,
              state_version: state_version,
              container: 'actor-states',
              partition_key: message.actorId
            }
          },
          
          metadata: {
            duration_ms: Date.now() - startTime
          },
          
          tags: ['message', 'success']
        })
      }
      
    } catch (error: any) {
      // ═══════════════════════════════════════════════════════════
      // WRITE 3: message:failed event
      // ═══════════════════════════════════════════════════════════
      if (this.tracer) {
        await this.tracer.container.items.create({
          id: `span-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          trace_id: trace.trace_id,
          span_id: span_id,
          parent_span_id: trace.span_id,
          event_type: 'message:failed',
          timestamp: new Date().toISOString(),
          status: 'failed',
          
          refs: {
            message: {
              message_id: message.messageId,
              queue_name: this.queueName,
              correlation_id: message.correlationId
            }
          },
          
          metadata: {
            error: error.message,
            error_type: error.constructor.name,
            stack: error.stack?.slice(0, 500),
            duration_ms: Date.now() - startTime
          },
          
          tags: ['message', 'error']
        })
      }
      
      throw error
    }
  }
}
```

---

### Location 2: `src/actor/actor.ts`

**EXACTLY where to add code**:

```typescript
import type { Journal, JournalEntry, ActorContext } from './journal'
import type { StateStore } from '../storage/state-store'

export abstract class Actor {
  protected state: Record<string, unknown>
  protected context: ActorContext
  private journal: Journal
  private isReplaying: boolean = false
  
  // ═══════════════════════════════════════════════════════════
  // ADD: Tracer reference
  // ═══════════════════════════════════════════════════════════
  private tracer?: TraceWriter
  
  constructor(
    context: ActorContext, 
    initialState?: Record<string, unknown>,
    tracer?: TraceWriter  // ← ADD THIS
  ) {
    this.context = context
    this.state = initialState ?? this.getDefaultState()
    this.journal = { entries: [], cursor: 0 }
    this.tracer = tracer  // ← ADD THIS
  }
  
  /**
   * Update actor state (EXISTING CODE - just add trace emission)
   */
  protected updateState(updates: Record<string, unknown>): void {
    this.state = { ...this.state, ...updates }
    
    if (!this.isReplaying) {
      // ═══════════════════════════════════════════════════════════
      // EXISTING: Save to journal
      // ═══════════════════════════════════════════════════════════
      const entryIndex = this.journal.entries.length
      this.journal.entries.push({
        type: 'state_updated',
        state: this.state,
      })
      
      // ═══════════════════════════════════════════════════════════
      // NEW: Emit trace event with reference to journal entry
      // ═══════════════════════════════════════════════════════════
      if (this.context.trace && this.tracer) {
        const span_id = `span-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        
        this.tracer.container.items.create({
          id: span_id,
          trace_id: this.context.trace.trace_id,
          span_id: span_id,
          parent_span_id: this.context.trace.span_id,
          event_type: 'actor:state_changed',
          timestamp: new Date().toISOString(),
          
          refs: {
            journal_entry: {
              actor_id: this.context.actorId,
              entry_index: entryIndex,
              entry_type: 'state_updated'
            }
          },
          
          metadata: {
            actor_type: this.constructor.name,
            changed_keys: Object.keys(updates)
          },
          
          tags: ['actor', 'state']
        }).catch(err => {
          // Don't fail actor execution if trace write fails
          console.error('Failed to write trace event:', err)
        })
      }
    }
  }
}
```

---

### Location 3: `src/storage/cosmos-state-store.ts`

**EXACTLY where to add code**:

```typescript
import { Container } from '@azure/cosmos'
import type { ActorState } from '../types'
import type { StateStore } from './state-store'

export class CosmosStateStore implements StateStore {
  private container: Container
  
  // ═══════════════════════════════════════════════════════════
  // ADD: Tracer reference
  // ═══════════════════════════════════════════════════════════
  private tracer?: TraceWriter
  
  constructor(container: Container, tracer?: TraceWriter) {
    this.container = container
    this.tracer = tracer
  }
  
  /**
   * Save actor state (EXISTING CODE - add trace emission)
   */
  async save(
    actorId: string, 
    state: ActorState,
    trace?: TraceContext  // ← ADD THIS PARAMETER
  ): Promise<void> {
    const startTime = Date.now()
    
    // ═══════════════════════════════════════════════════════════
    // EXISTING: Write to CosmosDB
    // ═══════════════════════════════════════════════════════════
    const response = await this.container.items.upsert(state)
    
    // ═══════════════════════════════════════════════════════════
    // NEW: Emit trace event with reference to document
    // ═══════════════════════════════════════════════════════════
    if (trace && this.tracer) {
      const span_id = `span-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      
      await this.tracer.container.items.create({
        id: span_id,
        trace_id: trace.trace_id,
        span_id: span_id,
        parent_span_id: trace.span_id,
        event_type: 'cosmosdb:write',
        timestamp: new Date().toISOString(),
        status: 'success',
        
        refs: {
          document: {
            container: this.container.id,
            id: state.id,
            partition_key: state.partitionKey
          }
        },
        
        metadata: {
          actor_type: state.actorType,
          operation: 'upsert',
          ru_consumed: response.requestCharge,
          duration_ms: Date.now() - startTime
        },
        
        tags: ['cosmosdb', 'write']
      })
    }
  }
}
```

---

## Part 3: How Data Is Retrieved (The Real SQL Queries)

### Query 1: Get All Trace Events

**SQL Query**:
```sql
SELECT * 
FROM c 
WHERE c.trace_id = @trace_id 
ORDER BY c.timestamp ASC
```

**CosmosDB Code**:
```typescript
async function getTraceEvents(trace_id: string): Promise<TraceEvent[]> {
  const container = cosmosClient
    .database('loom')
    .container('trace-events')
  
  const querySpec = {
    query: 'SELECT * FROM c WHERE c.trace_id = @trace_id ORDER BY c.timestamp ASC',
    parameters: [
      { name: '@trace_id', value: trace_id }
    ]
  }
  
  const { resources } = await container.items
    .query<TraceEvent>(querySpec)
    .fetchAll()
  
  return resources
}
```

**Performance**:
- Partition key query (fast)
- Returns 10-20 events
- Size: ~10KB
- Time: ~50ms

---

### Query 2: Get Referenced Actor State

**SQL Query**:
```sql
SELECT * 
FROM c 
WHERE c.id = @actor_id
```

**CosmosDB Code**:
```typescript
async function getActorState(actor_id: string): Promise<any> {
  const container = cosmosClient
    .database('loom')
    .container('actor-states')
  
  // Point read (fastest - uses partition key + id)
  const { resource } = await container
    .item(actor_id, actor_id)  // (id, partitionKey)
    .read()
  
  return resource
}
```

**Performance**:
- Point read (fastest possible)
- Size: Varies (KB to MB)
- Time: ~5ms
- Cost: ~1 RU

---

### Query 3: Get Journal Entry from State

**In-Memory Operation**:
```typescript
async function getJournalEntry(
  actor_id: string, 
  entry_index: number
): Promise<JournalEntry | null> {
  // 1. Get actor state (point read)
  const container = cosmosClient
    .database('loom')
    .container('actor-states')
  
  const { resource } = await container
    .item(actor_id, actor_id)
    .read()
  
  if (!resource) return null
  
  // 2. Extract journal from metadata
  const journal = resource.metadata?.journal as Journal
  
  if (!journal) return null
  
  // 3. Return specific entry (in-memory array access)
  return journal.entries[entry_index] || null
}
```

**Performance**:
- 1 point read (~5ms)
- In-memory array access (~0.01ms)
- Total: ~5ms

---

### Query 4: Get Archived Message

**SQL Query**:
```sql
SELECT * 
FROM c 
WHERE c.id = @message_id
```

**CosmosDB Code**:
```typescript
async function getArchivedMessage(message_id: string, correlation_id: string): Promise<any> {
  const container = cosmosClient
    .database('loom')
    .container('message-archive')
  
  // Point read using correlation_id as partition key
  const { resource } = await container
    .item(message_id, correlation_id)
    .read()
  
  return resource
}
```

**Performance**:
- Point read
- Size: Varies (KB to MB)
- Time: ~5ms
- Cost: ~1 RU

---

## Part 4: Message Archival Strategy

### When BullMQ Processes Message

**Location**: `src/runtime/actor-worker.ts`

```typescript
private async processMessage(message: Message): Promise<void> {
  // ═══════════════════════════════════════════════════════════
  // BEFORE processing, archive message for reference
  // ═══════════════════════════════════════════════════════════
  if (this.messageArchive) {
    await this.messageArchive.items.create({
      id: message.messageId,
      correlationId: message.correlationId,  // Partition key
      messageId: message.messageId,
      actorId: message.actorId,
      messageType: message.messageType,
      payload: message.payload,
      metadata: message.metadata,
      archived_at: new Date().toISOString(),
      ttl: 604800  // 7 days
    })
  }
  
  // Now process normally
  // ... existing code ...
}
```

**Why Archive?**
- BullMQ messages expire after processing
- Need reference for trace reconstruction
- Alternative: Query BullMQ directly (but messages expire)

---

## Part 5: Complete Query Flow (Real Implementation)

### Example: Reconstruct Full Trace

```typescript
import { CosmosClient } from '@azure/cosmos'

async function reconstructTrace(trace_id: string) {
  const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING!)
  const database = client.database('loom')
  
  // ═══════════════════════════════════════════════════════════
  // STEP 1: Fetch trace events (partition key query)
  // ═══════════════════════════════════════════════════════════
  const traceContainer = database.container('trace-events')
  
  const { resources: events } = await traceContainer.items
    .query({
      query: 'SELECT * FROM c WHERE c.trace_id = @trace_id ORDER BY c.timestamp ASC',
      parameters: [{ name: '@trace_id', value: trace_id }]
    })
    .fetchAll()
  
  console.log(`Fetched ${events.length} events (${JSON.stringify(events).length / 1024}KB)`)
  
  // ═══════════════════════════════════════════════════════════
  // STEP 2: Display timeline (no additional queries)
  // ═══════════════════════════════════════════════════════════
  console.log('\n━━━ TIMELINE ━━━\n')
  events.forEach(event => {
    console.log(`${event.timestamp} ${event.event_type}`)
    console.log(`  Metadata:`, event.metadata)
    if (event.refs) {
      console.log(`  References:`)
      if (event.refs.message) console.log(`    Message: ${event.refs.message.message_id}`)
      if (event.refs.actor_state) console.log(`    State: ${event.refs.actor_state.actor_id}`)
      if (event.refs.journal_entry) console.log(`    Journal: ${event.refs.journal_entry.actor_id}[${event.refs.journal_entry.entry_index}]`)
    }
    console.log()
  })
  
  // ═══════════════════════════════════════════════════════════
  // STEP 3: Enrich specific event (lazy load)
  // ═══════════════════════════════════════════════════════════
  const messageEvent = events.find(e => e.event_type === 'message:received')
  
  if (messageEvent?.refs?.message) {
    console.log('\n━━━ LOADING MESSAGE ━━━\n')
    
    const messageArchive = database.container('message-archive')
    const { resource: message } = await messageArchive
      .item(
        messageEvent.refs.message.message_id,
        messageEvent.refs.message.correlation_id
      )
      .read()
    
    console.log('Message Payload:')
    console.log(JSON.stringify(message.payload, null, 2))
  }
  
  // ═══════════════════════════════════════════════════════════
  // STEP 4: Load actor state (point read)
  // ═══════════════════════════════════════════════════════════
  const stateEvent = events.find(e => e.refs?.actor_state)
  
  if (stateEvent?.refs?.actor_state) {
    console.log('\n━━━ LOADING STATE ━━━\n')
    
    const stateContainer = database.container('actor-states')
    const { resource: actorState } = await stateContainer
      .item(
        stateEvent.refs.actor_state.actor_id,
        stateEvent.refs.actor_state.actor_id
      )
      .read()
    
    console.log('Actor State:')
    console.log(JSON.stringify(actorState.state, null, 2))
  }
  
  // ═══════════════════════════════════════════════════════════
  // STEP 5: Load journal entry (point read + array access)
  // ═══════════════════════════════════════════════════════════
  const journalEvent = events.find(e => e.refs?.journal_entry)
  
  if (journalEvent?.refs?.journal_entry) {
    console.log('\n━━━ LOADING JOURNAL ENTRY ━━━\n')
    
    const stateContainer = database.container('actor-states')
    const { resource: actorState } = await stateContainer
      .item(
        journalEvent.refs.journal_entry.actor_id,
        journalEvent.refs.journal_entry.actor_id
      )
      .read()
    
    const journal = actorState.metadata?.journal
    const entry = journal?.entries[journalEvent.refs.journal_entry.entry_index]
    
    console.log('Journal Entry:')
    console.log(JSON.stringify(entry, null, 2))
  }
}
```

**Actual Query Count**:
- 1 query: Fetch trace events (partition key query)
- 1 query: Fetch message (point read) - IF user drills down
- 1 query: Fetch state (point read) - IF user drills down
- 0 queries: Get journal entry (already in state)

**Total Cost**:
- Trace events: ~2 RU (partition query)
- Message: ~1 RU (point read)
- State: ~1 RU (point read)
- **Total: ~4 RU per full reconstruction**

---

## Summary: What Actually Happens

### Write Path (3 Places)

1. **ActorWorker.processMessage()** → Write `message:received`, `message:completed`, `message:failed` events
2. **Actor.updateState()** → Write `actor:state_changed` event with journal reference
3. **CosmosStateStore.save()** → Write `cosmosdb:write` event with document reference

### Read Path (Real Queries)

1. **Fetch events**: `SELECT * FROM c WHERE c.trace_id = @trace_id` → 10-20 docs, ~10KB, ~50ms
2. **Get message**: Point read `message-archive/{message_id}` → 1 doc, ~5ms
3. **Get state**: Point read `actor-states/{actor_id}` → 1 doc, ~5ms
4. **Get journal entry**: Extract from state.metadata.journal.entries[index] → In-memory

### Storage Layout

- **trace-events**: Lightweight references (~800 bytes each)
- **actor-states**: Full state + journal (KB to MB)
- **message-archive**: Full messages (KB to MB)

**No duplication, complete observability, 90% cost savings.**
