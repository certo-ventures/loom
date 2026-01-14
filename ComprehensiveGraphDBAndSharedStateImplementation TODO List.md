Comprehensive Implementation TODO List
Project: LoomWeave
Distributed Graph Database with Git-like Semantics on GUN

Phase 0: Foundation & Dependencies (3 days)
TODO-001: Project Structure
 Create src/services/gun/ directory structure
 Create src/graph/loomweave/ directory (our graph database)
 Create src/storage/gun/ directory
 Add docs/LOOMWEAVE.md architecture document
 Update package.json with dependencies
Acceptance: Directory structure exists, documented

TODO-002: Install Dependencies
 Add to package.json dependencies
 Run npm install
 Verify no version conflicts
 Update lockfile
Acceptance: Dependencies installed, build succeeds

TODO-003: Azure Container Apps Research
 Document Azure Container Apps ingress options (internal/external)
 Document service discovery (DNS, environment variables)
 Document persistent storage options (Azure Files, Blob)
 Document inter-container networking (Container Apps environment)
 Create docs/AZURE_DEPLOYMENT.md
Acceptance: Deployment architecture documented with specific ACA features

Phase 1: GUN Service Wrapper (5 days)
TODO-004: Service Interface
 Define Service interface if not exists
 Define HealthCheck interface
 Define Metrics interface
 Add ServiceLifecycle enum (starting, running, stopping, stopped)
 Write tests for interfaces
Acceptance: Interface defined, typed, tested

Lines of code: ~50

TODO-005: GUN Service Config
 Define GunServiceConfig interface
 Support Azure Container Apps service discovery (env var peers)
 Support Azure Files mount points for persistence
 Add validation for config
 Add config builder with defaults
 Write tests
Acceptance: Config typed, validated, ACA-aware

Lines of code: ~100

TODO-006: Core GUN Service
 Implement GunService class
 Implement start() - initialize GUN instance
 Implement stop() - cleanup
 Implement getGun() - return shared instance
 Implement isHealthy() - check peer connections
 Add peer connection management
 Add retry logic with exponential backoff
 Write unit tests (mock GUN)
Acceptance: Service starts/stops cleanly, health checks work

Lines of code: ~200

TODO-007: GUN Metrics & Monitoring
 Implement getMetrics() method
 Track peer count
 Track node count (estimate)
 Track disk usage
 Track sync latency (sample)
 Add Prometheus-compatible metrics export
 Write tests
Acceptance: Metrics exported, accurate

Lines of code: ~150

TODO-008: GUN Service Integration Tests
 Test service lifecycle (start/stop)
 Test peer connection (with mock relay)
 Test offline mode
 Test health checks
 Test metrics collection
 Test concurrent access (multiple callers)
Acceptance: All integration tests pass

Lines of code: ~300

