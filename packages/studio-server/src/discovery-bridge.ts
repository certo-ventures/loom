/**
 * Discovery Bridge - Connects Loom Core Discovery to Studio Server
 * 
 * This is THE missing piece that makes Studio actually work!
 * Integrates with Loom's ActorRegistry to discover and monitor real actors.
 */

import type { ActorRegistry, ActorRegistration } from '../../../src/discovery';

export interface StudioActor {
  id: string;
  type: string;
  status: 'active' | 'idle' | 'busy' | 'evicted';
  workerId: string;
  messageCount: number;
  queueDepth: number;
  lastHeartbeat: string;
  uptime: number;
  metadata?: Record<string, any>;
}

export interface DiscoveryBridgeOptions {
  /** How often to poll the registry (ms) */
  pollInterval?: number;
  /** Callback when actors change */
  onActorUpdate?: (actor: StudioActor) => void;
  /** Callback when actor is removed */
  onActorRemoved?: (actorId: string) => void;
  /** Whether to enable auto-cleanup of stale actors */
  autoCleanup?: boolean;
  /** Max age for stale actors (seconds) */
  maxAge?: number;
}

/**
 * Bridge between Loom's ActorRegistry and Studio Server
 */
export class DiscoveryBridge {
  private registry: ActorRegistry | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private actorCache = new Map<string, StudioActor>();
  private options: Required<DiscoveryBridgeOptions>;

  constructor(options: DiscoveryBridgeOptions = {}) {
    this.options = {
      pollInterval: options.pollInterval ?? 1000,
      onActorUpdate: options.onActorUpdate ?? (() => {}),
      onActorRemoved: options.onActorRemoved ?? (() => {}),
      autoCleanup: options.autoCleanup ?? true,
      maxAge: options.maxAge ?? 300,
    };
  }

  /**
   * Connect to Loom's ActorRegistry
   */
  connect(registry: ActorRegistry): void {
    if (this.registry) {
      this.disconnect();
    }

    this.registry = registry;
    this.startPolling();
    console.log('🔗 Discovery Bridge connected to ActorRegistry');
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.registry = null;
    console.log('🔌 Discovery Bridge disconnected');
  }

  /**
   * Get all actors (for Studio queries)
   */
  async getAllActors(): Promise<StudioActor[]> {
    if (!this.registry) {
      return Array.from(this.actorCache.values());
    }

    // In-memory registry doesn't have a getAll method, so we need to enhance it
    // For now, return cached actors
    return Array.from(this.actorCache.values());
  }

  /**
   * Get actor by ID
   */
  async getActor(actorId: string): Promise<StudioActor | undefined> {
    return this.actorCache.get(actorId);
  }

  /**
   * Get actors by type
   */
  async getActorsByType(actorType: string): Promise<StudioActor[]> {
    if (!this.registry) {
      return Array.from(this.actorCache.values()).filter(a => a.type === actorType);
    }

    const registrations = await this.registry.getByType(actorType);
    return registrations.map(r => this.convertToStudioActor(r));
  }

  /**
   * Start polling the registry for changes
   */
  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }

    this.pollTimer = setInterval(async () => {
      await this.pollRegistry();
    }, this.options.pollInterval);

    // Do initial poll immediately
    this.pollRegistry();
  }

  /**
   * Poll the registry and detect changes
   */
  private async pollRegistry(): Promise<void> {
    if (!this.registry) {
      return;
    }

    try {
      // Get all actors from the registry
      const allActors = await this.registry.getAll();
      
      // Track which actors we've seen
      const seenActors = new Set<string>();
      
      // Update or add actors
      for (const registration of allActors) {
        seenActors.add(registration.actorId);
        const studioActor = this.convertToStudioActor(registration);
        
        const existing = this.actorCache.get(registration.actorId);
        if (!existing) {
          // New actor discovered
          console.log(`✨ Discovered actor: ${registration.actorId} (${registration.actorType})`);
        }
        
        this.actorCache.set(registration.actorId, studioActor);
        this.options.onActorUpdate(studioActor);
      }
      
      // Remove actors that are no longer in registry
      for (const [actorId] of this.actorCache) {
        if (!seenActors.has(actorId)) {
          this.actorCache.delete(actorId);
          this.options.onActorRemoved(actorId);
          console.log(`👋 Actor removed: ${actorId}`);
        }
      }
      
      // Cleanup stale actors
      if (this.options.autoCleanup) {
        const cleaned = await this.registry.cleanup(this.options.maxAge * 1000);
        if (cleaned > 0) {
          console.log(`🧹 Cleaned ${cleaned} stale actors`);
        }
      }
    } catch (error) {
      console.error('❌ Error polling registry:', error);
    }
  }

  /**
   * Convert ActorRegistration to StudioActor
   */
  private convertToStudioActor(registration: ActorRegistration): StudioActor {
    const now = Date.now();
    const lastHeartbeat = new Date(registration.lastHeartbeat).getTime();
    const uptime = now - lastHeartbeat;

    return {
      id: registration.actorId,
      type: registration.actorType,
      status: registration.status === 'busy' ? 'active' : registration.status,
      workerId: registration.workerId,
      messageCount: registration.messageCount,
      queueDepth: 0, // TODO: Get from queue
      lastHeartbeat: registration.lastHeartbeat,
      uptime,
      metadata: registration.metadata,
    };
  }

  /**
   * Handle actor registration (called by Studio server)
   */
  async handleActorRegistered(actor: StudioActor): Promise<void> {
    const existing = this.actorCache.get(actor.id);
    this.actorCache.set(actor.id, actor);

    if (!existing) {
      console.log(`✨ New actor discovered: ${actor.id} (${actor.type})`);
    }

    this.options.onActorUpdate(actor);
  }

  /**
   * Handle actor update (called by Studio server)
   */
  async handleActorUpdated(actor: StudioActor): Promise<void> {
    this.actorCache.set(actor.id, actor);
    this.options.onActorUpdate(actor);
  }

  /**
   * Handle actor unregistration (called by Studio server)
   */
  async handleActorUnregistered(actorId: string): Promise<void> {
    const actor = this.actorCache.get(actorId);
    if (actor) {
      this.actorCache.delete(actorId);
      this.options.onActorRemoved(actorId);
      console.log(`👋 Actor removed: ${actorId}`);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalActors: number;
    activeActors: number;
    idleActors: number;
    busyActors: number;
    byType: Record<string, number>;
  } {
    const actors = Array.from(this.actorCache.values());
    const byType: Record<string, number> = {};

    for (const actor of actors) {
      byType[actor.type] = (byType[actor.type] || 0) + 1;
    }

    return {
      totalActors: actors.length,
      activeActors: actors.filter(a => a.status === 'active').length,
      idleActors: actors.filter(a => a.status === 'idle').length,
      busyActors: actors.filter(a => a.status === 'busy').length,
      byType,
    };
  }
}

/**
 * Singleton instance for easy access
 */
let bridgeInstance: DiscoveryBridge | null = null;

export function getDiscoveryBridge(): DiscoveryBridge {
  if (!bridgeInstance) {
    bridgeInstance = new DiscoveryBridge();
  }
  return bridgeInstance;
}
