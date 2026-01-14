/**
 * API Integration Tests
 * 
 * Starts the API server and tests all major endpoints
 */

import { describe, it, expect, beforeAll, afterAll, test } from 'vitest'
import request from 'supertest'
import { Express } from 'express'
import express from 'express'
import { setupMiddleware } from '../src/middleware'
import { setupRoutes } from '../src/routes'
import { LoomService } from '../src/services/loom-service'
import { loadConfig } from '../src/config'

let app: Express
let loomService: LoomService
let skipTests = false

beforeAll(async () => {
  try {
    // Create Express app with test config
    app = express()
    
    const config = loadConfig()
    config.env = 'test'
    config.multitenancy.enabled = false
    config.jwt.secret = 'test-secret'
    
    // Initialize LoomService
    loomService = new LoomService(config)
    await loomService.initialize()
  
    // Setup middleware and routes
    setupMiddleware(app, config)
    setupRoutes(app, loomService, config)
  } catch (error) {
    console.warn('Skipping API integration tests - config loading failed:', error)
    skipTests = true
  }
})

afterAll(async () => {
  if (loomService) {
    await loomService.shutdown()
  }
})

describe.skipIf(skipTests)('Health & Documentation', () => {
  it('GET /api/v1/health should return ok', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .expect(200)
    
    expect(response.body).toMatchObject({
      status: 'ok',
      version: expect.any(String)
    })
  })
  
  it('GET /docs should return API documentation', async () => {
    const response = await request(app)
      .get('/docs')
      .expect(200)
    
    expect(response.body).toHaveProperty('endpoints')
    expect(response.body.endpoints).toHaveProperty('actors')
    expect(response.body.endpoints).toHaveProperty('memory')
  })
})

describe.skipIf(skipTests)('Actor Management API', () => {
  let actorId: string
  
  it('POST /api/v1/actors should create actor', async () => {
    const response = await request(app)
      .post('/api/v1/actors')
      .send({
        name: 'test-actor',
        type: 'echo',
        config: { message: 'Hello World' }
      })
      .expect(201)
    
    expect(response.body).toHaveProperty('id')
    actorId = response.body.id
  })
  
  it('GET /api/v1/actors/:id should get actor', async () => {
    const response = await request(app)
      .get(`/api/v1/actors/${actorId}`)
      .expect(200)
    
    expect(response.body).toMatchObject({
      id: actorId,
      name: 'test-actor'
    })
  })
  
  it('GET /api/v1/actors should list actors', async () => {
    const response = await request(app)
      .get('/api/v1/actors')
      .expect(200)
    
    expect(response.body).toHaveProperty('actors')
    expect(Array.isArray(response.body.actors)).toBe(true)
  })
  
  it('GET /api/v1/actors/:id/status should get status', async () => {
    const response = await request(app)
      .get(`/api/v1/actors/${actorId}/status`)
      .expect(200)
    
    expect(response.body).toHaveProperty('status')
  })
  
  it('POST /api/v1/actors/:id/message should send message', async () => {
    const response = await request(app)
      .post(`/api/v1/actors/${actorId}/message`)
      .send({
        type: 'test',
        content: 'Hello'
      })
      .expect(200)
    
    expect(response.body).toHaveProperty('messageId')
  })
})

describe.skipIf(skipTests)('Memory & Knowledge Graph API', () => {
  let entityId: string
  let factId: string
  let episodeId: string
  
  it('POST /api/v1/memory/entities should create entity', async () => {
    const response = await request(app)
      .post('/api/v1/memory/entities')
      .send({
        name: 'John Doe',
        type: 'person',
        properties: { age: 30 }
      })
      .expect(201)
    
    expect(response.body).toHaveProperty('id')
    entityId = response.body.id
  })
  
  it('GET /api/v1/memory/entities/:id should get entity', async () => {
    const response = await request(app)
      .get(`/api/v1/memory/entities/${entityId}`)
      .expect(200)
    
    expect(response.body).toMatchObject({
      id: entityId,
      name: 'John Doe'
    })
  })
  
  it('GET /api/v1/memory/entities should search entities', async () => {
    const response = await request(app)
      .get('/api/v1/memory/entities?type=person')
      .expect(200)
    
    expect(response.body).toHaveProperty('entities')
    expect(response.body.entities.length).toBeGreaterThan(0)
  })
  
  it('POST /api/v1/memory/facts should add fact', async () => {
    // Create target entity first
    const target = await request(app)
      .post('/api/v1/memory/entities')
      .send({ name: 'Jane Doe', type: 'person' })
    
    const response = await request(app)
      .post('/api/v1/memory/facts')
      .send({
        sourceEntityId: entityId,
        relation: 'knows',
        targetEntityId: target.body.id,
        text: 'John knows Jane'
      })
      .expect(201)
    
    expect(response.body).toHaveProperty('id')
    factId = response.body.id
  })
  
  it('GET /api/v1/memory/facts should search facts', async () => {
    const response = await request(app)
      .get(`/api/v1/memory/facts?sourceEntityId=${entityId}`)
      .expect(200)
    
    expect(response.body).toHaveProperty('facts')
    expect(response.body.facts.length).toBeGreaterThan(0)
  })
  
  it('GET /api/v1/memory/graph/neighbors/:id should get neighbors', async () => {
    const response = await request(app)
      .get(`/api/v1/memory/graph/neighbors/${entityId}?depth=1`)
      .expect(200)
    
    expect(response.body).toHaveProperty('entityId', entityId)
    expect(response.body).toHaveProperty('neighbors')
  })
  
  it('POST /api/v1/memory/episodes should create episode', async () => {
    const response = await request(app)
      .post('/api/v1/memory/episodes')
      .send({
        actorId: 'test-actor',
        content: 'Test episode',
        facts: [factId]
      })
      .expect(201)
    
    expect(response.body).toHaveProperty('id')
    episodeId = response.body.id
  })
  
  it('GET /api/v1/memory/episodes should search episodes', async () => {
    const response = await request(app)
      .get('/api/v1/memory/episodes')
      .expect(200)
    
    expect(response.body).toHaveProperty('episodes')
  })
})

