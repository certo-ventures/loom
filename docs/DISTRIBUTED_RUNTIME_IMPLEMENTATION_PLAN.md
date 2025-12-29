# Distributed Runtime & Unified AI - Implementation Plan

**Date**: December 27, 2025  
**Status**: Gap Analysis Complete  
**Priority**: Phase 2-3 (After Verifiable Computation)

---

## ✅ What You Already Have

### 1. **Service Discovery** ✅ COMPLETE
**Location**: `src/discovery/index.ts`

**Features**:
- ✅ Actor registry (in-memory + interface for distributed)
- ✅ Type-based routing
- ✅ Load balancing (round-robin, least-messages, random)
- ✅ Event-driven updates (Redis Pub/Sub)
- ✅ Actor metadata system

**Interfaces**:
```typescript
interface ActorRegistry {
  register(registration: ActorRegistration): Promise<void>
  unregister(actorId: string): Promise<void>
  get(actorId: string): Promise<ActorRegistration | undefined>
  getByType(actorType: string): Promise<ActorRegistration[]>
  getAll(): Promise<ActorRegistration[]>
  heartbeat(actorId: string): Promise<void>
  updateStatus(actorId: string, status): Promise<void>
  cleanup(maxAge: number): Promise<number>
}
```

**Missing**:
- ❌ Redis-based distributed ActorRegistry implementation
- ❌ Multi-node coordination
- ❌ Actor placement/affinity logic

---

### 2. **Load Balancing** ✅ COMPLETE
**Location**: `src/discovery/index.ts`

**Strategies Implemented**:
- ✅ Round-robin
- ✅ Least-messages (least loaded)
- ✅ Random

**Missing**:
- ❌ CPU/memory-aware load balancing
- ❌ Geographic/zone-aware routing
- ❌ Custom strategies

---

### 3. **Health Checks** ✅ COMPLETE
**Location**: `packages/loom-server/src/resilience/health.ts`

**Features**:
- ✅ Redis health check
- ✅ Cosmos DB health check
- ✅ Memory monitoring
- ✅ Latency tracking
- ✅ Status aggregation (healthy/degraded/unhealthy)
- ✅ HTTP endpoints (`/health`, `/ready`)

**Missing**:
- ❌ Actor-level health checks
- ❌ Circuit breaker pattern
- ❌ Automatic node eviction on failure

---

### 4. **Unified LLM API** ✅ COMPLETE
**Location**: `src/ai/`

**Providers Supported**:
- ✅ OpenAI
- ✅ Anthropic
- ✅ Azure OpenAI
- ✅ Gemini

**Features**:
- ✅ Provider-agnostic interface
- ✅ Chat completion
- ✅ Streaming responses
- ✅ Tool calling support
- ✅ Actor-as-tool integration
- ✅ Dynamic config switching

**Example**:
```typescript
import { UnifiedLLM } from '@loom/ai'

const llm = new UnifiedLLM({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4',
  temperature: 0.7
})

const response = await llm.chat([
  { role: 'user', content: 'Hello!' }
])
```

**Missing**:
- ❌ Cost tracking per provider
- ❌ Automatic fallback/retry across providers
- ❌ Response caching layer

---

## ❌ What's Missing

### 5. **Consistent Hashing** ❌ MISSING
**Purpose**: Deterministic actor placement across nodes

**Why Needed**:
- Ensures same actor always routes to same node
- Minimizes state migration on node add/remove
- Enables horizontal scaling

