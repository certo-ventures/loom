# Ray Agents vs Loom: Comparative Analysis

**Date**: January 3, 2026  
**Purpose**: Evaluate Ray Agents architecture and identify features to incorporate into Loom

---

## Ray Agents Core Architecture

### 1. **AgentSession (Stateful Ray Actor)**
- **Pattern**: `@ray.remote(num_cpus=0.5)` decorated class
- **State Management**: Maintains conversation history in-memory
- **Session Identity**: Each session has unique `session_id`
- **Lifecycle**: Persistent actor that survives across multiple calls
- **Message Format**: Simple `list[dict]` with `{"role": "user/assistant", "content": "..."}`

### 2. **AgentAdapter (Framework Abstraction)**
- **Purpose**: Bridge between Ray and agent frameworks (LangGraph, CrewAI, Autogen)
- **Interface**: Abstract `run(message, messages, tools)` method
- **Responsibility**: Translates Ray remote functions to framework-specific tools
- **Output**: Returns `dict` with `"content"` key

### 3. **Distributed Tool Execution**
- **Tool Definition**: `@ray.remote(num_cpus=4, num_gpus=1, memory=8GB)` functions
- **Resource Awareness**: Explicit CPU/GPU/memory requirements
- **Scheduling**: Ray handles distributed scheduling to appropriate nodes
- **Adapter Translation**: Wraps Ray remote functions as framework-compatible callables

### 4. **Separation of Concerns**
- **Framework**: Controls tool selection, execution order, agent reasoning, LLM integration
- **Ray**: Provides distributed execution, resource allocation, fault tolerance, scalability
- **Adapter**: Bridges framework and Ray without either being aware of the other

---

## Loom Current Architecture

### Strengths
✅ **Durable Execution**: Full Orleans-style durable execution with journal replay  
✅ **Actor Model**: Actors with state management, message passing, parent-child relationships  
✅ **Observability**: Metrics, tracing, logging built-in  
✅ **Memory System**: Semantic memory with entities, facts, episodes, graph storage  
✅ **Configuration**: Dynamic config with layered resolvers (in-memory, Cosmos)  
✅ **Decision Tracing**: Lamport clocks, causal ordering, decision graphs  
✅ **Authorization**: Permission system with policies and RBAC  
✅ **Pipelines**: Workflow orchestration with stages and executors  
✅ **Activities**: Retry policies, exponential backoff, resilience patterns  
✅ **Discovery**: Service discovery for distributed actors  

### Gaps (Compared to Ray Agents)

❌ **Multi-Framework Adapter Pattern**: No abstraction for integrating different agent frameworks  
❌ **Explicit Resource Requirements**: No declarative CPU/GPU/memory specifications for activities  
❌ **Heterogeneous Hardware Awareness**: No built-in support for routing to GPU nodes vs CPU nodes  
❌ **Tool Abstraction Layer**: Tools are just activities, not framework-agnostic callable abstractions  
❌ **Conversation Session Pattern**: No dedicated session actor pattern for multi-turn conversations  

---

## Features Worth Incorporating

### 🔥 **High Priority**

#### 1. **AgentAdapter Pattern for Multi-Framework Support**
**Value**: Make Loom framework-agnostic like Ray Agents

```typescript
// New: Agent adapter abstraction
export abstract class AgentAdapter {
  abstract async run(
    message: string,
    history: ConversationMessage[],
    tools: LoomTool[]
  ): Promise<AgentResponse>
}

// Concrete implementations
export class LangGraphAdapter extends AgentAdapter { ... }
export class CrewAIAdapter extends AgentAdapter { ... }
export class AutoGenAdapter extends AgentAdapter { ... }
export class OpenAISwarmAdapter extends AgentAdapter { ... }
```

**Why**: Currently Loom is tightly coupled to its own patterns. This would allow users to bring their preferred agent framework while getting Loom's durability, observability, and distributed execution.

**Implementation Path**:
- Create `src/agent-adapters/` directory
- Define abstract `AgentAdapter` base class
- Create adapters for popular frameworks (LangGraph, CrewAI, Autogen, OpenAI Swarm)
- Each adapter translates Loom activities → framework tools
- Adapters handle conversation state mapping

