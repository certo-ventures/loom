# LoomWeave: Distributed Graph Database

**LoomWeave** is Loom's distributed graph database built on GUN, providing:
- **Distributed state sync** for actors across nodes
- **Git-like versioning** with branches, commits, and merges
- **Graph query engine** with pattern matching and traversal
- **AI agent context graphs** with causal reasoning

## Architecture

```
┌─────────────────────────────────────────────────┐
│              LoomWeave Layer                    │
│  ┌──────────────┐  ┌──────────────┐            │
│  │ Query Engine │  │ Version Ctrl │            │
│  └──────┬───────┘  └──────┬───────┘            │
│         │                  │                     │
│  ┌──────▼──────────────────▼───────┐            │
│  │     Graph Storage (Nodes/Edges) │            │
│  └──────────────┬──────────────────┘            │
└─────────────────┼──────────────────────────────┘
                  │
┌─────────────────▼──────────────────────────────┐
│              GUN Service Layer                  │
│  ┌──────────────────────────────────┐          │
│  │  Distributed Sync & Persistence  │          │
│  │  - Real-time state replication   │          │
│  │  - Conflict resolution (HAM)     │          │
│  │  - Offline-first support         │          │
│  └──────────────────────────────────┘          │
└─────────────────────────────────────────────────┘
```

## Components

### 1. GUN Service (`src/services/gun/`)
- **GunService**: Lifecycle management, shared instance
- **GunMetrics**: Monitoring and observability
- **GunConfig**: Azure-aware configuration

### 2. Graph Storage (`src/graph/loomweave/`)
- **LoomWeaveStore**: Core graph storage (nodes, edges, indexes)
- **IndexManager**: Secondary indexes for fast queries
- **Model**: Type-safe graph data model

### 3. Query Engine (`src/graph/loomweave/`)
- **QueryEngine**: Pattern matching, traversal, pathfinding
- **GraphTraversal**: BFS, DFS, bidirectional search
- **PatternMatcher**: Cypher-like query DSL

### 4. Version Control (`src/graph/loomweave/`)
- **VersionControl**: Git-like branches, commits, merges
- **ContentAddressableStore**: Immutable object storage
- **MergeAlgorithm**: Three-way merge with Immer patches

### 5. Agent Context (`src/graph/loomweave/`)
- **AgentContextManager**: Track decisions, facts, observations
- **CausalReasoning**: Explain decisions with causal chains
- **ContextRanking**: Relevance scoring for agent context

## Usage

### Distributed Actor State

```typescript
// Configure GUN service
const gunService = new GunService({
  peers: ['http://relay-1:8765', 'http://relay-2:8765'],
  file: './data/gun',
  allowOffline: true
})

await gunService.start()

// Create state store backed by GUN
const stateStore = new GunStateStore(gunService.getGun())

// Actor state automatically syncs across nodes!
const actor = new MyActor(context, initialState, {
  stateStore
})
```

### Graph Queries

```typescript
// Build agent context graph
const graph = new LoomWeave(gunService.getGun())

// Record decision with context
await graph.recordDecision(agentId, {
  action: 'query_database',
  confidence: 0.95
}, {
  facts: [fact1, fact2],
  reasoning: ['Policy match', 'High confidence']
})

// Query graph
const results = await graph.query()
  .match('(a:Agent)-[:MADE_DECISION]->(d:Decision)')
  .where({ 'd.confidence': { $gt: 0.9 } })
  .return(['a', 'd'])
  .execute()

// Explain decision
const explanation = await graph.explainDecision(decisionId)
console.log(explanation.causalChain) // Full reasoning path
```

### Git-like Versioning

```typescript
// Create branch for policy testing
await graph.createBranch('test-policy-v2', 'main')
await graph.checkout('test-policy-v2')

// Make changes
await graph.updatePolicy(policyId, newRules)

// Commit
await graph.commit('Test new policy rules')

// Merge back to main
await graph.checkout('main')
const result = await graph.merge('test-policy-v2')

if (result.conflicts.length > 0) {
  // Handle conflicts
  await graph.resolveConflicts(result.conflicts, 'LWW')
}
```

## Deployment (Azure Container Apps)

```yaml
# Gun relay container
- name: gun-relay
  image: gundb/gun:latest
  env:
    - name: GUN_PORT
      value: "8765"
  scale:
    minReplicas: 2
    maxReplicas: 5

# Loom node containers
- name: loom-node
  image: loom:latest
  env:
    - name: GUN_PEERS
      value: "http://gun-relay:8765"
    - name: GUN_DATA_PATH
      value: "/mnt/azure-files/gun"
  volumeMounts:
    - name: gun-data
      mountPath: /mnt/azure-files/gun
```

## Performance Targets

| Operation | Target | Scale |
|-----------|--------|-------|
| Actor state get | <5ms | 1M actors |
| Actor state set | <10ms | 10k writes/sec |
| Multi-node sync | <50ms | 3+ nodes |
| Graph traversal (depth 3) | <100ms | 100k nodes |
| Graph query (complex) | <200ms | 1M edges |
| Merge branches | <500ms | 10k changes |

## Development Status

See [TODO List](../ComprehensiveGraphDBAndSharedStateImplementation%20TODO%20List.md) for implementation progress.

## Minimal Code, Maximum Functionality

LoomWeave achieves full functionality with ~12k lines by:
- ✅ Leveraging GUN for storage/sync (~5k lines saved)
- ✅ Using Immer patches for git diffs (~1k lines saved)
- ✅ Reusing Actor infrastructure (~2k lines saved)
- ✅ TypeScript for compile-time safety
- ✅ Composition over inheritance
- ✅ Comprehensive testing
