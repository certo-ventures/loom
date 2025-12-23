/**
 * AI-Powered Group Chat Example
 * 
 * Demonstrates Claude-style features:
 * ✅ Automatic context - No need for explicit memory sharing
 * ✅ Smart coordination - AI selects next speaker intelligently
 * ✅ Natural termination - AI detects when goal is achieved
 * ✅ Built-in streaming - SSE out of the box
 */

import 'dotenv/config'
import { GroupChatActor, type AgentParticipant } from '../src/actor/group-chat-actor'
import type { ActorContext } from '../src/actor/journal'
import { RedisSharedMemory } from '../src/shared-memory/redis-shared-memory'
import type { LLMConfig } from '../src/ai'
import Redis from 'ioredis'
import * as http from 'http'
import { handleGroupChatSSE } from '../src/streaming/sse-handler'

async function main() {
  console.log('🤖 AI-Powered Group Chat Example\n')

  // Setup Redis and shared memory
  const redis = new Redis({
    host: 'localhost',
    port: 6379
  })

  const sharedMemory = new RedisSharedMemory(redis)

  // Configure AI coordinator (Azure OpenAI GPT-4o)
  // Loads from .env file:
  //   AZURE_OPENAI_API_KEY
  //   AZURE_OPENAI_ENDPOINT
  //   AZURE_OPENAI_DEPLOYMENT
  //   AZURE_OPENAI_MODEL
  const coordinatorConfig: LLMConfig | undefined = process.env.AZURE_OPENAI_API_KEY ? {
    provider: 'azure-openai',
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || 'https://your-resource.openai.azure.com',
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT || 'your-deployment-name',
    model: process.env.AZURE_OPENAI_MODEL || 'gpt-4o',
    temperature: 0.7,
    maxTokens: 200
  } : undefined

  if (!coordinatorConfig) {
    console.log('⚠️  Azure OpenAI not configured - will use fallback round-robin speaker selection')
    console.log('   Create .env file with AZURE_OPENAI_API_KEY to enable AI coordination\n')
  } else {
    console.log('✅ Azure OpenAI coordinator enabled')
    console.log(`   Endpoint: ${coordinatorConfig.endpoint}`)
    console.log(`   Deployment: ${coordinatorConfig.deploymentName}`)
    console.log(`   Model: ${coordinatorConfig.model}\n`)
  }

  // Define team members
  const team: AgentParticipant[] = [
    {
      name: 'Sarah',
      role: 'Product Manager',
      description: 'Defines requirements, priorities, and success criteria. Focuses on user needs and business value.'
    },
    {
      name: 'Alex',
      role: 'Software Architect',
      description: 'Designs system architecture, makes technical decisions, considers scalability and performance.'
    },
    {
      name: 'Jordan',
      role: 'Developer',
      description: 'Implements features, writes code, focuses on best practices and code quality.'
    },
    {
      name: 'Taylor',
      role: 'QA Engineer',
      description: 'Tests functionality, identifies edge cases, ensures quality and reliability.'
    }
  ]

  console.log('Team Members:')
  team.forEach(member => {
    console.log(`  👤 ${member.name} - ${member.role}`)
    console.log(`     ${member.description}`)
  })
  console.log()

  // Example 1: AI-Coordinated Conversation
  console.log('=' .repeat(80))
  console.log('Example 1: AI-Powered Speaker Selection')
  console.log('=' .repeat(80))
  console.log()

  const context: ActorContext = {
    actorId: 'ai-group-chat',
    actorType: 'group-chat-actor',
    correlationId: 'example-1',
    sharedMemory
  }

  const groupChat = new GroupChatActor(context)

  console.log('💬 Task: Design and implement a user authentication system\n')
  console.log('🤖 AI Coordinator will intelligently select who speaks next...\n')

  let round = 0
  for await (const chunk of groupChat.stream({
    participants: team,
    initialMessage: 'We need to design and implement a secure user authentication system with JWT tokens. Let\'s collaborate on this.',
    maxRounds: 8,
    terminationCondition: 'Complete authentication system design and implementation plan',
    coordinatorConfig // ✅ AI coordinator enabled!
  })) {
    if (chunk.type === 'progress') {
      round = chunk.progress?.current || 0
      console.log(`\n📊 Round ${round}`)
    } else if (chunk.data?.event === 'speaker-selected') {
      const speaker = team.find(m => m.name === chunk.data.speaker)
      if (speaker) {
        console.log(`   🎤 AI selected: ${speaker.name} (${speaker.role})`)
      }
    } else if (chunk.data?.event === 'message') {
      const msg = chunk.data.message
      if (msg.role === 'agent') {
        console.log(`   💬 ${msg.name}: ${msg.content.substring(0, 100)}...`)
      }
    } else if (chunk.data?.event === 'termination-detected') {
      console.log(`\n   ✅ ${chunk.data.reason}`)
    } else if (chunk.type === 'complete') {
      console.log(`\n✨ Conversation completed after ${chunk.data?.rounds} rounds`)
      console.log(`   Status: ${chunk.data?.status}`)
      
      // ✅ Automatic context - Full history available
      console.log(`\n📚 Conversation History (${chunk.data?.history.length} messages):`)
      chunk.data?.history.slice(0, 3).forEach((msg: any) => {
        const speaker = msg.role === 'agent' ? msg.name : 'USER'
        console.log(`   ${speaker}: ${msg.content.substring(0, 80)}...`)
      })
      if (chunk.data?.history.length > 3) {
        console.log(`   ... and ${chunk.data.history.length - 3} more messages`)
      }
    }
  }

  // Example 2: SSE Streaming Server
  console.log('\n\n' + '='.repeat(80))
  console.log('Example 2: SSE Streaming Server')
  console.log('=' .repeat(80))
  console.log()

  console.log('🌐 Starting HTTP server with SSE endpoint...')

  const server = http.createServer(async (req, res) => {
    if (req.url === '/chat' && req.method === 'GET') {
      console.log('   📡 Client connected to SSE stream')

      const sseContext: ActorContext = {
        actorId: 'sse-group-chat',
        actorType: 'group-chat-actor',
        correlationId: 'sse-example',
        sharedMemory
      }

      await handleGroupChatSSE(req, res, {
        participants: team.slice(0, 2), // Just 2 participants for demo
        initialMessage: 'Quick design review: How should we structure the authentication API?',
        maxRounds: 4,
        terminationCondition: 'API structure decided',
        coordinatorConfig
      }, sseContext)

      console.log('   ✅ SSE stream completed')

    } else if (req.url === '/' && req.method === 'GET') {
      // Serve HTML client
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>Group Chat SSE Demo</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    #messages { 
      background: white; 
      padding: 20px; 
      border-radius: 8px; 
      max-width: 800px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .message { 
      margin: 10px 0; 
      padding: 10px; 
      border-left: 3px solid #4CAF50;
      background: #f9f9f9;
    }
    .speaker { font-weight: bold; color: #2196F3; }
    .round { color: #666; font-size: 0.9em; }
    .complete { color: #4CAF50; font-weight: bold; }
  </style>
</head>
<body>
  <h1>🎭 AI-Powered Group Chat (Live Stream)</h1>
  <div id="messages"></div>
  
  <script>
    const eventSource = new EventSource('/chat');
    const messagesDiv = document.getElementById('messages');
    
    eventSource.addEventListener('connected', (e) => {
      const data = JSON.parse(e.data);
      messagesDiv.innerHTML += '<div class="message">📡 ' + data.message + '</div>';
    });
    
    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      messagesDiv.innerHTML += '<div class="message round">📊 ' + data.progress.message + '</div>';
    });
    
    eventSource.addEventListener('data', (e) => {
      const chunk = JSON.parse(e.data);
      if (chunk.data?.event === 'speaker-selected') {
        messagesDiv.innerHTML += '<div class="message"><span class="speaker">🎤 ' + chunk.data.speaker + ' selected</span></div>';
      } else if (chunk.data?.event === 'message') {
        const msg = chunk.data.message;
        messagesDiv.innerHTML += '<div class="message"><span class="speaker">' + msg.name + ':</span> ' + msg.content + '</div>';
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
    
    eventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      messagesDiv.innerHTML += '<div class="message complete">✅ Completed in ' + data.data.rounds + ' rounds</div>';
      eventSource.close();
    });
    
    eventSource.addEventListener('error', (e) => {
      messagesDiv.innerHTML += '<div class="message" style="border-color: red;">❌ Error occurred</div>';
      eventSource.close();
    });
  </script>
</body>
</html>
      `)

    } else {
      res.writeHead(404)
      res.end('Not Found')
    }
  })

  const PORT = 3000
  server.listen(PORT, () => {
    console.log(`   ✅ Server running at http://localhost:${PORT}`)
    console.log(`   📱 Open browser to see live SSE streaming`)
    console.log(`   🔗 http://localhost:${PORT}/\n`)
  })

  // Wait a bit then trigger one request
  await new Promise(resolve => setTimeout(resolve, 2000))
  console.log('   📡 Making test SSE request...\n')

  // Trigger the SSE endpoint programmatically
  const testReq = http.get(`http://localhost:${PORT}/chat`, (res) => {
    console.log('   Status:', res.statusCode)
    res.on('data', (chunk) => {
      process.stdout.write(chunk.toString())
    })
    res.on('end', () => {
      console.log('\n   ✅ SSE test complete\n')
      
      // Shutdown
      server.close()
      redis.quit()
      
      console.log('✅ All examples complete!\n')
      console.log('Key Features Demonstrated:')
      console.log('  ✅ Automatic context - Full conversation history in AI prompts')
      console.log('  ✅ Smart coordination - AI intelligently selects next speaker')
      console.log('  ✅ Natural termination - AI detects when goal is achieved')
      console.log('  ✅ Built-in streaming - SSE for real-time browser updates')
    })
  })

  testReq.on('error', (err) => {
    console.error('Request error:', err)
    server.close()
    redis.quit()
  })
}

main().catch(console.error)
