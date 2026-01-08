# Phase 7 Roadmap: Two Paths Forward

## Overview

After completing Phases 1-6 (98 tests, 96% passing), we have two compelling options for Phase 7. Both build on the foundation we've created but serve different strategic purposes.

---

## 🎯 RECOMMENDED: Phase 7A - Real-Time Collaboration & Group Decisions

### Vision
Transform the decision system from single-actor to multi-actor, enabling teams, committees, and hybrid AI+human groups to make decisions together with full auditability.

### Core Components

#### 1. **DeliberationRoom Class**
Multi-actor decision discussion space with real-time collaboration.

**Features:**
- Create rooms for specific decision types
- Invite actors (human or AI)
- Track conversation history
- Link to final decision
- Support async and sync modes

**Methods:**
```typescript
class DeliberationRoom extends ActorMemory {
  async createRoom(config: RoomConfig): Promise<string>
  async addParticipant(roomId: string, actorId: string, role: ParticipantRole): Promise<void>
  async postMessage(roomId: string, message: Message): Promise<void>
  async submitArgument(roomId: string, argument: Argument): Promise<void>
  async submitEvidence(roomId: string, evidence: Evidence): Promise<void>
  async getConversation(roomId: string): Promise<Conversation>
  async closeRoom(roomId: string, outcome: RoomOutcome): Promise<void>
}
```

#### 2. **ConsensusEngine Class**
Manages voting, consensus building, and decision finalization.

**Voting Mechanisms:**
- Unanimous (all must agree)
- Majority (>50%)
- Supermajority (configurable threshold)
- Weighted voting (by role, expertise, stake)
- Ranked choice
- Approval voting

**Features:**
- Quorum requirements
- Voting periods and deadlines
- Vote delegation
- Anonymous vs recorded votes
- Vote changing before deadline
- Abstentions

**Methods:**
```typescript
class ConsensusEngine {
  async initializeVote(config: VoteConfig): Promise<string>
  async castVote(voteId: string, actorId: string, vote: Vote): Promise<void>
  async delegateVote(voteId: string, from: string, to: string): Promise<void>
  async tallyVotes(voteId: string): Promise<VoteResult>
  async checkQuorum(voteId: string): Promise<boolean>
  async finalizeDecision(voteId: string): Promise<Decision>
}
```

#### 3. **ArgumentGraph Class**
Track arguments, counter-arguments, and evidence in structured format.

**Features:**
- Argument chains (supports/opposes)
- Evidence linking
- Credibility scoring
- Consensus convergence tracking
- Dissent recording

**Structure:**
```typescript
interface Argument {
  id: string;
  authorId: string;
  position: 'for' | 'against' | 'neutral';
  content: string;
  evidence: Evidence[];
  supportsArgumentId?: string;
  opposesArgumentId?: string;
  credibilityScore: number;
  timestamp: number;
}

interface Evidence {
  id: string;
  type: 'data' | 'precedent' | 'policy' | 'expert_opinion' | 'external_source';
  content: string;
  source: string;
  reliability: number;
}
```

#### 4. **GroupDecisionMemory Class**
Extends DecisionMemory to track group dynamics.

**Additional Tracking:**
- Who voted how
- Opinion changes over time
- Minority opinions
- Time to consensus
- Group effectiveness metrics

**Methods:**
```typescript
class GroupDecisionMemory extends DecisionMemory {
  async recordGroupDecision(decision: GroupDecision): Promise<void>
  async trackOpinionChange(actorId: string, before: Opinion, after: Opinion): Promise<void>
  async recordDissent(actorId: string, reason: string): Promise<void>
  async getGroupDynamics(roomId: string): Promise<GroupDynamics>
  async analyzeGroupEffectiveness(actorIds: string[]): Promise<EffectivenessMetrics>
}
```

#### 5. **EscalationChain Class**
Route decisions through organizational hierarchies.

**Features:**
- Define escalation paths
- Automatic escalation triggers
- Timeout handling
- Override permissions
- Appeal mechanisms

**Example:**
```typescript
const chain = new EscalationChain(storage, clock);
await chain.defineChain('loan-approval', [
  { level: 1, actorId: 'loan-officer', maxAmount: 10000 },
  { level: 2, actorId: 'manager', maxAmount: 100000 },
  { level: 3, actorId: 'committee', maxAmount: Infinity }
]);
```

### Integration with Existing Phases

**Phase 1 (Decision Trace):**
- Group decisions create richer traces
- Multiple actors per decision
- Deliberation history captured

**Phase 2 (Precedent Search):**
- Search across group decisions
- Find similar committee outcomes
- Learn from other groups

**Phase 3 (Policy Evolution):**
- Policies can require group approval
- Policy changes voted on by committee
- Group-specific policies

**Phase 4 (Observability):**
- Group decision quality metrics
- Consensus time tracking
- Group effectiveness dashboards

**Phase 5 (AI Analytics):**
- AI can participate in deliberation
- AI suggests evidence and precedents
- AI predicts group outcome

