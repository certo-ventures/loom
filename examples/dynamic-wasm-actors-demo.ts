import { readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Test: Dynamic WASM Actor Lifecycle using Loom Server
 * 
 * Demonstrates:
 * 1. Dynamic registration of WASM actors via API
 * 2. Running actors with different inputs via HTTP
 * 3. Pausing and resuming execution
 * 4. Cleanup and unregistration
 * 5. Concurrent actor execution
 */

const LOOM_SERVER_URL = process.env.LOOM_SERVER_URL || 'http://localhost:8080';

interface ActorRegistration {
  actorType: string;
  name: string;
  description: string;
  version: string;
  wasmBase64: string;
  inputSchema?: object;
  outputSchema?: object;
}

interface ExecutionRequest {
  actorType: string;
  input: any;
  executionId?: string;
}

interface ExecutionResult {
  executionId: string;
  actorType: string;
  status: 'completed' | 'failed' | 'paused';
  result?: any;
  error?: string;
}

class LoomServerClient {
  constructor(private baseUrl: string) {}
  
  /**
   * Register a WASM actor dynamically
   */
  async registerActor(registration: ActorRegistration): Promise<void> {
    console.log(`📦 Registering actor: ${registration.actorType}`);
    
    const response = await fetch(`${this.baseUrl}/registry/actors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registration)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to register actor: ${error}`);
    }
    
    console.log(`✅ Registered ${registration.actorType} (${registration.wasmBase64.length} bytes)`);
  }
  
  /**
   * Execute actor via API
   */
  async executeActor(request: ExecutionRequest): Promise<ExecutionResult> {
    const response = await fetch(`${this.baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Execution failed: ${error}`);
    }
    
    return response.json();
  }
  
  /**
   * Get actor execution status
   */
  async getExecutionStatus(executionId: string): Promise<ExecutionResult> {
    const response = await fetch(`${this.baseUrl}/execute/${executionId}`);
    
    if (!response.ok) {
      throw new Error(`Failed to get execution status`);
    }
    
    return response.json();
  }
  
  /**
   * Pause execution (checkpoint)
   */
  async pauseExecution(executionId: string): Promise<string> {
    console.log(`⏸️  Pausing execution: ${executionId}`);
    
    const response = await fetch(`${this.baseUrl}/execute/${executionId}/pause`, {
      method: 'POST'
    });
    
    if (!response.ok) {
      throw new Error(`Failed to pause execution`);
    }
    
    const { checkpoint } = await response.json();
    return checkpoint;
  }
  
  /**
   * Resume from checkpoint
   */
  async resumeExecution(checkpoint: string): Promise<ExecutionResult> {
    console.log(`▶️  Resuming from checkpoint`);
    
    const response = await fetch(`${this.baseUrl}/execute/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpoint })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to resume execution`);
    }
    
    return response.json();
  }
  
  /**
   * Unregister actor (cleanup)
   */
  async unregisterActor(actorType: string): Promise<void> {
    console.log(`🧹 Unregistering actor: ${actorType}`);
    
    const response = await fetch(`${this.baseUrl}/registry/actors/${actorType}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      console.warn(`Failed to unregister ${actorType}`);
    }
  }
  
  /**
   * Get server health
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Helper: Load WASM file and convert to base64
 */
function loadWasmAsBase64(wasmPath: string): string {
  const wasmBytes = readFileSync(wasmPath);
  return wasmBytes.toString('base64');
}

/**
 * Test 1: Register and execute multiple actors concurrently
 */
async function testMultipleActors(client: LoomServerClient) {
  console.log('\n🎯 Test 1: Multiple Concurrent Actors');
  console.log('='.repeat(50));
  
  const wasmPath = join(__dirname, '../build/counter-actor.wasm');
  const wasmBase64 = loadWasmAsBase64(wasmPath);
  
  // Register 3 different actor types
  const actorTypes = ['counter-alpha', 'counter-beta', 'counter-gamma'];
  
  console.log('📦 Registering actors...');
  for (const actorType of actorTypes) {
    await client.registerActor({
      actorType,
      name: `Counter ${actorType}`,
      description: `Test counter actor ${actorType}`,
      version: '1.0.0',
      wasmBase64
    });
  }
  
  // Execute all actors concurrently
  console.log('\n📊 Executing actors concurrently...');
  const executions = await Promise.all([
    client.executeActor({ actorType: 'counter-alpha', input: { count: 2 } }),
    client.executeActor({ actorType: 'counter-beta', input: { count: 3 } }),
    client.executeActor({ actorType: 'counter-gamma', input: { count: 5 } })
  ]);
  
  executions.forEach((result, i) => {
    console.log(`  ${actorTypes[i]}: ${result.status} - ${JSON.stringify(result.result)}`);
  });
  
  // Cleanup
  console.log('\n🧹 Cleaning up...');
  for (const actorType of actorTypes) {
    await client.unregisterActor(actorType);
  }
}

/**
 * Test 2: Pause and resume execution
 */
async function testPauseResume(client: LoomServerClient) {
  console.log('\n🎯 Test 2: Pause and Resume');
  console.log('='.repeat(50));
  
  const wasmPath = join(__dirname, '../build/counter-actor.wasm');
  const wasmBase64 = loadWasmAsBase64(wasmPath);
  
  // Register pausable actor
  console.log('📦 Registering pausable actor...');
  await client.registerActor({
    actorType: 'pausable-counter',
    name: 'Pausable Counter',
    description: 'Counter that can be paused and resumed',
    version: '1.0.0',
    wasmBase64
  });
  
  // Start execution
  console.log('▶️  Starting execution...');
  const execution1 = await client.executeActor({
    actorType: 'pausable-counter',
    input: { count: 3 }
  });
  console.log(`Execution started: ${execution1.executionId}`);
  console.log(`Result: ${JSON.stringify(execution1.result)}`);
  
  // Pause execution
  console.log('\n⏸️  Pausing execution...');
  const checkpoint = await client.pauseExecution(execution1.executionId);
  console.log(`Checkpoint saved (${checkpoint.length} bytes)`);
  
  // Simulate server restart / memory cleanup
  console.log('💤 Simulating server restart...');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Resume execution
  console.log('\n▶️  Resuming from checkpoint...');
  const execution2 = await client.resumeExecution(checkpoint);
  console.log(`Resumed execution: ${execution2.executionId}`);
  console.log(`Result after resume: ${JSON.stringify(execution2.result)}`);
  
  // Cleanup
  await client.unregisterActor('pausable-counter');
}

/**
 * Test 3: Dynamic loading of different WASM modules
 */
async function testDynamicLoading(client: LoomServerClient) {
  console.log('\n🎯 Test 3: Dynamic Loading from Storage');
  console.log('='.repeat(50));
  
  const buildDir = join(__dirname, '../build');
  
  // Load counter actor
  console.log('📦 Loading counter actor from storage...');
  const counterPath = join(buildDir, 'counter-actor.wasm');
  const counterWasm = loadWasmAsBase64(counterPath);
  
  await client.registerActor({
    actorType: 'dynamic-counter',
    name: 'Dynamically Loaded Counter',
    description: 'Counter loaded from file system',
    version: '1.0.0',
    wasmBase64: counterWasm
  });
  
  const result1 = await client.executeActor({
    actorType: 'dynamic-counter',
    input: { count: 7 }
  });
  console.log(`Counter result: ${JSON.stringify(result1.result)}`);
  
  // Try loading echo actor if available
  try {
    console.log('\n📦 Loading echo actor from storage...');
    const echoPath = join(buildDir, 'echo.wasm');
    const echoWasm = loadWasmAsBase64(echoPath);
    
    await client.registerActor({
      actorType: 'dynamic-echo',
      name: 'Dynamically Loaded Echo',
      description: 'Echo loaded from file system',
      version: '1.0.0',
      wasmBase64: echoWasm
    });
    
    const result2 = await client.executeActor({
      actorType: 'dynamic-echo',
      input: { message: 'Hello from dynamic loading!' }
    });
    console.log(`Echo result: ${JSON.stringify(result2.result)}`);
    
    await client.unregisterActor('dynamic-echo');
  } catch (err) {
    console.log('Echo actor not available (expected)');
  }
  
  await client.unregisterActor('dynamic-counter');
}

/**
 * Test 4: Cleanup and resource management
 */
async function testCleanup(client: LoomServerClient) {
  console.log('\n🎯 Test 4: Cleanup and Resource Management');
  console.log('='.repeat(50));
  
  const wasmPath = join(__dirname, '../build/counter-actor.wasm');
  const wasmBase64 = loadWasmAsBase64(wasmPath);
  
  // Register multiple actors
  const actorTypes: string[] = [];
  console.log('📦 Creating 5 actors...');
  
  for (let i = 0; i < 5; i++) {
    const actorType = `cleanup-test-${i}`;
    actorTypes.push(actorType);
    
    await client.registerActor({
      actorType,
      name: `Cleanup Test ${i}`,
      description: `Test actor ${i} for cleanup`,
      version: '1.0.0',
      wasmBase64
    });
  }
  
  // Execute all actors
  console.log('▶️  Executing all actors...');
  const executions = await Promise.all(
    actorTypes.map(actorType => 
      client.executeActor({ actorType, input: { count: 1 } })
    )
  );
  
  console.log(`✅ Executed ${executions.length} actors`);
  
  // Cleanup all
  console.log('🧹 Cleaning up all actors...');
  await Promise.all(
    actorTypes.map(actorType => client.unregisterActor(actorType))
  );
  console.log('✅ All actors unregistered');
}

/**
 * Main test runner
 */
async function main() {
  console.log('🚀 Dynamic WASM Actor Lifecycle Tests (via Loom Server)');
  console.log('='.repeat(50));
  
  const client = new LoomServerClient(LOOM_SERVER_URL);
  
  // Check if server is running
  console.log(`\n🔍 Checking Loom Server at ${LOOM_SERVER_URL}...`);
  const isHealthy = await client.healthCheck();
  
  if (!isHealthy) {
    console.error(`\n❌ Loom Server not available at ${LOOM_SERVER_URL}`);
    console.log('\nTo start Loom Server:');
    console.log('  cd packages/loom-server');
    console.log('  npm start');
    process.exit(1);
  }
  
  console.log('✅ Server is healthy\n');
  
  try {
    await testMultipleActors(client);
    await testPauseResume(client);
    await testDynamicLoading(client);
    await testCleanup(client);
    
    console.log('\n✅ All tests passed!');
    console.log('\nTested:');
    console.log('  ✓ Dynamic actor registration');
    console.log('  ✓ Concurrent execution via HTTP API');
    console.log('  ✓ Pause and resume (checkpointing)');
    console.log('  ✓ Loading from storage');
    console.log('  ✓ Resource cleanup and unregistration');
  } catch (err) {
    console.error('\n❌ Test failed:', err);
    if (err instanceof Error) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { 
  LoomServerClient, 
  testMultipleActors, 
  testPauseResume, 
  testDynamicLoading, 
  testCleanup 
};
