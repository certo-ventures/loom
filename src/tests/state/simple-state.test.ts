import { describe, it, expect } from 'vitest'
import { SimpleStateImpl } from '../../state'

describe('SimpleStateImpl', () => {
  it('reads and writes through the async facade even with sync stores', async () => {
    let state: Record<string, unknown> = { count: 1 }
    const simpleState = new SimpleStateImpl(
      () => state,
      (next) => {
        state = next
      }
    )

    expect(await simpleState.get('count')).toBe(1)
    await simpleState.set('count', 2)
    expect(state.count).toBe(2)

    expect(await simpleState.has('count')).toBe(true)
    expect(await simpleState.keys()).toEqual(['count'])
    expect(await simpleState.entries()).toEqual([['count', 2]])

    await simpleState.delete('count')
    expect(await simpleState.has('count')).toBe(false)

    await simpleState.clear()
    expect(state).toEqual({})
  })

  it('supports async storage providers without additional wrappers', async () => {
    let state: Record<string, unknown> = { ready: false }
    const simpleState = new SimpleStateImpl(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 1))
        return state
      },
      async (next) => {
        await new Promise(resolve => setTimeout(resolve, 1))
        state = next
      }
    )

    await simpleState.set('ready', true)
    expect(state.ready).toBe(true)
    expect(await simpleState.get('ready')).toBe(true)
  })
})
