/**
 * Example: Loom API Client - How to Start and Access Pipeline State APIs
 * 
 * This demonstrates how to:
 * 1. Start the Loom API Service
 * 2. Authenticate and make API calls
 * 3. Query pipeline state, journal entries, and circuit breakers
 * 4. Monitor running pipelines
 */

import axios, { AxiosInstance } from 'axios'

// ---------------------------------------------------------------------------
// 1. Starting the Loom API Service
// ---------------------------------------------------------------------------

/**
 * OPTION A: Start as a standalone service
 * 
 * Prerequisites:
 * - Redis running on localhost:6379
 * - Environment configured in .env file
 * 
 * Commands:
 * ```bash
 * cd packages/loom-api-service
 * 
 * # Copy environment configuration
 * cp .env.example .env
 * 
 * # Install dependencies (if not already)
 * npm install
 * 
 * # Start in development mode (auto-reload)
 * npm run dev
 * 
 * # OR start in production mode
 * npm start
 * 
 * # OR using Docker Compose (includes Redis, Prometheus, Grafana)
 * npm run docker:up
 * ```
 * 
 * The service will start on:
 * - REST API: http://localhost:8000
 * - Metrics: http://localhost:9090/metrics
 * - Health: http://localhost:8000/api/v1/health
 */

/**
 * OPTION B: Start programmatically in your application
 */
async function startLoomAPIServiceProgrammatically() {
  // This is what happens inside packages/loom-api-service/src/server.ts
  const express = require('express')
  const { LoomService } = require('@certo-ventures/loom-api-service')
  
  const app = express()
  const loomService = new LoomService({
    redis: { url: 'redis://localhost:6379' },
    jwt: { secret: 'your-secret' },
    port: 8000,
    host: '0.0.0.0'
  })
  
  await loomService.initialize()
  
  // Routes are automatically set up
  app.listen(8000, () => {
    console.log('Loom API Service running on http://localhost:8000')
  })
}

// ---------------------------------------------------------------------------
// 2. API Client Setup
// ---------------------------------------------------------------------------

/**
 * Create an authenticated API client
 */
class LoomAPIClient {
  private client: AxiosInstance
  private baseURL: string
  private token?: string

  constructor(baseURL = 'http://localhost:8000') {
    this.baseURL = baseURL
    this.client = axios.create({
      baseURL: `${baseURL}/api/v1`,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    })
  }

  /**
   * Authenticate with username/password
   */
  async login(username: string, password: string, tenantId = 'default') {
    const response = await axios.post(`${this.baseURL}/auth/login`, {
      username,
      password,
      tenantId
    })
    
    this.token = response.data.token
    this.client.defaults.headers.common['Authorization'] = `Bearer ${this.token}`
    
    return response.data
  }

  /**
   * Or use API key authentication
   */
  setApiKey(apiKey: string) {
    this.client.defaults.headers.common['X-API-Key'] = apiKey
  }

  /**
   * Set tenant context
   */
  setTenant(tenantId: string) {
    this.client.defaults.headers.common['X-Tenant-ID'] = tenantId
  }

  // ---------------------------------------------------------------------------
  // 3. Pipeline State Queries
  // ---------------------------------------------------------------------------

  /**
   * List all running pipelines
   */
  async listRunningPipelines(limit = 100) {
    const response = await this.client.get('/workflows/pipelines/running', {
      params: { limit }
    })
    return response.data
  }

  /**
   * Get full pipeline state
   */
  async getPipelineState(pipelineId: string) {
    const response = await this.client.get(`/workflows/pipelines/${pipelineId}/state`)
    return response.data
  }

  /**
   * Get pipeline context (shared data between stages)
   */
  async getPipelineContext(pipelineId: string) {
    const response = await this.client.get(`/workflows/pipelines/${pipelineId}/context`)
    return response.data
  }

  /**
   * Get pipeline progress summary
   */
  async getPipelineProgress(pipelineId: string) {
    const response = await this.client.get(`/workflows/pipelines/${pipelineId}/progress`)
    return response.data
  }

  /**
   * Get stage details
   */
  async getStageState(pipelineId: string, stageName: string) {
    const response = await this.client.get(
      `/workflows/pipelines/${pipelineId}/stages/${stageName}`
    )
    return response.data
  }

  /**
   * Get stage outputs
   */
  async getStageOutputs(pipelineId: string, stageName: string, attempt = 0) {
    const response = await this.client.get(
      `/workflows/pipelines/${pipelineId}/stages/${stageName}/outputs`,
      { params: { attempt } }
    )
    return response.data
  }

  /**
   * Get stage tasks (for scatter/broadcast patterns)
   */
  async getStageTasks(pipelineId: string, stageName: string) {
    const response = await this.client.get(
      `/workflows/pipelines/${pipelineId}/stages/${stageName}/tasks`
    )
    return response.data
  }

