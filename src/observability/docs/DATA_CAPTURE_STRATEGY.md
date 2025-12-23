# Data Capture Strategy: Tracing Data Flow Through the System

## The Core Question

**Can we reconstruct the actual data that flowed between actors, queues, and data stores?**

**Answer: YES** - The `data` field in TraceEvent can capture payloads, but we need a smart strategy to balance observability with cost/performance/security.

---

## Part 1: What Data To Capture

### Event Types and Their Data

```typescript
interface TraceEvent {
  trace_id: string
  span_id: string
  parent_span_id?: string
  event_type: string
  timestamp: string
  status?: 'success' | 'failed' | 'pending'
  data?: Record<string, any>  // ← THIS IS WHERE DATA GOES
  tags?: string[]
}
```

### Data Capture Matrix

| Event Type | Capture Input? | Capture Output? | Notes |
|------------|---------------|-----------------|-------|
| `message:received` | ✅ Yes | ❌ No | Capture message payload |
| `message:completed` | ❌ No | ✅ Yes | Capture result/output |
| `message:failed` | ❌ No | ⚠️ Partial | Capture error only |
| `actor:created` | ✅ Yes | ❌ No | Capture initial state |
| `actor:state_changed` | ⚠️ Diff only | ⚠️ Diff only | Capture state changes |
| `queue:enqueued` | ✅ Yes | ❌ No | Capture full message |
| `queue:dequeued` | ❌ No | ✅ Yes | Confirm delivery |
| `cosmosdb:write` | ✅ Yes | ⚠️ Document ID | Capture what was written |
| `cosmosdb:read` | ⚠️ Query only | ✅ Yes | Capture query + results |
| `lock:acquired` | ⚠️ Metadata | ❌ No | Lock key, TTL |
| `ai:decision` | ✅ Yes | ✅ Yes | Input prompt + decision |
| `saga:compensating` | ✅ Yes | ❌ No | Original action data |

**Legend**:
- ✅ Yes = Capture full data
- ⚠️ Partial = Capture metadata/summary
- ❌ No = Skip (not useful)

---

## Part 2: Implementation Examples

### Example 1: Capturing Message Data

```typescript
// src/runtime/actor-worker.ts
private async processMessage(message: Message): Promise<void> {
  const { trace } = message
  const span_id = generateId()
  
  // ✅ CAPTURE INPUT: Store the full message payload
  await tracer.emit({
    trace_id: trace.trace_id,
    span_id,
    parent_span_id: trace.span_id,
    event_type: 'message:received',
    timestamp: new Date().toISOString(),
    data: {
      actor_id: message.actorId,
      actor_type: this.actorType,
      message_type: message.messageType,
      // ✅ Capture the actual payload that was sent
      payload: message.payload,  // Full input data
      metadata: {
        correlation_id: message.correlationId,
        priority: message.metadata.priority
      }
    }
  })
  
  try {
    const actor = await this.runtime.activateActor(/*...*/)
    
    // Execute and capture result
    const result = await actor.handleMessage(message)
    
    // ✅ CAPTURE OUTPUT: Store the result
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      event_type: 'message:completed',
      timestamp: new Date().toISOString(),
      status: 'success',
      data: {
        // ✅ Capture the actual result returned
        result: result,  // Full output data
        duration_ms: Date.now() - startTime
      }
    })
    
  } catch (error) {
    // ✅ CAPTURE ERROR: Store error details
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      event_type: 'message:failed',
      timestamp: new Date().toISOString(),
      status: 'failed',
      data: {
        error: error.message,
        error_type: error.constructor.name,
        stack: error.stack,  // For debugging
        input_that_caused_failure: message.payload  // What caused it
      }
    })
  }
}
```

### Example 2: Capturing Actor State Changes

