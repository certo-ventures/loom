import { describe, it, expect } from 'vitest'
import type { Message, ActorState } from './types'

describe('Types', () => {
  it('should create a valid Message', () => {
    const message: Message = {
      messageId: 'msg-123',
      actorId: 'actor-456',
      messageType: 'event',
      correlationId: 'corr-789',
      payload: { test: 'data' },
      metadata: {
        timestamp: new Date().toISOString(),
        priority: 0,
      },
    }

    expect(message.messageId).toBe('msg-123')
    expect(message.messageType).toBe('event')
  })

  it('should create a valid ActorState', () => {
    const state: ActorState = {
      id: 'actor-123',
      partitionKey: 'test-actor',
      actorType: 'test-actor',
      status: 'active',
      state: { count: 0 },
      correlationId: 'corr-789',
      createdAt: new Date().toISOString(),
      lastActivatedAt: new Date().toISOString(),
    }

    expect(state.id).toBe('actor-123')
    expect(state.status).toBe('active')
    expect(state.state.count).toBe(0)
  })
})
