/**
 * Actor Lifecycle Events - Pub/Sub for actor state changes
 * 
 * ANY system can subscribe to actor lifecycle events:
 * - Studio for monitoring
 * - Metrics collectors
 * - Audit logs
 * - External systems
 * 
 * Uses Redis Pub/Sub - NO POLLING!
 */

import type { Redis } from 'ioredis';

export type ActorLifecycleEventType =
  | 'actor:registered'
  | 'actor:unregistered'
  | 'actor:status-changed'
  | 'actor:heartbeat'
  | 'actor:message-processed';

export interface ActorLifecycleEvent {
  type: ActorLifecycleEventType;
  actorId: string;
  actorType: string;
  workerId: string;
  timestamp: string;
  data?: Record<string, any>;
}

export type ActorEventHandler = (event: ActorLifecycleEvent) => void | Promise<void>;

/**
 * Actor Event Bus - Publishes actor lifecycle events
 */
export class ActorEventBus {
  private static readonly CHANNEL = 'loom:actor:events';

  constructor(private redis: Redis) {}

  /**
   * Publish an actor lifecycle event
   */
  async publish(event: ActorLifecycleEvent): Promise<void> {
    await this.redis.publish(
      ActorEventBus.CHANNEL,
      JSON.stringify(event)
    );
  }

  /**
   * Subscribe to all actor lifecycle events
   */
  async subscribe(handler: ActorEventHandler): Promise<() => Promise<void>> {
    // Create a new Redis client for subscribing (Redis requirement)
    const subscriber = this.redis.duplicate();
    
    await subscriber.subscribe(ActorEventBus.CHANNEL);
    
    subscriber.on('message', async (channel, message) => {
      if (channel === ActorEventBus.CHANNEL) {
        try {
          const event = JSON.parse(message) as ActorLifecycleEvent;
          await handler(event);
        } catch (error) {
          console.error('Error handling actor event:', error);
        }
      }
    });

    // Return unsubscribe function
    return async () => {
      await subscriber.unsubscribe(ActorEventBus.CHANNEL);
      subscriber.disconnect();
    };
  }
}

/**
 * In-memory event bus for testing (no Redis needed)
 */
export class InMemoryActorEventBus {
  private handlers: ActorEventHandler[] = [];

  async publish(event: ActorLifecycleEvent): Promise<void> {
    // Call all handlers asynchronously
    await Promise.all(
      this.handlers.map(handler => 
        Promise.resolve(handler(event)).catch(console.error)
      )
    );
  }

  async subscribe(handler: ActorEventHandler): Promise<() => Promise<void>> {
    this.handlers.push(handler);
    
    // Return unsubscribe function
    return async () => {
      const index = this.handlers.indexOf(handler);
      if (index > -1) {
        this.handlers.splice(index, 1);
      }
    };
  }
}
