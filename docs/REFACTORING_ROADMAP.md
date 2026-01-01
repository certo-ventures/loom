# Refactoring Roadmap

## 1. Stabilize Core Runtime (Actors, Pipelines, Tasks, Authorization)
- Persist actor inputs through completion for deterministic replay.
- Deliver durable pipeline orchestrator (state machine + DAG support).
- Integrate retry/backoff + throttling semantics.
- Provide shared AuthorizationContext builders enforced at every ingress (fail-closed).

**Principles**: No new inheritance layers; prefer flat helpers and pure functions wired explicitly in bootstrap/service modules.

## 2. Harden State, Storage, and Scheduling
- Wrap SimpleState / StateStore + journal with an async API.
- Ensure BullMQ queue metadata is durable/parity with retry handlers.
- Persist the memory graph lifecycle using the same storage primitives; add activation leases.
- Integrate retry handler + BullMQ coordination and wire telemetry through scheduling paths.

**Guidelines**: Keep adapters minimal (single factory, no hidden registries). Validate configuration at startup.

## 3. Observability, Tracing, Telemetry
- Feed runtime metrics into a central MetricsCollector via hooks.
- Optimize execution trace collection with Cosmos-friendly batching.
- Persist traces in a durable TraceStore and expose a query endpoint.

**Approach**: Extend the existing observability module rather than adding new services.

## 4. AI + WASM + TLS Notary
- Provide configurable Azure OpenAI / OpenAI providers behind a unified LLM surface using plain objects.
- Enhance the WASM sandbox: capability manifest, timeout plumbing, AssemblyScript fixes, compositor validation.
- Build the TLS Notary WASM artifact, block mocks in production, and expose readiness health checks.

## 5. Discovery, Triggers, Streaming, Workflow
- Implement a single distributed actor registry (Redis/Cosmos with TTL) and fix ActorRouter.
- Wire Redis/SSE streaming with backpressure and auth enforcement.
- Fix the trigger runtime and implement a real workflow executor built on existing actors/activities/messages (no bespoke scheduler).

**Pattern**: Event handlers call the runtime through explicit context builders; honor transforms; enforce backpressure + auth.

## 6. Config, Memory, Secrets
- Fix dynamic config Cosmos query filters and implement layered `mergeConfig` ordering for predictable overrides.
- Handle memory graph persistence/search/storage alongside the state-store upgrades using shared persistence primitives.
- Ensure secrets and AI configuration reuse the same persistence + validation path.

## Execution Strategy
1. **Bootstrap**: lock down environment/config contracts (authorization, adapters, AI settings). Validate at startup and fail fast.
2. **Runtime + Storage**: implement deterministic replay, durable orchestrator, BullMQ parity, SimpleState persistence; add tracing hooks while touching these paths.
3. **Observability & Auth**: once runtime hooks exist, wire metrics/traces and enforce AuthorizationContext builders at every ingress (actors, pipelines, HTTP).
4. **AI/WASM/TLSN**: upgrade subsystems in isolation; keep adapters thin and configuration-driven.
5. **Edge Features**: build discovery registry, streaming, triggers, workflow executor using composable pieces (no reflective injection; explicit wiring via service bootstrap).
6. **Finalize**: replace mock services (memory, TLSN) in production builds and document operational runbooks.

## Minimalism Guardrails
- Prefer composition over inheritance; expose plain factory functions returning typed objects.
- Keep interfaces lean—only methods exercised by the runtime.
- Delete unused adapters/paths instead of stubbing them.
- Centralize cross-cutting concerns (auth, telemetry, retries) via explicit helpers imported where needed—no global singletons.
