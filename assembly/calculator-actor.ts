/**
 * Advanced Mortgage Calculator Actor (AssemblyScript WASM)
 * 
 * Features:
 * - Standard amortization
 * - Prepayments (CPR/SMM)
 * - Defaults (CDR/MDR)
 * - Month-by-month cashflow projection
 * 
 * Input: {
 *   "principal": 400000,
 *   "annualRate": 6.5,
 *   "years": 30,
 *   "cpr": 5.0,       // Constant Prepayment Rate (annual %, optional)
 *   "cdr": 1.0        // Constant Default Rate (annual %, optional)
 * }
 */

function extractNumber(json: string, key: string): f64 {
  let keyIdx = json.indexOf('"' + key + '":')
  if (keyIdx >= 0) {
    let startIdx = keyIdx + key.length + 3
    let endIdx = json.indexOf(',', startIdx)
    if (endIdx < 0) endIdx = json.indexOf('}', startIdx)
    let valueStr = json.substring(startIdx, endIdx).trim()
    return parseFloat(valueStr)
  }
  return 0
}

function round(value: f64, decimals: i32): f64 {
  let multiplier = Math.pow(10, decimals)
  return Math.round(value * multiplier) / multiplier
}

// Convert CPR (annual) to SMM (monthly)
function cprToSmm(cpr: f64): f64 {
  return 1.0 - Math.pow(1.0 - (cpr / 100.0), 1.0 / 12.0)
}

// Convert CDR (annual) to MDR (monthly)
function cdrToMdr(cdr: f64): f64 {
  return 1.0 - Math.pow(1.0 - (cdr / 100.0), 1.0 / 12.0)
}

export function execute(inputJson: string): string {
  // Parse input
  const principal = extractNumber(inputJson, 'principal')
  const annualRate = extractNumber(inputJson, 'annualRate')
  const years = extractNumber(inputJson, 'years')
  const cpr = extractNumber(inputJson, 'cpr') // Optional: Constant Prepayment Rate
  const cdr = extractNumber(inputJson, 'cdr') // Optional: Constant Default Rate
  
  const monthlyRate = annualRate / 100.0 / 12.0
  const numPayments = years * 12.0
  
  // Calculate scheduled monthly payment (no prepay/default)
  let scheduledPayment: f64
  if (monthlyRate == 0) {
    scheduledPayment = principal / numPayments
  } else {
    const rPlusOne = 1.0 + monthlyRate
    const rPlusOnePowN = Math.pow(rPlusOne, numPayments)
    scheduledPayment = (principal * monthlyRate * rPlusOnePowN) / (rPlusOnePowN - 1.0)
  }
  
  // Convert CPR/CDR to monthly rates
  const smm = cpr > 0 ? cprToSmm(cpr) : 0.0
  const mdr = cdr > 0 ? cdrToMdr(cdr) : 0.0
  
  // Month-by-month simulation with prepayments and defaults
  let currentBalance = principal
  let totalScheduledPrincipal: f64 = 0
  let totalInterestPaid: f64 = 0
  let totalPrepayments: f64 = 0
  let totalDefaults: f64 = 0
  let totalRecovery: f64 = 0
  
  const recoveryRate: f64 = 0.7 // Assume 70% recovery on defaults
  
  for (let month: i32 = 1; month <= numPayments; month++) {
    if (currentBalance <= 0.01) break // Loan paid off
    
    // 1. Calculate interest payment
    const interestPayment = currentBalance * monthlyRate
    totalInterestPaid += interestPayment
    
    // 2. Calculate scheduled principal payment
    const scheduledPrincipalPayment = scheduledPayment - interestPayment
    
    // 3. Apply defaults (MDR) - happens first
    const defaultAmount = currentBalance * mdr
    totalDefaults += defaultAmount
    totalRecovery += defaultAmount * recoveryRate
    currentBalance -= defaultAmount
    
    if (currentBalance <= 0.01) break
    
    // 4. Apply scheduled principal
    const actualScheduledPrincipal = Math.min(scheduledPrincipalPayment, currentBalance)
    totalScheduledPrincipal += actualScheduledPrincipal
    currentBalance -= actualScheduledPrincipal
    
    if (currentBalance <= 0.01) break
    
    // 5. Apply prepayments (SMM) - on remaining balance
    const prepaymentAmount = currentBalance * smm
    totalPrepayments += prepaymentAmount
    currentBalance -= prepaymentAmount
  }
  
  // Calculate totals
  const totalPrincipalReturned = totalScheduledPrincipal + totalPrepayments + totalRecovery
  const totalPaid = totalPrincipalReturned + totalInterestPaid
  const netLoss = totalDefaults - totalRecovery
  
  // Round values
  const monthlyPaymentRounded = round(scheduledPayment, 2)
  const totalPaidRounded = round(totalPaid, 2)
  const totalInterestRounded = round(totalInterestPaid, 2)
  const totalPrepaymentsRounded = round(totalPrepayments, 2)
  const totalDefaultsRounded = round(totalDefaults, 2)
  const totalRecoveryRounded = round(totalRecovery, 2)
  const netLossRounded = round(netLoss, 2)
  const smmRounded = round(smm * 100, 4)
  const mdrRounded = round(mdr * 100, 4)
  
  // Build JSON response (need to handle optional fields carefully)
  let json = '{"monthlyPayment":' + monthlyPaymentRounded.toString()
  json += ',"totalPaid":' + totalPaidRounded.toString()
  json += ',"totalInterest":' + totalInterestRounded.toString()
  
  if (cpr > 0.001) {
    json += ',"cpr":' + cpr.toString()
    json += ',"smm":' + smmRounded.toString()
    json += ',"totalPrepayments":' + totalPrepaymentsRounded.toString()
  }
  
  if (cdr > 0.001) {
    json += ',"cdr":' + cdr.toString()
    json += ',"mdr":' + mdrRounded.toString()
    json += ',"totalDefaults":' + totalDefaultsRounded.toString()
    json += ',"totalRecovery":' + totalRecoveryRounded.toString()
    json += ',"netLoss":' + netLossRounded.toString()
  }
  
  json += '}'
  return json
}