**Implementation Needed**:
```typescript
class ConsistentHashRing {
  private nodes: Map<string, NodeInfo>
  private ring: SortedMap<number, string> // hash -> nodeId
  private virtualNodes = 150 // replicas per node
  
  addNode(nodeId: string, capacity: number): void {
    // Add virtual nodes to ring
    for (let i = 0; i < this.virtualNodes; i++) {
      const hash = this.hash(`${nodeId}:${i}`)
      this.ring.set(hash, nodeId)
    }
  }
  
  removeNode(nodeId: string): void {
    // Remove all virtual nodes
    // Actors rehash to next node
  }
  
  getNode(actorId: string): string {
    const hash = this.hash(actorId)
    // Find next node clockwise on ring
    return this.ring.getNext(hash)
  }
  
  private hash(key: string): number {
    // MD5 or MurmurHash
  }
}
```

**Effort**: ~200 lines, 2-3 days  
**Dependencies**: None (can use existing hash libraries)

---

### 6. **Auto-Scaling Logic** ❌ MISSING
**Purpose**: Dynamically add/remove nodes based on load

**Why Needed**:
- Cost optimization (scale down during low traffic)
- Performance (scale up during peaks)
- Resource efficiency

**Implementation Needed**:
```typescript
class AutoScaler {
  private metrics: MetricsCollector
  private orchestrator: NodeOrchestrator
  
  async checkAndScale(): Promise<void> {
    const metrics = await this.metrics.collect()
    
    // Scale up conditions
    if (
      metrics.cpuUsage > 80 ||
      metrics.queueDepth > 1000 ||
      metrics.actorDensity > 10000
    ) {
      await this.scaleUp()
    }
    
    // Scale down conditions
    if (
      metrics.cpuUsage < 20 &&
      metrics.queueDepth < 100 &&
      metrics.nodeCount > this.minNodes
    ) {
      await this.scaleDown()
    }
  }
  
  private async scaleUp(): Promise<void> {
    // 1. Provision new node (K8s, ECS, VM)
    // 2. Add to consistent hash ring
    // 3. Update service discovery
    // 4. Start accepting traffic
  }
  
  private async scaleDown(): Promise<void> {
    // 1. Select node to remove (least loaded)
    // 2. Drain actors (migrate to other nodes)
    // 3. Remove from hash ring
    // 4. Decommission node
  }
}
```

**Metrics Needed**:
- Queue depth per actor type
- CPU/memory per node
- Message throughput
- Actor count per node

**Integration Points**:
- Kubernetes HPA (Horizontal Pod Autoscaler)
- AWS ECS/Fargate auto-scaling
- Azure Container Apps scaling
- Custom VM orchestration

**Effort**: ~500 lines, 1-2 weeks  
**Dependencies**: 
- Cloud provider SDK (K8s, AWS, Azure)
- Metrics collection system
- Node orchestration

---

### 7. **Failover & Recovery** ❌ PARTIAL
**What You Have**:
- ✅ Distributed locks (prevent duplicate actors)
- ✅ Journal-based state recovery
- ✅ Health checks

**What's Missing**:
- ❌ Automatic node failure detection
- ❌ Actor migration on node failure
- ❌ Split-brain prevention
- ❌ Graceful shutdown coordination

**Implementation Needed**:
```typescript
class FailoverManager {
  private watcher: NodeWatcher
  private hashRing: ConsistentHashRing
  
  async handleNodeFailure(failedNodeId: string): Promise<void> {
    // 1. Detect failure (heartbeat timeout)
    const actors = await this.getActorsOnNode(failedNodeId)
    
    // 2. Redistribute actors
    for (const actorId of actors) {
      const newNode = this.hashRing.getNextHealthyNode(actorId)
      await this.migrateActor(actorId, failedNodeId, newNode)
    }
    
    // 3. Update service discovery
    await this.registry.cleanup(failedNodeId)
    
    // 4. Remove from hash ring
    this.hashRing.removeNode(failedNodeId)
  }
  
  private async migrateActor(
    actorId: string,
    fromNode: string,
    toNode: string
  ): Promise<void> {
    // Actor state is in Cosmos DB (journal-based)
    // New node just needs to:
    // 1. Load state from journal
    // 2. Acquire lock
    // 3. Register in discovery
    // 4. Resume processing
  }
}
```

