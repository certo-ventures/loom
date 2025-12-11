/**
 * Streaming Example - Local and Distributed
 */

import Redis from 'ioredis'
import { Actor } from '../src/actor/actor'
import type { ActorContext } from '../src/actor/journal'
import type { StreamChunk } from '../src/streaming/types'
import { RedisStreamPublisher, RedisStreamConsumer } from '../src/streaming/redis-stream'

class DataProcessorActor extends Actor {
  async execute(input: unknown): Promise<void> {}

  async *stream(input: any): AsyncGenerator<StreamChunk, void, unknown> {
    yield { type: 'start' }
    const items = input.items || []
    
    for (let i = 0; i < items.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 200))
      yield {
        type: 'progress',
        progress: { current: i + 1, total: items.length, message: `Processing ${i + 1}/${items.length}` }
      }
      yield { type: 'data', data: { item: items[i], result: `Processed: ${items[i]}` } }
    }
    
    yield { type: 'complete', data: { summary: `Processed ${items.length} items` } }
  }
}

class ChatActor extends Actor {
  async execute(input: unknown): Promise<void> {}

  async *stream(input: any): AsyncGenerator<StreamChunk, void, unknown> {
    yield { type: 'start' }
    const response = 'Hello! I am a streaming chat actor. I generate tokens like ChatGPT!'
    const tokens = response.split(' ')
    let fullResponse = ''
    
    for (const token of tokens) {
      await new Promise(resolve => setTimeout(resolve, 100))
      fullResponse += (fullResponse ? ' ' : '') + token
      yield { type: 'data', data: { token, fullResponse } }
    }
    
    yield { type: 'complete', data: { fullResponse } }
  }
}

async function example1_LocalStreaming() {
  console.log('\n' + '='.repeat(60))
  console.log('EXAMPLE 1: Local Streaming')
  console.log('='.repeat(60) + '\n')

  const context: ActorContext = { actorId: 'processor-1', actorType: 'data-processor', correlationId: 'local-demo' }
  const actor = new DataProcessorActor(context)

  for await (const chunk of actor.stream({ items: ['item1', 'item2', 'item3'] })) {
    if (chunk.type === 'start') console.log('   ▶️  Started')
    else if (chunk.type === 'progress') console.log(`   ⏳ ${chunk.progress?.message}`)
    else if (chunk.type === 'data') console.log(`   ✅ ${chunk.data.result}`)
    else if (chunk.type === 'complete') console.log(`   🎉 ${chunk.data.summary}`)
  }
}

async function example2_ChatStreaming() {
  console.log('\n' + '='.repeat(60))
  console.log('EXAMPLE 2: Chat Streaming')
  console.log('='.repeat(60) + '\n')

  const context: ActorContext = { actorId: 'chat-1', actorType: 'chat', correlationId: 'chat-demo' }
  const actor = new ChatActor(context)

  console.log('💬 Streaming response:\n   ')
  for await (const chunk of actor.stream({ prompt: 'Hello!' })) {
    if (chunk.type === 'data' && chunk.data.token) process.stdout.write(chunk.data.token + ' ')
    else if (chunk.type === 'complete') console.log('\n\n   ✅ Complete')
  }
}

async function example3_DistributedStreaming() {
  console.log('\n' + '='.repeat(60))
  console.log('EXAMPLE 3: Distributed Streaming (Redis)')
  console.log('='.repeat(60) + '\n')

  const redis = new Redis({ host: 'localhost', port: 6379 })
  const streamId = `demo-stream-${Date.now()}`
  const publisher = new RedisStreamPublisher(redis, streamId)

  const publishTask = (async () => {
    await publisher.publish({ type: 'start' })
    for (let i = 1; i <= 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 300))
      await publisher.publish({ type: 'progress', progress: { current: i, total: 5, message: `Step ${i}/5` } })
      await publisher.publish({ type: 'data', data: { step: i, result: `Remote step ${i} done` } })
    }
    await publisher.complete()
  })()

  const consumer = new RedisStreamConsumer(redis)
  for await (const chunk of consumer.read(streamId)) {
    if (chunk.type === 'start') console.log('   ▶️  Remote actor started')
    else if (chunk.type === 'progress') console.log(`   ⏳ ${chunk.progress?.message}`)
    else if (chunk.type === 'data') console.log(`   ✅ ${chunk.data.result}`)
    else if (chunk.type === 'complete') console.log('   🎉 Remote actor completed')
  }

  await publishTask
  await redis.quit()
}

async function main() {
  console.log('\n🚀 Streaming Output Demo\n')
  await example1_LocalStreaming()
  await example2_ChatStreaming()
  await example3_DistributedStreaming()
  console.log('\n✨ All Examples Complete!\n')
}

main().catch(console.error)
