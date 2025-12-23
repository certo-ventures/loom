/**
 * Metrics Types - Observability data structures
 */

export interface ExecutionMetric {
  executionId: string;
  actorId: string;
  actorVersion?: string;
  status: 'started' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  duration?: number;
  error?: string;
  tenantId?: string;
  workflowId?: string;
}

export interface ActorMetrics {
  actorId: string;
  executions: {
    total: number;
    succeeded: number;
    failed: number;
    inProgress: number;
  };
  performance: {
    avgDuration: number;
    p50Duration: number;
    p95Duration: number;
    p99Duration: number;
    minDuration: number;
    maxDuration: number;
  };
  errorRate: number; // Percentage
  lastExecuted?: number; // Timestamp
  recentExecutions: ExecutionMetric[];
}

export interface SystemMetrics {
  uptime: number;
  totalExecutions: number;
  activeExecutions: number;
  actorCount: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  redis: {
    connected: boolean;
    latency?: number;
  };
}

export interface MetricsSnapshot {
  timestamp: number;
  system: SystemMetrics;
  actors: Record<string, ActorMetrics>;
  recentExecutions: ExecutionMetric[];
}

export interface MetricsEvent {
  type: 'execution.started' | 'execution.completed' | 'execution.failed' | 'metrics.snapshot';
  timestamp: number;
  data: ExecutionMetric | MetricsSnapshot;
}
