/**
 * SupervisorActor - Hierarchical multi-agent coordination
 * 
 * Provides:
 * - Team member management
 * - Task routing (manual or AI-powered)
 * - Delegation tracking
 * - Response aggregation
 * 
 * Philosophy: Simple coordinator pattern, ~200 lines
 */

import { Actor } from './actor'
import { AIActor } from './ai-actor'
import type { ActorContext } from './journal'
import type { LLMConfig, LLMMessage } from '../ai/llm-provider'

/**
 * Team member definition
 */
export interface TeamMember {
  name: string
  actorId: string
  description: string
  capabilities: string[]
}

/**
 * Supervisor configuration
 */
export interface SupervisorConfig {
  name: string
  description: string
  team: TeamMember[]
  llmConfig?: LLMConfig // Optional: For AI-powered routing
}

/**
 * Task delegation record
 */
export interface Delegation {
  taskId: string
  memberName: string
  actorId: string
  task: any
  status: 'pending' | 'in-progress' | 'completed' | 'failed'
  result?: any
  error?: string
  timestamp: string
}

/**
 * SupervisorActor base class
 */
export abstract class SupervisorActor extends AIActor {
  protected team: Map<string, TeamMember>
  protected config: SupervisorConfig
  protected delegations: Map<string, Delegation>

  constructor(context: ActorContext, config: SupervisorConfig) {
    super(context, {
      supervisor: config.name,
      delegations: {},
    })
    
    this.config = config
    this.team = new Map(config.team.map(m => [m.name, m]))
    this.delegations = new Map()

    // Initialize LLM if config provided (for AI routing)
    if (config.llmConfig) {
      this.initializeLLM(config.llmConfig)
    }
  }

  /**
   * Override this to implement custom routing logic
   * Return the name of the team member who should handle the task
   */
  protected abstract routeTask(task: any): Promise<string>

  /**
   * AI-powered routing using LLM
   * Only works if llmConfig was provided
   */
  protected async routeWithAI(task: any): Promise<string> {
    if (!this.llm) {
      throw new Error('AI routing requires LLM configuration')
    }

    // Build team description
    const teamDescription = Array.from(this.team.values())
      .map(m => `- ${m.name}: ${m.description} (capabilities: ${m.capabilities.join(', ')})`)
      .join('\n')

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are a task routing supervisor. Route tasks to the best team member.
        
Team:
${teamDescription}

Respond with ONLY the team member name, nothing else.`,
      },
      {
        role: 'user',
        content: `Task: ${JSON.stringify(task, null, 2)}`,
      },
    ]

    const memberName = (await this.chat(messages)).trim()

    // Validate the routing decision
    if (!this.team.has(memberName)) {
      throw new Error(`AI routing failed: ${memberName} is not a valid team member`)
    }

    return memberName
  }

  /**
   * Delegate task to a team member
   */
  protected async delegateTask(memberName: string, task: any): Promise<any> {
    const member = this.team.get(memberName)
    if (!member) {
      throw new Error(`Team member ${memberName} not found`)
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    // Create delegation record
    const delegation: Delegation = {
      taskId,
      memberName,
      actorId: member.actorId,
      task,
      status: 'pending',
      timestamp: new Date().toISOString(),
    }

    this.delegations.set(taskId, delegation)

    // Update state
    this.updateState(draft => {
      draft.delegations = {
        ...this.state.delegations as Record<string, Delegation>,
        [taskId]: delegation,
      }
    })

    // Send message to team member actor
    // In a real implementation, this would use the actor runtime's messaging system
    // For now, we'll use the existing sendMessage method
    await this.sendMessage(member.actorId, {
      type: 'task_assigned',
      taskId,
      task,
      supervisorId: this.context.actorId,
    })

    // Update delegation status
    delegation.status = 'in-progress'
    this.updateState(draft => {
      draft.delegations = {
        ...this.state.delegations as Record<string, Delegation>,
        [taskId]: delegation,
      }
    })

    // Wait for response
    // This is a simplified version - real implementation would use event suspension
    return this.waitForDelegationResponse(taskId)
  }

  /**
   * Wait for delegation response
   * In real implementation, this would use actor runtime's event system
   */
  private async waitForDelegationResponse(taskId: string): Promise<any> {
    // This is a placeholder - actual implementation would integrate with actor runtime
    // to suspend until response received
    const delegation = this.delegations.get(taskId)
    if (!delegation) {
      throw new Error(`Delegation ${taskId} not found`)
    }

    // For now, just return a placeholder
    // Real implementation would wait for message from team member
    return {
      taskId,
      status: 'placeholder - implement with actor runtime integration',
    }
  }

  /**
   * Handle response from team member
   * Call this when receiving a message from a delegated actor
   */
  protected async handleDelegationResponse(taskId: string, result: any, error?: string): Promise<void> {
    const delegation = this.delegations.get(taskId)
    if (!delegation) {
      throw new Error(`Delegation ${taskId} not found`)
    }

    delegation.status = error ? 'failed' : 'completed'
    delegation.result = result
    delegation.error = error

    this.updateState(draft => {
      draft.delegations = {
        ...this.state.delegations as Record<string, Delegation>,
        [taskId]: delegation,
      }
    })
  }

  /**
   * Execute supervision workflow
   * 1. Route task to team member
   * 2. Delegate task
   * 3. Wait for result
   * 4. Return result
   */
  async execute(task: any): Promise<any> {


    // Route the task
    const memberName = await this.routeTask(task)

    // Delegate to team member
    const result = await this.delegateTask(memberName, task)

    return result
  }

  /**
   * Get all team members
   */
  getTeam(): TeamMember[] {
    return Array.from(this.team.values())
  }

  /**
   * Get specific team member
   */
  getTeamMember(name: string): TeamMember | undefined {
    return this.team.get(name)
  }

  /**
   * Get all delegations
   */
  getDelegations(): Delegation[] {
    return Array.from(this.delegations.values())
  }

  /**
   * Get delegation by task ID
   */
  getDelegation(taskId: string): Delegation | undefined {
    return this.delegations.get(taskId)
  }
}
