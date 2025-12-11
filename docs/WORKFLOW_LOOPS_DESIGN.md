# Workflow Loops Design for Loom

## Problem Statement

### Current State
Our workflow executor supports:
- ✅ **Foreach** - Iterate over static array
- ✅ **Parallel** - Run actions concurrently
- ✅ **If** - Conditional branching

**Missing:**
- ❌ **While** - Loop until condition false
- ❌ **Until** - Loop until condition true
- ❌ **Do-While** - Execute at least once
- ❌ **Break/Continue** - Early exit from loops
- ❌ **Retry with backoff** - Retry failed actions
- ❌ **Dynamic iteration** - Loop based on runtime data

### Why We Need Loops

**Use Case 1: Retry Until Success**
```json
{
  "type": "while",
  "condition": "@not(equals(variables('status'), 'complete'))",
  "actions": {
    "checkStatus": {
      "type": "http",
      "inputs": {
        "uri": "https://api.example.com/status"
      }
    },
    "wait": {
      "type": "wait",
      "inputs": {
        "interval": {
          "count": 5,
          "unit": "second"
        }
      }
    }
  },
  "limit": {
    "count": 10,
    "timeout": "PT5M"
  }
}
```

**Use Case 2: Process Queue Until Empty**
```json
{
  "type": "until",
  "condition": "@empty(variables('queue'))",
  "actions": {
    "processItem": {
      "type": "actor",
      "inputs": {
        "actorType": "processor",
        "input": "@first(variables('queue'))"
      }
    },
    "removeFromQueue": {
      "type": "compose",
      "inputs": "@skip(variables('queue'), 1)"
    }
  }
}
```

**Use Case 3: Paginated API Calls**
```json
{
  "type": "until",
  "condition": "@equals(variables('nextPage'), null)",
  "actions": {
    "fetchPage": {
      "type": "http",
      "inputs": {
        "uri": "@variables('nextPage')"
      }
    },
    "updateNextPage": {
      "type": "compose",
      "inputs": "@body('fetchPage').nextPageUrl"
    }
  }
}
```

**Use Case 4: Agent Loop (ReAct Pattern)**
```json
{
  "type": "until",
  "condition": "@equals(variables('agentStatus'), 'FINAL_ANSWER')",
  "actions": {
    "think": {
      "type": "ai",
      "inputs": {
        "prompt": "What should I do next?"
      }
    },
    "act": {
      "type": "activity",
      "inputs": {
        "activityType": "@body('think').action",
        "input": "@body('think').actionInput"
      }
    },
    "observe": {
      "type": "compose",
      "inputs": "@body('act')"
    }
  },
  "limit": {
    "count": 5
  }
}
```

---

## Comparison: Azure Logic Apps

### Azure's Loop Support

**1. Until Loop**
```json
{
  "Until": {
    "type": "Until",
    "expression": "@equals(variables('done'), true)",
    "actions": {
      "HTTP": {
        "type": "Http",
        "inputs": { "uri": "..." }
      }
    },
    "limit": {
      "count": 60,
      "timeout": "PT1H"
    }
  }
}
```

**2. Do-Until Loop**
Same as Until, but always executes at least once.

**3. Foreach Loop** (We already have this)
```json
{
  "For_each": {
    "type": "Foreach",
    "foreach": "@triggerBody()?['items']",
    "actions": {
      "Process": { ... }
    }
  }
}
```

**Azure does NOT support:**
- ❌ While loop (only Until)
- ❌ Break/Continue
- ❌ Nested loop control
- ❌ Loop counters/indexes

**Why?** Keep workflows declarative and finite.

---

## Design Philosophy

### Keep It Simple and Safe

**Principles:**
1. **Finite loops only** - All loops must have limits (prevent infinite loops)
2. **Declarative** - Express intent, not imperative control
3. **Debuggable** - Track iterations, see state at each step
4. **Interruptible** - Can pause/resume long-running loops
5. **Azure-compatible** - Follow Logic Apps patterns where possible

**We will support:**
- ✅ **Until** - Loop until condition true (primary)
- ✅ **While** - Loop while condition true (syntactic sugar for Until)
- ✅ **Retry** - Specialized loop for retrying failed actions
- ❌ **Break/Continue** - Too imperative (use conditions instead)
- ❌ **Infinite loops** - Always require limits

---

## Loop Types

### 1. Until Loop (Primary)

**Syntax:**
```json
{
  "type": "until",
  "condition": "@equals(variables('status'), 'complete')",
  "actions": {
    "checkStatus": { ... },
    "processResult": { ... }
  },
  "limit": {
    "count": 100,
    "timeout": "PT1H"
  },
  "delay": {
    "interval": {
      "count": 5,
      "unit": "second"
    }
  }
}
```