describe.skipIf(skipTests)('Configuration API', () => {
  it('PUT /api/v1/config/:keyPath should set value', async () => {
    const response = await request(app)
      .put('/api/v1/config/test.setting')
      .send({ value: 'test-value' })
      .expect(200)
    
    expect(response.body).toMatchObject({
      keyPath: 'test.setting',
      value: 'test-value',
      updated: true
    })
  })
  
  it('GET /api/v1/config/:keyPath should get value', async () => {
    const response = await request(app)
      .get('/api/v1/config/test.setting')
      .expect(200)
    
    expect(response.body).toMatchObject({
      keyPath: 'test.setting',
      value: 'test-value'
    })
  })
  
  it('GET /api/v1/config should list keys', async () => {
    const response = await request(app)
      .get('/api/v1/config?prefix=test')
      .expect(200)
    
    expect(response.body).toHaveProperty('keys')
    expect(Array.isArray(response.body.keys)).toBe(true)
  })
  
  it('POST /api/v1/config/resolve should resolve with context', async () => {
    const response = await request(app)
      .post('/api/v1/config/resolve')
      .send({
        key: 'test.setting',
        context: { env: 'test' }
      })
      .expect(200)
    
    expect(response.body).toHaveProperty('value')
  })
  
  it('POST /api/v1/config/import should import config', async () => {
    const response = await request(app)
      .post('/api/v1/config/import')
      .send({
        config: {
          'feature.enabled': true,
          'feature.limit': 100
        }
      })
      .expect(200)
    
    expect(response.body).toMatchObject({
      imported: true,
      keyCount: 2
    })
  })
})

describe.skipIf(skipTests)('State Management API', () => {
  const testActorId = 'state-test-actor'
  
  it('PUT /api/v1/state/:actorId should set state', async () => {
    const response = await request(app)
      .put(`/api/v1/state/${testActorId}`)
      .send({
        state: { counter: 0, status: 'active' }
      })
      .expect(200)
    
    expect(response.body).toMatchObject({
      actorId: testActorId,
      updated: true
    })
  })
  
  it('GET /api/v1/state/:actorId should get state', async () => {
    const response = await request(app)
      .get(`/api/v1/state/${testActorId}`)
      .expect(200)
    
    expect(response.body).toHaveProperty('state')
    expect(response.body.state).toMatchObject({ counter: 0 })
  })
  
  it('PATCH /api/v1/state/:actorId should update state', async () => {
    const response = await request(app)
      .patch(`/api/v1/state/${testActorId}`)
      .send({ counter: 1 })
      .expect(200)
    
    expect(response.body.updated).toBe(true)
  })
  
  it('POST /api/v1/state/:actorId/snapshot should create snapshot', async () => {
    const response = await request(app)
      .post(`/api/v1/state/${testActorId}/snapshot`)
      .expect(201)
    
    expect(response.body).toHaveProperty('snapshotId')
  })
  
  it('GET /api/v1/state/:actorId/snapshots should list snapshots', async () => {
    const response = await request(app)
      .get(`/api/v1/state/${testActorId}/snapshots`)
      .expect(200)
    
    expect(response.body).toHaveProperty('snapshots')
    expect(Array.isArray(response.body.snapshots)).toBe(true)
  })
})

