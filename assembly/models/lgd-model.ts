/**
 * Loss Given Default (LGD) Model WASM Actor
 * 
 * Calculates recovery rate on defaulted loans based on:
 * - Current LTV
 * - Property type
 * - Geographic location/state
 * - Market conditions
 */

export function calculate(
  ltv: f64,            // Current loan-to-value
  propertyType: f64,   // 0=SFR, 1=Condo, 2=Multi-family
  state: f64,          // State code (0-50)
  hpiChange: f64,      // Recent HPI trend
  unused: f64          // Unused (for signature compatibility)
): f64 {
  const propertyTypeInt = i32(propertyType)
  const stateInt = i32(state)
  
  // Base recovery rate by property type
  let baseRecovery: f64
  if (propertyTypeInt == 0) {
    baseRecovery = 0.70  // Single family: 70%
  } else if (propertyTypeInt == 1) {
    baseRecovery = 0.65  // Condo: 65%
  } else {
    baseRecovery = 0.60  // Multi-family: 60%
  }
  
  // LTV adjustment: higher LTV = lower recovery
  let ltvAdjustment: f64 = 0.0
  if (ltv > 1.0) {
    // Underwater loan
    ltvAdjustment = -0.15  // 15% worse recovery
  } else if (ltv > 0.9) {
    ltvAdjustment = -0.10
  } else if (ltv < 0.7) {
    ltvAdjustment = 0.05  // Better recovery with equity
  }
  
  // Market conditions: falling prices = worse recovery
  let marketAdjustment: f64 = 0.0
  if (hpiChange < 0.95) {
    marketAdjustment = -0.10  // 10% worse if prices falling
  } else if (hpiChange > 1.05) {
    marketAdjustment = 0.05   // 5% better if prices rising
  }
  
  // State-specific adjustments (simplified - some states have better/worse foreclosure laws)
  let stateAdjustment: f64 = 0.0
  if (stateInt == 5 || stateInt == 12 || stateInt == 36) {  // CA, FL, NY - judicial foreclosure
    stateAdjustment = -0.05  // Lower recovery due to longer timeline
  }
  
  // Combine adjustments
  let finalRecovery = baseRecovery + ltvAdjustment + marketAdjustment + stateAdjustment
  
  // Clamp between 0.3 and 0.9
  if (finalRecovery < 0.3) {
    finalRecovery = 0.3
  } else if (finalRecovery > 0.9) {
    finalRecovery = 0.9
  }
  
  return finalRecovery
}