**Effort**: ~400 lines, 1 week  
**Dependencies**: 
- Consistent hash ring
- Enhanced health checks
- Node lifecycle events

---

## 📋 Implementation Roadmap

### **Phase 1: Distributed Actor Registry** (1 week)
**Goal**: Enable multi-node deployments with shared registry

**Tasks**:
1. Implement `RedisActorRegistry` (extends current in-memory version)
   ```typescript
   class RedisActorRegistry implements ActorRegistry {
     constructor(private redis: Redis) {}
     
     async register(reg: ActorRegistration) {
       await this.redis.hset(`actors:${reg.actorId}`, reg)
       await this.redis.sadd(`types:${reg.actorType}`, reg.actorId)
       await this.redis.expire(`actors:${reg.actorId}`, 60) // TTL
     }
     
     async getByType(type: string) {
       const ids = await this.redis.smembers(`types:${type}`)
       return Promise.all(ids.map(id => this.get(id)))
     }
   }
   ```

2. Add Redis Pub/Sub for real-time updates
3. Implement periodic heartbeat system
4. Add TTL-based cleanup

**Files Created**:
- `src/discovery/redis-actor-registry.ts` (~300 lines)

**Tests**:
- Multi-node registration
- Heartbeat expiration
- Type-based queries

**Deliverable**: Multiple Loom instances can share actor registry

---

### **Phase 2: Consistent Hashing** (3-5 days)
**Goal**: Deterministic actor placement

**Tasks**:
1. Implement `ConsistentHashRing` class
2. Integrate with `ActorRouter`
3. Add virtual node support (150 replicas per node)
4. Implement rebalancing on node add/remove

**Algorithm**:
```typescript
// Hash actor ID to ring position
const hash = murmur3(actorId) % (2^32)

// Find next node clockwise
const nodeId = ring.findNext(hash)

// Route to that node
await routeToNode(nodeId, actorId, message)
```

**Files Created**:
- `src/discovery/consistent-hash.ts` (~200 lines)
- `src/discovery/hash-router.ts` (~150 lines)

**Tests**:
- Hash distribution uniformity
- Node add/remove rebalancing
- Minimal actor migration

**Deliverable**: Actors consistently route to same node

---

### **Phase 3: Auto-Scaling** (2 weeks)
**Goal**: Dynamic node provisioning based on load

**Tasks**:
1. Implement `MetricsCollector`
   - Queue depth
   - CPU/memory per node
   - Actor count
   - Message throughput

2. Implement `AutoScaler`
   - Scale-up thresholds
   - Scale-down thresholds
   - Cooldown periods
   - Min/max node limits

3. Integrate with cloud providers
   - Kubernetes HPA
   - AWS ECS Auto Scaling
   - Azure Container Apps

4. Implement graceful drain
   - Stop accepting new actors
   - Finish current work
   - Migrate long-running actors

**Files Created**:
- `src/scaling/metrics-collector.ts` (~200 lines)
- `src/scaling/auto-scaler.ts` (~400 lines)
- `src/scaling/node-orchestrator.ts` (~300 lines)

**Configuration**:
```yaml
scaling:
  enabled: true
  minNodes: 2
  maxNodes: 20
  scaleUpThreshold:
    cpuPercent: 80
    queueDepth: 1000
    actorDensity: 10000
  scaleDownThreshold:
    cpuPercent: 20
    queueDepth: 100
  cooldownMinutes: 5
```

**Deliverable**: Automatic scaling based on load

---

### **Phase 4: Failover & Recovery** (1 week)
**Goal**: Automatic recovery from node failures

**Tasks**:
1. Implement `NodeWatcher`
   - Heartbeat monitoring
   - Failure detection
   - Recovery coordination

2. Implement `FailoverManager`
   - Actor migration
   - Lock recovery
   - State consistency

3. Add split-brain prevention
   - Fencing tokens
   - Quorum-based decisions