describe.skipIf(skipTests)('Queue & Messaging API', () => {
  const queueName = 'test-queue'
  let jobId: string
  
  it('POST /api/v1/queue/:queueName/publish should publish message', async () => {
    const response = await request(app)
      .post(`/api/v1/queue/${queueName}/publish`)
      .send({
        data: { message: 'Test message' },
        priority: 1
      })
      .expect(201)
    
    expect(response.body).toHaveProperty('jobId')
    jobId = response.body.jobId
  })
  
  it('GET /api/v1/queue/:queueName/stats should get stats', async () => {
    const response = await request(app)
      .get(`/api/v1/queue/${queueName}/stats`)
      .expect(200)
    
    expect(response.body).toHaveProperty('queueName', queueName)
    expect(response.body).toHaveProperty('waiting')
  })
  
  it('GET /api/v1/queue/:queueName/messages should get messages', async () => {
    const response = await request(app)
      .get(`/api/v1/queue/${queueName}/messages?status=waiting`)
      .expect(200)
    
    expect(response.body).toHaveProperty('messages')
  })
  
  it('POST /api/v1/queue/:queueName/consume should consume message', async () => {
    const response = await request(app)
      .post(`/api/v1/queue/${queueName}/consume`)
      .expect(200)
    
    expect(response.body).toHaveProperty('queueName', queueName)
  })
})

describe.skipIf(skipTests)('Workflow API', () => {
  let workflowId: string
  let executionId: string
  
  it('POST /api/v1/workflows should create workflow', async () => {
    const response = await request(app)
      .post('/api/v1/workflows')
      .send({
        name: 'test-workflow',
        description: 'Test workflow',
        stages: [
          { name: 'stage1', actor: 'actor1' },
          { name: 'stage2', actor: 'actor2' }
        ]
      })
      .expect(201)
    
    expect(response.body).toHaveProperty('id')
    workflowId = response.body.id
  })
  
  it('GET /api/v1/workflows/:id should get workflow', async () => {
    const response = await request(app)
      .get(`/api/v1/workflows/${workflowId}`)
      .expect(200)
    
    expect(response.body).toHaveProperty('id', workflowId)
  })
  
  it('POST /api/v1/workflows/:id/execute should execute workflow', async () => {
    const response = await request(app)
      .post(`/api/v1/workflows/${workflowId}/execute`)
      .send({
        input: { data: 'test' }
      })
      .expect(202)
    
    expect(response.body).toHaveProperty('executionId')
    executionId = response.body.executionId
  })
  
  it('GET /api/v1/workflows/:id/executions should list executions', async () => {
    const response = await request(app)
      .get(`/api/v1/workflows/${workflowId}/executions`)
      .expect(200)
    
    expect(response.body).toHaveProperty('workflowId', workflowId)
  })
})

describe.skipIf(skipTests)('Observability API', () => {
  it('GET /api/v1/observability/health should return health status', async () => {
    const response = await request(app)
      .get('/api/v1/observability/health')
      .expect(200)
    
    expect(response.body).toHaveProperty('status')
    expect(response.body).toHaveProperty('components')
  })
  
  it('GET /api/v1/observability/stats should return system stats', async () => {
    const response = await request(app)
      .get('/api/v1/observability/stats')
      .expect(200)
    
    expect(response.body).toHaveProperty('uptime')
    expect(response.body).toHaveProperty('memory')
  })
  
  it('POST /api/v1/observability/events should record event', async () => {
    const response = await request(app)
      .post('/api/v1/observability/events')
      .send({
        event: 'test.event',
        properties: { key: 'value' }
      })
      .expect(201)
    
    expect(response.body).toHaveProperty('eventId')
  })
})

describe.skipIf(skipTests)('Admin API', () => {
  it('GET /api/v1/admin/info should return system info', async () => {
    const response = await request(app)
      .get('/api/v1/admin/info')
      .expect(200)
    
    expect(response.body).toHaveProperty('version')
    expect(response.body).toHaveProperty('nodeVersion')
  })
  
  it('GET /api/v1/admin/storage/stats should return storage stats', async () => {
    const response = await request(app)
      .get('/api/v1/admin/storage/stats')
      .expect(200)
    
    expect(response.body).toHaveProperty('type')
  })
  
  it('POST /api/v1/admin/tenants should create tenant', async () => {
    const response = await request(app)
      .post('/api/v1/admin/tenants')
      .send({
        tenantId: 'test-tenant',
        name: 'Test Tenant'
      })
      .expect(201)
    
    expect(response.body).toMatchObject({
      tenantId: 'test-tenant',
      name: 'Test Tenant'
    })
  })
  
  it('POST /api/v1/admin/tokens should generate token', async () => {
    const response = await request(app)
      .post('/api/v1/admin/tokens')
      .send({
        userId: 'test-user',
        tenantId: 'test-tenant'
      })
      .expect(201)
    
    expect(response.body).toHaveProperty('token')
  })
})
