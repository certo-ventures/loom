/**
 * Loom Service - Main runtime wrapper
 */

import { ActorRuntime, InMemoryGraphStorage, MemoryStorage, ConfigResolver, InMemoryConfigResolver } from '@certo-ventures/loom'
import Redis from 'ioredis'
import type { Config } from '../config'
import { logger } from '../utils/logger'
import { ActorService } from './actor-service'
import { MemoryService } from './memory-service'
import { ConfigService } from './config-service'
import { QueueService } from './queue-service'
import { StateService } from './state-service'

export class LoomService {
  private runtime: ActorRuntime | null = null
  private storage: MemoryStorage | null = null
  private configResolver: ConfigResolver | null = null
  private redis: Redis | null = null
  
  // Service layers
  public actorService: ActorService | null = null
  public memoryService: MemoryService | null = null
  public configService: ConfigService | null = null
  public queueService: QueueService | null = null
  public stateService: StateService | null = null
  
  constructor(private config: Config) {}
  
  async initialize() {
    logger.info('Initializing Loom runtime...')
    
    // Initialize Redis connection
    this.redis = new Redis(this.config.redis.url, {
      password: this.config.redis.password,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000)
    })
    
    this.redis.on('error', (err) => {
      logger.error('Redis connection error', { error: err })
    })
    
    this.redis.on('connect', () => {
      logger.info('Redis connected')
    })
    
    // Initialize storage adapter
    if (this.config.storage.type === 'postgresql' && this.config.postgres.url) {
      // TODO: Initialize PostgreSQL adapter
      logger.info('Using PostgreSQL storage')
    } else if (this.config.storage.type === 'redis') {
      // TODO: Initialize Redis-backed storage
      logger.info('Using Redis storage')
    } else {
      // Default to in-memory
      this.storage = new InMemoryGraphStorage()
      logger.info('Using in-memory storage')
    }
    
    // Initialize config resolver
    this.configResolver = new InMemoryConfigResolver()
    
    // Initialize actor runtime
    this.runtime = new ActorRuntime({
      storage: this.storage!,
      // Add more configuration as needed
    })
    
    // Initialize service layers
    this.actorService = new ActorService(this.runtime)
    this.memoryService = new MemoryService(this.storage!)
    this.configService = new ConfigService(this.configResolver)
    this.queueService = new QueueService(this.redis)
    this.stateService = new StateService(this.redis)
    
    logger.info('Loom runtime initialized successfully')
  }
  
  async shutdown() {
    logger.info('Shutting down Loom service...')
    
    // Cleanup runtime
    if (this.runtime) {
      // Add shutdown logic
      this.runtime = null
    }
    
    // Close Redis connection
    if (this.redis) {
      await this.redis.quit()
      this.redis = null
    }
    
    logger.info('Loom service shut down')
  }
  
  getRuntime(): ActorRuntime {
    if (!this.runtime) {
      throw new Error('Loom runtime not initialized')
    }
    return this.runtime
  }
  
  getStorage(): MemoryStorage {
    if (!this.storage) {
      throw new Error('Storage not initialized')
    }
    return this.storage
  }
  
  getConfigResolver(): ConfigResolver {
    if (!this.configResolver) {
      throw new Error('Config resolver not initialized')
    }
    return this.configResolver
  }
  
  getRedis(): Redis {
    if (!this.redis) {
      throw new Error('Redis not initialized')
    }
    return this.redis
  }
}
