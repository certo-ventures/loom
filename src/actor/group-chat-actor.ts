/**
 * Group Chat Actor - Multi-agent conversation with AI coordinator
 * 
 * Enables multiple agents to collaborate through natural dialogue
 * with dynamic speaker selection powered by AI.
 * 
 * Features:
 * - ✅ Automatic context - Full conversation history in AI prompts
 * - ✅ Smart coordination - AI selects next speaker based on context
 * - ✅ Natural termination - AI detects when goal is achieved
 * - ✅ Streaming output - Real-time updates via AsyncGenerator
 */

import { Actor } from './actor'
import type { ActorContext } from './journal'
import type { StreamChunk } from '../streaming/types'
import { LLMClient, type LLMConfig, type ConversationMessage as AIMessage } from '../ai'

/**
 * Message in conversation history
 */
export interface ConversationMessage {
  id: string
  timestamp: Date
  role: 'user' | 'agent' | 'system'
  name?: string
  content: string
}

/**
 * Agent participant in group chat
 */
export interface AgentParticipant {
  name: string
  role: string
  description: string
  actor?: Actor
}

/**
 * Group chat input
 */
export interface GroupChatInput {
  participants: AgentParticipant[]
  initialMessage: string
  maxRounds?: number
  terminationCondition?: string
  coordinatorConfig?: LLMConfig // AI coordinator configuration
}

/**
 * Group chat result
 */
export interface GroupChatResult {
  conversationId: string
  rounds: number
  status: 'complete' | 'max-rounds' | 'error'
  history: ConversationMessage[]
  summary?: string
}

/**
 * GroupChatActor - Orchestrates multi-agent conversations
 * 
 * Features:
 * - AI-based speaker selection (coordinator picks next speaker intelligently)
 * - Conversation history in shared memory
 * - Support for streaming updates
 * - AI-powered termination detection
 * - Automatic context building
 */
export class GroupChatActor extends Actor {
  private coordinator?: LLMClient

  async execute(input: unknown): Promise<void> {
    const chatInput = input as GroupChatInput
    
    // Initialize AI coordinator if config provided
    if (chatInput.coordinatorConfig) {
      this.coordinator = new LLMClient(chatInput.coordinatorConfig)
    }
    
    const result = await this.runGroupChat(chatInput)
    this.updateState({ result })
  }

  /**
   * Stream group chat with real-time updates
   */
  async *stream(input: unknown): AsyncGenerator<StreamChunk, void, unknown> {
    yield { type: 'start' }

    const chatInput = input as GroupChatInput
    
    // Initialize AI coordinator if config provided
    if (chatInput.coordinatorConfig) {
      this.coordinator = new LLMClient(chatInput.coordinatorConfig)
    }
    
    const conversationId = this.generateConversationId()
    const maxRounds = chatInput.maxRounds || 10
    const history: ConversationMessage[] = []

    // Initialize conversation with user message
    const initialMsg: ConversationMessage = {
      id: this.generateMessageId(),
      timestamp: new Date(),
      role: 'user',
      content: chatInput.initialMessage
    }
    history.push(initialMsg)

    // Store in shared memory if available
    if (this.context.sharedMemory) {
      await this.context.sharedMemory.append(
        `chat:${conversationId}:history`,
        initialMsg
      )
    }

    yield {
      type: 'data',
      data: {
        event: 'message',
        message: initialMsg
      }
    }

    let round = 0
    while (round < maxRounds) {
      round++

      yield {
        type: 'progress',
        progress: {
          current: round,
          total: maxRounds,
          message: `Round ${round}/${maxRounds}`
        }
      }

      // AI-based termination check (if coordinator available)
      if (this.coordinator && round > 1) {
        const shouldTerminate = await this.checkTermination(
          history,
          chatInput.participants,
          chatInput.terminationCondition
        )
        
        if (shouldTerminate) {
          yield {
            type: 'data',
            data: {
              event: 'termination-detected',
              reason: 'AI coordinator detected goal achievement'
            }
          }
          
          yield {
            type: 'complete',
            data: {
              conversationId,
              rounds: round,
              status: 'complete',
              history
            }
          }
          return
        }
      }

      // Select next speaker (AI-based if coordinator available)
      const nextSpeaker = await this.selectSpeaker(
        history,
        chatInput.participants,
        chatInput.terminationCondition
      )

      yield {
        type: 'data',
        data: {
          event: 'speaker-selected',
          speaker: nextSpeaker,
          round
        }
      }

      // Check for termination
      if (nextSpeaker === 'TERMINATE') {
        yield {
          type: 'complete',
          data: {
            conversationId,
            rounds: round,
            status: 'complete',
            history
          }
        }
        return
      }

      // Get agent response
      const agent = chatInput.participants.find(p => p.name === nextSpeaker)
      if (!agent) {
        throw new Error(`Agent not found: ${nextSpeaker}`)
      }

      const response = await this.getAgentResponse(agent, history, chatInput.participants)

      const message: ConversationMessage = {
        id: this.generateMessageId(),
        timestamp: new Date(),
        role: 'agent',
        name: agent.name,
        content: response
      }
      history.push(message)

      // Store in shared memory
      if (this.context.sharedMemory) {
        await this.context.sharedMemory.append(
          `chat:${conversationId}:history`,
          message
        )
      }

      yield {
        type: 'data',
        data: {
          event: 'message',
          message
        }
      }
    }

    yield {
      type: 'complete',
      data: {
        conversationId,
        rounds: maxRounds,
        status: 'max-rounds',
        history
      }
    }
  }