**Phase 6 (Distributed Sync):**
- Sync group decisions across tenants
- Federated deliberation rooms
- Cross-organization collaboration

### Use Cases

1. **Loan Committee Approvals**
   - Multiple underwriters review application
   - Risk manager provides analysis
   - Committee votes on approval
   - Dissenting opinions recorded

2. **Medical Diagnosis Review**
   - Multiple specialists weigh in
   - Evidence from test results
   - Consensus on treatment plan
   - Second opinions tracked

3. **Investment Board Decisions**
   - Partners vote on investments
   - Weighted by investment amount
   - Due diligence linked
   - Track success rate by voter

4. **Code Review & Merge**
   - Reviewers approve/reject
   - Comments as arguments
   - Required approvals (quorum)
   - Merge decision recorded

5. **DAO Governance**
   - Token-weighted voting
   - Proposal discussion
   - On-chain decision recording
   - Transparent deliberation

### Testing Strategy

**Test Coverage:**
- 25+ tests covering all scenarios
- Unit tests for each component
- Integration tests for workflows
- Performance tests for large groups

**Key Test Scenarios:**
- Unanimous consensus
- Majority vote with dissent
- Quorum not met
- Vote delegation chains
- Escalation through levels
- Async deliberation
- Opinion changes
- AI participation

### Success Metrics

- All group decision types supported
- <100ms vote tallying for 1000 voters
- Complete audit trail of deliberation
- Precedent search works across groups
- AI can participate meaningfully

---

## 🔌 Phase 7B - Loom API Service (Complete System Exposure)

### Vision
Create a production-ready REST API service that exposes **every capability** of the Loom system - actor management, memory operations, decision systems, workflows, configuration, and observability. Think of it as "Loom-as-a-Service."

### Architecture Philosophy

**FastAPI-Based Microservice:**
- Single service that wraps the entire Loom library
- OpenAPI/Swagger documentation for all endpoints
- Multi-tenant by design
- Pluggable storage backends (in-memory, Redis, PostgreSQL, Cosmos)
- WebSocket support for real-time operations
- Event streaming for async workflows

**Inspired by ROMA:**
- Execution-scoped storage (isolated directories per task)
- Automatic Parquet storage for large responses (>100KB)
- Health checks and observability built-in
- Profile-based configuration (development, staging, production)
- Interactive API docs at `/docs`

### Complete API Surface

The Loom API Service exposes **9 major subsystems** through a comprehensive REST API:

---

#### 1. **Actor Management API** (`/api/v1/actors`)

**Purpose:** Create, manage, and monitor actors

**Endpoints:**
```typescript
POST   /api/v1/actors                          # Create actor
GET    /api/v1/actors/:id                      # Get actor details
GET    /api/v1/actors                          # List actors (with filters)
PUT    /api/v1/actors/:id                      # Update actor config
DELETE /api/v1/actors/:id                      # Delete actor
POST   /api/v1/actors/:id/start                # Start actor
POST   /api/v1/actors/:id/stop                 # Stop actor
POST   /api/v1/actors/:id/restart              # Restart actor
GET    /api/v1/actors/:id/status               # Get runtime status
POST   /api/v1/actors/:id/message              # Send message to actor
GET    /api/v1/actors/:id/messages             # Get actor messages
POST   /api/v1/actors/:id/config               # Update configuration
GET    /api/v1/actors/:id/health               # Health check
```

**Features:**
- Hot reloading of actor code
- Dynamic configuration updates
- Actor discovery and routing
- Status monitoring (idle, running, error)
- Message queue inspection

---

#### 2. **Memory & Knowledge Graph API** (`/api/v1/memory`)

**Purpose:** Access the knowledge graph, facts, entities, and relationships

**Endpoints:**
```typescript
// Entities
POST   /api/v1/memory/entities                 # Create entity
GET    /api/v1/memory/entities/:id             # Get entity
PUT    /api/v1/memory/entities/:id             # Update entity
DELETE /api/v1/memory/entities/:id             # Delete entity
GET    /api/v1/memory/entities                 # Search entities

// Facts (Relationships)
POST   /api/v1/memory/facts                    # Add fact
GET    /api/v1/memory/facts/:id                # Get fact
GET    /api/v1/memory/facts                    # Search facts
DELETE /api/v1/memory/facts/:id                # Delete fact

// Graph Queries
POST   /api/v1/memory/graph/query              # Complex graph query
GET    /api/v1/memory/graph/neighbors/:id      # Get neighbors
GET    /api/v1/memory/graph/path               # Find path between entities
POST   /api/v1/memory/graph/traverse           # Graph traversal
GET    /api/v1/memory/graph/subgraph/:id       # Extract subgraph

// Episodes (Temporal)
POST   /api/v1/memory/episodes                 # Create episode
GET    /api/v1/memory/episodes/:id             # Get episode
GET    /api/v1/memory/episodes                 # Search episodes

// Similarity Search
POST   /api/v1/memory/search/vector            # Vector similarity search
POST   /api/v1/memory/search/semantic          # Semantic search
POST   /api/v1/memory/search/hybrid            # Hybrid search
```

