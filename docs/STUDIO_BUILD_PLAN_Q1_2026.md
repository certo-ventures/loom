# Loom Studio Build Plan - Q1 2026

**Date**: December 28, 2025  
**Current Status**: Phase 2 Complete (Real-time monitoring functional)  
**Next Goal**: Make Studio the best debugging/development UI in the AI agent space

---

## Current State Assessment ✅

### What's Working (Phase 1 & 2 Complete):
- ✅ Actor discovery via Redis Pub/Sub events
- ✅ Real-time WebSocket updates to UI
- ✅ Actor list with status/health indicators
- ✅ Basic metrics dashboard (messages/sec, pool usage, queue depth)
- ✅ Actor network visualization (placeholder ready for enhancement)
- ✅ Journal timeline (placeholder ready for enhancement)
- ✅ Theme support (dark/light modes)
- ✅ Responsive modern UI with Shadcn components

### What's Missing (Phase 3+):
- ❌ **Time-travel debugging** - The killer feature!
- ❌ **State inspector with JSON editor** - View and edit actor state
- ❌ **Visual actor composer** - Drag-and-drop workflow builder
- ❌ **Interactive controls** - Send messages, trigger actions from UI
- ❌ **Performance profiler** - Bottleneck detection
- ❌ **Distributed trace visualization** - Cross-actor correlation
- ❌ **Search and filtering** - Find actors by type, state, tag

---

## Prioritized Build Plan (Next 8 Weeks)

### 🚀 Phase 3: Critical Differentiators (Weeks 1-4)

#### Week 1: **Time-Travel Debugger** ⭐⭐⭐⭐⭐
**Impact**: This is Loom's unique advantage - no competitor has this!

**Tasks**:
1. **Backend**: 
   - Add `/api/journal/:actorId/entries?from=0&to=100` endpoint
   - Return full journal with state snapshots at each entry
   - Support filtering by event type

2. **Frontend Components**:
   - Timeline scrubber UI (like video player)
   - State diff viewer (show what changed between entries)
   - Event list with expandable details
   - "Jump to entry" functionality

3. **Key Features**:
   - Play/pause/step through actor history
   - See exact state at any point in time
   - Click on entry to see full details
   - Download journal as JSON for offline analysis

**Files to Create/Modify**:
```typescript
// Backend
packages/studio-server/src/routes/journal.ts  // NEW
packages/studio-server/src/journal-manager.ts  // NEW

// Frontend
packages/studio/src/components/time-travel-debugger.tsx  // ENHANCE (already exists as placeholder)
packages/studio/src/hooks/use-journal.ts  // ENHANCE
packages/studio/src/lib/journal-utils.ts  // NEW - diff calculation
```

**Success Criteria**:
- [ ] Can replay any actor's history step-by-step
- [ ] Can see state changes clearly highlighted
- [ ] Can jump to specific points in time
- [ ] Performance: <100ms to load 1000 journal entries

---

#### Week 2: **State Inspector with JSON Editor** ⭐⭐⭐⭐

**Impact**: Essential for debugging - see and edit actor state in real-time

**Tasks**:
1. **Backend**:
   - Add `/api/actors/:id/state` GET endpoint
   - Add `/api/actors/:id/state` PATCH endpoint (for editing)
   - Validate state changes before applying

2. **Frontend**:
   - JSON tree view with syntax highlighting
   - In-line editing for state values
   - "Revert" button to undo changes
   - Search within state object
   - Copy path to clipboard feature

3. **Libraries to Use**:
   - `react-json-view` or `@monaco-editor/react` for editing
   - `json-diff` for showing changes

**Files to Create/Modify**:
```typescript
// Backend
packages/studio-server/src/routes/state.ts  // NEW

// Frontend  
packages/studio/src/components/state-inspector.tsx  // NEW
packages/studio/src/components/state-editor.tsx  // NEW
packages/studio/src/hooks/use-actor-state.ts  // NEW
```

**Success Criteria**:
- [ ] Can view actor state as formatted JSON
- [ ] Can edit state values and save changes
- [ ] Can see validation errors before saving
- [ ] Can search/filter within large state objects

---

#### Week 3: **Interactive Actor Controls** ⭐⭐⭐⭐

**Impact**: Transform Studio from read-only to interactive debugging tool

**Tasks**:
1. **Backend**:
   - Add `/api/actors/:id/message` POST endpoint - send message to actor
   - Add `/api/actors/:id/restart` POST endpoint
   - Add `/api/actors/:id/pause` POST endpoint
   - Add `/api/actors/:id/resume` POST endpoint

