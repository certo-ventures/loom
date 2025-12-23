/**
 * Composite Loan Valuation Engine with Host Function Imports
 * 
 * This WASM module imports model functions from the host:
 * - prepaymentModel: calculate(month, balance, currentRate, origRate, loanAge)
 * - defaultModel: calculate(month, ltv, fico, hpiChange, loanAge)
 * - lgdModel: calculate(ltv, propertyType, state, hpiChange)
 * 
 * The host will wire these to the actual WASM model functions
 */

// Import model functions from host
@external("env", "prepaymentModel")
declare function prepaymentModel(month: f64, balance: f64, currentRate: f64, origRate: f64, loanAge: f64): f64

@external("env", "defaultModel")
declare function defaultModel(month: f64, ltv: f64, fico: f64, hpiChange: f64, loanAge: f64): f64

@external("env", "lgdModel")
declare function lgdModel(ltv: f64, propertyType: f64, state: f64, hpiChange: f64, unused: f64): f64

/**
 * Execute amortization with dynamic model calls
 */
export function execute(
  principal: f64,       // Original loan amount
  rate: f64,            // Annual interest rate (e.g., 0.065 for 6.5%)
  term: i32,            // Loan term in months
  currentRate: f64,     // Current market rate
  fico: i32,            // Borrower FICO
  origLTV: f64,         // Original LTV
  propertyType: i32,    // Property type
  state: i32,           // State code
  hpiChange: f64        // HPI change
): string {
  const monthlyRate = rate / 12.0
  
  // Calculate fixed payment using amortization formula
  const payment = principal * (monthlyRate * Math.pow(1.0 + monthlyRate, f64(term))) / 
                  (Math.pow(1.0 + monthlyRate, f64(term)) - 1.0)
  
  let balance = principal
  let totalInterest: f64 = 0
  let totalPrincipal: f64 = 0
  let totalPrepayments: f64 = 0
  let totalDefaults: f64 = 0
  let totalRecoveries: f64 = 0
  let loanAge: i32 = 0
  
  // Monthly amortization loop
  for (let month: i32 = 1; month <= term && balance > 0.01; month++) {
    loanAge++
    
    // Calculate interest for this month
    const interest = balance * monthlyRate
    
    // Get prepayment rate from model
    const smm = prepaymentModel(
      f64(month), 
      balance, 
      currentRate, 
      rate, 
      f64(loanAge)
    )
    
    // Get default rate from model
    const currentLTV = balance / (principal / origLTV)  // Approximate current LTV
    const mdr = defaultModel(
      f64(month),
      currentLTV,
      f64(fico),
      hpiChange,
      f64(loanAge)
    )
    
    // Apply defaults first
    const defaultAmount = balance * mdr
    if (defaultAmount > 0.01) {
      // Get recovery rate from LGD model
      const recoveryRate = lgdModel(
        currentLTV,
        f64(propertyType),
        f64(state),
        hpiChange,
        0.0
      )
      
      const recoveryAmount = defaultAmount * recoveryRate
      totalDefaults += defaultAmount
      totalRecoveries += recoveryAmount
      balance -= defaultAmount
      
      if (balance < 0.01) {
        break
      }
    }
    
    // Calculate scheduled principal payment
    let principalPayment = payment - interest
    
    // Apply prepayments to remaining balance
    const prepaymentAmount = balance * smm
    totalPrepayments += prepaymentAmount
    
    // Total principal reduction
    const totalPrincipalReduction = principalPayment + prepaymentAmount
    
    if (totalPrincipalReduction >= balance) {
      // Loan pays off this month
      totalPrincipal += balance
      balance = 0
    } else {
      totalPrincipal += totalPrincipalReduction
      balance -= totalPrincipalReduction
    }
    
    totalInterest += interest
  }
  
  // Build JSON response manually (no JSON library in AssemblyScript)
  let result = "{"
  result += '"totalInterest":'
  result += totalInterest.toString()
  result += ',"totalPrincipal":'
  result += totalPrincipal.toString()
  result += ',"totalPrepayments":'
  result += totalPrepayments.toString()
  result += ',"totalDefaults":'
  result += totalDefaults.toString()
  result += ',"totalRecoveries":'
  result += totalRecoveries.toString()
  result += ',"finalBalance":'
  result += balance.toString()
  result += ',"netLoss":'
  result += (totalDefaults - totalRecoveries).toString()
  result += "}"
  
  return result
}
