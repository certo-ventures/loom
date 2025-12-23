/**
 * AI Research Team Example
 * 
 * Demonstrates a team of AI agents collaborating on research tasks:
 * - Research Lead: Coordinates research direction
 * - Data Analyst: Finds and analyzes information
 * - Technical Writer: Synthesizes findings into reports
 * - Fact Checker: Validates accuracy and sources
 * 
 * Features Showcased:
 * ✅ Shared Memory Store - Research findings shared across team
 * ✅ AI Coordination - Azure OpenAI picks best researcher for each task
 * ✅ Streaming Output - Real-time research progress
 * ✅ Natural Termination - AI knows when research is complete
 */

import 'dotenv/config'
import { GroupChatActor, type AgentParticipant } from '../src/actor/group-chat-actor'
import type { ActorContext } from '../src/actor/journal'
import { RedisSharedMemory } from '../src/shared-memory/redis-shared-memory'
import type { LLMConfig } from '../src/ai'
import Redis from 'ioredis'

async function main() {
  console.log('🔬 AI Research Team - Collaborative Research System\n')
  console.log('=' .repeat(80))
  console.log()

  // Setup infrastructure
  const redis = new Redis({
    host: 'localhost',
    port: 6379
  })

  const sharedMemory = new RedisSharedMemory(redis)

  // Configure AI coordinator
  const coordinatorConfig: LLMConfig | undefined = process.env.AZURE_OPENAI_API_KEY ? {
    provider: 'azure-openai',
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || 'https://your-resource.openai.azure.com',
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT || 'your-deployment-name',
    model: process.env.AZURE_OPENAI_MODEL || 'gpt-4o',
    temperature: 0.7,
    maxTokens: 300
  } : undefined

  if (!coordinatorConfig) {
    console.log('⚠️  Running without AI coordination (set AZURE_OPENAI_API_KEY to enable)\n')
  }

  // Define research team
  const researchTeam: AgentParticipant[] = [
    {
      name: 'Dr. Chen',
      role: 'Research Lead',
      description: 'Senior researcher who defines research questions, identifies gaps in knowledge, and coordinates the research direction. Expert at breaking down complex topics.'
    },
    {
      name: 'Maya',
      role: 'Data Analyst',
      description: 'Specializes in finding relevant data sources, analyzing trends, and extracting key insights from information. Strong quantitative and pattern recognition skills.'
    },
    {
      name: 'James',
      role: 'Technical Writer',
      description: 'Expert at synthesizing research findings into clear, comprehensive reports. Excellent at organizing information and explaining complex concepts.'
    },
    {
      name: 'Dr. Patel',
      role: 'Fact Checker',
      description: 'Validates research accuracy, checks sources, identifies potential biases, and ensures research integrity. Critical thinking specialist.'
    }
  ]

  console.log('🎓 Research Team Members:')
  researchTeam.forEach(member => {
    console.log(`  👤 ${member.name} - ${member.role}`)
    console.log(`     ${member.description}`)
  })
  console.log()

  // Research Task 1: AI Agent Frameworks
  console.log('=' .repeat(80))
  console.log('Research Task 1: Comparison of AI Agent Frameworks')
  console.log('=' .repeat(80))
  console.log()

  const context: ActorContext = {
    actorId: 'research-team-1',
    actorType: 'group-chat-actor',
    correlationId: 'research-1',
    sharedMemory
  }

  const groupChat = new GroupChatActor(context)

  const researchQuestion = `Research and compare the key differences between CrewAI, AutoGen, and LangGraph frameworks for AI agents. Focus on:
1. Architecture approaches
2. Multi-agent coordination methods
3. Key strengths and weaknesses
4. Best use cases for each`

  console.log('🔍 Research Question:')
  console.log(`   ${researchQuestion.split('\n')[0]}`)
  console.log()

  if (coordinatorConfig) {
    console.log('🤖 AI Coordinator will intelligently assign research tasks...\n')
  }

  // Store research question in shared memory
  await sharedMemory.write('research:question', researchQuestion)
  await sharedMemory.write('research:status', 'in-progress')

  let roundCount = 0
  const findings: string[] = []

  for await (const chunk of groupChat.stream({
    participants: researchTeam,
    initialMessage: researchQuestion,
    maxRounds: 8,
    terminationCondition: 'Research question is fully answered with comprehensive comparison',
    coordinatorConfig
  })) {
    if (chunk.type === 'progress') {
      roundCount = chunk.progress?.current || 0
      console.log(`\n📊 Round ${roundCount}`)
    } else if (chunk.data?.event === 'speaker-selected') {
      const speaker = researchTeam.find(m => m.name === chunk.data.speaker)
      if (speaker) {
        console.log(`   🎤 ${speaker.name} (${speaker.role}) conducting research...`)
        
        // Store assignment in shared memory
        await sharedMemory.append('research:assignments', {
          round: roundCount,
          researcher: speaker.name,
          role: speaker.role,
          timestamp: new Date().toISOString()
        })
      }
    } else if (chunk.data?.event === 'message') {
      const msg = chunk.data.message
      if (msg.role === 'agent') {
        const preview = msg.content.substring(0, 120)
        console.log(`   💬 ${msg.name}: ${preview}...`)
        
        findings.push(`${msg.name}: ${msg.content}`)
        
        // Store findings in shared memory
        await sharedMemory.append('research:findings', {
          researcher: msg.name,
          content: msg.content,
          timestamp: new Date().toISOString()
        })
      }
    } else if (chunk.data?.event === 'termination-detected') {
      console.log(`\n   ✅ ${chunk.data.reason}`)
      await sharedMemory.write('research:status', 'complete')
    } else if (chunk.type === 'complete') {
      console.log(`\n✨ Research completed after ${chunk.data?.rounds} rounds`)
      console.log(`   Status: ${chunk.data?.status}`)
      
      // Store completion
      await sharedMemory.write('research:completed_at', new Date().toISOString())
      await sharedMemory.write('research:total_rounds', chunk.data?.rounds || 0)
    }
  }

  // Show shared memory research data
  console.log('\n\n' + '='.repeat(80))
  console.log('📚 Research Data in Shared Memory')
  console.log('=' .repeat(80))
  console.log()

  const researchStatus = await sharedMemory.read('research:status')
  const completedAt = await sharedMemory.read('research:completed_at')
  const totalRounds = await sharedMemory.read('research:total_rounds')

  console.log('Research Metadata:')
  console.log(`  Status: ${researchStatus}`)
  console.log(`  Completed: ${completedAt}`)
  console.log(`  Total Rounds: ${totalRounds}`)
  console.log()

  const assignments = await sharedMemory.readList('research:assignments')
  console.log(`Research Assignments (${assignments.length} total):`)
  assignments.slice(0, 3).forEach((assignment: any, idx) => {
    console.log(`  ${idx + 1}. Round ${assignment.round}: ${assignment.researcher} (${assignment.role})`)
  })
  if (assignments.length > 3) {
    console.log(`  ... and ${assignments.length - 3} more assignments`)
  }
  console.log()

  const storedFindings = await sharedMemory.readList('research:findings')
  console.log(`Research Findings (${storedFindings.length} contributions):`)
  storedFindings.slice(0, 2).forEach((finding: any, idx) => {
    console.log(`  ${idx + 1}. ${finding.researcher}: ${finding.content.substring(0, 80)}...`)
  })
  if (storedFindings.length > 2) {
    console.log(`  ... and ${storedFindings.length - 2} more findings`)
  }
  console.log()

  // Generate research summary
  console.log('=' .repeat(80))
  console.log('📄 Research Summary Report')
  console.log('=' .repeat(80))
  console.log()
  console.log('Research Question:')
  console.log(`  ${researchQuestion.split('\n')[0]}`)
  console.log()
  console.log('Team Collaboration:')
  console.log(`  • ${assignments.length} research tasks assigned`)
  console.log(`  • ${storedFindings.length} findings contributed`)
  console.log(`  • ${totalRounds} rounds of collaboration`)
  console.log()
  console.log('Key Features Demonstrated:')
  console.log('  ✅ Shared Memory - All findings stored in Redis')
  console.log('  ✅ AI Coordination - Intelligent task assignment')
  console.log('  ✅ Streaming - Real-time research progress')
  console.log('  ✅ Collaboration - Multiple specialists working together')
  console.log()

  // Cleanup
  console.log('🧹 Cleaning up...')
  const keys = await redis.keys('chat:conv-*')
  const researchKeys = await redis.keys('research:*')
  const allKeys = [...keys, ...researchKeys]
  
  if (allKeys.length > 0) {
    await redis.del(...allKeys)
    console.log(`   Deleted ${allKeys.length} keys from Redis`)
  }

  await redis.quit()
  
  console.log('\n✅ Research team demonstration complete!\n')
  console.log('=' .repeat(80))
  console.log('🎯 REMAINING ORIGINAL GOALS (NOT IMPLEMENTED YET):')
  console.log('=' .repeat(80))
  console.log()
  console.log('1. ⏳ Workflow Loops (While/Until/DoUntil/Retry) - ~250 lines')
  console.log('   Design: docs/WORKFLOW_LOOPS_DESIGN.md')
  console.log('   Use case: Iterative research refinement')
  console.log()
  console.log('2. ⏳ Secrets Management (Azure Key Vault integration) - ~100 lines')
  console.log('   Use case: Secure API keys for external research sources')
  console.log()
  console.log('3. ⏳ Bindings/Connectors (HTTP, Kafka, Azure Service Bus) - ~200 lines')
  console.log('   Use case: Connect to external research databases')
  console.log()
  console.log('=' .repeat(80))
  console.log('📊 COMPLETION STATUS: 3 of 6 original goals + 4 bonus features')
  console.log('=' .repeat(80))
}

main().catch(console.error)
