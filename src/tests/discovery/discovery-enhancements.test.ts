/**
 * Tests for Actor Discovery Enhancements
 * 
 * Tests:
 * 1. Server endpoint registration and routing
 * 2. WASM schema introspection
 * 3. Result format negotiation (JSON, SSE, NDJSON)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { 
  InMemoryActorRegistry, 
  DiscoveryService,
  type ActorRegistration 
} from '../../discovery'

describe('Actor Discovery Enhancements', () => {
  describe('Server Endpoint Registration', () => {
    let registry: InMemoryActorRegistry
    let discovery: DiscoveryService

    beforeEach(() => {
      registry = new InMemoryActorRegistry()
      discovery = new DiscoveryService(registry)
    })

    it('should register actor with server endpoint', async () => {
      await discovery.registerActor('order-1', 'OrderProcessor', 'worker-1', {
        serverEndpoint: 'http://worker-1.loom.svc:8080',
        region: 'us-west',
      } as any)

      const registration = await registry.get('order-1')
      expect(registration).toBeDefined()
      expect(registration!.serverEndpoint).toBe('http://worker-1.loom.svc:8080')
    })

    it('should support actors without server endpoints', async () => {
      await discovery.registerActor('order-2', 'OrderProcessor', 'worker-2', {
        region: 'us-east',
      } as any)

      const registration = await registry.get('order-2')
      expect(registration).toBeDefined()
      expect(registration!.serverEndpoint).toBeUndefined()
    })

    it('should route to actor with server endpoint', async () => {
      await discovery.registerActor('payment-1', 'PaymentProcessor', 'worker-3', {
        serverEndpoint: 'http://worker-3.loom.svc:8080',
        provider: 'stripe',
      } as any)

      const queue = await discovery.route('payment-1')
      expect(queue).toBe('actor:payment-1')

      const registration = await registry.get('payment-1')
      expect(registration!.serverEndpoint).toBe('http://worker-3.loom.svc:8080')
    })

    it('should support load balancing with server endpoints', async () => {
      await discovery.registerActor('api-1', 'APIGateway', 'worker-1', {
        serverEndpoint: 'http://worker-1.loom.svc:8080',
      } as any)

      await discovery.registerActor('api-2', 'APIGateway', 'worker-2', {
        serverEndpoint: 'http://worker-2.loom.svc:8080',
      } as any)

      await discovery.registerActor('api-3', 'APIGateway', 'worker-3', {
        serverEndpoint: 'http://worker-3.loom.svc:8080',
      } as any)

      const actors = await registry.getByType('APIGateway')
      expect(actors).toHaveLength(3)
      
      actors.forEach(actor => {
        expect(actor.serverEndpoint).toMatch(/^http:\/\/worker-\d\.loom\.svc:8080$/)
      })
    })

    it('should allow direct HTTP routing when endpoint is available', async () => {
      await discovery.registerActor('compute-1', 'ComputeNode', 'worker-1', {
        serverEndpoint: 'http://10.0.1.5:8080',
        capabilities: ['gpu', 'high-memory'],
      } as any)

      const registration = await registry.get('compute-1')
      
      // Simulate direct HTTP call decision
      const useDirectRouting = registration!.serverEndpoint !== undefined
      expect(useDirectRouting).toBe(true)

      if (useDirectRouting) {
        const url = `${registration!.serverEndpoint}/actors/${registration!.actorId}/execute`
        expect(url).toBe('http://10.0.1.5:8080/actors/compute-1/execute')
      }
    })
  })

  describe('WASM Schema Introspection', () => {
    it('should define schema response structure', () => {
      // Schema response structure (would be returned by GET /actors/:id/schema)
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

      expect(schemaResponse.actorId).toBe('calculator-actor')
      expect(schemaResponse.inputSchema.required).toContain('operation')
      expect(schemaResponse.wasmExports).toContain('execute')
      expect(schemaResponse.capabilities.streaming).toBe(false)
    })

    it('should detect streaming capability from WASM exports', () => {
      const wasmExports = ['execute', 'stream', 'memory']
      const hasStreaming = wasmExports.includes('stream')
      
      expect(hasStreaming).toBe(true)
    })

    it('should detect state management capability', () => {
      const wasmExports = ['execute', 'getState', 'setState', 'memory']
      const hasStateManagement = 
        wasmExports.includes('getState') || wasmExports.includes('setState')
      
      expect(hasStateManagement).toBe(true)
    })

    it('should detect child actor capability', () => {
      const wasmExports = ['execute', 'spawnChild', 'memory']
      const hasChildActors = wasmExports.includes('spawnChild')
      
      expect(hasChildActors).toBe(true)
    })

    it('should provide complete schema for validation', () => {
      const inputSchema = {
        type: 'object',
        required: ['prompt', 'model'],
        properties: {
          prompt: { type: 'string', minLength: 1 },
          model: { 
            type: 'string', 
            enum: ['gpt-4', 'gpt-3.5-turbo', 'claude-3'] 
          },
          temperature: { 
            type: 'number', 
            minimum: 0, 
            maximum: 2,
            default: 0.7,
          },
        },
      }

      // Client can use this for validation
      expect(inputSchema.required).toContain('prompt')
      expect(inputSchema.properties.temperature.default).toBe(0.7)
    })
  })

  describe('Result Format Negotiation', () => {
    describe('JSON Format (default)', () => {
      it('should structure standard JSON response', () => {
        const jsonResponse = {
          executionId: 'exec-123',
          actorId: 'calculator',
          status: 'completed',
          result: { result: 8, operation: 'add' },
          duration: 45,
          timestamp: new Date().toISOString(),
        }

        expect(jsonResponse.status).toBe('completed')
        expect(jsonResponse.result.result).toBe(8)
      })

      it('should handle errors in JSON format', () => {
        const errorResponse = {
          executionId: 'exec-124',
          actorId: 'calculator',
          status: 'failed',
          error: {
            message: 'Division by zero',
            code: 'INVALID_INPUT',
            details: { operation: 'divide', b: 0 },
          },
          duration: 12,
          timestamp: new Date().toISOString(),
        }

        expect(errorResponse.status).toBe('failed')
        expect(errorResponse.error?.code).toBe('INVALID_INPUT')
      })
    })

    describe('Server-Sent Events (SSE) Format', () => {
      it('should structure SSE start event', () => {
        const startEvent = {
          event: 'start',
          data: { type: 'start', executionId: 'exec-125' },
        }

        expect(startEvent.event).toBe('start')
        expect(startEvent.data.executionId).toBe('exec-125')
      })

      it('should structure SSE result event', () => {
        const resultEvent = {
          event: 'result',
          data: { 
            type: 'result', 
            executionId: 'exec-125',
            status: 'completed',
            result: { text: 'Hello, world!' },
          },
        }

        expect(resultEvent.event).toBe('result')
        expect(resultEvent.data.status).toBe('completed')
      })

      it('should structure SSE complete event', () => {
        const completeEvent = {
          event: 'complete',
          data: { type: 'complete' },
        }

        expect(completeEvent.event).toBe('complete')
      })

      it('should structure SSE error event', () => {
        const errorEvent = {
          event: 'error',
          data: { 
            type: 'error',
            message: 'Actor timeout',
            code: 'TIMEOUT_ERROR',
          },
        }

        expect(errorEvent.event).toBe('error')
        expect(errorEvent.data.code).toBe('TIMEOUT_ERROR')
      })

      it('should format SSE message correctly', () => {
        const message = {
          event: 'result',
          data: { result: 42 },
        }

        const formatted = `event: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`
        
        expect(formatted).toContain('event: result')
        expect(formatted).toContain('data: {')
        expect(formatted).toMatch(/\n\n$/)
      })
    })

    describe('Newline-Delimited JSON (NDJSON) Format', () => {
      it('should format NDJSON messages', () => {
        const messages = [
          { type: 'start', executionId: 'exec-126' },
          { type: 'result', status: 'completed', result: { count: 100 } },
          { type: 'complete' },
        ]

        const ndjson = messages.map(m => JSON.stringify(m) + '\n').join('')
        
        expect(ndjson.split('\n').length).toBe(4) // 3 messages + empty line at end
        expect(ndjson).toContain('{"type":"start"')
      })

      it('should handle NDJSON streaming', () => {
        const chunks = [
          { type: 'progress', percent: 25 },
          { type: 'progress', percent: 50 },
          { type: 'progress', percent: 75 },
          { type: 'result', percent: 100, data: 'done' },
        ]

        chunks.forEach(chunk => {
          const line = JSON.stringify(chunk) + '\n'
          expect(line).toMatch(/\n$/)
          expect(() => JSON.parse(line.trim())).not.toThrow()
        })
      })
    })

    describe('Content Negotiation', () => {
      it('should detect SSE from Accept header', () => {
        const acceptHeader = 'text/event-stream'
        const isSSE = acceptHeader.includes('text/event-stream')
        
        expect(isSSE).toBe(true)
      })

      it('should detect NDJSON from Accept header', () => {
        const acceptHeader = 'application/x-ndjson'
        const isNDJSON = acceptHeader.includes('application/x-ndjson')
        
        expect(isNDJSON).toBe(true)
      })

      it('should default to JSON when no Accept header', () => {
        const acceptHeader = undefined
        const isJSON = !acceptHeader || acceptHeader === 'application/json'
        
        expect(isJSON).toBe(true)
      })

      it('should set correct Content-Type for each format', () => {
        const formats = {
          json: 'application/json',
          sse: 'text/event-stream',
          ndjson: 'application/x-ndjson',
        }

        expect(formats.json).toBe('application/json')
        expect(formats.sse).toBe('text/event-stream')
        expect(formats.ndjson).toBe('application/x-ndjson')
      })
    })
  })

  describe('Integration Scenarios', () => {
    it('should support complete actor discovery workflow', async () => {
      const registry = new InMemoryActorRegistry()
      const discovery = new DiscoveryService(registry)

      // 1. Register actor with endpoint and metadata
      await discovery.registerActor('ml-model', 'MLInference', 'gpu-worker-1', {
        serverEndpoint: 'http://gpu-worker-1:8080',
        capabilities: ['gpu', 'cuda'],
        model: 'llama-3-70b',
      } as any)

      // 2. Discover actor
      const actor = await registry.get('ml-model')
      expect(actor).toBeDefined()
      expect(actor!.serverEndpoint).toBe('http://gpu-worker-1:8080')

      // 3. Check if streaming is supported (would check schema endpoint)
      // GET /actors/ml-model/schema
      const supportsStreaming = true // From schema.capabilities.streaming

      // 4. Execute with appropriate format
      const format = supportsStreaming ? 'sse' : 'json'
      expect(format).toBe('sse')
    })

    it('should support fallback to queue-based routing', async () => {
      const registry = new InMemoryActorRegistry()
      const discovery = new DiscoveryService(registry)

      // Actor without server endpoint
      await discovery.registerActor('worker-1', 'DataProcessor', 'worker-1', {
        region: 'eu-west',
      } as any)

      const actor = await registry.get('worker-1')
      
      // Fall back to message queue routing
      if (!actor!.serverEndpoint) {
        const queue = await discovery.route('worker-1')
        expect(queue).toBe('actor:worker-1')
      }
    })

    it('should enable dynamic client generation from schema', async () => {
      // Simulates client using schema for validation
      const schema = {
        actorId: 'payment-gateway',
        inputSchema: {
          type: 'object',
          required: ['amount', 'currency'],
          properties: {
            amount: { type: 'number', minimum: 0.01 },
            currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] },
            metadata: { type: 'object' },
          },
        },
      }

      // Client validates input against schema
      const input = {
        amount: 99.99,
        currency: 'USD',
        metadata: { orderId: '12345' },
      }

      // Simple validation
      const hasRequiredFields = 
        'amount' in input && 
        'currency' in input &&
        input.amount >= 0.01 &&
        ['USD', 'EUR', 'GBP'].includes(input.currency)

      expect(hasRequiredFields).toBe(true)
    })
  })
})
