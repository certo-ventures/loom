/**
 * Example: Discount Approval Agent
 * 
 * Demonstrates the Decision Trace System (Hybrid LLM Approach)
 * 
 * This agent:
 * 1. Gathers context from multiple systems (Salesforce, Zendesk, internal)
 * 2. Searches for precedent decisions
 * 3. Applies policy or requests approval for exceptions
 * 4. Records complete decision trace with WHY + WHAT
 * 
 * Decision traces are:
 * - Always captured with developer-written rationale (fast)
 * - Optionally enriched with LLM analysis (async, high-value decisions)
 * - Stored in journal (replayable)
 * - Eventually indexed in DecisionMemory (Phase 2)
 */

import { Actor } from '../src/actor/actor'
import type { DecisionInput } from '../src/actor/decision-trace'

interface DiscountRequest {
  customerId: string
  requestedDiscount: number  // 0.15 = 15%
  dealValue: number
  reason: string
}

interface DiscountDecision {
  approved: boolean
  discount: number
  reason: string
  requiresApproval: boolean
}

interface CustomerProfile {
  id: string
  name: string
  industry: string
  ARR: number
  lifetimeValue: number
}

interface SupportHealth {
  openTickets: number
  sev1Tickets: number
  avgResponseTime: number
  satisfaction: number
}

/**
 * Discount Approval Agent
 * 
 * Approves or rejects discount requests based on:
 * - Company policy (10% standard limit)
 * - Customer profile (ARR, industry, lifetime value)
 * - Support health (open tickets, severity)
 * - Historical precedent (similar customers/situations)
 * - Executive approval (for exceptions)
 */
export class DiscountApprovalAgent extends Actor {
  async execute(request: DiscountRequest): Promise<DiscountDecision> {
    // Get policy configuration
    const policy = await this.getConfig<{ maxDiscount: number; rules: string }>('discount-policy')

    // Step 1: Gather context from multiple systems
    const inputs: DecisionInput[] = []

    // Salesforce: Customer profile
    const customer = await this.gatherContext<CustomerProfile>({
      system: 'salesforce',
      entity: 'account',
      query: `SELECT Id, Name, Industry, ARR, LifetimeValue FROM Account WHERE Id = '${request.customerId}'`,
      relevance: 'Customer ARR and industry determine approval threshold',
      fetcher: async () => this.fetchCustomerProfile(request.customerId)
    })

    inputs.push({
      system: 'salesforce',
      entity: 'account',
      query: `Customer profile for ${request.customerId}`,
      result: customer,
      relevance: 'Customer ARR and industry determine approval threshold',
      retrievedAt: Date.now()
    })

    // Zendesk: Support health
    const supportHealth = await this.gatherContext<SupportHealth>({
      system: 'zendesk',
      entity: 'tickets',
      query: `SELECT COUNT(*), AVG(ResponseTime), AVG(Satisfaction) FROM Tickets WHERE CustomerId = '${request.customerId}'`,
      relevance: 'Active issues may justify discount exception',
      fetcher: async () => this.fetchSupportHealth(request.customerId)
    })

    inputs.push({
      system: 'zendesk',
      entity: 'tickets',
      query: `Support health for ${request.customerId}`,
      result: supportHealth,
      relevance: 'Active issues may justify discount exception',
      retrievedAt: Date.now()
    })

    // Step 2: Search for precedent decisions
    const precedents = await this.findPrecedents({
      decisionType: 'exception',
      contextSimilarity: {
        industry: customer.industry,
        arrRange: this.getARRRange(customer.ARR)
      },
      limit: 5
    })

    // Step 3: Make decision based on policy + context + precedent
    const decision = this.evaluateDiscount(request, customer, supportHealth, policy, precedents.length)

    // Step 4: Request approval if needed
    let approvers: any[] = []
    if (decision.requiresApproval) {
      const approval = await this.requestApproval({
        approvalType: 'discount_exception',
        reason: `${request.reason} - ${decision.reason}`,
        data: {
          customerId: request.customerId,
          requestedDiscount: request.requestedDiscount,
          recommendedDiscount: decision.discount,
          dealValue: request.dealValue
        },
        requiredRole: 'VP Sales'
      })

      if (!approval.approved) {
        decision.approved = false
        decision.reason = 'Approval denied by ' + approval.approver?.role
      } else if (approval.approver) {
        approvers.push({
          userId: approval.approver.userId,
          role: approval.approver.role,
          approvedAt: approval.approvedAt!,
          comment: approval.approver.comment
        })
      }
    }

    // Step 5: Record decision trace with full context
    const isException = decision.discount > policy.maxDiscount

    await this.recordDecision({
      decisionType: isException ? 'exception' : 'policy_application',
      rationale: decision.reason,
      reasoning: [
        `Customer ARR: $${customer.ARR.toLocaleString()}`,
        `Industry: ${customer.industry}`,
        `Requested discount: ${(request.requestedDiscount * 100).toFixed(0)}%`,
        `Approved discount: ${(decision.discount * 100).toFixed(0)}%`,
        `Policy maximum: ${(policy.maxDiscount * 100).toFixed(0)}%`,
        supportHealth.sev1Tickets > 0 ? `⚠️  ${supportHealth.sev1Tickets} critical support issues` : '✓ No critical issues',
        precedents.length > 0 ? `📋 ${precedents.length} similar precedents found` : 'No precedents',
        approvers.length > 0 ? `✓ VP approval obtained` : ''
      ].filter(Boolean),
      inputs,
      outcome: decision,
      policy: {
        id: 'discount-policy',
        version: '1.0',
        rule: policy.rules
      },
      precedents: precedents.map(p => p.decisionId),
      isException,
      exceptionReason: isException ? `Discount ${(decision.discount * 100).toFixed(0)}% exceeds policy limit ${(policy.maxDiscount * 100).toFixed(0)}%` : undefined,
      approvers,
      context: {
        customerId: request.customerId,
        dealValue: request.dealValue,
        industry: customer.industry,
        arrRange: this.getARRRange(customer.ARR)
      }
    })

    return decision
  }