---

#### 3. **Decision Systems API** (`/api/v1/decisions`)

**Purpose:** All Phase 7A group decision capabilities

**Endpoints:**
```typescript
// Decisions (Phase 6)
POST   /api/v1/decisions                       # Record decision
GET    /api/v1/decisions/:id                   # Get decision
GET    /api/v1/decisions                       # Search decisions
POST   /api/v1/decisions/:id/outcome           # Track outcome
POST   /api/v1/decisions/search/precedents    # Find similar decisions

// DeliberationRoom (Phase 7A)
POST   /api/v1/deliberations                   # Create room
GET    /api/v1/deliberations/:id               # Get room details
POST   /api/v1/deliberations/:id/participants  # Add participant
POST   /api/v1/deliberations/:id/messages      # Post message
POST   /api/v1/deliberations/:id/arguments     # Submit argument
POST   /api/v1/deliberations/:id/close         # Close room
GET    /api/v1/deliberations/:id/conversation  # Get conversation
WS     /ws/deliberations/:id                   # WebSocket for real-time

// ConsensusEngine
POST   /api/v1/votes                           # Initialize vote
POST   /api/v1/votes/:id/cast                  # Cast vote
POST   /api/v1/votes/:id/delegate              # Delegate vote
GET    /api/v1/votes/:id/tally                 # Tally votes
POST   /api/v1/votes/:id/finalize              # Finalize decision

// ArgumentGraph
POST   /api/v1/arguments/topics                # Create topic
POST   /api/v1/arguments/topics/:id/arguments  # Submit argument
POST   /api/v1/arguments/topics/:id/evidence   # Attach evidence
GET    /api/v1/arguments/topics/:id/chain      # Get argument chain
GET    /api/v1/arguments/topics/:id/consensus  # Analyze consensus

// EscalationChain
POST   /api/v1/escalations/chains              # Define chain
POST   /api/v1/escalations/decisions           # Submit decision
POST   /api/v1/escalations/decisions/:id/approve   # Approve
POST   /api/v1/escalations/decisions/:id/reject    # Reject
POST   /api/v1/escalations/decisions/:id/escalate  # Escalate
GET    /api/v1/escalations/pending             # Get pending decisions

// GroupDecisionMemory
POST   /api/v1/group-decisions                 # Record group decision
GET    /api/v1/group-decisions/:id/dynamics    # Get group dynamics
GET    /api/v1/group-decisions/:id/participation  # Participation metrics
POST   /api/v1/group-decisions/search/similar  # Find similar decisions
```

---

#### 4. **Configuration API** (`/api/v1/config`)

**Purpose:** Hierarchical configuration management (leveraging existing ConfigResolver)

**Endpoints:**
```typescript
// Configuration CRUD
GET    /api/v1/config/:keyPath                 # Get config value
POST   /api/v1/config/:keyPath                 # Set config value
DELETE /api/v1/config/:keyPath                 # Delete config
GET    /api/v1/config                          # List all config keys

// Context-aware resolution
POST   /api/v1/config/resolve                  # Resolve with context
                                               # Body: { key, context: { clientId, tenantId, env } }

// Bulk operations
POST   /api/v1/config/import                   # Import config (JSON)
GET    /api/v1/config/export                   # Export config
POST   /api/v1/config/copy                     # Copy config tree
POST   /api/v1/config/validate                 # Validate structure

// Profiles
GET    /api/v1/config/profiles                 # List profiles
GET    /api/v1/config/profiles/:name           # Get profile
POST   /api/v1/config/profiles                 # Create profile
```

---

#### 5. **Workflow & Pipeline API** (`/api/v1/workflows`)

**Purpose:** Task orchestration and pipeline execution

**Endpoints:**
```typescript
// Tasks
POST   /api/v1/tasks                           # Create task
GET    /api/v1/tasks/:id                       # Get task status
GET    /api/v1/tasks/:id/result                # Get task result
POST   /api/v1/tasks/:id/cancel                # Cancel task
GET    /api/v1/tasks                           # List tasks

// Pipelines
POST   /api/v1/pipelines                       # Define pipeline
GET    /api/v1/pipelines/:id                   # Get pipeline definition
POST   /api/v1/pipelines/:id/execute           # Execute pipeline
GET    /api/v1/pipelines/:id/executions        # Get execution history
GET    /api/v1/pipelines/:id/executions/:execId  # Get execution details

// Stages
GET    /api/v1/pipelines/:id/stages            # List stages
POST   /api/v1/pipelines/:id/stages/:stageId/retry  # Retry stage
```

---

#### 6. **State Management API** (`/api/v1/state`)

**Purpose:** Actor state inspection and manipulation

**Endpoints:**
```typescript
GET    /api/v1/state/actors/:id                # Get actor state
PUT    /api/v1/state/actors/:id                # Set actor state
PATCH  /api/v1/state/actors/:id                # Partial update state
DELETE /api/v1/state/actors/:id                # Clear actor state

// Snapshots
POST   /api/v1/state/actors/:id/snapshot       # Create snapshot
GET    /api/v1/state/actors/:id/snapshots      # List snapshots
POST   /api/v1/state/actors/:id/restore/:snapId  # Restore snapshot

// Queries
POST   /api/v1/state/query                     # Query state across actors
GET    /api/v1/state/aggregate                 # Aggregate state metrics
```