```typescript
// src/actor/actor.ts
export abstract class Actor {
  protected async setState(newState: Record<string, unknown>): Promise<void> {
    const oldState = { ...this.state }
    
    // Update state
    this.state = { ...this.state, ...newState }
    await this.stateStore.save(this.actorId, { 
      id: this.actorId,
      state: this.state,
      /* ... */
    })
    
    // ✅ CAPTURE STATE CHANGE: Store what changed
    await this.emitEvent('actor:state_changed', {
      actor_id: this.actorId,
      // Store the diff, not full state (efficiency)
      changes: computeStateDiff(oldState, this.state),
      // Or store full states if small:
      previous_state: oldState,
      new_state: this.state
    })
  }
  
  // Helper to compute state diff
  private computeStateDiff(
    oldState: Record<string, unknown>,
    newState: Record<string, unknown>
  ): Record<string, { old: any; new: any }> {
    const diff: Record<string, { old: any; new: any }> = {}
    
    // Find changes
    Object.keys(newState).forEach(key => {
      if (JSON.stringify(oldState[key]) !== JSON.stringify(newState[key])) {
        diff[key] = { old: oldState[key], new: newState[key] }
      }
    })
    
    return diff
  }
}
```

### Example 3: Capturing Queue Operations

```typescript
// src/storage/bullmq-message-queue.ts (hypothetical)
export class BullMQMessageQueue implements MessageQueue {
  async enqueue(queueName: string, message: Message): Promise<void> {
    // ✅ CAPTURE ENQUEUE: Record what was queued
    if (message.trace) {
      await tracer.emit({
        trace_id: message.trace.trace_id,
        span_id: generateId(),
        parent_span_id: message.trace.span_id,
        event_type: 'queue:enqueued',
        timestamp: new Date().toISOString(),
        data: {
          queue_name: queueName,
          message_id: message.messageId,
          // ✅ Store the full message for replay capability
          message: message,
          // Metadata
          priority: message.metadata.priority,
          ttl: message.metadata.ttl
        },
        tags: ['queue', 'bullmq']
      })
    }
    
    // Actually enqueue
    await this.queue.add(queueName, message)
  }
  
  async dequeue(queueName: string): Promise<Message | null> {
    const message = await this.queue.process(queueName)
    
    if (message && message.trace) {
      // ✅ CAPTURE DEQUEUE: Record message was received
      await tracer.emit({
        trace_id: message.trace.trace_id,
        span_id: generateId(),
        parent_span_id: message.trace.span_id,
        event_type: 'queue:dequeued',
        timestamp: new Date().toISOString(),
        data: {
          queue_name: queueName,
          message_id: message.messageId,
          // Calculate queue latency
          queue_latency_ms: Date.now() - new Date(message.metadata.timestamp).getTime()
        },
        tags: ['queue', 'bullmq']
      })
    }
    
    return message
  }
}
```

### Example 4: Capturing CosmosDB Operations

```typescript
// src/storage/cosmos-state-store.ts
export class CosmosStateStore implements StateStore {
  async save(actorId: string, state: ActorState, trace?: TraceContext): Promise<void> {
    const startTime = Date.now()
    
    // Actually write to Cosmos
    await this.container.items.upsert(state)
    
    // ✅ CAPTURE WRITE: Record what was written
    if (trace) {
      await tracer.emit({
        trace_id: trace.trace_id,
        span_id: generateId(),
        parent_span_id: trace.span_id,
        event_type: 'cosmosdb:write',
        timestamp: new Date().toISOString(),
        data: {
          container: this.container.id,
          document_id: state.id,
          partition_key: state.partitionKey,
          // ✅ Store full document (or summary if large)
          document: state,  // Full data
          // Metadata
          operation: 'upsert',
          duration_ms: Date.now() - startTime,
          ru_consumed: response.requestCharge  // Cost tracking!
        },
        tags: ['cosmosdb', 'write']
      })
    }
  }
  
  async load(actorId: string, trace?: TraceContext): Promise<ActorState | null> {
    const startTime = Date.now()
    
    // Query Cosmos
    const query = `SELECT * FROM c WHERE c.id = @actorId`
    const { resources, requestCharge } = await this.container.items
      .query({ query, parameters: [{ name: '@actorId', value: actorId }] })
      .fetchAll()
    
    const state = resources[0] || null
    
    // ✅ CAPTURE READ: Record what was read
    if (trace) {
      await tracer.emit({
        trace_id: trace.trace_id,
        span_id: generateId(),
        parent_span_id: trace.span_id,
        event_type: 'cosmosdb:read',
        timestamp: new Date().toISOString(),
        data: {
          container: this.container.id,
          query: query,
          document_id: actorId,
          // ✅ Store result
          result: state,  // Full data returned
          // Metadata
          found: state !== null,
          duration_ms: Date.now() - startTime,
          ru_consumed: requestCharge  // Cost tracking!
        },
        tags: ['cosmosdb', 'read']
      })
    }
    
    return state
  }
}
```

