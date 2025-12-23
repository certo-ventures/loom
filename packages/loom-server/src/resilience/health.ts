/**
 * Health Checks - Monitor system components
 */

import type { Redis } from 'ioredis';
import type { CosmosClient } from '@azure/cosmos';
import type { HealthCheck, ComponentHealth } from '../types';

export class HealthChecker {
  constructor(
    private redis: Redis,
    private cosmos?: CosmosClient
  ) {}

  async check(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    // Check all components in parallel
    const [redisHealth, cosmosHealth] = await Promise.all([
      this.checkRedis(),
      this.checkCosmos()
    ]);

    // Memory usage
    const memUsage = process.memoryUsage();
    const memory = {
      used: memUsage.heapUsed,
      total: memUsage.heapTotal,
      percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100
    };

    // Overall status
    const allHealthy = redisHealth.status === 'healthy' && cosmosHealth.status === 'healthy';
    const anyUnhealthy = redisHealth.status === 'unhealthy' || cosmosHealth.status === 'unhealthy';
    
    const status = anyUnhealthy ? 'unhealthy' : 
                   allHealthy ? 'healthy' : 'degraded';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      components: {
        redis: redisHealth,
        cosmos: cosmosHealth,
        wasmCache: { status: 'healthy' }  // TODO: Implement
      },
      memory
    };
  }

  private async checkRedis(): Promise<ComponentHealth> {
    try {
      const start = Date.now();
      await this.redis.ping();
      const latency = Date.now() - start;
      
      return {
        status: latency < 100 ? 'healthy' : 'degraded',
        latency
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        message: error.message
      };
    }
  }

  private async checkCosmos(): Promise<ComponentHealth> {
    if (!this.cosmos) {
      return {
        status: 'healthy',
        message: 'Using in-memory storage'
      };
    }

    try {
      const start = Date.now();
      // Simple read operation
      await this.cosmos.getDatabaseAccount();
      const latency = Date.now() - start;
      
      return {
        status: latency < 500 ? 'healthy' : 'degraded',
        latency
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        message: error.message
      };
    }
  }
}
