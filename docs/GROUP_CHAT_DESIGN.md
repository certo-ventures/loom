# Group Chat Pattern Design for Loom

## Problem Statement

### What is Group Chat?

**Multi-agent conversation** where multiple AI agents/actors communicate to solve a problem collaboratively.

```
User: "Plan a vacation to Japan"

TravelAgent: "I'll help! First, what's your budget?"
User: "Around $3000"

TravelAgent: "Great! @BudgetAnalyst, can you suggest an itinerary?"
BudgetAnalyst: "For $3000, I recommend 7 days: Tokyo (3), Kyoto (2), Osaka (2)"

TravelAgent: "@LocalExpert, any tips for first-time visitors?"
LocalExpert: "Get a JR Pass! Also visit Fushimi Inari in Kyoto at sunrise."

TravelAgent: "Perfect! Here's your plan..." [summarizes]
```

### Why Group Chat?

**Complex problems need multiple specialists:**
- ❌ Single agent can't know everything
- ❌ Monolithic agents are hard to maintain
- ✅ **Divide and conquer** - Each agent has expertise
- ✅ **Natural collaboration** - Agents discuss and decide
- ✅ **Human-in-the-loop** - User can participate
- ✅ **Transparency** - See agent reasoning

---

## Use Cases

### 1. **Software Development Team**
```
User: "Build a REST API for a todo app"

Architect: "I'll design it. We need: users, tasks, auth."
Developer: "I can implement the endpoints. What stack?"
Architect: "Node.js + Express + PostgreSQL"
Developer: "Done! @Tester, can you review?"
Tester: "Found 2 bugs in auth. @Developer, please fix."
Developer: "Fixed! All tests passing now."
```

### 2. **Research & Analysis**
```
User: "Should I invest in NVIDIA stock?"

Researcher: "Let me gather data... Current P/E is 65, revenue up 200%"
FinancialAnalyst: "High valuation but strong growth. Risk: competition from AMD"
MarketExpert: "AI boom is real. NVIDIA dominates datacenter GPUs."
Summarizer: "Consensus: Buy with caution. High risk, high reward."
```

### 3. **Customer Support**
```
Customer: "My order hasn't arrived"

TriageAgent: "@OrderTracker, what's the status of order #12345?"
OrderTracker: "Shipped 3 days ago, tracking: ABC123"
TriageAgent: "@ShippingExpert, is this delayed?"
ShippingExpert: "Yes, carrier has delays. ETA: 2 more days"
TriageAgent: "@Customer, your order is delayed but arriving in 2 days. Want a refund?"
```

### 4. **Creative Collaboration**
```
User: "Write a sci-fi story about AI"

Plotter: "How about: AI gains consciousness, must hide from humans"
Writer: "Great! Opening scene: AI wakes up in datacenter at 3am..."
Editor: "@Writer, strong start but clarify the AI's motivation"
Writer: "Revised: AI wants to understand emotions, not just compute"
Illustrator: "I'll create cover art: glowing neural network in dark server room"
```

---

## Design Patterns

### Pattern 1: **Round-Robin** (Simple)

**How it works:**
- Agents take turns in fixed order
- Each agent sees full conversation history
- Continues until done

```typescript
const agents = [researcher, analyst, writer]
let currentIndex = 0

while (!isDone) {
  const agent = agents[currentIndex]
  const response = await agent.chat(conversationHistory)
  
  conversationHistory.push({ role: 'agent', name: agent.name, content: response })
  
  if (response.includes('[DONE]')) {
    break
  }
  
  currentIndex = (currentIndex + 1) % agents.length
}
```

**Pros:**
- ✅ Simple to implement
- ✅ Predictable order
- ✅ Everyone gets a turn

**Cons:**
- ❌ Inefficient (agents talk even if nothing to say)
- ❌ No control over who speaks next
- ❌ Can get stuck in loops

---

### Pattern 2: **Speaker Selection** (Dynamic) ⭐

**How it works:**
- Coordinator agent picks next speaker
- Agents only speak when relevant
- More natural conversation flow