Phase 2: GUN State Store Adapter (4 days)
TODO-009: GUN State Store Interface
 Implement StateStore interface
 Implement get(actorId) - fetch state from GUN
 Implement set(actorId, state) - save state to GUN
 Implement delete(actorId) - tombstone pattern
 Implement list(prefix) - query actors
 Add timeout handling (don't wait forever)
 Add error handling with retries
 Write unit tests
Acceptance: StateStore interface fully implemented

Lines of code: ~250

TODO-010: Actor State Indexing
 Create index: actors:all -> Set of actor IDs
 Create index: actors:by_type:{type} -> Set of actor IDs
 Auto-update indexes on state changes
 Implement efficient list() using indexes
 Write tests
Acceptance: Listing actors is fast (<10ms for 1000 actors)

Lines of code: ~150

TODO-011: State Store Integration
 Add gun option to AdapterConfig.stateStore.type
 Update createStateStore() to accept GunService
 Handle case where GUN not enabled (graceful fallback)
 Update tests
 Update TypeScript types
Acceptance: Factory can create GUN state store

Lines of code: ~50

TODO-012: State Store Tests
 Test get/set/delete operations
 Test concurrent updates (conflict resolution)
 Test network partition (offline mode)
 Test large states (>1MB)
 Test list with prefixes
 Benchmark performance
Acceptance: All tests pass, performance acceptable

Lines of code: ~400

Phase 3: Multi-Node State Sync (5 days)
TODO-013: Actor State Sync Helper
 Implement ActorStateSync class
 Implement subscribeToRemoteUpdates() - watch GUN changes
 Implement broadcastStateChange() - publish to GUN
 Add conflict detection
 Add change debouncing (batch rapid updates)
 Add circuit breaker for failing peers
 Write tests
Acceptance: Actors sync state across nodes automatically

Lines of code: ~200

TODO-014: Actor Infrastructure Config Update
 Add infrastructureOptions parameter to constructor
 Add private field for options
 Update getInfrastructureConfig() to merge options
 Ensure backward compatibility (existing code works)
 Write tests
Acceptance: Actors can receive per-instance config

Lines of code: ~30 (already done in previous session!)

TODO-015: Docker Compose Test Environment
 Create GUN relay service
 Create Loom node 1 (with GUN)
 Create Loom node 2 (with GUN)
 Add network configuration
 Add volume mounts
 Add health checks
 Document usage
Acceptance: Can spin up 3-node cluster locally

Lines of code: ~100 (YAML)

TODO-016: Multi-Node Integration Tests
 Test state sync between 2 nodes
 Test state sync between 3 nodes
 Test partition tolerance (disconnect node)
 Test partition recovery (reconnect)
 Test concurrent updates from 2 nodes
 Test conflict resolution
 Measure sync latency
Acceptance: State syncs reliably, conflicts resolved

Lines of code: ~500

Phase 4: LoomWeave Graph Storage (6 days)
TODO-017: Graph Data Model
 Define Node interface (id, type, properties, metadata)
 Define Edge interface (id, from, to, type, properties, weight)
 Define Graph interface
 Define NodeType and EdgeType enums for agents
 Add validation functions
 Add serialization/deserialization
 Write tests
Acceptance: Clean, type-safe graph model

Lines of code: ~200

TODO-018: LoomWeave Storage Layer
 Implement LoomWeaveStore class on GUN
 Implement putNode(id, data) - store node
 Implement putEdge(from, to, type, props) - store edge
 Implement getNode(id) - retrieve node
 Implement getEdge(id) - retrieve edge
 Implement outgoing edge index
 Implement incoming edge index
 Implement type index
 Add batch operations for efficiency
 Write tests
Acceptance: Nodes and edges persist in GUN, retrievable

Lines of code: ~400

TODO-019: Graph Indexes
 Implement IndexManager class
 Property index (type:property:value -> nodeIds)
 Time-series index (timestamp buckets -> nodeIds)
 Full-text search index (tokens -> nodeIds)
 Spatial index (for future geo queries)
 Auto-update indexes on writes
 Implement rebuild index (recovery)
 Write tests
Acceptance: Queries are fast (<100ms for 100k nodes)

Lines of code: ~500

TODO-020: Storage Tests
 Test node CRUD operations
 Test edge CRUD operations
 Test index creation and querying
 Test batch operations
 Test error handling
 Benchmark: 10k nodes, 50k edges
Acceptance: All storage operations reliable

Lines of code: ~400

Phase 5: LoomWeave Query Engine (7 days)
TODO-021: Graph Traversal
 Implement GraphTraversal class
 Implement BFS traversal
 Implement DFS traversal
 Implement bidirectional search
 Implement max depth limits
 Implement edge type filtering
 Add cycle detection
 Write tests
Acceptance: Can traverse graphs efficiently

Lines of code: ~300

TODO-022: Path Finding
 Implement shortest path (Dijkstra)
 Implement weighted paths
 Implement all paths (limited depth)
 Implement path constraints (must pass through X)
 Add path ranking
 Write tests
Acceptance: Can find optimal paths

Lines of code: ~250

TODO-023: Pattern Matching
 Define pattern DSL (similar to Cypher)
 Implement pattern parser
 Implement pattern matcher
 Support variable binding
 Support WHERE clauses
 Write tests
Example:

Acceptance: Complex patterns work

Lines of code: ~400

TODO-024: Query Engine
 Implement QueryEngine class
 Integrate traversal, pathfinding, pattern matching
 Implement query optimizer (choose best strategy)
 Add query caching
 Add query timeout
 Add query explain (show execution plan)
 Write tests
Acceptance: Queries are fast and composable

Lines of code: ~350

TODO-025: Aggregation & Analytics
 Implement node degree (in/out/total)
 Implement PageRank (simplified)
 Implement clustering coefficient
 Implement connected components
 Implement centrality measures
 Use Worker threads for CPU-heavy algorithms
 Write tests
Acceptance: Can analyze graph structure

Lines of code: ~400

TODO-026: Query Interface
 Fluent query builder API
 Cypher-like string queries
 GraphQL-like queries
 Export results to JSON/CSV
 Query composition
 Write tests
Example:

Acceptance: Ergonomic, powerful query interface

Lines of code: ~300

Phase 6: Git-like Versioning on GUN (5 days)
TODO-027: Content-Addressable Storage
 Implement ContentAddressableStore class
 SHA-256 hashing for content addressing
 Store objects by hash in GUN
 Implement writeObject(obj) -> hash
 Implement readObject(hash) -> obj
 Add object verification
 Write tests
Acceptance: Objects stored immutably by content hash

Lines of code: ~150

TODO-028: Commit Model
 Define Commit interface
 Define Tree interface (snapshot of graph)
 Define Blob interface (individual node/edge)
 Implement commit creation
 Implement parent tracking (DAG)
 Add commit metadata (author, timestamp, message)
 Write tests
Acceptance: Git-like commit model works

Lines of code: ~200

TODO-029: Branch Management
 Implement BranchManager class
 Store refs in GUN (refs/heads/branch-name -> commit hash)
 Implement createBranch(name, from)
 Implement listBranches()
 Implement deleteBranch(name)
 Implement getBranchHead(name)
 Support tags
 Write tests
Acceptance: Can manage branches like git

Lines of code: ~200

TODO-030: Merge Algorithm
 Implement three-way merge
 Find merge base (common ancestor)
 Compute patch sets (Immer integration!)
 Operational transform for patches
 Detect conflicts (same path, different values)
 Implement merge strategies (LWW, manual, CRDT)
 Write tests with conflict scenarios
Acceptance: Can merge branches, handle conflicts

Lines of code: ~500

TODO-031: Version Control API
 Implement VersionControl class
 Combine commits, branches, merges
 Implement commit(message) - create commit
 Implement checkout(branch) - switch branch
 Implement merge(branch) - merge branch
 Implement log() - show history
 Implement diff(commit1, commit2) - show changes
 Write tests
Acceptance: Full git-like workflow works

Lines of code: ~350

Phase 7: AI Agent Context Graph (4 days)
TODO-032: Agent Context Model
 Define agent node types (Agent, Decision, Fact, Observation)
 Define edge types (MADE_DECISION, INFLUENCED_BY, LED_TO)
 Define causal relationship model
 Define context window structure
 Write tests
Acceptance: Agent context model is clear and typed

Lines of code: ~150

TODO-033: Context Manager
 Implement AgentContextManager class
 Implement recordDecision(agent, decision, context)
 Implement getAgentContext(agent, windowHours)
 Implement explainDecision(decisionId) - causal chain
 Implement findSimilarDecisions(decision) - pattern match
 Implement context ranking (relevance scoring)
 Write tests
Acceptance: Agents can query their own context

Lines of code: ~400

TODO-034: Causal Reasoning
 Implement causal chain traversal
 Implement causal strength calculation
 Implement counterfactual queries ("what if X didn't happen?")
 Implement causal graph pruning (remove weak links)
 Write tests
Acceptance: Can reason about causality

Lines of code: ~300

TODO-035: Integration with ActorMemory
 Add LoomWeave backend option to ActorMemory
 Bridge existing memory APIs to LoomWeave
 Maintain backward compatibility
 Write migration tests
 Document upgrade path
Acceptance: ActorMemory can use LoomWeave as backend

Lines of code: ~200

Phase 8: Azure Container Apps Integration (4 days)
TODO-036: Azure Service Discovery
 Read peer list from Azure environment variables
 Support Azure Container Apps DNS (service.namespace.svc)
 Auto-discover peers via Container Apps API
 Implement health-based peer selection
 Write tests
Acceptance: GUN auto-discovers peers in ACA

Lines of code: ~200

TODO-037: Azure Files Persistence
 Mount Azure Files as GUN data directory
 Handle shared storage across replicas
 Implement file locking (avoid corruption)
 Add retry logic for transient Azure errors
 Write tests
Acceptance: GUN persists to Azure Files reliably

Lines of code: ~150

TODO-038: Azure Deployment Templates
 Create Container Apps environment
 Create GUN relay container
 Create Loom node containers
 Configure ingress (internal/external)
 Configure scaling rules
 Configure persistent storage
 Add monitoring/logging
 Document deployment
Acceptance: Can deploy to Azure with one command

Lines of code: ~500 (Bicep)

TODO-039: Azure Monitoring
 Export metrics to Azure Monitor
 Export logs to Log Analytics
 Add Application Insights integration
 Create Azure dashboards (JSON)
 Set up alerts for unhealthy peers
 Write tests
Acceptance: Full observability in Azure

Lines of code: ~250

Phase 9: Performance & Optimization (5 days)
TODO-040: Caching Layer
 Implement multi-level cache (L1: memory, L2: GUN)
 LRU eviction policy
 Cache warming on startup
 Cache invalidation on updates
 Cache hit/miss metrics
 Write tests
Acceptance: 90%+ cache hit rate for hot data

Lines of code: ~300

TODO-041: Batch Operations
 Batch multiple writes into single GUN operation
 Batch read requests
 Configurable batch size/timeout
 Error handling (partial failures)
 Write tests
Acceptance: 10x throughput improvement for bulk ops

Lines of code: ~200

TODO-042: Query Optimization
 Query plan generation
 Cost estimation for different strategies
 Index selection
 Join order optimization
 Query result caching
 Write tests
Acceptance: Complex queries 5x faster

Lines of code: ~350

TODO-043: Load Testing
 Test 1000 actors across 3 nodes
 Test 100k graph nodes
 Test 1M graph edges
 Test 10k queries/sec
 Test network partition recovery
 Document performance characteristics
Acceptance: Meets performance targets

Lines of code: ~400

TODO-044: Performance Benchmarks
 Benchmark all core operations
 Compare vs Redis/Cosmos
 Compare vs Neo4j (for graph queries)
 Generate performance report
 Set up continuous benchmarking
Acceptance: Know exactly where we stand

Lines of code: ~300

Phase 10: Documentation & Polish (3 days)
TODO-045: API Documentation
 Document all public APIs with TSDoc
 Generate API docs with TypeDoc
 Add code examples for each API
 Create migration guide from existing storage
 Create troubleshooting guide
Acceptance: Every API documented

TODO-046: Tutorials
 Tutorial: Setting up GUN service
 Tutorial: Building an agent context graph
 Tutorial: Using git-like versioning
 Tutorial: Writing graph queries
 Tutorial: Deploying to Azure
Acceptance: Users can get started in <30 min

TODO-047: Integration Examples
 Example: Multi-node actor state sync
 Example: Agent decision tracking
 Example: Causal reasoning
 Example: Branch/merge workflows
 Example: Complex graph queries
Acceptance: Real-world examples work

Lines of code: ~800

TODO-048: Error Handling & Logging
 Add detailed error messages
 Add context to all errors
 Add structured logging
 Add debug mode
 Add error recovery strategies
 Write tests
Acceptance: Easy to diagnose issues

Lines of code: ~200

Summary
Phase	Days	TODOs	Est. Lines
0. Foundation	3	3	150
1. GUN Service	5	5	800
2. State Store	4	4	850
3. Multi-Node	5	4	830
4. Graph Storage	6	4	1500
5. Query Engine	7	6	2000
6. Git Versioning	5	5	1400
7. Agent Context	4	4	1050
8. Azure Integration	4	4	1100
9. Performance	5	5	1550
10. Documentation	3	4	1000
TOTAL	51 days	48 TODOs	~12,230 lines
Minimal Code, Maximum Functionality Strategy
Leverage GUN - Don't rebuild storage/sync (saved ~5000 lines)
Use Immer patches - Git-like diffs for free (saved ~1000 lines)
Reuse Actor infrastructure - No separate graph runtime (saved ~2000 lines)
TypeScript types - Catch errors at compile time (saved debugging time)
Composition over inheritance - Small, focused classes
Test each component - Catch bugs early (save refactoring time)
Implementation Order (Prioritized)
Must Have (MVP) - 25 days
Phase 0-3: GUN service + state sync
Phase 4: Basic graph storage
Phase 7: Agent context (partial)
Should Have - 15 days
Phase 5: Query engine
Phase 6: Git versioning
Phase 8: Azure integration
Nice to Have - 11 days
Phase 9: Performance optimization
Phase 10: Documentation polish
Milestone Checklist
 Milestone 1 (Day 12): GUN service + state store working
 Milestone 2 (Day 17): Multi-node sync tested
 Milestone 3 (Day 23): Graph storage + basic queries
 Milestone 4 (Day 30): Query engine complete
 Milestone 5 (Day 35): Git versioning working
 Milestone 6 (Day 39): Agent context integrated
 Milestone 7 (Day 43): Azure deployment tested
 Milestone 8 (Day 48): Performance validated
 Milestone 9 (Day 51): Documentation complete
Risk Mitigation
Risk	Mitigation	TODO
GUN performance issues	Benchmark early, fallback to Redis	TODO-043
Merge conflicts complex	Start simple (LWW), add CRDT later	TODO-030
Azure costs high	Use dev environment, optimize storage	TODO-038
Query engine slow	Add caching, indexes early	TODO-041
Too ambitious	Cut nice-to-have features	Milestone 1 review
Ready to start with TODO-001 (project structure)?