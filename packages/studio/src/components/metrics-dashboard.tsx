import { Activity, TrendingUp, Clock, AlertTriangle } from 'lucide-react';
import { MetricsData } from '../types/loom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';

interface MetricsDashboardProps {
  metrics: MetricsData | null;
}

export function MetricsDashboard({ metrics }: MetricsDashboardProps) {
  if (!metrics) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center max-w-sm">
          <Activity className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold mb-2">No Metrics Available</h3>
          <p className="text-sm text-muted-foreground">
            Connect to Loom runtime to view real-time system metrics.
          </p>
        </div>
      </div>
    );
  }

  const { actorPools, messageQueues, locks, traces } = metrics;

  return (
    <div className="space-y-6">
      {/* Top-level Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pool Utilization</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(actorPools.poolUtilization * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              {actorPools.activeActors} active / {actorPools.totalActors} total
            </p>
            <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
              <div 
                className="h-full bg-primary transition-all"
                style={{ width: `${actorPools.poolUtilization * 100}%` }}
              ></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Message Throughput</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {messageQueues.messagesPerSecond.toFixed(1)}/s
            </div>
            <p className="text-xs text-muted-foreground">
              {messageQueues.completedMessages.toLocaleString()} completed
            </p>
            <Badge variant="success" className="mt-2">
              {messageQueues.pendingMessages} pending
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Locks</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {locks.activeLocks}
            </div>
            <p className="text-xs text-muted-foreground">
              {locks.failedAcquisitions} failed acquisitions
            </p>
            {locks.failedAcquisitions > 0 && (
              <Badge variant="warning" className="mt-2">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Contention detected
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Traces</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {traces.activeTraces}
            </div>
            <p className="text-xs text-muted-foreground">
              {traces.totalTraces} total traces
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Avg {traces.averageEventCount.toFixed(1)} events/trace
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Stats */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Actor Pools */}
        <Card>
          <CardHeader>
            <CardTitle>Actor Pool Status</CardTitle>
            <CardDescription>Distribution of actors by state</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-green-500"></div>
                  <span className="text-sm">Active</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{actorPools.activeActors}</span>
                  <span className="text-xs text-muted-foreground">
                    ({((actorPools.activeActors / actorPools.totalActors) * 100).toFixed(0)}%)
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-yellow-500"></div>
                  <span className="text-sm">Idle</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{actorPools.idleActors}</span>
                  <span className="text-xs text-muted-foreground">
                    ({((actorPools.idleActors / actorPools.totalActors) * 100).toFixed(0)}%)
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-gray-500"></div>
                  <span className="text-sm">Evicted</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{actorPools.evictedActors}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Message Queues */}
        <Card>
          <CardHeader>
            <CardTitle>Message Queue Status</CardTitle>
            <CardDescription>Message processing breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-yellow-500"></div>
                  <span className="text-sm">Pending</span>
                </div>
                <span className="text-sm font-medium">
                  {messageQueues.pendingMessages.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-blue-500"></div>
                  <span className="text-sm">Processing</span>
                </div>
                <span className="text-sm font-medium">
                  {messageQueues.processingMessages.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-green-500"></div>
                  <span className="text-sm">Completed</span>
                </div>
                <span className="text-sm font-medium">
                  {messageQueues.completedMessages.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-500"></div>
                  <span className="text-sm">Failed</span>
                </div>
                <span className="text-sm font-medium">
                  {messageQueues.failedMessages.toLocaleString()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance Insights */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Insights</CardTitle>
          <CardDescription>System health and recommendations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {actorPools.poolUtilization > 0.8 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">High Pool Utilization</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Consider increasing actor pool size or scaling horizontally
                  </p>
                </div>
              </div>
            )}
            
            {messageQueues.failedMessages / messageQueues.totalMessages > 0.05 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">High Message Failure Rate</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {((messageQueues.failedMessages / messageQueues.totalMessages) * 100).toFixed(1)}% of messages are failing. Check error logs.
                  </p>
                </div>
              </div>
            )}

            {locks.failedAcquisitions > 10 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Lock Contention Detected</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Multiple instances competing for actor locks. Review actor distribution.
                  </p>
                </div>
              </div>
            )}

            {actorPools.poolUtilization < 0.8 && 
             messageQueues.failedMessages / messageQueues.totalMessages < 0.05 && 
             locks.failedAcquisitions <= 10 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <Activity className="h-5 w-5 text-green-500 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">System Running Smoothly</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    All metrics within normal range. No issues detected.
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