### Example 5: Capturing AI Decision Data

```typescript
// src/ai/agent.ts (hypothetical)
export class AIAgent {
  async makeDecision(
    prompt: string,
    context: any,
    trace: TraceContext
  ): Promise<AIDecision> {
    const span_id = generateId()
    
    // ✅ CAPTURE INPUT: Store the prompt and context
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      parent_span_id: trace.span_id,
      event_type: 'ai:decision_requested',
      timestamp: new Date().toISOString(),
      data: {
        // ✅ Full prompt for reproducibility
        prompt: prompt,
        context: context,
        model: this.config.model,
        temperature: this.config.temperature
      },
      tags: ['ai', 'llm']
    })
    
    // Call LLM
    const startTime = Date.now()
    const response = await this.llm.complete({
      messages: [{ role: 'user', content: prompt }],
      context
    })
    
    // ✅ CAPTURE OUTPUT: Store the decision
    await tracer.emit({
      trace_id: trace.trace_id,
      span_id,
      event_type: 'ai:decision_made',
      timestamp: new Date().toISOString(),
      status: 'success',
      data: {
        // ✅ Full response for audit trail
        decision: response.decision,
        reasoning: response.reasoning,
        confidence: response.confidence,
        // Metadata
        tokens_used: response.usage.total_tokens,
        duration_ms: Date.now() - startTime,
        cost_usd: calculateCost(response.usage)
      },
      tags: ['ai', 'llm', 'decision']
    })
    
    return response
  }
}
```

---

## Part 3: Data Reconstruction Query

### Query to Reconstruct Full Data Flow

```typescript
async function reconstructDataFlow(trace_id: string) {
  const reader = new TraceReader(cosmosContainer)
  const events = await reader.getTrace(trace_id)
  const query = new TraceQuery(events)
  
  console.log('\n📦 DATA FLOW RECONSTRUCTION\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  
  const path = query.getPath()
  
  path.forEach((event, i) => {
    console.log(`\n${i + 1}. ${event.event_type} [${new Date(event.timestamp).toLocaleTimeString()}]`)
    console.log('   ' + '─'.repeat(60))
    
    // Show input data
    if (event.event_type.includes('received') || 
        event.event_type.includes('requested') ||
        event.event_type.includes('enqueued')) {
      console.log('   📥 INPUT:')
      console.log('   ' + JSON.stringify(event.data?.payload || event.data, null, 2)
        .split('\n')
        .map(line => '      ' + line)
        .join('\n'))
    }
    
    // Show output data
    if (event.event_type.includes('completed') || 
        event.event_type.includes('made') ||
        event.event_type.includes('write')) {
      console.log('   📤 OUTPUT:')
      console.log('   ' + JSON.stringify(event.data?.result || event.data, null, 2)
        .split('\n')
        .map(line => '      ' + line)
        .join('\n'))
    }
    
    // Show error data
    if (event.status === 'failed') {
      console.log('   ❌ ERROR:')
      console.log(`      ${event.data?.error}`)
      if (event.data?.input_that_caused_failure) {
        console.log('   💥 FAILED INPUT:')
        console.log('   ' + JSON.stringify(event.data.input_that_caused_failure, null, 2)
          .split('\n')
          .map(line => '      ' + line)
          .join('\n'))
      }
    }
    
    // Show state changes
    if (event.event_type === 'actor:state_changed') {
      console.log('   🔄 STATE CHANGES:')
      Object.entries(event.data?.changes || {}).forEach(([key, change]: [string, any]) => {
        console.log(`      ${key}: ${JSON.stringify(change.old)} → ${JSON.stringify(change.new)}`)
      })
    }
  })
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}
```

### Example Output