  /**
   * Run group chat (non-streaming)
   */
  private async runGroupChat(input: GroupChatInput): Promise<GroupChatResult> {
    const conversationId = this.generateConversationId()
    const maxRounds = input.maxRounds || 10
    const history: ConversationMessage[] = []

    // Add initial message
    history.push({
      id: this.generateMessageId(),
      timestamp: new Date(),
      role: 'user',
      content: input.initialMessage
    })

    let round = 0
    while (round < maxRounds) {
      round++

      // AI-based termination check (if coordinator available)
      if (this.coordinator && round > 1) {
        const shouldTerminate = await this.checkTermination(
          history,
          input.participants,
          input.terminationCondition
        )
        
        if (shouldTerminate) {
          return {
            conversationId,
            rounds: round,
            status: 'complete',
            history
          }
        }
      }

      // Select next speaker (AI-based if coordinator available)
      const nextSpeaker = await this.selectSpeaker(
        history,
        input.participants,
        input.terminationCondition
      )

      if (nextSpeaker === 'TERMINATE') {
        return {
          conversationId,
          rounds: round,
          status: 'complete',
          history
        }
      }

      // Get agent response
      const agent = input.participants.find(p => p.name === nextSpeaker)
      if (!agent) {
        throw new Error(`Agent not found: ${nextSpeaker}`)
      }

      const response = await this.getAgentResponse(agent, history, input.participants)

      history.push({
        id: this.generateMessageId(),
        timestamp: new Date(),
        role: 'agent',
        name: agent.name,
        content: response
      })
    }

    return {
      conversationId,
      rounds: maxRounds,
      status: 'max-rounds',
      history
    }
  }

  /**
   * AI coordinator selects next speaker based on conversation context
   * 
   * Features:
   * ✅ Automatic context - Builds full conversation history automatically
   * ✅ Smart coordination - AI analyzes context and picks best speaker
   */
  private async selectSpeaker(
    history: ConversationMessage[],
    participants: AgentParticipant[],
    terminationCondition?: string
  ): Promise<string> {
    // If AI coordinator is available, use it for intelligent selection
    if (this.coordinator) {
      return this.aiSelectSpeaker(history, participants, terminationCondition)
    }

    // Fallback to round-robin if no coordinator
    return this.roundRobinSelectSpeaker(history, participants)
  }

  /**
   * AI-powered speaker selection (Claude-style)
   */
  private async aiSelectSpeaker(
    history: ConversationMessage[],
    participants: AgentParticipant[],
    terminationCondition?: string
  ): Promise<string> {
    // ✅ Automatic context building - Full conversation history
    const conversationText = history
      .map(m => {
        const role = m.role === 'agent' ? m.name : m.role.toUpperCase()
        const time = new Date(m.timestamp).toLocaleTimeString()
        return `[${time}] ${role}: ${m.content}`
      })
      .join('\n')

    // Build participant descriptions with capabilities
    const participantList = participants
      .map(p => `- ${p.name} (${p.role}): ${p.description}`)
      .join('\n')

    // Build termination criteria
    const terminationText = terminationCondition
      ? `\n\nGoal: ${terminationCondition}\nIf this goal has been achieved, respond with "TERMINATE".`
      : '\n\nIf the conversation has naturally concluded or the goal is complete, respond with "TERMINATE".'

    // Construct AI prompt
    const systemPrompt = `You are an intelligent conversation coordinator. Your job is to analyze the conversation and decide who should speak next to make the most progress.

Available Participants:
${participantList}

Consider:
- What has been discussed so far
- What still needs to be done
- Which participant is best suited for the next step
- Whether the goal has been achieved

Respond with ONLY the participant name (e.g., "Alice") or "TERMINATE" if done.`

    const userPrompt = `Conversation so far:
${conversationText}
${terminationText}

Who should speak next?`

    try {
      // Call AI coordinator
      const response = await this.coordinator!.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ])

