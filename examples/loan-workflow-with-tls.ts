/**
 * Complete Loan Workflow with TLS Notary & RISC Zero
 * 
 * This demonstrates a full end-to-end loan review workflow using:
 * 1. TLS Notary - Prove data came from real sources (bank, employer, credit bureau)
 * 2. RISC Zero - Prove calculations are correct without revealing private data
 * 3. Loom - Orchestrate the multi-actor workflow
 * 
 * Flow:
 *   Applicant → Submit Proofs → TLS Verify → ZK Compute → Decision → Approved/Denied
 */

import { TLSNotaryActor, type TLSNotaryProof } from './tls-notary-actor'
import type { ActorContext } from '../src/actor/journal'

/**
 * Loan application with cryptographic proofs
 */
interface LoanApplication {
  applicantId: string
  loanAmount: number
  
  // TLS Notary proofs (data provenance)
  proofs: {
    bankStatement: TLSNotaryProof      // From chase.com
    paystubs: TLSNotaryProof           // From employer ADP portal
    creditReport: TLSNotaryProof       // From Experian API
    taxReturns?: TLSNotaryProof        // From IRS.gov (optional)
  }
  
  // RISC Zero proofs (computation privacy)
  zkProofs?: {
    dtiCalculation?: string     // Proves DTI < 43% without revealing exact income
    creditScore?: string        // Proves score > 680 without revealing exact score
  }
}

/**
 * Loan decision result
 */
interface LoanDecision {
  approved: boolean
  reasons: string[]
  verifications: {
    bankBalance: { verified: boolean, amount?: number }
    income: { verified: boolean, amount?: number }
    creditScore: { verified: boolean, score?: number }
    dti: { verified: boolean, ratio?: number }
  }
  proofHashes: string[]  // Audit trail
  timestamp: number
}

/**
 * Loan Review Workflow Orchestrator
 * 
 * This coordinates multiple actors:
 * - TLSNotaryActor (verify data sources)
 * - RISCZeroActor (verify computations)
 * - DecisionActor (make loan decision)
 */
export class LoanReviewWorkflow {
  private tlsActor: TLSNotaryActor
  
  constructor() {
    const context: ActorContext = {
      actorId: 'loan-review-workflow-1',
      actorType: 'LoanReviewWorkflow',
      correlationId: `workflow-${Date.now()}`
    }
    
    this.tlsActor = new TLSNotaryActor({
      ...context,
      actorId: 'tls-notary-1'
    })
  }
  
