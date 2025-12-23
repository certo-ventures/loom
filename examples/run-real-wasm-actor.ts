/**
 * Real WASM Actor Example
 * 
 * This demonstrates:
 * 1. Compiling AssemblyScript to WASM
 * 2. Loading WASM from in-memory blob store
 * 3. Executing as a real actor with state
 */

import { WASMActorAdapter } from '../src/actor/wasm-actor-adapter'
import type { ActorContext } from '../src/actor/journal'
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
  console.log('🚀 Real WASM Actor Example\n')
  console.log('This demonstrates a COMPLETE workflow:')
  console.log('  1. Compile AssemblyScript → WASM')
  console.log('  2. Upload WASM to blob store (in-memory)')
  console.log('  3. Load WASM from blob store')
  console.log('  4. Execute as actor with state\n')
  
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
  
  // Step 3: Create WASM actor
  console.log('\n🎭 Creating WASM actor...')
  const context: ActorContext = {
    actorId: 'counter-1',
    actorType: 'CounterActor',
    correlationId: 'demo-123'
  }
  
  const actor = new WASMActorAdapter('counter-actor.wasm', blobStore, context)
  
  // Step 4: Execute actor commands
  console.log('\n▶️  Executing actor commands:\n')
  
  // Increment
  console.log('1️⃣  Increment by 5')
  await actor.execute({ action: 'increment', amount: 5 })
  console.log('   State:', JSON.stringify((actor as any).state, null, 2))
  
  // Increment again
  console.log('\n2️⃣  Increment by 3')
  await actor.execute({ action: 'increment', amount: 3 })
  console.log('   State:', JSON.stringify((actor as any).state, null, 2))
  
  // Decrement
  console.log('\n3️⃣  Decrement by 2')
  await actor.execute({ action: 'decrement', amount: 2 })
  console.log('   State:', JSON.stringify((actor as any).state, null, 2))
  
  // Get current value
  console.log('\n4️⃣  Get current value')
  await actor.execute({ action: 'get' })
  console.log('   State:', JSON.stringify((actor as any).state, null, 2))
  
  // Reset
  console.log('\n5️⃣  Reset counter')
  await actor.execute({ action: 'reset' })
  console.log('   State:', JSON.stringify((actor as any).state, null, 2))
  
  console.log('\n✨ WASM actor demonstration complete!')
  console.log('\n💡 Key points:')
  console.log('   • WASM compiled from AssemblyScript')
  console.log('   • Loaded from in-memory blob store')
  console.log('   • Executed as a real Loom actor')
  console.log('   • State persisted across calls')
  console.log('   • Could use ANY blob store (Azure, S3, etc.)')
}

main().catch(console.error)
