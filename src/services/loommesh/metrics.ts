/**
 * LoomMesh Metrics
 * 
 * Comprehensive metrics collection for LoomMesh service including:
 * - Peer connectivity metrics
 * - Node count estimation
 * - Disk usage tracking
 * - Sync latency sampling
 * - Prometheus-compatible export
 */

import type { ServiceMetrics } from '../service.js'

/**
 * Detailed LoomMesh metrics
 */
export interface LoomMeshMetrics extends ServiceMetrics {
  // Peer metrics
  connectedPeers: number
  totalPeers: number
  disconnectedPeers?: number
  peersWithErrors?: number
  averagePeerRetryCount?: number
  
  // Node estimation (based on peer gossip)
  estimatedNetworkNodes?: number
  
  // Storage metrics
  storageType?: string
  diskUsageBytes?: number
  diskUsageMB?: number
  
  // Sync metrics (sampled)
  syncLatencyMs?: number
  syncLatencySamples?: number
  syncLatencyP50?: number
  syncLatencyP95?: number
  syncLatencyP99?: number
  lastSyncTime?: number
  
  // Operation metrics
  readOperations?: number
  writeOperations?: number
  
  // Server metrics
  serverEnabled?: boolean
  serverPort?: number
  serverHost?: string
  
  // Health indicators
  healthStatus?: 'healthy' | 'degraded' | 'unhealthy'
  healthMessage?: string
}

/**
 * Prometheus metric types
 */
type PrometheusMetricType = 'gauge' | 'counter' | 'histogram' | 'summary'

interface PrometheusMetric {
  name: string
  type: PrometheusMetricType
  help: string
  value: number
  labels?: Record<string, string>
}

/**
 * Sync latency tracker
 */
export class SyncLatencyTracker {
  private samples: number[] = []
  private maxSamples: number
  private totalOperations = 0

  constructor(maxSamples = 100) {
    this.maxSamples = maxSamples
  }

  /**
   * Record a sync operation latency
   */
  recordLatency(latencyMs: number): void {
    this.samples.push(latencyMs)
    this.totalOperations++
    
    // Keep only last N samples
    if (this.samples.length > this.maxSamples) {
      this.samples.shift()
    }
  }

  /**
   * Get average latency from samples
   */
  getAverageLatency(): number | undefined {
    if (this.samples.length === 0) return undefined
    
    const sum = this.samples.reduce((a, b) => a + b, 0)
    return sum / this.samples.length
  }

  /**
   * Get sample count
   */
  getSampleCount(): number {
    return this.samples.length
  }

  /**
   * Get total operations
   */
  getTotalOperations(): number {
    return this.totalOperations
  }

  /**
   * Get percentile (e.g., 95 for p95)
   */
  getPercentile(percentile: number): number | undefined {
    if (percentile < 0 || percentile > 100) return undefined
    if (this.samples.length === 0) return undefined
    
    const sorted = [...this.samples].sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }

  /**
   * Reset samples
   */
  reset(): void {
    this.samples = []
  }
}

/**
 * Prometheus metrics formatter
 */
export class PrometheusMetricsFormatter {
  private serviceName: string

  constructor(serviceName = 'loommesh') {
    this.serviceName = serviceName
  }