      const choice = response.content.trim()

      // Validate response
      if (choice === 'TERMINATE') {
        return 'TERMINATE'
      }

      // Check if valid participant
      const participant = participants.find(
        p => p.name.toLowerCase() === choice.toLowerCase()
      )

      if (participant) {
        return participant.name
      }

      // If AI returned invalid name, fall back to round-robin
      console.warn(`AI coordinator returned invalid participant: ${choice}, falling back to round-robin`)
      return this.roundRobinSelectSpeaker(history, participants)

    } catch (error) {
      console.error('AI coordinator error:', error)
      // Fall back to round-robin on error
      return this.roundRobinSelectSpeaker(history, participants)
    }
  }

  /**
   * Simple round-robin speaker selection (fallback)
   */
  private roundRobinSelectSpeaker(
    history: ConversationMessage[],
    participants: AgentParticipant[]
  ): Promise<string> {
    const lastSpeaker = history[history.length - 1]
    const lastAgentName = lastSpeaker.role === 'agent' ? lastSpeaker.name : null

    // Simple keyword-based termination
    if (history.length > 3) {
      const recentMessages = history.slice(-3)
      const hasComplete = recentMessages.some(m => 
        m.content.toLowerCase().includes('complete') ||
        m.content.toLowerCase().includes('done') ||
        m.content.toLowerCase().includes('finished')
      )
      if (hasComplete) {
        return Promise.resolve('TERMINATE')
      }
    }

    // Round-robin selection
    if (!lastAgentName) {
      return Promise.resolve(participants[0].name)
    }

    const currentIndex = participants.findIndex(p => p.name === lastAgentName)
    const nextIndex = (currentIndex + 1) % participants.length
    return Promise.resolve(participants[nextIndex].name)
  }

  /**
   * Check if conversation should terminate (AI-powered)
   * 
   * ✅ Natural termination - AI detects when goal is achieved
   */
  private async checkTermination(
    history: ConversationMessage[],
    participants: AgentParticipant[],
    terminationCondition?: string
  ): Promise<boolean> {
    if (!this.coordinator) {
      return false
    }

    // Build conversation summary
    const conversationText = history
      .slice(-5) // Last 5 messages
      .map(m => {
        const role = m.role === 'agent' ? m.name : m.role.toUpperCase()
        return `${role}: ${m.content}`
      })
      .join('\n')

    const goalText = terminationCondition || 'the task is complete'

    const systemPrompt = `You are analyzing a group conversation to determine if it should end.
    
The goal is: ${goalText}

Analyze the recent conversation and determine if:
1. The goal has been achieved
2. The conversation has reached a natural conclusion
3. All necessary steps have been completed

Respond with ONLY "YES" if the conversation should end, or "NO" if it should continue.`

    const userPrompt = `Recent conversation:
${conversationText}

Should this conversation terminate?`

    try {
      const response = await this.coordinator.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ])

      const answer = response.content.trim().toUpperCase()
      return answer === 'YES' || answer.startsWith('YES')

    } catch (error) {
      console.error('Termination check error:', error)
      return false
    }
  }

  /**
   * Get response from an agent
   */
  private async getAgentResponse(
    agent: AgentParticipant,
    history: ConversationMessage[],
    participants: AgentParticipant[]
  ): Promise<string> {
    // If agent has Actor implementation, use it
    if (agent.actor) {
      await agent.actor.execute({
        conversationHistory: history,
        participants
      })
      // Get response from actor state (simplified)
      return `[${agent.name} completed their task]`
    }

    // Simulate agent response based on role
    const lastMessage = history[history.length - 1]
    return `As ${agent.role}, I'll work on: ${lastMessage.content}`
  }

  /**
   * Generate unique conversation ID
   */
  private generateConversationId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}
