/**
 * Prepayment Model WASM Actor
 * 
 * Calculates Single Monthly Mortality (SMM) based on:
 * - Loan age (seasoning ramp)
 * - Current rate vs original rate (refinancing incentive)
 * - Seasonality
 */

// Simple PSA-style prepayment model
export function calculate(
  month: f64,          // Current month in loan life (1-360)
  balance: f64,        // Current loan balance
  currentRate: f64,    // Current market rate
  origRate: f64,       // Original loan rate
  loanAge: f64         // Months since origination
): f64 {
  const loanAgeInt = i32(loanAge)
  const monthInt = i32(month)
  
  // PSA base: 0.2% CPR for month 1, ramping to 6% at month 30
  let baseCPR: f64
  if (loanAgeInt < 30) {
    baseCPR = 0.2 * loanAge  // Linear ramp
  } else {
    baseCPR = 6.0  // 100% PSA
  }
  
  // Refinancing incentive: prepay more if rates dropped
  const rateDiff = origRate - currentRate
  let refiMultiplier: f64 = 1.0
  if (rateDiff > 0.5) {
    refiMultiplier = 1.0 + rateDiff * 0.5  // 50% more for each point drop
  }
  
  // Seasonality: prepayments higher in summer (months 5-8)
  const seasonMonth = monthInt % 12
  let seasonalityFactor: f64 = 1.0
  if (seasonMonth >= 5 && seasonMonth <= 8) {
    seasonalityFactor = 1.2  // 20% higher in summer
  }
  
  // Combine factors
  const adjustedCPR = baseCPR * refiMultiplier * seasonalityFactor
  
  // Convert CPR to SMM: SMM = 1 - (1 - CPR)^(1/12)
  const smm = 1.0 - Math.pow(1.0 - (adjustedCPR / 100.0), 1.0 / 12.0)
  
  return smm
}
