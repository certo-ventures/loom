/**
 * Message represents any communication between actors or from external sources
 */
export interface Message {
  messageId: string
  actorId: string
  messageType: 'execute' | 'event' | 'activate' | 'resume' | 'activity_completed' | 'activity_failed'
  correlationId: string
  payload: Record<string, unknown>
  metadata: {
    timestamp: string
    sender?: string
    priority: number
    ttl?: number
  }
}

/**
 * Actor state stored in persistence layer
 */
export interface ActorState {
  id: string
  partitionKey: string
  actorType: string
  status: 'active' | 'suspended' | 'completed' | 'failed'
  state: Record<string, unknown>
  correlationId: string
  createdAt: string
  lastActivatedAt: string
  metadata?: Record<string, unknown>
}
