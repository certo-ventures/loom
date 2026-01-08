/**
 * State Service - Wraps Redis state management
 */

import Redis from 'ioredis'
import { logger } from '../utils/logger'

export class StateService {
  constructor(private redis: Redis) {}
  
  async getActorState(actorId: string, tenantId: string): Promise<any> {
    const key = this.getStateKey(actorId, tenantId)
    const data = await this.redis.get(key)
    
    if (!data) {
      return null
    }
    
    try {
      return JSON.parse(data)
    } catch (error) {
      logger.error('Failed to parse actor state', { actorId, tenantId, error })
      return null
    }
  }
  
  async setActorState(actorId: string, state: any, tenantId: string): Promise<void> {
    const key = this.getStateKey(actorId, tenantId)
    const data = JSON.stringify(state)
    
    await this.redis.set(key, data)
    logger.debug('Set actor state', { actorId, tenantId })
  }
  
  async updateActorState(actorId: string, updates: any, tenantId: string): Promise<any> {
    const currentState = await this.getActorState(actorId, tenantId) || {}
    const newState = { ...currentState, ...updates }
    
    await this.setActorState(actorId, newState, tenantId)
    return newState
  }
  
  async deleteActorState(actorId: string, tenantId: string): Promise<void> {
    const key = this.getStateKey(actorId, tenantId)
    await this.redis.del(key)
    logger.info('Deleted actor state', { actorId, tenantId })
  }
  
  async createSnapshot(actorId: string, tenantId: string): Promise<string> {
    const state = await this.getActorState(actorId, tenantId)
    const snapshotId = `snapshot-${Date.now()}`
    const key = this.getSnapshotKey(actorId, snapshotId, tenantId)
    
    await this.redis.set(key, JSON.stringify(state))
    await this.redis.expire(key, 86400 * 30) // 30 days TTL
    
    logger.info('Created snapshot', { actorId, snapshotId, tenantId })
    return snapshotId
  }
  
  async listSnapshots(actorId: string, tenantId: string): Promise<string[]> {
    const pattern = `state:${tenantId}:${actorId}:snapshot:*`
    const keys = await this.redis.keys(pattern)
    
    return keys.map(key => {
      const parts = key.split(':')
      return parts[parts.length - 1]
    })
  }
  
  async restoreSnapshot(actorId: string, snapshotId: string, tenantId: string): Promise<any> {
    const key = this.getSnapshotKey(actorId, snapshotId, tenantId)
    const data = await this.redis.get(key)
    
    if (!data) {
      throw new Error(`Snapshot ${snapshotId} not found`)
    }
    
    const state = JSON.parse(data)
    await this.setActorState(actorId, state, tenantId)
    
    logger.info('Restored snapshot', { actorId, snapshotId, tenantId })
    return state
  }
  
  async queryState(filters: {
    pattern?: string
    tenantId: string
  }): Promise<Array<{ actorId: string; state: any }>> {
    const pattern = filters.pattern || `state:${filters.tenantId}:*`
    const keys = await this.redis.keys(pattern)
    
    const results: Array<{ actorId: string; state: any }> = []
    
    for (const key of keys) {
      const parts = key.split(':')
      const actorId = parts[2]
      
      const data = await this.redis.get(key)
      if (data) {
        try {
          results.push({
            actorId,
            state: JSON.parse(data)
          })
        } catch (error) {
          logger.error('Failed to parse state', { key, error })
        }
      }
    }
    
    return results
  }
  
  async getAggregateMetrics(tenantId: string): Promise<{
    totalActors: number
    totalStateSize: number
    averageStateSize: number
  }> {
    const pattern = `state:${tenantId}:*`
    const keys = await this.redis.keys(pattern)
    
    let totalSize = 0
    
    for (const key of keys) {
      const data = await this.redis.get(key)
      if (data) {
        totalSize += data.length
      }
    }
    
    return {
      totalActors: keys.length,
      totalStateSize: totalSize,
      averageStateSize: keys.length > 0 ? Math.round(totalSize / keys.length) : 0
    }
  }
  
  private getStateKey(actorId: string, tenantId: string): string {
    return `state:${tenantId}:${actorId}`
  }
  
  private getSnapshotKey(actorId: string, snapshotId: string, tenantId: string): string {
    return `state:${tenantId}:${actorId}:snapshot:${snapshotId}`
  }
}