2. **Frontend**:
   - "Send Message" modal with JSON editor
   - Message template library (common message patterns)
   - Control buttons: Restart, Pause, Resume, Kill
   - Confirmation dialogs for destructive actions

3. **Integration with Journal**:
   - Show sent messages in journal timeline
   - Highlight manual interventions in different color

**Files to Create/Modify**:
```typescript
// Backend
packages/studio-server/src/routes/control.ts  // NEW
packages/studio-server/src/message-sender.ts  // NEW

// Frontend
packages/studio/src/components/actor-controls.tsx  // NEW
packages/studio/src/components/send-message-dialog.tsx  // NEW
packages/studio/src/hooks/use-actor-controls.ts  // NEW
```

**Success Criteria**:
- [ ] Can send custom messages to any actor
- [ ] Can restart/pause/resume actors from UI
- [ ] Changes appear in real-time in journal
- [ ] Error handling for invalid messages

---

#### Week 4: **Enhanced Actor Network Visualization** ⭐⭐⭐⭐

**Impact**: See message flows and actor relationships visually

**Tasks**:
1. **Backend**:
   - Track message sends between actors
   - Add `/api/actors/network` endpoint returning graph data

2. **Frontend**:
   - Implement React Flow diagram
   - Node colors by actor status (active, idle, error)
   - Animated message flows between nodes
   - Click node to see actor details
   - Zoom/pan/fit-to-screen controls

3. **Layout Algorithms**:
   - Hierarchical layout for parent-child relationships
   - Force-directed graph for peer-to-peer communication
   - Manual positioning with save

**Files to Create/Modify**:
```typescript
// Backend
packages/studio-server/src/network-analyzer.ts  // NEW

// Frontend
packages/studio/src/components/actor-network.tsx  // ENHANCE (currently placeholder)
packages/studio/src/lib/graph-layout.ts  // NEW
```

**Success Criteria**:
- [ ] Visual graph shows all actors and connections
- [ ] Animated message flows (like network packet visualizers)
- [ ] Click actor to jump to details/journal
- [ ] Performance: <1s to render 100 actors

---

### 🎨 Phase 4: Advanced Features (Weeks 5-8)

#### Week 5: **Search and Filtering System** ⭐⭐⭐⭐

**Impact**: Essential for large systems with 100+ actors

**Tasks**:
1. **Backend**:
   - Add query parameters to `/api/actors` endpoint
   - Support filters: `type=`, `status=`, `tag=`, `search=`
   - Support sorting: `sort=name|status|lastActive`

2. **Frontend**:
   - Command palette (Cmd+K) for quick navigation
   - Advanced filter panel with multi-select
   - Saved search/filter combinations
   - "Recently viewed actors" list

**Files to Create/Modify**:
```typescript
// Frontend
packages/studio/src/components/command-palette.tsx  // NEW
packages/studio/src/components/filter-panel.tsx  // NEW
packages/studio/src/hooks/use-command-palette.ts  // NEW
```

---

#### Week 6: **Performance Profiler** ⭐⭐⭐⭐

**Impact**: Identify slow actors and bottlenecks

**Tasks**:
1. **Backend**:
   - Track message processing times per actor
   - Track state size growth over time
   - Add `/api/actors/:id/performance` endpoint

2. **Frontend**:
   - Flame graph for activity execution times
   - Table view: slowest actors, highest message rates
   - Alerts for actors with high error rates
   - Trend charts (last hour, day, week)

**Libraries**:
- `d3-flame-graph` for flamegraphs
- `recharts` for trend visualization

---

#### Week 7: **Distributed Trace Visualization** ⭐⭐⭐⭐

**Impact**: See cross-actor workflows end-to-end

**Tasks**:
1. **Backend**:
   - Add `/api/traces/:traceId` endpoint
   - Return all actors involved in a trace
   - Calculate critical path and timing

2. **Frontend**:
   - Waterfall diagram (like Chrome DevTools Network tab)
   - Show parallel vs sequential execution
   - Highlight slowest span
   - "Focus on trace" mode - filter everything to one trace

---

#### Week 8: **Visual Actor Composer (MVP)** ⭐⭐⭐⭐⭐

**Impact**: Drag-and-drop workflow builder (like AutoGen Studio)

**Tasks**:
1. **Design Canvas**:
   - Actor library sidebar (all registered actor types)
   - Drag actor to canvas to instantiate
   - Connect actors with arrows (message flows)
   - Set actor config in properties panel

2. **Code Generation**:
   - Export as TypeScript actor orchestration code
   - Export as Loom workflow DSL (YAML)
   - "Run" button to execute composition