4. Graceful shutdown
   - Drain actors before exit
   - Coordinate with other nodes

**Files Created**:
- `src/resilience/node-watcher.ts` (~200 lines)
- `src/resilience/failover-manager.ts` (~400 lines)

**Tests**:
- Simulate node crash
- Verify actor migration
- No duplicate actors
- State consistency

**Deliverable**: Self-healing distributed system

---

## 📊 Effort Summary

| Component | Status | Effort | Priority |
|-----------|--------|--------|----------|
| Service Discovery | ✅ Complete | 0 | - |
| Load Balancing | ✅ Complete | 0 | - |
| Health Checks | ✅ Complete | 0 | - |
| Unified LLM API | ✅ Complete | 0 | - |
| Redis Actor Registry | ❌ Missing | 2-3 days | HIGH |
| Consistent Hashing | ❌ Missing | 3-5 days | HIGH |
| Auto-Scaling | ❌ Missing | 2 weeks | MEDIUM |
| Failover/Recovery | ❌ Partial | 1 week | MEDIUM |

**Total Missing Work**: ~4-5 weeks for full distributed runtime

---

## 🎯 Recommended Approach

### **Quick Win: Distributed Registry** (This Week)
Implement just the Redis-based actor registry. This enables:
- Multi-node deployments
- Shared actor discovery
- Load distribution

**Minimal Changes**:
1. Create `RedisActorRegistry` (~300 lines)
2. Update `ActorRouter` to use it
3. Add heartbeat system
4. Test with 2-3 nodes

**Benefits**:
- 70% of distributed runtime value
- 10% of total effort
- Production-ready in days

---

### **Medium Term: Add Hashing** (Next 2 Weeks)
Add consistent hashing for deterministic placement:
- Predictable actor location
- Efficient rebalancing
- Better cache locality

---

### **Long Term: Full Auto-Scaling** (Next 2 Months)
Add auto-scaling and advanced failover:
- Cost optimization
- Automatic recovery
- Enterprise-grade reliability

---

## 🚀 Next Steps

### **Immediate (This Week)**
1. ✅ Review this plan
2. ✅ Prioritize: Distributed Registry first?
3. ✅ Or prioritize: Unified LLM enhancements?

### **This Month**
Choose **ONE** path:

**Path A: Distributed Runtime**
- Week 1: Redis Actor Registry
- Week 2: Consistent Hashing
- Week 3-4: Basic failover

**Path B: AI-First Features**
- Week 1: Enhance Unified LLM (cost tracking, caching)
- Week 2: Pre-built connectors (Slack, Gmail, etc.)
- Week 3-4: RAG enhancements

### **Next Quarter**
- Verifiable computation (TLS Notary + RISC Zero)
- Full auto-scaling
- Production deployment examples

---

## 💡 Recommendation

**Start with AI-First features** because:
1. Unified LLM already works (just needs polish)
2. Pre-built connectors have immediate value
3. Distributed runtime can wait until you need scale
4. Most apps don't need >10K actors/node

**Then add Distributed Registry** when you:
- Deploy to multiple regions
- Need fault tolerance
- Exceed single-node capacity
- Want blue-green deployments

---

## 📚 References

**Existing Code**:
- Service Discovery: `src/discovery/index.ts`
- Health Checks: `packages/loom-server/src/resilience/health.ts`
- Unified LLM: `src/ai/unified-llm.ts`
- Load Balancing: `src/discovery/index.ts` (lines 175-250)

**Missing Components**:
- Redis Actor Registry: Not yet implemented
- Consistent Hash Ring: Not yet implemented
- Auto-Scaler: Not yet implemented
- Failover Manager: Not yet implemented

**Next Document**: 
- Create `UNIFIED_AI_ENHANCEMENTS.md` if going Path B
- Create `REDIS_REGISTRY_IMPLEMENTATION.md` if going Path A
