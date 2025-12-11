# Claude (Anthropic) Multi-Agent Communication Pattern Analysis

## Overview

Anthropic's Claude doesn't have a traditional "multi-agent framework" like CrewAI or AutoGen. Instead, they use a **tool-based coordination pattern** where a single Claude instance orchestrates multiple capabilities through:

1. **Tool Calling** - Claude can call external tools/APIs
2. **Prompt Chaining** - Sequential prompts with context passing
3. **Model Context Protocol (MCP)** - Standardized tool/resource access
4. **Context Windows** - Large context (200K tokens) for full conversation history

---

## How Claude Handles Multi-Agent Patterns

### 1. **Tool Calling (Primary Pattern)**

Instead of multiple agents, Claude uses **function calling** where:
- One Claude instance is the orchestrator
- "Agents" are implemented as tools/functions
- Claude decides which tool to call based on conversation

**Example Pattern:**
```typescript
// Claude sees these as available tools
const tools = [
  {
    name: "code_writer",
    description: "Writes code based on requirements",
    input_schema: { type: "object", properties: { requirements: { type: "string" }}}
  },
  {
    name: "code_reviewer", 
    description: "Reviews code for bugs and improvements",
    input_schema: { type: "object", properties: { code: { type: "string" }}}
  }
]

// Claude orchestrates:
// 1. User: "Build a login system"
// 2. Claude calls code_writer(requirements: "login system")
// 3. Claude calls code_reviewer(code: <result from step 2>)
// 4. Claude synthesizes final response
```

**In Loom Terms:**
- Each tool = an Activity or Actor
- Claude = Workflow orchestrator
- Tool calls = Activity invocations

---

### 2. **Prompt Chaining with Context**

For complex multi-step reasoning:
```typescript
// Step 1: Generate plan
const planPrompt = `You are an architect. Design a system for: ${userRequest}`
const plan = await claude.complete(planPrompt)

// Step 2: Implement (with full context)
const implPrompt = `
Previous step (architect): ${plan}

You are now a developer. Implement the plan above.
`
const code = await claude.complete(implPrompt)

// Step 3: Review (with full context)
const reviewPrompt = `
Architecture: ${plan}
Implementation: ${code}

You are now a reviewer. Review the code above.
`
const review = await claude.complete(reviewPrompt)
```

**Key Insight:** Each step gets FULL context from previous steps. No separate memory system needed.

---

### 3. **Model Context Protocol (MCP)**

Anthropic's MCP is essentially:
- **Standardized tool/resource interface**
- **Resources** - Data sources (files, databases, APIs)
- **Tools** - Actions the model can take
- **Prompts** - Reusable prompt templates

**MCP Server Example:**
```typescript
// MCP server exposes tools
const mcpServer = {
  tools: [
    { name: "read_database", schema: {...} },
    { name: "send_email", schema: {...} },
    { name: "call_api", schema: {...} }
  ],
  resources: [
    { uri: "file://project/data.json" },
    { uri: "database://main/users" }
  ]
}

// Claude can:
// 1. Read resources for context
// 2. Call tools to take actions
// 3. Chain multiple operations
```

**In Loom Terms:**
- MCP Server = Activity Store + Service Discovery
- MCP Tools = Activities
- MCP Resources = State Store + Blob Storage

---

### 4. **Information Exchange Patterns**

Claude handles information exchange through:

#### A. **Conversation Memory (Simple)**
```typescript
const conversationHistory = []

// Turn 1
conversationHistory.push({ role: "user", content: "Build login" })
const response1 = await claude.messages.create({
  messages: conversationHistory,
  tools: tools
})
conversationHistory.push({ role: "assistant", content: response1.content })

// Turn 2 - Full context available
const response2 = await claude.messages.create({
  messages: conversationHistory,  // <-- All previous context
  tools: tools
})
```

#### B. **Artifacts/Shared State (Advanced)**
```typescript
// Claude can maintain "artifacts" - structured data that persists
const artifacts = {
  codebase: "",
  testResults: "",
  documentation: ""
}

// Claude updates artifacts via tool calls
await claude.messages.create({
  messages: [...],
  tools: [
    {
      name: "update_artifact",
      description: "Update shared artifact",
      input_schema: {
        type: "object",
        properties: {
          artifact_name: { type: "string" },
          content: { type: "string" }
        }
      }
    }
  ]
})
```

#### C. **Streaming with Server-Sent Events**
```typescript
const stream = await claude.messages.stream({
  messages: [...],
  tools: [...],
  stream: true
})

for await (const chunk of stream) {
  if (chunk.type === 'content_block_start') {
    // New content block
  } else if (chunk.type === 'content_block_delta') {
    // Partial content (streaming text)
  } else if (chunk.type === 'tool_use') {
    // Claude is calling a tool
  }
}
```

---

## Claude vs. Traditional Multi-Agent Frameworks

### Traditional (CrewAI, AutoGen)
```
User → Manager Agent → Worker Agent 1 (researcher)
                    → Worker Agent 2 (writer)  
                    → Worker Agent 3 (reviewer)

Each agent has:
- Own memory
- Own tools
- Own decision making
```

### Claude Approach
```
User → Claude (with tools) → tool: researcher()
                           → tool: writer()
                           → tool: reviewer()

Claude has:
- Unified context (200K tokens)
- All tools visible
- Single decision maker
```

**Trade-offs:**