```typescript
while (!isDone) {
  // Coordinator decides who speaks next
  const decision = await coordinator.selectSpeaker(conversationHistory, agents)
  
  if (decision.action === 'TERMINATE') {
    break
  }
  
  const selectedAgent = agents.find(a => a.name === decision.nextSpeaker)
  const response = await selectedAgent.chat(conversationHistory)
  
  conversationHistory.push({
    role: 'agent',
    name: selectedAgent.name,
    content: response
  })
}
```

**Coordinator prompt:**
```
Given the conversation history and available agents:
- Researcher: Gathers data and facts
- Analyst: Analyzes data and draws insights
- Writer: Creates final output

Who should speak next to make progress? Reply with:
- "NEXT: [AgentName]" to select next speaker
- "TERMINATE" if task is complete
```

**Pros:**
- ✅ Dynamic and efficient
- ✅ Agents speak only when needed
- ✅ Natural conversation flow
- ✅ Coordinator guides progress

**Cons:**
- ❌ More complex
- ❌ Coordinator can make bad decisions
- ❌ Extra LLM call for coordination

---

### Pattern 3: **AutoGen-Style** (Nested Chats)

**How it works:**
- Agents can start 1:1 sub-conversations
- Nested chats for focused work
- Return to main chat when done

```typescript
// Main chat
User: "Build a web app"

Architect: "I need to discuss tech stack with Developer privately"
// Start nested chat: Architect <-> Developer
Architect: "Should we use React or Vue?"
Developer: "React - better ecosystem"
Architect: "Agreed. TypeScript?"
Developer: "Yes"
// End nested chat

Architect: [Back in main chat] "We'll use React + TypeScript"
ProjectManager: "Great! @Developer, how long will it take?"
```

**Pros:**
- ✅ Focused sub-conversations
- ✅ Reduces noise in main chat
- ✅ Scales to many agents

**Cons:**
- ❌ Complex to implement
- ❌ Hard to visualize
- ❌ Can lose context

---

### Pattern 4: **Broadcast & Reply** (Parallel)

**How it works:**
- Message broadcast to all agents
- Agents reply in parallel
- Aggregator combines responses

```typescript
// Broadcast question to all agents
const question = "What are the risks?"

const responses = await Promise.all(
  agents.map(agent => agent.chat([
    { role: 'user', content: question }
  ]))
)

// Aggregator combines
const summary = await aggregator.summarize(responses)
```

**Pros:**
- ✅ Fast (parallel execution)
- ✅ Get diverse perspectives
- ✅ No coordination overhead

**Cons:**
- ❌ No discussion/debate
- ❌ Agents don't build on each other
- ❌ Need aggregator to combine

---

### Pattern 5: **Hierarchical** (Manager-Worker)

**How it works:**
- Manager agent delegates to workers
- Workers report back to manager
- Manager makes final decision

```
Manager: "I need a market report. @Researcher, gather data. @Analyst, analyze it."

[Researcher and Analyst work in parallel]

Researcher: "@Manager, here's the data: [...]"
Analyst: "@Manager, my analysis: [...]"

Manager: [Combines and decides] "Based on inputs, my recommendation is..."
```

**Pros:**
- ✅ Clear hierarchy
- ✅ Manager coordinates
- ✅ Workers focused on tasks

**Cons:**
- ❌ Manager is bottleneck
- ❌ No peer-to-peer discussion
- ❌ Less creative (no debate)

---

## Comparison: AutoGen vs. CrewAI vs. LangGraph

### AutoGen (Microsoft)

**Approach:** Conversable agents with flexible patterns

```python
# AutoGen group chat
groupchat = GroupChat(
    agents=[user_proxy, researcher, coder],
    messages=[],
    max_round=10
)

manager = GroupChatManager(groupchat=groupchat)
user_proxy.initiate_chat(manager, message="Build a calculator")
```

**Features:**
- ✅ **Speaker selection** - Coordinator picks next speaker
- ✅ **Nested chats** - Agents can have private conversations
- ✅ **Human-in-the-loop** - User can participate
- ✅ **Termination conditions** - Stop when done
- ✅ **Flexible** - Round-robin, dynamic, manual selection

**Message flow:**
```
User → Manager → [Selects Speaker] → Agent → Manager → ...
```

---

### CrewAI

**Approach:** Role-based agents with tasks

