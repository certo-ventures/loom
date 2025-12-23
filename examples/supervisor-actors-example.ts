/**
 * Example: Customer Support Supervisor
 * Demonstrates SupervisorActor with team coordination
 */

import { SupervisorActor, type TeamMember } from '../src/actor/supervisor-actor'
import type { ActorContext } from '../src/actor/journal'

interface CustomerIssue {
  issueId: string
  customerId: string
  category?: 'technical' | 'billing' | 'sales' | 'general'
  message: string
  priority: 'low' | 'medium' | 'high'
}

export class CustomerSupportSupervisor extends SupervisorActor {
  constructor(context: ActorContext) {
    const team: TeamMember[] = [
      {
        name: 'tech-support',
        actorId: 'tech-support-agent-1',
        description: 'Handles technical issues and troubleshooting',
        capabilities: ['debugging', 'system-issues', 'integration-help', 'api-support'],
      },
      {
        name: 'billing',
        actorId: 'billing-agent-1',
        description: 'Handles billing questions and account issues',
        capabilities: ['invoices', 'payments', 'subscriptions', 'refunds'],
      },
      {
        name: 'sales',
        actorId: 'sales-agent-1',
        description: 'Handles product questions and upsells',
        capabilities: ['pricing', 'features', 'demos', 'enterprise-sales'],
      },
      {
        name: 'general',
        actorId: 'general-support-agent-1',
        description: 'Handles general inquiries',
        capabilities: ['account-setup', 'onboarding', 'documentation'],
      },
    ]

    super(context, {
      name: 'customer-support-supervisor',
      description: 'Routes customer support queries to specialized agents',
      team,
      // Enable AI-powered routing
      llmConfig: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY || '',
        model: 'gpt-4o-mini',
        temperature: 0.3,
      },
    })
  }

  /**
   * Route based on category or use AI
   */
  protected async routeTask(issue: CustomerIssue): Promise<string> {
    // Simple rule-based routing if category is provided
    if (issue.category) {
      switch (issue.category) {
        case 'technical':
          return 'tech-support'
        case 'billing':
          return 'billing'
        case 'sales':
          return 'sales'
        default:
          return 'general'
      }
    }

    // Use AI for routing if no category
    return this.routeWithAI(issue)
  }
}

/**
 * Example: Loan Processing Supervisor
 * Demonstrates multi-step workflow coordination
 */

interface LoanApplication {
  applicationId: string
  applicantId: string
  amount: number
  income: number
  documents: string[]
}

export class LoanProcessingSupervisor extends SupervisorActor {
  constructor(context: ActorContext) {
    const team: TeamMember[] = [
      {
        name: 'document-verifier',
        actorId: 'doc-verifier-1',
        description: 'Verifies uploaded documents',
        capabilities: ['pdf-parsing', 'ocr', 'document-validation'],
      },
      {
        name: 'credit-checker',
        actorId: 'credit-checker-1',
        description: 'Checks credit score and history',
        capabilities: ['credit-api', 'score-analysis', 'history-review'],
      },
      {
        name: 'income-verifier',
        actorId: 'income-verifier-1',
        description: 'Verifies income with TLS Notary',
        capabilities: ['bank-api', 'tls-notary', 'income-calculation'],
      },
      {
        name: 'underwriter',
        actorId: 'underwriter-1',
        description: 'Makes final underwriting decision',
        capabilities: ['risk-assessment', 'policy-enforcement', 'decision-making'],
      },
    ]

    super(context, {
      name: 'loan-processing-supervisor',
      description: 'Coordinates multi-step loan processing workflow',
      team,
    })
  }

  /**
   * Sequential workflow - route based on processing step
   */
  protected async routeTask(task: any): Promise<string> {
    // Check which steps are complete
    const delegations = this.getDelegations()
    const completedSteps = new Set(
      delegations
        .filter(d => d.status === 'completed')
        .map(d => d.memberName)
    )

    // Process in order
    if (!completedSteps.has('document-verifier')) {
      return 'document-verifier'
    }
    if (!completedSteps.has('credit-checker')) {
      return 'credit-checker'
    }
    if (!completedSteps.has('income-verifier')) {
      return 'income-verifier'
    }
    // Final step
    return 'underwriter'
  }

  /**
   * Process full loan application workflow
   */
  async execute(application: LoanApplication): Promise<any> {
    const steps = [
      'document-verifier',
      'credit-checker',
      'income-verifier',
      'underwriter',
    ]

    const results: Record<string, any> = {}

    for (const step of steps) {
      const member = this.getTeamMember(step)
      if (!member) {
        throw new Error(`Team member ${step} not found`)
      }

      // Delegate to next step
      const result = await this.delegateTask(step, {
        ...application,
        previousResults: results,
      })

      results[step] = result

      // If any step fails, stop processing
      if (result.status === 'failed') {
        return {
          applicationId: application.applicationId,
          status: 'declined',
          reason: result.error,
          completedSteps: Object.keys(results),
        }
      }
    }

    return {
      applicationId: application.applicationId,
      status: 'completed',
      results,
    }
  }
}

/**
 * Example: AI Research Team Supervisor
 * Demonstrates AI-powered routing for research tasks
 */

export class ResearchTeamSupervisor extends SupervisorActor {
  constructor(context: ActorContext) {
    const team: TeamMember[] = [
      {
        name: 'data-analyst',
        actorId: 'analyst-1',
        description: 'Analyzes datasets and extracts insights',
        capabilities: ['statistics', 'data-cleaning', 'visualization', 'sql'],
      },
      {
        name: 'researcher',
        actorId: 'researcher-1',
        description: 'Conducts literature review and research',
        capabilities: ['web-search', 'paper-analysis', 'synthesis'],
      },
      {
        name: 'writer',
        actorId: 'writer-1',
        description: 'Writes reports and documentation',
        capabilities: ['technical-writing', 'editing', 'formatting'],
      },
      {
        name: 'reviewer',
        actorId: 'reviewer-1',
        description: 'Reviews and validates findings',
        capabilities: ['fact-checking', 'peer-review', 'quality-assurance'],
      },
    ]

    super(context, {
      name: 'research-team-supervisor',
      description: 'Coordinates research tasks across specialized team members',
      team,
      // AI-powered routing
      llmConfig: {
        provider: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        model: 'claude-3-5-sonnet-20241022',
        temperature: 0.3,
      },
    })
  }

  /**
   * Use AI to route all tasks
   */
  protected async routeTask(task: any): Promise<string> {
    return this.routeWithAI(task)
  }
}
