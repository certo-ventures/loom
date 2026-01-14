import { Actor, ActorContext } from '../src/actor'

/**
 * CounterActor - Simple stateful counter example
 * Shows the absolute minimum needed to create an actor
 */
export class CounterActor extends Actor {
  protected getDefaultState() {
    return { count: 0 }
  }

  async execute(input: { operation: 'increment' | 'decrement' | 'reset'; value?: number }) {
    const current = this.state.count as number

    switch (input.operation) {
      case 'increment':
        this.updateState(draft => { draft.count = current + (input.value || 1) })
        break
      
      case 'decrement':
        this.updateState(draft => { draft.count = current - (input.value || 1) })
        break
      
      case 'reset':
        this.updateState(draft => { draft.count = 0 })
        break
    }
  }
}