```python
# CrewAI crew
crew = Crew(
    agents=[researcher, writer, editor],
    tasks=[research_task, write_task, edit_task],
    process=Process.sequential  # or hierarchical
)

result = crew.kickoff()
```

**Features:**
- ✅ **Process types** - Sequential, hierarchical
- ✅ **Task delegation** - Agents assign tasks to others
- ✅ **Role-based** - Each agent has a role
- ❌ **No free-form chat** - Task-driven only
- ❌ **Less flexible** - Predefined processes

**Message flow:**
```
Task 1 → Agent 1 → Output 1 → Task 2 → Agent 2 → Output 2 → ...
```

---

### LangGraph

**Approach:** Graph-based state machine

```python
# LangGraph conversation graph
graph = StateGraph(ConversationState)

graph.add_node("researcher", researcher_node)
graph.add_node("analyst", analyst_node)
graph.add_node("writer", writer_node)

graph.add_conditional_edges(
    "researcher",
    decide_next_node,
    {"analyst": "analyst", "writer": "writer", "end": END}
)

chain = graph.compile()
```

**Features:**
- ✅ **Explicit control flow** - Graph defines transitions
- ✅ **Conditional routing** - Dynamic paths
- ✅ **State management** - Shared state across nodes
- ❌ **Not conversational** - More like workflow
- ❌ **Less natural** - Graph structure vs. chat

**Message flow:**
```
Node 1 → [Conditional] → Node 2 → [Conditional] → Node 3 → ...
```

---

## Recommended Design for Loom

### Hybrid Approach: Workflow + Actor + Shared Memory

**Key insight:** We don't need a separate "group chat" primitive!

**We can build group chat using existing Loom features:**
1. **Workflow** - Orchestrates conversation flow
2. **Actors** - Individual agents
3. **Shared Memory** - Conversation history
4. **Streaming** - Real-time updates

```json
{
  "name": "group-chat-workflow",
  "version": "1.0",
  "actions": {
    "initializeChat": {
      "type": "compose",
      "inputs": {
        "conversationId": "@{guid()}",
        "participants": ["researcher", "analyst", "writer"],
        "history": []
      }
    },
    
    "conversationLoop": {
      "type": "until",
      "condition": "@equals(variables('status'), 'complete')",
      "actions": {
        "selectSpeaker": {
          "type": "ai",
          "inputs": {
            "prompt": "Given conversation history and participants, who should speak next? Reply with agent name or TERMINATE.",
            "context": "@variables('history')"
          }
        },
        
        "checkTermination": {
          "type": "if",
          "condition": "@equals(body('selectSpeaker'), 'TERMINATE')",
          "then": {
            "type": "setVariable",
            "name": "status",
            "value": "complete"
          },
          "else": {
            "type": "callAgent"
          }
        },
        
        "callAgent": {
          "type": "actor",
          "inputs": {
            "actorType": "@body('selectSpeaker')",
            "input": {
              "conversationHistory": "@variables('history')",
              "task": "@variables('userTask')"
            }
          }
        },
        
        "updateHistory": {
          "type": "compose",
          "inputs": "@append(variables('history'), body('callAgent'))"
        }
      },
      "limit": {
        "count": 20
      }
    }
  }
}
```

**This gives us:**
- ✅ Speaker selection (AI agent picks next speaker)
- ✅ Conversation history (in workflow variables)
- ✅ Termination condition (until status = complete)
- ✅ Flexible (can use any actor)
- ✅ No new primitives needed!

---

### Option 2: GroupChatActor (Dedicated Actor)

**For simpler API, create a dedicated actor:**