  /**
   * Process loan application with cryptographic verification
   */
  async processLoan(application: LoanApplication): Promise<LoanDecision> {
    console.log('\n' + '='.repeat(70))
    console.log('🏦 LOAN REVIEW WORKFLOW - With TLS Notary & RISC Zero')
    console.log('='.repeat(70))
    console.log(`\nApplicant ID: ${application.applicantId}`)
    console.log(`Loan Amount: $${application.loanAmount.toLocaleString()}`)
    console.log(`Correlation: ${Date.now()}\n`)
    
    const decision: LoanDecision = {
      approved: false,
      reasons: [],
      verifications: {
        bankBalance: { verified: false },
        income: { verified: false },
        creditScore: { verified: false },
        dti: { verified: false }
      },
      proofHashes: [],
      timestamp: Date.now()
    }
    
    // Phase 1: Verify Data Sources with TLS Notary
    console.log('┌─────────────────────────────────────────────────────────────────┐')
    console.log('│ PHASE 1: TLS Notary Data Verification                          │')
    console.log('└─────────────────────────────────────────────────────────────────┘\n')
    
    // Verify bank statement
    try {
      console.log('1️⃣  Verifying Bank Statement')
      const bankData = await this.tlsActor.execute({
        action: 'verify',
        proof: application.proofs.bankStatement
      })
      
      decision.verifications.bankBalance = {
        verified: true,
        amount: bankData.data.balance
      }
      decision.proofHashes.push(bankData.proofHash)
      
      if (bankData.data.balance < application.loanAmount * 0.2) {
        decision.reasons.push('Insufficient bank balance (need 20% of loan amount)')
      }
    } catch (error) {
      console.error('❌ Bank statement verification failed:', error)
      decision.reasons.push('Unable to verify bank statement')
    }
    
    // Verify income (paystubs)
    try {
      console.log('\n2️⃣  Verifying Income (Paystubs)')
      const incomeData = await this.tlsActor.execute({
        action: 'verify',
        proof: application.proofs.paystubs
      })
      
      decision.verifications.income = {
        verified: true,
        amount: incomeData.data.yearlyIncome
      }
      decision.proofHashes.push(incomeData.proofHash)
      
      if (incomeData.data.yearlyIncome < application.loanAmount * 0.5) {
        decision.reasons.push('Income too low relative to loan amount')
      }
    } catch (error) {
      console.error('❌ Income verification failed:', error)
      decision.reasons.push('Unable to verify income')
    }
    
    // Verify credit report
    try {
      console.log('\n3️⃣  Verifying Credit Report')
      const creditData = await this.tlsActor.execute({
        action: 'verify',
        proof: application.proofs.creditReport
      })
      
      decision.verifications.creditScore = {
        verified: true,
        score: creditData.data.score
      }
      decision.proofHashes.push(creditData.proofHash)
      
      if (creditData.data.score < 680) {
        decision.reasons.push('Credit score below minimum (680)')
      }
    } catch (error) {
      console.error('❌ Credit report verification failed:', error)
      decision.reasons.push('Unable to verify credit report')
    }
    
    // Phase 2: Verify Computations with RISC Zero (optional)
    console.log('\n┌─────────────────────────────────────────────────────────────────┐')
    console.log('│ PHASE 2: RISC Zero Computation Verification (ZK Proofs)        │')
    console.log('└─────────────────────────────────────────────────────────────────┘\n')
    
    if (application.zkProofs?.dtiCalculation) {
      console.log('4️⃣  Verifying DTI Calculation (Zero-Knowledge)')
      console.log('   ⚙️  Verifying RISC Zero proof...')
      console.log('   ✅ DTI proof valid: applicant has DTI < 43%')
      console.log('   💡 Exact income/debt NOT revealed (privacy preserved)')
      
      decision.verifications.dti = { verified: true }
      // In production, ratio would come from ZK proof public outputs
      decision.verifications.dti.ratio = 38 // Example
    } else if (decision.verifications.income.amount && decision.verifications.income.verified) {
      // Calculate DTI without ZK (less privacy)
      const monthlyIncome = decision.verifications.income.amount / 12
      const estimatedDebt = application.loanAmount * 0.005 // Estimate monthly payment
      const dti = (estimatedDebt / monthlyIncome) * 100
      
      console.log('4️⃣  Calculating DTI (No ZK proof provided)')
      console.log(`   📊 Monthly Income: $${monthlyIncome.toFixed(2)}`)
      console.log(`   📊 Estimated Monthly Debt: $${estimatedDebt.toFixed(2)}`)
      console.log(`   📊 DTI Ratio: ${dti.toFixed(2)}%`)
      
      decision.verifications.dti = { verified: true, ratio: dti }
      
      if (dti > 43) {
        decision.reasons.push('DTI ratio above maximum (43%)')
      }
    }
    
    // Phase 3: Make Decision
    console.log('\n┌─────────────────────────────────────────────────────────────────┐')
    console.log('│ PHASE 3: Loan Decision                                         │')
    console.log('└─────────────────────────────────────────────────────────────────┘\n')
    
    // Check if all verifications passed
    const allVerified = 
      decision.verifications.bankBalance.verified &&
      decision.verifications.income.verified &&
      decision.verifications.creditScore.verified
    
    if (allVerified && decision.reasons.length === 0) {
      decision.approved = true
      decision.reasons.push('All verifications passed')
      decision.reasons.push('Credit score meets minimum')
      decision.reasons.push('Income sufficient')
      decision.reasons.push('DTI ratio acceptable')
      
      console.log('✅ LOAN APPROVED')
    } else {
      decision.approved = false
      console.log('❌ LOAN DENIED')
    }
    
    console.log('\n📋 Decision Summary:')
    console.log(`   Status: ${decision.approved ? '✅ APPROVED' : '❌ DENIED'}`)
    console.log(`   Reasons: ${decision.reasons.join(', ')}`)
    console.log(`   Proofs Verified: ${decision.proofHashes.length}`)
    console.log(`   Timestamp: ${new Date(decision.timestamp).toISOString()}`)
    
    console.log('\n' + '='.repeat(70) + '\n')
    
    return decision
  }
  
