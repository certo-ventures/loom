/**
 * Server-Sent Events (SSE) Streaming for Group Chat
 * 
 * Provides HTTP endpoint for real-time group chat streaming
 * Compatible with Claude-style streaming patterns
 */

import type { IncomingMessage, ServerResponse } from 'http'
import { GroupChatActor, type GroupChatInput } from '../actor/group-chat-actor'
import type { ActorContext } from '../actor/journal'
import type { StreamChunk } from '../streaming/types'

/**
 * SSE Event format
 */
interface SSEEvent {
  id?: string
  event?: string
  data: string
  retry?: number
}

/**
 * Format SSE message
 */
function formatSSE(event: SSEEvent): string {
  let message = ''
  
  if (event.id) {
    message += `id: ${event.id}\n`
  }
  
  if (event.event) {
    message += `event: ${event.event}\n`
  }
  
  message += `data: ${event.data}\n\n`
  
  if (event.retry) {
    message += `retry: ${event.retry}\n`
  }
  
  return message
}

/**
 * Handle SSE connection for group chat
 * 
 * ✅ Built-in streaming - SSE out of the box
 */
export async function handleGroupChatSSE(
  req: IncomingMessage,
  res: ServerResponse,
  input: GroupChatInput,
  context: ActorContext
): Promise<void> {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*', // CORS for browser clients
  })

  // Send initial connection event
  res.write(formatSSE({
    event: 'connected',
    data: JSON.stringify({ message: 'Group chat stream connected' })
  }))

  try {
    // Create group chat actor
    const groupChat = new GroupChatActor(context)

    // Stream events
    let eventId = 0
    for await (const chunk of groupChat.stream(input)) {
      eventId++

      // Map chunk type to SSE event type
      const eventType = chunk.type === 'data' 
        ? (chunk.data?.event || 'message')
        : chunk.type

      // Send SSE event
      res.write(formatSSE({
        id: eventId.toString(),
        event: eventType,
        data: JSON.stringify(chunk)
      }))

      // Handle completion
      if (chunk.type === 'complete') {
        res.write(formatSSE({
          event: 'done',
          data: JSON.stringify({ message: 'Stream complete' })
        }))
        break
      }

      // Handle errors
      if (chunk.type === 'error') {
        res.write(formatSSE({
          event: 'error',
          data: JSON.stringify({ error: chunk.error })
        }))
        break
      }
    }

  } catch (error) {
    // Send error event
    res.write(formatSSE({
      event: 'error',
      data: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }))
  } finally {
    res.end()
  }
}

/**
 * WebSocket handler for group chat (alternative to SSE)
 */
export async function handleGroupChatWebSocket(
  ws: any, // WebSocket instance
  input: GroupChatInput,
  context: ActorContext
): Promise<void> {
  try {
    // Send connection message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Group chat stream connected'
    }))

    // Create group chat actor
    const groupChat = new GroupChatActor(context)

    // Stream events
    for await (const chunk of groupChat.stream(input)) {
      // Send as JSON
      ws.send(JSON.stringify(chunk))

      // Handle completion
      if (chunk.type === 'complete' || chunk.type === 'error') {
        break
      }
    }

    // Send done message
    ws.send(JSON.stringify({
      type: 'done',
      message: 'Stream complete'
    }))

  } catch (error) {
    // Send error
    ws.send(JSON.stringify({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }))
  } finally {
    ws.close()
  }
}

/**
 * Convert AsyncGenerator stream to SSE stream
 * Generic utility for any streaming actor
 */
export async function streamToSSE(
  res: ServerResponse,
  stream: AsyncGenerator<StreamChunk, void, unknown>
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  try {
    let eventId = 0
    for await (const chunk of stream) {
      eventId++

      res.write(formatSSE({
        id: eventId.toString(),
        event: chunk.type,
        data: JSON.stringify(chunk)
      }))

      if (chunk.type === 'complete' || chunk.type === 'error') {
        break
      }
    }
  } finally {
    res.end()
  }
}
