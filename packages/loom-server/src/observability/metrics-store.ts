/**
 * Metrics Store - In-memory time-series metrics storage
 */

import type { ExecutionMetric, ActorMetrics, SystemMetrics } from './metrics-types';

export class MetricsStore {
  private executions: Map<string, ExecutionMetric> = new Map();
  private actorMetrics: Map<string, ActorMetrics> = new Map();
  private recentExecutions: ExecutionMetric[] = [];
  private maxRecentExecutions = 100;
  private startTime = Date.now();

  /**
   * Record execution start
   */
  recordExecutionStart(metric: ExecutionMetric): void {
    this.executions.set(metric.executionId, metric);
    this.updateActorMetrics(metric);
    this.addToRecent(metric);
  }

  /**
   * Record execution completion
   */
  recordExecutionComplete(executionId: string, duration: number, success: boolean, error?: string): void {
    const metric = this.executions.get(executionId);
    if (!metric) return;

    metric.status = success ? 'completed' : 'failed';
    metric.endTime = Date.now();
    metric.duration = duration;
    if (error) metric.error = error;

    this.updateActorMetrics(metric);
    this.addToRecent(metric);
  }

  /**
   * Get metrics for a specific actor
   */
  getActorMetrics(actorId: string): ActorMetrics | undefined {
    return this.actorMetrics.get(actorId);
  }

  /**
   * Get all actor metrics
   */
  getAllActorMetrics(): Record<string, ActorMetrics> {
    return Object.fromEntries(this.actorMetrics);
  }

  /**
   * Get recent executions
   */
  getRecentExecutions(limit: number = 50): ExecutionMetric[] {
    return this.recentExecutions.slice(0, limit);
  }

  /**
   * Get system-wide metrics
   */
  getSystemMetrics(): SystemMetrics {
    const activeExecutions = Array.from(this.executions.values()).filter(
      e => e.status === 'started'
    ).length;

    const mem = process.memoryUsage();

    return {
      uptime: Date.now() - this.startTime,
      totalExecutions: this.recentExecutions.length,
      activeExecutions,
      actorCount: this.actorMetrics.size,
      memory: {
        used: mem.heapUsed,
        total: mem.heapTotal,
        percentage: (mem.heapUsed / mem.heapTotal) * 100,
      },
      redis: {
        connected: true, // TODO: Get from actual Redis connection
      },
    };
  }

  /**
   * Update actor-level metrics
   */
  private updateActorMetrics(metric: ExecutionMetric): void {
    const actorId = metric.actorId;
    let actorMetric = this.actorMetrics.get(actorId);

    if (!actorMetric) {
      actorMetric = {
        actorId,
        executions: { total: 0, succeeded: 0, failed: 0, inProgress: 0 },
        performance: {
          avgDuration: 0,
          p50Duration: 0,
          p95Duration: 0,
          p99Duration: 0,
          minDuration: Infinity,
          maxDuration: 0,
        },
        errorRate: 0,
        recentExecutions: [],
      };
      this.actorMetrics.set(actorId, actorMetric);
    }

    // Update execution counts
    if (metric.status === 'started') {
      actorMetric.executions.total++;
      actorMetric.executions.inProgress++;
    } else if (metric.status === 'completed') {
      actorMetric.executions.succeeded++;
      actorMetric.executions.inProgress = Math.max(0, actorMetric.executions.inProgress - 1);
    } else if (metric.status === 'failed') {
      actorMetric.executions.failed++;
      actorMetric.executions.inProgress = Math.max(0, actorMetric.executions.inProgress - 1);
    }

    // Update performance metrics
    if (metric.duration !== undefined) {
      actorMetric.performance.minDuration = Math.min(
        actorMetric.performance.minDuration,
        metric.duration
      );
      actorMetric.performance.maxDuration = Math.max(
        actorMetric.performance.maxDuration,
        metric.duration
      );

      // Calculate percentiles from recent executions
      const durations = actorMetric.recentExecutions
        .filter(e => e.duration !== undefined)
        .map(e => e.duration!)
        .sort((a, b) => a - b);

      if (durations.length > 0) {
        actorMetric.performance.avgDuration =
          durations.reduce((a, b) => a + b, 0) / durations.length;
        actorMetric.performance.p50Duration = this.percentile(durations, 0.5);
        actorMetric.performance.p95Duration = this.percentile(durations, 0.95);
        actorMetric.performance.p99Duration = this.percentile(durations, 0.99);
      }
    }

    // Update error rate
    const total = actorMetric.executions.succeeded + actorMetric.executions.failed;
    actorMetric.errorRate = total > 0 ? (actorMetric.executions.failed / total) * 100 : 0;

    // Update last executed
    actorMetric.lastExecuted = metric.startTime;

    // Add to recent executions
    actorMetric.recentExecutions.unshift(metric);
    if (actorMetric.recentExecutions.length > 20) {
      actorMetric.recentExecutions.pop();
    }
  }

  /**
   * Add to recent executions list
   */
  private addToRecent(metric: ExecutionMetric): void {
    // Update existing or add new
    const existingIndex = this.recentExecutions.findIndex(
      e => e.executionId === metric.executionId
    );
    
    if (existingIndex >= 0) {
      this.recentExecutions[existingIndex] = metric;
    } else {
      this.recentExecutions.unshift(metric);
      if (this.recentExecutions.length > this.maxRecentExecutions) {
        this.recentExecutions.pop();
      }
    }
  }

  /**
   * Calculate percentile
   */
  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)] || 0;
  }

  /**
   * Clear old data (cleanup)
   */
  cleanup(maxAge: number = 3600000): void {
    const now = Date.now();
    const cutoff = now - maxAge;

    // Remove old executions
    for (const [id, metric] of this.executions) {
      if (metric.startTime < cutoff && metric.status !== 'started') {
        this.executions.delete(id);
      }
    }

    // Keep only recent executions
    this.recentExecutions = this.recentExecutions.filter(
      e => e.startTime > cutoff
    );
  }
}
