/**
 * Default Model WASM Actor
 * 
 * Calculates Monthly Default Rate (MDR) based on:
 * - Loan-to-Value ratio
 * - FICO score
 * - House price changes (equity)
 * - Loan age
 */

export function calculate(
  month: f64,          // Current month
  ltv: f64,            // Current loan-to-value ratio
  fico: f64,           // Borrower FICO score
  hpiChange: f64,      // House price index change (1.0 = no change, 1.1 = 10% up)
  loanAge: f64         // Months since origination
): f64 {
  const ficoInt = i32(fico)
  const loanAgeInt = i32(loanAge)
  
  // Base default rate by FICO
  let baseCDR: f64
  if (ficoInt >= 760) {
    baseCDR = 0.5  // 0.5% annually for excellent credit
  } else if (ficoInt >= 700) {
    baseCDR = 1.0  // 1% for good credit
  } else if (ficoInt >= 650) {
    baseCDR = 2.0  // 2% for fair credit
  } else {
    baseCDR = 5.0  // 5% for poor credit
  }
  
  // LTV adjustment: higher LTV = higher default risk
  const currentLTV = ltv / hpiChange  // Adjust for HPI changes
  let ltvMultiplier: f64 = 1.0
  if (currentLTV > 0.95) {
    ltvMultiplier = 3.0  // Very high LTV (underwater)
  } else if (currentLTV > 0.85) {
    ltvMultiplier = 2.0
  } else if (currentLTV > 0.75) {
    ltvMultiplier = 1.5
  }
  
  // Equity cushion: defaults lower if home value increased
  let equityFactor: f64 = 1.0
  if (hpiChange > 1.1) {
    equityFactor = 0.7  // 30% reduction if 10%+ appreciation
  } else if (hpiChange < 0.95) {
    equityFactor = 1.5  // 50% increase if 5%+ depreciation
  }
  
  // Seasoning: defaults peak around 18-36 months
  let seasoningFactor: f64 = 1.0
  if (loanAgeInt >= 18 && loanAgeInt <= 36) {
    seasoningFactor = 1.3  // Peak default period
  } else if (loanAgeInt < 12) {
    seasoningFactor = 0.5  // Lower in first year
  }
  
  // Combine factors
  const adjustedCDR = baseCDR * ltvMultiplier * equityFactor * seasoningFactor
  
  // Convert CDR to MDR: MDR = 1 - (1 - CDR)^(1/12)
  const mdr = 1.0 - Math.pow(1.0 - (adjustedCDR / 100.0), 1.0 / 12.0)
  
  return mdr
}