---

#### 7. **Queue & Messaging API** (`/api/v1/queue`)

**Purpose:** Message queue operations

**Endpoints:**
```typescript
POST   /api/v1/queue/publish                   # Publish message
GET    /api/v1/queue/:queueName/messages       # List messages
POST   /api/v1/queue/:queueName/consume        # Consume message
GET    /api/v1/queue/:queueName/stats          # Queue statistics
POST   /api/v1/queue/:queueName/purge          # Purge queue
```

---

#### 8. **Observability API** (`/api/v1/observability`)

**Purpose:** Metrics, telemetry, tracing, logs

**Endpoints:**
```typescript
// Metrics
GET    /api/v1/metrics                         # Prometheus metrics
GET    /api/v1/metrics/dashboard               # Dashboard data
GET    /api/v1/metrics/actors/:id              # Actor-specific metrics

// Telemetry
GET    /api/v1/telemetry/events                # Get telemetry events
POST   /api/v1/telemetry/events                # Record custom event
GET    /api/v1/telemetry/traces/:id            # Get trace

// Logs
GET    /api/v1/logs                            # Query logs
GET    /api/v1/logs/actors/:id                 # Actor logs
WS     /ws/logs                                # Real-time log streaming

// Health
GET    /api/v1/health                          # System health
GET    /api/v1/health/actors/:id               # Actor health
GET    /api/v1/health/dependencies             # Dependency status
```

---

#### 9. **Admin & Operations API** (`/api/v1/admin`)

**Purpose:** System administration

**Endpoints:**
```typescript
// System
GET    /api/v1/admin/info                      # System info
GET    /api/v1/admin/stats                     # System statistics
POST   /api/v1/admin/gc                        # Trigger garbage collection
POST   /api/v1/admin/reload                    # Reload configuration

// Storage
GET    /api/v1/admin/storage/stats             # Storage statistics
POST   /api/v1/admin/storage/compact           # Compact storage
POST   /api/v1/admin/storage/backup            # Create backup
POST   /api/v1/admin/storage/restore           # Restore backup

// Multi-tenancy
GET    /api/v1/admin/tenants                   # List tenants
POST   /api/v1/admin/tenants                   # Create tenant
DELETE /api/v1/admin/tenants/:id               # Delete tenant
GET    /api/v1/admin/tenants/:id/usage         # Tenant usage

// Security
POST   /api/v1/admin/tokens                    # Generate API token
DELETE /api/v1/admin/tokens/:id                # Revoke token
GET    /api/v1/admin/audit                     # Audit log
```

---

### Cross-Cutting Features

#### Authentication & Authorization
```typescript
// JWT-based authentication
POST   /api/v1/auth/login                      # Login
POST   /api/v1/auth/refresh                    # Refresh token
POST   /api/v1/auth/logout                     # Logout

// OAuth2 support
GET    /api/v1/auth/oauth/:provider            # OAuth redirect
GET    /api/v1/auth/oauth/callback             # OAuth callback

// API Keys
POST   /api/v1/auth/keys                       # Generate API key
GET    /api/v1/auth/keys                       # List API keys
DELETE /api/v1/auth/keys/:id                   # Revoke API key

// RBAC
enum Role {
  SUPER_ADMIN = 'super_admin',      // Full system access
  TENANT_ADMIN = 'tenant_admin',    // Tenant-level admin
  ACTOR_ADMIN = 'actor_admin',      // Actor management
  DECISION_MAKER = 'decision_maker', // Create/manage decisions
  ANALYST = 'analyst',              // Read-only + analytics
  VIEWER = 'viewer'                 // Read-only
}
```

#### Rate Limiting
- Per-endpoint rate limits
- Per-tenant rate limits
- Per-API-key rate limits
- Configurable windows (per second, minute, hour)

#### Data Formats & Content Negotiation
- JSON (default)
- MessagePack (binary, compact)
- Protocol Buffers (for high performance)
- Streaming responses (NDJSON)

#### WebSocket Support
Real-time streaming for:
- Actor messages
- Decision deliberations
- Log streaming
- Metrics streaming
- State changes

#### OpenAPI/Swagger Documentation
- Interactive docs at `/docs`
- ReDoc at `/redoc`
- OpenAPI spec at `/openapi.json`
- Code generation for clients (Python, TypeScript, Go, Java)

---

### Service Architecture

#### Technology Stack
```typescript
// Server Framework
import { FastAPI } from 'fastapi'  // Or Express.js with TypeScript
import { WebSocket } from 'ws'
import { Redis } from 'ioredis'
import { Prometheus } from 'prom-client'

// Loom Runtime
import { ActorRuntime } from '@certo-ventures/loom'
import { ConfigResolver, LayeredConfigResolver } from '@certo-ventures/loom/config'
import { InMemoryMemoryAdapter } from '@certo-ventures/loom/storage'

// Storage Adapters
import { PostgreSQLAdapter } from '@certo-ventures/loom/storage/postgresql'
import { CosmosAdapter } from '@certo-ventures/loom/storage/cosmos'
import { RedisStateStore } from '@certo-ventures/loom/storage/redis'
```

