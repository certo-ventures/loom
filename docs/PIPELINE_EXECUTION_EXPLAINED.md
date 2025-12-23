# How the Pipeline System Works - Complete Technical Breakdown

## Architecture Overview

```
┌─────────────────┐         ┌──────────────┐         ┌─────────────────┐
│   Orchestrator  │ ─────▶  │    Redis     │  ◀────  │  Actor Workers  │
│                 │         │   (BullMQ)   │         │   (Pool of N)   │
└─────────────────┘         └──────────────┘         └─────────────────┘
        │                          │                          │
        │ 1. Enqueue tasks         │ 2. Workers pull         │
        │ 3. Track barriers        │    tasks (BRPOP)        │
        │ 4. Receive results       │ 3. Execute actors       │
        │                          │ 4. Publish results      │
        └──────────────────────────┴──────────────────────────┘
```

## Step-by-Step Execution Flow

### 1. Pipeline Initialization

**File**: `pipeline-orchestrator.ts:75-107`

```typescript
async execute(definition: PipelineDefinition, triggerData: any) {
  const pipelineId = `pipeline:${uuidv4()}`
  
  // Create in-memory state
  const state: PipelineExecutionState = {
    pipelineId,
    definition,
    context: { trigger: triggerData, stages: {} },
    currentStageIndex: 0,
    stageStates: new Map()
  }
  
  // Initialize each stage state
  for (const stage of definition.stages) {
    state.stageStates.set(stage.name, {
      stageName: stage.name,
      status: 'pending',
      expectedTasks: 0,    // ← Set during scatter
      completedTasks: 0,   // ← Incremented as tasks complete
      outputs: []          // ← Collected results
    })
  }
  
  this.pipelines.set(pipelineId, state)  // In-memory tracking
  
  // Persist to Redis
  await this.redis.set(
    `pipeline:${pipelineId}:state`,
    JSON.stringify({ definition, context: state.context, currentStageIndex: 0 })
  )
}
```

**Redis Operation**: `SET pipeline:<uuid>:state <json>`

---

### 2. Stage Execution - SCATTER Mode

**File**: `pipeline-orchestrator.ts:170-220`

When executing `split-pages` stage with 2 files:

```typescript
async executeScatterStage(...) {
  // Step 1: Use JSONPath to extract items
  let items = jp.query(state.context, '$.trigger.files')
  // items = [{ path: '/uploads/doc1.pdf' }, { path: '/uploads/doc2.pdf' }]
  
  // Step 2: For each item, create scoped context and enqueue message
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    
    // Create scoped context (adds the "file" variable)
    const scopedContext = {
      ...state.context,
      file: item  // ← From scatter.as = 'file'
    }
    
    // Resolve input using JSONPath
    const input = this.resolveInput(
      { filepath: '$.file.path' },  // From stage.input
      scopedContext
    )
    // Result: { filepath: '/uploads/doc1.pdf' }
    
    // Create BullMQ message
    const message: Message = {
      messageId: uuidv4(),
      from: pipelineId,
      to: 'FileProcessor',
      type: 'execute',
      payload: {
        pipelineId,
        stageName: 'split-pages',
        taskIndex: i,  // ← 0 or 1
        input: { filepath: '/uploads/doc1.pdf' }
      },
      timestamp: new Date().toISOString()
    }
    
    // ← THIS IS THE KEY REDIS OPERATION
    await this.messageQueue.enqueue('actor-FileProcessor', message)
  }
  
  // Set expected count for barrier
  stageState.expectedTasks = items.length  // ← 2
}
```

**What Actually Happens in Redis**:

```typescript
// bullmq-message-queue.ts:18-26
async enqueue(queueName: string, message: Message) {
  const queue = this.getOrCreateQueue(queueName)
  
  await queue.add('message', message, {
    jobId: message.messageId,
    removeOnComplete: true,
    removeOnFail: false
  })
}
```

**Redis Commands Executed**:
1. `LPUSH bull:actor-FileProcessor:wait <job-id>`
2. `SET bull:actor-FileProcessor:<job-id> <serialized-message>`
3. `PUBLISH bull:actor-FileProcessor:waiting <job-id>`

---

### 3. Worker Processing

**File**: `pipeline-actor-worker.ts:40-95`

Workers are registered BEFORE pipeline starts:

```typescript
// During setup
worker.startWorker('FileProcessor', 2)  // ← 2 concurrent workers

// This calls:
messageQueue.registerWorker(
  'actor-FileProcessor',
  async (message) => { await this.processMessage('FileProcessor', message) },
  2  // ← concurrency
)
```

**BullMQ Worker Internal** (`bullmq-message-queue.ts:55-74`):

