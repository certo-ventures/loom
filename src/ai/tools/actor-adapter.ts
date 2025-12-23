/**
 * Actor Tool Adapter - Bridges Actor Registry → Tool System
 * 
 * Converts ActorMetadata into Tool format so LLMs can orchestrate actors
 */

import type { Tool } from './types'
import type { ActorMetadata } from '../../../packages/loom-server/src/types'

export interface ActorExecutor {
  execute(actorId: string, version: string | undefined, input: any): Promise<any>
}

/**
 * Convert ActorMetadata to Tool format
 */
export function actorToTool(
  actor: ActorMetadata,
  executor: ActorExecutor
): Tool {
  // Convert JSON Schema to OpenAI function parameter format
  const parameters = {
    type: 'object',
    properties: actor.inputSchema.properties || {},
    required: actor.inputSchema.required || [],
    ...(actor.inputSchema.description && { description: actor.inputSchema.description }),
  }

  return {
    name: `actor_${actor.actorId.replace(/-/g, '_')}`,
    description: actor.description || actor.displayName,
    parameters,
    category: 'actor',
    metadata: {
      actorId: actor.actorId,
      version: actor.version,
      author: actor.author,
      tags: actor.tags,
    },
    execute: async (input: any) => {
      const result = await executor.execute(actor.actorId, actor.version, input)
      return result
    },
  }
}

/**
 * Convert multiple actors to tools
 */
export function actorsToTools(
  actors: ActorMetadata[],
  executor: ActorExecutor
): Tool[] {
  return actors.map(actor => actorToTool(actor, executor))
}

/**
 * Build tool description with actor metadata
 */
export function buildActorToolDescription(actor: ActorMetadata): string {
  const parts = [actor.description || actor.displayName]
  
  if (actor.tags && actor.tags.length > 0) {
    parts.push(`Tags: ${actor.tags.join(', ')}`)
  }
  
  if (actor.author) {
    parts.push(`Author: ${actor.author}`)
  }
  
  return parts.join(' | ')
}
