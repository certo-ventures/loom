# Telemetry Production Guide

Based on partner AI production feedback. Shows how to instrument actors with the telemetry system we built.

## What We Built vs What You Need

### ✅ What's Already Working

```typescript
// Available on every ActorContext
context.recordEvent(eventType, data)
context.recordMetric(name, value, tags)
const endSpan = context.startSpan(operation); endSpan()
```

### 🎯 Production Pattern (Partner AI Requirements)

Partner AI wants:
1. **Duration tracking** → Use `startSpan()` 
2. **Success/failure rates** → Store in actor state + recordMetric
3. **Data quality metrics** → Store confidence/validation in state
4. **Resource usage** → Track docs/bytes/etc in recordMetric

## Quick Start Pattern

```typescript
class MyProductionActor extends Actor {
  protected getDefaultState() {
    return {
      // Your business data
      results: [],
      
      // Embedded telemetry (query from state!)
      metrics: {
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        averageDurationMs: 0,
        lastError: null
      }
    }
  }

  async execute(input: any, context: ActorContext) {
    const startTime = Date.now()
    context.recordEvent('operation_started', { input })
    const endSpan = context.startSpan('my_operation')

    try {
      // Do work
      const result = await this.doWork(input)
      const duration = Date.now() - startTime

      // Update state metrics
      this.updateState({
        results: [...this.state.results, result],
        metrics: {
          totalExecutions: this.state.metrics.totalExecutions + 1,
          successCount: this.state.metrics.successCount + 1,
          averageDurationMs: this.calculateAvg(duration),
          lastError: null
        }
      })

      // Record external telemetry
      context.recordMetric('operation_success', 1, { duration: duration.toString() })
      endSpan()
      
      return { success: true, result, metrics: this.state.metrics }

    } catch (error: any) {
      const duration = Date.now() - startTime
      
      this.updateState({
        metrics: {
          ...this.state.metrics,
          failureCount: this.state.metrics.failureCount + 1,
          lastError: error.message
        }
      })

      endSpan(error.message)
      context.recordEvent('operation_failed', { error: error.message })
      throw error
    }
  }

  private calculateAvg(newDuration: number): number {
    const { averageDurationMs, totalExecutions } = this.state.metrics
    return ((averageDurationMs * totalExecutions) + newDuration) / (totalExecutions + 1)
  }
}
```

## Actor-Specific Patterns

### DataAvailabilityActor
```typescript
// Track source availability
context.recordEvent('source_check_started', { source: input.source })
context.recordMetric('source_response_time', responseTime, { source: input.source })

// State metrics
metrics: {
  sourcesChecked: 0,
  availableCount: 0,
  unavailableCount: 0,
  averageResponseTimeMs: 0
}
```

### DocumentAcquisitionActor
```typescript
// Track download metrics
context.recordMetric('document_downloaded', 1, { bytes: doc.length.toString() })
context.recordMetric('download_duration', duration, { url })

// State metrics
metrics: {
  totalDocuments: 0,
  successCount: 0,
  failureCount: 0,
  totalBytes: 0,
  averageDurationMs: 0
}
```

### SchemaBasedExtractionActor
```typescript
// Track data quality
context.recordMetric('extraction_confidence', confidence, { quality: 'high|medium|low' })
context.recordMetric('validation_passed', validationPassed ? 1 : 0)

// State metrics
metrics: {
  totalExtractions: 0,
  averageConfidence: 0,
  highConfidenceCount: 0,  // > 0.8
  lowConfidenceCount: 0,   // < 0.5
  validationPassRate: 0
}
```

### DataValidationActor
```typescript
// Track validation results
context.recordEvent('validation_completed', { 
  passed: validationResult.passed,
  errors: validationResult.errors.length
})

// State metrics
metrics: {
  totalValidations: 0,
  passCount: 0,
  failCount: 0,
  averageErrorCount: 0
}
```

### StoreExtractedDataActor
```typescript
// Track storage operations
const endSpan = context.startSpan(`store_to_${storageType}`)
context.recordMetric('data_stored', 1, { storageType, bytes: data.length.toString() })

// State metrics
metrics: {
  totalWrites: 0,
  successCount: 0,
  failureCount: 0,
  totalBytesWritten: 0
}
```

### DataConsolidatorActor
```typescript
// Track consolidation
context.recordEvent('consolidation_started', { sourceCount: sources.length })
context.recordMetric('sources_consolidated', sources.length)

// State metrics
metrics: {
  totalConsolidations: 0,
  averageSourceCount: 0,
  dataQualityScore: 0
}
```

