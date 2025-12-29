/**
 * Test Actor Telemetry with Plug-and-Play Storage
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ActorRuntime } from '../../runtime/actor-runtime'
import { InMemoryStateStore } from '../../storage/in-memory-state-store'
import { InMemoryMessageQueue } from '../../storage/in-memory-message-queue'
import { InMemoryLockManager } from '../../storage/in-memory-lock-manager'
import { InMemoryTelemetryStore } from '../../storage/telemetry-store'
import { TelemetryRecorder } from '../../observability/telemetry-recorder'
import { Actor, ActorContext } from '../../actor'

// Test actor that uses telemetry
class TelemetryTestActor extends Actor {
  async execute(input: any, context: ActorContext) {
    // Record start event
    context.recordEvent('processing_started', {
      inputSize: JSON.stringify(input).length
    })
    
    // Start a span for expensive operation
    const endSpan = context.startSpan('expensive_operation')
    
    try {
      // Simulate work
      await new Promise(resolve => setTimeout(resolve, 10))
      
      // Record metrics
      context.recordMetric('items_processed', input.items?.length || 0, {
        type: 'test',
        status: 'success'
      })
      
      // End span successfully
      endSpan()
      
      // Record completion event
      context.recordEvent('processing_completed', {
        itemCount: input.items?.length || 0
      })
      
      return {
        processed: true,
        count: input.items?.length || 0
      }
    } catch (error: any) {
      // End span with error
      endSpan(error.message)
      
      context.recordEvent('processing_failed', {
        error: error.message
      })
      
      throw error
    }
  }
}

describe('Actor Telemetry', () => {
  let runtime: ActorRuntime
  let telemetryStore: InMemoryTelemetryStore

  beforeEach(() => {
    // Use in-memory telemetry store for testing
    telemetryStore = new InMemoryTelemetryStore()
    TelemetryRecorder.setStore(telemetryStore)

    runtime = new ActorRuntime(
      new InMemoryStateStore(),
      new InMemoryMessageQueue(),
      new InMemoryLockManager()
    )

    runtime.registerActorType('TelemetryTest', (context) => new TelemetryTestActor(context))
  })

  it('actor can record events via context', async () => {
    const actor = await runtime.activateActor('test-actor-1', 'TelemetryTest')

    const result = await actor.execute({
      items: ['a', 'b', 'c']
    }, actor.context)

    expect(result.processed).toBe(true)
    expect(result.count).toBe(3)

    // Verify events were stored
    const events = await telemetryStore.queryEvents({ actorId: 'test-actor-1' })
    expect(events.length).toBe(2) // started + completed
    expect(events[0].eventType).toBe('processing_started')
    expect(events[1].eventType).toBe('processing_completed')

    await runtime.deactivateActor('test-actor-1')
  })

  it('actor can record metrics via context', async () => {
    const actor = await runtime.activateActor('test-actor-2', 'TelemetryTest')

    await actor.execute({
      items: ['x', 'y']
    }, actor.context)

    // Verify metrics were stored
    const metrics = await telemetryStore.queryMetrics({ actorId: 'test-actor-2' })
    expect(metrics.length).toBe(1)
    expect(metrics[0].name).toBe('items_processed')
    expect(metrics[0].value).toBe(2)
    expect(metrics[0].tags?.type).toBe('test')

    await runtime.deactivateActor('test-actor-2')
  })

  it('actor can track spans with timing', async () => {
    const actor = await runtime.activateActor('test-actor-3', 'TelemetryTest')

    await actor.execute({
      items: ['1', '2', '3', '4']
    }, actor.context)

    // Verify spans were stored with timing
    const spans = await telemetryStore.querySpans({ actorId: 'test-actor-3' })
    expect(spans.length).toBe(2) // started + completed
    expect(spans[0].operation).toBe('expensive_operation')
    expect(spans[0].status).toBe('started')
    expect(spans[1].status).toBe('completed')
    expect(spans[1].duration).toBeGreaterThan(0) // Has duration

    await runtime.deactivateActor('test-actor-3')
  })

  it('telemetry works with multiple actors', async () => {
    const actor1 = await runtime.activateActor('actor-1', 'TelemetryTest')
    const actor2 = await runtime.activateActor('actor-2', 'TelemetryTest')
    const actor3 = await runtime.activateActor('actor-3', 'TelemetryTest')

    await Promise.all([
      actor1.execute({ items: ['a'] }, actor1.context),
      actor2.execute({ items: ['b', 'c'] }, actor2.context),
      actor3.execute({ items: ['d', 'e', 'f'] }, actor3.context)
    ])

    // Verify all actors recorded telemetry independently
    const allData = telemetryStore.getAll()
    expect(allData.events.length).toBe(6) // 3 actors * 2 events each
    expect(allData.metrics.length).toBe(3) // 3 actors * 1 metric each
    expect(allData.spans.length).toBe(6) // 3 actors * 2 spans each

    // Verify per-actor queries work
    const actor1Events = await telemetryStore.queryEvents({ actorId: 'actor-1' })
    expect(actor1Events.length).toBe(2)

    await Promise.all([
      runtime.deactivateActor('actor-1'),
      runtime.deactivateActor('actor-2'),
      runtime.deactivateActor('actor-3')
    ])
  })
})