  /**
   * Evaluate discount based on policy and context
   */
  private evaluateDiscount(
    request: DiscountRequest,
    customer: CustomerProfile,
    supportHealth: SupportHealth,
    policy: { maxDiscount: number; rules: string },
    precedentCount: number
  ): DiscountDecision {
    // Standard policy: up to 10% without approval
    if (request.requestedDiscount <= policy.maxDiscount) {
      return {
        approved: true,
        discount: request.requestedDiscount,
        reason: 'Within standard policy limits',
        requiresApproval: false
      }
    }

    // Exception logic: evaluate if we should recommend approval
    const factors = {
      highValue: customer.ARR >= 500000,  // $500k+ ARR
      healthcare: customer.industry === 'Healthcare',  // Healthcare vertical
      serviceIssues: supportHealth.sev1Tickets > 0,  // Active critical issues
      precedentExists: precedentCount > 0  // Similar exceptions granted before
    }

    // Count positive factors
    const positiveFactors = Object.values(factors).filter(Boolean).length

    if (positiveFactors >= 2) {
      // Strong case for exception
      return {
        approved: false,  // Needs approval
        discount: request.requestedDiscount,
        reason: this.buildExceptionReason(factors),
        requiresApproval: true
      }
    } else if (positiveFactors === 1) {
      // Weak case - recommend lower discount
      return {
        approved: false,
        discount: policy.maxDiscount,  // Cap at policy limit
        reason: 'Insufficient justification for requested discount - recommend policy maximum',
        requiresApproval: false
      }
    } else {
      // No justification
      return {
        approved: false,
        discount: policy.maxDiscount,
        reason: 'Request exceeds policy with no exceptional circumstances',
        requiresApproval: false
      }
    }
  }

  /**
   * Build human-readable exception reason
   */
  private buildExceptionReason(factors: Record<string, boolean>): string {
    const reasons: string[] = []
    if (factors.highValue) reasons.push('high-value customer ($500k+ ARR)')
    if (factors.healthcare) reasons.push('healthcare industry (strategic vertical)')
    if (factors.serviceIssues) reasons.push('active critical support issues')
    if (factors.precedentExists) reasons.push('similar exceptions granted previously')

    return `Exception justified by: ${reasons.join(', ')}`
  }

  /**
   * Get ARR range bucket for similarity matching
   */
  private getARRRange(arr: number): string {
    if (arr < 50000) return '0-50k'
    if (arr < 100000) return '50k-100k'
    if (arr < 250000) return '100k-250k'
    if (arr < 500000) return '250k-500k'
    if (arr < 1000000) return '500k-1M'
    return '1M+'
  }

  // Mock data fetchers (replace with real integrations)

  private async fetchCustomerProfile(customerId: string): Promise<CustomerProfile> {
    // TODO: Real Salesforce API call
    return {
      id: customerId,
      name: 'Acme Healthcare',
      industry: 'Healthcare',
      ARR: 500000,
      lifetimeValue: 2500000
    }
  }

  private async fetchSupportHealth(customerId: string): Promise<SupportHealth> {
    // TODO: Real Zendesk API call
    return {
      openTickets: 8,
      sev1Tickets: 3,
      avgResponseTime: 240,  // minutes
      satisfaction: 3.5  // out of 5
    }
  }
}

/**
 * Example Usage:
 * 
 * const agent = new DiscountApprovalAgent(context)
 * 
 * const result = await agent.execute({
 *   customerId: 'acme-healthcare',
 *   requestedDiscount: 0.15,  // 15%
 *   dealValue: 100000,
 *   reason: 'Customer experiencing service issues and requesting concession'
 * })
 * 
 * // Result will include full decision trace in journal:
 * // - Context gathered from Salesforce (customer profile)
 * // - Context gathered from Zendesk (support health)
 * // - Precedent search (similar healthcare customers)
 * // - Decision recorded with rationale, reasoning, inputs, precedents
 * // - Optional LLM enrichment (async) for deeper analysis
 * 
 * // Decision trace can later be:
 * // - Replayed from journal
 * // - Searched for precedent ("Show me healthcare exceptions")
 * // - Analyzed for patterns ("15 similar exceptions in last 30 days")
 * // - Promoted to policy ("Make this a rule")
 */