#### Service Structure
```
loom-api-service/
├── src/
│   ├── server.ts                    # FastAPI app initialization
│   ├── runtime/
│   │   ├── loom-runtime.ts          # ActorRuntime wrapper
│   │   └── execution-context.ts     # Request-scoped context
│   ├── api/
│   │   ├── v1/
│   │   │   ├── actors.ts            # Actor endpoints
│   │   │   ├── memory.ts            # Memory/graph endpoints
│   │   │   ├── decisions.ts         # Decision endpoints
│   │   │   ├── config.ts            # Configuration endpoints
│   │   │   ├── workflows.ts         # Workflow endpoints
│   │   │   ├── state.ts             # State endpoints
│   │   │   ├── queue.ts             # Queue endpoints
│   │   │   ├── observability.ts     # Metrics/telemetry
│   │   │   └── admin.ts             # Admin operations
│   │   └── websocket/
│   │       ├── deliberations.ts     # Real-time deliberations
│   │       ├── logs.ts              # Log streaming
│   │       └── metrics.ts           # Metric streaming
│   ├── middleware/
│   │   ├── auth.ts                  # JWT/API key validation
│   │   ├── rate-limit.ts            # Rate limiting
│   │   ├── tenant.ts                # Tenant isolation
│   │   ├── logging.ts               # Request logging
│   │   └── error-handler.ts         # Error responses
│   ├── services/
│   │   ├── actor-manager.ts         # Actor lifecycle
│   │   ├── memory-service.ts        # Memory operations
│   │   ├── decision-service.ts      # Decision operations
│   │   ├── config-service.ts        # Config operations
│   │   └── webhook-service.ts       # Webhook delivery
│   ├── storage/
│   │   ├── execution-storage.ts     # Execution-scoped storage
│   │   ├── parquet-writer.ts        # Large data storage
│   │   └── adapters/
│   │       ├── postgresql.ts
│   │       ├── cosmos.ts
│   │       ├── redis.ts
│   │       └── s3.ts
│   ├── config/
│   │   ├── profiles/
│   │   │   ├── development.yaml
│   │   │   ├── staging.yaml
│   │   │   └── production.yaml
│   │   └── loader.ts
│   └── types/
│       ├── api-types.ts             # API request/response types
│       └── service-types.ts         # Service-level types
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yaml          # Service + dependencies
│   └── nginx.conf                   # Reverse proxy config
├── tests/
│   ├── api/                         # API integration tests
│   ├── load/                        # Load tests
│   └── e2e/                         # End-to-end tests
├── docs/
│   ├── api/                         # API documentation
│   └── deployment/                  # Deployment guides
└── package.json
```

#### Docker Compose Setup
```yaml
# docker-compose.yaml
version: '3.8'

services:
  loom-api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - NODE_ENV=production
      - LOOM_PROFILE=production
      - REDIS_URL=redis://redis:6379
      - POSTGRES_URL=postgresql://postgres:5432/loom
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - redis
      - postgres
      - minio
    volumes:
      - ./data/executions:/app/data/executions

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=loom
      - POSTGRES_USER=loom
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data

  minio:
    image: minio/minio
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}
    command: server /data --console-address ":9001"
    volumes:
      - minio-data:/data

  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards

volumes:
  redis-data:
  postgres-data:
  minio-data:
  prometheus-data:
  grafana-data:
```

#### Server Initialization
```typescript
// src/server.ts
import express from 'express'
import { WebSocketServer } from 'ws'
import { ActorRuntime } from '@certo-ventures/loom'
import { setupMiddleware } from './middleware'
import { setupRoutes } from './api'
import { setupWebSocket } from './api/websocket'
import { loadConfig } from './config/loader'

async function createServer() {
  const app = express()
  const config = await loadConfig(process.env.LOOM_PROFILE || 'development')
  
  // Initialize Loom runtime
  const runtime = new ActorRuntime({
    storage: config.storage,
    config: config.configResolver,
    telemetry: config.telemetry
  })
  await runtime.initialize()
  
  // Setup middleware (auth, rate limiting, logging)
  setupMiddleware(app, config)
  
  // Setup REST API routes
  setupRoutes(app, runtime, config)
  
  // Start HTTP server
  const server = app.listen(config.port || 8000, () => {
    console.log(`Loom API Service running on port ${config.port}`)
    console.log(`API Docs: http://localhost:${config.port}/docs`)
    console.log(`Health: http://localhost:${config.port}/api/v1/health`)
  })
  
  // Setup WebSocket
  const wss = new WebSocketServer({ server })
  setupWebSocket(wss, runtime, config)
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...')
    server.close()
    await runtime.shutdown()
    process.exit(0)
  })
  
  return { app, server, runtime }
}