```typescript
const worker = new Worker(
  'actor-FileProcessor',
  async (job: Job) => {
    const message = job.data as Message
    await processor(message)  // ← Calls processMessage
  },
  {
    connection: this.connection,
    concurrency: 2  // ← 2 workers pull from same queue
  }
)
```

**Redis Operations by BullMQ Worker**:
1. `BRPOPLPUSH bull:actor-FileProcessor:wait bull:actor-FileProcessor:active 5` ← Blocking pop
2. Worker gets job, processes it
3. `LREM bull:actor-FileProcessor:active <job-id>`
4. `DEL bull:actor-FileProcessor:<job-id>`

**Actor Execution**:

```typescript
async processMessage(actorType: string, message: Message) {
  const { pipelineId, stageName, taskIndex, input } = message.payload
  
  // Step 1: Instantiate actor
  const ActorClass = this.actors.get('FileProcessor')!
  const actor = new ActorClass()
  
  // Step 2: Execute
  const output = await actor.execute(input)
  // For FileProcessor: returns { pages: [...] }
  
  // Step 3: Send result back
  const resultMessage: Message = {
    messageId: message.messageId + '-result',
    from: 'FileProcessor',
    to: pipelineId,
    type: 'result',
    payload: {
      pipelineId,
      stageName: 'split-pages',
      taskIndex: 0,
      output: { pages: [{ pageNumber: 1, ... }, { pageNumber: 2, ... }] }
    }
  }
  
  await this.messageQueue.enqueue('pipeline-stage-results', resultMessage)
}
```

**Redis Operations**:
1. `LPUSH bull:pipeline-stage-results:wait <result-job-id>`
2. `SET bull:pipeline-stage-results:<result-job-id> <result-message>`

---

### 4. Barrier Synchronization

**File**: `pipeline-orchestrator.ts:295-340`

The orchestrator has a worker listening on `pipeline-stage-results`:

```typescript
// In constructor:
this.messageQueue.registerWorker(
  'pipeline-stage-results',
  (msg) => this.handleStageResult(msg),
  10
)

async handleStageResult(message: Message) {
  const { pipelineId, stageName, taskIndex, output } = message.payload
  
  const state = this.pipelines.get(pipelineId)!
  const stageState = state.stageStates.get(stageName)!
  
  // Step 1: Add output
  stageState.outputs.push(output)
  stageState.completedTasks++
  
  console.log(`Progress: ${stageState.completedTasks}/${stageState.expectedTasks}`)
  
  // Step 2: Check barrier (THE KEY LOGIC)
  if (stageState.completedTasks >= stageState.expectedTasks) {
    // BARRIER RELEASED!
    stageState.status = 'completed'
    
    // Store outputs in context for next stage
    state.context.stages[stageName] = stageState.outputs
    // e.g., stages['split-pages'] = [{ pages: [...] }, { pages: [...] }]
    
    // Trigger next stage
    const nextStage = this.getNextStage(state.definition, stageName)
    if (nextStage) {
      await this.executeStage(pipelineId, nextStage)
    }
  }
}
```

**Example Timeline**:
```
Time  Event
----  -----
0ms   expectedTasks = 2, completedTasks = 0
100ms Worker 1 completes task 0 → completedTasks = 1 (1/2)
101ms Worker 2 completes task 1 → completedTasks = 2 (2/2) ← BARRIER RELEASED
102ms Next stage triggered: classify-pages
```

---

### 5. Gather Stage with Grouping

**File**: `pipeline-orchestrator.ts:245-290`

When executing `consolidate-documents` stage:

```typescript
async executeGatherStage(...) {
  // Step 1: Get outputs from previous stage
  const targetStageState = state.stageStates.get('classify-pages')!
  const targetOutputs = targetStageState.outputs
  // targetOutputs = [
  //   { pageNumber: 1, documentType: 'invoice' },
  //   { pageNumber: 2, documentType: 'receipt' },
  //   { pageNumber: 3, documentType: 'invoice' },
  //   ...
  // ]
  
  // Step 2: Group by key
  if (stage.gather.groupBy) {
    const groups = new Map<string, any[]>()
    
    for (const item of targetOutputs) {
      const groupKey = jp.value(item, '$.documentType')
      // groupKey = 'invoice', 'receipt', 'contract'
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }
      groups.get(groupKey)!.push(item)
    }
    // groups = Map {
    //   'invoice' => [{ pageNumber: 1, ... }, { pageNumber: 3, ... }],
    //   'receipt' => [{ pageNumber: 2, ... }],
    //   'contract' => [{ pageNumber: 4, ... }, { pageNumber: 5, ... }]
    // }
    
    // Step 3: Enqueue one message per group
    let groupIndex = 0
    for (const [key, items] of groups.entries()) {
      const scopedContext = {
        ...state.context,
        group: { key, items }
      }
      
      const input = this.resolveInput(stage.input, scopedContext)
      // input = { group: { key: 'invoice', items: [...] } }
      
      const message: Message = {
        messageId: uuidv4(),
        from: pipelineId,
        to: 'DocumentConsolidator',
        type: 'execute',
        payload: {
          pipelineId,
          stageName: 'consolidate-documents',
          taskIndex: groupIndex,
          groupKey: key,
          input
        }
      }
      
      await this.messageQueue.enqueue('actor-DocumentConsolidator', message)
      groupIndex++
    }
    
    stageState.expectedTasks = groups.size  // ← 3 groups
  }
}
```

