#!/usr/bin/env node
// Test imports one by one

console.log('Step 1: Starting...')

console.log('Step 2: Importing express...')
import('express').then(() => {
  console.log('Step 3: Express OK')
  
  console.log('Step 4: Importing dotenv...')
  return import('dotenv')
}).then(() => {
  console.log('Step 5: dotenv OK')
  
  console.log('Step 6: Importing @certo-ventures/loom...')
  return import('@certo-ventures/loom')
}).then((loom) => {
  console.log('Step 7: Loom OK')
  console.log('Loom exports:', Object.keys(loom).slice(0, 10))
  process.exit(0)
}).catch(err => {
  console.error('ERROR:', err.message)
  process.exit(1)
})

// Safety timeout
setTimeout(() => {
  console.error('TIMEOUT after 5 seconds')
  process.exit(1)
}, 5000)