createServer().catch(console.error)
```

#### Profile Configuration
```yaml
# config/profiles/production.yaml
profile: production

server:
  port: 8000
  host: 0.0.0.0
  workers: 4
  timeout: 30000

storage:
  primary:
    type: postgresql
    url: ${POSTGRES_URL}
    pool:
      min: 10
      max: 50
  cache:
    type: redis
    url: ${REDIS_URL}
    ttl: 300
  blob:
    type: s3
    bucket: loom-executions
    endpoint: ${S3_ENDPOINT}

config:
  layers:
    - name: environment
      type: environment
      priority: 300
    - name: database
      type: postgresql
      priority: 200
    - name: yaml
      type: file
      path: ./config/defaults.yaml
      priority: 100

auth:
  jwt:
    secret: ${JWT_SECRET}
    expiresIn: 3600
  apiKeys:
    enabled: true
  oauth:
    providers:
      - google
      - microsoft

rateLimit:
  windowMs: 60000
  maxRequests: 1000
  perTenant: 100

observability:
  metrics:
    enabled: true
    port: 9090
  tracing:
    enabled: true
    exporter: otlp
    endpoint: ${OTEL_ENDPOINT}
  logging:
    level: info
    format: json

execution:
  storage:
    basePath: /app/data/executions
    parquetThreshold: 102400  # 100KB
  isolation: true
  cleanup:
    enabled: true
    retentionDays: 30

multitenancy:
  enabled: true
  isolation: strict
  quotas:
    actors: 100
    requestsPerHour: 10000
    storage: 10GB
```

---

### Integration Patterns

#### 1. **Event-Driven Architecture**
```typescript
// Webhook delivery service
class WebhookService {
  async publishEvent(event: SystemEvent) {
    const subscribers = await this.getSubscribers(event.type)
    
    for (const subscriber of subscribers) {
      await this.deliverWithRetry(subscriber.url, event, {
        maxRetries: 3,
        backoff: 'exponential',
        timeout: 5000
      })
    }
  }
}

// Event types
enum SystemEvent {
  ACTOR_CREATED = 'actor.created',
  ACTOR_STOPPED = 'actor.stopped',
  DECISION_RECORDED = 'decision.recorded',
  VOTE_FINALIZED = 'vote.finalized',
  CONSENSUS_REACHED = 'consensus.reached',
  ESCALATION_TRIGGERED = 'escalation.triggered',
  CONFIG_CHANGED = 'config.changed',
  HEALTH_DEGRADED = 'health.degraded'
}
```

#### 2. **Message Queue Integration**
```typescript
// Kafka producer for event streaming
import { Kafka } from 'kafkajs'

class EventPublisher {
  private kafka: Kafka
  
  async publish(topic: string, event: any) {
    const producer = this.kafka.producer()
    await producer.connect()
    
    await producer.send({
      topic,
      messages: [{
        key: event.id,
        value: JSON.stringify(event),
        headers: {
          'event-type': event.type,
          'tenant-id': event.tenantId
        }
      }]
    })
    
    await producer.disconnect()
  }
}

// Topics
const topics = {
  DECISIONS: 'loom.decisions',
  DELIBERATIONS: 'loom.deliberations',
  CONSENSUS: 'loom.consensus',
  METRICS: 'loom.metrics'
}
```

#### 3. **Data Lake Integration**
```typescript
// S3 exporter for data warehousing
class DataLakeExporter {
  async exportToParquet(query: DataQuery, destination: S3Path) {
    const data = await this.queryData(query)
    const parquet = await this.convertToParquet(data)
    await this.s3.upload(destination, parquet)
  }
  
  async scheduleExport(schedule: CronExpression) {
    // Daily export to data lake
    cron.schedule(schedule, async () => {
      await this.exportToParquet({
        type: 'decisions',
        dateRange: 'yesterday'
      }, `s3://data-lake/decisions/${date}`)
    })
  }
}
```

---

### Client Libraries

#### TypeScript/JavaScript
```typescript
// Auto-generated from OpenAPI spec
import { LoomClient } from '@certo-ventures/loom-client'

const client = new LoomClient({
  baseURL: 'https://api.loom.example.com',
  apiKey: process.env.LOOM_API_KEY
})

// Type-safe API calls
const actor = await client.actors.create({
  name: 'loan-processor',
  type: 'decision-maker',
  config: { ... }
})

const decision = await client.decisions.record({
  actorId: actor.id,
  type: 'loan_approval',
  context: { ... }
})
```

#### Python
```python
from loom_client import LoomClient

client = LoomClient(
    base_url="https://api.loom.example.com",
    api_key=os.environ["LOOM_API_KEY"]
)

# Type-safe API calls
actor = client.actors.create(
    name="loan-processor",
    type="decision-maker",
    config={...}
)

decision = client.decisions.record(
    actor_id=actor.id,
    type="loan_approval",
    context={...}
)
```

---

### Deployment Options

#### 1. **Docker Compose (Development/Small Production)**
```bash
# One command start
docker-compose up -d

