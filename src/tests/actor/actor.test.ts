import { describe, it, expect } from 'vitest'
import { Actor, ActorContext, ActivitySuspendError, EventSuspendError } from '../../actor'

class TestActor extends Actor {
  protected getDefaultState() {
    return { count: 0, results: [] }
  }

  async execute(input: unknown) {
    // Update state
    this.updateState({ count: 1 })

    // Call an activity
    const result = await this.callActivity('test-activity', { value: 42 })
    this.updateState({ results: [result] })
  }
}

class EventActor extends Actor {
  async execute() {
    this.updateState({ status: 'waiting' })
    const event = await this.waitForEvent<{ value: number }>('user_input')
    this.updateState({ status: 'completed', value: event.value })
  }
}

describe('Actor', () => {
  it('should initialize with default state', () => {
    const context: ActorContext = {
      actorId: 'test-1',
      actorType: 'test',
      correlationId: 'corr-1',
    }

    const actor = new TestActor(context)
    expect(actor.getState()).toEqual({ count: 0, results: [] })
  })

  it('should update state', async () => {
    const context: ActorContext = {
      actorId: 'test-1',
      actorType: 'test',
      correlationId: 'corr-1',
    }

    const actor = new TestActor(context)
    
    try {
      await actor.execute(null)
    } catch (error) {
      // Will suspend on activity call
      expect(error).toBeInstanceOf(ActivitySuspendError)
    }

    expect(actor.getState().count).toBe(1)
  })

  it('should record journal entries', async () => {
    const context: ActorContext = {
      actorId: 'test-1',
      actorType: 'test',
      correlationId: 'corr-1',
    }

    const actor = new TestActor(context)
    
    try {
      await actor.execute(null)
    } catch (error) {
      // Expected
    }

    const journal = actor.getJournal()
    expect(journal.entries.length).toBeGreaterThan(0)
    expect(journal.entries[0].type).toBe('state_updated')
    expect(journal.entries[1].type).toBe('activity_scheduled')
  })

  it('should suspend for activity execution', async () => {
    const context: ActorContext = {
      actorId: 'test-1',
      actorType: 'test',
      correlationId: 'corr-1',
    }

    const actor = new TestActor(context)
    
    try {
      await actor.execute(null)
      expect.fail('Should have thrown ActivitySuspendError')
    } catch (error) {
      expect(error).toBeInstanceOf(ActivitySuspendError)
      const suspendError = error as ActivitySuspendError
      expect(suspendError.activityName).toBe('test-activity')
      expect(suspendError.input).toEqual({ value: 42 })
    }
  })

  it('should resume after activity completion', async () => {
    const context: ActorContext = {
      actorId: 'test-1',
      actorType: 'test',
      correlationId: 'corr-1',
    }

    const actor = new TestActor(context)
    
    // First execution - suspends
    let activityId: string
    try {
      await actor.execute(null)
    } catch (error) {
      activityId = (error as ActivitySuspendError).activityId
    }

    // Resume with result
    await actor.resumeWithActivity(activityId!, { success: true })

    // State should include result
    const state = actor.getState()
    expect(state.count).toBe(1)
    expect((state.results as any[])[0]).toEqual({ success: true })
  })

  it('should suspend waiting for events', async () => {
    const context: ActorContext = {
      actorId: 'event-1',
      actorType: 'event',
      correlationId: 'corr-1',
    }

    const actor = new EventActor(context)

    try {
      await actor.execute(null)
      expect.fail('Should have thrown EventSuspendError')
    } catch (error) {
      expect(error).toBeInstanceOf(EventSuspendError)
      expect((error as EventSuspendError).eventType).toBe('user_input')
    }

    expect(actor.getState().status).toBe('waiting')
  })

  it('should resume with event data', async () => {
    const context: ActorContext = {
      actorId: 'event-1',
      actorType: 'event',
      correlationId: 'corr-1',
    }

    const actor = new EventActor(context)

    // First execution - suspends
    try {
      await actor.execute(null)
    } catch (error) {
      // Expected
    }

    // Resume with event
    await actor.resume('user_input', { value: 123 })

    const state = actor.getState()
    expect(state.status).toBe('completed')
    expect(state.value).toBe(123)
  })
})
