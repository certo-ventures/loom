/**
 * Actor Discovery Enhancements Demo
 * 
 * Demonstrates:
 * 1. Server endpoint registration for direct HTTP calls
 * 2. WASM schema introspection
 * 3. Result format negotiation (JSON, SSE, NDJSON)
 */

import { DiscoveryService, InMemoryActorRegistry } from '../src/discovery'
import type { ActorRegistration } from '../src/discovery'

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║       Actor Discovery Enhancements Demo                  ║')
  console.log('╚═══════════════════════════════════════════════════════════╝\n')

  // ============================================================
  // Enhancement 1: Server Endpoint Registration
  // ============================================================
  console.log('📍 Enhancement 1: Server Endpoint Registration\n')

  const registry = new InMemoryActorRegistry()
  const discovery = new DiscoveryService(registry)

  // Register actors with server endpoints
  await discovery.registerActor('order-1', 'OrderProcessor', 'worker-1', {
    serverEndpoint: 'http://worker-1.loom.svc:8080',
    region: 'us-west',
  } as any)

  await discovery.registerActor('order-2', 'OrderProcessor', 'worker-2', {
    serverEndpoint: 'http://worker-2.loom.svc:8080',
    region: 'us-east',
  } as any)

  await discovery.registerActor('payment-1', 'PaymentProcessor', 'worker-3', {
    serverEndpoint: 'http://worker-3.loom.svc:8080',
    provider: 'stripe',
  } as any)

  console.log('✅ Registered 3 actors with server endpoints\n')

  // Route to specific actor and get server endpoint
  console.log('🎯 Routing to specific actor:')
  const registration = await registry.get('order-1')
  if (registration) {
    console.log(`   Actor: ${registration.actorId}`)
    console.log(`   Type: ${registration.actorType}`)
    console.log(`   Worker: ${registration.workerId}`)
    console.log(`   Server Endpoint: ${registration.serverEndpoint}`)
    console.log(`   Status: ${registration.status}\n`)

    // Simulate direct HTTP call
    if (registration.serverEndpoint) {
      console.log('📡 Direct HTTP call:')
      console.log(`   POST ${registration.serverEndpoint}/actors/${registration.actorId}/execute`)
      console.log(`   Body: { "orderId": "12345", "amount": 99.99 }\n`)
    }
  }

  // Route to any OrderProcessor with load balancing
  console.log('⚖️  Load-balanced routing to OrderProcessor:')
  const actors = await registry.getByType('OrderProcessor')
  for (const actor of actors) {
    console.log(`   ├─ ${actor.actorId} @ ${actor.serverEndpoint}`)
  }
  console.log()

  // ============================================================
  // Enhancement 2: WASM Schema Introspection
  // ============================================================
  console.log('═'.repeat(60))
  console.log('🔍 Enhancement 2: WASM Schema Introspection\n')

  console.log('Example API call:')
  console.log('GET /actors/calculator-actor/schema?version=1.0.0\n')

  console.log('Expected response:')
  const schemaResponse = {
    actorId: 'calculator-actor',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      required: ['operation', 'a', 'b'],
      properties: {
        operation: { 
          type: 'string', 
          enum: ['add', 'subtract', 'multiply', 'divide'] 
        },
        a: { type: 'number' },
        b: { type: 'number' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        result: { type: 'number' },
        operation: { type: 'string' },
      },
    },
    wasmExports: [
      'execute',
      'memory',
      '__new',
      '__pin',
      '__unpin',
      '__collect',
    ],
    capabilities: {
      streaming: false,
      stateManagement: false,
      childActors: false,
    },
  }
  console.log(JSON.stringify(schemaResponse, null, 2))
  console.log()

  console.log('💡 Use cases:')
  console.log('   • Dynamic form generation from inputSchema')
  console.log('   • Client-side validation before execution')
  console.log('   • API documentation generation')
  console.log('   • IDE autocomplete/IntelliSense\n')

  // ============================================================
  // Enhancement 3: Result Format Negotiation
  // ============================================================
  console.log('═'.repeat(60))
  console.log('📨 Enhancement 3: Result Format Negotiation\n')

  console.log('Format 1: JSON (default)')
  console.log('─'.repeat(60))
  console.log('POST /execute')
  console.log('Accept: application/json')
  console.log('Body: { "actorType": "calculator", "input": { "a": 5, "b": 3 } }\n')
  console.log('Response:')
  const jsonResponse = {
    executionId: 'exec-123',
    actorId: 'calculator',
    status: 'completed',
    result: { result: 8, operation: 'add' },
    duration: 45,
    timestamp: new Date().toISOString(),
  }
  console.log(JSON.stringify(jsonResponse, null, 2))
  console.log()

  console.log('Format 2: Server-Sent Events (SSE)')
  console.log('─'.repeat(60))
  console.log('POST /execute')
  console.log('Accept: text/event-stream')
  console.log('Body: { "actorType": "llm-chat", "input": { "prompt": "Hi" }, "stream": true }\n')
  console.log('Response:')
  console.log('event: start')
  console.log('data: {"type":"start","executionId":"exec-124"}\n')
  console.log('event: result')
  console.log('data: {"type":"result","executionId":"exec-124","status":"completed","result":"Hello!"}\n')
  console.log('event: complete')
  console.log('data: {"type":"complete"}\n')

  console.log('Format 3: Newline-Delimited JSON (NDJSON)')
  console.log('─'.repeat(60))
  console.log('POST /execute')
  console.log('Accept: application/x-ndjson')
  console.log('Body: { "actorType": "data-processor", "input": { "records": [...] } }\n')
  console.log('Response:')
  console.log('{"type":"start","executionId":"exec-125"}')
  console.log('{"type":"result","executionId":"exec-125","status":"completed","result":{"processed":100}}')
  console.log('{"type":"complete"}\n')

  console.log('💡 Use cases:')
  console.log('   JSON:   Traditional REST APIs, single responses')
  console.log('   SSE:    Real-time streaming (LLM chat, progress updates)')
  console.log('   NDJSON: Bulk processing, log streaming, data pipelines\n')

  // ============================================================
  // Integration Example
  // ============================================================
  console.log('═'.repeat(60))
  console.log('🚀 Complete Integration Example\n')

  console.log('1️⃣  Discover actor with schema:')
  console.log('   GET /actors/order-processor/schema')
  console.log('   → Returns: inputSchema, outputSchema, capabilities\n')

  console.log('2️⃣  Validate input against schema (client-side):')
  console.log('   const valid = ajv.validate(inputSchema, userInput)\n')

  console.log('3️⃣  Find available server endpoint:')
  console.log('   const actor = await registry.get("order-1")')
  console.log('   → endpoint: http://worker-1.loom.svc:8080\n')

  console.log('4️⃣  Execute with streaming:')
  console.log('   POST http://worker-1.loom.svc:8080/execute')
  console.log('   Accept: text/event-stream')
  console.log('   → Receive real-time progress updates\n')

  console.log('✨ Benefits:')
  console.log('   ✅ Cross-server actor discovery')
  console.log('   ✅ Runtime schema introspection')
  console.log('   ✅ Flexible response formats')
  console.log('   ✅ Direct HTTP routing (optional)')
  console.log('   ✅ Client-side validation')
  console.log('   ✅ Real-time streaming support\n')

  console.log('🎉 Actor discovery is now production-ready!')
}

main().catch(console.error)
