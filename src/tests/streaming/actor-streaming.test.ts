import { describe, it, expect } from 'vitest'
import { Actor } from '../../actor/actor'
import type { ActorContext } from '../../actor/journal'
import type { StreamChunk } from '../../streaming/types'

// Test actor with default streaming (wraps execute)
class SimpleActor extends Actor {
  async execute(input: unknown): Promise<void> {
    this.updateState({ result: `Processed: ${input}` })
  }
}

// Test actor with custom streaming
class StreamingActor extends Actor {
  async execute(input: unknown): Promise<void> {
    // Not used when streaming
  }

  async *stream(input: unknown): AsyncGenerator<StreamChunk, void, unknown> {
    yield { type: 'start' }

    // Simulate multi-step process
    for (let i = 1; i <= 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 10))
      
      yield {
        type: 'progress',
        progress: {
          current: i,
          total: 5,
          message: `Processing step ${i}`
        }
      }
      
      yield {
        type: 'data',
        data: { step: i, result: `Step ${i} complete` }
      }
    }

    yield {
      type: 'complete',
      data: { final: `Processed ${input}` }
    }
  }
}

// Test actor that simulates token-by-token generation
class TokenStreamingActor extends Actor {
  async execute(input: unknown): Promise<void> {
    // Not used
  }

  async *stream(input: unknown): AsyncGenerator<StreamChunk, void, unknown> {
    yield { type: 'start' }

    const text = 'Hello from streaming actor!'
    const tokens = text.split(' ')

    let fullResponse = ''
    for (const token of tokens) {
      await new Promise(resolve => setTimeout(resolve, 10))
      fullResponse += (fullResponse ? ' ' : '') + token
      
      yield {
        type: 'data',
        data: { token, fullResponse }
      }
    }

    yield {
      type: 'complete',
      data: { fullResponse }
    }
  }
}

// Test actor that throws error during streaming
class ErrorStreamingActor extends Actor {
  async execute(input: unknown): Promise<void> {
    // Not used
  }

  async *stream(input: unknown): AsyncGenerator<StreamChunk, void, unknown> {
    yield { type: 'start' }
    yield { type: 'data', data: 'Some data' }
    yield { type: 'error', error: new Error('Streaming failed') }
  }
}

describe('Actor Streaming', () => {
  const context: ActorContext = {
    actorId: 'test-actor',
    actorType: 'test',
    correlationId: 'test-correlation',
  }

  describe('Default Streaming (wraps execute)', () => {
    it('should stream start and complete chunks', async () => {
      const actor = new SimpleActor(context)
      const chunks: StreamChunk[] = []

      for await (const chunk of actor.stream('test input')) {
        chunks.push(chunk)
      }

      expect(chunks).toHaveLength(2)
      expect(chunks[0].type).toBe('start')
      expect(chunks[1].type).toBe('complete')
      expect(chunks[1].data).toEqual({ result: 'Processed: test input' })
    })

    it('should handle errors in default streaming', async () => {
      class ErrorActor extends Actor {
        async execute(input: unknown): Promise<void> {
          throw new Error('Execution failed')
        }
      }

      const actor = new ErrorActor(context)
      const chunks: StreamChunk[] = []

      try {
        for await (const chunk of actor.stream('test')) {
          chunks.push(chunk)
        }
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe('Execution failed')
      }

      expect(chunks[0].type).toBe('start')
      expect(chunks[1].type).toBe('error')
    })
  })

  describe('Custom Streaming', () => {
    it('should stream progress updates', async () => {
      const actor = new StreamingActor(context)
      const chunks: StreamChunk[] = []

      for await (const chunk of actor.stream('test input')) {
        chunks.push(chunk)
      }

      // 1 start + 5 progress + 5 data + 1 complete = 12 chunks
      expect(chunks.length).toBeGreaterThanOrEqual(12)

      expect(chunks[0].type).toBe('start')
      
      const progressChunks = chunks.filter(c => c.type === 'progress')
      expect(progressChunks).toHaveLength(5)
      expect(progressChunks[0].progress).toEqual({
        current: 1,
        total: 5,
        message: 'Processing step 1'
      })

      const dataChunks = chunks.filter(c => c.type === 'data')
      expect(dataChunks).toHaveLength(5)

      const completeChunk = chunks.find(c => c.type === 'complete')
      expect(completeChunk).toBeDefined()
      expect(completeChunk?.data).toEqual({ final: 'Processed test input' })
    })

    it('should stream tokens like an LLM', async () => {
      const actor = new TokenStreamingActor(context)
      const chunks: StreamChunk[] = []

      for await (const chunk of actor.stream('prompt')) {
        chunks.push(chunk)
      }

      const dataChunks = chunks.filter(c => c.type === 'data')
      const tokens = dataChunks.map(c => c.data?.token)
      
      expect(tokens).toEqual(['Hello', 'from', 'streaming', 'actor!'])

      const lastData = dataChunks[dataChunks.length - 1]
      expect(lastData.data?.fullResponse).toBe('Hello from streaming actor!')
    })

    it('should handle streaming errors', async () => {
      const actor = new ErrorStreamingActor(context)
      const chunks: StreamChunk[] = []

      for await (const chunk of actor.stream('test')) {
        chunks.push(chunk)
      }

      expect(chunks[0].type).toBe('start')
      expect(chunks[1].type).toBe('data')
      expect(chunks[2].type).toBe('error')
      expect(chunks[2].error?.message).toBe('Streaming failed')
    })
  })

  describe('Streaming Patterns', () => {
    it('should allow collecting all chunks', async () => {
      const actor = new StreamingActor(context)
      const chunks: StreamChunk[] = []

      for await (const chunk of actor.stream('test')) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].type).toBe('start')
      expect(chunks[chunks.length - 1].type).toBe('complete')
    })

    it('should allow filtering specific chunk types', async () => {
      const actor = new StreamingActor(context)
      const dataChunks: StreamChunk[] = []

      for await (const chunk of actor.stream('test')) {
        if (chunk.type === 'data') {
          dataChunks.push(chunk)
        }
      }

      expect(dataChunks).toHaveLength(5)
      expect(dataChunks.every(c => c.data)).toBe(true)
    })

    it('should allow processing chunks as they arrive', async () => {
      const actor = new TokenStreamingActor(context)
      const processedTokens: string[] = []

      for await (const chunk of actor.stream('prompt')) {
        if (chunk.type === 'data' && chunk.data?.token) {
          processedTokens.push(chunk.data.token)
        }
      }

      expect(processedTokens).toEqual(['Hello', 'from', 'streaming', 'actor!'])
    })
  })
})
