// Mock data for development/demo purposes
import { ActorInfo, MetricsData, HealthStatus, JournalEntry } from '../types/loom';

export const mockActors: ActorInfo[] = [
  {
    id: 'order-processor-001',
    type: 'OrderProcessorActor',
    status: 'active',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    lastActiveAt: new Date(Date.now() - 1000).toISOString(),
    messageCount: 145,
    queueDepth: 3,
    poolPosition: 0,
  },
  {
    id: 'payment-handler-042',
    type: 'PaymentHandlerActor',
    status: 'active',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    lastActiveAt: new Date(Date.now() - 500).toISOString(),
    messageCount: 89,
    queueDepth: 7,
    poolPosition: 1,
  },
  {
    id: 'notification-service-003',
    type: 'NotificationActor',
    status: 'idle',
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    lastActiveAt: new Date(Date.now() - 300000).toISOString(),
    messageCount: 234,
    queueDepth: 0,
    poolPosition: 2,
  },
  {
    id: 'user-profile-manager-123',
    type: 'UserProfileActor',
    status: 'active',
    createdAt: new Date(Date.now() - 5400000).toISOString(),
    lastActiveAt: new Date(Date.now() - 2000).toISOString(),
    messageCount: 67,
    queueDepth: 2,
    poolPosition: 3,
  },
  {
    id: 'inventory-tracker-007',
    type: 'InventoryActor',
    status: 'idle',
    createdAt: new Date(Date.now() - 9000000).toISOString(),
    lastActiveAt: new Date(Date.now() - 600000).toISOString(),
    messageCount: 412,
    queueDepth: 0,
    poolPosition: 4,
  },
  {
    id: 'analytics-aggregator-099',
    type: 'AnalyticsActor',
    status: 'active',
    createdAt: new Date(Date.now() - 14400000).toISOString(),
    lastActiveAt: new Date(Date.now() - 100).toISOString(),
    messageCount: 1823,
    queueDepth: 15,
    poolPosition: 5,
  },
];

export const mockMetrics: MetricsData = {
  timestamp: new Date().toISOString(),
  actorPools: {
    totalActors: 6,
    activeActors: 4,
    idleActors: 2,
    evictedActors: 0,
    poolUtilization: 0.06,
  },
  messageQueues: {
    totalMessages: 2770,
    pendingMessages: 27,
    processingMessages: 4,
    completedMessages: 2735,
    failedMessages: 4,
    messagesPerSecond: 12.5,
  },
  locks: {
    activeLocks: 4,
    failedAcquisitions: 0,
  },
  traces: {
    totalTraces: 145,
    activeTraces: 12,
    averageEventCount: 8.3,
  },
};

export const mockHealth: HealthStatus = {
  status: 'healthy',
  timestamp: new Date().toISOString(),
  components: {
    actorPools: {
      status: 'healthy',
      details: { poolUtilization: 0.06 },
    },
    messageQueues: {
      status: 'healthy',
      details: { avgDepth: 4.5 },
    },
    locks: {
      status: 'healthy',
      details: { activeLocks: 4 },
    },
  },
};

export const mockJournalEntries: JournalEntry[] = [
  {
    id: 'journal-001',
    actorId: 'order-processor-001',
    type: 'message_received',
    timestamp: new Date(Date.now() - 5000).toISOString(),
    data: { messageId: 'msg-123', type: 'ProcessOrder', payload: { orderId: 'ORD-1234' } },
  },
  {
    id: 'journal-002',
    actorId: 'order-processor-001',
    type: 'state_updated',
    timestamp: new Date(Date.now() - 4800).toISOString(),
    duration: 45,
    data: { currentOrder: 'ORD-1234', status: 'processing' },
  },
  {
    id: 'journal-003',
    actorId: 'order-processor-001',
    type: 'activity_scheduled',
    timestamp: new Date(Date.now() - 4500).toISOString(),
    data: { activity: 'ValidateInventory', orderId: 'ORD-1234' },
  },
  {
    id: 'journal-004',
    actorId: 'order-processor-001',
    type: 'activity_completed',
    timestamp: new Date(Date.now() - 3200).toISOString(),
    duration: 1300,
    data: { activity: 'ValidateInventory', result: { valid: true, itemsAvailable: 5 } },
  },
  {
    id: 'journal-005',
    actorId: 'order-processor-001',
    type: 'activity_scheduled',
    timestamp: new Date(Date.now() - 3000).toISOString(),
    data: { activity: 'ChargePayment', orderId: 'ORD-1234', amount: 99.99 },
  },
  {
    id: 'journal-006',
    actorId: 'order-processor-001',
    type: 'activity_completed',
    timestamp: new Date(Date.now() - 1500).toISOString(),
    duration: 1500,
    data: { activity: 'ChargePayment', result: { success: true, transactionId: 'TXN-5678' } },
  },
  {
    id: 'journal-007',
    actorId: 'order-processor-001',
    type: 'state_updated',
    timestamp: new Date(Date.now() - 1000).toISOString(),
    duration: 20,
    data: { currentOrder: 'ORD-1234', status: 'completed', transactionId: 'TXN-5678' },
  },
];

// Simulate real-time updates
export function createMockStream() {
  const subscribers = {
    actors: new Set<(data: ActorInfo[]) => void>(),
    metrics: new Set<(data: MetricsData) => void>(),
    health: new Set<(data: HealthStatus) => void>(),
  };

  let actors = [...mockActors];
  
  // Simulate actor activity every 2 seconds
  setInterval(() => {
    actors = actors.map(actor => ({
      ...actor,
      messageCount: actor.messageCount + Math.floor(Math.random() * 3),
      queueDepth: Math.max(0, actor.queueDepth + Math.floor(Math.random() * 3) - 1),
      lastActiveAt: actor.status === 'active' 
        ? new Date().toISOString() 
        : actor.lastActiveAt,
    }));
    
    subscribers.actors.forEach(cb => cb(actors));
  }, 2000);

  // Simulate metrics update every second
  setInterval(() => {
    const updatedMetrics: MetricsData = {
      ...mockMetrics,
      timestamp: new Date().toISOString(),
      messageQueues: {
        ...mockMetrics.messageQueues,
        messagesPerSecond: Math.random() * 20,
        pendingMessages: Math.floor(Math.random() * 50),
      },
    };
    
    subscribers.metrics.forEach(cb => cb(updatedMetrics));
  }, 1000);

  return {
    subscribe: (channel: keyof typeof subscribers, callback: any) => {
      subscribers[channel].add(callback);
    },
    unsubscribe: (channel: keyof typeof subscribers, callback: any) => {
      subscribers[channel].delete(callback);
    },
  };
}