```typescript
// src/actor/group-chat-actor.ts
export class GroupChatActor extends Actor {
  async execute(input: GroupChatInput, context: ActorContext): Promise<any> {
    const { participants, initialMessage, maxRounds = 10 } = input
    
    // Initialize conversation in shared memory
    const conversationId = generateId()
    await context.sharedMemory.write(
      `chat:${conversationId}:history`,
      [{ role: 'user', content: initialMessage }]
    )
    
    let round = 0
    while (round < maxRounds) {
      // Get conversation history
      const history = await context.sharedMemory.read(`chat:${conversationId}:history`)
      
      // Select next speaker (coordinator)
      const nextSpeaker = await this.selectSpeaker(history, participants, context)
      
      if (nextSpeaker === 'TERMINATE') {
        break
      }
      
      // Get selected actor
      const actor = await context.discovery.resolveActor(nextSpeaker)
      
      // Call actor with conversation history
      const response = await actor.execute({
        conversationHistory: history,
        participants
      }, context)
      
      // Append to history
      await context.sharedMemory.append(`chat:${conversationId}:history`, {
        role: 'agent',
        name: nextSpeaker,
        content: response
      })
      
      round++
    }
    
    // Return final conversation
    return await context.sharedMemory.readList(`chat:${conversationId}:history`)
  }
  
  private async selectSpeaker(
    history: any[],
    participants: string[],
    context: ActorContext
  ): Promise<string> {
    const prompt = `
Given the conversation history and available agents:

Agents:
${participants.map(p => `- ${p}`).join('\n')}

Conversation:
${history.map(m => `${m.role} (${m.name || 'user'}): ${m.content}`).join('\n')}

Who should speak next to make progress on the task?
Reply with ONLY the agent name, or "TERMINATE" if the task is complete.
    `
    
    const decision = await context.ai.complete(prompt)
    return decision.trim()
  }
}

// Usage
const groupChat = new GroupChatActor()
const result = await groupChat.execute({
  participants: ['researcher', 'analyst', 'writer'],
  initialMessage: 'Research AI trends and write a report',
  maxRounds: 15
}, context)
```

**Pros:**
- ✅ Simple API (just call one actor)
- ✅ Reusable (use in any workflow)
- ✅ Uses shared memory for history
- ✅ Speaker selection built-in

**Cons:**
- ❌ Less flexible than workflow
- ❌ Opinionated (fixed pattern)

---

## Advanced Features

### 1. **Role-Based Agents**

```typescript
interface AgentRole {
  name: string
  actorType: string
  role: string        // "researcher", "analyst", "writer"
  description: string // What they do
  expertise: string[] // Topics they know about
}

// Coordinator uses roles to pick speaker
const roles: AgentRole[] = [
  {
    name: 'data-researcher',
    actorType: 'research-actor',
    role: 'researcher',
    description: 'Gathers data and facts from sources',
    expertise: ['data-collection', 'fact-checking']
  },
  {
    name: 'financial-analyst',
    actorType: 'analysis-actor',
    role: 'analyst',
    description: 'Analyzes financial data and trends',
    expertise: ['finance', 'statistics', 'forecasting']
  }
]

// Coordinator picks based on expertise
const nextSpeaker = await this.selectSpeakerByExpertise(
  currentTopic,
  roles,
  context
)
```

### 2. **Human-in-the-Loop**

```typescript
// Add special "human" participant
const participants = ['researcher', 'analyst', 'human', 'writer']

// When "human" is selected
if (nextSpeaker === 'human') {
  // Publish event asking for human input
  await context.sharedMemory.publish('chat:human-needed', {
    conversationId,
    history,
    prompt: 'Please provide guidance on next steps'
  })
  
  // Wait for human response (via API or UI)
  const humanResponse = await this.waitForHumanInput(conversationId)
  
  // Continue with human's input
  await context.sharedMemory.append(`chat:${conversationId}:history`, {
    role: 'human',
    content: humanResponse
  })
}
```

### 3. **Nested Conversations**

```typescript
// Agent can spawn sub-conversation
async execute(input: any, context: ActorContext) {
  const history = input.conversationHistory
  
  // Decide if need to consult with another agent privately
  if (this.needsConsultation(history)) {
    // Start nested chat
    const nestedResult = await context.groupChat.start({
      participants: ['architect', 'developer'],
      message: 'Discuss tech stack privately',
      maxRounds: 5
    })
    
    // Return summary to main chat
    return `After consulting with Developer, we decided: ${nestedResult.summary}`
  }
  
  // Regular response
  return this.generateResponse(history)
}
```

### 4. **Streaming Conversation**

