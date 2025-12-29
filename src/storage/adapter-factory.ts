/**
 * Adapter Factory - Configuration-based adapter instantiation
 * 
 * Enables selecting adapters via configuration without code changes.
 */

import type { MessageQueue } from './message-queue'
import type { StateStore } from './state-store'
import type { CoordinationAdapter } from './coordination-adapter'
import type { BlobStore } from './blob-store'
import type { JournalStore } from './journal-store'
import { InMemoryMessageQueue } from './in-memory-message-queue'
import { InMemoryStateStore } from './in-memory-state-store'
import { InMemoryCoordinationAdapter } from './in-memory-coordination-adapter'
import { InMemoryBlobStore } from './in-memory-blob-store'
import { InMemoryJournalStore } from './in-memory-journal-store'

/**
 * Adapter configuration
 */
export interface AdapterConfig {
  messageQueue?: {
    type: 'bullmq' | 'inmemory'
    redis?: { host: string; port: number }
  }
  
  stateStore?: {
    type: 'cosmos' | 'inmemory'
    cosmos?: { endpoint: string; database: string }
  }
  
  coordinationAdapter?: {
    type: 'redis' | 'inmemory'
    redis?: { host: string; port: number }
  }
  
  blobStore?: {
    type: 'azure' | 'inmemory'
    azure?: { storageAccountUrl: string; container: string }
  }
  
  journalStore?: {
    type: 'redis' | 'inmemory'
    redis?: { host: string; port: number }
  }
}

/**
 * Factory for creating adapters from configuration
 */
export class AdapterFactory {
  /**
   * Create MessageQueue adapter
   */
  static createMessageQueue(config?: AdapterConfig['messageQueue']): MessageQueue {
    if (!config || config.type === 'inmemory') {
      return new InMemoryMessageQueue()
    }
    
    if (config.type === 'bullmq') {
      // Lazy load to avoid Redis dependency in dev mode
      const { BullMQMessageQueue } = require('./bullmq-message-queue')
      const Redis = require('ioredis')
      const redis = new Redis(config.redis || { host: 'localhost', port: 6379 })
      return new BullMQMessageQueue(redis)
    }
    
    throw new Error(`Unknown MessageQueue type: ${config.type}`)
  }
  
  /**
   * Create StateStore adapter
   */
  static createStateStore(config?: AdapterConfig['stateStore']): StateStore {
    if (!config || config.type === 'inmemory') {
      return new InMemoryStateStore()
    }
    
    if (config.type === 'cosmos') {
      const { CosmosStateStore } = require('./cosmos-state-store')
      const { CosmosClient } = require('@azure/cosmos')
      const { DefaultAzureCredential } = require('@azure/identity')
      
      if (!config.cosmos) {
        throw new Error('Cosmos configuration required for cosmos StateStore')
      }
      
      const client = new CosmosClient({
        endpoint: config.cosmos.endpoint,
        aadCredentials: new DefaultAzureCredential(),
      })
      
      return new CosmosStateStore(client, config.cosmos.database, 'actors')
    }
    
    throw new Error(`Unknown StateStore type: ${config.type}`)
  }
  
  /**
   * Create CoordinationAdapter (optional)
   */
  static createCoordinationAdapter(
    config?: AdapterConfig['coordinationAdapter']
  ): CoordinationAdapter | undefined {
    if (!config) {
      return undefined // Coordination is optional
    }
    
    if (config.type === 'inmemory') {
      return new InMemoryCoordinationAdapter()
    }
    
    if (config.type === 'redis') {
      const { RedisCoordinationAdapter } = require('./redis-coordination-adapter')
      const Redis = require('ioredis')
      const redis = new Redis(config.redis || { host: 'localhost', port: 6379 })
      return new RedisCoordinationAdapter(redis)
    }
    
    throw new Error(`Unknown CoordinationAdapter type: ${config.type}`)
  }
  
  /**
   * Create BlobStore adapter
   */
  static createBlobStore(config?: AdapterConfig['blobStore']): BlobStore {
    if (!config || config.type === 'inmemory') {
      return new InMemoryBlobStore()
    }
    
    if (config.type === 'azure') {
      const { AzureBlobStore } = require('./azure-blob-store')
      
      if (!config.azure) {
        throw new Error('Azure configuration required for azure BlobStore')
      }
      
      return new AzureBlobStore(
        config.azure.storageAccountUrl,
        config.azure.container
      )
    }
    
    throw new Error(`Unknown BlobStore type: ${config.type}`)
  }
  
  /**
   * Create JournalStore adapter (optional)
   */
  static createJournalStore(
    config?: AdapterConfig['journalStore']
  ): JournalStore | undefined {
    if (!config) {
      return undefined // Journal persistence is optional
    }
    
    if (config.type === 'inmemory') {
      return new InMemoryJournalStore()
    }
    
    if (config.type === 'redis') {
      const { RedisJournalStore } = require('./redis-journal-store')
      const Redis = require('ioredis')
      const redis = new Redis(config.redis || { host: 'localhost', port: 6379 })
      return new RedisJournalStore(redis)
    }
    
    throw new Error(`Unknown JournalStore type: ${config.type}`)
  }

  /**
   * Create all adapters from configuration
   */
  static createAll(config: AdapterConfig) {
    return {
      messageQueue: this.createMessageQueue(config.messageQueue),
      stateStore: this.createStateStore(config.stateStore),
      coordinationAdapter: this.createCoordinationAdapter(config.coordinationAdapter),
      blobStore: this.createBlobStore(config.blobStore),
      journalStore: this.createJournalStore(config.journalStore),
    }
  }
}
