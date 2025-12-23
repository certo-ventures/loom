# Trace Query Examples: Step-by-Step Process Reconstruction

## Example 1: Successful Loan Processing Workflow

### The Scenario
A loan application flows through multiple actors:
1. HTTP request creates loan
2. LoanProcessor actor validates application
3. CreditChecker actor checks credit score
4. RiskAnalyzer actor evaluates risk
5. ApprovalEngine actor makes final decision
6. NotificationService actor sends email

### The Query Code

```typescript
import { TraceReader, TraceQuery } from './trace'

async function showLoanProcessingSteps(trace_id: string) {
  // 1. Fetch all events for this trace
  const reader = new TraceReader(cosmosContainer)
  const events = await reader.getTrace(trace_id)
  
  console.log(`\n📊 Found ${events.length} events for trace ${trace_id}\n`)
  
  // 2. Build execution graph
  const query = new TraceQuery(events)
  
  // 3. Get chronological path (root to leaf)
  const path = query.getPath()
  
  // 4. Display step-by-step timeline
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('LOAN PROCESSING TIMELINE')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  
  path.forEach((event, index) => {
    const indent = '  '.repeat(getDepth(event, events))
    const time = new Date(event.timestamp).toLocaleTimeString()
    const status = event.status ? `[${event.status.toUpperCase()}]` : ''
    
    console.log(`${index + 1}. ${time} ${indent}${event.event_type} ${status}`)
    
    // Show relevant data
    if (event.data) {
      const dataStr = formatEventData(event.event_type, event.data)
      if (dataStr) {
        console.log(`   ${indent}   ${dataStr}`)
      }
    }
    
    console.log()
  })
  
  // 5. Show summary statistics
  const duration = new Date(path[path.length - 1].timestamp).getTime() - 
                   new Date(path[0].timestamp).getTime()
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`✅ Total Duration: ${duration}ms`)
  console.log(`📦 Total Steps: ${events.length}`)
  console.log(`🎯 Final Status: ${path[path.length - 1].status || 'completed'}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

// Helper: Calculate depth in execution tree
function getDepth(event: TraceEvent, allEvents: TraceEvent[]): number {
  let depth = 0
  let currentParent = event.parent_span_id
  
  while (currentParent) {
    depth++
    const parent = allEvents.find(e => e.span_id === currentParent)
    currentParent = parent?.parent_span_id
  }
  
  return depth
}

// Helper: Format event data for display
function formatEventData(event_type: string, data: any): string {
  switch (event_type) {
    case 'http:request':
      return `${data.method} ${data.path} - User: ${data.user_id}`
    
    case 'message:received':
      return `Actor: ${data.actor_type}#${data.actor_id} - Message: ${data.message_type}`
    
    case 'actor:created':
      return `Initialized with state: ${JSON.stringify(data.initialState || {})}`
    
    case 'lock:acquired':
      return `Lock: ${data.lock_key} - TTL: ${data.ttl_ms}ms`
    
    case 'lock:released':
      return `Lock: ${data.lock_key}`
    
    case 'ai:decision':
      return `Decision: ${data.decision} (confidence: ${data.confidence})`
    
    case 'saga:compensation_started':
      return `Pipeline: ${data.pipeline_id}`
    
    case 'saga:compensating':
      return `Stage: ${data.stage_name} - Actor: ${data.actor}`
    
    default:
      return Object.keys(data).length > 0 ? JSON.stringify(data) : ''
  }
}
```

### The Output

```
📊 Found 18 events for trace loan-2025-12-22-abc123

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOAN PROCESSING TIMELINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 10:15:23.145 http:request 
      POST /api/loans - User: user-789

2. 10:15:23.147   workflow:started 
      Workflow: loan-approval-v2

3. 10:15:23.150     message:received 
        Actor: LoanProcessor#loan-proc-1 - Message: execute

4. 10:15:23.152       actor:created 
          Initialized with state: {}

5. 10:15:23.155       lock:acquired 
          Lock: actor:loan-proc-1 - TTL: 30000ms

6. 10:15:23.200       message:received 
            Actor: CreditChecker#credit-1 - Message: check_credit

7. 10:15:23.203         actor:created 
              Initialized with state: {}

8. 10:15:23.205         lock:acquired 
              Lock: actor:credit-1 - TTL: 30000ms

9. 10:15:23.450         message:completed [SUCCESS]
              

10. 10:15:23.452         lock:released 
              Lock: actor:credit-1

11. 10:15:23.500       message:received 
            Actor: RiskAnalyzer#risk-1 - Message: analyze_risk

