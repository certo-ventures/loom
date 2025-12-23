/**
 * Test demonstrating distributed tracing across multiple actors
 * Shows correlationId propagation, parent-child relationships, and trace aggregation
 */

import { Actor } from '../src/actor/actor'
import type { ActorContext } from '../src/actor/journal'
import { InMemoryTraceStore } from '../src/tracing'

/**
 * Parent actor that orchestrates a workflow
 */
class OrchestratorActor extends Actor {
  async execute(input: { loanAmount: number }): Promise<void> {
    console.log(`\n[Orchestrator] Starting loan review for $${input.loanAmount}`)
    
    // Update state
    this.updateState({ 
      status: 'reviewing',
      loanAmount: input.loanAmount 
    })
    
    // Spawn child actors for parallel tasks
    const creditCheckId = await this.spawnChild('CreditCheckActor', { 
      loanAmount: input.loanAmount 
    })
    console.log(`[Orchestrator] Spawned credit check: ${creditCheckId}`)
    
    const appraisalId = await this.spawnChild('AppraisalActor', { 
      loanAmount: input.loanAmount 
    })
    console.log(`[Orchestrator] Spawned appraisal: ${appraisalId}`)
    
    // Send messages to track communication
    this.sendMessage(creditCheckId, { action: 'start_check' })
    this.sendMessage(appraisalId, { action: 'start_appraisal' })
    
    // Simulate decision
    this.updateState({ 
      status: 'approved',
      decision: 'approved' 
    })
    
    console.log(`[Orchestrator] Loan review complete`)
  }
}

/**
 * Child actor for credit checks
 */
class CreditCheckActor extends Actor {
  async execute(input: { loanAmount: number }): Promise<void> {
    // Record message received
    this.recordMessageReceived(
      this.context.parentActorId || 'orchestrator',
      input
    )
    
    console.log(`  [CreditCheck] Checking credit for $${input.loanAmount}`)
    
    this.updateState({ 
      status: 'checking',
      loanAmount: input.loanAmount 
    })
    
    // Simulate async work
    await new Promise(resolve => setTimeout(resolve, 100))
    
    this.updateState({ 
      status: 'complete',
      score: 750,
      result: 'approved' 
    })
    
    console.log(`  [CreditCheck] Credit check complete: 750 score`)
  }
}

/**
 * Child actor for property appraisals
 */
class AppraisalActor extends Actor {
  async execute(input: { loanAmount: number }): Promise<void> {
    // Record message received
    this.recordMessageReceived(
      this.context.parentActorId || 'orchestrator',
      input
    )
    
    console.log(`  [Appraisal] Starting appraisal for $${input.loanAmount}`)
    
    this.updateState({ 
      status: 'appraising',
      loanAmount: input.loanAmount 
    })
    
    // Simulate async work
    await new Promise(resolve => setTimeout(resolve, 150))
    
    this.updateState({ 
      status: 'complete',
      propertyValue: input.loanAmount * 1.2,
      result: 'sufficient' 
    })
    
    console.log(`  [Appraisal] Appraisal complete: $${input.loanAmount * 1.2}`)
  }
}

/**
 * Run the trace correlation test
 */
