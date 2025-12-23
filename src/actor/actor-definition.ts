/**
 * ActorDefinition - Metadata for actor registration
 * Similar to ActivityDefinition but for actors
 */
export interface ActorDefinition {
  name: string
  version: string
  type: 'typescript' | 'wasm'

  // For TypeScript actors
  actorClass?: new (context: any, state?: any) => any

  // For WASM actors (path in BlobStore)
  blobPath?: string
}