## Helper Functions

```typescript
// Calculate running average
private calculateAverage(currentAvg: number, newValue: number, count: number): number {
  return ((currentAvg * (count - 1)) + newValue) / count
}

// Update success rate
private updateSuccessRate(success: boolean) {
  const total = this.state.metrics.successCount + this.state.metrics.failureCount + 1
  return success ?
    (this.state.metrics.successCount + 1) / total :
    this.state.metrics.successCount / total
}

// Track execution wrapper
async trackExecution<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const startTime = Date.now()
  const endSpan = this.context.startSpan(operation)
  
  try {
    const result = await fn()
    endSpan()
    this.context.recordMetric(`${operation}_duration`, Date.now() - startTime)
    return result
  } catch (error: any) {
    endSpan(error.message)
    throw error
  }
}
```

## Querying Telemetry

### From State (Actor Performance)
```typescript
// Get actor's own metrics
const actor = await runtime.activateActor('my-actor-1', 'DocumentAcquisition')
const metrics = actor.state.metrics

console.log(`Success rate: ${metrics.successCount / (metrics.successCount + metrics.failureCount)}`)
console.log(`Average duration: ${metrics.averageDurationMs}ms`)
```

### From TelemetryStore (System-Wide)
```typescript
// Query events from all actors
const events = await telemetryStore.queryEvents({ eventType: 'acquisition_started' })

// Query metrics by actor
const metrics = await telemetryStore.queryMetrics({ actorId: 'my-actor-1' })

// Query slow operations
const spans = await telemetryStore.querySpans({ 
  minDuration: 1000,  // > 1 second
  status: 'completed'
})
```

## Production Storage

### Console (Default - Zero Config)
```typescript
// Already configured, logs to console
// Good for: development, debugging
```

### In-Memory (Testing)
```typescript
import { InMemoryTelemetryStore } from './storage/telemetry-store'
import { TelemetryRecorder } from './observability/telemetry-recorder'

const store = new InMemoryTelemetryStore()
TelemetryRecorder.setStore(store)

// Query later
const events = await store.queryEvents({ actorId: 'test-actor' })
```

### Redis (Production - High Volume)
```typescript
// TODO: Implement RedisTelemetryStore
// Use LPUSH to event/metric/span lists
// Set TTL for automatic cleanup
// Good for: high-throughput, short-term retention
```

### Cosmos DB (Production - Long-Term)
```typescript
// TODO: Implement CosmosTelemetryStore
// Store with partitionKey = actorType
// Query across actors, time ranges
// Good for: analytics, audit trails, long-term storage
```

## Testing Your Telemetry

```typescript
describe('MyActor telemetry', () => {
  let telemetryStore: InMemoryTelemetryStore
  let runtime: ActorRuntime

  beforeEach(() => {
    telemetryStore = new InMemoryTelemetryStore()
    TelemetryRecorder.setStore(telemetryStore)
    
    runtime = new ActorRuntime(
      new InMemoryStateStore(),
      new InMemoryMessageQueue(),
      new InMemoryLockManager()
    )
  })

  it('tracks success metrics', async () => {
    const actor = await runtime.activateActor('test-1', 'MyActor')
    await actor.execute({ data: 'test' }, actor.context)

    // Check state metrics
    expect(actor.state.metrics.successCount).toBe(1)
    expect(actor.state.metrics.failureCount).toBe(0)

    // Check telemetry store
    const events = await telemetryStore.queryEvents({ actorId: 'test-1' })
    expect(events).toHaveLength(2) // started + completed

    const spans = await telemetryStore.querySpans({ actorId: 'test-1' })
    expect(spans[0].status).toBe('completed')
    expect(spans[0].duration).toBeGreaterThan(0)
  })
})
```

## Best Practices

1. **Dual Storage**: Store metrics in both actor state (queryable) AND telemetry store (aggregatable)
2. **Running Averages**: Calculate incrementally, don't store all values
3. **Resource Tracking**: Track bytes, documents, API calls for cost analysis
4. **Data Quality**: Store confidence scores, validation results
5. **Error Context**: Include error details in events for debugging
6. **Spans for Timing**: Always use startSpan/endSpan for duration
7. **Tags for Filtering**: Use metric tags for querying (storageType, quality, etc.)

## Next Steps

- Implement your actors following the patterns above
- Test telemetry with InMemoryTelemetryStore
- Deploy with ConsoleTelemetryStore initially
- Add Redis/Cosmos stores when you need production analytics