  // ---------------------------------------------------------------------------
  // 4. Actor Journal Queries
  // ---------------------------------------------------------------------------

  /**
   * Get actor journal entries
   */
  async getActorJournal(actorId: string, limit = 100, since?: string) {
    const response = await this.client.get(`/workflows/actors/${actorId}/journal`, {
      params: { limit, since }
    })
    return response.data
  }

  /**
   * Get journal statistics
   */
  async getJournalStats(actorId: string) {
    const response = await this.client.get(`/workflows/actors/${actorId}/journal/stats`)
    return response.data
  }

  /**
   * Get actor snapshots
   */
  async getActorSnapshots(actorId: string, limit = 10) {
    const response = await this.client.get(`/workflows/actors/${actorId}/snapshots`, {
      params: { limit }
    })
    return response.data
  }

  // ---------------------------------------------------------------------------
  // 5. Circuit Breaker Management
  // ---------------------------------------------------------------------------

  /**
   * List all circuit breakers
   */
  async listCircuitBreakers() {
    const response = await this.client.get('/workflows/circuit-breakers')
    return response.data
  }

  /**
   * Reset a circuit breaker
   */
  async resetCircuitBreaker(key: string) {
    const response = await this.client.post(`/workflows/circuit-breakers/${key}/reset`)
    return response.data
  }

  // ---------------------------------------------------------------------------
  // 6. Other API Operations
  // ---------------------------------------------------------------------------

  /**
   * Create and run a pipeline
   */
  async runPipeline(pipelineDefinition: any, input: any) {
    // First create the pipeline
    const createResponse = await this.client.post('/workflows/pipelines', pipelineDefinition)
    const pipelineId = createResponse.data.id

    // Then run it
    const runResponse = await this.client.post(`/workflows/pipelines/${pipelineId}/run`, {
      input
    })

    return {
      pipelineId,
      runId: runResponse.data.runId,
      status: runResponse.data.status
    }
  }

  /**
   * Cancel a running pipeline
   */
  async cancelPipeline(pipelineId: string) {
    const response = await this.client.post(
      `/workflows/pipelines/${pipelineId}/cancel`
    )
    return response.data
  }

  /**
   * Health check
   */
  async healthCheck() {
    const response = await this.client.get('/health')
    return response.data
  }
}

// ---------------------------------------------------------------------------
// 7. Usage Examples
// ---------------------------------------------------------------------------

async function examples() {
  // Initialize client
  const client = new LoomAPIClient('http://localhost:8000')

  // Authenticate (if auth is enabled)
  // await client.login('admin', 'password', 'default')
  // OR use API key
  // client.setApiKey('your-api-key-here')

  // Set tenant context (if multi-tenancy enabled)
  client.setTenant('my-tenant')

  try {
    // Example 1: Monitor all running pipelines
    console.log('\n=== Running Pipelines ===')
    const running = await client.listRunningPipelines()
    console.log(`Found ${running.total} running pipelines`)
    
    for (const pipeline of running.pipelines.slice(0, 5)) {
      console.log(`- ${pipeline.pipelineId}: ${pipeline.status}`)
    }

    // Example 2: Get detailed pipeline state
    if (running.pipelines.length > 0) {
      const pipelineId = running.pipelines[0].pipelineId
      
      console.log(`\n=== Pipeline ${pipelineId} Details ===`)
      const state = await client.getPipelineState(pipelineId)
      console.log('Status:', state.status)
      console.log('Active stages:', state.activeStages)
      console.log('Stage order:', state.stageOrder)

      // Get progress
      const progress = await client.getPipelineProgress(pipelineId)
      console.log(`\nProgress: ${progress.overallProgress}%`)
      console.log(`Completed: ${progress.completedStages}/${progress.totalStages} stages`)
      console.log('Runtime:', Math.round(progress.runtime / 1000), 'seconds')

      // Get stage details
      for (const stage of progress.stages) {
        console.log(`  ${stage.name}: ${stage.status} (${stage.progress}%)`)
      }

      // Get context
      try {
        const context = await client.getPipelineContext(pipelineId)
        console.log('\nContext data:', context.data)
      } catch (err: any) {
        console.log('No context available yet')
      }

      // Get stage outputs
      for (const stageName of state.stageOrder) {
        const stageState = await client.getStageState(pipelineId, stageName)
        if (stageState.status === 'completed') {
          const outputs = await client.getStageOutputs(pipelineId, stageName, stageState.attempt)
          console.log(`\n${stageName} outputs:`, outputs.outputs.slice(0, 2))
        }
      }
    }

    // Example 3: Query actor journal
    console.log('\n=== Actor Journal ===')
    const actorId = 'calculator-actor-001'
    
    try {
      const journal = await client.getActorJournal(actorId, 10)
      console.log(`Actor ${actorId} has ${journal.count} recent entries`)
      
      journal.entries.forEach((entry: any, i: number) => {
        console.log(`${i + 1}. ${entry.entry.type} at ${entry.entry.timestamp}`)
      })

      const stats = await client.getJournalStats(actorId)
      console.log('Total entries:', stats.entryCount)
    } catch (err: any) {
      console.log('Actor not found or no journal entries')
    }

    // Example 4: Check circuit breakers
    console.log('\n=== Circuit Breakers ===')
    const breakers = await client.listCircuitBreakers()
    console.log(`Found ${breakers.circuitBreakers.length} circuit breakers`)
    
    for (const breaker of breakers.circuitBreakers) {
      console.log(`- ${breaker.key}: ${breaker.state} (failures: ${breaker.failures})`)
      
      // Reset if open
      if (breaker.state === 'open') {
        console.log(`  Resetting ${breaker.key}...`)
        await client.resetCircuitBreaker(breaker.key)
      }
    }

    // Example 5: Create and run a new pipeline
    console.log('\n=== Create New Pipeline ===')
    const result = await client.runPipeline(
      {
        name: 'data-processing-pipeline',
        stages: [
          { name: 'extract', actor: 'extractor' },
          { name: 'transform', actor: 'transformer' },
          { name: 'load', actor: 'loader' }
        ]
      },
      { sourceUrl: 'https://api.example.com/data' }
    )
    
    console.log('Pipeline started:', result.pipelineId)
    console.log('Run ID:', result.runId)

    // Poll for completion
    let attempts = 0
    const maxAttempts = 30
    while (attempts < maxAttempts) {
      const progress = await client.getPipelineProgress(result.pipelineId)
      console.log(`Progress: ${progress.overallProgress}%`)
      
      if (progress.status === 'completed') {
        console.log('Pipeline completed successfully!')
        break
      } else if (progress.status === 'failed') {
        console.log('Pipeline failed!')
        break
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000))
      attempts++
    }

  } catch (error: any) {
    console.error('API Error:', error.response?.data || error.message)
  }
}

