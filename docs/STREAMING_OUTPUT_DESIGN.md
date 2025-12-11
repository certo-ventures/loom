# Streaming Output Design for Loom

## Problem Statement

### Current State (Request-Response)
```typescript
// Actor processes entire request, then returns
const result = await actor.execute(input)
console.log(result) // All at once after completion
```

**Issues:**
- ❌ Long-running AI calls feel "frozen" (no progress feedback)
- ❌ Can't show partial results (user waits for everything)
- ❌ Timeouts on slow operations
- ❌ No way to cancel in-progress work
- ❌ Poor UX for chat/generation (want token-by-token)

### Desired State (Streaming)
```typescript
// Actor streams results as they're generated
for await (const chunk of actor.stream(input)) {
  console.log(chunk) // See progress in real-time
}
```

**Benefits:**
- ✅ Real-time progress feedback
- ✅ Partial results immediately useful
- ✅ Can cancel mid-stream
- ✅ Better UX (like ChatGPT streaming)
- ✅ Support large responses (streaming prevents memory issues)

---

## Use Cases

### 1. **AI Agent Streaming (Primary Use Case)**
```typescript
// Streaming chat response
for await (const token of aiAgent.stream("Write a story")) {
  process.stdout.write(token) // "Once"..." upon"..." a"..." time"...
}
```
- **LLM tokens** arrive one-by-one
- **User sees progress** like ChatGPT
- **Can stop generation** mid-stream

### 2. **Long-Running Workflow Progress**
```typescript
// Workflow with multiple steps
for await (const update of workflow.stream()) {
  console.log(update.step, update.status, update.result)
  // Step 1: Analyzing... ✓
  // Step 2: Processing... ✓
  // Step 3: Generating... ⏳
}
```
- **Progress updates** from each action
- **Partial results** available immediately
- **Better debugging** (see where it fails)

### 3. **Activity Processing Chunks**
```typescript
// Activity processes large dataset
for await (const batch of activity.stream(largeDataset)) {
  console.log(`Processed batch: ${batch.count} items`)
  // Processed batch: 100 items
  // Processed batch: 100 items
  // ...
}
```
- **Batch processing** with progress
- **Memory efficient** (stream chunks)
- **Early results** available

### 4. **Multi-Agent Collaboration**
```typescript
// Multiple agents contribute to result
for await (const contribution of team.stream(task)) {
  console.log(`${contribution.actor}: ${contribution.output}`)
  // Researcher: Found 3 sources...
  // Analyst: Analyzing data...
  // Writer: Drafting report...
}
```
- **See each agent's work** as it happens
- **Pipeline visibility**
- **Better coordination**

---

## Design Options

### Option 1: **Async Generators (JavaScript Native)**

**Concept:** Use async generator functions (`async function*`)

```typescript
// Actor with streaming
class StreamingActor extends Actor {
  async *stream(input: any): AsyncGenerator<any, void, unknown> {
    // Yield results as they're available
    yield { status: 'started' }
    
    const step1 = await this.step1(input)
    yield { step: 1, result: step1 }
    
    const step2 = await this.step2(step1)
    yield { step: 2, result: step2 }
    
    yield { status: 'complete', final: step2 }
  }
}

// Consumer
for await (const chunk of actor.stream(input)) {
  console.log(chunk)
}
```

**Pros:**
- ✅ Native JavaScript (no dependencies)
- ✅ Simple mental model
- ✅ Backpressure built-in (consumer controls flow)
- ✅ Can use `for await...of` syntax
- ✅ Easy to implement