12. 10:15:23.750       ai:decision 
            Decision: APPROVE (confidence: 0.92)

13. 10:15:23.800       message:received 
            Actor: ApprovalEngine#approval-1 - Message: make_decision

14. 10:15:24.100       message:completed [SUCCESS]
              

15. 10:15:24.102       lock:released 
          Lock: actor:loan-proc-1

16. 10:15:24.150     message:received 
        Actor: NotificationService#notif-1 - Message: send_approval

17. 10:15:24.350     message:completed [SUCCESS]
          

18. 10:15:24.400   workflow:completed [SUCCESS]
      

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Total Duration: 1255ms
📦 Total Steps: 18
🎯 Final Status: success
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Example 2: Failed Workflow with Saga Compensation

### The Scenario
A payment processing workflow that fails and triggers compensations:
1. Charge credit card → SUCCESS
2. Update inventory → SUCCESS  
3. Send confirmation email → FAILURE (email service down)
4. **Saga compensation triggered**
5. Refund credit card
6. Restore inventory

### The Query Code

```typescript
async function showFailedWorkflowWithCompensation(trace_id: string) {
  const reader = new TraceReader(cosmosContainer)
  const events = await reader.getTrace(trace_id)
  const query = new TraceQuery(events)
  
  // Check if workflow failed
  const failure = query.getFailure()
  const hadCompensation = events.some(e => e.event_type.startsWith('saga:'))
  
  console.log('\n❌ FAILED WORKFLOW ANALYSIS\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  
  // Show execution path
  const path = query.getPath()
  path.forEach((event, i) => {
    const time = new Date(event.timestamp).toLocaleTimeString()
    const indent = '  '.repeat(getDepth(event, events))
    
    let icon = '○'
    if (event.status === 'success') icon = '✅'
    if (event.status === 'failed') icon = '❌'
    if (event.event_type.includes('compensation')) icon = '↩️'
    
    console.log(`${i + 1}. ${icon} ${time} ${indent}${event.event_type}`)
    
    if (event.data && Object.keys(event.data).length > 0) {
      const key = Object.keys(event.data)[0]
      const preview = JSON.stringify(event.data).slice(0, 60)
      console.log(`   ${indent}   ${preview}${preview.length >= 60 ? '...' : ''}`)
    }
  })
  
  // Show failure details
  if (failure) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('FAILURE DETAILS')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    console.log(`Event: ${failure.event_type}`)
    console.log(`Time: ${new Date(failure.timestamp).toLocaleString()}`)
    console.log(`Error: ${failure.data?.error || 'Unknown error'}`)
  }
  
  // Show compensation actions
  if (hadCompensation) {
    const compensations = query.getCompensations()
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('COMPENSATION ACTIONS (Rollback)')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    
    compensations.forEach((comp, i) => {
      console.log(`${i + 1}. ${comp.event_type}`)
      console.log(`   Time: ${new Date(comp.timestamp).toLocaleTimeString()}`)
      console.log(`   Stage: ${comp.data?.stage_name || 'unknown'}`)
      console.log(`   Actor: ${comp.data?.actor || 'unknown'}`)
      console.log(`   Status: ${comp.status || 'completed'}\n`)
    })
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}
```

### The Output