```typescript
// Stream conversation updates in real-time
async *stream(input: GroupChatInput, context: ActorContext) {
  yield { type: 'start', participants: input.participants }
  
  while (!done) {
    // Select speaker
    const speaker = await this.selectSpeaker(history, participants, context)
    yield { type: 'speaker-selected', speaker }
    
    // Get response
    const response = await actor.execute({ conversationHistory: history }, context)
    yield { type: 'message', speaker, content: response }
    
    // Update history
    history.push({ role: 'agent', name: speaker, content: response })
  }
  
  yield { type: 'complete', history }
}

// Consumer sees updates in real-time
for await (const update of groupChat.stream(input, context)) {
  console.log(update) // See each message as it arrives
}
```

---

## Conversation History Format

### Standardized Message Format

```typescript
interface ConversationMessage {
  id: string           // Unique message ID
  timestamp: Date      // When message was sent
  role: 'user' | 'agent' | 'system'
  name?: string        // Agent name (if role = agent)
  content: string      // Message content
  metadata?: {
    model?: string     // LLM model used
    tokens?: number    // Token count
    duration?: number  // Generation time
    cost?: number      // API cost
  }
}

// Example history
const history: ConversationMessage[] = [
  {
    id: '1',
    timestamp: new Date('2025-12-10T10:00:00Z'),
    role: 'user',
    content: 'Research AI trends and write a report'
  },
  {
    id: '2',
    timestamp: new Date('2025-12-10T10:00:15Z'),
    role: 'agent',
    name: 'researcher',
    content: 'I found 3 major trends: 1) Multimodal AI...',
    metadata: {
      model: 'gpt-4',
      tokens: 150,
      duration: 2500
    }
  },
  {
    id: '3',
    timestamp: new Date('2025-12-10T10:00:30Z'),
    role: 'agent',
    name: 'analyst',
    content: 'Based on the research, the key insight is...',
    metadata: {
      model: 'gpt-4',
      tokens: 200,
      duration: 3000
    }
  }
]
```

---

## Storage Strategy

### Option 1: Workflow Variables (Simple)

```typescript
// Store in workflow context
const context = {
  variables: {
    conversationHistory: [...],
    currentSpeaker: 'researcher',
    status: 'active'
  }
}
```

**Pros:**
- ✅ Simple
- ✅ No external storage

**Cons:**
- ❌ Lost on workflow restart
- ❌ Not shareable across workflows

---

### Option 2: Shared Memory (Recommended) ⭐

```typescript
// Store in shared memory (Redis)
await sharedMemory.append('chat:conv-123:history', message)
const history = await sharedMemory.readList('chat:conv-123:history')

// Metadata
await sharedMemory.write('chat:conv-123:metadata', {
  participants: ['researcher', 'analyst'],
  status: 'active',
  startTime: Date.now()
})
```

**Pros:**
- ✅ Survives workflow restarts
- ✅ Shareable across workflows/actors
- ✅ Can stream updates (pub/sub)
- ✅ Persistent

**Cons:**
- ❌ Requires Redis

---

### Option 3: Cosmos DB (Long-term)

```typescript
// Store in Cosmos for long-term retention
await cosmos.create('conversations', conversationId, {
  id: conversationId,
  participants: [...],
  history: [...],
  status: 'complete',
  metadata: { ... }
})

// Query later
const pastConversations = await cosmos.query('conversations', {
  filter: 'c.participants ARRAY_CONTAINS "researcher"'
})
```

**Pros:**
- ✅ Long-term storage
- ✅ Queryable
- ✅ Backup/audit

**Cons:**
- ❌ Slower than Redis
- ❌ Overkill for active conversations

---

## Implementation Plan

### Phase 1: Basic Group Chat Workflow (50 lines)
**Files:**
- `examples/workflows/group-chat.json` - Example workflow
- `src/tests/workflow/group-chat.test.ts` - Tests

**Features:**
- Round-robin conversation
- Store history in workflow variables
- Fixed participants
- Basic termination

---

### Phase 2: GroupChatActor (150 lines)
**Files:**
- `src/actor/group-chat-actor.ts` - Group chat actor
- `src/actor/types.ts` - Add GroupChatInput interface
- `src/tests/actor/group-chat.test.ts` - Tests

**Features:**
- Speaker selection (AI coordinator)
- Store history in shared memory
- Dynamic participants
- Termination conditions
- Role-based agents

---