---

#### 2. **Explicit Resource Requirements for Activities**
**Value**: Enable heterogeneous hardware scheduling

```typescript
// Enhanced activity decorator
export function activity(options: {
  name: string
  retryPolicy?: RetryPolicy
  resources?: {  // NEW
    cpus?: number
    gpus?: number
    memory?: number  // bytes
    customResources?: Record<string, number>
  }
}) { ... }

// Usage
@activity({
  name: 'train-model',
  resources: {
    gpus: 1,
    memory: 16 * 1024 ** 3,  // 16GB
    cpus: 8
  }
})
async function trainModel(data: Dataset) {
  // GPU-intensive training
}

@activity({
  name: 'analyze-text',
  resources: {
    cpus: 2,
    memory: 1 * 1024 ** 3  // 1GB
  }
})
async function analyzeText(text: string) {
  // CPU-bound text processing
}
```

**Why**: Currently Loom has no notion of hardware requirements. This would enable:
- Smart scheduling to GPU nodes for ML workloads
- Memory-aware placement (don't run 16GB job on 8GB node)
- Cost optimization (use cheaper CPU nodes when possible)
- Better multi-tenancy (quota enforcement)

**Implementation Path**:
- Add `resources` field to `ActivityDefinition`
- Extend runtime to track node capabilities
- Create scheduler that matches activity requirements to node capabilities
- Integrate with BullMQ for queue-based scheduling
- Add metrics for resource utilization

---

#### 3. **Conversation Session Actor Pattern**
**Value**: First-class support for multi-turn agent conversations

```typescript
// New: Dedicated session actor
@actor
export class ConversationSession extends Actor {
  private messages: ConversationMessage[] = []
  private adapter: AgentAdapter
  private sessionId: string
  
  constructor(
    sessionId: string,
    adapter: AgentAdapter,
    tools: LoomTool[]
  ) {
    this.sessionId = sessionId
    this.adapter = adapter
    this.tools = tools
  }
  
  async run(message: string): Promise<AgentResponse> {
    // Add user message
    this.messages.push({ role: 'user', content: message })
    
    // Delegate to adapter
    const response = await this.adapter.run(
      message,
      this.messages,
      this.tools
    )
    
    // Add assistant message
    this.messages.push({ role: 'assistant', content: response.content })
    
    // Journal state for durability
    await this.journal({ type: 'message', data: response })
    
    return response
  }
  
  async getHistory(): Promise<ConversationMessage[]> {
    return this.messages
  }
  
  async clearHistory(): Promise<void> {
    this.messages = []
    await this.journal({ type: 'clear_history' })
  }
}
```

**Why**: Currently you'd build this manually with actors. A dedicated pattern makes it ergonomic and leverages Loom's durability automatically.

**Implementation Path**:
- Create `ConversationSession` actor class in `src/conversation/`
- Integrate with agent adapters
- Add conversation-specific observability (turn count, tokens used, etc.)
- Add helpers for common patterns (summarization, context pruning)
- Document best practices for multi-turn agentic workflows

---

### 🟡 **Medium Priority**

#### 4. **Tool Abstraction & Registry**
**Value**: Decouple tool definitions from frameworks

```typescript
// New: Tool abstraction
export interface LoomTool {
  name: string
  description: string
  schema: JSONSchema
  resources?: ResourceRequirements
  execute: (args: any) => Promise<any>
}

// Tool registry
export class ToolRegistry {
  private tools = new Map<string, LoomTool>()
  
  register(tool: LoomTool): void {
    this.tools.set(tool.name, tool)
  }
  
  get(name: string): LoomTool | undefined {
    return this.tools.get(name)
  }
  
  // Convert to adapter-specific format
  toAdapterTools(adapter: AgentAdapter): any[] {
    return adapter.convertTools(Array.from(this.tools.values()))
  }
}

// Usage
const toolRegistry = new ToolRegistry()

toolRegistry.register({
  name: 'search-database',
  description: 'Search the customer database',
  schema: { /* JSON Schema */ },
  resources: { cpus: 1, memory: 512 * 1024 ** 2 },
  execute: async (args) => {
    // Use Loom activity
    return await ctx.activities.searchDatabase(args)
  }
})
```

**Why**: Makes tools portable across different agent frameworks. Tools become first-class Loom primitives, not just activities.

---

#### 5. **Resource-Aware Scheduling**
**Value**: Match workloads to appropriate hardware

```typescript
// New: Node capability discovery
export class NodeCapabilities {
  cpus: number
  gpus: number
  memory: number
  customResources: Record<string, number>
}

// New: Scheduler interface
export interface ActivityScheduler {
  schedule(
    activity: ActivityDefinition,
    requirements: ResourceRequirements
  ): Promise<NodeId>
}

// Implementation
export class ResourceAwareScheduler implements ActivityScheduler {
  async schedule(activity, requirements): Promise<NodeId> {
    // Find nodes with sufficient resources
    const eligibleNodes = this.discovery.findNodes(requirements)
    
    // Apply placement strategy (round-robin, least-loaded, etc.)
    return this.selectNode(eligibleNodes)
  }
}
```

**Why**: Loom currently has no scheduling intelligence beyond BullMQ's basic queue processing. This enables:
- GPU workloads go to GPU nodes
- Memory-intensive tasks go to high-memory nodes
- Cost optimization
- Better resource utilization

---

### 🟢 **Low Priority / Nice to Have**

#### 6. **Framework-Specific State Management**
- Some frameworks (CrewAI, Autogen) have complex internal state
- Adapters could expose hooks for framework state persistence
- Low priority because Loom's journal already handles most state needs

#### 7. **Tool Result Caching**
- Ray doesn't mention this, but could cache tool results by input hash
- Useful for expensive/deterministic operations
- Could integrate with Loom's existing caching patterns

---

## What Loom Does BETTER Than Ray Agents

### 1. **Durable Execution**
- Ray Agents: No durability mentioned, likely in-memory only
- **Loom**: Full journal-based durability with replay, crash recovery, exactly-once semantics

### 2. **Memory & Knowledge Management**
- Ray Agents: Only conversation history (simple list)
- **Loom**: Semantic memory with entities, facts, episodes, embeddings, graph storage, temporal queries

### 3. **Observability & Tracing**
- Ray Agents: Not mentioned
- **Loom**: Built-in metrics, distributed tracing, Lamport clocks, causal ordering, decision traces

### 4. **Actor Lifecycle & Hierarchies**
- Ray Agents: Simple flat actors
- **Loom**: Parent-child relationships, actor supervision, complex lifecycle management

### 5. **Authorization & Security**
- Ray Agents: Not mentioned
- **Loom**: Permission system, RBAC, policy-based authorization, tenant isolation

### 6. **Configuration Management**
- Ray Agents: Not mentioned
- **Loom**: Dynamic config with layered resolvers, hot-reload, schema validation

### 7. **Workflow Orchestration**
- Ray Agents: Delegated to frameworks
- **Loom**: Built-in pipeline DSL with stages, executors, error handling, progress tracking

---

## Recommended Implementation Priority

### Phase 1: Foundation (1-2 weeks)
1. ✅ Design `AgentAdapter` abstract class
2. ✅ Add `resources` field to activity metadata
3. ✅ Create node capability discovery system

### Phase 2: Core Adapters (2-3 weeks)
4. ✅ Implement LangGraph adapter
5. ✅ Implement OpenAI Swarm adapter  
6. ✅ Implement CrewAI adapter
7. ✅ Create `ConversationSession` actor pattern

### Phase 3: Scheduling (1-2 weeks)
8. ✅ Implement resource-aware scheduler
9. ✅ Integrate with BullMQ queues
10. ✅ Add scheduling metrics & observability

### Phase 4: Polish (1 week)
11. ✅ Create tool registry abstraction
12. ✅ Documentation & examples
13. ✅ Integration tests with real frameworks

---

## Key Architectural Decisions

### Decision 1: Adapter Location
**Options**:
- A) Part of core Loom (`src/agent-adapters/`)
- B) Separate packages (`@loom/adapter-langgraph`)