| Aspect | Traditional Multi-Agent | Claude Pattern |
|--------|------------------------|----------------|
| **Parallelism** | ✅ Agents can work in parallel | ❌ Sequential tool calls |
| **Autonomy** | ✅ Each agent decides independently | ❌ Claude orchestrates everything |
| **Context** | ❌ Need explicit sharing | ✅ Automatic via context window |
| **Simplicity** | ❌ Complex coordination | ✅ Simple orchestration |
| **Scalability** | ✅ More agents = more capacity | ❌ Limited by single model |
| **Cost** | 💰💰 Multiple LLM calls | 💰 Single LLM with tools |

---

## What Loom Has (vs. Claude)

### ✅ **Advantages Over Claude Pattern**

1. **True Parallelism**
   - Multiple actors can execute simultaneously
   - Claude is sequential (tool calls happen one by one)
   
2. **Distributed Execution**
   - Actors run on different nodes
   - Claude is single-threaded, single-process
   
3. **Durable State**
   - Journal-based replay across restarts
   - Claude conversations are ephemeral (unless saved externally)
   
4. **Actor Isolation**
   - Each actor has independent state
   - Claude shares all context (can't isolate)
   
5. **Human-in-the-Loop**
   - `waitForEvent()` pauses execution for days
   - Claude needs to restart entire conversation

6. **Real Multi-Agent**
   - Agents can spawn other agents
   - Claude just calls tools (no agent spawning)

### ❌ **What Claude Does Better**

1. **Context Integration**
   - 200K token context = automatic information sharing
   - We need explicit shared memory (Redis)
   
2. **Tool Discovery**
   - Claude sees all tools at once, picks best one
   - We need to explicitly define workflow steps
   
3. **Natural Termination**
   - Claude knows when conversation is complete
   - We need explicit termination conditions
   
4. **Streaming**
   - Built-in SSE streaming
   - We just added this (Redis Streams)

---

## How to Combine Both Approaches

### **Hybrid Pattern: Loom + Claude**

```typescript
// Use Claude AS an actor in Loom
class ClaudeOrchestratorActor extends Actor {
  async execute(input: unknown) {
    const { task, availableActors } = input
    
    // Claude decides the workflow
    const plan = await claude.messages.create({
      messages: [{
        role: "user",
        content: `Available actors: ${availableActors.join(', ')}
        
Task: ${task}

Generate a workflow plan using these actors.`
      }],
      tools: availableActors.map(actor => ({
        name: actor.name,
        description: actor.description,
        input_schema: actor.schema
      }))
    })
    
    // Loom executes the plan durably
    for (const step of plan.tool_calls) {
      await this.callActivity(step.name, step.input)
    }
  }
}
```

**Benefits:**
- Claude's intelligence for planning
- Loom's durability for execution
- Best of both worlds

---

## Recommendations for Loom

### 1. **Keep Shared Memory** ✅
We implemented this! Claude uses context window, we use Redis.

**Why:** Allows true multi-agent collaboration without requiring massive context.

### 2. **Add "Claude Mode"**
```typescript
// Single orchestrator with tool calling
class ClaudeModeWorkflow {
  async execute(input: unknown) {
    // Use one AI actor that coordinates everything via tool calling
    // Tools = Activities in Loom
    // Simpler for simple tasks
  }
}
```

**Why:** Some tasks don't need distributed actors, just good orchestration.

### 3. **Enhance Group Chat**
```typescript
// Current implementation is good, but add:
class GroupChatActor extends Actor {
  async *stream(input: unknown) {
    // 1. Let Claude BE the coordinator (instead of round-robin)
    const coordinator = new ClaudeAgent(this.context)
    
    // 2. Claude sees conversation history + agent descriptions
    const nextSpeaker = await coordinator.selectSpeaker(history, participants)
    
    // 3. Execute selected agent's Actor
    const agent = participants.find(p => p.name === nextSpeaker)
    await agent.actor.execute({ history, context })
  }
}
```

**Why:** Claude is REALLY good at deciding "who should speak next" based on context.

### 4. **Add Artifact Pattern**
```typescript
// Like Claude artifacts - shared structured data
interface Artifact {
  type: 'code' | 'document' | 'data' | 'config'
  name: string
  content: string
  version: number
}

class ArtifactStore {
  async update(artifact: Artifact): Promise<void>
  async get(name: string): Promise<Artifact>
  async list(): Promise<Artifact[]>
}
```

**Why:** Better than key-value for structured collaboration.

### 5. **Improve Streaming**
We have Redis Streams, but add:
```typescript
// Streaming with richer metadata (like Claude)
interface StreamEvent {
  type: 'thinking' | 'tool_use' | 'content' | 'complete'
  agent?: string
  tool?: string
  content?: string
  metadata?: Record<string, unknown>
}
```

**Why:** Better debugging and user experience.

---

## Summary

**Claude's Pattern:**
- Single orchestrator + tools
- Large context window = automatic sharing
- Simple but sequential
- Great for straightforward tasks

**Loom's Pattern:**
- Multiple distributed actors
- Explicit shared memory
- Parallel + durable
- Great for complex, long-running workflows

**Best Practice:**
Use Loom for the orchestration framework, optionally use Claude as an intelligent actor within Loom that can coordinate other actors through tool calling.

**We Already Built Most of It!**
- ✅ Shared Memory (Redis)
- ✅ Streaming Output (Redis Streams)
- ✅ Group Chat (multi-agent coordination)
- ✅ Tool Calling (Activities)
- ✅ Durable Execution (Journal)

**Next Steps:**
- Consider adding "Claude Mode" - single AI orchestrator with tools
- Enhance group chat to use AI for speaker selection
- Add Artifact pattern for structured collaboration
