/**
 * GUN Relay Server for Multi-Node Testing
 * 
 * Provides central peer discovery for distributed LoomMesh nodes
 */

const Gun = require('gun')
const http = require('http')

const port = process.env.PORT || 8765

// Create HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'healthy', peers: Gun.state ? Object.keys(Gun.state).length : 0 }))
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('GUN Relay Server Running\n')
  }
})

// Attach GUN to server
const gun = Gun({ 
  web: server,
  axe: false // Disable AXE for relay
})

server.listen(port, () => {
  console.log(`🔫 GUN Relay Server running on port ${port}`)
  console.log(`   WebSocket: ws://localhost:${port}/gun`)
  console.log(`   HTTP: http://localhost:${port}/gun`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down relay server...')
  server.close(() => {
    console.log('Relay server stopped')
    process.exit(0)
  })
})
