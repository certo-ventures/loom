# Redis Message Flow - Detailed

## What Actually Happens in Redis

### 1. Scatter Stage Execution

```
Orchestrator                          Redis                            Workers
    |                                   |                                 |
    | --- LPUSH bull:actor-FileProcessor:wait [job1] -----------------> |
    |                                   |                                 |
    | --- SET bull:actor-FileProcessor:12345 {message} ---------------> |
    |                                   |                                 |
    | --- PUBLISH bull:actor-FileProcessor:waiting "12345" -----------> |
    |                                   |                                 |
    |                                   | <--- BRPOPLPUSH (blocking) ---- | Worker 1
    |                                   |                                 |
    |                                   | --- Returns job1 -------------> | Worker 1
    |                                   |                                 |
    |                                   |                                 | Worker 1 executes actor
    |                                   |                                 |
    | <--- LPUSH bull:pipeline-stage-results:wait [result1] ----------- | Worker 1
    |                                   |                                 |
    | <--- SET bull:pipeline-stage-results:67890 {result} ------------- | Worker 1
    |                                   |                                 |
```

### 2. BullMQ Queue Structure in Redis

For queue `actor-FileProcessor`, BullMQ creates these keys:

```
bull:actor-FileProcessor:wait          ← List of waiting job IDs (LPUSH/RPOP)
bull:actor-FileProcessor:active        ← List of active job IDs (being processed)
bull:actor-FileProcessor:completed     ← Sorted set of completed job IDs
bull:actor-FileProcessor:failed        ← Sorted set of failed job IDs
bull:actor-FileProcessor:id            ← Counter for job IDs
bull:actor-FileProcessor:meta          ← Queue metadata
bull:actor-FileProcessor:events        ← Pub/sub channel for events
bull:actor-FileProcessor:<job-id>      ← Hash with job data
```

### 3. Job Data Structure

```redis
> HGETALL bull:actor-FileProcessor:3f8a9b2c-1234
1) "name"
2) "message"
3) "data"
4) "{\"messageId\":\"3f8a9b2c-...\",\"from\":\"pipeline:542800df-...\",..."
5) "opts"
6) "{\"jobId\":\"3f8a9b2c-...\",\"removeOnComplete\":true,...}"
7) "timestamp"
8) "1703067045123"
9) "processedOn"
10) "1703067045223"
11) "finishedOn"
12) "1703067045323"
```

### 4. Worker Operations (BullMQ Internal)

When a worker starts:

```redis
> BRPOPLPUSH bull:actor-FileProcessor:wait bull:actor-FileProcessor:active 5
"3f8a9b2c-1234"
```

**This is a BLOCKING operation** - worker waits up to 5 seconds for a job.

When job completes:

```redis
> LREM bull:actor-FileProcessor:active 1 "3f8a9b2c-1234"
> ZADD bull:actor-FileProcessor:completed 1703067045323 "3f8a9b2c-1234"
> DEL bull:actor-FileProcessor:3f8a9b2c-1234
```

### 5. Pub/Sub for Real-Time Updates

BullMQ publishes events:

```redis
> PUBLISH bull:actor-FileProcessor:waiting "3f8a9b2c-1234"
> PUBLISH bull:actor-FileProcessor:active "3f8a9b2c-1234"
> PUBLISH bull:actor-FileProcessor:completed "3f8a9b2c-1234"
```

Listeners (like monitors) can subscribe:

```redis
> PSUBSCRIBE bull:actor-*:*
> PSUBSCRIBE pipeline:*:*
```

### 6. Pipeline State in Redis

```redis
> SET pipeline:542800df-b15c-4070-9497-a96bf90602a6:state '{"definition":{...},"context":{...}}'
> GET pipeline:542800df-b15c-4070-9497-a96bf90602a6:state
```

### 7. Concurrent Workers Example

With 4 PageClassifier workers and 6 jobs:

```
Time  Redis Operation                                    Worker
----  ------------------------------------------------  --------
0ms   LPUSH bull:actor-PageClassifier:wait [1,2,3,4,5,6]  Orchestrator
1ms   BRPOPLPUSH ...wait ...active → 1                    Worker 1
1ms   BRPOPLPUSH ...wait ...active → 2                    Worker 2
1ms   BRPOPLPUSH ...wait ...active → 3                    Worker 3
1ms   BRPOPLPUSH ...wait ...active → 4                    Worker 4
51ms  LREM ...active 1, ZADD ...completed 1               Worker 1 (done)
51ms  BRPOPLPUSH ...wait ...active → 5                    Worker 1
52ms  LREM ...active 2, ZADD ...completed 2               Worker 2 (done)
52ms  BRPOPLPUSH ...wait ...active → 6                    Worker 2
53ms  LREM ...active 3, ZADD ...completed 3               Worker 3 (done)
53ms  BRPOPLPUSH ...wait ...active → (empty, blocks)      Worker 3
54ms  LREM ...active 4, ZADD ...completed 4               Worker 4 (done)
54ms  BRPOPLPUSH ...wait ...active → (empty, blocks)      Worker 4
101ms LREM ...active 5, ZADD ...completed 5               Worker 1 (done)
102ms LREM ...active 6, ZADD ...completed 6               Worker 2 (done)
```

### 8. Monitoring Redis in Real-Time

To see actual commands:

```bash
redis-cli MONITOR
```

Sample output during pipeline execution:

```
1703067045.123456 [0 172.17.0.1:54321] "LPUSH" "bull:actor-FileProcessor:wait" "3f8a9b2c-1234"
1703067045.123789 [0 172.17.0.1:54321] "HSET" "bull:actor-FileProcessor:3f8a9b2c-1234" "data" "{...}"
1703067045.124012 [0 172.17.0.1:54322] "BRPOPLPUSH" "bull:actor-FileProcessor:wait" "bull:actor-FileProcessor:active" "5"
1703067045.224567 [0 172.17.0.1:54322] "LPUSH" "bull:pipeline-stage-results:wait" "3f8a9b2c-1234-result"
1703067045.224890 [0 172.17.0.1:54323] "BRPOPLPUSH" "bull:pipeline-stage-results:wait" "bull:pipeline-stage-results:active" "5"
```

### 9. Barrier Implementation in Code

```typescript
// When result arrives
stageState.completedTasks++

// Check barrier
if (stageState.completedTasks >= stageState.expectedTasks) {
  // All tasks done!
  state.context.stages[stageName] = stageState.outputs
  await this.executeStage(pipelineId, nextStage)
}
```

No Redis lock needed because:
- Orchestrator is single-threaded for pipeline logic
- Results processed sequentially from `pipeline-stage-results` queue
- Race conditions impossible (one consumer, sequential processing)

### 10. Why This is NOT a Mock

**Mock would do**:
```typescript
for (const item of items) {
  const actor = new Actor()
  const result = await actor.execute(item)  // Direct call
  results.push(result)
}
```

**Real implementation does**:
```typescript
for (const item of items) {
  const message = createMessage(item)
  await redis.lpush('queue', message)  // ← Real Redis operation
}
// Separate workers pull from Redis and execute
```

The workers are **separate processes/threads** that:
1. Block on Redis `BRPOPLPUSH`
2. Pull jobs when available
3. Execute actors
4. Push results back to Redis
5. Can be distributed across multiple machines

This is production-grade message queue architecture, not simulation.
