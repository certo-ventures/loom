/**
 * Test: Simple State API
 * 
 * Demonstrates the Motia-inspired key-value state API
 */

import { Actor } from '../src/actor/actor'
import type { ActorContext } from '../src/actor/journal'

class CounterActor extends Actor {
  async execute(input: { action: string; value?: number }) {
    console.log(`\n📝 Action: ${input.action}`)
    
    if (input.action === 'increment') {
      // Simple API - get current count
      const count = (await this.simpleState.get<number>('count')) ?? 0
      await this.simpleState.set('count', count + 1)
      console.log(`   Count: ${count} → ${count + 1}`)
    }
    
    if (input.action === 'set') {
      await this.simpleState.set('count', input.value!)
      console.log(`   Count set to: ${input.value}`)
    }
    
    if (input.action === 'add-metadata') {
      await this.simpleState.set('lastUpdated', new Date().toISOString())
      await this.simpleState.set('user', 'alice')
      console.log(`   Metadata added`)
    }
    
    if (input.action === 'show-all') {
      const keys = await this.simpleState.keys()
      console.log(`   Keys: ${keys.join(', ')}`)
      console.log(`   Entries:`)
      const entries = await this.simpleState.entries()
      for (const [key, value] of entries) {
        console.log(`     ${key}: ${JSON.stringify(value)}`)
      }
    }
    
    if (input.action === 'delete') {
      await this.simpleState.delete('user')
      console.log(`   Deleted 'user' key`)
    }
    
    if (input.action === 'check') {
      console.log(`   Has 'count': ${await this.simpleState.has('count')}`)
      console.log(`   Has 'user': ${await this.simpleState.has('user')}`)
    }
    
    if (input.action === 'clear') {
      await this.simpleState.clear()
      console.log(`   All state cleared`)
    }
  }
}

async function test() {
  const context: ActorContext = {
    actorId: 'counter-1',
    actorType: 'CounterActor',
    correlationId: 'test-1',
  }
  
  const actor = new CounterActor(context)
  
  console.log('Testing Simple State API...')
  
  await actor.execute({ action: 'increment' })
  await actor.execute({ action: 'increment' })
  await actor.execute({ action: 'increment' })
  
  await actor.execute({ action: 'add-metadata' })
  await actor.execute({ action: 'show-all' })
  
  await actor.execute({ action: 'check' })
  await actor.execute({ action: 'delete' })
  await actor.execute({ action: 'check' })
  
  await actor.execute({ action: 'set', value: 100 })
  await actor.execute({ action: 'show-all' })
  
  await actor.execute({ action: 'clear' })
  await actor.execute({ action: 'show-all' })
  
  console.log('\n✅ All simple state tests passed!')
}

test().catch(console.error)