// ---------------------------------------------------------------------------
// 8. Integration Patterns
// ---------------------------------------------------------------------------

/**
 * Pattern 1: Real-time pipeline monitoring dashboard
 */
async function pipelineMonitoringDashboard() {
  const client = new LoomAPIClient()
  
  // Poll every 5 seconds
  setInterval(async () => {
    const running = await client.listRunningPipelines(100)
    
    for (const pipeline of running.pipelines) {
      const progress = await client.getPipelineProgress(pipeline.pipelineId)
      
      // Update UI with progress
      console.log(`${pipeline.pipelineId}: ${progress.overallProgress}% complete`)
      
      // Check for errors
      const errors = progress.stages.filter((s: any) => s.status === 'failed')
      if (errors.length > 0) {
        console.error(`Pipeline ${pipeline.pipelineId} has ${errors.length} failed stages`)
      }
    }
  }, 5000)
}

/**
 * Pattern 2: Webhook-based notifications
 */
async function webhookIntegration() {
  const client = new LoomAPIClient()
  
  // Check for completed pipelines and send webhooks
  const running = await client.listRunningPipelines()
  
  for (const pipeline of running.pipelines) {
    const state = await client.getPipelineState(pipeline.pipelineId)
    
    if (state.status === 'completed' && state.metadata?.webhookUrl) {
      // Send completion webhook
      await axios.post(state.metadata.webhookUrl, {
        pipelineId: pipeline.pipelineId,
        status: 'completed',
        completedAt: state.completedAt
      })
    }
  }
}

/**
 * Pattern 3: Error recovery automation
 */
async function autoRecovery() {
  const client = new LoomAPIClient()
  
  // Check circuit breakers and auto-reset after cooldown
  const breakers = await client.listCircuitBreakers()
  
  for (const breaker of breakers.circuitBreakers) {
    if (breaker.state === 'open' && breaker.lastFailureAt) {
      const cooldown = 5 * 60 * 1000 // 5 minutes
      const elapsed = Date.now() - new Date(breaker.lastFailureAt).getTime()
      
      if (elapsed > cooldown) {
        console.log(`Auto-resetting circuit breaker: ${breaker.key}`)
        await client.resetCircuitBreaker(breaker.key)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Export client and examples
// ---------------------------------------------------------------------------

export {
  LoomAPIClient,
  examples,
  pipelineMonitoringDashboard,
  webhookIntegration,
  autoRecovery
}

// Run examples if executed directly
if (require.main === module) {
  examples().catch(console.error)
}