---

## Message Format

### Task Message (Orchestrator → Worker)
```json
{
  "messageId": "3f8a9b2c-...",
  "from": "pipeline:542800df-...",
  "to": "FileProcessor",
  "type": "execute",
  "payload": {
    "pipelineId": "pipeline:542800df-...",
    "stageName": "split-pages",
    "taskIndex": 0,
    "input": {
      "filepath": "/uploads/doc1.pdf"
    }
  },
  "timestamp": "2025-12-20T10:30:45.123Z"
}
```

### Result Message (Worker → Orchestrator)
```json
{
  "messageId": "3f8a9b2c-...-result",
  "from": "FileProcessor",
  "to": "pipeline:542800df-...",
  "type": "result",
  "payload": {
    "pipelineId": "pipeline:542800df-...",
    "stageName": "split-pages",
    "taskIndex": 0,
    "output": {
      "pages": [
        { "pageNumber": 1, "content": "..." },
        { "pageNumber": 2, "content": "..." }
      ]
    }
  },
  "timestamp": "2025-12-20T10:30:45.223Z"
}
```

---

## Complete Execution Example

### Input: 2 files
```json
{ "files": [
  { "path": "/uploads/doc1.pdf" },
  { "path": "/uploads/doc2.pdf" }
]}
```

### Stage 1: split-pages (scatter)
- **Enqueues**: 2 messages to `actor-FileProcessor`
- **Redis**: 2 jobs in `bull:actor-FileProcessor:wait`
- **Workers**: 2 FileProcessor workers pull jobs
- **Executes**: `FileProcessor.execute({ filepath: '/uploads/doc1.pdf' })`
- **Returns**: `{ pages: [page1, page2, page3] }` (each file)
- **Results**: 2 result messages to `pipeline-stage-results`
- **Barrier**: completedTasks: 2/2 → RELEASED

### Stage 2: classify-pages (scatter)
- **Input**: `$.stages["split-pages"][*].pages[*]` → 6 pages total
- **Enqueues**: 6 messages to `actor-PageClassifier`
- **Redis**: 6 jobs in `bull:actor-PageClassifier:wait`
- **Workers**: 4 PageClassifier workers (process in parallel!)
- **Executes**: `PageClassifier.execute({ filepath, pageNumber, content })`
- **Returns**: `{ documentType: 'invoice', pageNumber: 1, ... }`
- **Results**: 6 result messages to `pipeline-stage-results`
- **Barrier**: completedTasks: 6/6 → RELEASED

### Stage 3: consolidate-documents (gather+group)
- **Input**: 6 classification results
- **Grouping**: By `$.documentType`
  - invoice: 2 pages
  - receipt: 2 pages
  - contract: 2 pages
- **Enqueues**: 3 messages to `actor-DocumentConsolidator` (one per group)
- **Redis**: 3 jobs in `bull:actor-DocumentConsolidator:wait`
- **Workers**: 2 DocumentConsolidator workers
- **Executes**: `DocumentConsolidator.execute({ group: { key: 'invoice', items: [...] } })`
- **Returns**: `{ documentType: 'invoice', pageCount: 2, pages: [1, 3] }`
- **Results**: 3 result messages
- **Barrier**: completedTasks: 3/3 → RELEASED

### Stage 4: generate-report (single)
- **Input**: All 3 consolidated documents
- **Enqueues**: 1 message to `actor-ReportGenerator`
- **Executes**: `ReportGenerator.execute({ documents: [...] })`
- **Returns**: Final report
- **Barrier**: completedTasks: 1/1 → PIPELINE COMPLETE

---

## Key Points

1. **No Polling**: Workers use `BRPOPLPUSH` (blocking Redis operation)
2. **Parallel Execution**: Multiple workers pull from same queue simultaneously
3. **Barrier via Counter**: `completedTasks >= expectedTasks`
4. **Context Flow**: Each stage's outputs stored in `context.stages[stageName]`
5. **JSONPath Resolution**: Dynamic data extraction from context
6. **BullMQ Handles**: Retries, failed jobs, job cleanup automatically
7. **State Persistence**: Pipeline state in Redis for recovery
8. **Message-Driven**: Every operation is a message through Redis queues

This is **not a mock** - it's real distributed execution using BullMQ's production-ready queue system.
