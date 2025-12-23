/**
 * Metrics Collector - Collects and broadcasts execution metrics
 */

import type { ExecutionMetric, MetricsEvent, MetricsSnapshot } from './metrics-types';
import { MetricsStore } from './metrics-store';
import { EventEmitter } from 'events';

export class MetricsCollector extends EventEmitter {
  private store = new MetricsStore();
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    super();
    
    // Cleanup old metrics every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.store.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Record execution start
   */
  recordExecutionStart(
    executionId: string,
    actorId: string,
    options?: {
      actorVersion?: string;
      tenantId?: string;
      workflowId?: string;
    }
  ): void {
    const metric: ExecutionMetric = {
      executionId,
      actorId,
      actorVersion: options?.actorVersion,
      status: 'started',
      startTime: Date.now(),
      tenantId: options?.tenantId,
      workflowId: options?.workflowId,
    };

    this.store.recordExecutionStart(metric);

    // Broadcast event
    this.emit('metric', {
      type: 'execution.started',
      timestamp: Date.now(),
      data: metric,
    } as MetricsEvent);
  }

  /**
   * Record execution completion
   */
  recordExecutionComplete(
    executionId: string,
    duration: number,
    success: boolean,
    error?: string
  ): void {
    this.store.recordExecutionComplete(executionId, duration, success, error);

    // Get updated metric
    const recentExecutions = this.store.getRecentExecutions(1);
    const metric = recentExecutions[0];

    if (metric) {
      this.emit('metric', {
        type: success ? 'execution.completed' : 'execution.failed',
        timestamp: Date.now(),
        data: metric,
      } as MetricsEvent);
    }
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): MetricsSnapshot {
    return {
      timestamp: Date.now(),
      system: this.store.getSystemMetrics(),
      actors: this.store.getAllActorMetrics(),
      recentExecutions: this.store.getRecentExecutions(50),
    };
  }

  /**
   * Get actor-specific metrics
   */
  getActorMetrics(actorId: string) {
    return this.store.getActorMetrics(actorId);
  }

  /**
   * Broadcast snapshot to all listeners
   */
  broadcastSnapshot(): void {
    const snapshot = this.getSnapshot();
    this.emit('metric', {
      type: 'metrics.snapshot',
      timestamp: Date.now(),
      data: snapshot,
    } as MetricsEvent);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.removeAllListeners();
  }
}
