/**
 * Show Redis Messages - Watch Redis commands in real-time
 * 
 * Run this WHILE the pipeline is executing to see actual Redis operations
 */

import { Redis } from 'ioredis'

async function main() {
  console.log('='.repeat(80))
  console.log('REDIS COMMAND MONITOR')
  console.log('Watching all Redis commands related to BullMQ and pipelines')
  console.log('='.repeat(80))
  console.log('\nPress Ctrl+C to stop\n')
  
  const redis = new Redis('redis://localhost:6379')
  const monitor = await redis.monitor()
  
  monitor.on('monitor', (time, args) => {
    const command = args.join(' ')
    
    // Show BullMQ operations
    if (
      command.includes('bull:actor-') ||
      command.includes('pipeline:') ||
      command.includes('pipeline-stage-results')
    ) {
      const timestamp = new Date(time * 1000).toISOString().substr(11, 12)
      const cmd = args[0].padEnd(8)
      const rest = args.slice(1).join(' ')
      
      // Color code by operation
      let prefix = ''
      if (args[0] === 'LPUSH' || args[0] === 'RPUSH') {
        prefix = '📥 ENQUEUE'
      } else if (args[0] === 'BRPOP') {
        prefix = '📤 DEQUEUE'
      } else if (args[0] === 'SET') {
        prefix = '💾 SAVE   '
      } else if (args[0] === 'GET') {
        prefix = '📖 READ   '
      } else if (args[0] === 'DEL') {
        prefix = '🗑️  DELETE '
      } else if (args[0] === 'PUBLISH') {
        prefix = '📡 PUBLISH'
      } else {
        prefix = '⚙️  ' + cmd
      }
      
      console.log(`${timestamp} ${prefix} ${rest.substring(0, 100)}`)
    }
  })
  
  // Keep alive
  await new Promise(() => {})
}

main().catch(console.error)