  /**
   * Format metrics in Prometheus exposition format
   * See: https://prometheus.io/docs/instrumenting/exposition_formats/
   */
  format(metrics: LoomMeshMetrics): string {
    const lines: string[] = []
    
    // Health status
    if (metrics.healthStatus) {
      lines.push(`# TYPE ${this.serviceName}_health gauge`)
      lines.push(`# HELP ${this.serviceName}_health Health status of the service (1=healthy, 0.5=degraded, 0=unhealthy)`)
      lines.push(`${this.serviceName}_health{status="${metrics.healthStatus}"} 1`)
    }
    
    // Peer metrics
    lines.push(`# TYPE ${this.serviceName}_peers_connected gauge`)
    lines.push(`# HELP ${this.serviceName}_peers_connected Number of currently connected peers`)
    lines.push(`${this.serviceName}_peers_connected ${metrics.connectedPeers ?? 0}`)
    
    lines.push(`# TYPE ${this.serviceName}_peers_total gauge`)
    lines.push(`# HELP ${this.serviceName}_peers_total Total number of configured peers`)
    lines.push(`${this.serviceName}_peers_total ${metrics.totalPeers ?? 0}`)
    
    if (metrics.disconnectedPeers !== undefined) {
      lines.push(`# TYPE ${this.serviceName}_peers_disconnected gauge`)
      lines.push(`# HELP ${this.serviceName}_peers_disconnected Number of disconnected peers`)
      lines.push(`${this.serviceName}_peers_disconnected ${metrics.disconnectedPeers}`)
    }
    
    if (metrics.peersWithErrors !== undefined) {
      lines.push(`# TYPE ${this.serviceName}_peers_with_errors gauge`)
      lines.push(`# HELP ${this.serviceName}_peers_with_errors Number of peers with connection errors`)
      lines.push(`${this.serviceName}_peers_with_errors ${metrics.peersWithErrors}`)
    }
    
    // Estimated network nodes
    if (metrics.estimatedNetworkNodes !== undefined) {
      lines.push(`# TYPE ${this.serviceName}_network_nodes_estimated gauge`)
      lines.push(`# HELP ${this.serviceName}_network_nodes_estimated Estimated number of nodes in the network`)
      lines.push(`${this.serviceName}_network_nodes_estimated ${metrics.estimatedNetworkNodes}`)
    }
    
    // Disk usage
    if (metrics.diskUsageBytes !== undefined) {
      lines.push(`# TYPE ${this.serviceName}_disk_usage_bytes gauge`)
      lines.push(`# HELP ${this.serviceName}_disk_usage_bytes Disk space used by LoomMesh storage in bytes`)
      lines.push(`${this.serviceName}_disk_usage_bytes ${metrics.diskUsageBytes}`)
    }
    
    // Sync latency
    if (metrics.syncLatencyMs !== undefined || metrics.syncLatencyP50 !== undefined || 
        metrics.syncLatencyP95 !== undefined || metrics.syncLatencyP99 !== undefined) {
      lines.push(`# TYPE ${this.serviceName}_sync_latency_ms gauge`)
      lines.push(`# HELP ${this.serviceName}_sync_latency_ms Sync operation latency in milliseconds`)
      
      if (metrics.syncLatencyMs !== undefined) {
        lines.push(`${this.serviceName}_sync_latency_ms{metric="average"} ${metrics.syncLatencyMs}`)
      }
      if (metrics.syncLatencyP50 !== undefined) {
        lines.push(`${this.serviceName}_sync_latency_ms{metric="p50"} ${metrics.syncLatencyP50}`)
      }
      if (metrics.syncLatencyP95 !== undefined) {
        lines.push(`${this.serviceName}_sync_latency_ms{metric="p95"} ${metrics.syncLatencyP95}`)
      }
      if (metrics.syncLatencyP99 !== undefined) {
        lines.push(`${this.serviceName}_sync_latency_ms{metric="p99"} ${metrics.syncLatencyP99}`)
      }
    }
    
    // Operation counts
    if (metrics.readOperations !== undefined || metrics.writeOperations !== undefined) {
      lines.push(`# TYPE ${this.serviceName}_operations_total counter`)
      lines.push(`# HELP ${this.serviceName}_operations_total Total number of operations by type`)
      
      if (metrics.readOperations !== undefined) {
        lines.push(`${this.serviceName}_operations_total{operation="read"} ${metrics.readOperations}`)
      }
      if (metrics.writeOperations !== undefined) {
        lines.push(`${this.serviceName}_operations_total{operation="write"} ${metrics.writeOperations}`)
      }
    }
    
    return lines.join('\n')
  }
}

/**
 * Operation counter for tracking reads/writes
 */
export class OperationCounter {
  private readCount = 0
  private writeCount = 0

  recordRead(): void {
    this.readCount++
  }

  recordWrite(): void {
    this.writeCount++
  }

  getReadCount(): number {
    return this.readCount
  }

  getWriteCount(): number {
    return this.writeCount
  }

  reset(): void {
    this.readCount = 0
    this.writeCount = 0
  }
}
