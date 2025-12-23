// Types for Loom Studio data
export interface ActorInfo {
  id: string;
  type: string;
  status: 'active' | 'idle' | 'evicted' | 'failed';
  createdAt: string;
  lastActiveAt: string;
  messageCount: number;
  queueDepth: number;
  poolPosition?: number;
}

export interface JournalEntry {
  id: string;
  actorId: string;
  type: 'state_updated' | 'activity_scheduled' | 'activity_completed' | 'activity_failed' | 'message_received';
  timestamp: string;
  duration?: number;
  data: any;
}

export interface TraceEvent {
  id: string;
  actorId: string;
  correlationId: string;
  parentTraceId?: string;
  eventType: string;
  timestamp: string;
  duration?: number;
  metadata?: Record<string, any>;
}

export interface MetricsData {
  timestamp: string;
  actorPools: {
    totalActors: number;
    activeActors: number;
    idleActors: number;
    evictedActors: number;
    poolUtilization: number;
  };
  messageQueues: {
    totalMessages: number;
    pendingMessages: number;
    processingMessages: number;
    completedMessages: number;
    failedMessages: number;
    messagesPerSecond: number;
  };
  locks: {
    activeLocks: number;
    failedAcquisitions: number;
  };
  traces: {
    totalTraces: number;
    activeTraces: number;
    averageEventCount: number;
  };
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  components: {
    actorPools: { status: string; details?: any };
    messageQueues: { status: string; details?: any };
    locks: { status: string; details?: any };
  };
}
