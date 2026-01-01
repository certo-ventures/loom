import { describe, test, expect, vi } from 'vitest'
import { Actor } from '../../src/actor/actor'
import type { ActorContext } from '../../src/actor/journal'
import type { Message, TraceContext } from '../../src/types'
import { LongLivedActorRuntime } from '../../src/actor/actor-runtime'
import type { BlobStore } from '../../src/storage/blob-store'
import { InMemoryStateStore } from '../../src/storage/in-memory-state-store'
import type { ActorDefinition } from '../../src/actor/actor-definition'

class TestActor extends Actor {
  async execute(input: unknown): Promise<void> {
    this.updateState({ lastInput: input })
  }
}

const traceContext: TraceContext = {
  trace_id: 'trace-1',
  span_id: 'span-1',
}

function createContext(): ActorContext {
  return {
    actorId: 'actor-1',
    actorType: 'TestActor',
    correlationId: 'corr-1',
    recordEvent: vi.fn(),
    recordMetric: vi.fn(),
    startSpan: () => vi.fn(),
  }
}

function createMessage(overrides: Partial<Message> = {}): Message {
  const base: Message = {
    messageId: 'msg-1',
    actorId: 'actor-1',
    messageType: 'execute',
    correlationId: 'corr-1',
    payload: { hello: 'world' },
    trace: traceContext,
    idempotencyKey: 'key-1',
    metadata: {
      timestamp: new Date().toISOString(),
      priority: 0,
      retryCount: 0,
      actorType: 'TestActor',
    },
  }

  return { ...base, ...overrides }
}

function createBlobStore(): BlobStore {
  return {
    upload: vi.fn(),
    download: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn(),
  }
}

describe('Actor invocation journaling', () => {
  test('recordInvocation stores payload snapshot and exposes lastInvocation', () => {
    const actor = new TestActor(createContext())
    const message = createMessage({ payload: { foo: 'bar' }, messageId: 'msg-42' })

    actor.recordInvocation(message)

    const lastInvocation = actor.getLastInvocation()
    expect(lastInvocation).toBeDefined()
    expect(lastInvocation?.messageId).toBe('msg-42')
    expect(lastInvocation?.payload).toEqual({ foo: 'bar' })

    const hasInvocationEntry = actor.getJournal().entries.some(entry => entry.type === 'invocation')
    expect(hasInvocationEntry).toBe(true)
  })

  test('runtime persistence stores last invocation metadata', async () => {
    const blobStore = createBlobStore()
    const stateStore = new InMemoryStateStore()
    const runtime = new LongLivedActorRuntime({ blobStore, stateStore })

    const definition: ActorDefinition = {
      name: 'TestActor',
      version: '1.0.0',
      type: 'typescript',
      actorClass: TestActor,
    }

    runtime.registerActorType('TestActor', definition)

    const message = createMessage({ payload: { number: 7 } })
    await runtime.routeMessage(message, createContext())

    const persisted = await stateStore.load('actor-1')
    expect(persisted).not.toBeNull()
    expect(persisted?.state.lastInput).toEqual({ number: 7 })
    expect(persisted?.metadata?.journal.entries.some((entry: any) => entry.type === 'invocation')).toBe(true)
    expect(persisted?.metadata?.lastInvocation?.payload).toEqual({ number: 7 })
    expect(persisted?.metadata?.lastInvocation?.messageId).toBe('msg-1')
  })
})