```
📦 DATA FLOW RECONSTRUCTION

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. http:request [10:15:23]
   ────────────────────────────────────────────────────────────
   📥 INPUT:
      {
        "method": "POST",
        "path": "/api/loans",
        "body": {
          "applicant_name": "John Doe",
          "amount": 250000,
          "income": 120000,
          "credit_score": 720
        },
        "user_id": "user-123"
      }

2. queue:enqueued [10:15:23]
   ────────────────────────────────────────────────────────────
   📥 INPUT:
      {
        "queue_name": "loan-processor",
        "message": {
          "actorId": "loan-proc-1",
          "messageType": "execute",
          "payload": {
            "applicant_name": "John Doe",
            "amount": 250000,
            "income": 120000,
            "credit_score": 720
          }
        }
      }

3. message:received [10:15:23]
   ────────────────────────────────────────────────────────────
   📥 INPUT:
      {
        "actor_type": "LoanProcessor",
        "payload": {
          "applicant_name": "John Doe",
          "amount": 250000,
          "income": 120000,
          "credit_score": 720
        }
      }

4. cosmosdb:read [10:15:23]
   ────────────────────────────────────────────────────────────
   📤 OUTPUT:
      {
        "query": "SELECT * FROM c WHERE c.id = @actorId",
        "result": {
          "id": "loan-proc-1",
          "state": {
            "processed_count": 42,
            "last_processed": "2025-12-21T..."
          }
        },
        "found": true,
        "ru_consumed": 2.85
      }

5. ai:decision_requested [10:15:24]
   ────────────────────────────────────────────────────────────
   📥 INPUT:
      {
        "prompt": "Analyze loan application for risk...",
        "context": {
          "applicant_name": "John Doe",
          "amount": 250000,
          "income": 120000,
          "credit_score": 720,
          "debt_to_income": 0.35
        },
        "model": "gpt-4",
        "temperature": 0.1
      }

6. ai:decision_made [10:15:26]
   ────────────────────────────────────────────────────────────
   📤 OUTPUT:
      {
        "decision": "APPROVE",
        "reasoning": "Strong credit score, good income, manageable DTI ratio",
        "confidence": 0.92,
        "recommended_rate": 6.5,
        "tokens_used": 1250,
        "cost_usd": 0.025
      }

7. actor:state_changed [10:15:26]
   ────────────────────────────────────────────────────────────
   🔄 STATE CHANGES:
      processed_count: 42 → 43
      last_processed: "2025-12-21T..." → "2025-12-22T10:15:26Z"
      last_decision: null → "APPROVE"

8. cosmosdb:write [10:15:26]
   ────────────────────────────────────────────────────────────
   📤 OUTPUT:
      {
        "document": {
          "id": "loan-proc-1",
          "state": {
            "processed_count": 43,
            "last_processed": "2025-12-22T10:15:26Z",
            "last_decision": "APPROVE"
          }
        },
        "ru_consumed": 5.2
      }

9. message:completed [10:15:26]
   ────────────────────────────────────────────────────────────
   📤 OUTPUT:
      {
        "result": {
          "approved": true,
          "rate": 6.5,
          "reasoning": "Strong credit score...",
          "confidence": 0.92
        },
        "duration_ms": 3145
      }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Part 4: Strategies for Large/Sensitive Data

### Strategy 1: Truncation

```typescript
function captureSafely(data: any, maxBytes = 10_000): any {
  const json = JSON.stringify(data)
  
  if (json.length > maxBytes) {
    return {
      _truncated: true,
      _original_size: json.length,
      _preview: JSON.parse(json.slice(0, maxBytes))
    }
  }
  
  return data
}

// Usage:
await tracer.emit({
  trace_id: trace.trace_id,
  span_id: generateId(),
  event_type: 'message:received',
  data: {
    payload: captureSafely(message.payload)  // Auto-truncate if too large
  }
})
```

### Strategy 2: References for Large Data

```typescript
// For large documents, store reference instead of full data
await tracer.emit({
  trace_id: trace.trace_id,
  span_id: generateId(),
  event_type: 'cosmosdb:write',
  data: {
    container: 'documents',
    document_id: largeDoc.id,
    // Don't store the 10MB document itself
    document_size_bytes: JSON.stringify(largeDoc).length,
    // Store reference instead
    document_ref: {
      container: 'documents',
      id: largeDoc.id,
      partition_key: largeDoc.pk,
      _link: `/documents/${largeDoc.id}`
    },
    // Store metadata
    metadata: {
      type: largeDoc.type,
      created_at: largeDoc.created_at
    }
  }
})
```

### Strategy 3: PII Redaction

```typescript
function redactPII(data: any): any {
  const redacted = { ...data }
  
  // Redact sensitive fields
  const sensitiveFields = ['ssn', 'credit_card', 'password', 'api_key']
  
  Object.keys(redacted).forEach(key => {
    if (sensitiveFields.includes(key.toLowerCase())) {
      redacted[key] = '[REDACTED]'
    }
  })
  
  return redacted
}