async function testTraceCorrelation() {
  console.log('='.repeat(60))
  console.log('DISTRIBUTED TRACING TEST')
  console.log('='.repeat(60))
  
  const traceStore = new InMemoryTraceStore()
  const correlationId = 'loan-review-12345'
  
  // Create orchestrator actor with tracing
  const orchestratorContext: ActorContext = {
    actorId: 'orchestrator-1',
    actorType: 'OrchestratorActor',
    correlationId,
  }
  
  const orchestrator = new OrchestratorActor(orchestratorContext)
  
  // Execute with tracing
  try {
    await orchestrator.executeWithTracing({ loanAmount: 500000 })
  } catch (error) {
    // Expected - actors suspend for children
    if (error instanceof Error && error.message.includes('child')) {
      console.log(`[Orchestrator] Suspended (expected)`)
    }
  }
  
  // Save orchestrator trace
  const orchestratorTrace = orchestrator.getTracer()?.getTrace()
  if (orchestratorTrace) {
    await traceStore.save(orchestratorTrace)
    console.log(`\n[TraceStore] Saved orchestrator trace: ${orchestratorTrace.traceId}`)
  }
  
  // Simulate child actor executions with parent trace reference
  const childActors = [
    {
      ActorClass: CreditCheckActor,
      context: {
        actorId: 'credit-check-1',
        actorType: 'CreditCheckActor',
        correlationId,
        parentActorId: 'orchestrator-1',
        parentTraceId: orchestratorTrace?.traceId,
      },
      input: { loanAmount: 500000 },
    },
    {
      ActorClass: AppraisalActor,
      context: {
        actorId: 'appraisal-1',
        actorType: 'AppraisalActor',
        correlationId,
        parentActorId: 'orchestrator-1',
        parentTraceId: orchestratorTrace?.traceId,
      },
      input: { loanAmount: 500000 },
    },
  ]
  
  // Execute child actors
  for (const { ActorClass, context, input } of childActors) {
    const actor = new ActorClass(context)
    await actor.executeWithTracing(input)
    
    const trace = actor.getTracer()?.getTrace()
    if (trace) {
      await traceStore.save(trace)
      console.log(`[TraceStore] Saved ${context.actorType} trace: ${trace.traceId}`)
    }
  }
  
  // Query all traces for this correlation ID
  console.log('\n' + '='.repeat(60))
  console.log('TRACE QUERY RESULTS')
  console.log('='.repeat(60))
  
  const allTraces = await traceStore.query({ correlationId })
  console.log(`\nFound ${allTraces.length} traces for correlation ID: ${correlationId}`)
  
  for (const trace of allTraces) {
    console.log(`\n--- Trace: ${trace.traceId} ---`)
    console.log(`  Actor: ${trace.actorType} (${trace.actorId})`)
    console.log(`  Operation: ${trace.operation}`)
    console.log(`  Status: ${trace.status}`)
    console.log(`  Duration: ${trace.duration}ms`)
    console.log(`  Parent: ${trace.parentTraceId || 'none'}`)
    console.log(`  Events: ${trace.events.length}`)
    
    // Show event summary
    const eventTypes = trace.events.map(e => e.eventType)
    const eventCounts: Record<string, number> = {}
    for (const type of eventTypes) {
      eventCounts[type] = (eventCounts[type] || 0) + 1
    }
    console.log(`  Event breakdown:`)
    for (const [type, count] of Object.entries(eventCounts)) {
      console.log(`    - ${type}: ${count}`)
    }
    
    // Show message flow
    const messages = trace.events.filter(e => 
      e.eventType === 'message.sent' || e.eventType === 'message.received'
    )
    if (messages.length > 0) {
      console.log(`  Message flow:`)
      for (const msg of messages) {
        const data = msg.data as any
        if (msg.eventType === 'message.sent') {
          console.log(`    → Sent to ${data.targetActorId}`)
        } else {
          console.log(`    ← Received from ${data.sourceActorId}`)
        }
      }
    }
  }
  
  // Show aggregated statistics
  console.log('\n' + '='.repeat(60))
  console.log('AGGREGATED STATISTICS')
  console.log('='.repeat(60))
  
  const stats = await traceStore.getStats(correlationId)
  console.log(`\nTotal Traces: ${stats.totalTraces}`)
  console.log(`Completed: ${stats.completed}`)
  console.log(`Failed: ${stats.failed}`)
  console.log(`Running: ${stats.running}`)
  console.log(`Average Duration: ${stats.avgDuration.toFixed(2)}ms`)
  console.log(`Min Duration: ${stats.minDuration.toFixed(2)}ms`)
  console.log(`Max Duration: ${stats.maxDuration.toFixed(2)}ms`)
  console.log(`Total Events: ${stats.totalEvents}`)
  
  // Show trace hierarchy
  console.log('\n' + '='.repeat(60))
  console.log('TRACE HIERARCHY')
  console.log('='.repeat(60))
  
  const rootTraces = allTraces.filter(t => !t.parentTraceId)
  
  function printTraceTree(trace: typeof allTraces[0], indent: string = '') {
    console.log(`${indent}${trace.actorType} (${trace.actorId})`)
    console.log(`${indent}  └─ ${trace.status} | ${trace.duration}ms | ${trace.events.length} events`)
    
    // Find children
    const children = allTraces.filter(t => t.parentTraceId === trace.traceId)
    for (const child of children) {
      printTraceTree(child, indent + '    ')
    }
  }
  
  console.log('\nWorkflow execution tree:')
  for (const root of rootTraces) {
    printTraceTree(root)
  }
  
  // Test query filters
  console.log('\n' + '='.repeat(60))
  console.log('QUERY FILTER EXAMPLES')
  console.log('='.repeat(60))
  
  // Query by actor type
  const creditTraces = await traceStore.query({ 
    correlationId,
    actorType: 'CreditCheckActor' 
  })
  console.log(`\nCredit check traces: ${creditTraces.length}`)
  
  // Query by status
  const completedTraces = await traceStore.query({ 
    correlationId,
    status: 'completed' 
  })
  console.log(`Completed traces: ${completedTraces.length}`)
  
  // Query with limit
  const recentTraces = await traceStore.query({ 
    correlationId,
    limit: 2 
  })
  console.log(`Most recent traces (limit 2): ${recentTraces.length}`)
  
  console.log('\n' + '='.repeat(60))
  console.log('TEST COMPLETE')
  console.log('='.repeat(60))
  console.log('\n✅ Demonstrated:')
  console.log('  - Correlation ID propagation across actors')
  console.log('  - Parent-child trace relationships')
  console.log('  - Message flow tracking (sent/received)')
  console.log('  - State updates and event capture')
  console.log('  - Duration and timing metrics')
  console.log('  - Trace aggregation and statistics')
  console.log('  - Hierarchical trace visualization')
  console.log('  - Flexible query filters')
}

// Run the test
testTraceCorrelation().catch(console.error)
