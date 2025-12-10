import { Actor, ActorContext } from '../src/actor'

/**
 * WorkflowActor - Demonstrates calling activities and spawning children
 */
export class WorkflowActor extends Actor {
  protected getDefaultState() {
    return {
      status: 'pending',
      step: 0,
      results: [],
    }
  }

  async execute(input: { workflowId: string; data: any }) {
    this.updateState({ status: 'running', step: 1 })

    // Step 1: Call an HTTP activity
    const httpResult = await this.callActivity('http-request', {
      url: 'https://api.example.com/data',
      method: 'GET',
    })
    this.updateState({ step: 2, results: [httpResult] })

    // Step 2: Spawn a child actor to process the result
    const childId = await this.spawnChild('processor', { data: httpResult })
    this.updateState({ step: 3, childId })

    // Step 3: Wait for completion event
    const completionEvent = await this.waitForEvent<{ success: boolean }>('processing_complete')
    
    if (completionEvent.success) {
      this.updateState({ status: 'completed', step: 4 })
    } else {
      this.updateState({ status: 'failed', step: 4 })
    }
  }
}