**Execution:**
1. Evaluate condition
2. If false, execute actions
3. Wait for delay (if specified)
4. Repeat until:
   - Condition is true, OR
   - Hit iteration limit, OR
   - Hit timeout

**Default limits:**
- Max iterations: 60 (configurable)
- Max timeout: 1 hour (configurable)

---

### 2. While Loop (Sugar for Until)

**Syntax:**
```json
{
  "type": "while",
  "condition": "@not(equals(variables('done'), true))",
  "actions": { ... },
  "limit": { ... }
}
```

**Implementation:**
```typescript
// While is just Until with inverted condition
if (action.type === 'while') {
  action.type = 'until'
  action.condition = `@not(${action.condition})`
}
```

**Why include it?** Natural for some use cases ("while not done" vs "until done").

---

### 3. Retry Loop (Specialized)

**Syntax:**
```json
{
  "type": "retry",
  "action": {
    "type": "http",
    "inputs": { "uri": "..." }
  },
  "retryPolicy": {
    "type": "exponential",
    "count": 5,
    "interval": "PT5S",
    "maxInterval": "PT1M",
    "minimumInterval": "PT1S"
  }
}
```

**Retry policies:**
1. **Fixed** - Same delay between retries
2. **Exponential** - Delay doubles each time (with jitter)
3. **None** - No retries

**Use case:** HTTP calls, external APIs, transient failures.

---

### 4. Do-Until Loop (Execute Once First)

**Syntax:**
```json
{
  "type": "doUntil",
  "condition": "@equals(variables('result'), 'success')",
  "actions": { ... },
  "limit": { ... }
}
```

**Difference from Until:**
- **Until** - Check condition first, may never execute
- **DoUntil** - Execute once first, then check condition

**Use case:** Must run at least once (initialization, first attempt).

---

## State Management in Loops

### Challenge: Loop Variables

**Problem:** Each iteration needs access to:
- Previous iteration's output
- Loop counter/index
- Accumulated results

**Solution: Loop Context Variables**

```json
{
  "type": "until",
  "condition": "@greaterOrEquals(variables('loopIndex'), 10)",
  "actions": {
    "process": {
      "type": "compose",
      "inputs": {
        "index": "@variables('loopIndex')",
        "previousResult": "@variables('loopResult')",
        "item": "@variables('data')"
      }
    }
  }
}
```

**Special loop variables:**
- `loopIndex` - Current iteration (0-based)
- `loopResult` - Output from previous iteration
- `loopCount` - Total iterations so far
- `loopStartTime` - When loop started

These are automatically available inside loop actions.

---

## Implementation Design

### Option 1: Recursive Execution (Simple)

```typescript
async executeUntilLoop(action: UntilAction, context: WorkflowContext): Promise<any> {
  const limit = action.limit || { count: 60, timeout: 'PT1H' }
  const maxIterations = limit.count
  const timeout = parseDuration(limit.timeout)
  const startTime = Date.now()
  
  let iteration = 0
  let lastResult: any = null
  
  while (iteration < maxIterations) {
    // Check timeout
    if (Date.now() - startTime > timeout) {
      throw new Error(`Loop timeout after ${timeout}ms`)
    }
    
    // Evaluate condition
    const loopContext = {
      ...context,
      variables: {
        ...context.variables,
        loopIndex: iteration,
        loopResult: lastResult,
        loopCount: iteration + 1,
        loopStartTime: startTime
      }
    }
    
    const conditionResult = this.evaluateExpression(action.condition, loopContext)
    
    // Until: Stop when condition is TRUE
    if (conditionResult) {
      return lastResult
    }
    
    // Execute actions
    lastResult = await this.executeActions(action.actions, loopContext)
    
    // Delay before next iteration
    if (action.delay) {
      await this.delay(action.delay)
    }
    
    iteration++
  }
  
  throw new Error(`Loop exceeded maximum iterations: ${maxIterations}`)
}
```

**Pros:**
- ✅ Simple to implement
- ✅ Easy to understand
- ✅ Natural control flow

**Cons:**
- ❌ Can't pause/resume (blocks execution)
- ❌ No iteration history
- ❌ Hard to debug long loops

---

### Option 2: State Machine (Resumable) ⭐ **RECOMMENDED**