**Recommendation**: **A** - Keep in core initially, extract to packages later if needed. Easier to iterate and maintain consistency.

---

### Decision 2: Resource Requirements - Required or Optional?
**Options**:
- A) Required for all activities
- B) Optional with sensible defaults

**Recommendation**: **B** - Optional. Most activities don't need explicit resource specs. Default to `{ cpus: 1, memory: 512MB }` if not specified.

---

### Decision 3: Scheduling Strategy
**Options**:
- A) Build custom scheduler from scratch
- B) Extend BullMQ with resource awareness
- C) Integrate with external scheduler (K8s, Nomad)

**Recommendation**: **B** for MVP. BullMQ already handles queues, just add:
- Queue per resource tier (gpu-queue, high-mem-queue, etc.)
- Worker nodes subscribe to queues matching their capabilities
- Simple but effective for most use cases

---

### Decision 4: Conversation State - Durable or Ephemeral?
**Options**:
- A) Always durable (journal every message)
- B) Optional durability (flag)
- C) Ephemeral only (Ray style)

**Recommendation**: **A** - Always durable. It's Loom's core value prop. Users can clear history if they want ephemeral behavior.

---

## Integration with Existing Loom Features

### 1. **Adapters + Durability**
```typescript
class LangGraphAdapter extends AgentAdapter {
  async run(message, history, tools) {
    // Adapter logic...
    const result = await graph.invoke(...)
    
    // Journal for durability (automatic via ConversationSession)
    return result
  }
}
```

