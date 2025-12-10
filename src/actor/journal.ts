/**
 * Journal entry types for deterministic replay
 */
export type JournalEntry =
  | { type: 'state_updated'; state: Record<string, unknown> }
  | { type: 'activity_scheduled'; activityId: string; name: string; input: unknown }
  | { type: 'activity_completed'; activityId: string; result: unknown }
  | { type: 'activity_failed'; activityId: string; error: string }
  | { type: 'child_spawned'; childId: string; actorType: string; input: unknown }
  | { type: 'event_received'; eventType: string; data: unknown }
  | { type: 'suspended'; reason: string }

/**
 * Journal tracks all actor actions for replay
 */
export interface Journal {
  entries: JournalEntry[]
  cursor: number
}

/**
 * Context provided to actor execution
 */
export interface ActorContext {
  actorId: string
  actorType: string
  correlationId: string
  parentActorId?: string
}