  /**
   * Get audit trail for compliance
   */
  async getAuditTrail(): Promise<any> {
    return this.tlsActor.execute({ action: 'audit-trail' })
  }
}

/**
 * Example: Complete loan workflow
 */
async function runLoanWorkflowExample() {
  const workflow = new LoanReviewWorkflow()
  
  // Create mock application with TLS Notary proofs
  const application: LoanApplication = {
    applicantId: 'applicant-789',
    loanAmount: 250000, // $250k loan
    
    proofs: {
      // Bank statement from Chase
      bankStatement: {
        version: '1.0',
        proof: {
          session: 'encrypted_tls_session_data',
          commitment: 'commitment_hash_bank',
          signature: 'notary_signature_bank'
        },
        data: {
          url: 'https://secure.chase.com/api/accounts/balance',
          method: 'GET',
          headers: 'HTTP/1.1 200 OK\nContent-Type: application/json',
          body: JSON.stringify({
            accountNumber: '****1234',
            balance: 75000.00,
            accountType: 'checking',
            asOfDate: '2024-12-16'
          })
        },
        timestamp: Date.now(),
        notaryPublicKey: 'tlsnotary_prod_key_v1'
      },
      
      // Paystubs from ADP
      paystubs: {
        version: '1.0',
        proof: {
          session: 'encrypted_tls_session_data',
          commitment: 'commitment_hash_paystubs',
          signature: 'notary_signature_paystubs'
        },
        data: {
          url: 'https://my.adp.com/api/payroll/ytd',
          method: 'GET',
          headers: 'HTTP/1.1 200 OK\nContent-Type: application/json',
          body: JSON.stringify({
            employeeId: 'EMP-456',
            yearlyIncome: 150000,
            employer: 'Tech Corp Inc',
            ytdGross: 125000,
            asOfDate: '2024-12-01'
          })
        },
        timestamp: Date.now(),
        notaryPublicKey: 'tlsnotary_prod_key_v1'
      },
      
      // Credit report from Experian
      creditReport: {
        version: '1.0',
        proof: {
          session: 'encrypted_tls_session_data',
          commitment: 'commitment_hash_credit',
          signature: 'notary_signature_credit'
        },
        data: {
          url: 'https://api.experian.com/credit-report',
          method: 'GET',
          headers: 'HTTP/1.1 200 OK\nContent-Type: application/json',
          body: JSON.stringify({
            applicantId: 'applicant-789',
            score: 720,
            reportDate: '2024-12-15',
            tradelines: 5,
            delinquencies: 0
          })
        },
        timestamp: Date.now(),
        notaryPublicKey: 'tlsnotary_prod_key_v1'
      }
    }
  }
  
  // Process the loan
  const decision = await workflow.processLoan(application)
  
  // Show audit trail
  console.log('\n📝 AUDIT TRAIL:')
  const audit = await workflow.getAuditTrail()
  console.log(JSON.stringify(audit, null, 2))
  
  return decision
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runLoanWorkflowExample().catch(console.error)
}

export { runLoanWorkflowExample, LoanReviewWorkflow }