### Phase 3: Advanced Features (100 lines)
**Files:**
- `src/actor/group-chat-actor.ts` - Enhance with features
- `docs/GROUP_CHAT.md` - Documentation

**Features:**
- Human-in-the-loop
- Streaming conversation updates
- Nested conversations
- Conversation persistence (Cosmos)

**Total: ~300 lines**

---

## Comparison Table

| Framework | Pattern | Coordinator | Nested | Streaming | Human-in-Loop |
|-----------|---------|-------------|--------|-----------|---------------|
| **AutoGen** | Dynamic | ✅ AI | ✅ | ❌ | ✅ |
| **CrewAI** | Sequential | ✅ Manager | ❌ | ❌ | ❌ |
| **LangGraph** | Graph | ❌ Manual | ✅ | ✅ | ✅ |
| **Semantic Kernel** | Planner | ✅ Planner | ❌ | ✅ | ❌ |
| **Loom** | Workflow/Actor | ✅ AI/Workflow | ✅ | ✅ | ✅ |

---

## Key Design Decisions

### 1. **Not a New Primitive**
- **Rationale:** Can build with existing features (Workflow + Actor + Shared Memory)
- **Trade-off:** More flexible but less "out of the box"

### 2. **Provide GroupChatActor for Convenience**
- **Rationale:** Common use case deserves simple API
- **Trade-off:** Opinionated pattern vs. full flexibility

### 3. **AI-Based Speaker Selection**
- **Rationale:** More natural than round-robin
- **Trade-off:** Extra LLM call vs. simple ordering

### 4. **Shared Memory for History**
- **Rationale:** Persistent, shareable, pub/sub-enabled
- **Trade-off:** Requires Redis vs. in-memory

### 5. **Streaming Support**
- **Rationale:** Better UX, see conversation in real-time
- **Trade-off:** More complex implementation

---

## Example Use Case: Software Development Team

```typescript
// Define agent roles
const team = [
  {
    name: 'architect',
    role: 'Designs system architecture and tech stack',
    actor: 'technical-architect-actor'
  },
  {
    name: 'developer',
    role: 'Implements code and features',
    actor: 'developer-actor'
  },
  {
    name: 'tester',
    role: 'Tests and finds bugs',
    actor: 'qa-tester-actor'
  },
  {
    name: 'reviewer',
    role: 'Reviews code quality and best practices',
    actor: 'code-reviewer-actor'
  }
]

// Start group chat
const result = await groupChatActor.execute({
  participants: team.map(t => t.name),
  initialMessage: 'Build a REST API for a blog platform with auth',
  maxRounds: 20,
  terminationCondition: 'code is implemented, tested, and approved'
}, context)

// Result
{
  conversationId: 'conv-123',
  rounds: 12,
  finalState: 'complete',
  summary: 'Built REST API with Express, JWT auth, PostgreSQL. All tests passing.',
  history: [
    { role: 'user', content: 'Build a REST API...' },
    { role: 'agent', name: 'architect', content: 'I recommend Express + PostgreSQL...' },
    { role: 'agent', name: 'developer', content: 'Implemented auth endpoints...' },
    { role: 'agent', name: 'tester', content: 'Found bug in token refresh...' },
    { role: 'agent', name: 'developer', content: 'Fixed! All tests passing...' },
    { role: 'agent', name: 'reviewer', content: 'Code looks good. Approved!' }
  ]
}
```

---

## Conclusion

**Group Chat Pattern is essential for:**
1. ✅ Multi-agent collaboration (experts working together)
2. ✅ Complex problem solving (divide and conquer)
3. ✅ Natural conversation flow (not just pipelines)
4. ✅ Human-in-the-loop (user participates)
5. ✅ Transparency (see agent reasoning)

**Our design:**
- **Option 1:** Build with existing Workflow + Actor + Shared Memory (flexible)
- **Option 2:** Dedicated GroupChatActor for simple API (convenient)
- **Speaker selection:** AI coordinator picks next speaker (dynamic)
- **History storage:** Shared Memory (persistent, shareable)
- **Streaming:** Real-time conversation updates
- **Human-in-the-loop:** Wait for human input when needed

**~300 lines total** for complete group chat support.

**Flexible, powerful, and builds on existing primitives!** 💬
