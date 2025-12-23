/**
 * Real WASM Activity Example
 * 
 * This demonstrates:
 * 1. Compiling AssemblyScript to WASM
 * 2. Loading WASM from in-memory blob store
 * 3. Executing as a real activity with state
 */

import { WasmActivityExecutor, ActivityDefinition } from '../src/activities/wasm-executor'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

// In-memory blob store for demo
class MemoryBlobStore {
  private blobs = new Map<string, Buffer>()
  
  async upload(path: string, data: Buffer): Promise<string> {
    this.blobs.set(path, data)
    console.log(`📦 Uploaded ${path} (${data.length} bytes)`)
    return path
  }
  
  async download(path: string): Promise<Buffer> {
    const data = this.blobs.get(path)
    if (!data) throw new Error(`Blob not found: ${path}`)
    console.log(`📥 Downloaded ${path} (${data.length} bytes)`)
    return data
  }
  
  async exists(path: string): Promise<boolean> {
    return this.blobs.has(path)
  }
  
  async delete(path: string): Promise<void> {
    this.blobs.delete(path)
  }
}

async function compileWASM(sourcePath: string, outputPath: string): Promise<void> {
  console.log(`\n🔨 Compiling ${sourcePath}...`)
  
  try {
    // Compile with AssemblyScript
    execSync(
      `npx asc ${sourcePath} --outFile ${outputPath} --optimize --exportRuntime --runtime stub`,
      { stdio: 'inherit' }
    )
    console.log(`✅ Compiled to ${outputPath}`)
  } catch (error) {
    console.error('❌ Compilation failed:', error)
    throw error
  }
}

async function main() {
  console.log('🚀 Real WASM Activity Example\n')
  console.log('This demonstrates a COMPLETE workflow:')
  console.log('  1. Compile AssemblyScript → WASM')
  console.log('  2. Upload WASM to blob store (in-memory)')
  console.log('  3. Load WASM from blob store')
  console.log('  4. Execute as activity with state\n')
  
  // Step 1: Compile AssemblyScript to WASM
  const sourcePath = 'examples/wasm/counter-actor.ts'
  const outputPath = 'build/counter-actor.wasm'
  
  // Ensure build directory exists
  if (!fs.existsSync('build')) {
    fs.mkdirSync('build')
  }
  
  await compileWASM(sourcePath, outputPath)
  
  // Step 2: Create blob store and upload WASM
  console.log('\n📦 Setting up in-memory blob store...')
  const blobStore = new MemoryBlobStore()
  const wasmBytes = fs.readFileSync(outputPath)
  await blobStore.upload('counter-actor.wasm', wasmBytes)
  
  // Step 3: Create activity definition
  console.log('\n📋 Creating activity definition...')
  const activity: ActivityDefinition = {
    name: 'counter',
    version: '1.0.0',
    wasmBlobPath: 'counter-actor.wasm',
    limits: {
      maxMemoryMB: 10,
      maxExecutionMs: 5000
    }
  }
  
  // Step 4: Create executor
  console.log('⚙️  Creating WASM executor...')
  const executor = new WasmActivityExecutor(blobStore)
  
  // Step 5: Execute activity commands
  console.log('\n▶️  Executing activity commands:\n')
  
  // Increment
  console.log('1️⃣  Increment by 5')
  let result = await executor.execute(activity, { action: 'increment', amount: 5 })
  console.log('   Result:', JSON.stringify(result, null, 2))
  
  // Increment again
  console.log('\n2️⃣  Increment by 3')
  result = await executor.execute(activity, { action: 'increment', amount: 3 })
  console.log('   Result:', JSON.stringify(result, null, 2))
  
  // Decrement
  console.log('\n3️⃣  Decrement by 2')
  result = await executor.execute(activity, { action: 'decrement', amount: 2 })
  console.log('   Result:', JSON.stringify(result, null, 2))
  
  // Get current value
  console.log('\n4️⃣  Get current value')
  result = await executor.execute(activity, { action: 'get' })
  console.log('   Result:', JSON.stringify(result, null, 2))
  
  // Reset
  console.log('\n5️⃣  Reset counter')
  result = await executor.execute(activity, { action: 'reset' })
  console.log('   Result:', JSON.stringify(result, null, 2))
  
  console.log('\n✨ WASM activity demonstration complete!')
  console.log('\n💡 Key points:')
  console.log('   • WASM compiled from AssemblyScript')
  console.log('   • Loaded from in-memory blob store')
  console.log('   • Executed as a Loom activity')
  console.log('   • State maintained across calls (within same instance)')
  console.log('   • Could use ANY blob store (Azure, S3, etc.)')
  console.log('   • Module cached for performance')
  console.log('\n📚 This is "real" WASM:')
  console.log('   • Binary format (not interpreted)')
  console.log('   • Near-native execution speed')
  console.log('   • Sandboxed memory model')
  console.log('   • Can be loaded dynamically')
  console.log('   • Works with TLS Notary & RISC Zero')
}

main().catch(console.error)
