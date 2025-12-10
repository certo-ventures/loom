/**
 * Example: Running a WASM activity
 */

import { WasmActivityExecutor, ActivityDefinition } from '../src/activities'
import * as fs from 'fs'
import * as path from 'path'

// Simple blob store for demo
class FileBlobStore {
  constructor(private basePath: string) {}
  
  async upload(path: string, data: Buffer): Promise<string> {
    const fullPath = `${this.basePath}/${path}`
    fs.mkdirSync(fullPath.substring(0, fullPath.lastIndexOf('/')), { recursive: true })
    fs.writeFileSync(fullPath, data)
    return path
  }
  
  async download(path: string): Promise<Buffer> {
    return fs.readFileSync(`${this.basePath}/${path}`)
  }
  
  async exists(path: string): Promise<boolean> {
    return fs.existsSync(`${this.basePath}/${path}`)
  }
  
  async delete(path: string): Promise<void> {
    fs.unlinkSync(`${this.basePath}/${path}`)
  }
}

async function main() {
  console.log('🔧 WASM Activity Example\n')
  
  // Setup
  const blobStore = new FileBlobStore('./build')
  const executor = new WasmActivityExecutor(blobStore)
  
  // Activity definition
  const activity: ActivityDefinition = {
    name: 'echo',
    version: '1.0.0',
    wasmBlobPath: 'echo.wasm',
    limits: {
      maxMemoryMB: 128,
      maxExecutionMs: 5000,
    }
  }
  
  // Check if WASM file exists
  const wasmPath = path.join('./build', 'echo.wasm')
  if (!fs.existsSync(wasmPath)) {
    console.log('❌ echo.wasm not found!')
    console.log('📝 Build it first:')
    console.log('   npm run asbuild:echo')
    console.log('')
    console.log('For now, we\'ll just show how it WOULD work...\n')
    
    console.log('1️⃣  Activity defined:')
    console.log(JSON.stringify(activity, null, 2))
    
    console.log('\n2️⃣  Actor would call:')
    console.log('   const result = await this.callActivity("echo", { message: "Hello", times: 3 })')
    
    console.log('\n3️⃣  Runtime would:')
    console.log('   - Download WASM from blob storage')
    console.log('   - Compile and cache the module')
    console.log('   - Execute with JSON input')
    console.log('   - Return JSON output')
    
    console.log('\n4️⃣  Expected output:')
    console.log('   { result: "Hello Hello Hello", length: 17 }')
    
    return
  }
  
  // If WASM exists, actually run it!
  console.log('✅ Found echo.wasm, executing...\n')
  
  const input = {
    message: 'Hello Loom!',
    times: 3
  }
  
  console.log('📥 Input:', JSON.stringify(input))
  
  const result = await executor.execute(activity, input)
  
  console.log('📤 Output:', JSON.stringify(result, null, 2))
  console.log('\n✨ Activity executed successfully!')
}

main().catch(console.error)