```typescript
interface LoopState {
  type: 'until' | 'while' | 'doUntil'
  condition: string
  actions: Record<string, WorkflowAction>
  iteration: number
  maxIterations: number
  timeout: number
  startTime: number
  lastResult: any
  status: 'running' | 'complete' | 'failed' | 'timeout'
}

async executeUntilLoop(action: UntilAction, context: WorkflowContext): Promise<any> {
  // Initialize or restore loop state
  let loopState: LoopState = context.loopStates?.[action.name] || {
    type: 'until',
    condition: action.condition,
    actions: action.actions,
    iteration: 0,
    maxIterations: action.limit?.count || 60,
    timeout: parseDuration(action.limit?.timeout || 'PT1H'),
    startTime: Date.now(),
    lastResult: null,
    status: 'running'
  }
  
  while (loopState.status === 'running') {
    // Check limits
    if (loopState.iteration >= loopState.maxIterations) {
      loopState.status = 'failed'
      throw new Error(`Loop exceeded maximum iterations: ${loopState.maxIterations}`)
    }
    
    if (Date.now() - loopState.startTime > loopState.timeout) {
      loopState.status = 'timeout'
      throw new Error(`Loop timeout after ${loopState.timeout}ms`)
    }
    
    // Create loop context
    const loopContext = {
      ...context,
      variables: {
        ...context.variables,
        loopIndex: loopState.iteration,
        loopResult: loopState.lastResult,
        loopCount: loopState.iteration + 1
      }
    }
    
    // Evaluate condition
    const conditionResult = this.evaluateExpression(loopState.condition, loopContext)
    
    if (conditionResult) {
      loopState.status = 'complete'
      break
    }
    
    // Save state before executing (for resumability)
    await this.saveLoopState(action.name, loopState)
    
    // Execute actions
    loopState.lastResult = await this.executeActions(loopState.actions, loopContext)
    loopState.iteration++
    
    // Delay
    if (action.delay) {
      await this.delay(action.delay)
    }
  }
  
  // Cleanup state
  await this.deleteLoopState(action.name)
  
  return loopState.lastResult
}
```

**Pros:**
- ✅ Can pause/resume (save state)
- ✅ Track iteration history
- ✅ Better debugging
- ✅ Support long-running loops
- ✅ Can inspect state externally

**Cons:**
- ❌ More complex
- ❌ Need state storage

---

## Loop Limits and Safety

### Required Limits

**Every loop MUST have limits:**
```typescript
interface LoopLimits {
  count: number        // Max iterations (default: 60)
  timeout: string      // Max duration (default: 'PT1H')
}
```

**Validation:**
```typescript
function validateLoopLimits(action: LoopAction) {
  const maxCount = 1000  // System limit
  const maxTimeout = parseDuration('PT24H')  // 24 hours
  
  if (!action.limit) {
    action.limit = { count: 60, timeout: 'PT1H' }
  }
  
  if (action.limit.count > maxCount) {
    throw new Error(`Loop count exceeds system limit: ${maxCount}`)
  }
  
  const timeout = parseDuration(action.limit.timeout)
  if (timeout > maxTimeout) {
    throw new Error(`Loop timeout exceeds system limit: ${maxTimeout}`)
  }
}
```

**Why?**
- Prevent infinite loops
- Protect resources
- Ensure workflows complete
- Enable debugging (bounded iterations)

---

## Loop Observability

### Track Loop Execution

**Emit events for each iteration:**
```typescript
interface LoopIterationEvent {
  workflowId: string
  actionName: string
  loopType: 'until' | 'while' | 'doUntil'
  iteration: number
  conditionResult: boolean
  result: any
  duration: number
  timestamp: Date
}

// In executor
this.eventEmitter.emit('loop:iteration', {
  workflowId: context.workflowId,
  actionName: action.name,
  loopType: action.type,
  iteration: loopState.iteration,
  conditionResult,
  result: loopState.lastResult,
  duration: Date.now() - iterationStart,
  timestamp: new Date()
})
```

**View loop progress:**
```bash
$ loom workflow status <workflowId>

Workflow: data-sync
Status: Running
Current Action: syncLoop (until)
  Iteration: 15/100
  Condition: @equals(variables('remaining'), 0)
  Duration: 45s
  Last Result: { synced: 150, remaining: 50 }
```

---

## Nested Loops

**Support nested loops:**
```json
{
  "type": "until",
  "name": "outerLoop",
  "condition": "@equals(variables('page'), null)",
  "actions": {
    "fetchPage": {
      "type": "http",
      "inputs": { "uri": "@variables('page')" }
    },
    "processItems": {
      "type": "foreach",
      "foreach": "@body('fetchPage').items",
      "actions": {
        "processItem": { ... }
      }
    }
  }
}
```