3. **Template Library**:
   - Pre-built patterns: Saga, Fan-out/Fan-in, Pipeline
   - Import from examples folder

**Libraries**:
- `react-flow` for diagram editor
- `monaco-editor` for code preview

---

## Implementation Details

### Technology Stack Enhancements

**Frontend**:
- ✅ Already have: React, TypeScript, Tailwind, Shadcn UI
- ➕ Add: `react-flow` (network diagrams)
- ➕ Add: `@monaco-editor/react` (JSON/code editing)
- ➕ Add: `recharts` (metrics charts)
- ➕ Add: `d3-flame-graph` (performance profiling)
- ➕ Add: `cmdk` (command palette)

**Backend**:
- ✅ Already have: Express, WebSocket, Redis integration
- ➕ Add: Journal query API
- ➕ Add: State management API
- ➕ Add: Message injection API
- ➕ Add: Network topology tracking

---

## API Endpoints Roadmap

### Week 1-2: Core Debugging APIs
```
GET    /api/journal/:actorId/entries?from=0&to=100
GET    /api/actors/:actorId/state
PATCH  /api/actors/:actorId/state
```

### Week 3: Control APIs
```
POST   /api/actors/:actorId/message
POST   /api/actors/:actorId/restart
POST   /api/actors/:actorId/pause
POST   /api/actors/:actorId/resume
DELETE /api/actors/:actorId
```

### Week 4: Network Analysis
```
GET    /api/actors/network
GET    /api/actors/:actorId/connections
```

### Week 5-6: Performance & Search
```
GET    /api/actors?type=X&status=active&search=loan
GET    /api/actors/:actorId/performance
GET    /api/metrics/summary
```

### Week 7: Distributed Tracing
```
GET    /api/traces/:traceId
GET    /api/traces?actorId=X
```

### Week 8: Composition
```
POST   /api/workflows/validate
POST   /api/workflows/execute
GET    /api/actors/templates
```

---

## Success Metrics

### Developer Experience Metrics:
- **Time to Debug Issue**: Target <2 minutes (with time-travel)
- **Time to Create Workflow**: Target <5 minutes (with composer)
- **Learning Curve**: Developer productive within first hour
- **Feature Discovery**: 80% of features used within first week

### Technical Metrics:
- **UI Response Time**: <50ms for state updates
- **Journal Load Time**: <100ms for 1000 entries
- **Network Graph Render**: <1s for 100 actors
- **WebSocket Latency**: <10ms end-to-end

### Adoption Metrics:
- Track daily/weekly active users
- Most-used features ranking
- Time spent in Studio per session
- Number of debug sessions resolved

---

## Testing Strategy

### Week 1-4 (Each Week):
1. **Unit Tests**: All new components have 80%+ coverage
2. **Integration Tests**: API endpoints tested with real actors
3. **E2E Tests**: Playwright tests for critical flows
4. **Performance Tests**: Load testing with 100+ actors

### Week 5-8:
1. **User Testing**: Internal dogfooding with Loom team
2. **Beta Users**: Get feedback from 3-5 external developers
3. **Stress Testing**: 1000+ actors, high message throughput
4. **Browser Testing**: Chrome, Firefox, Safari, Edge

---

## Documentation Plan

### Week 1-2:
- [ ] Time-Travel Debugger guide
- [ ] State Inspector usage
- [ ] Video: "Debug an Actor in 60 Seconds"

### Week 3-4:
- [ ] Interactive Controls tutorial
- [ ] Network Visualization guide
- [ ] Video: "Visualize Actor Message Flows"

### Week 5-8:
- [ ] Command Palette shortcuts reference
- [ ] Performance Profiler interpretation guide
- [ ] Visual Composer tutorial
- [ ] Video: "Build a Workflow in 5 Minutes"

---

## Risk Mitigation

### Technical Risks:
1. **Performance with Large Actor Count**
   - Mitigation: Virtual scrolling, pagination, lazy loading
   - Test with 1000+ actors early

2. **WebSocket Connection Stability**
   - Mitigation: Automatic reconnection, exponential backoff
   - Show connection status clearly

3. **State Editing Safety**
   - Mitigation: Validation, confirmation dialogs, undo
   - Show preview before applying

### UX Risks:
1. **Feature Overload**
   - Mitigation: Progressive disclosure, tooltips, onboarding
   - Hide advanced features behind "Advanced" panel

2. **Learning Curve**
   - Mitigation: Interactive tutorial, example workflows
   - Video walkthroughs for each major feature

---

## Competitive Analysis

### How We Compare (After Phase 4):