**Cons:**
- ❌ In-process only (doesn't work across network)
- ❌ Not serializable (can't send over queue)
- ❌ Actor must be in same process

---

### Option 2: **Server-Sent Events (SSE)**

**Concept:** Use HTTP SSE protocol for streaming

```typescript
// Actor exposes SSE endpoint
app.get('/actor/:id/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  
  // Stream events
  for await (const chunk of actor.stream(input)) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  }
  
  res.end()
})

// Consumer
const eventSource = new EventSource('/actor/123/stream')
eventSource.onmessage = (event) => {
  const chunk = JSON.parse(event.data)
  console.log(chunk)
}
```

**Pros:**
- ✅ Works over HTTP (remote actors)
- ✅ Standard protocol (browser support)
- ✅ Automatic reconnection
- ✅ Simple server-side

**Cons:**
- ❌ HTTP only (not for queue-based)
- ❌ One-way only (can't send back)
- ❌ Browser-specific (Node needs polyfill)

---

### Option 3: **WebSockets**

**Concept:** Bidirectional streaming over WebSocket

```typescript
// Actor with WebSocket
const ws = new WebSocket('/actor/123/stream')

// Send input
ws.send(JSON.stringify({ action: 'start', input }))

// Receive stream
ws.onmessage = (event) => {
  const chunk = JSON.parse(event.data)
  console.log(chunk)
}

// Can cancel
ws.send(JSON.stringify({ action: 'cancel' }))
```

**Pros:**
- ✅ Bidirectional (can cancel, adjust)
- ✅ Works over network
- ✅ Real-time updates
- ✅ Can send control messages

**Cons:**
- ❌ More complex (need WS server)
- ❌ Connection management overhead
- ❌ Overkill for simple streaming

---

### Option 4: **Redis Streams (Distributed)**

**Concept:** Use Redis Streams for distributed streaming

```typescript
// Actor writes to Redis Stream
await redis.xadd('stream:actor-123', '*', 
  'type', 'chunk',
  'data', JSON.stringify(chunk)
)

// Consumer reads from stream
const results = await redis.xread(
  'BLOCK', 5000,
  'STREAMS', 'stream:actor-123', lastId
)

for (const [_stream, messages] of results) {
  for (const [id, fields] of messages) {
    const chunk = JSON.parse(fields[1])
    console.log(chunk)
  }
}
```

**Pros:**
- ✅ Distributed (works across network)
- ✅ Durable (survives crashes)
- ✅ Multiple consumers (pub/sub style)
- ✅ Can replay from any point
- ✅ Integrates with our Redis infrastructure

**Cons:**
- ❌ More complex than async generators
- ❌ Need polling or blocking reads
- ❌ Stream cleanup required

---

### Option 5: **Hybrid Approach** ⭐ **RECOMMENDED**

**Concept:** Use async generators for local, Redis Streams for distributed

```typescript
// Interface for streaming
interface Streamable<T> {
  stream(input: any): AsyncGenerator<T, void, unknown>
}

// Local actor (async generator)
class LocalActor implements Streamable<any> {
  async *stream(input: any) {
    yield { status: 'processing' }
    const result = await this.process(input)
    yield { status: 'complete', result }
  }
}

// Remote actor (Redis Stream bridge)
class RemoteActor implements Streamable<any> {
  async *stream(input: any) {
    // Send message to remote actor via queue
    const streamId = generateId()
    await this.messageQueue.send('actor-123', {
      action: 'stream',
      streamId,
      input
    })
    
    // Read from Redis Stream
    let lastId = '0'
    while (true) {
      const chunks = await redis.xread('BLOCK', 1000, 'STREAMS', streamId, lastId)
      
      for (const chunk of chunks) {
        yield chunk.data
        
        if (chunk.type === 'complete') {
          return
        }
        
        lastId = chunk.id
      }
    }
  }
}
```

**Pros:**
- ✅ Simple for local actors (async generators)
- ✅ Works for remote actors (Redis Streams)
- ✅ Same interface for both (`for await...of`)
- ✅ Flexible (use what you need)
- ✅ Integrates with existing infrastructure

**Cons:**
- ❌ More code (two implementations)

---

## Recommended Implementation

### Phase 1: Async Generators (Local Streaming)

**Add streaming to Actor base class:**

```typescript
// src/actor/actor.ts
export abstract class Actor {
  // Existing execute method
  abstract execute(input: any, context: ActorContext): Promise<any>
  
  // NEW: Streaming method (optional override)
  async *stream(input: any, context: ActorContext): AsyncGenerator<StreamChunk, void, unknown> {
    // Default: wrap execute() in single chunk
    const result = await this.execute(input, context)
    yield { type: 'complete', data: result }
  }
}

// Stream chunk format
interface StreamChunk {
  type: 'start' | 'progress' | 'data' | 'complete' | 'error'
  data?: any
  error?: Error
  progress?: {
    current: number
    total: number
    message?: string
  }
}
```

**Example streaming actor:**

```typescript
// AI agent with streaming
class ChatActor extends Actor {
  async *stream(input: any, context: ActorContext) {
    yield { type: 'start', data: { message: 'Starting generation...' } }
    
    // Stream tokens from AI
    let fullResponse = ''
    for await (const token of context.ai.streamCompletion(input.prompt)) {
      fullResponse += token
      yield {
        type: 'data',
        data: { token, fullResponse }
      }
    }
    
    yield {
      type: 'complete',
      data: { fullResponse }
    }
  }
}

// Usage
for await (const chunk of chatActor.stream(input, context)) {
  if (chunk.type === 'data') {
    process.stdout.write(chunk.data.token)
  }
}
```

**Workflow executor with streaming:**

```typescript
// src/workflow/index.ts
export class WorkflowExecutor {
  async *stream(definition: WorkflowDefinition, input: any): AsyncGenerator<WorkflowStreamChunk> {
    yield { type: 'start', workflow: definition.name }
    
    for (const action of definition.actions) {
      yield {
        type: 'action-start',
        action: action.name,
        actionType: action.type
      }
      
      const result = await this.executeAction(action, input)
      
      yield {
        type: 'action-complete',
        action: action.name,
        result
      }
    }
    
    yield { type: 'complete' }
  }
}
```

**~80 lines of code**

---

### Phase 2: Redis Streams (Distributed Streaming)

**Add Redis Stream support:**

```typescript
// src/streaming/redis-stream-publisher.ts
export class RedisStreamPublisher {
  constructor(private redis: RedisClient, private streamId: string) {}
  
  async publish(chunk: StreamChunk): Promise<void> {
    await this.redis.xadd(
      `stream:${this.streamId}`,
      '*',
      'type', chunk.type,
      'data', JSON.stringify(chunk.data)
    )
  }
  
  async complete(): Promise<void> {
    await this.publish({ type: 'complete' })
    // Cleanup after 1 hour
    await this.redis.expire(`stream:${this.streamId}`, 3600)
  }
}

// src/streaming/redis-stream-consumer.ts
export class RedisStreamConsumer {
  async *read(streamId: string): AsyncGenerator<StreamChunk> {
    let lastId = '0'
    
    while (true) {
      const results = await this.redis.xread(
        'BLOCK', 1000,
        'STREAMS', `stream:${streamId}`, lastId
      )
      
      if (!results) continue
      
      for (const [_stream, messages] of results) {
        for (const [id, fields] of messages) {
          const chunk: StreamChunk = {
            type: fields[1] as any,
            data: JSON.parse(fields[3])
          }
          
          yield chunk
          lastId = id
          
          if (chunk.type === 'complete' || chunk.type === 'error') {
            return
          }
        }
      }
    }
  }
}
```

**Remote actor with streaming:**

```typescript
// src/actor/remote-streaming-actor.ts
export class RemoteStreamingActor {
  async *stream(input: any): AsyncGenerator<StreamChunk> {
    const streamId = generateId()
    
    // Send message to remote actor
    await this.messageQueue.send(this.actorAddress, {
      action: 'stream',
      streamId,
      input
    })
    
    // Read from Redis Stream
    const consumer = new RedisStreamConsumer(this.redis)
    yield* consumer.read(streamId)
  }
}

// Actor worker processes streaming request
class ActorWorker {
  async processStreamRequest(message: any) {
    const publisher = new RedisStreamPublisher(this.redis, message.streamId)
    
    try {
      // Call actor's stream method
      for await (const chunk of this.actor.stream(message.input, this.context)) {
        await publisher.publish(chunk)
      }
      await publisher.complete()
    } catch (error) {
      await publisher.publish({ type: 'error', error })
    }
  }
}
```

**~150 lines of code**

---

### Phase 3: AI Agent Streaming (OpenAI Integration)

**Add streaming to AI service:**

```typescript
// src/ai/ai-service.ts
export class AIService {
  // Existing method
  async complete(prompt: string, options?: any): Promise<string> {
    // ...
  }
  
  // NEW: Streaming completion
  async *streamCompletion(prompt: string, options?: any): AsyncGenerator<string> {
    const stream = await this.openai.chat.completions.create({
      model: options?.model || 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      stream: true // Enable streaming
    })
    
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content
      if (token) {
        yield token
      }
    }
  }
}

// Actor context includes streaming AI
export interface ActorContext {
  ai: {
    complete(prompt: string): Promise<string>
    streamCompletion(prompt: string): AsyncGenerator<string>
  }
}
```

**~50 lines of code**

---

## API Design

### Consumer-Facing API

```typescript
// 1. Simple iteration
for await (const chunk of actor.stream(input)) {
  console.log(chunk)
}

// 2. With error handling
try {
  for await (const chunk of actor.stream(input)) {
    if (chunk.type === 'error') {
      console.error(chunk.error)
      break
    }
    console.log(chunk.data)
  }
} catch (error) {
  console.error('Stream failed:', error)
}

// 3. Collect all chunks
const chunks: StreamChunk[] = []
for await (const chunk of actor.stream(input)) {
  chunks.push(chunk)
}

// 4. With progress callback
async function processWithProgress(actor: Actor, input: any) {
  for await (const chunk of actor.stream(input)) {
    if (chunk.type === 'progress') {
      updateProgressBar(chunk.progress)
    } else if (chunk.type === 'data') {
      processChunk(chunk.data)
    }
  }
}
```

### Producer-Facing API (Actor)

```typescript
// Streaming actor implementation
class MyStreamingActor extends Actor {
  async *stream(input: any, context: ActorContext) {
    // 1. Start notification
    yield { type: 'start' }
    
    // 2. Progress updates
    for (let i = 0; i < 10; i++) {
      await doWork(i)
      yield {
        type: 'progress',
        progress: { current: i + 1, total: 10 }
      }
    }
    
    // 3. Partial data
    yield { type: 'data', data: partialResult }
    
    // 4. Complete
    yield { type: 'complete', data: finalResult }
  }
}
```

---

## Integration with Existing Components

### 1. **Workflow Executor**
```typescript
// Workflow action can be streaming
{
  "type": "actor",
  "actorType": "chat-agent",
  "streaming": true // NEW: Enable streaming
}

// Workflow executor yields progress
for await (const update of executor.stream(workflow, input)) {
  // update.action, update.result
}
```

### 2. **HTTP API**
```typescript
// REST endpoint with SSE
app.get('/actor/:type/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  
  const actor = registry.get(req.params.type)
  for await (const chunk of actor.stream(req.body)) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  }
  res.end()
})
```

### 3. **CLI**
```typescript
// CLI command
$ loom actor run chat-agent --stream

// Shows progress
⠋ Processing...
📝 Generated 50 tokens...
📝 Generated 100 tokens...
✓ Complete! (150 tokens)
```

---

## Comparison with Other Frameworks

| Framework | Streaming Approach |
|-----------|-------------------|
| **LangChain** | Callbacks + AsyncGenerator |
| **LangGraph** | StreamMode.values() |
| **AutoGen** | No native streaming |
| **Semantic Kernel** | IAsyncEnumerable (C#) |
| **Dapr** | Bindings output streaming |
| **Loom** | AsyncGenerator + Redis Streams |

---

## Implementation Plan

### Phase 1: Local Streaming (80 lines)
**Files:**
- `src/actor/actor.ts` - Add `stream()` method
- `src/streaming/types.ts` - StreamChunk interface
- `src/ai/ai-service.ts` - Add `streamCompletion()`
- `src/tests/streaming/local-streaming.test.ts` - Tests

**Effort:** ~2 hours

### Phase 2: Distributed Streaming (150 lines)
**Files:**
- `src/streaming/redis-stream-publisher.ts`
- `src/streaming/redis-stream-consumer.ts`
- `src/actor/remote-streaming-actor.ts`
- `src/actor/actor-worker.ts` - Handle stream requests
- `src/tests/streaming/remote-streaming.test.ts` - Tests

**Effort:** ~3 hours

### Phase 3: Workflow Streaming (50 lines)
**Files:**
- `src/workflow/index.ts` - Add `stream()` to executor
- `src/tests/workflow/streaming-workflow.test.ts` - Tests

**Effort:** ~1 hour

**Total: ~280 lines, ~6 hours**

---

## Key Design Decisions

### 1. **Async Generators for Local, Redis Streams for Remote**
- **Rationale:** Simple when possible, distributed when needed
- **Trade-off:** Two implementations vs. one-size-fits-all

### 2. **Unified StreamChunk Interface**
- **Rationale:** Consistent experience regardless of local/remote
- **Trade-off:** Fixed schema vs. flexible format

### 3. **Optional Streaming (Not Required)**
- **Rationale:** Not all actors need streaming, default wraps execute()
- **Trade-off:** Two code paths vs. everything streaming

### 4. **No Backpressure Control (Initially)**
- **Rationale:** Keep simple, async generators have built-in backpressure
- **Trade-off:** Can't throttle producer from consumer (add later if needed)

---

## Conclusion

**Streaming Output is essential for:**
1. ✅ AI agents (token-by-token generation)
2. ✅ Long workflows (progress feedback)
3. ✅ Large datasets (memory efficient)
4. ✅ Better UX (real-time updates)

**Our approach:**
- **Phase 1:** Async generators (simple, local)
- **Phase 2:** Redis Streams (distributed)
- **Phase 3:** Workflow integration

**~280 lines total** for full streaming support.

**Simple, incremental, and works with our existing architecture!** 🚀
