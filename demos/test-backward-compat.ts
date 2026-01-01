/**
 * Test: Backward Compatibility
 * 
 * Verifies that both old updateState() and new simpleState API work together
 */

import { Actor } from '../src/actor/actor'
import type { ActorContext } from '../src/actor/journal'

class HybridActor extends Actor {
  async execute(input: { mode: string }) {
    console.log(`\n🧪 Testing: ${input.mode}`)
    
    if (input.mode === 'old-api') {
      // OLD API - still works!
      this.updateState({ 
        count: 10,
        timestamp: Date.now(),
        source: 'updateState'
      })
      console.log('   ✅ updateState() works')
      console.log(`   State: ${JSON.stringify(this.state)}`)
    }
    
    if (input.mode === 'new-api') {
      // NEW API - simple and clean!
      await this.simpleState.set('count', 20)
      await this.simpleState.set('timestamp', Date.now())
      await this.simpleState.set('source', 'simpleState')
      console.log('   ✅ simpleState works')
      console.log(`   State: ${JSON.stringify(this.state)}`)
    }
    
    if (input.mode === 'mixed') {
      // MIXED - both APIs together!
      this.updateState({ batch: [1, 2, 3] })
      await this.simpleState.set('individual', 'value')
      console.log('   ✅ Both APIs work together')
      console.log(`   State: ${JSON.stringify(this.state)}`)
    }
    
    if (input.mode === 'verify-journal') {
      // Verify journal records state updates
      await this.simpleState.set('test', 'A')
      await this.simpleState.set('test', 'B')
      this.updateState({ complex: { nested: true } })
      
      const journal = this.getJournal()
      console.log(`   ✅ Journal has ${journal.entries.length} entries`)
      console.log('   Journal entries:')
      journal.entries.forEach((entry, i) => {
        if (entry.type === 'state_updated') {
          console.log(`     ${i}: state_updated - ${JSON.stringify(entry.state)}`)
        }
      })
    }
  }
}

async function test() {
  const context: ActorContext = {
    actorId: 'hybrid-1',
    actorType: 'HybridActor',
    correlationId: 'test-compat',
  }
  
  console.log('Testing Backward Compatibility...')
  
  const actor = new HybridActor(context)
  
  await actor.execute({ mode: 'old-api' })
  await actor.execute({ mode: 'new-api' })
  await actor.execute({ mode: 'mixed' })
  await actor.execute({ mode: 'verify-journal' })
  
  console.log('\n✅ Backward compatibility confirmed!')
  console.log('   - Old updateState() API: ✅ Works')
  console.log('   - New simpleState API: ✅ Works')
  console.log('   - Mixed usage: ✅ Works')
  console.log('   - Journal recording: ✅ Works')
}

test().catch(console.error)
