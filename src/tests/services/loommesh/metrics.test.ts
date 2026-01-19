/**
 * Tests for LoomMesh metrics system
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SyncLatencyTracker,
  PrometheusMetricsFormatter,
  OperationCounter,
  type LoomMeshMetrics
} from '../../../services/loommesh/metrics.js'

describe('SyncLatencyTracker', () => {
  let tracker: SyncLatencyTracker

  beforeEach(() => {
    tracker = new SyncLatencyTracker()
  })

  it('should start with no latency data', () => {
    expect(tracker.getAverageLatency()).toBeUndefined()
    expect(tracker.getPercentile(50)).toBeUndefined()
  })

  it('should record and calculate average latency', () => {
    tracker.recordLatency(10)
    tracker.recordLatency(20)
    tracker.recordLatency(30)

    expect(tracker.getAverageLatency()).toBe(20)
  })

  it('should calculate percentiles correctly', () => {
    // Add 100 samples from 1-100ms
    for (let i = 1; i <= 100; i++) {
      tracker.recordLatency(i)
    }

    // p50 should be around 50
    const p50 = tracker.getPercentile(50)
    expect(p50).toBeGreaterThanOrEqual(49)
    expect(p50).toBeLessThanOrEqual(51)

    // p95 should be around 95
    const p95 = tracker.getPercentile(95)
    expect(p95).toBeGreaterThanOrEqual(94)
    expect(p95).toBeLessThanOrEqual(96)

    // p99 should be around 99
    const p99 = tracker.getPercentile(99)
    expect(p99).toBeGreaterThanOrEqual(98)
    expect(p99).toBeLessThanOrEqual(100)
  })

  it('should limit samples to maxSamples', () => {
    const smallTracker = new SyncLatencyTracker(10)

    // Add 20 samples
    for (let i = 1; i <= 20; i++) {
      smallTracker.recordLatency(i)
    }

    // Should only keep last 10 (11-20)
    const avg = smallTracker.getAverageLatency()
    expect(avg).toBeGreaterThan(10) // Should be > 10 since first 10 were dropped
    expect(avg).toBeLessThanOrEqual(20)
  })

  it('should handle single sample', () => {
    tracker.recordLatency(42)

    expect(tracker.getAverageLatency()).toBe(42)
    expect(tracker.getPercentile(50)).toBe(42)
    expect(tracker.getPercentile(95)).toBe(42)
    expect(tracker.getPercentile(99)).toBe(42)
  })

  it('should handle edge percentiles', () => {
    for (let i = 1; i <= 10; i++) {
      tracker.recordLatency(i)
    }

    expect(tracker.getPercentile(0)).toBe(1)
    expect(tracker.getPercentile(100)).toBe(10)
  })

  it('should return undefined percentile for invalid input', () => {
    tracker.recordLatency(10)

    expect(tracker.getPercentile(-1)).toBeUndefined()
    expect(tracker.getPercentile(101)).toBeUndefined()
  })
})

describe('OperationCounter', () => {
  let counter: OperationCounter

  beforeEach(() => {
    counter = new OperationCounter()
  })

  it('should start with zero counts', () => {
    expect(counter.getReadCount()).toBe(0)
    expect(counter.getWriteCount()).toBe(0)
  })

  it('should count read operations', () => {
    counter.recordRead()
    counter.recordRead()
    counter.recordRead()

    expect(counter.getReadCount()).toBe(3)
    expect(counter.getWriteCount()).toBe(0)
  })

  it('should count write operations', () => {
    counter.recordWrite()
    counter.recordWrite()

    expect(counter.getReadCount()).toBe(0)
    expect(counter.getWriteCount()).toBe(2)
  })

  it('should count both read and write operations', () => {
    counter.recordRead()
    counter.recordWrite()
    counter.recordRead()
    counter.recordWrite()
    counter.recordWrite()

    expect(counter.getReadCount()).toBe(2)
    expect(counter.getWriteCount()).toBe(3)
  })

  it('should reset counts', () => {
    counter.recordRead()
    counter.recordWrite()
    counter.recordRead()

    counter.reset()

    expect(counter.getReadCount()).toBe(0)
    expect(counter.getWriteCount()).toBe(0)
  })

  it('should handle large counts', () => {
    for (let i = 0; i < 1000000; i++) {
      counter.recordRead()
    }

    expect(counter.getReadCount()).toBe(1000000)
  })
})

describe('PrometheusMetricsFormatter', () => {
  let formatter: PrometheusMetricsFormatter

  beforeEach(() => {
    formatter = new PrometheusMetricsFormatter('loommesh')
  })

  it('should format basic metrics', () => {
    const metrics: LoomMeshMetrics = {
      connectedPeers: 2,
      totalPeers: 3,
      healthStatus: 'healthy'
    }

    const output = formatter.format(metrics)

    expect(output).toContain('# TYPE loommesh_peers_connected gauge')
    expect(output).toContain('loommesh_peers_connected 2')
    expect(output).toContain('# TYPE loommesh_peers_total gauge')
    expect(output).toContain('loommesh_peers_total 3')
    expect(output).toContain('# TYPE loommesh_health gauge')
    expect(output).toContain('loommesh_health{status="healthy"} 1')
  })

  it('should format disk usage', () => {
    const metrics: LoomMeshMetrics = {
      connectedPeers: 0,
      totalPeers: 0,
      healthStatus: 'healthy',
      diskUsageBytes: 1048576 // 1 MB
    }

    const output = formatter.format(metrics)

    expect(output).toContain('# TYPE loommesh_disk_usage_bytes gauge')
    expect(output).toContain('loommesh_disk_usage_bytes 1048576')
  })

  it('should format sync latency metrics', () => {
    const metrics: LoomMeshMetrics = {
      connectedPeers: 0,
      totalPeers: 0,
      healthStatus: 'healthy',
      syncLatencyMs: 25.5,
      syncLatencyP50: 20,
      syncLatencyP95: 45,
      syncLatencyP99: 50
    }

    const output = formatter.format(metrics)

    expect(output).toContain('# TYPE loommesh_sync_latency_ms gauge')
    expect(output).toContain('loommesh_sync_latency_ms{metric="average"} 25.5')
    expect(output).toContain('loommesh_sync_latency_ms{metric="p50"} 20')
    expect(output).toContain('loommesh_sync_latency_ms{metric="p95"} 45')
    expect(output).toContain('loommesh_sync_latency_ms{metric="p99"} 50')
  })

  it('should format operation counts', () => {
    const metrics: LoomMeshMetrics = {
      connectedPeers: 0,
      totalPeers: 0,
      healthStatus: 'healthy',
      readOperations: 1000,
      writeOperations: 250
    }

    const output = formatter.format(metrics)

    expect(output).toContain('# TYPE loommesh_operations_total counter')
    expect(output).toContain('loommesh_operations_total{operation="read"} 1000')
    expect(output).toContain('loommesh_operations_total{operation="write"} 250')
  })

  it('should format estimated network nodes', () => {
    const metrics: LoomMeshMetrics = {
      connectedPeers: 0,
      totalPeers: 0,
      healthStatus: 'healthy',
      estimatedNetworkNodes: 15
    }

    const output = formatter.format(metrics)

    expect(output).toContain('# TYPE loommesh_network_nodes_estimated gauge')
    expect(output).toContain('loommesh_network_nodes_estimated 15')
  })

  it('should format all health statuses', () => {
    const statuses: Array<'healthy' | 'degraded' | 'unhealthy'> = ['healthy', 'degraded', 'unhealthy']

    for (const status of statuses) {
      const metrics: LoomMeshMetrics = {
        connectedPeers: 0,
        totalPeers: 0,
        healthStatus: status
      }

      const output = formatter.format(metrics)
      expect(output).toContain(`loommesh_health{status="${status}"} 1`)
    }
  })

  it('should format comprehensive metrics', () => {
    const metrics: LoomMeshMetrics = {
      connectedPeers: 5,
      totalPeers: 8,
      healthStatus: 'degraded',
      estimatedNetworkNodes: 12,
      diskUsageBytes: 2097152,
      syncLatencyMs: 30,
      syncLatencyP50: 25,
      syncLatencyP95: 50,
      syncLatencyP99: 75,
      readOperations: 5000,
      writeOperations: 1500
    }

    const output = formatter.format(metrics)

    // Verify all metric types are present
    expect(output).toContain('# TYPE loommesh_peers_connected gauge')
    expect(output).toContain('# TYPE loommesh_peers_total gauge')
    expect(output).toContain('# TYPE loommesh_health gauge')
    expect(output).toContain('# TYPE loommesh_network_nodes_estimated gauge')
    expect(output).toContain('# TYPE loommesh_disk_usage_bytes gauge')
    expect(output).toContain('# TYPE loommesh_sync_latency_ms gauge')
    expect(output).toContain('# TYPE loommesh_operations_total counter')

    // Verify all values are present
    expect(output).toContain('loommesh_peers_connected 5')
    expect(output).toContain('loommesh_peers_total 8')
    expect(output).toContain('loommesh_health{status="degraded"} 1')
    expect(output).toContain('loommesh_network_nodes_estimated 12')
    expect(output).toContain('loommesh_disk_usage_bytes 2097152')
    expect(output).toContain('loommesh_sync_latency_ms{metric="average"} 30')
    expect(output).toContain('loommesh_operations_total{operation="read"} 5000')
    expect(output).toContain('loommesh_operations_total{operation="write"} 1500')
  })

  it('should use custom prefix', () => {
    const customFormatter = new PrometheusMetricsFormatter('custom_prefix')
    const metrics: LoomMeshMetrics = {
      connectedPeers: 1,
      totalPeers: 1,
      healthStatus: 'healthy'
    }

    const output = customFormatter.format(metrics)

    expect(output).toContain('custom_prefix_peers_connected')
    expect(output).toContain('custom_prefix_peers_total')
    expect(output).toContain('custom_prefix_health')
  })

  it('should produce valid Prometheus format', () => {
    const metrics: LoomMeshMetrics = {
      connectedPeers: 3,
      totalPeers: 5,
      healthStatus: 'healthy',
      diskUsageBytes: 1000,
      readOperations: 100,
      writeOperations: 50
    }

    const output = formatter.format(metrics)

    // Check format rules
    const lines = output.trim().split('\n')
    for (const line of lines) {
      if (line.startsWith('#')) {
        // Comment lines should be TYPE or HELP
        expect(line).toMatch(/^# (TYPE|HELP) /)
      } else {
        // Metric lines should have format: name{labels} value or name value
        expect(line).toMatch(/^[a-z_]+(\{[^}]+\})? \d+(\.\d+)?$/)
      }
    }
  })

  it('should handle missing optional metrics', () => {
    const metrics: LoomMeshMetrics = {
      connectedPeers: 0,
      totalPeers: 0,
      healthStatus: 'healthy'
      // No optional metrics
    }

    const output = formatter.format(metrics)

    // Should not contain optional metrics
    expect(output).not.toContain('loommesh_disk_usage_bytes')
    expect(output).not.toContain('loommesh_sync_latency_ms')
    expect(output).not.toContain('loommesh_operations_total')
    expect(output).not.toContain('loommesh_network_nodes_estimated')

    // Should still contain required metrics
    expect(output).toContain('loommesh_peers_connected')
    expect(output).toContain('loommesh_health')
  })
})