# Access services
# API: http://localhost:8000
# Docs: http://localhost:8000/docs
# Grafana: http://localhost:3000
# MinIO: http://localhost:9001
```

#### 2. **Kubernetes (Production)**
```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: loom-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: loom-api
  template:
    metadata:
      labels:
        app: loom-api
    spec:
      containers:
      - name: loom-api
        image: loom-api:latest
        ports:
        - containerPort: 8000
        env:
        - name: NODE_ENV
          value: production
        - name: POSTGRES_URL
          valueFrom:
            secretKeyRef:
              name: loom-secrets
              key: postgres-url
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
```

#### 3. **Serverless (AWS Lambda/Azure Functions)**
```typescript
// handler.ts - Lambda function
import { LoomServer } from './server'

let server: LoomServer

export const handler = async (event, context) => {
  if (!server) {
    server = await LoomServer.create({
      profile: 'lambda',
      storage: 'dynamodb',
      cache: 'elasticache'
    })
  }
  
  return server.handleRequest(event, context)
}
```

---

### Implementation Plan (6 Weeks)

#### Week 1: Core API Infrastructure
**Goal:** Basic server with actor and memory APIs

**Tasks:**
- [ ] Setup Express/FastAPI server structure
- [ ] Docker Compose with Redis + PostgreSQL
- [ ] Middleware: auth, rate limiting, logging
- [ ] Actor Management API (all endpoints)
- [ ] Memory & Knowledge Graph API (basic CRUD)
- [ ] OpenAPI documentation generation
- [ ] Health check endpoints

**Tests:** 25 API integration tests
**Deliverable:** Working API with actors + memory

---

#### Week 2: Decision Systems API
**Goal:** Expose all Phase 6 and Phase 7A decision capabilities

**Tasks:**
- [ ] Decision CRUD API (Phase 6)
- [ ] DeliberationRoom API with WebSocket
- [ ] ConsensusEngine voting API
- [ ] ArgumentGraph API
- [ ] EscalationChain API
- [ ] GroupDecisionMemory API
- [ ] Real-time WebSocket handlers

**Tests:** 30 API integration tests
**Deliverable:** Full decision system accessible via API

---

#### Week 3: Configuration & Workflow APIs
**Goal:** Expose configuration and workflow capabilities

**Tasks:**
- [ ] Configuration API (leveraging ConfigResolver)
- [ ] Profile management
- [ ] Workflow & Pipeline API
- [ ] Task orchestration endpoints
- [ ] State Management API
- [ ] Queue & Messaging API

**Tests:** 20 API integration tests
**Deliverable:** Config and workflow APIs working

---

#### Week 4: Storage & Observability
**Goal:** Production storage adapters and monitoring

**Tasks:**
- [ ] Execution-scoped storage (ROMA pattern)
- [ ] Parquet writer for large data
- [ ] S3/MinIO adapter
- [ ] PostgreSQL adapter completion
- [ ] Observability API (metrics, traces, logs)
- [ ] Prometheus metrics endpoint
- [ ] Log streaming WebSocket
- [ ] Grafana dashboards

**Tests:** 15 integration tests + load tests
**Deliverable:** Production-ready storage + observability

---

#### Week 5: Security & Multi-Tenancy
**Goal:** Enterprise security and tenant isolation

**Tasks:**
- [ ] JWT authentication
- [ ] OAuth2 integration (Google, Microsoft)
- [ ] API key management
- [ ] RBAC implementation
- [ ] Tenant isolation
- [ ] Rate limiting per tenant
- [ ] Audit logging
- [ ] Admin API

**Tests:** 20 security tests
**Deliverable:** Secure multi-tenant system

---

#### Week 6: Client Libraries & Documentation
**Goal:** Developer experience and documentation

**Tasks:**
- [ ] OpenAPI spec refinement
- [ ] TypeScript client library generation
- [ ] Python client library generation
- [ ] API documentation site
- [ ] Deployment guides (Docker, K8s, Serverless)
- [ ] Example applications
- [ ] Performance benchmarks
- [ ] Migration guide

**Tests:** E2E tests with client libraries
**Deliverable:** Complete developer experience

---

### Success Metrics

**Performance:**
- API response time <50ms (p95)
- WebSocket latency <10ms
- Database queries <10ms (p95)
- Support 10,000 concurrent connections
- Handle 100,000 requests/minute

**Reliability:**
- 99.9% uptime SLA
- Zero data loss
- Automatic failover
- Circuit breakers for all external calls

**Developer Experience:**
- OpenAPI spec 100% coverage
- Client libraries for 3+ languages
- Interactive API docs
- <10 minute setup time

**Testing:**
- 110+ API integration tests
- Load tests for all endpoints
- Security penetration tests
- E2E tests for major workflows

---

### Success Criteria

✅ **Week 1 Done When:**
- Can create/manage actors via API
- Can query memory graph via API
- All endpoints documented in OpenAPI
- Docker Compose starts all services
- 25 tests passing

✅ **Week 2 Done When:**
- All Phase 7A features accessible via API
- WebSocket real-time collaboration working
- Can run full deliberation via API
- 30 additional tests passing

✅ **Week 3 Done When:**
- Can manage config via API
- Can execute workflows via API
- State management working
- 20 additional tests passing

✅ **Week 4 Done When:**
- Execution storage isolated per request
- Large responses stored in Parquet
- Metrics exposed to Prometheus
- Load tests passing (10k RPS)
- 15 additional tests passing

✅ **Week 5 Done When:**
- JWT auth working
- Multi-tenant isolation verified
- RBAC enforced
- Audit logs captured
- 20 security tests passing

✅ **Week 6 Done When:**
- Client libraries published (npm + PyPI)
- Documentation site live
- Example apps working
- Can deploy to K8s
- E2E tests passing

---

### Post-Launch Roadmap

#### Phase 7C: Advanced Features (Future)
- GraphQL API
- gRPC for high-performance
- WebAssembly actors
- Distributed tracing
- A/B testing framework
- Blue-green deployments

#### Phase 7D: Enterprise Features (Future)
- High availability clustering
- Multi-region replication
- Advanced analytics
- ML model integration
- Custom plugin system
- Marketplace

---

## 📊 Updated Comparison Matrix

| Aspect | Phase 7A (Collaboration) | Phase 7B (API Service) |
|--------|-------------------------|------------------------|
| **Scope** | Group decision features | Complete system exposure |
| **Innovation** | High - New territory | Medium - REST API patterns |
| **Complexity** | High - Novel algorithms | Medium - Service architecture |
| **Time to Build** | 4 weeks (✅ COMPLETE) | 6 weeks |
| **Dependencies** | Builds on Phase 6 | Wraps entire system |
| **Business Value** | High - Unique differentiator | **CRITICAL - Production enabler** |
| **Fun Factor** | 🔥🔥🔥🔥🔥 | 🔥🔥🔥🔥 |
| **Risk** | Medium - Unproven domain | Low - Proven patterns |
| **Production Ready** | Library usage only | Full SaaS deployment |
| **API Endpoints** | N/A | 100+ endpoints |
| **Multi-tenancy** | Not applicable | Built-in |
| **Security** | Application-level | JWT, OAuth2, RBAC |

---

## 🎯 Updated Recommendation: Phase 7B API Service

**Rationale:**
1. **Phase 7A is COMPLETE** - All 5 components shipped in v0.3.2
2. **Production deployment needed** - Currently library-only, need service
3. **Exposes ALL capabilities** - Not just decisions, everything
4. **Enables SaaS model** - Multi-tenant API service
5. **Industry standard** - REST API is expected
6. **Client ecosystem** - Libraries for multiple languages
7. **Revenue enabler** - API service can be monetized

**What Phase 7B Unlocks:**
- Deploy Loom as a service (not just library)
- Remote actor management
- Multi-tenant deployments
- API-first integrations
- Client libraries (TypeScript, Python, Go, etc.)
- SaaS business model
- Enterprise features (auth, audit, RBAC)

---

## 🚀 Immediate Next Steps

### 1. Create Service Project Structure
```bash
cd /mnt/c/source/loom
mkdir -p packages/loom-api-service
cd packages/loom-api-service
npm init -y
```

### 2. Setup Dependencies
```json
{
  "name": "@certo-ventures/loom-api-service",
  "version": "0.1.0",
  "dependencies": {
    "@certo-ventures/loom": "^0.3.2",
    "express": "^4.18.0",
    "ws": "^8.14.0",
    "ioredis": "^5.3.0",
    "pg": "^8.11.0",
    "jsonwebtoken": "^9.0.0",
    "helmet": "^7.0.0",
    "cors": "^2.8.5",
    "express-rate-limit": "^7.1.0",
    "prom-client": "^15.0.0"
  }
}
```

### 3. Initial File Structure
```bash
mkdir -p src/{api/v1,middleware,services,storage,config,types}
mkdir -p docker tests docs
```

### 4. First Endpoint (Proof of Concept)
```typescript
// src/server.ts - Hello World
import express from 'express'
import { ActorRuntime } from '@certo-ventures/loom'

const app = express()
app.use(express.json())

const runtime = new ActorRuntime({
  storage: 'in-memory'
})

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' })
})

app.listen(8000, () => {
  console.log('Loom API Service running on http://localhost:8000')
  console.log('Health check: http://localhost:8000/api/v1/health')
})
```

---

## 🎉 Phase 7A Status: COMPLETE ✅

**Shipped in v0.3.2:**
- ✅ DeliberationRoom (624 lines, 29 tests)
- ✅ ConsensusEngine (730 lines, 27 tests)  
- ✅ ArgumentGraph (624 lines, 29 tests)
- ✅ EscalationChain (730 lines, 31 tests)
- ✅ GroupDecisionMemory (664 lines, 23 tests)

**Total Delivered:**
- 3,372 lines of production code
- 139 tests (100% passing)
- Published to npm
- Full TypeScript types
- Complete documentation

**Next:** Phase 7B to make it production-accessible!
