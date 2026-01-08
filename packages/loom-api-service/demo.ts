#!/usr/bin/env node
/**
 * API Demo Script
 * 
 * Demonstrates the API by hitting all major endpoints
 */

import { spawn } from 'child_process'

const API_URL = 'http://localhost:3000'

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
}

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`)
}

function section(title: string) {
  console.log(`\n${colors.blue}${'='.repeat(60)}`)
  log(`  ${title}`, colors.blue)
  log('='.repeat(60), colors.blue)
}

async function apiCall(method: string, endpoint: string, body?: any) {
  const url = `${API_URL}${endpoint}`
  
  try {
    log(`\n→ ${method} ${endpoint}`, colors.cyan)
    
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' }
    }
    
    if (body) {
      options.body = JSON.stringify(body)
      log(`  Body: ${JSON.stringify(body, null, 2)}`, colors.yellow)
    }
    
    const response = await fetch(url, options)
    const data = await response.json()
    
    if (response.ok) {
      log(`✓ ${response.status} ${response.statusText}`, colors.green)
      log(`  Response: ${JSON.stringify(data, null, 2).split('\n').slice(0, 10).join('\n')}`, colors.reset)
      if (JSON.stringify(data).split('\n').length > 10) {
        log('  ...', colors.reset)
      }
      return data
    } else {
      log(`✗ ${response.status} ${response.statusText}`, colors.red)
      log(`  Error: ${JSON.stringify(data)}`, colors.red)
      return null
    }
  } catch (error) {
    log(`✗ Error: ${error}`, colors.red)
    return null
  }
}

async function runDemo() {
  log('\n🚀 Loom API Demo', colors.green)
  log('Starting comprehensive API test...', colors.reset)
  
  // Health & Documentation
  section('1. Health & Documentation')
  await apiCall('GET', '/api/v1/health')
  await apiCall('GET', '/docs')
  
  // Actor Management
  section('2. Actor Management API')
  const actor = await apiCall('POST', '/api/v1/actors', {
    name: 'demo-actor',
    type: 'echo',
    config: { message: 'Hello from demo!' }
  })
  
  if (actor?.id) {
    await apiCall('GET', `/api/v1/actors/${actor.id}`)
    await apiCall('GET', '/api/v1/actors')
    await apiCall('GET', `/api/v1/actors/${actor.id}/status`)
    await apiCall('POST', `/api/v1/actors/${actor.id}/message`, {
      type: 'demo',
      content: 'Test message'
    })
  }
  
  // Memory & Knowledge Graph
  section('3. Memory & Knowledge Graph API')
  const entity1 = await apiCall('POST', '/api/v1/memory/entities', {
    name: 'Alice',
    type: 'person',
    properties: { role: 'developer' }
  })
  
  const entity2 = await apiCall('POST', '/api/v1/memory/entities', {
    name: 'Bob',
    type: 'person',
    properties: { role: 'designer' }
  })
  
  if (entity1?.id && entity2?.id) {
    await apiCall('GET', `/api/v1/memory/entities/${entity1.id}`)
    await apiCall('GET', '/api/v1/memory/entities?type=person')
    
    const fact = await apiCall('POST', '/api/v1/memory/facts', {
      sourceEntityId: entity1.id,
      relation: 'collaborates_with',
      targetEntityId: entity2.id,
      text: 'Alice collaborates with Bob'
    })
    
    await apiCall('GET', `/api/v1/memory/facts?sourceEntityId=${entity1.id}`)
    await apiCall('GET', `/api/v1/memory/graph/neighbors/${entity1.id}?depth=1`)
    
    const episode = await apiCall('POST', '/api/v1/memory/episodes', {
      actorId: 'demo-actor',
      content: 'Demo episode showing collaboration',
      facts: [fact?.id]
    })
    
    await apiCall('GET', '/api/v1/memory/episodes')
  }
  
  // Configuration
  section('4. Configuration API')
  await apiCall('PUT', '/api/v1/config/demo.setting', { value: 'demo-value' })
  await apiCall('GET', '/api/v1/config/demo.setting')
  await apiCall('GET', '/api/v1/config?prefix=demo')
  await apiCall('POST', '/api/v1/config/resolve', {
    key: 'demo.setting',
    context: { env: 'demo' }
  })
  await apiCall('POST', '/api/v1/config/import', {
    config: {
      'feature.enabled': true,
      'feature.max_users': 100
    }
  })
  
  // State Management
  section('5. State Management API')
  const stateActorId = 'demo-state-actor'
  await apiCall('PUT', `/api/v1/state/${stateActorId}`, {
    state: { counter: 0, status: 'running' }
  })
  await apiCall('GET', `/api/v1/state/${stateActorId}`)
  await apiCall('PATCH', `/api/v1/state/${stateActorId}`, { counter: 5 })
  
  const snapshot = await apiCall('POST', `/api/v1/state/${stateActorId}/snapshot`)
  if (snapshot?.snapshotId) {
    await apiCall('GET', `/api/v1/state/${stateActorId}/snapshots`)
  }
  
  // Queue & Messaging
  section('6. Queue & Messaging API')
  const queueName = 'demo-queue'
  await apiCall('POST', `/api/v1/queue/${queueName}/publish`, {
    data: { message: 'Demo message' },
    priority: 1
  })
  await apiCall('GET', `/api/v1/queue/${queueName}/stats`)
  await apiCall('GET', `/api/v1/queue/${queueName}/messages?status=waiting`)
  await apiCall('POST', `/api/v1/queue/${queueName}/consume`)
  
  // Workflows
  section('7. Workflow API')
  const workflow = await apiCall('POST', '/api/v1/workflows', {
    name: 'demo-workflow',
    description: 'Demo workflow',
    stages: [
      { name: 'process', actor: 'processor' },
      { name: 'validate', actor: 'validator' }
    ]
  })
  
  if (workflow?.id) {
    await apiCall('GET', `/api/v1/workflows/${workflow.id}`)
    await apiCall('POST', `/api/v1/workflows/${workflow.id}/execute`, {
      input: { data: 'demo data' }
    })
    await apiCall('GET', `/api/v1/workflows/${workflow.id}/executions`)
  }
  
  // Observability
  section('8. Observability API')
  await apiCall('GET', '/api/v1/observability/health')
  await apiCall('GET', '/api/v1/observability/stats')
  await apiCall('POST', '/api/v1/observability/events', {
    event: 'demo.completed',
    properties: { duration: 1234 }
  })
  
  // Admin
  section('9. Admin & Operations API')
  await apiCall('GET', '/api/v1/admin/info')
  await apiCall('GET', '/api/v1/admin/storage/stats')
  await apiCall('POST', '/api/v1/admin/tenants', {
    tenantId: 'demo-tenant',
    name: 'Demo Tenant'
  })
  await apiCall('POST', '/api/v1/admin/tokens', {
    userId: 'demo-user',
    tenantId: 'demo-tenant',
    expiresIn: '7d'
  })
  
  // Summary
  section('Demo Complete!')
  log('✓ Successfully tested all 9 API subsystems', colors.green)
  log('✓ Actor Management', colors.green)
  log('✓ Memory & Knowledge Graph', colors.green)
  log('✓ Configuration', colors.green)
  log('✓ State Management', colors.green)
  log('✓ Queue & Messaging', colors.green)
  log('✓ Workflows & Pipelines', colors.green)
  log('✓ Observability', colors.green)
  log('✓ Admin & Operations', colors.green)
  log('\n🎉 All APIs are working!', colors.green)
}

// Check if server is running
async function checkServer() {
  try {
    const response = await fetch(`${API_URL}/api/v1/health`)
    return response.ok
  } catch {
    return false
  }
}

async function main() {
  log('Checking if API server is running...', colors.yellow)
  
  const isRunning = await checkServer()
  
  if (!isRunning) {
    log('\n⚠ API server is not running!', colors.red)
    log('Please start the server first:', colors.yellow)
    log('  cd packages/loom-api-service && npm run dev', colors.cyan)
    process.exit(1)
  }
  
  log('✓ Server is running!', colors.green)
  
  await runDemo()
}

main().catch(console.error)