### 2. **Resources + Discovery**
```typescript
// Discovery service advertises node capabilities
await discovery.register({
  nodeId: 'worker-gpu-1',
  capabilities: {
    cpus: 32,
    gpus: 2,
    memory: 128 * 1024 ** 3
  }
})

// Scheduler uses discovery to find eligible nodes
const node = await scheduler.schedule(activity, requirements)
```

### 3. **Tools + Activities**
```typescript
// Activities become tools automatically
@activity({ name: 'fetch-data', resources: { cpus: 2 } })
async function fetchData(query: string) { ... }

// Tool registry wraps activities
toolRegistry.registerActivity(fetchData)

// Adapters convert to framework format
const langGraphTools = adapter.convertTools(toolRegistry.getAll())
```

### 4. **Conversation + Memory**
```typescript
class ConversationSession extends Actor {
  async run(message: string) {
    // Standard conversation logic...
    
    // Also store in semantic memory
    await this.memory.addEpisode({
      type: 'conversation_turn',
      entities: extractedEntities,
      facts: extractedFacts,
      content: message
    })
  }
}
```

---

## Summary: What to Build

### Must Have (Ray Parity)
✅ **AgentAdapter abstraction** - Multi-framework support  
✅ **Resource requirements** - CPU/GPU/memory specs for activities  
✅ **ConversationSession pattern** - First-class conversation support  

### Should Have (Loom Advantage)
✅ **Resource-aware scheduling** - Smart placement based on requirements  
✅ **Tool registry** - Framework-agnostic tool abstraction  
✅ **Integration with durability** - Durable conversations & tool calls  

### Nice to Have (Future)
⚪ **Adapter marketplace** - Community-contributed adapters  
⚪ **Hybrid scheduling** - Mix of BullMQ + K8s for complex deployments  
⚪ **Tool result caching** - Cache expensive deterministic operations  

---

## Conclusion

Ray Agents has a **clean, focused architecture** for distributed agent execution with multi-framework support. The key innovations are:

1. **Adapter pattern** for framework agnosticism
2. **Explicit resource requirements** for heterogeneous hardware
3. **Clean separation** between framework logic and distributed execution

Loom should adopt these patterns while maintaining its core strengths:
- Durable execution (Loom's killer feature)
- Rich memory & knowledge management
- Observability & tracing
- Authorization & security
- Workflow orchestration

The combination would create a **distributed, durable, observable, multi-framework agent platform** - significantly more powerful than either system alone.

**Estimated Effort**: 6-8 weeks for full implementation  
**Risk Level**: Low - additive features, no breaking changes to existing Loom API  
**Value**: High - Opens Loom to entire agentic AI ecosystem (LangGraph, CrewAI, Autogen, OpenAI Swarm, etc.)