```
❌ FAILED WORKFLOW ANALYSIS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ○ 14:32:10.100 http:request
      {"method":"POST","path":"/api/checkout","user_id":"user-456"}

2. ○ 14:32:10.105   workflow:started
      {"workflow_id":"checkout-workflow","pipeline_id":"pipe-x...

3. ✅ 14:32:10.200     message:completed
        {"stage":"charge_card","amount":99.99}

4. ✅ 14:32:10.450     message:completed
        {"stage":"update_inventory","sku":"WIDGET-123","qty":-1}

5. ❌ 14:32:10.650     message:failed
        {"stage":"send_email","error":"EmailService unavailable...

6. ○ 14:32:10.700   saga:compensation_started
      {"pipeline_id":"pipe-xyz789","reason":"stage_failed"}

7. ↩️ 14:32:10.750     saga:compensating
        {"stage_name":"update_inventory","actor":"InventoryActo...

8. ✅ 14:32:10.900     saga:compensated
        {"stage_name":"update_inventory"}

9. ↩️ 14:32:10.950     saga:compensating
        {"stage_name":"charge_card","actor":"PaymentActor"}

10. ✅ 14:32:11.200     saga:compensated
        {"stage_name":"charge_card"}

11. ✅ 14:32:11.250   saga:compensation_completed
      {"compensations_executed":2}

12. ○ 14:32:11.300   workflow:completed
      

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FAILURE DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Event: message:failed
Time: 12/22/2025, 2:32:10 PM
Error: EmailService unavailable - connection timeout

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPENSATION ACTIONS (Rollback)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. saga:compensating
   Time: 2:32:10 PM
   Stage: update_inventory
   Actor: InventoryActor
   Status: success

2. saga:compensating
   Time: 2:32:10 PM
   Stage: charge_card
   Actor: PaymentActor
   Status: success

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Example 3: Parallel Fan-Out with Convergence

### The Scenario
Document processing workflow with parallel stages:
1. Upload document
2. Extract pages (1 document → 5 pages)
3. **Parallel**: Classify each page (5 actors running concurrently)
4. **Convergence**: Consolidate results
5. Generate final report

### The Query Code

```typescript
async function showParallelExecution(trace_id: string) {
  const reader = new TraceReader(cosmosContainer)
  const events = await reader.getTrace(trace_id)
  const query = new TraceQuery(events)
  
  console.log('\n🔀 PARALLEL EXECUTION ANALYSIS\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  
  // Detect parallel branches
  const parallelGroups = detectParallelBranches(events)
  
  const path = query.getPath()
  let currentGroup = -1
  
  path.forEach((event, i) => {
    const time = new Date(event.timestamp).toLocaleTimeString()
    const indent = '  '.repeat(getDepth(event, events))
    
    // Check if starting parallel section
    const groupIdx = parallelGroups.findIndex(g => 
      g.events.some(e => e.span_id === event.span_id)
    )
    
    if (groupIdx !== -1 && groupIdx !== currentGroup) {
      currentGroup = groupIdx
      console.log(`\n   ╔═══ PARALLEL SECTION (${parallelGroups[groupIdx].events.length} branches) ═══╗\n`)
    }
    
    const icon = event.status === 'success' ? '✅' : 
                 event.status === 'failed' ? '❌' : '○'
    
    console.log(`${i + 1}. ${icon} ${time} ${indent}${event.event_type}`)
    
    if (event.data?.actor_type || event.data?.page_number) {
      console.log(`   ${indent}   Actor: ${event.data.actor_type || 'unknown'} | Page: ${event.data.page_number || 'N/A'}`)
    }
    
    // Check if ending parallel section
    if (groupIdx !== -1 && !parallelGroups[groupIdx].events.some(e => 
      path.slice(i + 1).some(pe => pe.span_id === e.span_id)
    )) {
      console.log(`\n   ╚═══ END PARALLEL SECTION ═══╝\n`)
      currentGroup = -1
    }
  })
  
  // Show timing analysis
  const parallelTiming = parallelGroups.map(group => {
    const times = group.events.map(e => new Date(e.timestamp).getTime())
    const minTime = Math.min(...times)
    const maxTime = Math.max(...times)
    return {
      branches: group.events.length,
      parallelDuration: maxTime - minTime,
      wouldTakeSequential: times.length * 200 // Assume 200ms per branch
    }
  })
  
  if (parallelTiming.length > 0) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('PARALLELIZATION BENEFIT')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    
    parallelTiming.forEach((timing, i) => {
      const saved = timing.wouldTakeSequential - timing.parallelDuration
      const speedup = (timing.wouldTakeSequential / timing.parallelDuration).toFixed(1)
      
      console.log(`Section ${i + 1}:`)
      console.log(`  Branches: ${timing.branches}`)
      console.log(`  Parallel Duration: ${timing.parallelDuration}ms`)
      console.log(`  Sequential Would Take: ${timing.wouldTakeSequential}ms`)
      console.log(`  Time Saved: ${saved}ms (${speedup}x speedup)\n`)
    })
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

// Helper: Detect parallel execution branches
function detectParallelBranches(events: TraceEvent[]): Array<{ events: TraceEvent[] }> {
  const groups: Array<{ events: TraceEvent[] }> = []
  const parentMap = new Map<string, TraceEvent[]>()
  
  // Group events by parent
  events.forEach(event => {
    if (event.parent_span_id) {
      if (!parentMap.has(event.parent_span_id)) {
        parentMap.set(event.parent_span_id, [])
      }
      parentMap.get(event.parent_span_id)!.push(event)
    }
  })
  
  // Find parents with multiple children (parallel branches)
  parentMap.forEach((children, parentId) => {
    if (children.length > 2) {
      groups.push({ events: children })
    }
  })
  
  return groups
}
```

### The Output

```
🔀 PARALLEL EXECUTION ANALYSIS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ○ 09:45:00.100 http:request

2. ○ 09:45:00.150   workflow:started

3. ✅ 09:45:00.300     message:completed
      Actor: UploadActor | Page: N/A

4. ✅ 09:45:00.500     message:completed
      Actor: PageExtractor | Page: N/A

   ╔═══ PARALLEL SECTION (5 branches) ═══╗

5. ○ 09:45:00.550       message:received
      Actor: PageClassifier | Page: 1

6. ○ 09:45:00.552       message:received
      Actor: PageClassifier | Page: 2

7. ○ 09:45:00.554       message:received
      Actor: PageClassifier | Page: 3

8. ○ 09:45:00.556       message:received
      Actor: PageClassifier | Page: 4

9. ○ 09:45:00.558       message:received
      Actor: PageClassifier | Page: 5

10. ✅ 09:45:00.750       message:completed
      Actor: PageClassifier | Page: 1

11. ✅ 09:45:00.780       message:completed
      Actor: PageClassifier | Page: 3

12. ✅ 09:45:00.820       message:completed
      Actor: PageClassifier | Page: 5

13. ✅ 09:45:00.850       message:completed
      Actor: PageClassifier | Page: 2

14. ✅ 09:45:00.900       message:completed
      Actor: PageClassifier | Page: 4

   ╚═══ END PARALLEL SECTION ═══╝

15. ✅ 09:45:01.100     message:completed
      Actor: ConsolidateActor | Page: N/A

16. ✅ 09:45:01.300     message:completed
      Actor: ReportGenerator | Page: N/A

17. ○ 09:45:01.350   workflow:completed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PARALLELIZATION BENEFIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Section 1:
  Branches: 5
  Parallel Duration: 350ms
  Sequential Would Take: 1000ms
  Time Saved: 650ms (2.9x speedup)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Example 4: Lock Contention Analysis

### The Scenario
Multiple requests trying to process the same loan simultaneously, causing lock contention.

### The Query Code

```typescript
async function showLockContention(trace_id: string) {
  const reader = new TraceReader(cosmosContainer)
  const events = await reader.getTrace(trace_id)
  
  // Find all lock-related events
  const lockEvents = events.filter(e => 
    e.event_type.includes('lock:') || e.event_type.includes('coordination:')
  )
  
  console.log('\n🔒 LOCK CONTENTION ANALYSIS\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  
  lockEvents.forEach((event, i) => {
    const time = new Date(event.timestamp).toLocaleTimeString()
    const ms = new Date(event.timestamp).getMilliseconds().toString().padStart(3, '0')
    
    let icon = '🔓'
    if (event.event_type.includes('acquired')) icon = '🔒'
    if (event.event_type.includes('blocked')) icon = '⏳'
    if (event.event_type.includes('released')) icon = '🔓'
    
    console.log(`${i + 1}. ${icon} ${time}.${ms} ${event.event_type}`)
    
    if (event.data?.lock_key) {
      console.log(`   Lock: ${event.data.lock_key}`)
    }
    if (event.data?.wait_time_ms) {
      console.log(`   Wait Time: ${event.data.wait_time_ms}ms`)
    }
    if (event.data?.actor_id) {
      console.log(`   Actor: ${event.data.actor_id}`)
    }
    console.log()
  })
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}
```

### The Output

```
🔒 LOCK CONTENTION ANALYSIS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 🔒 11:20:30.123 lock:acquired
   Lock: actor:loan-processor-456
   Actor: loan-processor-456

2. ⏳ 11:20:30.145 lock:blocked
   Lock: actor:loan-processor-456
   Wait Time: 0ms
   Actor: loan-processor-456

3. ⏳ 11:20:30.167 lock:blocked
   Lock: actor:loan-processor-456
   Wait Time: 0ms
   Actor: loan-processor-456

4. 🔓 11:20:32.890 lock:released
   Lock: actor:loan-processor-456
   Actor: loan-processor-456

5. 🔒 11:20:32.892 lock:acquired
   Lock: actor:loan-processor-456
   Wait Time: 2747ms
   Actor: loan-processor-456

6. 🔓 11:20:35.100 lock:released
   Lock: actor:loan-processor-456
   Actor: loan-processor-456

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Summary

These queries show how to reconstruct **exactly what happened** in any trace:

| Query Type | Use Case | Key Insight |
|------------|----------|-------------|
| **Timeline View** | Debug workflow execution | See every step chronologically |
| **Failure Analysis** | Investigate errors | Find what failed and how system recovered |
| **Parallel Analysis** | Optimize performance | Measure parallelization benefits |
| **Lock Contention** | Debug race conditions | See lock acquisition patterns |

**The power**: Fetch ~10-20 events, build graph in memory, query in <1ms. No complex indexes, no pre-computation, just simple SQL + JavaScript.