**Nested loop context:**
```typescript
// Inner loop has access to outer loop variables
{
  outerLoop_loopIndex: 2,
  outerLoop_loopResult: { ... },
  loopIndex: 5,           // Current (inner) loop
  loopResult: { ... }     // Current (inner) loop
}
```

**Naming convention:** `<loopName>_<variable>`

---

## Retry Pattern (Specialized Loop)

### Declarative Retry

**Built-in retry for any action:**
```json
{
  "type": "http",
  "name": "callAPI",
  "inputs": { "uri": "..." },
  "retry": {
    "type": "exponential",
    "count": 5,
    "interval": "PT5S",
    "maxInterval": "PT1M",
    "on": ["timeout", "500", "502", "503"]
  }
}
```

**Implementation:**
```typescript
async executeWithRetry(action: WorkflowAction, context: WorkflowContext): Promise<any> {
  const retry = action.retry || { type: 'none' }
  
  if (retry.type === 'none') {
    return await this.executeAction(action, context)
  }
  
  let lastError: Error
  const maxRetries = retry.count || 3
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await this.executeAction(action, context)
    } catch (error) {
      lastError = error
      
      // Check if should retry
      if (!this.shouldRetry(error, retry.on)) {
        throw error
      }
      
      // Last attempt?
      if (attempt === maxRetries) {
        throw error
      }
      
      // Calculate delay
      const delay = this.calculateRetryDelay(retry, attempt)
      await this.sleep(delay)
    }
  }
  
  throw lastError!
}

calculateRetryDelay(retry: RetryPolicy, attempt: number): number {
  const baseDelay = parseDuration(retry.interval || 'PT5S')
  
  if (retry.type === 'fixed') {
    return baseDelay
  }
  
  if (retry.type === 'exponential') {
    const delay = baseDelay * Math.pow(2, attempt)
    const maxDelay = parseDuration(retry.maxInterval || 'PT1M')
    const jitter = Math.random() * 0.1 * delay  // 10% jitter
    return Math.min(delay + jitter, maxDelay)
  }
  
  return baseDelay
}
```

---

## Example Use Cases

### 1. Polling Until Complete
```json
{
  "type": "until",
  "name": "waitForJob",
  "condition": "@equals(body('checkStatus').status, 'complete')",
  "actions": {
    "checkStatus": {
      "type": "http",
      "inputs": {
        "method": "GET",
        "uri": "https://api.example.com/jobs/@{variables('jobId')}"
      }
    }
  },
  "delay": {
    "interval": { "count": 10, "unit": "second" }
  },
  "limit": {
    "count": 60,
    "timeout": "PT10M"
  }
}
```

### 2. ReAct Agent Loop
```json
{
  "type": "until",
  "name": "agentLoop",
  "condition": "@equals(body('think').action, 'FINAL_ANSWER')",
  "actions": {
    "think": {
      "type": "ai",
      "inputs": {
        "prompt": "Based on observations: @{variables('observations')}, what should I do?"
      }
    },
    "act": {
      "type": "switch",
      "on": "@body('think').action",
      "cases": {
        "SEARCH": {
          "type": "activity",
          "inputs": { "activityType": "search", "query": "@body('think').input" }
        },
        "CALCULATE": {
          "type": "activity",
          "inputs": { "activityType": "calculator", "expression": "@body('think').input" }
        }
      }
    },
    "observe": {
      "type": "compose",
      "inputs": "@concat(variables('observations'), '\n', body('act'))"
    }
  },
  "limit": {
    "count": 10
  }
}
```

### 3. Batch Processing with Pagination
```json
{
  "type": "until",
  "name": "processAllPages",
  "condition": "@equals(variables('nextPageToken'), null)",
  "actions": {
    "fetchPage": {
      "type": "http",
      "inputs": {
        "uri": "https://api.example.com/data?pageToken=@{variables('nextPageToken')}"
      }
    },
    "processPage": {
      "type": "foreach",
      "foreach": "@body('fetchPage').items",
      "actions": {
        "processItem": {
          "type": "actor",
          "inputs": { "actorType": "processor", "input": "@item()" }
        }
      }
    },
    "updatePageToken": {
      "type": "setVariable",
      "name": "nextPageToken",
      "value": "@body('fetchPage').nextPageToken"
    }
  }
}
```

---

## API Design

### Loop Action Schema