// Usage:
await tracer.emit({
  trace_id: trace.trace_id,
  span_id: generateId(),
  event_type: 'message:received',
  data: {
    payload: redactPII(message.payload)  // Auto-redact PII
  },
  tags: ['pii-redacted']
})
```

### Strategy 4: Sampling

```typescript
// Only capture full data for X% of requests
function shouldCaptureFullData(trace_id: string, sampleRate = 0.1): boolean {
  // Hash trace_id to get consistent sampling
  const hash = simpleHash(trace_id)
  return (hash % 100) < (sampleRate * 100)
}

// Usage:
const captureFullData = shouldCaptureFullData(trace.trace_id, 0.1) // 10%

await tracer.emit({
  trace_id: trace.trace_id,
  span_id: generateId(),
  event_type: 'message:received',
  data: captureFullData ? {
    payload: message.payload  // Full data (10% of requests)
  } : {
    payload_summary: {
      size_bytes: JSON.stringify(message.payload).length,
      keys: Object.keys(message.payload)
    }  // Summary only (90% of requests)
  }
})
```

---

## Part 5: Benefits of Data Capture

### 1. Full Reproducibility
```typescript
// Replay exact input that caused failure
const failureEvent = events.find(e => e.status === 'failed')
const originalInput = failureEvent.data?.input_that_caused_failure

// Replay in test environment
await actor.handleMessage({
  payload: originalInput,
  trace: createRootTrace()
})
```

### 2. Data Lineage
```typescript
// Trace how data transformed through pipeline
const inputEvent = events.find(e => e.event_type === 'message:received')
const outputEvent = events.find(e => e.event_type === 'message:completed')

console.log('Input:', inputEvent.data?.payload)
console.log('Output:', outputEvent.data?.result)
console.log('Transformation:', {
  from: inputEvent.data?.payload,
  to: outputEvent.data?.result
})
```

### 3. Audit Trail
```typescript
// Show exactly what AI decided and why
const aiEvents = events.filter(e => e.event_type.includes('ai:'))

aiEvents.forEach(event => {
  console.log('Decision:', event.data?.decision)
  console.log('Reasoning:', event.data?.reasoning)
  console.log('Confidence:', event.data?.confidence)
  console.log('Based on input:', event.data?.context)
})
```

### 4. Cost Analysis
```typescript
// Sum up RU consumption across all Cosmos operations
const cosmosEvents = events.filter(e => e.event_type.includes('cosmosdb:'))
const totalRU = cosmosEvents.reduce((sum, e) => sum + (e.data?.ru_consumed || 0), 0)

console.log(`Total RU consumed: ${totalRU}`)
console.log(`Estimated cost: $${(totalRU / 100 * 0.008).toFixed(4)}`)
```

---

## Summary

**Yes, you can reconstruct the complete data flow:**

| Component | Input Capture | Output Capture | Use Case |
|-----------|--------------|----------------|----------|
| **Actors** | ✅ Message payload | ✅ Return value | Reproduce behavior |
| **Message Queue** | ✅ Full message | ✅ Delivery confirmation | Debug message flow |
| **CosmosDB** | ✅ Query/Document | ✅ Result + RU cost | Track data changes |
| **Locks** | ⚠️ Metadata only | ❌ N/A | Debug contention |
| **AI/LLM** | ✅ Prompt + context | ✅ Decision + reasoning | Audit decisions |
| **State Changes** | ✅ Previous state | ✅ New state | Track mutations |

**Best Practices:**
1. ✅ Capture input/output at integration boundaries (actors, queues, DB)
2. ✅ Use truncation for large payloads (>10KB)
3. ✅ Use references for binary/huge data
4. ✅ Redact PII automatically
5. ✅ Sample full data capture (10-20% of requests)
6. ✅ Always capture metadata (sizes, costs, durations)

**Result:** Complete observability into "what data flowed where" with smart cost controls.