| Feature | Loom Studio | Temporal UI | AutoGen Studio | LangSmith |
|---------|-------------|-------------|----------------|-----------|
| Time-Travel Debugger | ✅ **Unique!** | ❌ | ❌ | ❌ |
| Visual Composer | ✅ | ❌ | ✅ | ❌ |
| State Inspector | ✅ | ⚠️ Basic | ❌ | ❌ |
| Real-Time Updates | ✅ | ✅ | ⚠️ Polling | ✅ |
| Network Visualization | ✅ | ⚠️ Basic | ⚠️ Basic | ✅ |
| Performance Profiler | ✅ | ⚠️ Basic | ❌ | ✅ |
| Distributed Tracing | ✅ | ✅ | ❌ | ✅ |
| Interactive Controls | ✅ **Unique!** | ❌ | ❌ | ❌ |

**Our Unique Advantages**:
1. ✨ **Time-Travel Debugging** - No one else has this!
2. ✨ **Interactive State Editing** - Debug live, no redeploys
3. ✨ **Actor Message Control** - Send messages from UI
4. ✨ **Event-Driven Updates** - Real-time via Redis, no polling

---

## Next Actions (This Week)

### Monday-Tuesday: **Setup & Planning**
- [ ] Review this plan with team
- [ ] Set up project tracking (GitHub Projects or Linear)
- [ ] Create feature branches for Week 1 work
- [ ] Set up E2E testing infrastructure

### Wednesday-Friday: **Week 1 Sprint Start**
- [ ] Implement journal API endpoints
- [ ] Create time-travel debugger component
- [ ] Test with mortgage appraisal demo
- [ ] Record demo video

---

## Long-Term Vision (Q2 2026)

Once Phases 3-4 are complete, we'll have the **best debugging UI in the AI agent space**. Future enhancements:

**Q2 2026**:
- Multi-user collaboration (multiple devs in same Studio session)
- Alert manager (Slack/email notifications for errors)
- A/B testing for actors (compare two versions side-by-side)
- AI-powered suggestions ("This actor is slow, try caching")
- Mobile app for on-call monitoring

**Q3 2026**:
- Plugin system (community extensions)
- Template marketplace (share actor patterns)
- Export to production dashboards (Grafana, Datadog)
- Interactive tutorials (gamified learning)

---

## Key Decisions Needed

### Architecture Decisions:
1. **Journal Storage**: Keep in Redis or move to PostgreSQL for history?
   - Recommendation: Redis for recent (24h), PostgreSQL for long-term

2. **State Editing**: Direct mutation or event-based?
   - Recommendation: Event-based (publish `state_edited` event)

3. **Authentication**: When to add it?
   - Recommendation: Week 5-6 (before opening to external users)

### UX Decisions:
1. **Multi-pane Layout**: Split screen for journal + state inspector?
   - Recommendation: Resizable panels with saved layouts

2. **Dark Mode as Default**: Most devs prefer dark mode
   - Recommendation: Yes, but remember user preference

3. **Mobile Support**: Full-featured or read-only?
   - Recommendation: Read-only for monitoring, full features desktop-only

---

## Resources & References

### Design Inspiration:
- Temporal UI: https://docs.temporal.io/web-ui
- AutoGen Studio: https://microsoft.github.io/autogen/docs/autogen-studio/getting-started
- LangSmith: https://docs.smith.langchain.com/
- Grafana: https://grafana.com/
- Chrome DevTools: Network/Performance tabs

### Technical Resources:
- React Flow: https://reactflow.dev/
- Monaco Editor: https://microsoft.github.io/monaco-editor/
- Recharts: https://recharts.org/
- Shadcn UI: https://ui.shadcn.com/
- CMDK: https://cmdk.paco.me/

### Loom Documentation:
- [Studio Production Ready](STUDIO_PRODUCTION_READY.md)
- [Studio Enhancement Proposal](../documentation/STUDIO_ENHANCEMENT_PROPOSAL.md)
- [Production Setup Guide](../packages/studio/PRODUCTION_SETUP.md)

---

## Summary

**Current State**: Functional real-time monitoring ✅  
**Next 4 Weeks**: Time-travel debugging, state inspector, interactive controls 🚀  
**Next 8 Weeks**: Complete Phase 3-4, making Studio world-class 🌟

**The Goal**: Make Loom Studio the tool developers are *excited* to open—not just when things break, but to explore what their actors are doing. **It should feel like a superpower.**

Let's build it! 💪

---

**Last Updated**: December 28, 2025  
**Version**: 1.0  
**Status**: Ready for Implementation