```typescript
interface UntilAction extends WorkflowAction {
  type: 'until'
  name: string
  condition: string  // Expression that returns boolean
  actions: Record<string, WorkflowAction>
  limit?: {
    count?: number      // Max iterations (default: 60)
    timeout?: string    // ISO 8601 duration (default: 'PT1H')
  }
  delay?: {
    interval: {
      count: number
      unit: 'second' | 'minute' | 'hour'
    }
  }
  runAfter?: Record<string, string[]>
}

interface WhileAction extends UntilAction {
  type: 'while'
  // Same as Until, just inverts condition
}

interface DoUntilAction extends UntilAction {
  type: 'doUntil'
  // Same as Until, but executes once before checking condition
}

interface RetryPolicy {
  type: 'fixed' | 'exponential' | 'none'
  count?: number           // Max retries (default: 3)
  interval?: string        // Initial delay (default: 'PT5S')
  maxInterval?: string     // Max delay for exponential (default: 'PT1M')
  minimumInterval?: string // Min delay (default: 'PT1S')
  on?: string[]           // Conditions to retry on (status codes, error types)
}
```

---

## Implementation Plan

### Phase 1: Until Loop (100 lines)
**Files:**
- `src/workflow/actions/until-action.ts` - Until loop executor
- `src/workflow/types.ts` - Add UntilAction type
- `src/workflow/index.ts` - Integrate into executor
- `src/tests/workflow/until-loop.test.ts` - Tests

**Features:**
- Basic until loop
- Loop limits (count, timeout)
- Loop context variables
- Delay between iterations

### Phase 2: While and DoUntil (30 lines)
**Files:**
- `src/workflow/actions/while-action.ts` - While (inverts condition)
- `src/workflow/actions/do-until-action.ts` - DoUntil (execute first)

**Features:**
- While as syntactic sugar
- DoUntil with initial execution

### Phase 3: Retry Policy (70 lines)
**Files:**
- `src/workflow/retry-policy.ts` - Retry logic
- `src/workflow/index.ts` - Apply retry to any action

**Features:**
- Fixed and exponential backoff
- Conditional retry (on specific errors)
- Jitter for exponential

### Phase 4: Loop State Management (50 lines)
**Files:**
- `src/workflow/loop-state.ts` - Save/restore loop state
- `src/storage/cosmos-db.ts` - Persist loop state

**Features:**
- Save loop state for resumability
- Restore loops after crash
- Delete state on completion

**Total: ~250 lines**

---

## Comparison with Other Frameworks

| Framework | While | Until | Do-Until | Retry | Limits |
|-----------|-------|-------|----------|-------|--------|
| **Azure Logic Apps** | ❌ | ✅ | ✅ | ✅ | ✅ (count, timeout) |
| **LangGraph** | ❌ | ✅ (implicit) | ❌ | ❌ | ❌ |
| **AutoGen** | ❌ | ✅ (max_turns) | ❌ | ❌ | ✅ (max_turns) |
| **Temporal** | ✅ | ✅ | ✅ | ✅ | ✅ (configurable) |
| **Dapr** | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Loom** | ✅ | ✅ | ✅ | ✅ | ✅ (required) |

---

## Key Design Decisions

### 1. **Until (not While) as Primary**
- **Rationale:** Clearer intent ("loop until done" vs "loop while not done")
- **Azure follows this pattern**
- While is just sugar (inverted condition)

### 2. **Required Limits**
- **Rationale:** Prevent infinite loops, protect resources
- **Every loop must have count and timeout limits**
- Defaults: 60 iterations, 1 hour timeout

### 3. **State Machine for Resumability**
- **Rationale:** Support long-running loops, debugging
- **Save loop state between iterations**
- Can pause/resume/inspect

### 4. **Loop Context Variables**
- **Rationale:** Each iteration needs access to loop state
- **Automatic variables:** loopIndex, loopResult, loopCount
- Available in condition and actions

### 5. **No Break/Continue**
- **Rationale:** Keep declarative, avoid imperative control
- **Use conditions instead**
- If need early exit, check condition

---

## Conclusion

**Workflow Loops are essential for:**
1. ✅ Polling/waiting patterns
2. ✅ ReAct agent loops (think-act-observe)
3. ✅ Retry with backoff
4. ✅ Paginated data processing
5. ✅ Dynamic iteration based on runtime data

**Our design:**
- **Until** as primary (Azure-compatible)
- **While** as sugar (inverted condition)
- **DoUntil** for execute-first pattern
- **Retry** as specialized loop
- **Required limits** (safety)
- **State machine** (resumability)
- **Loop context variables** (iteration access)

**~250 lines total** for complete loop support.

**Simple, safe, and Azure-compatible!** 🔄
