/**
 * Task examples and test
 * Demonstrates lightweight stateless operations
 */

import { Task, createTask } from '../src/task'

console.log('='.repeat(60))
console.log('TASK ABSTRACTION TEST')
console.log('='.repeat(60))

// Example 1: Email notification task (class-based)
class SendEmailTask extends Task<{ to: string; subject: string; body: string }, boolean> {
  async execute(input: { to: string; subject: string; body: string }, context: import('../src/task').TaskContext) {
    console.log(`\n[${context.taskId}] Sending email...`)
    console.log(`  To: ${input.to}`)
    console.log(`  Subject: ${input.subject}`)
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 100))
    
    console.log(`  ✅ Email sent successfully`)
    return true
  }
}

// Example 2: Webhook task (inline function)
const triggerWebhook = createTask<{ url: string; payload: any }, { status: number }>(
  'TriggerWebhook',
  async (input, context) => {
    console.log(`\n[${context.taskId}] Triggering webhook...`)
    console.log(`  URL: ${input.url}`)
    console.log(`  Payload: ${JSON.stringify(input.payload)}`)
    
    // Simulate HTTP request
    await new Promise(resolve => setTimeout(resolve, 50))
    
    console.log(`  ✅ Webhook triggered`)
    return { status: 200 }
  }
)

// Example 3: Data transformation task
class TransformDataTask extends Task<number[], { sum: number; avg: number; count: number }> {
  async execute(numbers: number[]) {
    const sum = numbers.reduce((a, b) => a + b, 0)
    const avg = sum / numbers.length
    const count = numbers.length
    
    return { sum, avg, count }
  }
}

// Example 4: Task that can fail
const riskyTask = createTask<{ failureRate: number }, string>(
  'RiskyTask',
  async (input, context) => {
    console.log(`\n[${context.taskId}] Running risky task...`)
    
    if (Math.random() < input.failureRate) {
      throw new Error('Task failed randomly!')
    }
    
    return 'Success!'
  }
)

// Run the tests
async function runTests() {
  console.log('\n--- Test 1: Send Email Task ---')
  const emailTask = new SendEmailTask()
  const emailResult = await emailTask.run({
    to: 'user@example.com',
    subject: 'Welcome!',
    body: 'Thanks for signing up',
  }, {
    correlationId: 'user-signup-123',
  })
  console.log('Result:', {
    success: emailResult.success,
    duration: emailResult.duration + 'ms',
  })
  
  console.log('\n--- Test 2: Trigger Webhook Task ---')
  const webhookResult = await triggerWebhook.run({
    url: 'https://api.example.com/webhook',
    payload: { event: 'user.created', userId: 'user-123' },
  })
  console.log('Result:', {
    success: webhookResult.success,
    status: webhookResult.data?.status,
    duration: webhookResult.duration + 'ms',
  })
  
  console.log('\n--- Test 3: Transform Data Task ---')
  const transformTask = new TransformDataTask()
  const transformResult = await transformTask.run([1, 2, 3, 4, 5])
  console.log('Result:', {
    success: transformResult.success,
    data: transformResult.data,
    duration: transformResult.duration + 'ms',
  })
  
  console.log('\n--- Test 4: Error Handling ---')
  
  // Try task with low failure rate (should succeed)
  const successResult = await riskyTask.run({ failureRate: 0 })
  console.log('Low risk result:', {
    success: successResult.success,
    data: successResult.data,
  })
  
  // Try task with high failure rate (should fail)
  const failResult = await riskyTask.run({ failureRate: 1 })
  console.log('High risk result:', {
    success: failResult.success,
    error: failResult.error?.message,
    duration: failResult.duration + 'ms',
  })
  
  console.log('\n--- Test 5: Parallel Task Execution ---')
  const startTime = Date.now()
  
  const results = await Promise.all([
    new SendEmailTask().run({ to: 'user1@example.com', subject: 'Test 1', body: 'Body 1' }),
    new SendEmailTask().run({ to: 'user2@example.com', subject: 'Test 2', body: 'Body 2' }),
    new SendEmailTask().run({ to: 'user3@example.com', subject: 'Test 3', body: 'Body 3' }),
  ])
  
  const totalTime = Date.now() - startTime
  console.log(`Sent ${results.filter(r => r.success).length} emails in parallel`)
  console.log(`Total time: ${totalTime}ms (would be ~300ms if sequential)`)
  
  console.log('\n--- Test 6: Task Composition ---')
  
  // Chain tasks together
  const step1Result = await transformTask.run([10, 20, 30])
  if (step1Result.success && step1Result.data) {
    console.log('Step 1 - Transform:', step1Result.data)
    
    const step2Result = await triggerWebhook.run({
      url: 'https://api.example.com/stats',
      payload: step1Result.data,
    })
    console.log('Step 2 - Webhook:', step2Result.success ? 'Sent' : 'Failed')
  }
  
  console.log('\n' + '='.repeat(60))
  console.log('TEST COMPLETE')
  console.log('='.repeat(60))
  console.log('\n✅ Demonstrated:')
  console.log('  - Class-based tasks (SendEmailTask, TransformDataTask)')
  console.log('  - Inline tasks (createTask helper)')
  console.log('  - Error handling (success/failure results)')
  console.log('  - Timing metrics (duration tracking)')
  console.log('  - Correlation IDs (request tracing)')
  console.log('  - Parallel execution (Promise.all)')
  console.log('  - Task composition (chaining)')
  console.log('\n💡 When to use Tasks vs Actors:')
  console.log('  ✅ Tasks: Stateless, fire-and-forget, simple operations')
  console.log('  ✅ Actors: Stateful, complex workflows, durable execution')
  console.log('\n📝 Usage:')
  console.log('  // Class-based')
  console.log('  class MyTask extends Task<Input, Output> {')
  console.log('    async execute(input, context) { ... }')
  console.log('  }')
  console.log('  await new MyTask().run(input)')
  console.log('')
  console.log('  // Inline')
  console.log('  const task = createTask("TaskName", async (input, ctx) => { ... })')
  console.log('  await task.run(input)')
}

runTests().catch(console.error)
